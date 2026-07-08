// EXAMPLE content — the browser-api 2-minute short.
// Copy this shape for a new short: export `title` and a `scenes` array.
// Each scene: { dur, res?, frame, notes:{ now, beats:[], c?, n? } }.
//   - frame : raw HTML for the recorded 9:16 area. Use plain markup + helpers.
//   - dur   : seconds on screen (also seeds the "Next in" countdown).
//   - notes : off-frame teleprompter (c/counter auto-fills if omitted).
// Build:  node ../camera-deck-short/assets/render.mjs ./content.mjs --shot shot.png

import { talkingHead, pip, li, chip, shot } from "./helpers.mjs";

export const title = "browser-api · 2-min short · Camera Deck";

export const scenes = [
  // 1 · HOOK
  { dur:14,
    frame:
      '<div class="split-top">'+
        '<div class="kicker">Agents × the web</div>'+
        '<h1 style="font-size:60px;margin-top:16px">Give your<br>agent a<br><span style="color:var(--coral)">real browser.</span></h1>'+
        '<p class="sub" style="font-size:24px;line-height:1.45;margin-top:26px">One small API. It drives real Chromium — so your agent can open <em>any</em> site.</p>'+
      '</div>'+ talkingHead(),
    notes:{ now:"Hook in 3 sec — say the payoff first.", beats:["Keep the energy up","“Here’s how easy it is…”"] } },

  // 2 · REPO
  { dur:24, res:"head off · full-bleed",
    frame:
      '<div class="full">'+
        '<div class="kicker">Step 01 · open source</div>'+
        '<h1 style="font-size:58px;margin-top:16px">It’s all<br>open source.</h1>'+
        '<div class="panel" style="margin-top:30px">'+
          '<div class="row" style="margin-bottom:6px"><span style="font-family:var(--mono);font-size:22px;color:var(--cream)">alnutile/browser</span></div>'+
          '<div style="font-family:var(--sans);font-size:18px;color:var(--muted);margin:2px 0 22px 0">A headless browser your agents drive over HTTP.</div>'+
          '<div class="list">'+
            li('↳','var(--coral)','Any JS page → clean <b style="color:var(--cream)">Markdown</b>')+
            li('⚿','var(--purple)','Logins that survive redeploys')+
            li('◈','var(--green)','Click, type, screenshot, run JS')+
            li('★','var(--gold)','Token-protected — not an open proxy')+
          '</div>'+
        '</div>'+
      '</div>'+ pip('★ github.com/alnutile/browser'),
    notes:{ now:"Show the repo + README features.", beats:["Scroll the Features list","“Fork it, it’s all here”"] } },

  // 3 · RAILWAY
  { dur:26, res:"head off · full-bleed",
    frame:
      '<div class="full">'+
        '<div class="kicker">Step 02 · deploy</div>'+
        '<h1 style="font-size:56px;margin-top:16px">Live on Railway<br>in minutes.</h1>'+
        '<div class="panel" style="margin-top:30px">'+
          '<div class="row" style="justify-content:space-between;margin-bottom:22px">'+
            '<span style="font-family:var(--mono);font-size:20px;color:var(--cream)">browser</span>'+
            '<span class="row" style="gap:8px"><span style="width:9px;height:9px;border-radius:50%;background:var(--green)"></span><span style="font-family:var(--mono);font-size:15px;color:var(--green)">Online</span></span>'+
          '</div>'+
          '<div class="list">'+
            li('✓','var(--green)','Dockerfile detected — Chromium baked in')+
            li('✓','var(--green)','Volume mounted at <b style="color:var(--cream)">/data</b>')+
            li('✓','var(--coral)','Env vars <b style="color:var(--cream)">already there</b>')+
            li('✓','var(--green)','Healthcheck <b style="color:var(--cream)">/health</b> passing')+
          '</div>'+
        '</div>'+
        '<div class="row" style="gap:10px;margin-top:20px">'+ chip('CPU ~0')+chip('≈ $5 / mo')+chip('one replica') +'</div>'+
      '</div>'+ pip('deploy logs off-frame'),
    notes:{ now:"Repo → add a Volume → deploy.", beats:["“Variables were pre-wired”","One replica — Volume keeps logins"] } },

  // 4 · BEARER TOKEN
  { dur:20, res:"head off · full-bleed",
    frame:
      '<div class="full">'+
        '<div class="kicker">Step 03 · keep it safe</div>'+
        '<h1 style="font-size:58px;margin-top:16px">One token<br>locks it down.</h1>'+
        '<div class="accent-rule" style="width:180px;margin:26px 0 0"></div>'+
        '<div class="code" style="margin-top:28px">'+
          '<div><span class="m">POST</span> <span class="c">/sessions/bot/goto</span></div>'+
          '<div><span class="o">Authorization:</span> <span class="c">Bearer</span> <span class="p">$API_TOKEN</span></div>'+
          '<div style="margin-top:10px"><span class="g">→ 200</span> <span class="m">driving the page…</span></div>'+
          '<div><span style="color:#d16b6b">→ 401</span> <span class="m">no token, no browser</span></div>'+
        '</div>'+
        '<p class="sub" style="font-size:22px;line-height:1.45;margin-top:26px">Every call needs the bearer token. Set it once in Railway’s variables.</p>'+
      '</div>'+ pip('you, explaining the token'),
    notes:{ now:"Bearer token = not an open proxy.", beats:["Set API_TOKEN in Railway vars","openssl rand -hex 32"] } },

  // 5 · SCREENSHOT DEMO  (uses the real shot.png via the shot() helper)
  { dur:26,
    frame:
      '<div class="full" style="padding-top:64px;justify-content:flex-start">'+
        '<div class="kicker">Step 04 · use it</div>'+
        '<h1 style="font-size:56px;margin-top:16px">Now it can<br><span style="color:var(--coral)">see the web.</span></h1>'+
        '<div class="code" style="margin-top:24px;font-size:15px">'+
          '<div><span class="g">$</span> <span class="c">curl</span> <span class="m">.../sessions/bot/screenshot</span></div>'+
          '<div><span class="p">↳ 200</span> <span class="m">image/png · captured live</span></div>'+
        '</div>'+
        '<div style="margin-top:22px">'+ shot("__SHOT__", "https://acme.news/article") +'</div>'+
        '<div style="font-family:var(--mono);font-size:13px;color:var(--muted);margin-top:14px;letter-spacing:.06em">↑ this frame was captured by the API itself</div>'+
      '</div>',
    notes:{ now:"Plain HTTP in — screenshot out.", beats:["“Agents use it like any tool”","Same call returns Markdown too"] } },

  // 6 · OUTRO
  { dur:10, res:"head off · full-bleed",
    frame:
      '<div class="full" style="justify-content:center">'+
        '<div class="kicker">Ship it</div>'+
        '<h1 style="font-size:74px;margin-top:18px">Give your<br>agents<br><span style="color:var(--coral)">the web.</span></h1>'+
        '<div style="margin-top:34px;display:inline-flex;align-self:flex-start;align-items:center;gap:12px;background:var(--card);border:1px solid var(--hair);border-radius:999px;padding:14px 22px">'+
          '<span style="font-family:var(--mono);font-size:20px;color:var(--cream)">github.com/alnutile/browser</span>'+
        '</div>'+
        '<div style="font-family:var(--sans);font-weight:700;font-size:24px;color:var(--body2);margin-top:26px">★ Star · Fork · Deploy</div>'+
      '</div>'+ pip('smile — end on your face'),
    notes:{ now:"Land it slow. Let the line breathe.", beats:["Drop to full-face","Repo link in the caption"] } },
];
