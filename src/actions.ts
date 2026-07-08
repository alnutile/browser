/**
 * Low-level browser actions, shared between the batch endpoint (routes.ts) and
 * the natural-language agent (agent.ts).
 *
 * A single `Action` maps to one Playwright page operation. `runAction` executes
 * it and returns a JSON-serialisable result. Keeping this in one place means the
 * agent's tools and the batch API stay behaviourally identical — a `goto` does
 * the same thing however it was triggered.
 */

import type { Page } from "playwright";
import { pageToMarkdown } from "./markdown.js";

export type WaitUntil = "load" | "domcontentloaded" | "networkidle" | "commit";

/** A single instruction. Mirrors common Playwright page actions. */
export interface Action {
  type:
    | "goto"
    | "click"
    | "fill"
    | "type"
    | "press"
    | "waitForSelector"
    | "waitForTimeout"
    | "evaluate"
    | "screenshot"
    | "content"
    | "markdown"
    | "url";
  // Loosely typed on purpose — validated per action below.
  url?: string;
  selector?: string;
  text?: string;
  key?: string;
  script?: string;
  timeout?: number;
  waitUntil?: WaitUntil;
  fullPage?: boolean;
  state?: "attached" | "detached" | "visible" | "hidden";
  /** For `markdown`: run Readability main-content extraction first (default true). */
  readability?: boolean;
}

/** Execute one action against a page and return a JSON-serialisable result. */
export async function runAction(page: Page, action: Action): Promise<unknown> {
  switch (action.type) {
    case "goto": {
      if (!action.url) throw new Error("goto requires 'url'");
      const res = await page.goto(action.url, {
        waitUntil: action.waitUntil ?? "load",
        timeout: action.timeout,
      });
      return { status: res?.status() ?? null, url: page.url() };
    }
    case "click":
      if (!action.selector) throw new Error("click requires 'selector'");
      await page.click(action.selector, { timeout: action.timeout });
      return { ok: true };
    case "fill":
      if (!action.selector) throw new Error("fill requires 'selector'");
      await page.fill(action.selector, action.text ?? "", {
        timeout: action.timeout,
      });
      return { ok: true };
    case "type":
      if (!action.selector) throw new Error("type requires 'selector'");
      // pressSequentially fires realistic keystrokes (needed by some JS forms).
      await page
        .locator(action.selector)
        .pressSequentially(action.text ?? "", { timeout: action.timeout });
      return { ok: true };
    case "press":
      if (!action.key) throw new Error("press requires 'key'");
      await page.keyboard.press(action.key);
      return { ok: true };
    case "waitForSelector":
      if (!action.selector)
        throw new Error("waitForSelector requires 'selector'");
      await page.waitForSelector(action.selector, {
        state: action.state ?? "visible",
        timeout: action.timeout,
      });
      return { ok: true };
    case "waitForTimeout":
      await page.waitForTimeout(action.timeout ?? 1000);
      return { ok: true };
    case "evaluate": {
      if (!action.script) throw new Error("evaluate requires 'script'");
      // Runs arbitrary JS in the page. `script` is treated as a function body;
      // use `return` to send a value back. This is the escape hatch for the
      // "complex JS interactions" use case.
      const result = await page.evaluate(
        // eslint-disable-next-line no-new-func
        new Function(`return (async () => { ${action.script} })()`) as never,
      );
      return { result };
    }
    case "screenshot": {
      const buf = await page.screenshot({ fullPage: action.fullPage ?? false });
      return { image: buf.toString("base64"), encoding: "base64", type: "png" };
    }
    case "content":
      return { html: await page.content() };
    case "markdown":
      // Convert the rendered DOM to Markdown. `selector` scopes it to one
      // element; otherwise Readability extracts the main article (readability:
      // false converts the whole body instead).
      return pageToMarkdown(page, {
        readability: action.readability,
        selector: action.selector,
      });
    case "url":
      return { url: page.url(), title: await page.title() };
    default:
      throw new Error(`Unknown action type: ${(action as Action).type}`);
  }
}
