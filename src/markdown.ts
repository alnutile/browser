/**
 * HTML → Markdown conversion for the `markdown` action.
 *
 * The whole point of this service is that pages are JavaScript-rendered, so we
 * convert the *live, rendered DOM* — not the raw HTML the server sent.
 *
 * Two modes:
 *   - readability (default): run Mozilla Readability *inside the browser page*
 *     against a clone of the live DOM to extract the main article content
 *     (drops nav/sidebars/footers/ads), then Turndown that to Markdown. This is
 *     the "reader mode" output that's ideal for feeding pages to an LLM.
 *   - raw: convert a specific element (by selector) or the whole <body>.
 *
 * Running Readability in-page means we reuse Chromium's real DOM and avoid
 * pulling jsdom onto the server.
 */

import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { Page } from "playwright";

const require = createRequire(import.meta.url);

// The Readability.js file declares a global `Readability` function and only
// touches module.exports when a CommonJS `module` exists — so injecting its
// source into a page defines window.Readability. Load it once at startup.
const readabilityDir = path.dirname(require.resolve("@mozilla/readability"));
const readabilitySource = readFileSync(
  path.join(readabilityDir, "Readability.js"),
  "utf8",
);

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});
turndown.use(gfm); // GitHub-flavored: tables, strikethrough, task lists.
// Strip noise that has no Markdown equivalent when converting raw HTML.
turndown.remove(["script", "style", "noscript"]);

export interface MarkdownResult {
  markdown: string;
  title: string | null;
  byline?: string | null;
  /** Which extraction path produced the output. */
  extractedWith: "readability" | "selector" | "body";
}

interface MarkdownOptions {
  /** Extract main content with Readability first. Default true. */
  readability?: boolean;
  /** Convert only this element's HTML (overrides readability). */
  selector?: string;
}

export async function pageToMarkdown(
  page: Page,
  opts: MarkdownOptions = {},
): Promise<MarkdownResult> {
  // 1. An explicit selector wins — convert just that element's HTML.
  if (opts.selector) {
    const html = await page
      .$eval(opts.selector, (el) => el.outerHTML)
      .catch(() => null);
    if (html == null) {
      throw new Error(`markdown: selector not found: ${opts.selector}`);
    }
    return {
      markdown: turndown.turndown(html),
      title: await page.title(),
      extractedWith: "selector",
    };
  }

  // 2. Readability (default): extract the main article from a DOM clone.
  if (opts.readability !== false) {
    // Injecting a <script> tag can be refused by a page's Content Security
    // Policy. The context is launched with bypassCSP so this normally works;
    // if it's disabled or still fails, fall through to the body conversion
    // below (which uses CDP evaluate and is not subject to CSP) rather than
    // failing the whole request.
    const injected = await page
      .addScriptTag({ content: readabilitySource })
      .then(() => true)
      .catch(() => false);
    const article = !injected
      ? null
      : await page.evaluate(() => {
      // `Readability` is the global defined by the injected source above.
      // Clone the document so parsing doesn't mutate the live page.
      const ReadabilityCtor = (
        globalThis as unknown as { Readability: new (doc: Document) => { parse(): { content: string; title: string; byline: string | null } | null } }
      ).Readability;
      const parsed = new ReadabilityCtor(
        document.cloneNode(true) as Document,
      ).parse();
      return parsed
        ? { content: parsed.content, title: parsed.title, byline: parsed.byline }
        : null;
    });
    if (article?.content) {
      return {
        markdown: turndown.turndown(article.content),
        title: article.title ?? (await page.title()),
        byline: article.byline,
        extractedWith: "readability",
      };
    }
    // Readability couldn't identify an article — fall through to the body.
  }

  // 3. Fallback: convert the whole rendered <body>.
  const bodyHtml = await page.evaluate(() => document.body?.innerHTML ?? "");
  return {
    markdown: turndown.turndown(bodyHtml),
    title: await page.title(),
    extractedWith: "body",
  };
}
