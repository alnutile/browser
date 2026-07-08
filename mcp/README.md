# browser-api-mcp

A small **MCP server you run on your own machine** that connects Claude Desktop
(or any MCP client) to your [`browser-api`](../README.md) service on Railway.

It turns the service's HTTP endpoints into MCP tools, so from Claude Desktop you
can say *"open this page and give me the article as Markdown"* or *"screenshot
this site"* and Claude drives your real headless browser on Railway.

```
Claude Desktop ──stdio──▶ browser-api-mcp (local) ──HTTPS + Bearer──▶ browser-api (Railway) ──▶ Chromium
```

## Prerequisites

- Your `browser-api` service deployed and reachable (its public Railway URL).
- Its `API_TOKEN`.
- Node.js 20+ locally.
- Claude Desktop (or another MCP client).

## Install & build

```bash
cd mcp
npm install
npm run build      # compiles to dist/index.js
```

## Configure Claude Desktop

Open Claude Desktop's config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add a server entry pointing at the built file (use the **absolute** path):

```json
{
  "mcpServers": {
    "browser": {
      "command": "node",
      "args": ["/absolute/path/to/browser/mcp/dist/index.js"],
      "env": {
        "BROWSER_API_URL": "https://your-app.up.railway.app",
        "BROWSER_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

Restart Claude Desktop. You should see the **browser** tools appear (the 🔌/hammer
icon). That's it — ask Claude to open a page, read it as Markdown, or screenshot it.

### Optional: run via `npx` instead of a local path

If you publish this package to npm (`npm publish`, after picking a unique name),
you can skip the build and point Claude Desktop at `npx`:

```json
{
  "mcpServers": {
    "browser": {
      "command": "npx",
      "args": ["-y", "browser-api-mcp"],
      "env": {
        "BROWSER_API_URL": "https://your-app.up.railway.app",
        "BROWSER_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

## Configuration (env vars)

| Var | Required | Meaning |
| --- | --- | --- |
| `BROWSER_API_URL` | yes | Base URL of your Railway service, e.g. `https://your-app.up.railway.app`. |
| `BROWSER_API_TOKEN` | yes | The service's `API_TOKEN` (sent as `Authorization: Bearer …`). |
| `BROWSER_DEFAULT_SESSION` | no | Session name used when a tool call omits one (default `default`). |

Reusing a session name reuses the same logged-in browser profile, so a login you
do once persists across calls (and across Railway redeploys).

## Tools

| Tool | What it does |
| --- | --- |
| `browser_goto` | Navigate a session to a URL (`waitUntil` for JS-heavy pages). |
| `browser_click` | Click a CSS selector. |
| `browser_type` | Type text with realistic keystrokes. |
| `browser_fill` | Set an input's value directly. |
| `browser_evaluate` | Run JS in the page and return the result. |
| `browser_get_markdown` | Current page as clean Markdown (reader-mode by default). |
| `browser_get_html` | Current page's rendered HTML. |
| `browser_screenshot` | PNG screenshot, returned as an image (`fullPage` optional). |
| `browser_run_actions` | Run a batch of actions in order (login flows, multi-step). |
| `browser_prompt` | Hand a plain-English task to the service's Claude agent (needs `ANTHROPIC_API_KEY` on the service). |
| `browser_list_sessions` | List live sessions. |
| `browser_close_session` | Close the browser but keep the login on disk. |
| `browser_end_session` | Destroy a session and delete its profile (full logout). |

## Develop

```bash
npm run dev        # tsx watch, no build step
npm run typecheck
```

Logs go to **stderr** (stdout is the MCP protocol channel), so you'll see
`[browser-api-mcp] connected → …` when it starts.

## Troubleshooting

- **Tools don't appear in Claude Desktop:** check the config path is right, the
  `args` path is absolute and points at `dist/index.js`, and that you ran
  `npm run build`. Then fully quit and reopen Claude Desktop.
- **`401` errors:** `BROWSER_API_TOKEN` doesn't match the service's `API_TOKEN`.
- **`fetch failed` / connection refused:** `BROWSER_API_URL` is wrong or the
  service is asleep/down. Hit `GET $BROWSER_API_URL/health` in a browser.
- **`browser_prompt` returns 503:** the service doesn't have `ANTHROPIC_API_KEY`
  set — add it to the Railway service Variables (only this tool needs it).
