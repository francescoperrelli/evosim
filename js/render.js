// Disegno del mondo, grafici e HUD numerico
import { clamp, TAU, el } from './utils.js';
import { P, S } from './state.js';

const world = el('world'), wctx = world.getContext('2d');
const DPR = Math.min(window.devicePixelRatio || 1, 2);

export function resize(){
  const r = world.getBoundingClientRect();
  S.W = r.width; S.H = r.height;
  world.width = S.W * DPR; world.height = S.H * DPR;
  wctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

export function draw(){
  const W = S.W, H = S.H;
  wctx.clearRect(0, 0, W, H);
  // territori (dietro)
  if(P.terrOn){
    wctx.lineWidth = 1;
    for(const c of S.creatures){
      if(c.type !== 'carn') continue;
      wctx.strokeStyle = `hsla(${c.g.hue | 0} 60% 55% / ${0.05 + c.g.territoriality * 0.06})`;
      wctx.beginPath(); wctx.arc(c.homeX, c.homeY, c.g.territoryR, 0, TAU); wctx.stroke();
    }
  }
  // piante
  wctx.fillStyle = '#3a6b2e';
  for(const f of S.food){ wctx.beginPath(); wctx.arc(f.x, f.y, 2.1, 0, TAU); wctx.fill(); }
  // creature
  for(const c of S.creatures){
    const g = c.g;
    if(c.type === 'herb'){
      const camo = P.mimicOn ? g.camo : 0;
      const hue = g.hue * (1 - camo) + 120 * camo;
      const sat = (62 - camo * 30);
      const light = clamp((38 + c.energy * 0.18) * (1 - camo * 0.35), 24, 70);
      wctx.fillStyle = `hsl(${hue | 0} ${sat}% ${light}%)`;
      wctx.beginPath(); wctx.arc(c.x, c.y, g.size, 0, TAU); wctx.fill();
    } else {
      const light = clamp(40 + c.energy * 0.1, 42, 66);
      wctx.fillStyle = `hsl(${g.hue | 0} 68% ${light}%)`;
      wctx.beginPath(); wctx.arc(c.x, c.y, g.size, 0, TAU); wctx.fill();
      wctx.strokeStyle = `hsla(${g.hue | 0} 80% 72% / .55)`; wctx.lineWidth = 1.2;
      wctx.beginPath(); wctx.arc(c.x, c.y, g.size + 2.2, 0, TAU); wctx.stroke();
    }
    wctx.strokeStyle = `hsla(${g.hue | 0} 60% 78% / .5)`; wctx.lineWidth = 1.3;
    wctx.beginPath(); wctx.moveTo(c.x, c.y);
    wctx.lineTo(c.x + c.vx / g.speed * (g.size + 3), c.y + c.vy / g.speed * (g.size + 3)); wctx.stroke();
  }
}

/* ---------- grafici ---------- */
const chPop = el('chPop'), pctx = chPop.getContext('2d');
const chTr = el('chTrait'), tctx = chTr.getContext('2d');
function fitChart(cv, ctx){
  const r = cv.getBoundingClientRect();
  if(cv.width !== r.width * DPR || cv.height !== r.height * DPR){
    cv.width = r.width * DPR; cv.height = r.height * DPR; ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  return { w: r.width, h: r.height };
}
function line(ctx, data, map, col, w, h, pad){
  if(data.length < 2) return;
  ctx.strokeStyle = col; ctx.lineWidth = 1.7; ctx.beginPath();
  for(let i = 0; i < data.length; i++){
    const x = pad + (w - 2 * pad) * i / (data.length - 1), y = map(data[i]);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.stroke();
}
export function drawCharts(){
  let { w, h } = fitChart(chPop, pctx);
  pctx.clearRect(0, 0, w, h); pctx.fillStyle = '#0c120c'; pctx.fillRect(0, 0, w, h);
  const pad = 6; let maxP = 10;
  for(const p of S.popHist){ if(p.h > maxP) maxP = p.h; if(p.c > maxP) maxP = p.c; if(p.f > maxP) maxP = p.f; }
  line(pctx, S.popHist, p => h - pad - (h - 2 * pad) * (p.f / maxP), '#2f5322', w, h, pad);
  line(pctx, S.popHist, p => h - pad - (h - 2 * pad) * (p.h / maxP), '#8fc44a', w, h, pad);
  line(pctx, S.popHist, p => h - pad - (h - 2 * pad) * (p.c / maxP), '#dd6f57', w, h, pad);

  ({ w, h } = fitChart(chTr, tctx));
  tctx.clearRect(0, 0, w, h); tctx.fillStyle = '#0c120c'; tctx.fillRect(0, 0, w, h);
  line(tctx, S.traitHist, v => h - pad - (h - 2 * pad) * v.camo, '#8fc44a', w, h, pad);
  line(tctx, S.traitHist, v => h - pad - (h - 2 * pad) * v.acu, '#dd6f57', w, h, pad);
}

/* ---------- HUD ---------- */
export function updateHUD(){
  let herbN = 0, carnN = 0;
  for(const c of S.creatures){ c.type === 'carn' ? carnN++ : herbN++; }
  el('sHerb').textContent = herbN; el('sCarn').textContent = carnN; el('sFood').textContent = S.food.length;
  el('sTick').innerHTML = S.tick + '<small> t</small>'; el('sGen').textContent = S.maxGen; el('sPred').textContent = S.predations;
}
