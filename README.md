# browser-api

<img width="2528" height="1236" alt="browser" src="https://github.com/user-attachments/assets/019d6be3-922b-4d38-aaab-7e0217f5ae07" />


A **headless browser you drive over HTTP**, built to run on Railway.

Other services POST commands to it — "go to this URL", "click this", "run this
JavaScript", "give me this page as Markdown" — and it drives a real Chromium (via
[Playwright](https://playwright.dev)). Browsers stay warm between requests, and
**login sessions persist across redeploys**, so you can log in once and reuse
that authenticated session from anywhere.

This answers the question: *"Can I run a headless browser on Railway with an API,
that saves its session so it stays logged in, and call it from other services for
complex JS interactions?"* — **yes.** This repo is a working implementation.

## Features

- **Rendered-page → Markdown.** Get any JavaScript-heavy page as clean,
  LLM-ready Markdown — reader-mode extraction (drops nav/ads/footers) plus
  GitHub-flavored tables and lists. See [Get a page as Markdown](#get-a-page-as-markdown).
- **Persistent logins.** Named sessions keep cookies/`localStorage` on a Railway
  Volume, so an authenticated session survives redeploys.
- **Full browser control.** `goto`, `click`, `fill`, `type`, `waitForSelector`,
  screenshots, and arbitrary in-page JS via `evaluate`.
- **Batch actions.** Send a whole "go here → do this → read that" sequence in one
  request.
- **Token-protected.** Bearer auth on every route, so it's not an open proxy.

### Grab a JS page as Markdown in one call

```bash
curl -s -X POST "$BASE_URL/sessions/scrape/actions" \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{ "actions": [
    { "type": "goto", "url": "https://example.com/article", "waitUntil": "networkidle" },
    { "type": "markdown" }
  ] }'
```

---

## How it works

```
   your other service                    this service (on Railway)
   ┌────────────────┐   HTTP + Bearer    ┌──────────────────────────┐
   │  worker / app  │ ─────────────────► │  Fastify API             │
   └────────────────┘                    │      │                   │
                                         │      ▼                   │
                                         │  Playwright → Chromium   │
                                         │      │                   │
                                         │      ▼                   │
                                         │  persistent profile ─────┼──► Railway Volume
                                         │  (cookies, localStorage) │    (survives redeploys)
                                         └──────────────────────────┘
```

- **Sessions** are named browser profiles. Reusing a name (`/sessions/my-bot/...`)
  reuses the same logged-in browser. Each profile is stored on disk via
  Playwright's `launchPersistentContext`, so cookies, `localStorage`,
  `IndexedDB` and the rest of the Chrome profile survive.
- The profile lives under `DATA_DIR`, which you point at a **mounted Railway
  Volume**. Railway's normal container filesystem is wiped on every redeploy —
  the Volume is what keeps you logged in.
- On shutdown (redeploy = `SIGTERM`) the service closes the browser cleanly so
  Chromium flushes the profile to the Volume first. (Playwright's own
  force-kill signal handlers are disabled for exactly this reason — see
  `src/sessionManager.ts`.)
- Every request needs `Authorization: Bearer $API_TOKEN`, so it isn't an open
  browser proxy on the public internet.

---

## API

All routes except `/health` require `Authorization: Bearer $API_TOKEN`.

| Method & path | Purpose |
| --- | --- |
| `GET  /health` | Liveness probe (unauthenticated). |
| `GET  /sessions` | List currently live (in-memory) sessions. |
| `POST /sessions/:id/actions` | **Run a batch of actions in order** (the main endpoint). |
| `POST /sessions/:id/goto` | `{ "url": "...", "waitUntil": "load" }` |
| `POST /sessions/:id/click` | `{ "selector": "..." }` |
| `POST /sessions/:id/fill` | `{ "selector": "...", "text": "..." }` (sets value directly) |
| `POST /sessions/:id/type` | `{ "selector": "...", "text": "..." }` (realistic keystrokes) |
| `POST /sessions/:id/evaluate` | `{ "script": "return document.title" }` — arbitrary JS |
| `GET  /sessions/:id/content` | Current page HTML. |
| `GET  /sessions/:id/markdown` | Rendered page as **Markdown** (`?readability=false`, `?selector=...`). |
| `GET  /sessions/:id/screenshot` | PNG image (`?fullPage=true` for the whole page). |
| `POST /sessions/:id/close` | Close the live browser but **keep** the login on disk. |
| `DELETE /sessions/:id` | Destroy the session and **delete** its profile (full logout). |

### The batch endpoint

`POST /sessions/:id/actions` takes `{ "actions": [ ... ] }` and runs them in
order, returning one result per action. It stops at the first failure and tells
you which step failed. Supported action `type`s:

`goto`, `click`, `fill`, `type`, `press`, `waitForSelector`, `waitForTimeout`,
`evaluate`, `screenshot`, `content`, `markdown`, `url`.

```bash
curl -X POST https://YOUR-APP.up.railway.app/sessions/my-bot/actions \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "actions": [
      { "type": "goto", "url": "https://example.com/login" },
      { "type": "fill", "selector": "#email", "text": "me@example.com" },
      { "type": "fill", "selector": "#password", "text": "hunter2" },
      { "type": "click", "selector": "button[type=submit]" },
      { "type": "waitForSelector", "selector": ".dashboard" },
      { "type": "evaluate", "script": "return document.querySelector(\".user-name\").innerText" }
    ]
  }'
```

After this runs once, the `my-bot` session is logged in. Later calls with the
same session id skip the login and go straight to work — even after a redeploy.

The `evaluate` action is the escape hatch for **complex JS interactions**: the
`script` is a function body, so use `return` to send a value back, and you can
`await` inside it.

### Get a page as Markdown

Because pages are JavaScript-rendered, `markdown` converts the *live, rendered
DOM* — not the empty shell a plain `curl` gets. By default it runs
[Readability](https://github.com/mozilla/readability) (reader-mode extraction)
to keep the main article and drop nav/sidebars/footers/ads, then converts to
GitHub-flavored Markdown (tables, lists, links, code). Ideal for feeding pages
to an LLM.

```bash
# Quick one-shot: fetch a JS page and get clean Markdown back
curl -s -X POST "$BASE_URL/sessions/scrape/actions" \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "actions": [
      { "type": "goto", "url": "https://example.com/article", "waitUntil": "networkidle" },
      { "type": "markdown" }
    ]
  }'
```

Returns:

```json
{ "ok": true, "results": [
  { "status": 200, "url": "https://example.com/article" },
  { "markdown": "## Heading\n\nBody text...", "title": "Article Title",
    "byline": "Jane Doe", "extractedWith": "readability" }
]}
```

Or use the convenience endpoint on the current page:

```bash
curl -s "$BASE_URL/sessions/scrape/markdown" -H "Authorization: Bearer $API_TOKEN"
```

Options (on the action, or as query params on the GET endpoint):
- `readability: false` — convert the whole `<body>` instead of the main article.
- `selector: ".content"` — convert only that element's HTML.

`extractedWith` in the response tells you which path produced the output
(`readability`, `selector`, or `body` — it falls back to `body` when Readability
can't identify an article, or if a strict CSP with `BYPASS_CSP=false` prevents
injecting the extractor).

---

## Deploy to Railway

1. **Create a service** from this repo. Railway detects `railway.json` and builds
   the `Dockerfile` (the Playwright base image ships Chromium + all system libs).
2. **Add a Volume** to the service and set its mount path to `/data`.
3. **Set variables** (Service → Variables):
   - `API_TOKEN` — required. Generate one: `openssl rand -hex 32`.
   - `DATA_DIR=/data` — must match the Volume mount path.
   - Optional: `HEADLESS`, `SESSION_IDLE_MS`, `DEFAULT_TIMEOUT_MS`, `MAX_SESSIONS`.
4. Deploy. Health check is `GET /health`. Your API is at the service's public URL.

`PORT` is injected by Railway automatically — don't set it.

> **Scaling note:** because logins live on a Volume and Volumes attach to a
> single instance, run this as **one replica**. If you need more throughput,
> raise `MAX_SESSIONS` and the instance's memory rather than adding replicas.

---

## Local development

```bash
cp .env.example .env        # then edit API_TOKEN
npm install
npx playwright install chromium   # first time only, for local runs
npm run dev                 # watches src/, restarts on change
```

Then hit `http://localhost:3000` with the same `curl` calls (using your local
`API_TOKEN`). Set `HEADLESS=false` in `.env` to watch the browser while you
debug. To run against a system-provided Chromium instead of the bundled one, set
`CHROMIUM_EXECUTABLE_PATH` to its binary.

---

## Configuration reference

| Variable | Default | Meaning |
| --- | --- | --- |
| `API_TOKEN` | — (required) | Bearer token every caller must send. |
| `DATA_DIR` | `/data` | Where profiles + sessions are stored. Point at a Volume. |
| `HEADLESS` | `true` | Run Chromium headless. `false` for local debugging. |
| `PORT` | `3000` | HTTP port. Railway injects this. |
| `SESSION_IDLE_MS` | `600000` | Idle time before a live browser is closed (profile kept). |
| `DEFAULT_TIMEOUT_MS` | `30000` | Default per-action timeout. |
| `MAX_SESSIONS` | `5` | Max concurrent live browsers (memory guard). |
| `BYPASS_CSP` | `true` | Bypass page Content Security Policy so `markdown` can inject Readability on CSP-strict sites (GitHub, etc.). |
| `CHROMIUM_EXECUTABLE_PATH` | — | Optional path to a specific Chromium binary. |
| `LOG_LEVEL` | `info` | Pino log level. |

---

## Alternatives worth knowing

This repo is the **self-hosted, full-control** option. If you'd rather not own
the browser layer:

- **`browserless/chromium`** — a prebuilt Docker image with a REST + WebSocket
  API; deploy it directly on Railway. Less custom code, less control.
- **Managed** (Browserbase, Steel, Browserless cloud) — point an API at their
  hosted browsers and skip hosting entirely. Higher cost, near-zero ops.

The persistence approach here (persistent profile on a Volume + clean shutdown)
is the part most worth keeping regardless of which browser layer you choose.
