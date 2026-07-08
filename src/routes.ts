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
import { sessions } from "./sessionManager.js";
import { config } from "./config.js";
import { pageToMarkdown } from "./markdown.js";
import { runAction, type Action } from "./actions.js";
import { runPrompt } from "./agent.js";

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

  // Natural-language endpoint: give it a plain-English task and Claude drives
  // the browser (via the same actions above) until it's done. This is the
  // "just send a prompt and Playwright does it" endpoint — e.g. "go to X and
  // collect every product name and price, paginating through all pages".
  app.post<{
    Params: { id: string };
    Body: { prompt?: string; maxSteps?: number };
  }>("/sessions/:id/prompt", async (req, reply) => {
    const prompt = req.body?.prompt;
    if (typeof prompt !== "string" || prompt.trim() === "") {
      return reply.badRequest("Body must be { prompt: \"...\" }");
    }
    if (!config.anthropicApiKey) {
      return reply.status(503).send({
        ok: false,
        error:
          "ANTHROPIC_API_KEY is not set. Add it to the service Variables to enable the /prompt endpoint.",
      });
    }
    const { page } = await sessions.get(req.params.id);
    try {
      const result = await runPrompt(page, prompt, {
        maxSteps: req.body?.maxSteps,
      });
      return reply.status(result.ok ? 200 : 422).send(result);
    } catch (err) {
      return reply.status(502).send({
        ok: false,
        error: (err as Error).message,
      });
    }
  });

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

  // Rendered page as Markdown. Query params:
  //   ?readability=false  -> convert the whole body instead of the main article
  //   ?selector=.article  -> convert only that element
  app.get<{
    Params: { id: string };
    Querystring: { readability?: string; selector?: string };
  }>("/sessions/:id/markdown", async (req) => {
    const { page } = await sessions.get(req.params.id);
    return pageToMarkdown(page, {
      readability: req.query.readability !== "false",
      selector: req.query.selector,
    });
  });

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
