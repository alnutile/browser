/**
 * HTTP routes: the API surface other services call.
 *
 * Everything is keyed by a session id in the URL, e.g. POST /sessions/my-bot/goto.
 * A session id is just a name you choose; reusing the same name reuses the same
 * logged-in browser profile. Auth is enforced globally in server.ts.
 *
 * The batch endpoint (POST /sessions/:id/actions) is the workhorse for the
 * "go to this URL, then do this, then this" flows described in the README.
 */

import type { FastifyInstance } from "fastify";
import type { Page } from "playwright";
import { sessions } from "./sessionManager.js";
import { config } from "./config.js";

type WaitUntil = "load" | "domcontentloaded" | "networkidle" | "commit";

/** A single instruction in a batch. Mirrors common Playwright page actions. */
interface Action {
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
}

/** Execute one action against a page and return a JSON-serialisable result. */
async function runAction(page: Page, action: Action): Promise<unknown> {
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
    case "url":
      return { url: page.url(), title: await page.title() };
    default:
      throw new Error(`Unknown action type: ${(action as Action).type}`);
  }
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // List currently live (in-memory) sessions.
  app.get("/sessions", async () => ({ live: sessions.liveIds() }));

  // Run a batch of actions in order. Returns a result per action. Stops at the
  // first failure and reports which step failed.
  app.post<{ Params: { id: string }; Body: { actions: Action[] } }>(
    "/sessions/:id/actions",
    async (req, reply) => {
      const { actions } = req.body ?? { actions: [] };
      if (!Array.isArray(actions) || actions.length === 0) {
        return reply.badRequest("Body must be { actions: [ ... ] }");
      }
      const { page } = await sessions.get(req.params.id);
      const results: unknown[] = [];
      for (let i = 0; i < actions.length; i++) {
        try {
          results.push(await runAction(page, actions[i]));
        } catch (err) {
          return reply.status(422).send({
            ok: false,
            failedAt: i,
            action: actions[i],
            error: (err as Error).message,
            results,
          });
        }
      }
      return { ok: true, results };
    },
  );

  // Convenience single-action endpoints (thin wrappers over runAction).
  const single = (type: Action["type"]) =>
    async function (
      this: FastifyInstance,
      req: { params: { id: string }; body?: Partial<Action> },
    ) {
      const { page } = await sessions.get(req.params.id);
      return runAction(page, { ...(req.body ?? {}), type });
    };

  app.post<{ Params: { id: string }; Body: Partial<Action> }>(
    "/sessions/:id/goto",
    single("goto"),
  );
  app.post<{ Params: { id: string }; Body: Partial<Action> }>(
    "/sessions/:id/click",
    single("click"),
  );
  app.post<{ Params: { id: string }; Body: Partial<Action> }>(
    "/sessions/:id/fill",
    single("fill"),
  );
  app.post<{ Params: { id: string }; Body: Partial<Action> }>(
    "/sessions/:id/type",
    single("type"),
  );
  app.post<{ Params: { id: string }; Body: Partial<Action> }>(
    "/sessions/:id/evaluate",
    single("evaluate"),
  );

  // Current page HTML.
  app.get<{ Params: { id: string } }>(
    "/sessions/:id/content",
    async (req) => {
      const { page } = await sessions.get(req.params.id);
      return { html: await page.content() };
    },
  );

  // Screenshot as a PNG image (binary). Add ?fullPage=true for the whole page.
  app.get<{ Params: { id: string }; Querystring: { fullPage?: string } }>(
    "/sessions/:id/screenshot",
    async (req, reply) => {
      const { page } = await sessions.get(req.params.id);
      const buf = await page.screenshot({
        fullPage: req.query.fullPage === "true",
      });
      return reply.type("image/png").send(buf);
    },
  );

  // Close the live browser but KEEP the login/profile on disk.
  app.post<{ Params: { id: string } }>(
    "/sessions/:id/close",
    async (req) => {
      await sessions.close(req.params.id);
      return { ok: true, closed: req.params.id, profileKept: true };
    },
  );

  // Fully destroy a session: close browser AND delete its profile (logout).
  app.delete<{ Params: { id: string } }>(
    "/sessions/:id",
    async (req) => {
      await sessions.destroy(req.params.id);
      return { ok: true, destroyed: req.params.id };
    },
  );

  app.log.info(
    { defaultTimeoutMs: config.defaultTimeoutMs },
    "browser API routes registered",
  );
}
