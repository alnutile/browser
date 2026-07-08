// Camera Deck — build-time component helpers.
// Content modules import these to build each scene's frame/notes HTML strings.
// These run in Node at build time only; the browser engine never sees them.

export function fmt(t){ t = Math.max(0, Math.floor(t)); return Math.floor(t/60) + ':' + ('0'+(t%60)).slice(-2); }

/** Talking-head placeholder for split scenes (content top / webcam bottom). */
export function talkingHead(label = "Talking head · webcam"){
  return '<div class="split-marker"></div>'+
    '<div class="head">'+
      '<div class="tag">'+label+'</div>'+
      '<div class="shoulders"></div><div class="face"></div>'+
      '<div class="wave">'+
        '<span style="height:14px;animation-delay:0s"></span>'+
        '<span style="height:26px;animation-delay:.1s"></span>'+
        '<span style="height:34px;animation-delay:.2s"></span>'+
        '<span style="height:20px;animation-delay:.3s"></span>'+
        '<span style="height:30px;animation-delay:.15s"></span>'+
        '<span style="height:12px;animation-delay:.25s"></span>'+
      '</div>'+
    '</div>';
}

/** Corner PiP head bubble + caption, for full-bleed scenes. */
export function pip(caption = "head returns as corner bubble"){
  return '<div class="pip"></div><div class="pip-cap">'+caption+'</div>';
}

/** A checklist / feature row with a colored box glyph. */
export function li(glyph, color, text){
  return '<div class="li"><span class="bx" style="background:'+color+'22;color:'+color+'">'+glyph+'</span>'+text+'</div>';
}

/** A pill chip (e.g. "≈ $5 / mo"). */
export function chip(text){ return '<span class="chip">'+text+'</span>'; }

/**
 * Browser-window screenshot mock. `img` is an <img> src — pass a data URI, a
 * path, or the literal "__SHOT__" token (render.mjs swaps that for shot.png).
 */
export function shot(img = "__SHOT__", url = "https://example.com"){
  return '<div class="shot">'+
    '<div class="bar">'+
      '<span class="d" style="background:#E0795A"></span>'+
      '<span class="d" style="background:#D9C46A"></span>'+
      '<span class="d" style="background:#7BB58A"></span>'+
      '<span class="url">'+url+'</span>'+
    '</div>'+
    '<img src="'+img+'" alt="screenshot">'+
  '</div>';
}

/**
 * Off-frame teleprompter notes for a scene. `dur` seeds the countdown value.
 *   notes = { now, c, beats:[], n? }
 *     now   : the big "NOW" beat (Bricolage)
 *     c     : slide counter text, e.g. "1 / 6"
 *     beats : secondary reminder bullets
 *     n     : the NOW label (default "Now")
 */
export function renderNotes(notes, dur){
  var beats = (notes.beats || []).map(function(b){
    return '<div class="beat"><span class="sq"></span><span class="tx">'+b+'</span></div>';
  }).join('');
  return '<div class="top">'+
      '<span><span class="l">Off-frame notes</span><span class="c">Slide '+notes.c+'</span></span>'+
      '<span class="cdwrap"><span class="cdlabel">Next in</span><span class="cd" id="cd">'+fmt(dur)+'</span></span>'+
    '</div>'+
    '<div class="cdbar"><i id="cdbar"></i></div>'+
    '<div class="now"><div class="n">'+(notes.n || 'Now')+'</div><div class="t">'+notes.now+'</div></div>'+
    '<div class="beats">'+beats+'</div>'+
    '<div class="foot">← you read this while the frame records</div>';
}
