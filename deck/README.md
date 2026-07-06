# 2-minute short · Camera Deck System

A self-playing 9:16 deck for the promo short, built in the **Camera Deck System**
design (coral/purple on warm-black, Bricolage Grotesque / Hanken Grotesk /
JetBrains Mono). `short.html` is fully self-contained — open it in any browser.

## The short (≈2:00)

| # | Scene | Beat |
|---|---|---|
| 1 | Hook | "Give your agent a real browser." |
| 2 | Open source | The repo + README features |
| 3 | Deploy | Live on Railway in minutes, env vars already there |
| 4 | Security | One bearer token locks it down |
| 5 | Use it | A **real screenshot the API captured** (`shot.png`, inlined) |
| 6 | Outro | `github.com/alnutile/browser` · Star · Fork · Deploy |

## Two modes

- **Teleprompter** (default): the recorded 9:16 frame *plus* the off-frame notes
  panel — read the "NOW" beat while looking down the lens.
- **Record** (press `R`): just the clean `1080×1920` frame, for screen capture.
  The bottom "talking head" zone is where you composite your webcam.

## Keys

`space` play/pause · `←` `→` scenes · `R` record-mode · `F` fullscreen

## Recording it

1. Open `short.html`, press `F` for fullscreen, `R` for record-mode.
2. Screen-record the frame (OBS window crop, or QuickTime) at 9:16.
3. Composite your webcam into the talking-head area, or drop it as the corner
   bubble on full-bleed scenes.
4. Narrate from the teleprompter notes (keep a second screen in teleprompter
   mode).

## Swapping the demo screenshot

Scene 5 embeds `shot.png` — a real capture taken through the API itself. To use
your own:

```bash
# capture any page via your deployed service
curl -s "$BASE_URL/sessions/demo/screenshot" -H "Authorization: Bearer $API_TOKEN" \
  --output deck/shot.png
node deck/build.mjs   # re-inlines it into short.html
```

`build.mjs` reads `short.template.html` + `shot.png` and writes the
self-contained `short.html`.
