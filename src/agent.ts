/**
 * Natural-language browser agent.
 *
 * Given a plain-English task ("go to X and collect all rows, paginating through
 * every page"), this runs an agentic tool-use loop: Claude is handed a set of
 * browser tools (all backed by the same `runAction` the batch API uses) and
 * drives the live Playwright page until the task is done, then returns its
 * answer. The browser is stateful and session-bound, so a prompt can build on
 * whatever page/login the session already has.
 *
 * It's a hand-written loop (rather than the SDK tool runner) because we need to
 * bound the number of steps, truncate oversized page dumps before they hit the
 * context window, and feed screenshots back as image blocks — control the
 * runner's per-turn hooks don't cleanly cover.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Page } from "playwright";
import { config } from "./config.js";
import { runAction, type Action } from "./actions.js";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** Tool definitions exposed to the model. Each maps to a browser Action. */
const TOOLS: Anthropic.Tool[] = [
  {
    name: "goto",
    description:
      "Navigate the browser to a URL. Waits for the page to load before returning.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute URL to open." },
        waitUntil: {
          type: "string",
          enum: ["load", "domcontentloaded", "networkidle", "commit"],
          description:
            "When to consider navigation done. Use 'networkidle' for JS-heavy pages that load data after the initial paint.",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "click",
    description:
      "Click the first element matching a CSS selector (e.g. a 'Next page' link or a button).",
    input_schema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector to click." },
      },
      required: ["selector"],
    },
  },
  {
    name: "fill",
    description:
      "Set the value of an input/textarea matching a CSS selector (instant, not per-keystroke).",
    input_schema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector of the field." },
        text: { type: "string", description: "Value to set." },
      },
      required: ["selector", "text"],
    },
  },
  {
    name: "type",
    description:
      "Type text into a field with realistic per-key events (use when a form only reacts to real keystrokes).",
    input_schema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector of the field." },
        text: { type: "string", description: "Text to type." },
      },
      required: ["selector", "text"],
    },
  },
  {
    name: "press",
    description:
      "Press a keyboard key on the page (e.g. 'Enter', 'Escape', 'ArrowDown').",
    input_schema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Key name to press." },
      },
      required: ["key"],
    },
  },
  {
    name: "wait_for_selector",
    description:
      "Wait until an element matching a CSS selector reaches a state. Use after clicking 'Next' to wait for the new page's content.",
    input_schema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector to wait for." },
        state: {
          type: "string",
          enum: ["attached", "detached", "visible", "hidden"],
          description: "State to wait for (default: visible).",
        },
        timeout: { type: "number", description: "Max wait in ms." },
      },
      required: ["selector"],
    },
  },
  {
    name: "evaluate",
    description:
      "Run JavaScript in the page and return the result. The script is a function body: use `return` to send a value back, and you may `await`. This is the main tool for extracting structured data — e.g. `return [...document.querySelectorAll('.product')].map(el => ({ name: el.querySelector('.name').innerText, price: el.querySelector('.price').innerText }))`. Return JSON-serialisable values.",
    input_schema: {
      type: "object",
      properties: {
        script: {
          type: "string",
          description: "JavaScript function body to run in the page.",
        },
      },
      required: ["script"],
    },
  },
  {
    name: "get_markdown",
    description:
      "Get the current page's main content as clean Markdown (reader mode). Good for reading article/body text. Set readability:false to convert the whole page, or pass a selector to convert just one element.",
    input_schema: {
      type: "object",
      properties: {
        readability: {
          type: "boolean",
          description:
            "Run reader-mode main-content extraction first (default true).",
        },
        selector: {
          type: "string",
          description: "Convert only this element's HTML instead.",
        },
      },
      required: [],
    },
  },
  {
    name: "current_url",
    description: "Return the current page URL and title.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "screenshot",
    description:
      "Capture a PNG screenshot of the page and see it. Use sparingly — only when you need to visually understand layout you can't get from the DOM. Set fullPage:true for the entire scrollable page.",
    input_schema: {
      type: "object",
      properties: {
        fullPage: {
          type: "boolean",
          description: "Capture the full scrollable page (default false).",
        },
      },
      required: [],
    },
  },
];

const SYSTEM_PROMPT = `You are a browser automation agent. You drive a real, live Chromium browser through the provided tools to accomplish the user's task, then report the result.

The browser session is persistent and may already have a page open and be logged in — check the current URL if it matters. Work step by step: navigate, interact, and extract using the tools.

Guidance:
- To extract structured data, prefer the \`evaluate\` tool returning a JSON-serialisable value (arrays/objects). For reading prose, \`get_markdown\` is cleaner.
- To paginate: extract the current page, then find and \`click\` the next-page control, \`wait_for_selector\` for the new content (or check the URL/content changed), and repeat. Accumulate results across all pages. Stop when there is no next page, the content stops changing, or you reach the last page. Guard against infinite loops.
- Selectors can be brittle — if a click or wait fails, inspect the DOM with \`evaluate\` (e.g. return outerHTML of a container, or list candidate selectors) and adapt.
- Be efficient: don't take screenshots unless you genuinely need to see the layout. Don't re-fetch data you already have.

When the task is complete, stop calling tools and give your final answer as your last message. If the user asked for data, return it in a clear structured form (JSON when appropriate) — this final message is the whole deliverable, so include the actual data, not just a description of what you did.`;

/** One tool call as recorded for the caller (without the bulky raw output). */
interface TranscriptEntry {
  step: number;
  tool: string;
  input: unknown;
  ok: boolean;
  preview: string;
}

export interface PromptResult {
  ok: boolean;
  /** The model's final answer (the deliverable). */
  result: string;
  /** Number of model turns taken. */
  steps: number;
  stopReason: string | null;
  /** Log of tool calls made, in order. */
  transcript: TranscriptEntry[];
  error?: string;
}

interface RunPromptOptions {
  maxSteps?: number;
  /**
   * Anthropic client to use. Defaults to a fresh one from config. Injectable so
   * the loop can be driven by a stand-in in tests without a live API key.
   */
  client?: Pick<Anthropic, "messages">;
}

/** Truncate a string result so a giant page dump can't blow up the context. */
function truncate(s: string): string {
  const max = config.agentMaxToolResultChars;
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n\n…[truncated ${s.length - max} chars]`;
}

/** Short human-readable preview of a tool result for the transcript. */
function preview(s: string): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > 200 ? `${oneLine.slice(0, 200)}…` : oneLine;
}

/**
 * Map a tool call to a browser Action, run it, and shape the result for the
 * model. Screenshots come back as an image content block so the model can see
 * them; everything else is JSON text (truncated if huge).
 */
async function executeTool(
  page: Page,
  name: string,
  input: Record<string, unknown>,
): Promise<{
  content: string | Anthropic.ToolResultBlockParam["content"];
  isError: boolean;
  preview: string;
}> {
  const toAction = (): Action => {
    switch (name) {
      case "goto":
        return { type: "goto", url: input.url as string, waitUntil: input.waitUntil as Action["waitUntil"] };
      case "click":
        return { type: "click", selector: input.selector as string };
      case "fill":
        return { type: "fill", selector: input.selector as string, text: input.text as string };
      case "type":
        return { type: "type", selector: input.selector as string, text: input.text as string };
      case "press":
        return { type: "press", key: input.key as string };
      case "wait_for_selector":
        return {
          type: "waitForSelector",
          selector: input.selector as string,
          state: input.state as Action["state"],
          timeout: input.timeout as number | undefined,
        };
      case "evaluate":
        return { type: "evaluate", script: input.script as string };
      case "get_markdown":
        return { type: "markdown", readability: input.readability as boolean | undefined, selector: input.selector as string | undefined };
      case "current_url":
        return { type: "url" };
      case "screenshot":
        return { type: "screenshot", fullPage: input.fullPage as boolean | undefined };
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  };

  try {
    const result = await runAction(page, toAction());

    // Screenshot → image block the model can actually look at.
    if (name === "screenshot" && result && typeof result === "object" && "image" in result) {
      const data = (result as { image: string }).image;
      return {
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data },
          },
        ],
        isError: false,
        preview: "[screenshot]",
      };
    }

    const text = truncate(JSON.stringify(result));
    return { content: text, isError: false, preview: preview(text) };
  } catch (err) {
    const message = (err as Error).message;
    return { content: `Error: ${message}`, isError: true, preview: `error: ${message}` };
  }
}

/**
 * Run a natural-language task against a page: an agentic loop that lets Claude
 * call the browser tools until it produces a final answer or hits the step cap.
 */
export async function runPrompt(
  page: Page,
  prompt: string,
  opts: RunPromptOptions = {},
): Promise<PromptResult> {
  const client = opts.client ?? new Anthropic({ apiKey: config.anthropicApiKey });
  const maxSteps = Math.max(1, Math.min(opts.maxSteps ?? config.agentMaxSteps, 200));

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: prompt },
  ];
  const transcript: TranscriptEntry[] = [];
  let lastText = "";

  for (let step = 1; step <= maxSteps; step++) {
    const response = await client.messages.create({
      model: config.anthropicModel,
      max_tokens: config.agentMaxTokens,
      system: SYSTEM_PROMPT,
      thinking: { type: "adaptive" },
      output_config: { effort: config.agentEffort as Effort },
      tools: TOOLS,
      messages,
    });

    // Preserve the full assistant turn (thinking + tool_use blocks) for the
    // next request — required for multi-turn tool use and adaptive thinking.
    messages.push({ role: "assistant", content: response.content });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (text) lastText = text;

    if (response.stop_reason === "refusal") {
      return {
        ok: false,
        result: lastText,
        steps: step,
        stopReason: "refusal",
        transcript,
        error: "The model declined this request.",
      };
    }

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    // No tool calls → the model is done; its text is the deliverable.
    if (toolUses.length === 0) {
      return {
        ok: true,
        result: lastText,
        steps: step,
        stopReason: response.stop_reason,
        transcript,
      };
    }

    // Run every requested tool and return all results in one user message.
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const call of toolUses) {
      const { content, isError, preview: p } = await executeTool(
        page,
        call.name,
        (call.input ?? {}) as Record<string, unknown>,
      );
      transcript.push({
        step,
        tool: call.name,
        input: call.input,
        ok: !isError,
        preview: p,
      });
      toolResults.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: content as Anthropic.ToolResultBlockParam["content"],
        is_error: isError,
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  // Ran out of steps before the model finished.
  return {
    ok: false,
    result: lastText,
    steps: maxSteps,
    stopReason: "max_steps",
    transcript,
    error: `Reached the step limit (${maxSteps}) before finishing. Raise maxSteps or AGENT_MAX_STEPS, or narrow the task.`,
  };
}
