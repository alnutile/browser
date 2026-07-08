# browser-api

<img width="2528" height="1236" alt="browser" src="https://github.com/user-attachments/assets/019d6be3-922b-4d38-aaab-7e0217f5ae07" />

> Read the post on [Substack](https://open.substack.com/pub/dailyaistudio/p/make-your-own-headless-browser-and?r=5v05x9&utm_campaign=post&utm_medium=web&showWelcomeOnShare=true)

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
- **Natural-language tasks.** POST a plain-English prompt ("go to this site and
  collect every product name and price, paginating through all pages") and
  Claude drives the browser with these same actions until it's done. See
  [Just send a prompt](#just-send-a-prompt).
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

## Use it from Claude Desktop (MCP)

Want to drive this from Claude Desktop instead of raw HTTP? [`mcp/`](./mcp) is a
local MCP server that exposes these endpoints as tools (navigate, click, read a
page as Markdown, screenshot, run a natural-language task). Point it at your
Railway URL + token and Claude can browse for you. See [mcp/README.md](./mcp/README.md).

---

## API

All routes except `/health` require `Authorization: Bearer $API_TOKEN`.

| Method & path | Purpose |
| --- | --- |
| `GET  /health` | Liveness probe (unauthenticated). |
| `GET  /sessions` | List currently live (in-memory) sessions. |
| `POST /sessions/:id/actions` | **Run a batch of actions in order** (the main endpoint). |
| `POST /sessions/:id/prompt` | **Give it a plain-English task** and Claude drives the browser until it's done. Needs `ANTHROPIC_API_KEY`. |
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

### Just send a prompt

The batch endpoint above needs you to know the selectors and steps in advance.
`POST /sessions/:id/prompt` doesn't: you send a **plain-English task** and Claude
drives the browser for you — deciding which pages to open, what to click, how to
extract, and when it's done. Under the hood it's an agentic loop where Claude
calls the same browser actions (`goto`, `click`, `evaluate`, `markdown`,
screenshots, …) until the task is complete, then returns its answer.

This is the *"go to this site and get this data after paginating all pages"*
endpoint:

```bash
curl -s -X POST "$BASE_URL/sessions/scrape/prompt" \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "prompt": "Go to https://example.com/products and collect every product name and price. Page through all the pages until there are no more, and return the full list as JSON."
  }'
```

Returns the model's final answer plus a log of what it did:

```json
{
  "ok": true,
  "result": "{ \"products\": [ { \"name\": \"...\", \"price\": \"...\" }, ... ] }",
  "steps": 12,
  "stopReason": "end_turn",
  "transcript": [
    { "step": 1, "tool": "goto", "input": { "url": "https://example.com/products" }, "ok": true, "preview": "{\"status\":200,...}" },
    { "step": 2, "tool": "evaluate", "input": { "script": "return [...].map(...)" }, "ok": true, "preview": "{\"result\":[...]}" },
    { "step": 3, "tool": "click", "input": { "selector": "a.next" }, "ok": true, "preview": "{\"ok\":true}" }
  ]
}
```

- `result` is the deliverable — Claude's final message, which contains the data
  it was asked for (ask for JSON if you want to parse it).
- `transcript` is the ordered list of browser actions it took (with short result
  previews), so you can see how it got there.
- `steps` is how many model turns it used; `stopReason` is `end_turn` when it
  finished, `max_steps` if it hit the cap, or `refusal` if it declined.

Body fields: `prompt` (required) and optional `maxSteps` (override the per-call
step cap for this request).

Because it runs against a **named session**, it reuses that session's login and
current page — so you can log in once (via the batch endpoint), then hand Claude
authenticated tasks against the same session id.

**Setup:** this endpoint needs an `ANTHROPIC_API_KEY` set in the service
Variables (get one at [console.anthropic.com](https://console.anthropic.com/settings/keys)).
Without it, `/prompt` returns `503`; every other route keeps working. The model
(`claude-opus-4-8` by default), reasoning effort, step cap, and token limits are
all configurable — see the [Configuration reference](#configuration-reference).

> **Note:** the model can navigate to any URL and run arbitrary in-page
> JavaScript to accomplish the task — that's the point — so only give it prompts
> you'd be comfortable running yourself, and keep the service token-protected.

#### Integration contract (hand this to the calling tool/agent)

Everything another program — or an AI that's wired this up as a tool — needs to
call `/prompt` correctly. This is the whole interface; there is nothing else to
know.

**Request**

```
POST {BASE_URL}/sessions/{session_id}/prompt
Authorization: Bearer {API_TOKEN}
Content-Type: application/json

{
  "prompt": "<the task, in plain English>",   // required, non-empty string
  "maxSteps": 40                               // optional int, 1–200; caps agent<->browser round trips
}
```

- `session_id` — any name you choose, `1–64` chars of `[a-zA-Z0-9_-]`. **Reusing
  the same name reuses the same browser + login.** Use a fresh name for an
  isolated, logged-out browser; reuse a name to continue where a prior call (or a
  prior batch login) left off. It does **not** need to be created ahead of time.
- `API_TOKEN` — the service's bearer token (this is *not* the Anthropic key).

**Response** — always JSON:

```jsonc
{
  "ok": true,                 // true = task finished; false = it stopped early (see stopReason/error)
  "result": "…",              // STRING: the agent's final answer — the deliverable
  "steps": 12,                // how many model turns it took
  "stopReason": "end_turn",   // "end_turn" | "max_steps" | "refusal"
  "transcript": [             // ordered log of the browser actions it took
    { "step": 1, "tool": "goto", "input": { "url": "…" }, "ok": true, "preview": "…" }
  ],
  "error": "…"                // present only when ok=false
}
```

- **`result` is always a string.** If you want structured data back, *ask for
  JSON in the prompt* ("…return the result as a JSON array of {name, price}") and
  then `JSON.parse` `result` yourself. The service does not parse it for you.
- **`stopReason`**: `end_turn` = the agent decided it was done (normal success).
  `max_steps` = it hit the step cap before finishing (`ok:false`; raise
  `maxSteps` or narrow the task). `refusal` = the model declined the task
  (`ok:false`).

**HTTP status codes**

| Code | Meaning | What to do |
| --- | --- | --- |
| `200` | Task finished (`ok:true`). | Use `result`. |
| `422` | Agent stopped early (`ok:false`, e.g. `max_steps` / `refusal`). | Read `error`; retry with a higher `maxSteps` or a clearer prompt. |
| `400` | `prompt` missing/empty. | Fix the body. |
| `401` | Bad/missing bearer token. | Fix `Authorization`. |
| `503` | `ANTHROPIC_API_KEY` not configured on the server. | Server-side setup; the caller can't fix it. |
| `502` | Upstream model call failed. | Transient — retry with backoff. |

**Timeouts** — a single call runs multiple model turns plus real page loads, so
it can take **tens of seconds to a few minutes**. Set the client/tool HTTP
timeout generously (e.g. 300s) and treat it as a long-running call, not a quick
fetch.

**Writing good prompts for it** — it behaves like a capable operator who can see
and act on the page but can't read your mind:

- State the **goal and the exact data** you want, and the **output shape**
  ("return JSON: `[{title, url, price}]`").
- Say **where to start** — include the URL, or rely on the session already being
  on the right page.
- For multi-page jobs, say **"page through all pages until there are none left"**
  so it knows to paginate rather than stop at page one.
- Give **stop conditions** for open-ended tasks ("stop after 200 items" / "only
  the first 5 pages") to bound cost and avoid hitting `max_steps`.
- It's fine to describe **interactions** ("dismiss the cookie banner if present,
  then …", "log in with the form if you see one") — it will figure out selectors.

**Minimal example a tool would issue**

```bash
curl -sS --max-time 300 -X POST "$BASE_URL/sessions/my-agent/prompt" \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"prompt":"Go to https://news.ycombinator.com and return the titles and links of the top 10 stories as a JSON array of {title, url}."}'
```

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
| `ANTHROPIC_API_KEY` | — | Enables `POST /sessions/:id/prompt`. Without it that route returns `503`; all others work. |
| `ANTHROPIC_MODEL` | `claude-opus-4-8` | Model the `/prompt` agent uses. |
| `AGENT_EFFORT` | `high` | Reasoning effort for the agent: `low`, `medium`, `high`, `xhigh`, `max`. |
| `AGENT_MAX_STEPS` | `40` | Max agent↔browser round trips per `/prompt` call (runaway-loop guard). |
| `AGENT_MAX_TOKENS` | `16000` | Max output tokens per model turn in the agent loop. |
| `AGENT_MAX_TOOL_RESULT_CHARS` | `20000` | Truncate a single tool result before feeding it back, so big page dumps don't blow up context/cost. |

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
