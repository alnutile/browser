/**
 * Entry point: builds the Fastify server, enforces bearer-token auth on every
 * route except /health, wires up graceful shutdown, and starts listening.
 */

import Fastify from "fastify";
import sensible from "@fastify/sensible";
import { config } from "./config.js";
import { registerRoutes } from "./routes.js";
import { sessions } from "./sessionManager.js";

async function main(): Promise<void> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    // Screenshots and page content can be large.
    bodyLimit: 10 * 1024 * 1024,
  });

  await app.register(sensible);

  // Liveness probe — unauthenticated so Railway health checks can hit it.
  app.get("/health", async () => ({ status: "ok", live: sessions.liveIds().length }));

  // Auth guard: constant-time-ish bearer check on everything else.
  app.addHook("onRequest", async (req, reply) => {
    if (req.url === "/health") return;
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (token !== config.apiToken) {
      return reply.unauthorized("Missing or invalid Bearer token");
    }
  });

  await registerRoutes(app);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "shutting down, closing browser sessions");
    // Safety net: if a clean close ever hangs, exit anyway before Railway's
    // grace period ends and SIGKILLs us mid-flush.
    const force = setTimeout(() => {
      app.log.warn("shutdown timed out, forcing exit");
      process.exit(1);
    }, 15_000);
    force.unref?.();
    await sessions.closeAll();
    await app.close();
    clearTimeout(force);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    { dataDir: config.dataDir, headless: config.headless },
    "browser API listening",
  );
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
