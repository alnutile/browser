# Camera Deck — design spec (self-contained reference)

Everything needed to reproduce the style without any external files. The engine
(`engine.html`) already implements all of this; content just uses the classes
and helpers below.

## Fonts
- **Bricolage Grotesque** (800/700) — display headlines (`.frame h1`, `.now .t`)
- **Hanken Grotesk** (400–700) — body copy & teleprompter beats (`.sub`, `.beat`)
- **JetBrains Mono** (400–600) — labels, counters, code (`.kicker`, `.code`, `.res`)

## Palette (CSS vars)
| var | hex | use |
|---|---|---|
| `--bg` | `#181511` | recorded frame background |
| `--notes-bg` | `#14110D` | teleprompter panel |
| `--code-bg` | `#0F0D0A` | code blocks |
| `--cream` | `#F4F0E6` | primary text |
| `--body` / `--body2` | `#C9C2B4` / `#A39C8D` | body copy |
| `--muted` / `--muted2` | `#9C9484` / `#6E675A` | labels, captions |
| `--coral` | `#E0795A` | **primary accent** (REC, kicker, "now", countdown) |
| `--purple` | `#897CF0` | secondary accent (bullets, split marker) |
| `--green` | `#7BB58A` | success / terminal `$` |
| `--gold` | `#D9C46A` | tertiary; countdown "low" state |
| `--card` / `--card2` | `#221E17` / `#2C2820` | panels |
| `--hair` | `rgba(244,240,230,.10)` | hairline borders |

## Layout
- Recorded frame is **600×1067** (design units → 1080×1920); teleprompter panel
  is **440×1067**. The whole deck scales to fit the viewport. Do not change these.
- **Split scene**: `<div class="split-top">…</div>` (content, ~top 54%) then
  `talkingHead()` (webcam zone, bottom).
- **Full-bleed scene**: `<div class="full">…</div>` (vertically centered) + `pip()`
  for the corner head bubble.

## Frame classes (use in `frame` HTML)
- `.kicker` — uppercase mono label (coral)
- `h1` — display headline; wrap one span in `style="color:var(--coral)"` for the accent
- `.sub` — body paragraph
- `.accent-rule` — short slanted coral underline
- `.panel` — card; with `.row`, `.list`, and `li()` rows inside
- `.code` — code block; spans `.g`(green $) `.c`(cream) `.m`(muted) `.p`(purple) `.o`(coral)
- `.chip` — small mono pill (use `chip()`)
- `.shot` — browser-window screenshot mock (use `shot()`)

## Helpers (`helpers.mjs`, build-time)
- `talkingHead(label?)` — webcam split zone
- `pip(caption?)` — corner head bubble + caption
- `li(glyph, colorVar, text)` — a feature/checklist row
- `chip(text)` — a mono pill
- `shot(imgSrc, url)` — browser mock; pass `"__SHOT__"` to inline `shot.png`
- `renderNotes(notes, dur)` — used by the builder; you don't call it directly

## Scene schema
```js
{ dur:Number,           // seconds (also the countdown)
  res:String?,          // top-right tag; default "1080 × 1920 · 9:16"
  frame:String,         // recorded-frame HTML
  notes:{ now:String, beats:String[], c?:String, n?:String } }
```
`c` (slide counter like "2 / 6") auto-fills if omitted; `n` is the NOW label
(default "Now").

## Copy guidance
- Headline: 2–4 short lines, one coral accent max.
- Kicker: `STEP 0N · TOPIC` or a 2–3 word tag.
- Teleprompter `now`: the single thing to say on this slide, phrased as a beat.
- `beats`: 1–2 reminders (delivery cues, not full script).
