// World drawing, seasonal tint, charts, HUD and the inspector network viz
import { clamp, TAU, el } from './utils.js';
import { P, S, seasonInfo, dayInfo, clampCam } from './state.js';
import { NIN, NOUT, MAX_NH } from './nn.js';
import { t } from './i18n.js';

const world = el('world'), wctx = world.getContext('2d');
const DPR = Math.min(window.devicePixelRatio || 1, 2);

export function resize(){
  const r = world.getBoundingClientRect();
  S.W = r.width; S.H = r.height;
  world.width = S.W * DPR; world.height = S.H * DPR;
  if(S.worldW) clampCam();
}

const SEASON_TINT = ['rgba(120,190,90,.05)', 'rgba(230,200,120,.05)', 'rgba(210,150,80,.06)', 'rgba(140,180,220,.07)'];

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
function drawCreature(c, z){
  const g = c.g, col = bodyColor(c), appR = g.size * z;
  const fill = `hsl(${col.hue} ${col.sat}% ${col.light}%)`;
  const dark = `hsl(${col.hue} ${col.sat}% ${clamp(col.light - 20, 8, 60)}%)`;
  const sp = Math.hypot(c.vx, c.vy) || 1, cos = c.vx / sp, sin = c.vy / sp;

  // tier 0: far away — a simple dot
  if(appR < 3){
    wctx.fillStyle = fill; wctx.beginPath(); wctx.arc(c.x, c.y, g.size, 0, TAU); wctx.fill();
    if(c.sick > 0) sickRing(c, g, z);
    return;
  }

  const senseN = clamp((g.sense - 20) / 145, 0, 1), speedN = clamp((g.speed - 0.4) / 3, 0, 1);
  const shape = g.shape === undefined ? 0.3 : g.shape, pattern = g.pattern === undefined ? 0.5 : g.pattern;

  // legs (only when reasonably large): pairs increase with speed
  if(appR >= 6){
    const pairs = 2 + Math.round(speedN * 3), legLen = g.size * (0.55 + speedN * 0.9);
    wctx.strokeStyle = dark; wctx.lineWidth = Math.max(0.7, g.size * 0.13);
    for(let i = 0; i < pairs; i++){
      const tt = pairs > 1 ? (i / (pairs - 1) - 0.5) : 0;
      const bx = c.x - cos * tt * g.size * 1.2, by = c.y - sin * tt * g.size * 1.2;
      wctx.beginPath(); wctx.moveTo(bx, by); wctx.lineTo(bx - sin * legLen, by + cos * legLen); wctx.stroke();
      wctx.beginPath(); wctx.moveTo(bx, by); wctx.lineTo(bx + sin * legLen, by - cos * legLen); wctx.stroke();
    }
  }

  // body: 1-3 segments along the heading depending on the shape gene
  const segs = shape > 0.66 ? 3 : shape > 0.33 ? 2 : 1;
  wctx.fillStyle = fill;
  for(let s = 0; s < segs; s++){
    const off = -s * g.size * 0.85, r = g.size * (1 - s * 0.16);
    wctx.beginPath(); wctx.arc(c.x + cos * off, c.y + sin * off, r, 0, TAU); wctx.fill();
  }

  // markings from the pattern gene
  if(appR >= 6){
    if(pattern > 0.66){
      wctx.fillStyle = dark;
      for(let i = 0; i < 3; i++){ const a = i * 2.1; wctx.beginPath(); wctx.arc(c.x + Math.cos(a) * g.size * 0.4, c.y + Math.sin(a) * g.size * 0.4, g.size * 0.19, 0, TAU); wctx.fill(); }
    } else if(pattern < 0.33){
      wctx.strokeStyle = dark; wctx.lineWidth = g.size * 0.24;
      wctx.beginPath(); wctx.moveTo(c.x - sin * g.size * 0.7, c.y + cos * g.size * 0.7); wctx.lineTo(c.x + sin * g.size * 0.7, c.y - cos * g.size * 0.7); wctx.stroke();
    }
  }

  // eyes at the front, sized by vision
  const eyeR = g.size * (0.15 + senseN * 0.22), fx = c.x + cos * g.size * 0.6, fy = c.y + sin * g.size * 0.6;
  for(const side of [1, -1]){
    const ex = fx - sin * side * g.size * 0.34, ey = fy + cos * side * g.size * 0.34;
    wctx.fillStyle = '#f2efe6'; wctx.beginPath(); wctx.arc(ex, ey, eyeR, 0, TAU); wctx.fill();
    wctx.fillStyle = '#15130e'; wctx.beginPath(); wctx.arc(ex + cos * eyeR * 0.3, ey + sin * eyeR * 0.3, eyeR * 0.55, 0, TAU); wctx.fill();
  }

  // carnivore mouth
  if((g.diet || 0) > 0.6 && appR >= 5){
    const ang = Math.atan2(sin, cos);
    wctx.strokeStyle = '#2a0d09'; wctx.lineWidth = Math.max(0.8, g.size * 0.16);
    wctx.beginPath(); wctx.arc(fx, fy, g.size * 0.42, ang - 0.6, ang + 0.6); wctx.stroke();
  }

  if(c.sick > 0) sickRing(c, g, z);
}
function sickRing(c, g, z){
  wctx.strokeStyle = 'rgba(232,240,120,.85)'; wctx.lineWidth = 1.4 / z;
  wctx.beginPath(); wctx.arc(c.x, c.y, g.size + 3.5, 0, TAU); wctx.stroke();
}

export function draw(){
  const W = S.W, H = S.H, z = S.cam.zoom;
  // clear + seasonal wash in screen space
  wctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  wctx.clearRect(0, 0, W, H);
  if(P.seasonsOn){ wctx.fillStyle = SEASON_TINT[seasonInfo(S.tick).idx]; wctx.fillRect(0, 0, W, H); }
  if(P.dayNightOn){ const dk = (1 - dayInfo(S.tick).light) * 0.42; wctx.fillStyle = `rgba(12,22,50,${dk})`; wctx.fillRect(0, 0, W, H); }
  if(S.drought > 0){ wctx.fillStyle = 'rgba(150,95,35,.13)'; wctx.fillRect(0, 0, W, H); }
  // world transform (camera)
  wctx.setTransform(DPR * z, 0, 0, DPR * z, -S.cam.x * z * DPR, -S.cam.y * z * DPR);
  // visible bounds (for culling)
  const vx0 = S.cam.x - 30, vy0 = S.cam.y - 30, vx1 = S.cam.x + W / z + 30, vy1 = S.cam.y + H / z + 30;
  const vis = (x, y, m) => x + m > vx0 && x - m < vx1 && y + m > vy0 && y - m < vy1;
  // world border
  wctx.strokeStyle = 'rgba(120,150,110,.18)'; wctx.lineWidth = 2 / z;
  wctx.strokeRect(0, 0, S.worldW, S.worldH);
  // biomes (fertility tint)
  for(const bm of S.biomes){
    if(!vis(bm.x, bm.y, bm.r)) continue;
    const grd = wctx.createRadialGradient(bm.x, bm.y, 0, bm.x, bm.y, bm.r);
    const col = bm.fert >= 0 ? '120,190,90' : '150,120,70';
    const a = Math.min(0.2, Math.abs(bm.fert) * 0.22);
    grd.addColorStop(0, `rgba(${col},${a})`); grd.addColorStop(1, `rgba(${col},0)`);
    wctx.fillStyle = grd; wctx.beginPath(); wctx.arc(bm.x, bm.y, bm.r, 0, TAU); wctx.fill();
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
  // water (slows creatures)
  for(const w of S.water){
    if(!vis(w.x, w.y, w.r)) continue;
    wctx.fillStyle = 'rgba(56,116,178,.42)'; wctx.beginPath(); wctx.arc(w.x, w.y, w.r, 0, TAU); wctx.fill();
    wctx.strokeStyle = 'rgba(120,180,220,.5)'; wctx.lineWidth = 1.5 / z; wctx.stroke();
  }
  // rocks (terrain)
  for(const rk of S.rocks){
    if(!vis(rk.x, rk.y, rk.r)) continue;
    wctx.fillStyle = '#3a3f42'; wctx.beginPath(); wctx.arc(rk.x, rk.y, rk.r, 0, TAU); wctx.fill();
    wctx.strokeStyle = '#4c5257'; wctx.lineWidth = 1.5 / z; wctx.stroke();
  }
  // plants
  wctx.fillStyle = '#3a6b2e';
  for(const f of S.food){ if(!vis(f.x, f.y, 3)) continue; wctx.beginPath(); wctx.arc(f.x, f.y, 2.1, 0, TAU); wctx.fill(); }
  // creatures (evolved morphology, level-of-detail by apparent size)
  for(const c of S.creatures){
    if(!vis(c.x, c.y, c.g.size + 6)) continue;
    drawCreature(c, z);
  }
  // meteor shockwaves
  for(const e of S.effects){
    const k = e.t / e.max, rr = e.r * (1.15 - k * 0.15);
    wctx.strokeStyle = `rgba(255,${(150 * k) | 0},60,${k})`; wctx.lineWidth = 3 / z;
    wctx.beginPath(); wctx.arc(e.x, e.y, rr, 0, TAU); wctx.stroke();
    wctx.fillStyle = `rgba(255,190,90,${0.16 * k})`; wctx.beginPath(); wctx.arc(e.x, e.y, rr, 0, TAU); wctx.fill();
    e.t--;
  }
  if(S.effects.length) S.effects = S.effects.filter(e => e.t > 0);
  // selection highlight
  if(S.selected && !S.selected.dead){
    const c = S.selected;
    wctx.strokeStyle = '#ece7d7'; wctx.lineWidth = 2;
    wctx.beginPath(); wctx.arc(c.x, c.y, c.g.size + 6, 0, TAU); wctx.stroke();
  }
}

/* ---------- charts ---------- */
const chPop = el('chPop'), pctx = chPop.getContext('2d');
const chTr = el('chTrait'), tctx = chTr.getContext('2d');
function fitChart(cv, ctx){
  const r = cv.getBoundingClientRect();
  if(cv.width !== r.width * DPR || cv.height !== r.height * DPR){ cv.width = r.width * DPR; cv.height = r.height * DPR; ctx.setTransform(DPR, 0, 0, DPR, 0, 0); }
  return { w: r.width, h: r.height };
}
function line(ctx, data, map, col, w, h, pad){
  if(data.length < 2) return;
  ctx.strokeStyle = col; ctx.lineWidth = 1.7; ctx.beginPath();
  for(let i = 0; i < data.length; i++){ const x = pad + (w - 2 * pad) * i / (data.length - 1), y = map(data[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  ctx.stroke();
}
export function drawCharts(){
  let { w, h } = fitChart(chPop, pctx);
  pctx.clearRect(0, 0, w, h); pctx.fillStyle = '#0c120c'; pctx.fillRect(0, 0, w, h);
  const pad = 6; let maxP = 10;
  for(const p of S.popHist){ if(p.h > maxP) maxP = p.h; if(p.c > maxP) maxP = p.c; if(p.o > maxP) maxP = p.o; if(p.f > maxP) maxP = p.f; }
  line(pctx, S.popHist, p => h - pad - (h - 2 * pad) * (p.f / maxP), '#2f5322', w, h, pad);
  line(pctx, S.popHist, p => h - pad - (h - 2 * pad) * (p.h / maxP), '#8fc44a', w, h, pad);
  line(pctx, S.popHist, p => h - pad - (h - 2 * pad) * ((p.o || 0) / maxP), '#a97fe0', w, h, pad);
  line(pctx, S.popHist, p => h - pad - (h - 2 * pad) * (p.c / maxP), '#dd6f57', w, h, pad);

  ({ w, h } = fitChart(chTr, tctx));
  tctx.clearRect(0, 0, w, h); tctx.fillStyle = '#0c120c'; tctx.fillRect(0, 0, w, h);
  line(tctx, S.traitHist, v => h - pad - (h - 2 * pad) * v.camo, '#8fc44a', w, h, pad);
  line(tctx, S.traitHist, v => h - pad - (h - 2 * pad) * v.acu, '#dd6f57', w, h, pad);
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

/* ---------- evolution panel charts ---------- */
export function drawEvolution(){
  const H = S.evoHist; const pad = 6;
  // average generation
  let cv = el('evGen'), ctx = cv.getContext('2d'); let d = fitChart(cv, ctx);
  ctx.clearRect(0, 0, d.w, d.h); ctx.fillStyle = '#0c120c'; ctx.fillRect(0, 0, d.w, d.h);
  let mg = 1; for(const e of H) if(e.gen > mg) mg = e.gen;
  line(ctx, H, e => d.h - pad - (d.h - 2 * pad) * (e.gen / mg), '#74bccb', d.w, d.h, pad);
  line(ctx, H, e => d.h - pad - (d.h - 2 * pad) * ((e.nh || 0) / MAX_NH), '#e0a458', d.w, d.h, pad);   // avg brain size
  // sexual %
  cv = el('evSex'); ctx = cv.getContext('2d'); d = fitChart(cv, ctx);
  ctx.clearRect(0, 0, d.w, d.h); ctx.fillStyle = '#0c120c'; ctx.fillRect(0, 0, d.w, d.h);
  line(ctx, H, e => d.h - pad - (d.h - 2 * pad) * e.sex, '#a97fe0', d.w, d.h, pad);
  // diet distribution histogram (herbivore -> carnivore)
  cv = el('evDiet'); ctx = cv.getContext('2d'); d = fitChart(cv, ctx);
  ctx.clearRect(0, 0, d.w, d.h); ctx.fillStyle = '#0c120c'; ctx.fillRect(0, 0, d.w, d.h);
  const B = 12, buckets = new Array(B).fill(0);
  for(const c of S.creatures){ const bi = Math.min(B - 1, Math.max(0, Math.floor((c.g.diet || 0) * B))); buckets[bi]++; }
  const dmax = Math.max(1, ...buckets), dbw = (d.w - 2 * pad) / B;
  for(let i = 0; i < B; i++){
    const hh = (d.h - 2 * pad) * (buckets[i] / dmax), hue = 120 * (1 - (i + 0.5) / B);
    ctx.fillStyle = `hsl(${hue | 0} 60% 52%)`; ctx.fillRect(pad + i * dbw + 1, d.h - pad - hh, dbw - 2, hh);
  }
  // dominant lineages (bar chart of current population by lineage)
  cv = el('evLin'); ctx = cv.getContext('2d'); d = fitChart(cv, ctx);
  ctx.clearRect(0, 0, d.w, d.h); ctx.fillStyle = '#0c120c'; ctx.fillRect(0, 0, d.w, d.h);
  const tally = new Map();
  for(const c of S.creatures){ tally.set(c.lineage, (tally.get(c.lineage) || 0) + 1); }
  const arr = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const mx = arr.length ? arr[0][1] : 1, bw = (d.w - 2 * pad) / Math.max(arr.length, 1);
  for(let i = 0; i < arr.length; i++){
    const [lid, cnt] = arr[i]; const h = (d.h - 2 * pad) * (cnt / mx);
    ctx.fillStyle = `hsl(${(lid * 47) % 360} 55% 55%)`;
    ctx.fillRect(pad + i * bw + 1, d.h - pad - h, bw - 2, h);
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
