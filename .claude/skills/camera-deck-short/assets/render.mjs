// Camera Deck — builder.
//   node render.mjs <content.mjs> [--shot shot.png] [--out short.html]
//
// Reads a content module (exports { title, scenes }), pre-renders every scene's
// notes, inlines an optional screenshot, and writes a single self-contained
// deck HTML using assets/engine.html.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderNotes } from "./helpers.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

// ---- args -----------------------------------------------------------------
const argv = process.argv.slice(2);
const contentArg = argv.find(a => !a.startsWith("--"));
if (!contentArg) { console.error("usage: node render.mjs <content.mjs> [--shot shot.png] [--out short.html]"); process.exit(1); }
function opt(name){ const idx = argv.indexOf(name); return idx >= 0 ? argv[idx+1] : undefined; }

const contentPath = path.resolve(contentArg);
const contentDir = path.dirname(contentPath);
const shotPath = opt("--shot") ? path.resolve(opt("--shot")) : path.join(contentDir, "shot.png");
const outPath = opt("--out") ? path.resolve(opt("--out")) : path.join(contentDir, "short.html");

// ---- load content ---------------------------------------------------------
const mod = await import(pathToFileURL(contentPath).href);
const title = mod.title || "Camera Deck · short";
const scenes = mod.scenes || mod.default;
if (!Array.isArray(scenes) || !scenes.length) { console.error("content must export a non-empty `scenes` array"); process.exit(1); }

// ---- pre-render scenes to pure data --------------------------------------
const data = scenes.map((s, k) => {
  if (typeof s.dur !== "number") throw new Error(`scene ${k} missing numeric dur`);
  if (typeof s.frame !== "string") throw new Error(`scene ${k} missing frame string`);
  const notes = { ...(s.notes || {}) };
  if (!notes.c) notes.c = `${k+1} / ${scenes.length}`;     // auto slide counter
  return {
    dur: s.dur,
    res: s.res || "1080 × 1920 · 9:16",
    frame: s.frame,
    notes: renderNotes(notes, s.dur),
  };
});

// ---- screenshot -----------------------------------------------------------
let shotUri;
if (existsSync(shotPath)) {
  shotUri = "data:image/png;base64," + readFileSync(shotPath).toString("base64");
} else {
  // graceful placeholder so a deck always builds without a real capture
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='1280' height='800'>`+
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>`+
    `<stop offset='0' stop-color='#E0795A'/><stop offset='1' stop-color='#897CF0'/></linearGradient></defs>`+
    `<rect width='1280' height='800' fill='#0F0D0A'/><rect x='0' y='0' width='1280' height='420' fill='url(%23g)' opacity='0.85'/>`+
    `<text x='64' y='540' fill='#F4F0E6' font-family='monospace' font-size='34'>screenshot goes here</text></svg>`;
  shotUri = "data:image/svg+xml;utf8," + svg;
}

// ---- assemble -------------------------------------------------------------
let html = readFileSync(path.join(here, "engine.html"), "utf8");
html = html
  .replace(/__TITLE__/g, title)
  .replace("__SCENES_JSON__", JSON.stringify(data))
  .replace("__STATIC_FRAME0__", data[0].frame)
  .replace("__STATIC_NOTES0__", data[0].notes)
  .replace(/__SHOT__/g, shotUri);

writeFileSync(outPath, html);
const total = data.reduce((a,s)=>a+s.dur,0);
console.log(`wrote ${outPath}`);
console.log(`  ${data.length} scenes · ${Math.floor(total/60)}:${('0'+(total%60)).slice(-2)} total · shot ${existsSync(shotPath) ? "inlined" : "placeholder"}`);
