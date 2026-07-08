#!/usr/bin/env node
/**
 * browser-api-mcp
 *
 * A local MCP (Model Context Protocol) server that connects an MCP client
 * (Claude Desktop, etc.) to your browser-api service running on Railway.
 * It exposes the service's HTTP endpoints as MCP tools so Claude can drive a
 * real headless browser: navigate, click/type, run JS, read pages as Markdown,
 * take screenshots, or hand off a plain-English task to the /prompt agent.
 *
 * Transport is stdio (what Claude Desktop speaks). Configure via env:
 *   BROWSER_API_URL        e.g. https://your-app.up.railway.app   (required)
 *   BROWSER_API_TOKEN      the service's API_TOKEN                 (required)
 *   BROWSER_DEFAULT_SESSION optional session name (default "default")
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = (process.env.BROWSER_API_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.BROWSER_API_TOKEN || "";
const DEFAULT_SESSION = process.env.BROWSER_DEFAULT_SESSION || "default";

if (!BASE || !TOKEN) {
  console.error(
    "[browser-api-mcp] Missing config. Set BROWSER_API_URL and BROWSER_API_TOKEN " +
      "in the MCP server's env (see README).",
  );
  process.exit(1);
}

// ---- tiny HTTP client ------------------------------------------------------
/** Build the request path (relative to BASE) for a session sub-route. */
function url(session: string, suffix = ""): string {
  return `/sessions/${encodeURIComponent(session)}${suffix}`;
}
function headers(extra?: Record<string, string>): Record<string, string> {
  return { authorization: `Bearer ${TOKEN}`, ...extra };
}

async function apiJson(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<unknown> {
  const res = await fetch(BASE + path, {
    method: init?.method ?? "GET",
    headers: headers(
      init?.body !== undefined ? { "content-type": "application/json" } : undefined,
    ),
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const detail = typeof data === "object" ? JSON.stringify(data) : String(text);
    throw new Error(`${res.status} ${res.statusText} — ${detail}`);
  }
  return data;
}

type ToolResult = {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
  isError?: boolean;
};

function ok(value: unknown): ToolResult {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}
function fail(err: unknown): ToolResult {
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
}
/** Wrap a handler so thrown errors become tidy MCP error results. */
function guard(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  return fn().catch(fail);
}

const session = z
  .string()
  .optional()
  .describe(
    `Session name — reuse the same name to reuse the same logged-in browser profile. Defaults to "${DEFAULT_SESSION}".`,
  );
const S = (s?: string) => s || DEFAULT_SESSION;

// ---- server ----------------------------------------------------------------
const server = new McpServer({ name: "browser-api", version: "0.1.0" });

server.tool(
  "browser_goto",
  "Navigate a browser session to a URL. Reusing a session name keeps you logged in across calls.",
  {
    session,
    url: z.string().describe("Absolute URL to open."),
    waitUntil: z
      .enum(["load", "domcontentloaded", "networkidle", "commit"])
      .optional()
      .describe("When navigation is considered done. Use 'networkidle' for JS-heavy pages."),
  },
  ({ session: s, url: u, waitUntil }) =>
    guard(async () =>
      ok(await apiJson(url(S(s), "/goto"), { method: "POST", body: { url: u, waitUntil } })),
    ),
);

server.tool(
  "browser_click",
  "Click an element by CSS selector in a session.",
  { session, selector: z.string().describe("CSS selector to click.") },
  ({ session: s, selector }) =>
    guard(async () =>
      ok(await apiJson(url(S(s), "/click"), { method: "POST", body: { selector } })),
    ),
);

server.tool(
  "browser_type",
  "Type text into an element with realistic keystrokes (needed by some JS forms).",
  {
    session,
    selector: z.string().describe("CSS selector of the input."),
    text: z.string().describe("Text to type."),
  },
  ({ session: s, selector, text }) =>
    guard(async () =>
      ok(await apiJson(url(S(s), "/type"), { method: "POST", body: { selector, text } })),
    ),
);

server.tool(
  "browser_fill",
  "Set an input's value directly (faster than typing; skips per-key events).",
  {
    session,
    selector: z.string().describe("CSS selector of the input."),
    text: z.string().describe("Value to set."),
  },
  ({ session: s, selector, text }) =>
    guard(async () =>
      ok(await apiJson(url(S(s), "/fill"), { method: "POST", body: { selector, text } })),
    ),
);

server.tool(
  "browser_evaluate",
  "Run JavaScript in the page and return the result. The script is a function body — use `return` to send a value back; you can `await`.",
  { session, script: z.string().describe("JS function body, e.g. `return document.title`.") },
  ({ session: s, script }) =>
    guard(async () =>
      ok(await apiJson(url(S(s), "/evaluate"), { method: "POST", body: { script } })),
    ),
);

server.tool(
  "browser_get_markdown",
  "Get the current page as clean Markdown (reader-mode extraction by default). Best way to read a JS-rendered page.",
  {
    session,
    readability: z
      .boolean()
      .optional()
      .describe("Extract main article (default true). Set false to convert the whole body."),
    selector: z.string().optional().describe("Convert only this element instead of the article."),
  },
  ({ session: s, readability, selector }) =>
    guard(async () => {
      const q = new URLSearchParams();
      if (readability === false) q.set("readability", "false");
      if (selector) q.set("selector", selector);
      const suffix = "/markdown" + (q.toString() ? `?${q}` : "");
      return ok(await apiJson(url(S(s), suffix)));
    }),
);

server.tool(
  "browser_get_html",
  "Get the current page's fully-rendered HTML.",
  { session },
  ({ session: s }) =>
    guard(async () => ok(await apiJson(url(S(s), "/content")))),
);

server.tool(
  "browser_screenshot",
  "Take a PNG screenshot of the current page and return it as an image.",
  {
    session,
    fullPage: z.boolean().optional().describe("Capture the entire scrollable page (default: viewport only)."),
  },
  ({ session: s, fullPage }) =>
    guard(async () => {
      const suffix = "/screenshot" + (fullPage ? "?fullPage=true" : "");
      const res = await fetch(BASE + url(S(s), suffix), { headers: headers() });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${await res.text()}`);
      const buf = Buffer.from(await res.arrayBuffer());
      return {
        content: [
          { type: "image", data: buf.toString("base64"), mimeType: "image/png" },
        ],
      };
    }),
);

server.tool(
  "browser_run_actions",
  "Run a batch of browser actions in order (goto/click/fill/type/press/waitForSelector/waitForTimeout/evaluate/screenshot/content/markdown/url). Returns one result per action; stops at the first failure.",
  {
    session,
    actions: z
      .array(z.record(z.any()))
      .describe('Array of action objects, e.g. [{"type":"goto","url":"..."},{"type":"markdown"}].'),
  },
  ({ session: s, actions }) =>
    guard(async () =>
      ok(await apiJson(url(S(s), "/actions"), { method: "POST", body: { actions } })),
    ),
);

server.tool(
  "browser_prompt",
  "Give the browser a plain-English task and let the server-side Claude agent drive it to completion (navigating, clicking, extracting, paginating). Requires ANTHROPIC_API_KEY on the service.",
  {
    session,
    prompt: z.string().describe("The task, e.g. 'Go to X and collect every product name and price across all pages.'"),
    maxSteps: z.number().int().positive().optional().describe("Cap on agent<->browser round trips."),
  },
  ({ session: s, prompt, maxSteps }) =>
    guard(async () =>
      ok(await apiJson(url(S(s), "/prompt"), { method: "POST", body: { prompt, maxSteps } })),
    ),
);

server.tool(
  "browser_list_sessions",
  "List the browser sessions currently live (in memory) on the service.",
  {},
  () => guard(async () => ok(await apiJson("/sessions"))),
);

server.tool(
  "browser_close_session",
  "Close a session's live browser but KEEP its login/profile on disk (re-opening restores the session).",
  { session },
  ({ session: s }) =>
    guard(async () => ok(await apiJson(url(S(s), "/close"), { method: "POST" }))),
);

server.tool(
  "browser_end_session",
  "Destroy a session entirely: close the browser AND delete its saved profile (full logout).",
  { session },
  ({ session: s }) =>
    guard(async () => ok(await apiJson(url(S(s)), { method: "DELETE" }))),
);

// ---- go ---------------------------------------------------------------------
async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe for logs; stdout is the MCP channel.
  console.error(`[browser-api-mcp] connected → ${BASE} (default session "${DEFAULT_SESSION}")`);
}

main().catch((err) => {
  console.error("[browser-api-mcp] fatal:", err);
  process.exit(1);
});
