/**
 * Example: how another service calls the browser API.
 *
 *   BASE_URL=https://your-app.up.railway.app API_TOKEN=... node examples/client.mjs
 *
 * Shows the two-phase pattern: log in once, then reuse the same logged-in
 * session for later work — even across redeploys.
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const API_TOKEN = process.env.API_TOKEN ?? "change-me";
const SESSION = process.env.SESSION ?? "example-bot";

async function call(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

// A batch of actions runs in order server-side and returns one result each.
const result = await call(`/sessions/${SESSION}/actions`, {
  actions: [
    { type: "goto", url: "https://example.com" },
    { type: "evaluate", script: "return document.title" },
    // ...swap in real login steps here (fill / click / waitForSelector)...
  ],
});

console.log(JSON.stringify(result, null, 2));
