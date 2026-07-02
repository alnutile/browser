/**
 * Runtime configuration, read from environment variables.
 *
 * On Railway you set these under the service's "Variables" tab. The two that
 * matter most:
 *   - API_TOKEN:     shared secret callers must present (Authorization: Bearer ...)
 *   - DATA_DIR:      path to a mounted Railway Volume so browser sessions survive redeploys
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Set it in your Railway service Variables (or a local .env).`,
    );
  }
  return value;
}

export const config = {
  /** Port the HTTP server binds to. Railway injects PORT automatically. */
  port: Number(process.env.PORT ?? 3000),

  /** Bind host. 0.0.0.0 is required so Railway's proxy can reach the container. */
  host: process.env.HOST ?? "0.0.0.0",

  /**
   * Shared secret for API auth. Every request (except /health) must send
   * `Authorization: Bearer <API_TOKEN>`. Required — the service refuses to
   * start without it so you never accidentally expose an open browser proxy.
   */
  apiToken: required("API_TOKEN"),

  /**
   * Directory for persistent data (browser profiles + saved session states).
   * Point this at a mounted Railway Volume, e.g. /data. If the volume isn't
   * mounted the app still runs, but logins are lost on every redeploy.
   */
  dataDir: process.env.DATA_DIR ?? "/data",

  /** Run Chromium headless. Set HEADLESS=false only for local debugging. */
  headless: (process.env.HEADLESS ?? "true").toLowerCase() !== "false",

  /**
   * Optional explicit path to a Chromium/Chrome binary. Leave unset to use the
   * browser bundled with the Playwright npm package (the normal case, including
   * the Docker image). Set it when running against a system-installed or
   * pre-provisioned Chromium whose build differs from the npm package's.
   */
  chromiumExecutablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,

  /**
   * How long (ms) a session may sit idle before it is closed automatically to
   * free memory. Its persisted login state is kept on disk regardless.
   */
  sessionIdleMs: Number(process.env.SESSION_IDLE_MS ?? 10 * 60 * 1000),

  /** Default per-action navigation/timeout budget (ms). */
  defaultTimeoutMs: Number(process.env.DEFAULT_TIMEOUT_MS ?? 30_000),

  /** Max number of concurrently-open browser contexts (memory guard). */
  maxSessions: Number(process.env.MAX_SESSIONS ?? 5),
} as const;
