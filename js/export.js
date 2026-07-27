// Postcard and time-lapse: the two ways a run leaves the browser as an image.
//
// Both features live here because they share the same problem — getting pixels
// out of the world canvas without the simulation noticing. Nothing in this file
// may reach for rand() from utils.js: the determinism tests exist precisely to
// catch rendering-side code that borrows the simulation's PRNG. There is no
// randomness here at all, deliberately (see the palette notes further down).
//
// The postcard re-renders the world at a fixed resolution into the real canvas,
// snapshots it, and puts it back — synchronously, so the browser never composites
// the intermediate state and the player sees no flicker.
//
// The time-lapse captures the canvas that has already been drawn, so recording
// costs one downscale blit plus one getImageData per captured frame and nothing
// else. Encoding is a hand-written GIF writer (median-cut palette + LZW) running
// in a Worker built from a Blob URL, so the page keeps working offline and no
// CDN dependency enters a project that has no build step.

import { el, clamp, TAU } from './utils.js';
import { P, S, seasonInfo, dayInfo } from './state.js';
import { draw, resize } from './render.js';
import { speciesCount } from './world.js';
import { t } from './i18n.js';

// must match render.js: the canvas backing store is S.W * DPR wide
const DPR = Math.min(window.devicePixelRatio || 1, 2);
const SITE = 'github.com/…/evosim';   // replaced below by the real location when served

/* ==========================================================================
   1. Rendering the world off to one side
   ========================================================================== */

// Draw the world at an arbitrary pixel size and camera, and hand back a detached
// canvas holding the result. render.js draws into #world and sizes everything off
// S.W/S.H, so the only way in without a hook is to lend it the real canvas for the
// span of one synchronous call. Every cache in render.js is keyed on the viewport
// (bgKey carries S.W/S.H; the wash, bloom and nebula layers check their own size),
// so both the borrowed render and the restore rebuild cleanly.
function renderRegion(pxW, pxH, cam){
  const cv = el('world');
  const sCam = { x: S.cam.x, y: S.cam.y, zoom: S.cam.zoom };
  const sW = S.W, sH = S.H, sCW = cv.width, sCH = cv.height;
  const out = document.createElement('canvas');
  out.width = pxW; out.height = pxH;
  try{
    S.W = pxW / DPR; S.H = pxH / DPR;
    cv.width = pxW; cv.height = pxH;
    S.cam.x = cam.x; S.cam.y = cam.y; S.cam.zoom = cam.zoom;
    draw();
    out.getContext('2d').drawImage(cv, 0, 0);
  } finally {
    S.cam.x = sCam.x; S.cam.y = sCam.y; S.cam.zoom = sCam.zoom;
    S.W = sW; S.H = sH; cv.width = sCW; cv.height = sCH;
    resize();          // re-derives S.W/S.H from the element and drops the caches
    draw();            // repaint before the frame is composited, so nothing flashes
  }
  return out;
}

// the framing the player has arranged, at a fixed output width instead of
// whatever the window happens to be: same world region, more pixels
function viewCam(pxW){
  return { x: S.cam.x, y: S.cam.y, zoom: S.cam.zoom * (pxW / DPR) / S.W };
}
// the whole system, all planets, void included
function systemCam(pxW){
  return { x: 0, y: 0, zoom: (pxW / DPR) / (S.worldW || 1) };
}

/* ==========================================================================
   2. The postcard
   ========================================================================== */

const CARD_W = 1400, PAD = 52, IMG_W = CARD_W - PAD * 2;
const INK = '#ece7d7', MUTED = '#95a389', LINE = '#2a3a2b', PANEL2 = '#18221a';
const MOSS = '#8fc44a', SKY = '#74bccb', AMBER = '#e0a458', BLOOD = '#dd6f57',
      PURPLE = '#a97fe0', MOSS_D = '#4a7a1e';
const SERIF = '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,"Times New Roman",serif';
const SANS = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';

const nfmt = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

function roundRect(c, x, y, w, h, r){
  c.beginPath();
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
// small caps by hand: canvas has no font-variant, and the panel's label style is
// uppercase + letter-spaced, which has to be drawn glyph by glyph
function tracked(c, text, x, y, sp){
  let cx = x;
  for(const ch of text){ c.fillText(ch, cx, y); cx += c.measureText(ch).width + sp; }
  return cx - sp - x;
}
function trackedWidth(c, text, sp){
  let w = 0;
  for(const ch of text){ w += c.measureText(ch).width + sp; }
  return w - sp;
}

// What goes on the card, and why. Seed and tick are the reproducibility pair:
// with them the image is a claim anyone can check, which is the whole point of a
// world that is a pure function of its seed. The three feeding bands plus the
// plant count are the ecosystem's actual state — the shape of the food web at
// that instant, and the thing that moves when something remarkable happens.
// Generation is evolutionary depth (how far the run is from its founders),
// species is how far it has diverged, and planets colonised is the milestone
// that most often makes a player want to post the picture at all.
function stats(){
  let h = 0, o = 0, cn = 0;
  for(const c of S.creatures){ if(c.type === 'carn') cn++; else if(c.type === 'omni') o++; else h++; }
  let sp = 0;
  try{ sp = speciesCount(); }catch(e){ sp = 0; }
  const planets = S.planets.length || 0;
  return [
    { k: t('herbivores'), v: nfmt(h), c: MOSS },
    { k: t('omnivores'), v: nfmt(o), c: PURPLE },
    { k: t('carnivores'), v: nfmt(cn), c: BLOOD },
    { k: t('plants'), v: nfmt(S.food.length), c: MOSS_D },
    { k: t('pcGen'), v: nfmt(S.maxGen), c: SKY },
    { k: t('pcSpecies'), v: nfmt(sp), c: AMBER },
    { k: t('pcPlanets'), v: (S.colonized || []).length + '/' + planets, c: AMBER }
  ];
}

function shareUrl(){
  try{
    const u = location.origin && location.origin !== 'null'
      ? location.host + location.pathname.replace(/index\.html$/, '')
      : SITE;
    return u.replace(/\/$/, '') + '/?seed=' + (S.seed >>> 0);
  }catch(e){ return SITE; }
}

function seasonLine(){
  let s = '';
  if(P.seasonsOn){ const si = seasonInfo(S.tick); s = ['🌱', '☀️', '🍂', '❄️'][si.idx] + ' ' + t(si.key); }
  if(P.dayNightOn) s += (s ? '  ' : '') + (dayInfo(S.tick).night ? '🌙' : '☀️');
  if(S.drought > 0) s += ' 🏜️';
  return s;
}

// The composition. A card, not a screenshot: a header that names the thing and
// carries the two numbers that make it reproducible, the image inside a frame of
// its own with a vignette and a scrim-backed watermark (so the picture survives
// being cropped out of the card), a row of stat tiles borrowed from the side
// panel's visual language, and a footer with the URL that reproduces the world.
function composePostcard(img, whole){
  const imgH = img.height, headH = 116, chipH = 92, footH = 30;
  const H = PAD + headH + imgH + 26 + chipH + 22 + footH + PAD;
  const cv = document.createElement('canvas');
  cv.width = CARD_W; cv.height = H;
  const c = cv.getContext('2d');

  // ground: the panel gradient, then a hairline frame just inside the bleed
  const bg = c.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#141c14'); bg.addColorStop(1, '#0b110c');
  c.fillStyle = bg; c.fillRect(0, 0, CARD_W, H);
  c.strokeStyle = 'rgba(42,58,43,.85)'; c.lineWidth = 1;
  c.strokeRect(18.5, 18.5, CARD_W - 37, H - 37);

  /* --- header --- */
  c.textBaseline = 'alphabetic';
  c.fillStyle = MOSS; c.font = '600 13px ' + SANS;
  tracked(c, (whole ? t('pcSystem') : t('pcView')).toUpperCase(), PAD, PAD + 20, 3);
  c.font = '500 50px ' + SERIF;
  c.fillStyle = INK; c.fillText('Evo', PAD, PAD + 74);
  const tw = c.measureText('Evo').width;
  c.fillStyle = MOSS; c.fillText('Sim', PAD + tw, PAD + 74);

  // seed and tick, right-aligned: the pair that makes the image checkable
  const meta = [[t('pcSeed'), String(S.seed >>> 0)], [t('pcTick'), nfmt(S.tick)]];
  let mx = CARD_W - PAD;
  for(let i = meta.length - 1; i >= 0; i--){
    c.font = '700 30px ' + SANS;
    const vw = c.measureText(meta[i][1]).width;
    c.font = '600 11px ' + SANS;
    const kw = trackedWidth(c, meta[i][0].toUpperCase(), 2.2);
    const w = Math.max(vw, kw);
    c.fillStyle = MUTED; tracked(c, meta[i][0].toUpperCase(), mx - w, PAD + 26, 2.2);
    c.fillStyle = INK; c.font = '700 30px ' + SANS;
    c.fillText(meta[i][1], mx - vw, PAD + 62);
    mx -= w + 44;
  }
  const sl = seasonLine();
  if(sl){
    c.font = '13px ' + SANS; c.fillStyle = MUTED; c.textAlign = 'right';
    c.fillText(sl, CARD_W - PAD, PAD + 86); c.textAlign = 'left';
  }

  /* --- the picture --- */
  const iy = PAD + headH;
  c.drawImage(img, PAD, iy, IMG_W, imgH);
  // vignette, echoing the inset shadow the stage carries in the live page
  const vg = c.createRadialGradient(PAD + IMG_W / 2, iy + imgH / 2, Math.min(IMG_W, imgH) * 0.25,
                                    PAD + IMG_W / 2, iy + imgH / 2, Math.max(IMG_W, imgH) * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)');
  c.fillStyle = vg; c.fillRect(PAD, iy, IMG_W, imgH);
  // scrim + watermark: legible type over a busy background is a scrim problem,
  // and it keeps the image self-identifying if someone crops the card away
  const sc = c.createLinearGradient(0, iy + imgH - 92, 0, iy + imgH);
  sc.addColorStop(0, 'rgba(6,10,7,0)'); sc.addColorStop(1, 'rgba(6,10,7,.82)');
  c.fillStyle = sc; c.fillRect(PAD, iy + imgH - 92, IMG_W, 92);
  c.font = '500 22px ' + SERIF; c.fillStyle = 'rgba(236,231,215,.92)';
  c.fillText('EvoSim', PAD + 22, iy + imgH - 26);
  const ww = c.measureText('EvoSim').width;
  c.font = '13px ' + SANS; c.fillStyle = 'rgba(236,231,215,.62)';
  c.fillText('· ' + t('pcSeed') + ' ' + (S.seed >>> 0) + ' · t ' + nfmt(S.tick), PAD + 22 + ww + 10, iy + imgH - 27);
  c.strokeStyle = 'rgba(42,58,43,.9)'; c.lineWidth = 1;
  c.strokeRect(PAD + 0.5, iy + 0.5, IMG_W - 1, imgH - 1);

  /* --- stat tiles --- */
  const st = stats(), n = st.length, gap = 14, cw = (IMG_W - gap * (n - 1)) / n;
  const cy = iy + imgH + 26;
  for(let i = 0; i < n; i++){
    const x = PAD + i * (cw + gap);
    c.fillStyle = PANEL2; roundRect(c, x, cy, cw, chipH, 10); c.fill();
    c.strokeStyle = LINE; c.lineWidth = 1; roundRect(c, x + 0.5, cy + 0.5, cw - 1, chipH - 1, 10); c.stroke();
    c.save(); roundRect(c, x, cy, cw, chipH, 10); c.clip();
    c.fillStyle = st[i].c; c.fillRect(x, cy, 3, chipH); c.restore();
    c.fillStyle = MUTED; c.font = '600 11px ' + SANS;
    tracked(c, st[i].k.toUpperCase(), x + 16, cy + 30, 0.9);
    c.fillStyle = INK; c.font = '700 30px ' + SANS;
    c.fillText(st[i].v, x + 15, cy + 68);
  }

  /* --- footer --- */
  const fy = cy + chipH + 42;
  c.fillStyle = MUTED; c.font = '13px ' + SANS;
  c.fillText(shareUrl(), PAD, fy);
  c.textAlign = 'right';
  c.fillStyle = 'rgba(149,163,137,.75)'; c.font = 'italic 13px ' + SERIF;
  c.fillText(t('pcFoot'), CARD_W - PAD, fy);
  c.textAlign = 'left';
  return cv;
}

function saveBlob(blob, name){
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function makePostcard(whole){
  const t0 = performance.now();
  const pxW = IMG_W;
  let pxH, cam;
  if(whole){
    pxH = Math.max(120, Math.round(pxW * (S.worldH || 1) / (S.worldW || 1)));
    cam = systemCam(pxW);
  } else {
    pxH = Math.max(120, Math.round(pxW * S.H / (S.W || 1)));
    cam = viewCam(pxW);
  }
  const img = renderRegion(pxW, pxH, cam);
  const card = composePostcard(img, !!whole);
  const ms = performance.now() - t0;
  card.toBlob(b => {
    if(!b){ flash(t('pcFailed')); return; }
    saveBlob(b, 'evosim-' + (whole ? 'system-' : '') + 'seed' + (S.seed >>> 0) + '-t' + S.tick + '.png');
    flash('📷 ' + t('pcSaved') + ' · ' + Math.round(ms) + ' ms');
  }, 'image/png');
  return card;
}

/* ==========================================================================
   3. GIF encoder — palette, LZW, frame differencing
   ==========================================================================
   Written by hand rather than pulled from a CDN. The reasons, in order: the page
   has no build step and must stay usable offline, so a remote ES module would
   make one feature silently depend on the network; the encoders that would fit
   are all considerably larger than what is actually needed here; and the two
   things that decide whether a time-lapse is shareable — a global palette and
   inter-frame differencing — are decisions this file wants to own anyway.
   No dithering: with 255 colours chosen from the frames themselves the banding is
   below what a 320-px-wide picture shows, and ordered dithering would flip pixels
   that did not really change, destroying the differencing that keeps the file small.
   Written as one self-contained factory so the identical code can run inside a
   Worker (stringified) or on the main thread (called) with no second copy.
   ========================================================================== */

function EvoGifEncoder(){
  const hist = new Uint32Array(32768);
  const frames = [];                       // Uint16Array of RGB555 keys, one per frame
  let W = 0, H = 0, delay = 8, stage = 0, fi = 0, prev = null;
  let pal = null, palN = 0, palMap = null;
  const TRANS = 255;

  let buf = new Uint8Array(1 << 18), n = 0;
  function need(k){ if(n + k <= buf.length) return; let s = buf.length; while(s < n + k) s *= 2; const b = new Uint8Array(s); b.set(buf); buf = b; }
  function u8(v){ need(1); buf[n++] = v & 255; }
  function u16(v){ need(2); buf[n++] = v & 255; buf[n++] = (v >> 8) & 255; }
  function str(s){ need(s.length); for(let i = 0; i < s.length; i++) buf[n++] = s.charCodeAt(i); }

  function add(rgba, w, h){
    if(!W){ W = w; H = h; }
    if(w !== W || h !== H) return;
    const k = new Uint16Array(W * H);
    for(let i = 0, p = 0; i < k.length; i++, p += 4){
      const key = ((rgba[p] >> 3) << 10) | ((rgba[p + 1] >> 3) << 5) | (rgba[p + 2] >> 3);
      k[i] = key; hist[key]++;
    }
    frames.push(k);
  }

  // Median cut over the RGB555 histogram of every captured frame. Working from the
  // histogram rather than from sampled pixels means the palette sees the whole
  // recording exactly once, at a fixed cost that does not grow with frame count.
  function buildPalette(){
    const used = [];
    for(let k = 0; k < 32768; k++) if(hist[k]) used.push(k);
    if(!used.length) used.push(0);
    const R = k => (k >> 10) & 31, G = k => (k >> 5) & 31, B = k => k & 31;
    function box(s, e){
      let c = 0, r0 = 31, r1 = 0, g0 = 31, g1 = 0, b0 = 31, b1 = 0;
      for(let i = s; i < e; i++){
        const k = used[i], q = hist[k], r = R(k), g = G(k), b = B(k);
        c += q;
        if(r < r0) r0 = r; if(r > r1) r1 = r;
        if(g < g0) g0 = g; if(g > g1) g1 = g;
        if(b < b0) b0 = b; if(b > b1) b1 = b;
      }
      const vol = (r1 - r0) + (g1 - g0) + (b1 - b0);
      return { s, e, c, r0, r1, g0, g1, b0, b1, score: c * (vol + 1) };
    }
    const boxes = [box(0, used.length)];
    while(boxes.length < 255){
      let bi = -1, best = 0;
      for(let i = 0; i < boxes.length; i++){
        const bx = boxes[i];
        if(bx.e - bx.s < 2) continue;
        if(bx.r1 === bx.r0 && bx.g1 === bx.g0 && bx.b1 === bx.b0) continue;
        if(bx.score > best){ best = bx.score; bi = i; }
      }
      if(bi < 0) break;
      const bx = boxes[bi];
      const dr = bx.r1 - bx.r0, dg = bx.g1 - bx.g0, db = bx.b1 - bx.b0;
      const ch = dg >= dr && dg >= db ? 1 : dr >= db ? 0 : 2;
      const seg = used.slice(bx.s, bx.e);
      seg.sort(ch === 0 ? (a, b) => R(a) - R(b) : ch === 1 ? (a, b) => G(a) - G(b) : (a, b) => B(a) - B(b));
      for(let i = 0; i < seg.length; i++) used[bx.s + i] = seg[i];
      let acc = 0, cut = bx.s + 1;
      const half = bx.c / 2;
      for(let i = bx.s; i < bx.e - 1; i++){ acc += hist[used[i]]; if(acc >= half){ cut = i + 1; break; } }
      boxes.splice(bi, 1, box(bx.s, cut), box(cut, bx.e));
    }
    palN = boxes.length;
    pal = new Uint8Array(768);
    for(let i = 0; i < palN; i++){
      const bx = boxes[i];
      let r = 0, g = 0, b = 0, c = 0;
      for(let j = bx.s; j < bx.e; j++){
        const k = used[j], q = hist[k];
        r += (((k >> 10) & 31) * 8 + 4) * q; g += (((k >> 5) & 31) * 8 + 4) * q; b += ((k & 31) * 8 + 4) * q; c += q;
      }
      if(!c) c = 1;
      pal[i * 3] = Math.min(255, r / c) | 0; pal[i * 3 + 1] = Math.min(255, g / c) | 0; pal[i * 3 + 2] = Math.min(255, b / c) | 0;
    }
    palMap = new Int16Array(32768).fill(-1);
  }

  function nearest(key){
    const r = ((key >> 10) & 31) * 8 + 4, g = ((key >> 5) & 31) * 8 + 4, b = (key & 31) * 8 + 4;
    let bi = 0, bd = 1e12;
    for(let i = 0; i < palN; i++){
      const dr = r - pal[i * 3], dg = g - pal[i * 3 + 1], db = b - pal[i * 3 + 2];
      const d = dr * dr * 2 + dg * dg * 4 + db * db * 3;
      if(d < bd){ bd = d; bi = i; }
    }
    return bi;
  }

  // Straight LZW as the GIF spec defines it; the code-size bookkeeping follows
  // the shape every working encoder uses, because it is easy to get subtly wrong.
  function lzw(px, minCode){
    const clear = 1 << minCode, eoi = clear + 1;
    let size = minCode + 1, next = eoi + 1;
    let dict = new Map();
    let cur = 0, bits = 0;
    const bytes = [];
    const emit = c => { cur |= c << bits; bits += size; while(bits >= 8){ bytes.push(cur & 255); cur >>>= 8; bits -= 8; } };
    emit(clear);
    let code = px[0];
    for(let i = 1; i < px.length; i++){
      const k = px[i], key = code * 4096 + k, had = dict.get(key);
      if(had !== undefined){ code = had; continue; }
      emit(code);
      if(next === 4096){ emit(clear); dict = new Map(); next = eoi + 1; size = minCode + 1; }
      else { if(next >= (1 << size)) size++; dict.set(key, next++); }
      code = k;
    }
    emit(code); emit(eoi);
    if(bits > 0) bytes.push(cur & 255);
    return bytes;
  }

  function header(){
    str('GIF89a'); u16(W); u16(H); u8(0xF7); u8(0); u8(0);
    need(768); for(let i = 0; i < 768; i++) buf[n++] = pal[i];
    u8(0x21); u8(0xFF); u8(0x0B); str('NETSCAPE2.0'); u8(0x03); u8(0x01); u16(0); u8(0);
  }

  function frame(i){
    const src = frames[i]; frames[i] = null;
    const idx = new Uint8Array(W * H);
    for(let p = 0; p < idx.length; p++){
      const k = src[p]; let m = palMap[k];
      if(m < 0) m = palMap[k] = nearest(k);
      idx[p] = m;
    }
    let x0 = 0, y0 = 0, x1 = W - 1, y1 = H - 1, tr = 0;
    if(prev){
      tr = 1; x0 = W; y0 = H; x1 = -1; y1 = -1;
      for(let y = 0; y < H; y++){
        const row = y * W;
        for(let x = 0; x < W; x++){
          if(idx[row + x] === prev[row + x]) continue;
          if(x < x0) x0 = x; if(x > x1) x1 = x;
          if(y < y0) y0 = y; if(y > y1) y1 = y;
        }
      }
      if(x1 < 0){ x0 = y0 = 0; x1 = y1 = 0; }     // nothing moved: a 1x1 hole
    }
    const sw = x1 - x0 + 1, sh = y1 - y0 + 1;
    const sub = new Uint8Array(sw * sh);
    for(let y = 0; y < sh; y++){
      const s = (y0 + y) * W + x0, d = y * sw;
      for(let x = 0; x < sw; x++){
        const v = idx[s + x];
        sub[d + x] = (tr && v === prev[s + x]) ? TRANS : v;
      }
    }
    // graphic control: leave the previous frame in place and punch holes in it
    u8(0x21); u8(0xF9); u8(0x04); u8(0x04 | tr); u16(delay); u8(TRANS); u8(0);
    u8(0x2C); u16(x0); u16(y0); u16(sw); u16(sh); u8(0);
    u8(8);
    const bytes = lzw(sub, 8);
    for(let p = 0; p < bytes.length; p += 255){
      const len = Math.min(255, bytes.length - p);
      u8(len); need(len);
      for(let q = 0; q < len; q++) buf[n++] = bytes[p + q];
    }
    u8(0);
    prev = idx;
  }

  // one unit of work per call, so the caller decides how it is spread out
  function step(){
    if(!frames.length || !W) return 1;
    if(stage === 0){ buildPalette(); header(); stage = 1; return 0.02; }
    // deliberately caps at 0.99: the caller stops pumping the moment step()
    // returns 1, so the last frame must not claim to be the last unit of work
    // or the trailer never gets written.
    if(fi < frames.length){ frame(fi++); return 0.02 + 0.97 * fi / frames.length; }
    u8(0x3B); return 1;
  }

  return {
    add, step,
    count: () => frames.length,
    setDelay: d => { delay = d; },
    result: () => buf.slice(0, n)
  };
}

/* ---------- the worker: the same factory, stringified ---------- */
const WORKER_DRIVER = `
var enc = EvoGifEncoder(), stop = false;
self.onmessage = function(e){
  var m = e.data;
  if(m.t === 'f'){ enc.add(new Uint8Array(m.b), m.w, m.h); return; }
  if(m.t === 'x'){ stop = true; return; }
  if(m.t === 'e'){
    enc.setDelay(m.delay);
    (function loop(){
      if(stop) return;
      var p = enc.step();
      self.postMessage({ t: 'p', p: p });
      if(p >= 1){ var r = enc.result(); self.postMessage({ t: 'd', b: r.buffer }, [r.buffer]); }
      else setTimeout(loop, 0);
    })();
  }
};`;

let workerUrl = null;
function makeWorker(){
  try{
    if(!workerUrl){
      const src = EvoGifEncoder.toString() + '\n' + WORKER_DRIVER;
      workerUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    }
    return new Worker(workerUrl);
  }catch(e){ return null; }
}

/* ==========================================================================
   4. Recording
   ========================================================================== */

const REC = {
  on: false, encoding: false, frames: 0,
  every: 60, cap: 90, width: 320,       // ticks between frames · frame budget · px
  w: 0, h: 0, last: -1,
  worker: null, enc: null, tmp: null, tctx: null,
  t0: 0, capMs: 0, capN: 0, encT0: 0
};

function recEl(id){ return el(id); }
function setRecBar(show, text){
  const bar = recEl('recBar'); if(!bar) return;
  bar.classList.toggle('show', !!show);
  const tx = recEl('recText'); if(tx && text !== undefined) tx.textContent = text;
}
let flashT = null;
function flash(msg){
  const box = el('toast'); if(!box) return;
  box.textContent = msg; box.classList.add('show');
  clearTimeout(flashT); flashT = setTimeout(() => box.classList.remove('show'), 2600);
}

function startRecording(){
  if(REC.on || REC.encoding) return;
  const cv = el('world');
  if(!cv.width || !cv.height){ flash(t('recFailed')); return; }
  REC.w = REC.width & ~1;
  REC.h = Math.max(2, Math.round(REC.w * cv.height / cv.width)) & ~1;
  REC.tmp = document.createElement('canvas');
  REC.tmp.width = REC.w; REC.tmp.height = REC.h;
  REC.tctx = REC.tmp.getContext('2d', { willReadFrequently: true });
  REC.tctx.imageSmoothingEnabled = true;
  REC.tctx.imageSmoothingQuality = 'high';
  REC.worker = makeWorker();
  REC.enc = REC.worker ? null : EvoGifEncoder();
  REC.frames = 0; REC.last = -1; REC.on = true; REC.capMs = 0; REC.capN = 0;
  REC.t0 = performance.now();
  const stop = recEl('recStop'); if(stop) stop.textContent = '■ ' + t('recStop');
  setRecBar(true, '● 0/' + REC.cap);
  requestAnimationFrame(recTick);
}

// One capture: downscale the canvas the main loop has already drawn and hand the
// pixels straight to the worker as a transferable. No re-render, no simulation
// touch, and nothing kept on this side of the wire.
function capture(){
  const cv = el('world');
  const c = REC.tctx;
  const t0 = performance.now();
  c.drawImage(cv, 0, 0, cv.width, cv.height, 0, 0, REC.w, REC.h);
  const img = c.getImageData(0, 0, REC.w, REC.h);
  if(REC.worker) REC.worker.postMessage({ t: 'f', b: img.data.buffer, w: REC.w, h: REC.h }, [img.data.buffer]);
  else REC.enc.add(img.data, REC.w, REC.h);
  REC.capMs += performance.now() - t0; REC.capN++;
  REC.frames++;
}

function recTick(){
  if(!REC.on) return;
  if(REC.last < 0 || S.tick - REC.last >= REC.every){
    REC.last = S.tick;
    capture();
    setRecBar(true, '● ' + REC.frames + '/' + REC.cap + ' · t ' + nfmt(S.tick));
    if(REC.frames >= REC.cap){ stopRecording(); return; }
  }
  requestAnimationFrame(recTick);
}

function stopRecording(){
  if(!REC.on) return;
  REC.on = false;
  if(!REC.frames){ setRecBar(false); flash(t('recEmpty')); return; }
  REC.encoding = true; REC.encT0 = performance.now();
  const stop = recEl('recStop'); if(stop) stop.textContent = '✕ ' + t('recCancel');
  setRecBar(true, t('recEncoding') + ' 0%');
  const done = bytes => {
    REC.encoding = false;
    const ms = performance.now() - REC.encT0;
    setRecBar(false);
    saveBlob(new Blob([bytes], { type: 'image/gif' }),
      'evosim-seed' + (S.seed >>> 0) + '-t' + S.tick + '.gif');
    flash('🎞 ' + REC.frames + ' × ' + REC.w + '×' + REC.h + ' · ' +
      Math.round(bytes.length / 1024) + ' kB · ' + Math.round(ms) + ' ms');
  };
  if(REC.worker){
    const w = REC.worker;
    w.onmessage = e => {
      const m = e.data;
      if(m.t === 'p'){ setRecBar(true, t('recEncoding') + ' ' + Math.round(m.p * 100) + '%'); }
      else if(m.t === 'd'){ w.terminate(); REC.worker = null; done(new Uint8Array(m.b)); }
    };
    w.postMessage({ t: 'e', delay: 8 });
  } else {
    // no Worker: the same encoder, one frame per task, so the world keeps stepping
    REC.enc.setDelay(8);
    const pump = () => {
      if(!REC.encoding) return;
      const p = REC.enc.step();
      setRecBar(true, t('recEncoding') + ' ' + Math.round(p * 100) + '%');
      if(p >= 1) done(REC.enc.result());
      else setTimeout(pump, 0);
    };
    setTimeout(pump, 0);
  }
}

function cancelRecording(){
  if(REC.on){ REC.on = false; setRecBar(false); flash(t('recAborted')); return; }
  if(REC.encoding){
    REC.encoding = false;
    if(REC.worker){ REC.worker.postMessage({ t: 'x' }); REC.worker.terminate(); REC.worker = null; }
    REC.enc = null; setRecBar(false); flash(t('recAborted'));
  }
}

/* ==========================================================================
   5. Wiring
   ========================================================================== */

function overlay(id, on){ const n = el(id); if(n) n.classList.toggle('show', on); }

function syncRecLabels(){
  const iv = el('rGifEvery'), fr = el('rGifFrames'), wd = el('rGifWidth');
  if(iv){ REC.every = +iv.value; el('vGifEvery').textContent = REC.every + ' t'; }
  if(fr){ REC.cap = +fr.value; el('vGifFrames').textContent = String(REC.cap); }
  if(wd){ REC.width = +wd.value; el('vGifWidth').textContent = REC.width + ' px'; }
  const span = el('vGifSpan');
  if(span) span.textContent = nfmt(REC.cap * REC.every);
}

function bind(){
  const on = (id, fn) => { const n = el(id); if(n) n.onclick = fn; };
  on('btnPostcard', () => { overlay('menu', false); overlay('postcard', true); });
  on('mPostcard', () => { overlay('menu', false); overlay('postcard', true); });
  on('pcClose', () => overlay('postcard', false));
  on('pcShotView', () => { overlay('postcard', false); makePostcard(false); });
  on('pcShotAll', () => { overlay('postcard', false); makePostcard(true); });
  on('pcRecStart', () => { overlay('postcard', false); startRecording(); });
  on('recStop', () => { if(REC.on) stopRecording(); else cancelRecording(); });
  for(const id of ['rGifEvery', 'rGifFrames', 'rGifWidth']){
    const n = el(id); if(n) n.oninput = syncRecLabels;
  }
  syncRecLabels();
}
bind();

// exported for the tests and for anything that wants to drive this without the UI
export { startRecording, stopRecording, cancelRecording, REC, EvoGifEncoder };
