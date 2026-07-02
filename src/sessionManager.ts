/**
 * SessionManager owns the live Playwright browser contexts.
 *
 * Each "session" is an independent, named browser profile. We use Playwright's
 * `launchPersistentContext(userDataDir)`, which stores cookies, localStorage,
 * IndexedDB, and the rest of the Chrome profile *on disk* in a per-session
 * directory. When that directory lives on a mounted Railway Volume, a session
 * that logged in yesterday is still logged in after a redeploy today.
 *
 * Lifecycle:
 *   - First use of a session id launches a persistent context for it.
 *   - Idle sessions are closed after config.sessionIdleMs to free memory, but
 *     their on-disk profile is left intact, so re-opening restores login state.
 */

import { chromium, type BrowserContext, type Page } from "playwright";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

interface Session {
  id: string;
  context: BrowserContext;
  page: Page;
  lastUsed: number;
  idleTimer?: NodeJS.Timeout;
}

/** Reject ids that could escape the sessions directory or break the filesystem. */
function assertSafeId(id: string): void {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
    throw new Error(
      "Invalid session id. Use 1-64 chars: letters, numbers, dash, underscore.",
    );
  }
}

export class SessionManager {
  private sessions = new Map<string, Session>();

  private sessionsRoot(): string {
    return path.join(config.dataDir, "sessions");
  }

  private profileDir(id: string): string {
    return path.join(this.sessionsRoot(), id);
  }

  /** Get an existing live session or launch one from its persisted profile. */
  async get(id: string): Promise<Session> {
    assertSafeId(id);

    const existing = this.sessions.get(id);
    if (existing) {
      this.touch(existing);
      return existing;
    }

    if (this.sessions.size >= config.maxSessions) {
      // Evict the least-recently-used live session (its profile stays on disk).
      const lru = [...this.sessions.values()].sort(
        (a, b) => a.lastUsed - b.lastUsed,
      )[0];
      if (lru) await this.close(lru.id);
    }

    const userDataDir = this.profileDir(id);
    await mkdir(userDataDir, { recursive: true });

    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: config.headless,
      executablePath: config.chromiumExecutablePath,
      viewport: { width: 1280, height: 800 },
      // By default Playwright installs its OWN signal handlers that force-kill
      // the browser on SIGTERM/SIGINT. On a Railway redeploy that kill wins the
      // race against our graceful shutdown, so Chromium dies before it flushes
      // localStorage/IndexedDB to the profile — logins would be lost. We disable
      // them so our own handler (server.ts) can close the context cleanly, which
      // flushes the profile to the mounted Volume before the process exits.
      handleSIGTERM: false,
      handleSIGINT: false,
      handleSIGHUP: false,
      args: [
        // Flags that keep Chromium happy inside a small container.
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
    context.setDefaultTimeout(config.defaultTimeoutMs);
    context.setDefaultNavigationTimeout(config.defaultTimeoutMs);

    // Reuse the first tab the profile opens with, or create one.
    const page = context.pages()[0] ?? (await context.newPage());

    const session: Session = { id, context, page, lastUsed: Date.now() };
    this.sessions.set(id, session);
    this.touch(session);
    return session;
  }

  /** Reset the idle timer for a session each time it's used. */
  private touch(session: Session): void {
    session.lastUsed = Date.now();
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => {
      void this.close(session.id);
    }, config.sessionIdleMs);
    // Don't let the idle timer keep the process alive on its own.
    session.idleTimer.unref?.();
  }

  /** Close a live session's browser. On-disk login state is preserved. */
  async close(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    if (session.idleTimer) clearTimeout(session.idleTimer);
    this.sessions.delete(id);
    try {
      await session.context.close();
    } catch {
      // Best-effort: context may already be gone.
    }
  }

  /** List ids of currently-live (in-memory) sessions. */
  liveIds(): string[] {
    return [...this.sessions.keys()];
  }

  /**
   * Permanently delete a session: close its browser AND remove its on-disk
   * profile, so it is fully logged out and starts fresh next time.
   */
  async destroy(id: string): Promise<void> {
    assertSafeId(id);
    await this.close(id);
    await rm(this.profileDir(id), { recursive: true, force: true });
  }

  /** Close every live browser context (used on graceful shutdown). */
  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.close(id)));
  }
}

export const sessions = new SessionManager();
