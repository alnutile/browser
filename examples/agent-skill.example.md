# Example agent skill — let an AI drive this browser API

A copy-and-adapt "skill" (tool instruction) you can paste into an AI agent's
system prompt or skill config so it uses this service to fetch and act on **live**
web pages. It covers both ways to call the service:

- **`/actions`** — scripted steps when you know what to do (great for "just read
  this page": the `markdown` action returns clean, reader-mode markdown so the
  agent doesn't convert HTML by hand).
- **`/prompt`** — a plain-English task when the steps aren't known up front
  (navigation, forms, "get every X", **paginate all pages**). Requires the
  server to have `ANTHROPIC_API_KEY` set.

Replace the two placeholders and paste the block below into your agent:

- `{{BASE_URL}}` — your deployed service, e.g. `https://your-app.up.railway.app`
- `{{API_TOKEN}}` — the service's bearer token (the `API_TOKEN` env var)

---

```text
When the user asks for the content or data of a specific URL or website (fetch,
scrape, extract, "get data from <url>", summarize a page), ALWAYS fetch the live
page — never answer from memory. This browser service renders JavaScript-heavy
pages, unlike a plain HTTP GET.

Base URL: {{BASE_URL}}
Every request needs the header: Authorization: Bearer {{API_TOKEN}}
Pick a <session> name (e.g. "scrape"); reusing the same name reuses the same
browser + any login it has. Sessions are created on first use — no setup needed.

Choose the endpoint by how well-defined the task is:

1) Read a known page → POST /sessions/<session>/actions
   Use the `markdown` action; the service extracts the main content and returns
   clean markdown, so you do NOT convert HTML yourself.
   Body:
   {"actions": [
     {"type": "goto", "url": "<the url>", "waitUntil": "networkidle"},
     {"type": "markdown"}
   ]}
   (Use {"type": "content"} instead only if you specifically need raw HTML.)
   Example — read the Hacker News front page:
   {"actions": [
     {"type": "goto", "url": "https://news.ycombinator.com", "waitUntil": "networkidle"},
     {"type": "markdown"}
   ]}
   Response: {"ok": true, "results": [ ... ]} — the markdown is in the last result.

2) Multi-step task, or data spread across pages (log in, click through, "get
   every X", paginate all pages) → POST /sessions/<session>/prompt
   Describe the goal in plain English and let the agent drive the browser.
   Body:
   {"prompt": "Go to <url> and collect <the exact data>. Page through all pages
   until there are none left. Return the result as JSON: [{...}]."}
   Example — top stories from Hacker News as structured data:
   {"prompt": "Go to https://news.ycombinator.com and return the title and link
   of the top 10 stories as a JSON array of {title, url}."}
   Response: {"ok", "result", "steps", "stopReason", "transcript"}.
   - `result` is ALWAYS a string. To get structured data, ask for JSON in the
     prompt and JSON.parse `result` yourself.
   - `stopReason` is "end_turn" on success, "max_steps" if it ran out of steps
     (retry with {"maxSteps": 80} or a narrower task), "refusal" if declined.
   - These calls run many steps + real page loads — set an HTTP timeout of ~300s.

Rules of thumb:
- Prefer this service over web search whenever an exact URL is given.
- One call per URL for multiple URLs.
- For open-ended tasks, give a stop condition ("first 5 pages", "stop after 200
  items") to bound cost and avoid hitting the step limit.
- If the user asks to save the result, put the markdown/JSON in an artifact/file.
```

---

## Why `markdown` beats fetching raw HTML

The `markdown` action runs Mozilla Readability on the **live, rendered DOM**
inside the browser (dropping nav/ads/footers) and returns GitHub-flavored
markdown. That's cleaner and cheaper for an LLM than pulling full HTML and
converting it yourself. Options: `{"type": "markdown", "readability": false}`
converts the whole page; `{"type": "markdown", "selector": ".article"}` converts
just one element.

## When to reach for `/prompt` instead

Use `/actions` when you can express the job as a fixed list of steps. Reach for
`/prompt` when you can't — the classic case being *"go to this site and get this
data after paginating through all the pages"*, where the number of pages and the
"next" selector aren't known in advance. `/prompt` figures those out at runtime.
See the main [README](../README.md#just-send-a-prompt) for the full contract.
