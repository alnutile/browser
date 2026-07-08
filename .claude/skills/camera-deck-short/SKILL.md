---
name: camera-deck-short
description: >-
  Produce a 9:16 vertical "short" as a self-playing HTML deck in the Camera Deck
  System style (Bricolage Grotesque / Hanken Grotesk / JetBrains Mono; coral
  #E0795A + purple #897CF0 on warm-black #181511; a recorded frame beside an
  off-frame teleprompter with a live per-slide countdown). Use whenever the user
  asks to make / create / build a "short", reel, vertical video, or teleprompter
  deck. The user supplies ONLY the content (message, steps, beats); this skill
  supplies all style, layout, components, and the player — never ask the user for
  design files, colors, fonts, or HTML.
---

# Camera Deck — 9:16 short

Turn content into a finished 9:16 short deck. The look is fixed and lives in
this skill; the only thing that changes per short is a content file.

## What it produces

A single self-contained `short.html`:
- **Recorded 9:16 frame** (1080×1920) with REC badge + resolution tag.
- **Off-frame teleprompter** notes panel with a big "NOW" beat, bullets, and a
  live **"Next in" countdown** (+ shrinking bar) for the current slide.
- **Playback**: `space` play/pause, `←/→` scenes, **`R` record-mode** (clean
  1080×1920 only, for screen capture), `F` fullscreen. Scene durations sum to
  the target length (default ~2:00).

## Workflow

1. **Get the content.** The user gives the message/steps. Map it to scenes —
   one idea per scene. For each scene decide: kicker (mono label), headline
   (short, Bricolage), optional supporting visual (code block, feature list,
   panel, screenshot), a duration in seconds, and the teleprompter note (one
   "now" beat + 1–2 bullets). If the user didn't specify length, target ~120s
   total and split proportionally. Ask only about content gaps, never style.

2. **Write a content module.** Copy `assets/content.example.mjs` to a working
   `content.mjs` and replace the scenes. Import helpers from
   `assets/helpers.mjs`. Schema per scene:
   ```js
   { dur: 20,                 // seconds on screen (also seeds the countdown)
     res: "head off · full-bleed",   // optional top-right tag; default "1080 × 1920 · 9:16"
     frame: "<...raw HTML...>",       // the recorded-frame content (use classes + helpers)
     notes: { now:"the beat", beats:["bullet","bullet"] } }  // c/counter auto-fills
   ```
   Layout convention: **split** scenes (content top, webcam bottom) end their
   `frame` with `talkingHead()`; **full-bleed** scenes wrap content in
   `<div class="full">…</div>` and add `pip()` for the corner head bubble.
   See `assets/STYLE.md` for the full class + helper reference and palette.

3. **Screenshots (optional).** If a scene shows a captured web page, use the
   `shot("__SHOT__", "https://the.url")` helper in the frame and provide a
   `shot.png` next to the content file — the builder inlines it. To capture one
   live, drive a browser (e.g. the browser-api service) and save its
   `/screenshot` PNG as `shot.png`. With no `shot.png`, a gradient placeholder
   is used so the deck still builds.

4. **Build.**
   ```bash
   node <path-to-skill>/assets/render.mjs ./content.mjs --shot ./shot.png --out ./short.html
   ```
   It pre-renders every scene (so the output needs no build-time helpers),
   inlines the screenshot, bakes scene 1 into static HTML (shows even where
   inline scripts are blocked), and writes a self-contained file.

5. **Verify** before delivering. Open `short.html` headless, confirm no page
   errors, that the countdown ticks down during playback, and screenshot scene 1
   (teleprompter) + record-mode to eyeball the layout. Example:
   ```bash
   node -e 'const{chromium}=require("playwright");(async()=>{const b=await chromium.launch({headless:true,args:["--no-sandbox"]});const p=await(await b.newContext({viewport:{width:1440,height:900}})).newPage();const e=[];p.on("pageerror",x=>e.push(""+x));await p.goto("file://"+process.cwd()+"/short.html");await p.waitForTimeout(700);await p.keyboard.press(" ");await p.waitForTimeout(2500);console.log("errors:",e.length?e:"none","cd:",await p.$eval("#cd",n=>n.textContent));await p.screenshot({path:"verify.png"});await b.close();})()'
   ```

6. **Deliver** `short.html` (and keep `content.mjs` + `shot.png` so the short can
   be iterated later — this skill is meant to be built on).

## Rules

- Keep the design fixed: do not change fonts, palette, component CSS, or the
  frame geometry. Style consistency across shorts is the whole point.
- Headlines are short (2–4 lines). One coral accent per headline max. Bodies use
  `.sub`. Labels are uppercase mono (`.kicker`).
- Never ask the user for style, colors, fonts, images, or HTML — only content.
- Default target length ~2:00; honor an explicit length if given.
