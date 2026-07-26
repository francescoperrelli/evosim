// World drawing: cached backdrop, starfield, lighting, effects, charts, HUD, inspector viz
import { clamp, TAU, el } from './utils.js';
import { P, S, seasonInfo, dayInfo, clampCam, minZoom } from './state.js';
import { NIN, NOUT, MAX_NH } from './nn.js';
import { dialectStats, solarPeakY } from './world.js';
import * as flora from './flora.js';
import * as village from './village.js';
import * as property from './property.js';
import * as trade from './trade.js';
import * as tribe from './tribe.js';
import * as tools from './tools.js';
import * as fire from './fire.js';
import * as marks from './marks.js';
import * as tech from './tech.js';
import * as terra from './terra.js';
import { speciesName } from './phylo.js';
import { t } from './i18n.js';

const world = el('world'), wctx = world.getContext('2d');
const DPR = Math.min(window.devicePixelRatio || 1, 2);
// new visual layers are opt-out: a flag not yet present in P counts as on
const flag = k => P[k] !== false;
// transform helpers: screen space (CSS px) and world space (camera)
const scr = () => wctx.setTransform(DPR, 0, 0, DPR, 0, 0);
const wld = z => wctx.setTransform(DPR * z, 0, 0, DPR * z, -S.cam.x * z * DPR, -S.cam.y * z * DPR);

export function resize(){
  const r = world.getBoundingClientRect();
  S.W = r.width; S.H = r.height;
  world.width = S.W * DPR; world.height = S.H * DPR;
  bgKey = waKey = blKey = '';
  if(S.worldW) clampCam();
}

/* ---------- deterministic noise: nothing drawn may depend on Math.random() ---------- */
function h1(n){ n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d); n = Math.imul(n ^ (n >>> 12), 0x297a2d39); return ((n ^ (n >>> 15)) >>> 0) / 4294967296; }
const h2 = (x, y, s) => h1((x * 374761393 + y * 668265263 + s * 1274126177) | 0);
// bilinear value noise + a few octaves of fbm, used for terrain and star fields
function vnoise(x, y, s){
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = h2(xi, yi, s), b = h2(xi + 1, yi, s), c = h2(xi, yi + 1, s), d = h2(xi + 1, yi + 1, s);
  const t1 = a + (b - a) * u, t2 = c + (d - c) * u;
  return t1 + (t2 - t1) * v;
}
function fbm(x, y, s){ let v = 0, a = 0.5, f = 1; for(let o = 0; o < 3; o++){ v += vnoise(x * f, y * f, s + o * 31) * a; a *= 0.5; f *= 2.07; } return v * 1.143; }
// local PRNG for particle jitter — deliberately separate from the simulation's rand()
let _pr = 0x9e3779b9;
function pr(){ _pr = (_pr + 0x6D2B79F5) | 0; let t2 = Math.imul(_pr ^ (_pr >>> 15), 1 | _pr); t2 = (t2 + Math.imul(t2 ^ (t2 >>> 7), 61 | t2)) ^ t2; return ((t2 ^ (t2 >>> 14)) >>> 0) / 4294967296; }

function hsl2rgb(h, s, l, out){
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if(h < 60){ r = c; g = x; } else if(h < 120){ r = x; g = c; } else if(h < 180){ g = c; b = x; }
  else if(h < 240){ g = x; b = c; } else if(h < 300){ r = x; b = c; } else { r = c; b = x; }
  out[0] = (r + m) * 255 | 0; out[1] = (g + m) * 255 | 0; out[2] = (b + m) * 255 | 0;
}
// one soft radial sprite per colour, reused instead of building gradients in hot loops
const GLOW = {};
function glow(rgb){
  let cv = GLOW[rgb]; if(cv) return cv;
  const R = 32; cv = document.createElement('canvas'); cv.width = cv.height = R * 2;
  const c = cv.getContext('2d'), gr = c.createRadialGradient(R, R, 0, R, R, R);
  gr.addColorStop(0, `rgba(${rgb},0.9)`); gr.addColorStop(0.35, `rgba(${rgb},0.32)`); gr.addColorStop(1, `rgba(${rgb},0)`);
  c.fillStyle = gr; c.fillRect(0, 0, R * 2, R * 2);
  return (GLOW[rgb] = cv);
}
function blitGlow(ctx, rgb, x, y, r, a){ ctx.globalAlpha = a; ctx.drawImage(glow(rgb), x - r, y - r, r * 2, r * 2); ctx.globalAlpha = 1; }
// plants grouped by quantised flora style, reused between frames so drawing the
// crop stays a handful of fills however many plant chemistries are in play
const FBUCK = new Map();
// a wobbly closed blob — deterministic from `sd`, so rocks and pools keep their shape
function blob(ctx, x, y, r, n, sd, wob){
  ctx.beginPath();
  for(let i = 0; i <= n; i++){
    const a = i / n * TAU, rr = r * (1 - wob * 0.5 + wob * h1(sd * 131 + (i % n)));
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
}
function rrect(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

const SEASON_TINT = [[120, 190, 90, .05], [230, 200, 120, .05], [210, 150, 80, .06], [140, 180, 220, .07]];
const DROUGHT_TINT = [150, 95, 35, .13];
// composite src over dst (both [r,g,b,a]) so several full-screen washes collapse
// into one fill — screen-wide fills are the most expensive thing a frame can do
function over(dst, src){
  if(!dst) return src; if(!src) return dst;
  const a = src[3] + dst[3] * (1 - src[3]);
  if(a < 0.0015) return null;
  const k = dst[3] * (1 - src[3]);
  return [(src[0] * src[3] + dst[0] * k) / a, (src[1] * src[3] + dst[1] * k) / a, (src[2] * src[3] + dst[2] * k) / a, a];
}
const rgba = c => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${c[3].toFixed(4)})`;

/* ---------- static backdrop: space, planets, terrain, water, rocks ----------
   None of it changes between frames, so it is rendered once into an offscreen
   canvas and blitted; it is only rebuilt when the camera, the viewport or the
   world contents change (rocks and water can be painted in with the tools). */
const bgCv = document.createElement('canvas'), bgCtx = bgCv.getContext('2d');
let bgKey = '';

// per-planet terrain texture: fbm elevation -> water / shore / mottled land,
// baked once at low resolution and stretched over the planet (cheap and smooth)
const TEX = new Map();
function planetTex(p, i){
  const key = i + '|' + p.hue + '|' + Math.round(p.fert * 100) + '|' + Math.round(p.w) + 'x' + Math.round(p.h);
  const had = TEX.get(i); if(had && had.key === key) return had.cv;
  const TW = 384, TH = Math.max(64, Math.round(TW * p.h / p.w));
  const cv = document.createElement('canvas'); cv.width = TW; cv.height = TH;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(TW, TH), d = img.data;
  const sd = (i * 917 + (p.hue | 0) * 13) | 0, rgb = [0, 0, 0];
  for(let py = 0; py < TH; py++){
    const ny = py / TH * 4.4, ey = (py + 0.5) / TH * 2 - 1;
    for(let px = 0; px < TW; px++){
      const nx = px / TW * 6.2, ex = (px + 0.5) / TW * 2 - 1;
      // continents pull away from the rim, so every world gets its own coastline
      const fine = vnoise(nx * 9.3, ny * 9.3, sd + 211) - 0.5;
      let e = fbm(nx, ny, sd) - 0.30 * Math.max(0, (ex * ex * 0.85 + ey * ey) - 0.30) + fine * 0.035;
      const m = fbm(nx * 2.7 + 11, ny * 2.7 + 7, sd + 97);
      let hu, sa, li;
      if(e < 0.42){ const dp = clamp((0.42 - e) / 0.4, 0, 1); hu = 202 + (p.hue - 202) * 0.1; sa = 46; li = 25 - dp * 13 + fine * 2.4; }
      else if(e < 0.455){ hu = 52; sa = 30; li = 33; }                    // sand is sand, whatever colour the world is
      else { const t2 = clamp((e - 0.455) / 0.42, 0, 1); hu = p.hue + (m - 0.5) * 30; sa = 22 + m * 18; li = 13 + t2 * 15 + (m - 0.5) * 6 + fine * 3.2; }
      li *= 1 - 0.34 * clamp(ex * ex * 0.8 + ey * ey * 0.95, 0, 1);      // spherical rim falloff
      hsl2rgb(hu, sa, clamp(li, 3, 60), rgb);
      const o = (py * TW + px) * 4;
      d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2]; d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  TEX.set(i, { key, cv });
  return cv;
}

// deep space: nebula clouds sit effectively at infinity, so they are baked once into
// an opaque layer and only re-baked after the camera has crawled a long way
let nbCv = null, nbCtx = null, nbKey = '';
const NEB = [[86, 60, 180], [40, 110, 150], [150, 60, 120]];
function nebulae(){
  const W = S.W, H = S.H, z = S.cam.zoom;
  const ox = Math.round(S.cam.x * z * 0.06 / 32) * 32, oy = Math.round(S.cam.y * z * 0.06 / 32) * 32;
  if(!nbCv){ nbCv = document.createElement('canvas'); nbCtx = nbCv.getContext('2d'); }
  const key = ox + ',' + oy + ',' + (flag('starsOn') ? 1 : 0);
  if(!layerFor(nbCv) || key !== nbKey){
    nbKey = key;
    const b = nbCtx; b.setTransform(DPR, 0, 0, DPR, 0, 0);
    b.fillStyle = '#04050a'; b.fillRect(0, 0, W, H);
    if(flag('starsOn')) for(let i = 0; i < 3; i++){
      const P2 = W + 700, Q2 = H + 700;
      const nx = ((h1(i * 7 + 3) * P2 - ox) % P2 + P2) % P2 - 350, ny = ((h1(i * 7 + 9) * Q2 - oy) % Q2 + Q2) % Q2 - 350;
      const R = Math.max(W, H) * (0.4 + h1(i * 13) * 0.35), c = NEB[i];
      const g = b.createRadialGradient(nx, ny, 0, nx, ny, R);
      g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},0.075)`); g.addColorStop(0.55, `rgba(${c[0]},${c[1]},${c[2]},0.028)`); g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
      b.fillStyle = g; b.fillRect(nx - R, ny - R, R * 2, R * 2);
    }
  }
  wctx.setTransform(1, 0, 0, 1, 0, 0); wctx.drawImage(nbCv, 0, 0);
}
// three parallax star depths, hashed from the index and drawn live so panning
// keeps its sense of depth without ever invalidating a cache
function starfield(){
  const W = S.W, H = S.H, z = S.cam.zoom, cam = S.cam, b = wctx;
  scr();
  const FW = W + 400, FH = H + 400, PAR = [0.18, 0.42, 0.78], N = [110, 84, 52];
  for(let L = 0; L < 3; L++){
    const par = PAR[L], base = L * 400;
    for(let i = 0; i < N[L]; i++){
      const hx = h1(base + i * 3 + 1), hy = h1(base + i * 3 + 2), hb = h1(base + i * 3 + 3);
      const sx = ((hx * FW - cam.x * z * par) % FW + FW) % FW - 200;
      const sy = ((hy * FH - cam.y * z * par) % FH + FH) % FH - 200;
      if(sx < -4 || sx > W + 4 || sy < -4 || sy > H + 4) continue;
      const a = 0.18 + hb * (0.3 + L * 0.28), r = 0.5 + L * 0.35 + hb * 0.5;
      b.fillStyle = hb > 0.88 ? `rgba(255,224,190,${a})` : hb > 0.7 ? `rgba(190,214,255,${a})` : `rgba(226,236,255,${a})`;
      b.fillRect(sx - r, sy - r, r * 2, r * 2);
      if(L === 2 && hb > 0.93) blitGlow(b, '190,214,255', sx, sy, 5 + hb * 5, 0.5);
    }
  }
}

// the world backdrop is baked with a margin around the viewport and anchored to the
// camera it was baked at, so ordinary panning re-blits it instead of rebuilding it
const BGM = 240;
let bgAx = 0, bgAy = 0;
function buildBackdrop(){
  const W = S.W, H = S.H, z = S.cam.zoom, b = bgCtx;
  const cw = Math.round(W * DPR) + BGM * 2, ch = Math.round(H * DPR) + BGM * 2;
  if(bgCv.width !== cw || bgCv.height !== ch){ bgCv.width = cw; bgCv.height = ch; }
  bgAx = S.cam.x; bgAy = S.cam.y;
  b.setTransform(1, 0, 0, 1, 0, 0); b.clearRect(0, 0, cw, ch);
  b.setTransform(DPR * z, 0, 0, DPR * z, BGM - bgAx * z * DPR, BGM - bgAy * z * DPR);
  const mw = 40 + BGM / (z * DPR);
  const vx0 = S.cam.x - mw, vy0 = S.cam.y - mw, vx1 = S.cam.x + W / z + mw, vy1 = S.cam.y + H / z + mw;
  const vis = (x, y, m) => x + m > vx0 && x - m < vx1 && y + m > vy0 && y - m < vy1;
  // planet bodies: atmosphere halo, rounded silhouette, baked terrain, lit rim
  if(S.planets.length){
    for(let i = 0; i < S.planets.length; i++){
      const p = S.planets[i], cx = p.x + p.w / 2, cy = p.y + p.h / 2, R = Math.max(p.w, p.h) * 0.5;
      if(!vis(cx, cy, R * 1.3)) continue;
      const hg = b.createRadialGradient(cx, cy, R * 0.8, cx, cy, R * 1.25);
      hg.addColorStop(0, `hsla(${p.hue} 75% 62% / .17)`); hg.addColorStop(0.45, `hsla(${p.hue} 75% 58% / .055)`); hg.addColorStop(1, `hsla(${p.hue} 75% 55% / 0)`);
      b.fillStyle = hg; b.fillRect(cx - R * 1.3, cy - R * 1.3, R * 2.6, R * 2.6);
      const rad = Math.min(p.w, p.h) * 0.17;
      b.save(); rrect(b, p.x, p.y, p.w, p.h, rad); b.clip();
      b.fillStyle = `hsl(${p.hue} 30% 11%)`; b.fillRect(p.x, p.y, p.w, p.h);
      b.imageSmoothingEnabled = true;                                   // texel grid must never show
      b.drawImage(planetTex(p, i), p.x, p.y, p.w, p.h);
      b.restore();
      const colon = (S.colonized || []).indexOf(i) >= 0;
      rrect(b, p.x, p.y, p.w, p.h, rad);
      b.strokeStyle = colon ? `hsla(${p.hue} 90% 74% / .75)` : `hsla(${p.hue} 60% 58% / .38)`;
      b.lineWidth = (colon ? 3 : 1.6) / z; b.stroke();
      if(colon){ b.strokeStyle = `hsla(${p.hue} 90% 70% / .18)`; b.lineWidth = 10 / z; b.stroke(); }
    }
  } else {
    b.fillStyle = '#0c1210'; b.fillRect(0, 0, S.worldW, S.worldH);
    b.strokeStyle = 'rgba(120,150,110,.18)'; b.lineWidth = 2 / z; b.strokeRect(0, 0, S.worldW, S.worldH);
  }
  // biome fertility tints
  for(const bm of S.biomes){
    if(!vis(bm.x, bm.y, bm.r)) continue;
    const grd = b.createRadialGradient(bm.x, bm.y, 0, bm.x, bm.y, bm.r);
    const col = bm.fert >= 0 ? '120,190,90' : '150,120,70', a = Math.min(0.2, Math.abs(bm.fert) * 0.22);
    grd.addColorStop(0, `rgba(${col},${a})`); grd.addColorStop(1, `rgba(${col},0)`);
    b.fillStyle = grd; b.beginPath(); b.arc(bm.x, bm.y, bm.r, 0, TAU); b.fill();
  }
  // water: a wobbly pool with a pale shoreline rim and a darker deep centre
  for(let i = 0; i < S.water.length; i++){
    const w = S.water[i]; if(!vis(w.x, w.y, w.r + 6)) continue;
    blob(b, w.x, w.y, w.r + 2.5, 14, i + 5, 0.1); b.fillStyle = 'rgba(120,180,215,.28)'; b.fill();
    blob(b, w.x, w.y, w.r, 14, i + 5, 0.1);
    const g = b.createRadialGradient(w.x - w.r * 0.2, w.y - w.r * 0.2, 0, w.x, w.y, w.r);
    g.addColorStop(0, 'rgba(74,146,196,.5)'); g.addColorStop(1, 'rgba(28,74,128,.66)');
    b.fillStyle = g; b.fill();
  }
  // rocks: a shaded boulder rather than a flat grey disc
  for(let i = 0; i < S.rocks.length; i++){
    const rk = S.rocks[i]; if(!vis(rk.x, rk.y, rk.r + 4)) continue;
    b.fillStyle = 'rgba(6,8,10,.4)'; blob(b, rk.x + rk.r * 0.18, rk.y + rk.r * 0.3, rk.r, 9, i + 3, 0.24); b.fill();
    blob(b, rk.x, rk.y, rk.r, 9, i + 3, 0.24);
    b.fillStyle = '#33383c'; b.fill();
    b.strokeStyle = '#202427'; b.lineWidth = 1.2 / z; b.stroke();
    blob(b, rk.x - rk.r * 0.2, rk.y - rk.r * 0.24, rk.r * 0.56, 9, i + 11, 0.26);
    b.fillStyle = 'rgba(154,166,176,.3)'; b.fill();
  }
}
function backdrop(){
  nebulae();
  if(flag('starsOn')) starfield();
  const z = S.cam.zoom;
  // rocks and water are user-placeable, so the cache is keyed on what is in the world
  const key = z.toFixed(4) + ',' + S.W + 'x' + S.H + ',' + S.planets.length + ',' + S.rocks.length + ',' +
    S.water.length + ',' + S.biomes.length + ',' + (S.colonized || []).length + ',' + S.seed + ',' + S.worldW;
  let dx = -BGM + (bgAx - S.cam.x) * z * DPR, dy = -BGM + (bgAy - S.cam.y) * z * DPR;
  if(key !== bgKey || dx > 0 || dy > 0 || dx < -2 * BGM || dy < -2 * BGM){
    buildBackdrop(); bgKey = key; dx = dy = -BGM;
  }
  wctx.setTransform(1, 0, 0, 1, 0, 0);
  wctx.drawImage(bgCv, Math.round(dx), Math.round(dy));
}

/* ---------- particles: one small bounded pool, recycled oldest-first ---------- */
const MAXP = 300;
let pw = 0;
const parts = () => S.parts || (S.parts = []);
function emit(x, y, vx, vy, life, r, col, kind){
  const A = parts(), p = { x, y, vx, vy, t: life, max: life, r, col, k: kind || 0 };
  if(A.length < MAXP) A.push(p); else { A[pw] = p; pw = (pw + 1) % MAXP; }
}
function burst(x, y, n, spd, life, r, col, kind){
  for(let i = 0; i < n; i++){ const a = pr() * TAU, v = spd * (0.35 + pr() * 0.8); emit(x, y, Math.cos(a) * v, Math.sin(a) * v, life * (0.6 + pr() * 0.6) | 0, r * (0.6 + pr() * 0.7), col, kind); }
}
function drawParts(z){
  const A = S.parts; if(!A || !A.length) return;
  for(let i = 0; i < A.length; i++){
    const p = A[i]; if(p.t <= 0) continue;
    p.t--; p.x += p.vx; p.y += p.vy; p.vx *= 0.93; p.vy *= 0.93;
    const k = p.t / p.max;
    if(p.k === 1){                                  // ghost: a fading, expanding outline
      wctx.strokeStyle = `rgba(${p.col},${0.5 * k})`; wctx.lineWidth = Math.max(0.6, p.r * 0.22);
      wctx.beginPath(); wctx.arc(p.x, p.y, p.r * (1.6 - k * 0.6), 0, TAU); wctx.stroke();
    } else {
      wctx.fillStyle = `rgba(${p.col},${clamp(k * 1.2, 0, 1)})`;
      wctx.beginPath(); wctx.arc(p.x, p.y, Math.max(0.5 / z, p.r * (0.4 + k * 0.6)), 0, TAU); wctx.fill();
    }
  }
}

/* ---------- life events: births, deaths, meals — diffed from the creature list ----------
   The renderer cannot see into the simulation, so it keeps last frame's ids,
   positions and energies and reads the changes off them. Approximate on purpose. */
const seen = new Map();
let frameN = 0, lastTick = -1, lastPred = 0, lastEff = 0;
const PCOL = { herb: '143,196,74', omni: '169,127,224', carn: '221,111,87' };
function lifeEvents(fx){
  frameN++;
  const cs = S.creatures, dt = S.tick - lastTick; lastTick = S.tick;
  // a reseed, a restore or a big fast-forward jump: track it, but never firework it
  const quiet = !fx || dt < 0 || dt > 6;
  const killed = S.predations > lastPred; lastPred = S.predations;
  let born = 0, kills = 0, meals = 0;
  for(let i = 0; i < cs.length; i++){
    const c = cs[i], v = seen.get(c.id);
    if(!v){
      seen.set(c.id, { x: c.x, y: c.y, e: c.energy, r: c.rad || c.g.size, ty: c.type, f: frameN, b: frameN });
      if(!quiet && born < 6){ burst(c.x, c.y, 4, 0.5, 16, 1.5, '236,244,206'); born++; }
    } else {
      if(!quiet){
        const de = c.energy - v.e;
        if(de > 30 && c.type !== 'herb' && killed && kills < 3){ burst(c.x, c.y, 9, 1.5, 22, 2.2, '224,72,52'); kills++; }
        else if(de > 5 && de <= 30 && meals < 8){ burst(c.x, c.y, 3, 0.7, 14, 1.4, '150,214,90'); meals++; }
      }
      v.x = c.x; v.y = c.y; v.e = c.energy; v.r = c.rad || c.g.size; v.f = frameN;
    }
  }
  if(seen.size > cs.length){                        // whatever we did not touch this frame died
    let d = 0;
    for(const [id, v] of seen){
      if(v.f === frameN) continue;
      if(!quiet && d < 10){
        emit(v.x, v.y, 0, 0, 22, v.r, PCOL[v.ty] || '180,180,180', 1);
        burst(v.x, v.y, 5, 0.6, 20, 1.6, '160,150,130'); d++;
      }
      seen.delete(id);
    }
  }
  // meteors: a shower of embers on the frame the shockwave is born
  if(!quiet && S.effects.length > lastEff) for(const e of S.effects) if(e.t === e.max) burst(e.x, e.y, 16, 3.2, 30, 2.6, '255,168,60');
  lastEff = S.effects.length;
}

/* ---------- level of detail: a biomass heat field when the whole system is in view ---------- */
let dCv = null, dCtx = null, dImg = null, dAcc = null, dTmp = null;
function drawDensity(alpha){
  const W = S.W, H = S.H, z = S.cam.zoom, CS = 10;
  const cols = Math.max(2, Math.ceil(W / CS)), rows = Math.max(2, Math.ceil(H / CS)), n = cols * rows;
  if(!dCv){ dCv = document.createElement('canvas'); dCtx = dCv.getContext('2d'); }
  if(dCv.width !== cols || dCv.height !== rows){ dCv.width = cols; dCv.height = rows; dImg = dCtx.createImageData(cols, rows); dAcc = null; }
  if(!dAcc || dAcc.length !== n * 3){ dAcc = new Float32Array(n * 3); dTmp = new Float32Array(n * 3); }
  dAcc.fill(0);
  const cx0 = S.cam.x, cy0 = S.cam.y;
  for(const c of S.creatures){
    const sx = (c.x - cx0) * z / CS, sy = (c.y - cy0) * z / CS;
    const gx = sx | 0, gy = sy | 0;
    if(gx < 0 || gy < 0 || gx >= cols || gy >= rows) continue;
    const ch = c.type === 'carn' ? 2 : c.type === 'omni' ? 1 : 0, m = (c.rad || c.g.size) * 0.5;
    dAcc[(gy * cols + gx) * 3 + ch] += m;
  }
  // two separable 1-2-1 passes: one is not enough to hide the cell grid once the
  // field is stretched back up to full screen size
  for(let it = 0; it < 2; it++){
    for(let y = 0; y < rows; y++) for(let x = 0; x < cols; x++){
      const o = (y * cols + x) * 3, l = x > 0 ? o - 3 : o, r = x < cols - 1 ? o + 3 : o;
      for(let k = 0; k < 3; k++) dTmp[o + k] = (dAcc[l + k] + 2 * dAcc[o + k] + dAcc[r + k]) * 0.25;
    }
    for(let y = 0; y < rows; y++) for(let x = 0; x < cols; x++){
      const o = (y * cols + x) * 3, u = y > 0 ? o - cols * 3 : o, d = y < rows - 1 ? o + cols * 3 : o;
      for(let k = 0; k < 3; k++) dAcc[o + k] = (dTmp[u + k] + 2 * dTmp[o + k] + dTmp[d + k]) * 0.25;
    }
  }
  const px = dImg.data;
  for(let i = 0; i < n; i++){
    const h = dAcc[i * 3], o = dAcc[i * 3 + 1], c = dAcc[i * 3 + 2], tot = h + o + c, q = i * 4;
    if(tot < 0.05){ px[q + 3] = 0; continue; }
    const iv = 1 / tot;
    px[q] = clamp(143 * h * iv + 169 * o * iv + 232 * c * iv, 0, 255);
    px[q + 1] = clamp(196 * h * iv + 127 * o * iv + 76 * c * iv, 0, 255);
    px[q + 2] = clamp(74 * h * iv + 224 * o * iv + 62 * c * iv, 0, 255);
    // knee on the faint end: without it the blur's long tail hazes over empty space
    const a = tot * 52;
    px[q + 3] = clamp(a < 22 ? a * a / 22 : a, 0, 236);
  }
  dCtx.putImageData(dImg, 0, 0);
  scr();
  wctx.globalAlpha = alpha; wctx.imageSmoothingEnabled = true;
  wctx.drawImage(dCv, 0, 0, W, H);
  wctx.globalAlpha = 1;
}

/* ---------- pheromone field ----------
   Painting the raw grid one opaque-ish rect per cell made the scent read as a
   chequerboard. A 1-2-1 blur into a private copy (the simulation's array is never
   touched) evens out the step between neighbouring cells for almost no cost.
   The rects still have to butt up exactly: overlapping them double-blends the
   seams and turns the field into plaid. */
let phA = null, phB = null, phTick = -1, phN = 0, phLo = 1, phSc = 0.05;
const PH_KEYS = ['herb', 'omni', 'carn'], PH_RGB = [[143, 196, 74], [169, 127, 224], [221, 111, 87]], PH_A = 0.1;
function drawPher(vx0, vy0, vx1, vy1){
  const ph = S.pher, cols = ph.cols, rows = ph.rows, n = cols * rows, PC = S.worldW / cols;
  if(phN !== n * 3){ phA = new Float32Array(n * 3); phB = new Float32Array(n * 3); phN = n * 3; phTick = -1; }
  if(phTick !== S.tick){
    phTick = S.tick;
    for(let k = 0; k < 3; k++){ const src = ph.f[PH_KEYS[k]]; for(let i = 0; i < n; i++) phB[i * 3 + k] = src[i]; }
    for(let y = 0; y < rows; y++) for(let x = 0; x < cols; x++){
      const o = (y * cols + x) * 3, l = x > 0 ? o - 3 : o, r = x < cols - 1 ? o + 3 : o;
      for(let k = 0; k < 3; k++) phA[o + k] = (phB[l + k] + 2 * phB[o + k] + phB[r + k]) * 0.25;
    }
    let mx = 0;
    for(let y = 0; y < rows; y++) for(let x = 0; x < cols; x++){
      const o = (y * cols + x) * 3, u = y > 0 ? o - cols * 3 : o, d = y < rows - 1 ? o + cols * 3 : o;
      for(let k = 0; k < 3; k++){ const v = (phA[u + k] + 2 * phA[o + k] + phA[d + k]) * 0.25; phB[o + k] = v; if(v > mx) mx = v; }
    }
    // scaled against the field's own peak: with a thousand walkers a fixed cutoff
    // paints the whole planet, and with a dozen it shows nothing at all
    phLo = Math.max(0.6, mx * 0.42); phSc = PH_A / Math.max(0.4, mx - phLo);
  }
  const x0 = Math.max(0, Math.floor(vx0 / PC)), x1 = Math.min(cols - 1, Math.ceil(vx1 / PC));
  for(let k = 0; k < 3; k++){
    const rgb = PH_RGB[k];
    for(let cy = 0; cy < rows; cy++){
      const wy = cy * PC; if(wy > vy1 || wy + PC < vy0) continue;
      // run-length merge along the row: fewer fills, and no seam between merged cells
      let run = -1, q = 0;
      for(let cx = x0; cx <= x1 + 1; cx++){
        const v = cx > x1 ? 0 : phB[(cy * cols + cx) * 3 + k];
        const nq = v < phLo ? 0 : Math.round(Math.min(PH_A, (v - phLo) * phSc) * 500);
        if(nq === q) continue;
        if(q){ wctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${q / 500})`; wctx.fillRect(run * PC, wy, (cx - run) * PC + 0.5, PC + 0.5); }
        run = cx; q = nq;
      }
    }
  }
}

/* ---------- interplanetary dispersal arcs ---------- */
function drawFlights(z){
  const F = S.flights; if(!F || !F.length) return;
  for(let i = 0; i < F.length; i++){
    const f = F[i], mx = f.max || 90, k = clamp(f.t / mx, 0, 1), fade = 1 - clamp((k - 0.72) / 0.28, 0, 1);
    const dx = f.x1 - f.x0, dy = f.y1 - f.y0, L = Math.hypot(dx, dy) || 1;
    const bx = (f.x0 + f.x1) / 2 - dy * 0.2, by = (f.y0 + f.y1) / 2 + dx * 0.2;   // bowed control point
    const at = u => { const q = 1 - u; return [q * q * f.x0 + 2 * q * u * bx + u * u * f.x1, q * q * f.y0 + 2 * q * u * by + u * u * f.y1]; };
    const hd = at(k), hue = f.hue === undefined ? 48 : f.hue;
    const g = wctx.createLinearGradient(f.x0, f.y0, hd[0], hd[1]);
    g.addColorStop(0, `hsla(${hue} 90% 70% / 0)`); g.addColorStop(0.7, `hsla(${hue} 95% 72% / ${0.35 * fade})`); g.addColorStop(1, `hsla(${hue} 100% 82% / ${0.9 * fade})`);
    wctx.strokeStyle = g; wctx.lineWidth = Math.max(1.2 / z, L * 0.004); wctx.beginPath();
    for(let s = 0; s <= 16; s++){ const q = at(k * s / 16); s ? wctx.lineTo(q[0], q[1]) : wctx.moveTo(q[0], q[1]); }
    wctx.stroke();
    const hr = Math.max(6 / z, L * 0.02);
    blitGlow(wctx, '255,232,180', hd[0], hd[1], hr * 2.6, 0.85 * fade);
    wctx.fillStyle = `rgba(255,250,232,${fade})`; wctx.beginPath(); wctx.arc(hd[0], hd[1], hr * 0.42, 0, TAU); wctx.fill();
    if(flag('fxOn') && (f.t & 1) === 0) emit(hd[0], hd[1], 0, 0, 18, hr * 0.4, '255,206,130');
    f.t++;
  }
  S.flights = F.filter(f => f.t <= (f.max || 90));
}

/* ---------- lighting: a travelling sun, real shadows, a dark and moody night ---------- */
function lightInfo(){
  const di = dayInfo(S.tick), ang = di.f * TAU - Math.PI / 2;
  const lx = Math.cos(ang), ly = Math.sin(ang);                       // direction shadows fall
  return { di, lx, ly, shadow: 0.10 + 0.26 * di.light, rim: `rgba(255,238,206,${0.10 + 0.34 * di.light})` };
}
// a full-screen gradient fill costs roughly ten times a solid one, so both screen
// washes are baked into offscreen layers and re-baked only when the sun really moves
let waCv = null, waCtx = null, waKey = '', blCv = null, blCtx = null, blKey = '';
function layerFor(cv){
  const cw = Math.max(1, S.W * DPR | 0), ch = Math.max(1, S.H * DPR | 0);
  if(cv.width !== cw || cv.height !== ch){ cv.width = cw; cv.height = ch; return false; }
  return true;
}
function washLayer(edge, mid, sunY){
  if(!waCv){ waCv = document.createElement('canvas'); waCtx = waCv.getContext('2d'); }
  const key = rgba(edge) + rgba(mid) + ((sunY / 18) | 0);
  if(!layerFor(waCv) || key !== waKey){
    waKey = key;
    waCtx.setTransform(DPR, 0, 0, DPR, 0, 0); waCtx.clearRect(0, 0, S.W, S.H);
    const g = waCtx.createLinearGradient(0, sunY - S.H * 0.75, 0, sunY + S.H * 0.75);
    g.addColorStop(0, rgba(edge)); g.addColorStop(0.5, rgba(mid)); g.addColorStop(1, rgba(edge));
    waCtx.fillStyle = g; waCtx.fillRect(0, 0, S.W, S.H);
  }
  wctx.setTransform(1, 0, 0, 1, 0, 0); wctx.drawImage(waCv, 0, 0);
}
function bloomLayer(sunX, sunY, wa){
  if(!blCv){ blCv = document.createElement('canvas'); blCtx = blCv.getContext('2d'); }
  const key = ((sunX / 22) | 0) + ',' + ((sunY / 22) | 0) + ',' + wa.toFixed(2);
  if(!layerFor(blCv) || key !== blKey){
    blKey = key;
    blCtx.setTransform(DPR, 0, 0, DPR, 0, 0); blCtx.clearRect(0, 0, S.W, S.H);
    const rg = blCtx.createRadialGradient(sunX, sunY, 0, sunX, sunY, Math.max(S.W, S.H) * 0.9);
    rg.addColorStop(0, `rgba(255,208,132,${wa})`); rg.addColorStop(0.5, `rgba(255,168,88,${wa * 0.33})`); rg.addColorStop(1, 'rgba(255,150,70,0)');
    blCtx.fillStyle = rg; blCtx.fillRect(0, 0, S.W, S.H);
  }
  wctx.setTransform(1, 0, 0, 1, 0, 0);
  wctx.globalCompositeOperation = 'lighter'; wctx.drawImage(blCv, 0, 0); wctx.globalCompositeOperation = 'source-over';
}
// night, season and drought are all flat screen-space washes, so they are folded
// into a single gradient fill; only the sun's additive bloom needs a pass of its own
function washes(L){
  const W = S.W, H = S.H, z = S.cam.zoom;
  scr();
  const tint = P.seasonsOn ? SEASON_TINT[seasonInfo(S.tick).idx] : null;
  const dro = S.drought > 0 ? DROUGHT_TINT : null;
  let edge = null, mid = null, sunY = H * 0.5;
  if(L){
    const n = 1 - L.di.light, dk = n * n * 0.6;
    sunY = clamp((solarPeakY(S.tick) - S.cam.y) * z, -H, 2 * H);
    // night falls hardest away from the sunlit latitude, so the warm band stays readable
    if(dk > 0.008){ edge = [5, 9, 24, dk]; mid = [12, 18, 40, dk * 0.55]; }
  } else if(P.dayNightOn){
    const dk = (1 - dayInfo(S.tick).light) * 0.42;
    if(dk > 0.008) edge = mid = [12, 22, 50, dk];
  }
  const NIL = [0, 0, 0, 0];
  edge = over(over(edge, tint), dro) || NIL; mid = over(over(mid, tint), dro) || NIL;
  if(edge[3] > 0.0015 || mid[3] > 0.0015){
    // when both ends agree there is no gradient at all — a solid fill is ten times cheaper
    if(edge[3] === mid[3] && edge[0] === mid[0] && edge[2] === mid[2]){ wctx.fillStyle = rgba(edge); wctx.fillRect(0, 0, W, H); }
    else washLayer(edge, mid, sunY);
  }
  if(!L) return;
  const di = L.di, wa = 0.045 + 0.15 * di.light;
  bloomLayer(W * (0.5 - 0.46 * Math.cos(di.f * TAU)), sunY, wa);
}
// at night every creature keeps a faint bioluminescent glow so nothing disappears
function nightGlow(list, L){
  if(L.di.light > 0.5 || !list.length) return;
  const z = S.cam.zoom, a = (0.5 - L.di.light) * 1.5;
  scr(); wctx.globalCompositeOperation = 'lighter';
  const lim = Math.min(list.length, 420);
  for(let i = 0; i < lim; i++){
    const c = list[i], r = (c.rad || c.g.size) * z;
    if(r < 1.4) continue;
    blitGlow(wctx, PCOL[c.type] || '160,200,140', (c.x - S.cam.x) * z, (c.y - S.cam.y) * z, Math.max(7, r * 2.6), clamp(a * 0.5, 0, 0.5));
  }
  wctx.globalCompositeOperation = 'source-over';
}

// base body colour from diet band (+ camouflage for herbivores)
function bodyColor(c){
  const g = c.g;
  if(c.type === 'herb'){
    const camo = P.mimicOn ? g.camo : 0;
    return { hue: (g.hue * (1 - camo) + 120 * camo) | 0, sat: 62 - camo * 30, light: clamp((38 + c.energy * 0.18) * (1 - camo * 0.35), 24, 70) };
  }
  if(c.type === 'omni') return { hue: g.hue | 0, sat: 55, light: clamp(46 + c.energy * 0.08, 46, 68) };
  return { hue: g.hue | 0, sat: 68, light: clamp(40 + c.energy * 0.1, 42, 66) };
}

// draw one creature from its genome: eyes scale with vision, legs with speed,
// body segments/elongation with the shape gene, markings with the pattern gene.
function drawCreature(c, z, L, anim){
  const g = c.g, col = bodyColor(c), size = c.rad || g.size, appR = size * z;
  // an ornament (of any kind) makes the coat more saturated and vivid
  const orn = g.ornament || 0;
  if(orn > 0.05){ col.sat = clamp(col.sat + orn * 35, 0, 96); col.light = clamp(col.light + orn * 8, 8, 82); }
  const fill = `hsl(${col.hue} ${col.sat}% ${col.light}%)`;
  const dark = `hsl(${col.hue} ${col.sat}% ${clamp(col.light - 20, 8, 60)}%)`;
  const sp0 = Math.hypot(c.vx, c.vy), sp = sp0 || 1, cos = c.vx / sp, sin = c.vy / sp;

  // communication: a visible pulse when the creature broadcasts, coloured by
  // which of its three channels ("words") is loudest
  const sg = c.sig || [0, 0, 0];
  let dom = 0, dm = Math.abs(sg[0]);
  for(let k = 1; k < 3; k++){ const v = Math.abs(sg[k]); if(v > dm){ dm = v; dom = k; } }
  if(dm > 0.35 && appR >= 2){
    const a = clamp((dm - 0.35) / 0.65, 0, 1);
    const CH = ['230,165,120', '120,200,230', '170,140,230'];   // alarm / call / other
    wctx.strokeStyle = `rgba(${CH[dom]},${0.5 * a})`;
    wctx.lineWidth = Math.max(0.8, size * 0.16);
    wctx.beginPath(); wctx.arc(c.x, c.y, size + 3 + a * 7, 0, TAU); wctx.stroke();
  }

  // tier 0: far away — a simple dot
  if(appR < 3){
    wctx.fillStyle = fill; wctx.beginPath(); wctx.arc(c.x, c.y, size, 0, TAU); wctx.fill();
    if(c.sick > 0) sickRing(c, size, z);
    return;
  }

  const senseN = clamp((g.sense - 20) / 145, 0, 1), speedN = clamp((g.speed - 0.4) / 3, 0, 1);
  const shape = g.shape === undefined ? 0.3 : g.shape, pattern = g.pattern === undefined ? 0.5 : g.pattern;

  // life: stretch along the heading with speed, breathe slowly, pop when newborn
  let tf = false;
  if(anim && appR >= 5){
    const st = clamp(sp0 * 0.5, 0, 0.28), br = 1 + 0.03 * Math.sin(S.tick * 0.07 + (c.id % 19));
    const v = seen.get(c.id), age = v ? frameN - v.b : 99;
    const pop = age < 14 ? 1 + 0.7 * (1 - age / 14) ** 2 : 1;
    const sx = (1 + st) * br * pop, sy = (1 - st * 0.7) * br * pop;
    if(Math.abs(sx - 1) > 0.02 || Math.abs(sy - 1) > 0.02){
      const a = Math.atan2(sin, cos);
      wctx.save(); wctx.translate(c.x, c.y); wctx.rotate(a); wctx.scale(sx, sy); wctx.rotate(-a); wctx.translate(-c.x, -c.y);
      tf = true;
    }
  }

  // legs (only when reasonably large): pairs increase with speed
  if(appR >= 6){
    const pairs = 2 + Math.round(speedN * 3), legLen = size * (0.55 + speedN * 0.9);
    wctx.strokeStyle = dark; wctx.lineWidth = Math.max(0.7, size * 0.13);
    for(let i = 0; i < pairs; i++){
      const tt = pairs > 1 ? (i / (pairs - 1) - 0.5) : 0;
      const bx = c.x - cos * tt * size * 1.2, by = c.y - sin * tt * size * 1.2;
      wctx.beginPath(); wctx.moveTo(bx, by); wctx.lineTo(bx - sin * legLen, by + cos * legLen); wctx.stroke();
      wctx.beginPath(); wctx.moveTo(bx, by); wctx.lineTo(bx + sin * legLen, by - cos * legLen); wctx.stroke();
    }
  }

  // ornament: a colourful display fan at the rear, growing with the ornament gene
  if(orn > 0.08 && appR >= 5){
    const rays = 3 + Math.round(orn * 5), len = size * (0.7 + orn * 2.2);
    const bx = c.x - cos * size * 0.7, by = c.y - sin * size * 0.7;
    wctx.strokeStyle = `hsl(${(col.hue + 40) % 360} 88% 62%)`;
    wctx.lineWidth = Math.max(0.7, size * 0.13);
    for(let i = 0; i < rays; i++){
      const spr = (rays > 1 ? (i / (rays - 1) - 0.5) : 0) * (0.7 + orn * 0.8);
      const rx = -cos * Math.cos(spr) + sin * Math.sin(spr), ry = -sin * Math.cos(spr) - cos * Math.sin(spr);
      wctx.beginPath(); wctx.moveTo(bx, by); wctx.lineTo(bx + rx * len, by + ry * len); wctx.stroke();
    }
  }

  // body: 1-3 segments along the heading depending on the shape gene
  const segs = shape > 0.66 ? 3 : shape > 0.33 ? 2 : 1;
  wctx.fillStyle = fill;
  for(let s = 0; s < segs; s++){
    const off = -s * size * 0.85, r = size * (1 - s * 0.16);
    wctx.beginPath(); wctx.arc(c.x + cos * off, c.y + sin * off, r, 0, TAU); wctx.fill();
  }

  // lit rim: a bright crescent on the side facing the sun
  if(L && appR >= 5){
    const ra = Math.atan2(-L.ly, -L.lx);
    wctx.strokeStyle = L.rim; wctx.lineWidth = Math.max(0.7, size * 0.2);
    wctx.beginPath(); wctx.arc(c.x, c.y, size * 0.85, ra - 0.9, ra + 0.9); wctx.stroke();
  }

  // sexual ornament, part 2: a crown of tipped rays at the head, growing with the gene
  if(orn > 0.12 && appR >= 6){
    const hx = c.x + cos * size * 0.5, hy = c.y + sin * size * 0.5;
    const crays = 3 + Math.round(orn * 4), clen = size * (0.45 + orn * 1.3), baseAng = Math.atan2(sin, cos);
    wctx.strokeStyle = `hsl(${(col.hue + 20) % 360} 92% 66%)`; wctx.lineWidth = Math.max(0.6, size * 0.11);
    for(let i = 0; i < crays; i++){
      const a = baseAng + (crays > 1 ? (i / (crays - 1) - 0.5) : 0) * 1.7;
      const tx = hx + Math.cos(a) * clen, ty = hy + Math.sin(a) * clen;
      wctx.beginPath(); wctx.moveTo(hx, hy); wctx.lineTo(tx, ty); wctx.stroke();
      wctx.fillStyle = `hsl(${(col.hue + 60) % 360} 90% 70%)`;
      wctx.beginPath(); wctx.arc(tx, ty, Math.max(0.6, size * 0.13), 0, TAU); wctx.fill();
    }
  }

  // markings from the pattern gene
  if(appR >= 6){
    if(pattern > 0.66){
      wctx.fillStyle = dark;
      for(let i = 0; i < 3; i++){ const a = i * 2.1; wctx.beginPath(); wctx.arc(c.x + Math.cos(a) * size * 0.4, c.y + Math.sin(a) * size * 0.4, size * 0.19, 0, TAU); wctx.fill(); }
    } else if(pattern < 0.33){
      wctx.strokeStyle = dark; wctx.lineWidth = size * 0.24;
      wctx.beginPath(); wctx.moveTo(c.x - sin * size * 0.7, c.y + cos * size * 0.7); wctx.lineTo(c.x + sin * size * 0.7, c.y - cos * size * 0.7); wctx.stroke();
    }
  }

  // eyes at the front, sized by vision
  const eyeR = size * (0.15 + senseN * 0.22), fx = c.x + cos * size * 0.6, fy = c.y + sin * size * 0.6;
  for(const side of [1, -1]){
    const ex = fx - sin * side * size * 0.34, ey = fy + cos * side * size * 0.34;
    wctx.fillStyle = '#f2efe6'; wctx.beginPath(); wctx.arc(ex, ey, eyeR, 0, TAU); wctx.fill();
    wctx.fillStyle = '#15130e'; wctx.beginPath(); wctx.arc(ex + cos * eyeR * 0.3, ey + sin * eyeR * 0.3, eyeR * 0.55, 0, TAU); wctx.fill();
  }

  // carnivore mouth
  if((g.diet || 0) > 0.6 && appR >= 5){
    const ang = Math.atan2(sin, cos);
    wctx.strokeStyle = '#2a0d09'; wctx.lineWidth = Math.max(0.8, size * 0.16);
    wctx.beginPath(); wctx.arc(fx, fy, size * 0.42, ang - 0.6, ang + 0.6); wctx.stroke();
  }

  if(c.sick > 0) sickRing(c, size, z);
  if(tf) wctx.restore();
}
function sickRing(c, size, z){
  wctx.strokeStyle = 'rgba(232,240,120,.85)'; wctx.lineWidth = 1.4 / z;
  wctx.beginPath(); wctx.arc(c.x, c.y, size + 3.5, 0, TAU); wctx.stroke();
}

/* ---------- thought bubbles: translate a creature's real state into words ---------- */
// short ambient line from cheap state (no perception needed)
function ambientText(c){
  if(c.sick > 0) return t('thSick');
  const sg = c.sig || [0, 0, 0];
  if(Math.max(Math.abs(sg[0]), Math.abs(sg[1]), Math.abs(sg[2])) > 0.6) return (c.g.diet || 0) > 0.6 ? t('thGrowl') : t('thCall');
  if(c.energy < 26) return t('thHungry');
  return null;
}
// rich line for the selected creature, read from its sensory inputs + outputs
export function selectedThought(c){
  const a = c.act;
  if(!a) return t('thWander');
  const inp = a.inp;
  if(inp[8] > 0.3) return t('thFlee');                          // a threat is near
  if(inp[5] > 0.3 && (c.g.diet || 0) > 0.5) return t('thHunt'); // prey in sight
  if(inp[12] < 0.4 && inp[2] > 0.2) return t('thFood');         // hungry with food near
  if(inp[12] < 0.4) return t('thHungry');
  if(Math.max(Math.abs(inp[16]), Math.abs(inp[17]), Math.abs(inp[18])) > 0.4) return t('thHeard');   // hears a call
  if(Math.max(Math.abs(a.out[4]), Math.abs(a.out[5]), Math.abs(a.out[6])) > 0.5) return t('thCall'); // broadcasting
  if(inp[11] > 0.4) return t('thFlock');                        // among the herd
  if(inp[12] > 1.0) return t('thCalm');
  return t('thWander');
}
function drawBubble(sx, sy, text, small){
  wctx.font = (small ? 11 : 13) + 'px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
  const padX = 7, h = small ? 18 : 22, w = wctx.measureText(text).width + padX * 2;
  const x = sx - w / 2, y = sy - h - 6;
  wctx.fillStyle = 'rgba(18,24,18,.9)'; wctx.strokeStyle = 'rgba(150,190,120,.5)'; wctx.lineWidth = 1;
  rrect(wctx, x, y, w, h, 7); wctx.fill(); wctx.stroke();
  wctx.beginPath(); wctx.moveTo(sx - 4, y + h - 0.5); wctx.lineTo(sx + 4, y + h - 0.5); wctx.lineTo(sx, y + h + 5); wctx.closePath(); wctx.fill();
  wctx.fillStyle = '#e8eddc'; wctx.textAlign = 'center'; wctx.textBaseline = 'middle';
  wctx.fillText(text, sx, y + h / 2);
}

export function draw(){
  const W = S.W, H = S.H, z = S.cam.zoom;
  const fx = flag('fxOn'), lit = flag('lightsOn') && P.dayNightOn, L = lit ? lightInfo() : null;
  lifeEvents(fx);
  // cached static backdrop: space, stars, planet bodies, terrain, water, rocks
  backdrop();
  // world transform (camera)
  wctx.setTransform(DPR * z, 0, 0, DPR * z, -S.cam.x * z * DPR, -S.cam.y * z * DPR);
  // visible bounds (for culling)
  const vx0 = S.cam.x - 30, vy0 = S.cam.y - 30, vx1 = S.cam.x + W / z + 30, vy1 = S.cam.y + H / z + 30;
  const vis = (x, y, m) => x + m > vx0 && x - m < vx1 && y + m > vy0 && y - m < vy1;
  // seasonal sunlit band — the productive latitude that drifts through the year
  if(P.migrateOn && P.seasonsOn && S.worldH){
    const yPeak = solarPeakY(S.tick), band = S.worldH * 0.26;
    const grd = wctx.createLinearGradient(0, yPeak - band, 0, yPeak + band);
    grd.addColorStop(0, 'rgba(255,214,120,0)'); grd.addColorStop(0.5, 'rgba(255,214,120,0.06)'); grd.addColorStop(1, 'rgba(255,214,120,0)');
    wctx.fillStyle = grd; wctx.fillRect(0, Math.max(0, yPeak - band), S.worldW, band * 2);
  }
  // territories
  if(P.terrOn){
    wctx.lineWidth = 1 / z;
    for(const c of S.creatures){
      if(c.type !== 'carn' || !vis(c.homeX, c.homeY, c.g.territoryR)) continue;
      wctx.strokeStyle = `hsla(${c.g.hue | 0} 60% 55% / ${0.05 + c.g.territoriality * 0.06})`;
      wctx.beginPath(); wctx.arc(c.homeX, c.homeY, c.g.territoryR, 0, TAU); wctx.stroke();
    }
  }
  // water: caustic shimmer over the pool baked into the backdrop
  if(S.water.length && z > 0.3){
    wctx.lineWidth = 1.1 / z;
    for(let i = 0; i < S.water.length; i++){
      const w = S.water[i]; if(!vis(w.x, w.y, w.r)) continue;
      for(let k = 0; k < 3; k++){
        const ph = S.tick * 0.02 + h1(i * 17 + k) * TAU, rr = w.r * (0.32 + 0.24 * k + 0.05 * Math.sin(ph));
        wctx.strokeStyle = `rgba(178,222,248,${0.10 + 0.07 * Math.sin(ph * 1.3)})`;
        wctx.beginPath(); wctx.arc(w.x + Math.cos(ph) * w.r * 0.12, w.y + Math.sin(ph * 0.7) * w.r * 0.12, rr, ph, ph + 2.1); wctx.stroke();
      }
    }
  }
  // pheromone trails (faint scent field, drawn beneath everything living)
  if(P.pherOn && S.pher) drawPher(vx0, vy0, vx1, vy1);
  // nests — persistent home sites (soft mound + rim, coloured by species)
  if(P.nestsOn && S.nests.length){
    const NC = { herb: '143,196,74', omni: '169,127,224', carn: '221,111,87' };
    for(const nz of S.nests){
      if(!vis(nz.x, nz.y, nz.r)) continue;
      const rgb = NC[nz.type] || '160,160,160', a = clamp(nz.str / 12, 0.1, 0.6);
      const grd = wctx.createRadialGradient(nz.x, nz.y, 0, nz.x, nz.y, nz.r);
      grd.addColorStop(0, `rgba(${rgb},${0.16 * a + 0.05})`); grd.addColorStop(1, `rgba(${rgb},0)`);
      wctx.fillStyle = grd; wctx.beginPath(); wctx.arc(nz.x, nz.y, nz.r, 0, TAU); wctx.fill();
      wctx.strokeStyle = `rgba(${rgb},${0.25 + 0.4 * a})`; wctx.lineWidth = 1.4 / z;
      wctx.setLineDash([5 / z, 5 / z]); wctx.beginPath(); wctx.arc(nz.x, nz.y, nz.r, 0, TAU); wctx.stroke(); wctx.setLineDash([]);
    }
  }
  // shelters — built thicket refuges (a leafy dome that snags predators)
  if(P.buildOn && S.shelters.length){
    for(const sh of S.shelters){
      if(!vis(sh.x, sh.y, sh.r + 4)) continue;
      const a = clamp(sh.str / 14, 0.2, 0.7);
      wctx.fillStyle = `rgba(70,110,50,${0.14 * a + 0.04})`; wctx.beginPath(); wctx.arc(sh.x, sh.y, sh.r, 0, TAU); wctx.fill();
      wctx.strokeStyle = `rgba(96,150,70,${0.4 + 0.4 * a})`; wctx.lineWidth = 2.2 / z;
      wctx.beginPath(); wctx.arc(sh.x, sh.y, sh.r, 0, TAU); wctx.stroke();
      // little leafy tufts around the rim
      const tufts = 7; wctx.fillStyle = `rgba(80,130,55,${0.5 * a + 0.2})`;
      for(let g = 0; g < tufts; g++){ const ang = g / tufts * TAU, tx = sh.x + Math.cos(ang) * sh.r, ty = sh.y + Math.sin(ang) * sh.r;
        wctx.beginPath(); wctx.arc(tx, ty, sh.r * 0.16, 0, TAU); wctx.fill(); }
    }
  }
  // level-2 and level-3 world layers. Each module draws its own; the view object
  // is the only thing they share, and it is read-only to them.
  {
    const view = { z, vis, x0: vx0, y0: vy0, x1: vx1, y1: vy1 };
    // ground-altering layers draw first, so bodies and structures sit on top of
    // them: a burn scar is terrain, not scenery laid over the village
    if(P.terraOn) terra.drawWorld(wctx, view);
    if(P.fireOn) fire.drawWorld(wctx, view);
    if(P.villageOn) village.drawWorld(wctx, view);
    if(P.tradeOn) trade.drawWorld(wctx, view);
    if(P.tribeOn) tribe.drawWorld(wctx, view);
    if(P.propertyOn) property.drawWorld(wctx, view);
    if(P.marksOn) marks.drawWorld(wctx, view);
    if(P.toolsOn) tools.drawWorld(wctx, view);
    if(P.techOn) tech.drawWorld(wctx, view);
  }
  // caches — stored-food piles built by hoarders (size grows with the stock)
  if(P.hoardOn && S.caches.length){
    for(const ca of S.caches){
      const rr = clamp(4 + ca.amount * 0.12, 4, 16);
      if(!vis(ca.x, ca.y, rr + 4)) continue;
      wctx.fillStyle = 'rgba(214,176,96,0.9)'; wctx.strokeStyle = 'rgba(120,92,40,0.9)'; wctx.lineWidth = 1.4 / z;
      // a little heap of grains
      for(let g = 0; g < 3; g++){ const a = g * 2.1, ox = Math.cos(a) * rr * 0.4, oy = Math.sin(a) * rr * 0.4;
        wctx.beginPath(); wctx.arc(ca.x + ox, ca.y + oy, rr * 0.62, 0, TAU); wctx.fill(); wctx.stroke(); }
    }
  }
  // plants (one path, one fill — there can be ~900 of them)
  if(!flag('floraOn')){
    wctx.fillStyle = '#4a8a37'; wctx.beginPath();
    for(const f of S.food){ if(!vis(f.x, f.y, 3)) continue; wctx.moveTo(f.x + 2.1, f.y); wctx.arc(f.x, f.y, 2.1, 0, TAU); }
    wctx.fill();
  } else {
    // With evolving flora, a plant's colour and size advertise its chemistry —
    // a defended plant is a different-looking plant. Styles are quantised into
    // a handful of buckets so the whole crop is still a few fills, not one per
    // plant: the herbivores can tell them apart, the GPU need not.
    for(const b of FBUCK.values()) b.n = 0;
    for(const f of S.food){
      if(!vis(f.x, f.y, 4)) continue;
      const st = flora.plantStyle(f);
      const hq = Math.round((st.hue || 0) / 7), sq = Math.round((st.sat || 0) / 8),
            lq = Math.round((st.light || 0) / 6), rq = Math.round((st.r || 2.1) / 0.35);
      const key = ((hq * 20 + sq) * 20 + lq) * 24 + rq;
      let b = FBUCK.get(key);
      if(!b) FBUCK.set(key, b = { n: 0, r: 2.1, col: '#4a8a37', xs: [], ys: [] });
      if(!b.n){ b.r = rq * 0.35; b.col = `hsl(${hq * 7} ${sq * 8}% ${lq * 6}%)`; }
      b.xs[b.n] = f.x; b.ys[b.n] = f.y; b.n++;
    }
    for(const b of FBUCK.values()){
      if(!b.n) continue;
      wctx.fillStyle = b.col; wctx.beginPath();
      for(let i = 0; i < b.n; i++){ wctx.moveTo(b.xs[i] + b.r, b.ys[i]); wctx.arc(b.xs[i], b.ys[i], b.r, 0, TAU); }
      wctx.fill();
    }
    if(FBUCK.size > 96) for(const [k, b] of FBUCK) if(!b.n) FBUCK.delete(k);
  }
  // husbandry: faint tethers from livestock to their herder, plus a collar ring
  if(P.husbandOn){
    let herders = null;
    for(const c of S.creatures){
      if(!c.owner || !vis(c.x, c.y, 8)) continue;
      if(!herders){ herders = new Map(); for(const h of S.creatures) if(h.herd) herders.set(h.id, h); }
      const h = herders.get(c.owner);
      if(h){ wctx.strokeStyle = 'rgba(232,200,120,0.16)'; wctx.lineWidth = 1 / z; wctx.beginPath(); wctx.moveTo(c.x, c.y); wctx.lineTo(h.x, h.y); wctx.stroke(); }
      wctx.strokeStyle = 'rgba(232,200,120,0.5)'; wctx.lineWidth = 1.2 / z;
      wctx.beginPath(); wctx.arc(c.x, c.y, (c.rad || c.g.size) + 2.6, 0, TAU); wctx.stroke();
    }
  }
  // level of detail: with the whole system in view, individuals are neither legible
  // nor affordable — cross-fade to a biomass heat field coloured by feeding band
  const mz = minZoom(), lo = mz * 1.02, hi = Math.max(mz * 1.6, lo + 0.05);
  const dens = S.creatures.length > 60 ? clamp((hi - z) / (hi - lo), 0, 1) : 0;
  if(dens > 0.01){ drawDensity(dens); wld(z); }
  const crA = 1 - dens;
  // visible creatures, gathered once and reused by the shadow and body passes
  const vlist = [];
  if(crA > 0.02) for(const c of S.creatures){ if(vis(c.x, c.y, c.g.size + 6)) vlist.push(c); }
  // drop shadows, cast along the light direction — one path, one fill
  if(L && crA > 0.02 && L.shadow > 0.02 && z > 0.25){
    wctx.globalAlpha = crA; wctx.fillStyle = `rgba(3,5,10,${L.shadow})`; wctx.beginPath();
    for(const c of vlist){
      const s = c.rad || c.g.size; if(s * z < 2.5) continue;
      const ox = c.x + L.lx * (s * 0.6 + 1.5), oy = c.y + L.ly * (s * 0.6 + 1.5);
      wctx.moveTo(ox + s, oy); wctx.arc(ox, oy, s * 0.95, 0, TAU);
    }
    wctx.fill(); wctx.globalAlpha = 1;
  }
  // motion smears: a tapered wedge behind every fast mover, batched per feeding band
  if(fx && crA > 0.02 && z > 0.3 && vlist.length){
    const tri = { herb: [], omni: [], carn: [] };
    for(const c of vlist){
      const s = c.rad || c.g.size; if(s * z < 4) continue;
      const sp = Math.hypot(c.vx, c.vy); if(sp < 1.2) continue;
      const a = tri[c.type]; if(a) a.push(c, sp, s);
    }
    wctx.globalAlpha = crA;
    for(const k in tri){
      const a = tri[k]; if(!a.length) continue;
      wctx.fillStyle = `rgba(${PCOL[k]},0.2)`; wctx.beginPath();
      for(let i = 0; i < a.length; i += 3){
        const c = a[i], sp = a[i + 1], s = a[i + 2], ux = c.vx / sp, uy = c.vy / sp;
        const w = s * 0.6, tl = Math.min(sp * 5, s * 5.5);
        wctx.moveTo(c.x - uy * w, c.y + ux * w); wctx.lineTo(c.x + uy * w, c.y - ux * w); wctx.lineTo(c.x - ux * tl, c.y - uy * tl);
      }
      wctx.fill();
    }
    wctx.globalAlpha = 1;
  }
  // creatures (evolved morphology, level-of-detail by apparent size)
  const bubbles = [];
  if(crA < 0.99) wctx.globalAlpha = crA;
  for(const c of vlist){
    drawCreature(c, z, L, fx);
    if(P.bubblesOn && bubbles.length < 16 && (c.rad || c.g.size) * z >= 8 && c !== S.selected){
      const txt = ambientText(c); if(txt) bubbles.push({ x: c.x, y: c.y, r: c.rad || c.g.size, txt, small: true });
    }
  }
  wctx.globalAlpha = 1;
  // meteor shockwaves
  for(const e of S.effects){
    const k = e.t / e.max, rr = e.r * (1.15 - k * 0.15);
    wctx.strokeStyle = `rgba(255,${(150 * k) | 0},60,${k})`; wctx.lineWidth = 3 / z;
    wctx.beginPath(); wctx.arc(e.x, e.y, rr, 0, TAU); wctx.stroke();
    wctx.fillStyle = `rgba(255,190,90,${0.16 * k})`; wctx.beginPath(); wctx.arc(e.x, e.y, rr, 0, TAU); wctx.fill();
    e.t--;
  }
  if(S.effects.length) S.effects = S.effects.filter(e => e.t > 0);
  drawFlights(z);                     // dispersal arcs across the void
  if(fx) drawParts(z);
  // cinematic inspection: dim the world and lay the subject's senses over it
  if(S.selected && !S.selected.dead) inspect(S.selected, z);
  // night, season and drought in one fill; then the sun's bloom and the night glow
  washes(L);
  if(lit) nightGlow(vlist, L);
  scr();
  // thought bubbles (screen space, so text stays readable at any zoom)
  for(const bb of bubbles) drawBubble((bb.x - S.cam.x) * z, (bb.y - S.cam.y) * z - bb.r * z, bb.txt, bb.small);
}

// the selected creature, in context: its senses, its intent, its kin and its herd
function inspect(c, z){
  const W = S.W, H = S.H, r = c.rad || c.g.size;
  scr(); wctx.fillStyle = 'rgba(4,7,12,.34)'; wctx.fillRect(0, 0, W, H);
  wld(z);
  wctx.strokeStyle = 'rgba(236,231,215,.20)'; wctx.lineWidth = 1.4 / z;
  wctx.setLineDash([6 / z, 6 / z]); wctx.beginPath(); wctx.arc(c.x, c.y, c.g.sense, 0, TAU); wctx.stroke(); wctx.setLineDash([]);
  // kin (same lineage) and livestock (creatures this one keeps)
  let kin = 0;
  for(const o of S.creatures){
    if(o === c) continue;
    const own = o.owner === c.id, near = (o.x - c.x) ** 2 + (o.y - c.y) ** 2 < 78400;
    if(!own && (!near || o.lineage !== c.lineage || kin >= 14)) continue;
    if(!own) kin++;
    wctx.strokeStyle = own ? 'rgba(232,200,120,.55)' : 'rgba(140,200,230,.28)';
    wctx.lineWidth = (own ? 1.6 : 1) / z;
    wctx.beginPath(); wctx.moveTo(c.x, c.y); wctx.lineTo(o.x, o.y); wctx.stroke();
  }
  // intent: where it is heading, and how hard
  const sp = Math.hypot(c.vx, c.vy);
  if(sp > 0.05){
    const ux = c.vx / sp, uy = c.vy / sp, len = r + 10 + sp * 12;
    wctx.strokeStyle = 'rgba(255,226,150,.8)'; wctx.lineWidth = 2 / z;
    wctx.beginPath(); wctx.moveTo(c.x + ux * r, c.y + uy * r); wctx.lineTo(c.x + ux * len, c.y + uy * len); wctx.stroke();
    const a = Math.atan2(uy, ux), hl = 5 / z + r * 0.3;
    wctx.beginPath(); wctx.moveTo(c.x + ux * len, c.y + uy * len);
    wctx.lineTo(c.x + Math.cos(a + 2.6) * hl + ux * len, c.y + Math.sin(a + 2.6) * hl + uy * len);
    wctx.moveTo(c.x + ux * len, c.y + uy * len);
    wctx.lineTo(c.x + Math.cos(a - 2.6) * hl + ux * len, c.y + Math.sin(a - 2.6) * hl + uy * len);
    wctx.stroke();
  }
  blitGlow(wctx, '236,231,215', c.x, c.y, r * 4, 0.3);
  drawCreature(c, z, null, false);
  wctx.strokeStyle = '#ece7d7'; wctx.lineWidth = 2 / z;
  wctx.beginPath(); wctx.arc(c.x, c.y, r + 6, 0, TAU); wctx.stroke();
}

/* ---------- charts ---------- */
const chPop = el('chPop'), pctx = chPop.getContext('2d');
const chTr = el('chTrait'), tctx = chTr.getContext('2d');
const PAD = 6, CH_BG = '#0a0f0c', CH_GRID = 'rgba(150,190,150,.075)', CH_TXT = 'rgba(196,212,188,.6)';
function fitChart(cv, ctx){
  const r = cv.getBoundingClientRect();
  if(cv.width !== r.width * DPR || cv.height !== r.height * DPR){ cv.width = r.width * DPR; cv.height = r.height * DPR; ctx.setTransform(DPR, 0, 0, DPR, 0, 0); }
  return { w: r.width, h: r.height };
}
// dark panel with a faint grid and a baseline, so a glance gives scale as well as shape
function chartBg(ctx, w, h){
  ctx.clearRect(0, 0, w, h); ctx.fillStyle = CH_BG; ctx.fillRect(0, 0, w, h);
  ctx.lineWidth = 1; ctx.strokeStyle = CH_GRID; ctx.beginPath();
  for(let i = 1; i < 4; i++){ const y = Math.round(PAD + (h - 2 * PAD) * i / 4) + 0.5; ctx.moveTo(PAD, y); ctx.lineTo(w - PAD, y); }
  for(let i = 1; i < 6; i++){ const x = Math.round(PAD + (w - 2 * PAD) * i / 6) + 0.5; ctx.moveTo(x, PAD); ctx.lineTo(x, h - PAD); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(150,190,150,.2)'; ctx.beginPath();
  const y0 = Math.round(h - PAD) + 0.5; ctx.moveTo(PAD, y0); ctx.lineTo(w - PAD, y0); ctx.stroke();
}
// round the top of the axis up to a 1/2/5 step so the labels read as round numbers
const niceMax = v => { if(!(v > 0)) return 1; const e = 10 ** Math.floor(Math.log10(v)), m = v / e; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * e; };
const fmtN = v => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v >= 10 ? String(Math.round(v)) : String(Math.round(v * 100) / 100);
// scale at the top, floor at the bottom, and the newest value called out in its own colour
function chartAxis(ctx, w, h, hi, lo, cur, col){
  ctx.font = '9px ui-monospace,SFMono-Regular,Menlo,monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillStyle = CH_TXT; ctx.fillText(fmtN(hi), PAD + 2, PAD + 1);
  ctx.textBaseline = 'bottom'; ctx.fillText(fmtN(lo), PAD + 2, h - PAD - 1);
  if(cur !== undefined && isFinite(cur)){
    ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillStyle = col || CH_TXT;
    ctx.fillText(fmtN(cur), w - PAD - 2, PAD + 1);
  }
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}
// one series: an optional gradient area under the curve, then the line, then a head dot
function line(ctx, data, map, col, w, h, pad, fill){
  if(!data || data.length < 2) return;
  const n = data.length, sx = (w - 2 * pad) / (n - 1);
  let lx = pad, ly = 0;
  const path = () => { ctx.beginPath(); for(let i = 0; i < n; i++){ const x = pad + sx * i, y = map(data[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); lx = x; ly = y; } };
  path();
  if(fill){
    ctx.lineTo(lx, h - pad); ctx.lineTo(pad, h - pad); ctx.closePath();
    const g = ctx.createLinearGradient(0, pad, 0, h - pad);
    g.addColorStop(0, col + '4d'); g.addColorStop(1, col + '00');
    ctx.fillStyle = g; ctx.fill();
    path();
  }
  ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(lx, ly, 1.9, 0, TAU); ctx.fill();
}
export function drawCharts(){
  const pad = PAD;
  let { w, h } = fitChart(chPop, pctx);
  chartBg(pctx, w, h);
  let maxP = 10;
  for(const p of S.popHist){ if(p.h > maxP) maxP = p.h; if(p.c > maxP) maxP = p.c; if(p.o > maxP) maxP = p.o; if(p.f > maxP) maxP = p.f; }
  const top = niceMax(maxP), mp = v => h - pad - (h - 2 * pad) * clamp(v / top, 0, 1);
  line(pctx, S.popHist, p => mp(p.f), '#2f5322', w, h, pad, true);
  line(pctx, S.popHist, p => mp(p.h), '#8fc44a', w, h, pad, true);
  line(pctx, S.popHist, p => mp(p.o || 0), '#a97fe0', w, h, pad);
  line(pctx, S.popHist, p => mp(p.c), '#dd6f57', w, h, pad);
  const lp = S.popHist[S.popHist.length - 1];
  chartAxis(pctx, w, h, top, 0, lp ? lp.h + (lp.o || 0) + lp.c : undefined, '#cfe0c0');

  ({ w, h } = fitChart(chTr, tctx));
  chartBg(tctx, w, h);
  const mt = v => h - pad - (h - 2 * pad) * clamp(v, 0, 1);
  line(tctx, S.traitHist, v => mt(v.camo), '#8fc44a', w, h, pad, true);
  line(tctx, S.traitHist, v => mt(v.acu), '#dd6f57', w, h, pad);
  line(tctx, S.traitHist, v => mt(v.orn || 0), '#e668c8', w, h, pad);   // avg sexual ornament
  const lt = S.traitHist[S.traitHist.length - 1];
  chartAxis(tctx, w, h, 1, 0, lt ? lt.camo : undefined, '#8fc44a');
}

/* ---------- HUD ---------- */
const SEASON_ICON = ['🌱', '☀️', '🍂', '❄️'];
export function updateHUD(){
  let herbN = 0, omniN = 0, carnN = 0;
  for(const c of S.creatures){ if(c.type === 'carn') carnN++; else if(c.type === 'omni') omniN++; else herbN++; }
  el('sHerb').textContent = herbN; el('sCarn').textContent = carnN;
  const so = el('sOmni'); if(so) so.textContent = omniN;
  el('sFood').textContent = S.food.length;
  el('sTick').innerHTML = S.tick + '<small> t</small>'; el('sGen').textContent = S.maxGen; el('sPred').textContent = S.predations;
  const se = el('season');
  if(se){
    const si = seasonInfo(S.tick);
    let s = P.seasonsOn ? SEASON_ICON[si.idx] + ' ' + t(si.key) : '';
    if(P.dayNightOn) s += (s ? '  ' : '') + (dayInfo(S.tick).night ? '🌙' : '☀️');
    if(S.drought > 0) s += ' 🏜️';
    se.textContent = s;
  }
}

/* ---------- the tree of life ---------- */
// A spindle phylogram of S.phylo: time runs left to right, every species is a
// tapered body that begins where it split from its mother, swells with the
// numbers it reached and either ends in a point (extinct) or in a live cap
// whose thickness is how many of it are alive right now. It is the record of
// what this world actually did — the branchings are speciation events that
// happened, not a summary of the current population.
let _phCv;
function phyloCanvas(){
  const found = el('evPhylo');
  if(found) return found;
  if(_phCv !== undefined) return _phCv;
  const card = el('evolution') && el('evolution').querySelector('.card');
  if(!card) return (_phCv = null);
  const cap = document.createElement('p');
  cap.className = 'insp-sub';
  const lbl = t('evoPhylo');
  cap.textContent = lbl === 'evoPhylo' ? 'Albero filogenetico (l’albero della vita)' : lbl;
  const cv = document.createElement('canvas');
  cv.id = 'evPhylo';
  cv.style.cssText = 'width:100%;display:block;height:196px;background:#0c120c;border:1px solid var(--line);border-radius:9px;margin:6px 0 2px';
  const anchor = card.querySelector('.row');
  card.insertBefore(cap, anchor); card.insertBefore(cv, anchor);
  return (_phCv = cv);
}

const PH_MAX = 42;                                  // rows the panel can still resolve
const smooth = u => u * u * (3 - 2 * u);
// A daughter is drawn immediately below its mother, depth first, so a clade
// reads as one contiguous block of the canvas rather than scattered stripes.
function phyloRows(recs){
  const byId = new Map(); for(const r of recs) byId.set(r.id, r);
  // when there are more records than rows, keep what mattered: everything alive,
  // then the extinct lineages that were numerous or long-lived, then whatever
  // ancestors those need so their branches have something to hang from
  let show = recs;
  if(recs.length > PH_MAX){
    const score = r => (r.died ? 0.35 : 3) * (r.peak || 1) * Math.log(2 + ((r.died || S.tick) - r.born));
    const keep = new Set();
    for(const r of recs.slice().sort((a, b) => score(b) - score(a))){ if(keep.size >= PH_MAX) break; keep.add(r.id); }
    for(const id of [...keep]){ let p = byId.get(id), n = 0; while(p && p.parent && !keep.has(p.parent) && n++ < 24){ keep.add(p.parent); p = byId.get(p.parent); } }
    show = recs.filter(r => keep.has(r.id));
  }
  const kids = new Map(), shown = new Set(show.map(r => r.id));
  for(const r of show){
    const p = shown.has(r.parent) ? r.parent : 0;
    let a = kids.get(p); if(!a) kids.set(p, a = []); a.push(r);
  }
  for(const a of kids.values()) a.sort((x, y) => x.born - y.born || x.id - y.id);
  const rows = [], seen = new Set();
  const walk = pid => { const a = kids.get(pid); if(!a) return; for(const r of a){ if(seen.has(r.id)) continue; seen.add(r.id); rows.push(r); walk(r.id); } };
  walk(0);
  for(const r of show) if(!seen.has(r.id)){ seen.add(r.id); rows.push(r); }   // safety: orphaned by a graft
  return rows;
}

function drawPhylo(){
  const cv = phyloCanvas(); if(!cv) return;
  const recs = S.phylo || [];
  const rows = recs.length ? phyloRows(recs) : [];
  const N = rows.length;
  // the panel grows with the tree: a run with forty lineages needs more paper
  // than a run with four, and squeezing them would make the branches unreadable
  const want = clamp(Math.round(40 + N * 15), 132, 660) + 'px';
  if(cv.style.height !== want) cv.style.height = want;
  const ctx = cv.getContext('2d'), d = fitChart(cv, ctx), w = d.w, h = d.h;
  ctx.clearRect(0, 0, w, h); ctx.fillStyle = CH_BG; ctx.fillRect(0, 0, w, h);
  if(!N){
    const em = t('evoPhyloEmpty');
    ctx.fillStyle = '#6a746a'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(em === 'evoPhyloEmpty' ? 'Nessuna specie ancora' : em, w / 2, h / 2);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    return;
  }
  let live = 0; for(const r of recs) if(!r.died) live++;

  const top = 17, bot = h - 14;
  const rowH = (bot - top) / N, labels = rowH >= 10;
  const gut = labels ? 56 : 8;
  const x0 = PAD + 4, x1 = w - PAD - gut;
  let tMin = Infinity, peakMax = 1;
  for(const r of recs){ if(r.born < tMin) tMin = r.born; if(r.peak > peakMax) peakMax = r.peak; }
  const tMax = Math.max(S.tick, tMin + 1);
  const span = Math.max(1, tMax - tMin);
  const xs = t2 => x0 + (x1 - x0) * clamp((t2 - tMin) / span, 0, 1);
  const rowY = i => top + rowH * (i + 0.5);
  const maxHalf = Math.min(rowH * 0.36, 9);

  // deep time behind the tree, and the present as a hard edge on the right
  ctx.strokeStyle = CH_GRID; ctx.lineWidth = 1; ctx.beginPath();
  for(let i = 1; i < 6; i++){ const x = Math.round(x0 + (x1 - x0) * i / 6) + 0.5; ctx.moveTo(x, top - 8); ctx.lineTo(x, bot + 2); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(198,216,190,.14)'; ctx.beginPath();
  ctx.moveTo(Math.round(x1) + 0.5, top - 8); ctx.lineTo(Math.round(x1) + 0.5, bot + 2); ctx.stroke();

  const yOf = new Map();
  for(let i = 0; i < N; i++) yOf.set(rows[i].id, rowY(i));

  // branches first, so the connectors sit behind the bodies they join. A daughter
  // leaves her mother's flank at the tick she stopped interbreeding with her, so
  // the joint is drawn as a square elbow: it is a real event at a real date, not
  // a smooth blend of one population into another.
  for(let i = 0; i < N; i++){
    const r = rows[i], py = yOf.get(r.parent);
    if(py === undefined) continue;
    const bx = xs(r.born), y = rowY(i), jx = bx - 5;
    const dir = y > py ? 1 : -1, cr = Math.min(4.5, Math.abs(y - py) * 0.45);
    ctx.strokeStyle = `hsla(${r.hue | 0} 38% 60% / .55)`; ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(bx - 12, py);
    ctx.lineTo(jx - cr, py);
    ctx.quadraticCurveTo(jx, py, jx, py + dir * cr);
    ctx.lineTo(jx, y - dir * cr);
    ctx.quadraticCurveTo(jx, y, jx + cr, y);
    ctx.lineTo(bx + 1.5, y);
    ctx.stroke();
    ctx.fillStyle = `hsla(${r.hue | 0} 48% 72% / .7)`;
    ctx.beginPath(); ctx.arc(bx - 12, py, 1.4, 0, TAU); ctx.fill();
  }

  // The bodies. Every lineage emerges from a point, swells with the numbers it
  // actually reached, and ends either in a live cap as thick as its standing
  // population or — if it died — back in a point, with a bar for the last death.
  for(let i = 0; i < N; i++){
    const r = rows[i], y = rowY(i), dead = !!r.died;
    const a = xs(r.born), b = Math.max(a + 3, xs(dead ? r.died : tMax));
    const L = b - a;
    // area, not width, carries abundance — but even a rare lineage keeps a body,
    // otherwise the small species read as ruled lines instead of as animals
    const half = Math.max(1.5, maxHalf * Math.sqrt(clamp((r.peak || 1) / peakMax, 0.02, 1)));
    const endF = dead ? 0 : clamp((r.n || 0) / (r.peak || 1), 0.2, 1);
    const lead = Math.min(11, L * 0.38), tail = dead ? Math.min(15, L * 0.42) : 0;
    const spine = 0.5;
    const env = x => {
      const eIn = smooth(clamp((x - a) / lead, 0, 1));
      const eOut = dead ? smooth(clamp((b - x) / tail, 0, 1)) : 1;
      const ab = dead ? 1 : 1 + (endF - 1) * smooth(clamp(((x - a) / L - 0.35) / 0.65, 0, 1));
      return spine + (half - spine) * eIn * eOut * ab;
    };
    const n = Math.max(10, Math.min(40, Math.round(L / 3)));
    ctx.beginPath();
    for(let k = 0; k <= n; k++){ const x = a + L * k / n; k ? ctx.lineTo(x, y - env(x)) : ctx.moveTo(x, y - env(x)); }
    for(let k = n; k >= 0; k--){ const x = a + L * k / n; ctx.lineTo(x, y + env(x)); }
    ctx.closePath();
    const g = ctx.createLinearGradient(a, 0, b, 0);
    if(dead){
      g.addColorStop(0, `hsla(${r.hue | 0} 18% 44% / .5)`);
      g.addColorStop(1, `hsla(${r.hue | 0} 8% 30% / .3)`);
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = `hsla(${r.hue | 0} 12% 52% / .32)`; ctx.lineWidth = 0.8; ctx.stroke();
      ctx.strokeStyle = 'rgba(190,200,186,.28)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(b + 1.5, y - 2.8); ctx.lineTo(b + 1.5, y + 2.8); ctx.stroke();
    } else {
      g.addColorStop(0, `hsla(${r.hue | 0} 42% 34% / .75)`);
      g.addColorStop(0.5, `hsla(${r.hue | 0} 56% 47% / .9)`);
      g.addColorStop(1, `hsla(${r.hue | 0} 68% 58% / .98)`);
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = `hsla(${r.hue | 0} 72% 70% / .45)`; ctx.lineWidth = 0.8; ctx.stroke();
    }
    if(labels && !dead){
      ctx.font = '9px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillStyle = `hsla(${r.hue | 0} 48% 74% / .92)`;
      ctx.fillText(speciesName(r), x1 + 5, y);
    }
  }

  // scale: where the tree starts, where "now" is, and how much of it is still alive
  ctx.font = '9px ui-monospace,SFMono-Regular,Menlo,monospace'; ctx.textBaseline = 'bottom'; ctx.fillStyle = CH_TXT;
  ctx.textAlign = 'left'; ctx.fillText('t ' + fmtN(tMin), x0, h - 3);
  ctx.textAlign = 'right'; ctx.fillText(fmtN(tMax), x1, h - 3);
  ctx.fillStyle = 'rgba(196,212,188,.5)';
  ctx.fillText(live + ' ●   ' + (recs.length - live) + ' †', x1, top - 8);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}

/* ---------- evolution panel charts ---------- */
export function drawEvolution(){
  const H = S.evoHist; const pad = PAD;
  // average generation, and average brain size on the same panel
  let cv = el('evGen'), ctx = cv.getContext('2d'); let d = fitChart(cv, ctx);
  chartBg(ctx, d.w, d.h);
  let mg = 1; for(const e of H) if(e.gen > mg) mg = e.gen;
  const gtop = niceMax(mg);
  line(ctx, H, e => d.h - pad - (d.h - 2 * pad) * clamp(e.gen / gtop, 0, 1), '#74bccb', d.w, d.h, pad, true);
  line(ctx, H, e => d.h - pad - (d.h - 2 * pad) * clamp((e.nh || 0) / MAX_NH, 0, 1), '#e0a458', d.w, d.h, pad);
  chartAxis(ctx, d.w, d.h, gtop, 0, H.length ? H[H.length - 1].gen : undefined, '#74bccb');
  // sexual %
  cv = el('evSex'); ctx = cv.getContext('2d'); d = fitChart(cv, ctx);
  chartBg(ctx, d.w, d.h);
  line(ctx, H, e => d.h - pad - (d.h - 2 * pad) * clamp(e.sex, 0, 1), '#a97fe0', d.w, d.h, pad, true);
  chartAxis(ctx, d.w, d.h, 1, 0, H.length ? H[H.length - 1].sex : undefined, '#a97fe0');
  // diet distribution histogram (herbivore -> carnivore)
  cv = el('evDiet'); ctx = cv.getContext('2d'); d = fitChart(cv, ctx);
  chartBg(ctx, d.w, d.h);
  const B = 12, buckets = new Array(B).fill(0);
  for(const c of S.creatures){ const bi = Math.min(B - 1, Math.max(0, Math.floor((c.g.diet || 0) * B))); buckets[bi]++; }
  const dmax = Math.max(1, ...buckets), dbw = (d.w - 2 * pad) / B;
  for(let i = 0; i < B; i++){
    const hh = (d.h - 2 * pad) * (buckets[i] / dmax), hue = 120 * (1 - (i + 0.5) / B);
    ctx.fillStyle = `hsl(${hue | 0} 60% 52%)`; ctx.fillRect(pad + i * dbw + 1, d.h - pad - hh, dbw - 2, hh);
  }
  chartAxis(ctx, d.w, d.h, dmax, 0);
  // dominant lineages (bar chart of current population by lineage)
  cv = el('evLin'); ctx = cv.getContext('2d'); d = fitChart(cv, ctx);
  chartBg(ctx, d.w, d.h);
  const tally = new Map();
  for(const c of S.creatures){ tally.set(c.lineage, (tally.get(c.lineage) || 0) + 1); }
  const arr = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const mx = arr.length ? arr[0][1] : 1, bw = (d.w - 2 * pad) / Math.max(arr.length, 1);
  for(let i = 0; i < arr.length; i++){
    const [lid, cnt] = arr[i]; const h = (d.h - 2 * pad) * (cnt / mx);
    ctx.fillStyle = `hsl(${(lid * 47) % 360} 55% 55%)`;
    ctx.fillRect(pad + i * bw + 1, d.h - pad - h, bw - 2, h);
  }
  chartAxis(ctx, d.w, d.h, mx, 0);
  // average ornament per species over time — watch the three selection regimes:
  // omnivores spike (sexual runaway), carnivores climb (contest), herbivores settle (social)
  cv = el('evOrn'); if(cv){
    ctx = cv.getContext('2d'); d = fitChart(cv, ctx);
    chartBg(ctx, d.w, d.h);
    const map = v => d.h - pad - (d.h - 2 * pad) * clamp(v, 0, 1);
    line(ctx, S.ornHist, o => map(o.h), '#8fc44a', d.w, d.h, pad);
    line(ctx, S.ornHist, o => map(o.o), '#a97fe0', d.w, d.h, pad, true);
    line(ctx, S.ornHist, o => map(o.c), '#dd6f57', d.w, d.h, pad);
    const lo = S.ornHist[S.ornHist.length - 1];
    chartAxis(ctx, d.w, d.h, 1, 0, lo ? lo.o : undefined, '#a97fe0');
  }
  // constructive-behaviour genes over time (hoard / build / migrate / reciprocity)
  cv = el('evBeh'); if(cv){
    ctx = cv.getContext('2d'); d = fitChart(cv, ctx);
    chartBg(ctx, d.w, d.h);
    const map = v => d.h - pad - (d.h - 2 * pad) * clamp(v, 0, 1);
    line(ctx, S.behHist, b => map(b.hoard), '#d6b060', d.w, d.h, pad);
    line(ctx, S.behHist, b => map(b.build), '#96b060', d.w, d.h, pad);
    line(ctx, S.behHist, b => map(b.mig), '#e6c86a', d.w, d.h, pad);
    line(ctx, S.behHist, b => map(b.rec), '#74bccb', d.w, d.h, pad);
    line(ctx, S.behHist, b => map(b.disp), '#c98be0', d.w, d.h, pad);
    line(ctx, S.behHist, b => map(b.husb), '#e08b8b', d.w, d.h, pad);
    chartAxis(ctx, d.w, d.h, 1, 0);
  }
  // emergent lexicon: a 4x3 heat grid of how each channel deviates in each context
  cv = el('evLex'); if(cv){
    ctx = cv.getContext('2d'); d = fitChart(cv, ctx);
    ctx.clearRect(0, 0, d.w, d.h); ctx.fillStyle = CH_BG; ctx.fillRect(0, 0, d.w, d.h);
    const L = S.lex, rows = [t('lexThreat'), t('lexPrey'), t('lexFood'), t('lexCrowd')];
    const labW = 62, cols = 3, gx = (d.w - labW - 6) / cols, gy = (d.h - 16) / 4;
    ctx.font = '10px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'; ctx.textBaseline = 'middle';
    // channel headers
    ctx.fillStyle = '#8a978a'; ctx.textAlign = 'center';
    for(let k = 0; k < 3; k++) ctx.fillText('CH' + k, labW + gx * (k + 0.5), 8);
    const base = L && L.n > 4 ? [L.s[0] / L.n, L.s[1] / L.n, L.s[2] / L.n] : [0, 0, 0];
    for(let f = 0; f < 4; f++){
      const y = 16 + gy * f;
      ctx.fillStyle = '#c7d0c2'; ctx.textAlign = 'left';
      ctx.fillText(rows[f], 2, y + gy / 2);
      const cc = L ? L.ctx[f] : null;
      for(let k = 0; k < 3; k++){
        const x = labW + gx * k;
        let v = 0; if(cc && cc.n > 4) v = (cc.s[k] / cc.n) - base[k];   // deviation = "meaning"
        const mag = clamp(Math.abs(v) / 0.6, 0, 1);
        ctx.fillStyle = v >= 0 ? `rgba(143,196,74,${0.12 + 0.8 * mag})` : `rgba(221,111,87,${0.12 + 0.8 * mag})`;
        ctx.fillRect(x + 1, y + 1, gx - 2, gy - 2);
      }
    }
  }
  drawPhylo();
  // dialects: one swatch per dominant lineage, coloured by its accent vector.
  // Distinct colours = distinct accents (how each lineage vocalises when relaxed).
  cv = el('evDialect'); if(cv){
    ctx = cv.getContext('2d'); d = fitChart(cv, ctx);
    ctx.clearRect(0, 0, d.w, d.h); ctx.fillStyle = CH_BG; ctx.fillRect(0, 0, d.w, d.h);
    const ds = dialectStats(), top = ds.top;
    if(top.length){
      const bw = (d.w - 2 * pad) / top.length;
      ctx.font = '9px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      for(let i = 0; i < top.length; i++){
        const v = top[i].v;
        const r = 128 + clamp(v[0], -1, 1) * 120, g = 128 + clamp(v[1], -1, 1) * 120, bl = 128 + clamp(v[2], -1, 1) * 120;
        ctx.fillStyle = `rgb(${r | 0} ${g | 0} ${bl | 0})`;
        ctx.fillRect(pad + i * bw + 2, pad, bw - 4, d.h - 2 * pad - 12);
        ctx.fillStyle = `hsl(${(top[i].lin * 47) % 360} 55% 60%)`;
        ctx.fillText('#' + (top[i].lin % 1000), pad + i * bw + bw / 2, d.h - pad);
      }
    } else {
      ctx.fillStyle = '#6a746a'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(t('chronicleEmpty') || '—', d.w / 2, d.h / 2);
    }
  }
}

/* ---------- inspector: neural network drawing (variable hidden size) ---------- */
export function drawNetwork(cv, c){
  const ctx = cv.getContext('2d');
  const r = cv.getBoundingClientRect();
  const w = r.width || 300, h = r.height || 220;
  if(cv.width !== w * DPR || cv.height !== h * DPR){ cv.width = w * DPR; cv.height = h * DPR; }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if(!c){ return; }
  const nh = c.g.brain.nh, W = c.g.brain.w;
  const w2off = nh * NIN + nh;
  const colX = [24, w / 2, w - 24];
  const yOf = (i, count) => 14 + (h - 28) * (count <= 1 ? 0.5 : i / (count - 1));
  // input -> hidden edges (hidden-major: weight (i,j) at j*NIN + i)
  for(let j = 0; j < nh; j++){
    const y2 = yOf(j, nh);
    for(let i = 0; i < NIN; i++){
      const wgt = W[j * NIN + i], a = clamp(Math.abs(wgt) / 3, 0, 1) * 0.5;
      if(a < 0.04) continue;
      ctx.strokeStyle = wgt >= 0 ? `rgba(143,196,74,${a})` : `rgba(221,111,87,${a})`;
      ctx.lineWidth = clamp(Math.abs(wgt) / 2, 0.3, 2);
      ctx.beginPath(); ctx.moveTo(colX[0], yOf(i, NIN)); ctx.lineTo(colX[1], y2); ctx.stroke();
    }
  }
  // hidden -> output edges (weight (j,k) at w2off + j*NOUT + k)
  for(let j = 0; j < nh; j++){
    const y1 = yOf(j, nh);
    for(let k = 0; k < NOUT; k++){
      const wgt = W[w2off + j * NOUT + k], a = clamp(Math.abs(wgt) / 3, 0, 1) * 0.6;
      if(a < 0.04) continue;
      ctx.strokeStyle = wgt >= 0 ? `rgba(143,196,74,${a})` : `rgba(221,111,87,${a})`;
      ctx.lineWidth = clamp(Math.abs(wgt) / 2, 0.3, 2);
      ctx.beginPath(); ctx.moveTo(colX[1], y1); ctx.lineTo(colX[2], yOf(k, NOUT)); ctx.stroke();
    }
  }
  // nodes (coloured by live activation when available)
  const act = c.act && c.act.hid.length === nh ? c.act : null;
  const actCol = v => { const a = clamp(Math.abs(v), 0, 1); return v >= 0 ? `rgba(143,196,74,${0.2 + 0.8 * a})` : `rgba(221,111,87,${0.2 + 0.8 * a})`; };
  const node = (x, y, col, rr) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, rr || 3.2, 0, TAU); ctx.fill(); };
  for(let i = 0; i < NIN; i++) node(colX[0], yOf(i, NIN), act ? actCol(act.inp[i]) : '#74bccb', act ? 2.4 + 2 * clamp(Math.abs(act.inp[i]), 0, 1) : 3);
  for(let j = 0; j < nh; j++) node(colX[1], yOf(j, nh), act ? actCol(act.hid[j]) : '#ece7d7', act ? 2.4 + 2 * clamp(Math.abs(act.hid[j]), 0, 1) : 3);
  for(let k = 0; k < NOUT; k++) node(colX[2], yOf(k, NOUT), act ? actCol(act.out[k]) : '#e0a458', act ? 2.4 + 2 * clamp(Math.abs(act.out[k]), 0, 1) : 3);
}
