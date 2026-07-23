// UI: overlays, controls, menu, language, inspect mode, creature inspector
import { el, rnd, clamp } from './utils.js';
import { P, S, LANG_KEY, screenToWorld, zoomAt, clampCam } from './state.js';
import { seed, saveLocal, hasSave, loadLocal, clearLocal, snapshot, restore, meteor, startDrought, startEpidemic, addRock, addWater, clearTerrain } from './world.js';
import { makeCreature, randomGenome } from './genome.js';
import { drawNetwork, drawEvolution } from './render.js';
import { I18N, t, setLang, getLang } from './i18n.js';

/* ---------- overlays ---------- */
function show(id){ el(id).classList.add('show'); }
function hide(id){ el(id).classList.remove('show'); }
function hideAll(){ ['menu','tutorial','options','inspector','evolution','events'].forEach(hide); }
export { show };

let toastT = null;
function toast(msg){
  const box = el('toast'); box.textContent = msg; box.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => box.classList.remove('show'), 2200);
}

export function syncPlayBtn(){
  const b = el('btnPlay');
  b.innerHTML = S.running ? t('pause') : t('resumeBtn');
  b.classList.toggle('primary', S.running);
}

export function refreshMenu(){
  el('mResume').style.display = S.creatures.length ? '' : 'none';
  el('mLoad').style.display = hasSave() ? '' : 'none';
}

function syncControls(){
  const set = (id, val) => { const e = el(id); if(e){ e.value = val; e.dispatchEvent(new Event('input')); } };
  set('rFood', P.foodRate); set('rMut', Math.round(P.mut * 100));
  [['tPred','predatorsOn'],['tOmni','omnivoresOn'],['tFlock','flocksOn'],['tTerr','terrOn'],['tMimic','mimicOn'],['tSeason','seasonsOn'],['tDay','dayNightOn']]
    .forEach(([id, k]) => { const e = el(id); if(e) e.checked = P[k]; });
}

/* ---------- language ---------- */
export function applyLang(){
  const lang = getLang();
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(node => {
    const k = node.getAttribute('data-i18n');
    if(I18N[lang][k] !== undefined) node.innerHTML = I18N[lang][k];
  });
  el('rFood').dispatchEvent(new Event('input'));
  el('rMut').dispatchEvent(new Event('input'));
  el('rSpeed').dispatchEvent(new Event('input'));
  el('btnMode').innerHTML = S.tool === 'inspect' ? t('modeInspect') : t('modeFood');
  syncPlayBtn();
  document.querySelectorAll('.lang button').forEach(b => b.classList.toggle('on', b.getAttribute('data-lang') === lang));
  try{ localStorage.setItem(LANG_KEY, lang); }catch(e){}
}

/* ---------- panel controls ---------- */
el('btnPlay').onclick = function(){ S.running = !S.running; syncPlayBtn(); };
el('rSpeed').oninput = function(){ S.stepsPerFrame = +this.value; el('vSpeed').textContent = (S.stepsPerFrame || '0') + '×'; };
el('rFood').oninput = function(){ P.foodRate = +this.value;
  el('vFood').textContent = this.value == 0 ? t('lvNone') : this.value < 3 ? t('lvLow') : this.value < 7 ? t('lvMed') : t('lvHigh'); };
el('rMut').oninput = function(){ P.mut = +this.value / 100; el('vMut').textContent = this.value + '%'; };

const bindToggle = (id, key, onOff) => { el(id).onchange = function(){ P[key] = this.checked; if(onOff) onOff(this.checked); }; };
const ensureSpecies = (type, count, min) => {
  if(!S.creatures.some(c => c.type === type)){
    let herb = S.creatures.filter(c => c.type === 'herb').length;
    if(herb >= min) for(let i = 0; i < count; i++) S.creatures.push(makeCreature(rnd(0, S.W), rnd(0, S.H), type, randomGenome(type), 0));
  }
};
bindToggle('tPred', 'predatorsOn', on => { if(!on) S.creatures = S.creatures.filter(c => c.type !== 'carn'); else ensureSpecies('carn', P.carnStart, 25); });
bindToggle('tOmni', 'omnivoresOn', on => { if(!on) S.creatures = S.creatures.filter(c => c.type !== 'omni'); else ensureSpecies('omni', P.omniStart, 20); });
bindToggle('tFlock', 'flocksOn'); bindToggle('tTerr', 'terrOn'); bindToggle('tMimic', 'mimicOn'); bindToggle('tSeason', 'seasonsOn'); bindToggle('tDay', 'dayNightOn');

el('btnSave').onclick = () => toast(saveLocal() ? t('saved') : t('noStore'));
el('btnOpt').onclick = () => show('options');
el('btnEvo').onclick = () => show('evolution');
el('btnEvents').onclick = () => show('events');
el('btnMenu').onclick = () => { refreshMenu(); show('menu'); };

/* ---------- events (play-god) ---------- */
el('evtClose').onclick = () => hide('events');
el('btnMeteor').onclick = () => { S.tool = 'meteor'; updateModeBtn(); hide('events'); toast(t('evMeteorHint')); };
el('btnRock').onclick = () => { S.tool = 'rock'; updateModeBtn(); hide('events'); toast(t('evRockHint')); };
el('btnWater').onclick = () => { S.tool = 'water'; updateModeBtn(); hide('events'); toast(t('evWaterHint')); };
el('btnDrought').onclick = () => { startDrought(); hide('events'); toast(t('evDroughtOn')); };
el('btnEpidemic').onclick = () => { startEpidemic(); hide('events'); toast(t('evEpidemicOn')); };
el('btnClearTerrain').onclick = () => { clearTerrain(); toast(t('evCleared')); };
function updateModeBtn(){
  const on = S.tool === 'inspect';
  el('btnMode').innerHTML = on ? t('modeInspect') : t('modeFood');
  el('btnMode').classList.toggle('on', on);
}
el('btnMode').onclick = function(){ S.tool = S.tool === 'inspect' ? 'plant' : 'inspect'; updateModeBtn(); };

/* ---------- menu ---------- */
function resetCam(){ S.cam.x = 0; S.cam.y = 0; S.cam.zoom = 1; clampCam(); }
el('mNew').onclick = () => { clearLocal(); seed(); resetCam(); saveLocal(); hideAll(); S.running = true; syncPlayBtn(); };
el('mResume').onclick = () => { hideAll(); S.running = true; syncPlayBtn(); };
el('mTut').onclick = () => show('tutorial');
el('mLoad').onclick = () => { if(loadLocal()){ syncControls(); clampCam(); toast(t('loaded')); hideAll(); S.running = true; syncPlayBtn(); } else toast(t('noSave')); };
el('mSave').onclick = () => toast(saveLocal() ? t('saved') : t('noStore'));
el('mOpt').onclick = () => show('options');
el('mEvo').onclick = () => show('evolution');
el('mEvents').onclick = () => show('events');
el('evClose').onclick = () => hide('evolution');
el('tClose').onclick = () => { hide('tutorial'); if(!S.creatures.length){ seed(); saveLocal(); } hideAll(); S.running = true; syncPlayBtn(); };

/* ---------- options: export / import ---------- */
el('oClose').onclick = () => hide('options');
el('oExport').onclick = () => {
  const blob = new Blob([JSON.stringify(snapshot())], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'evosim-mondo.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); toast(t('exported'));
};
el('oImport').onclick = () => el('fileImport').click();
el('fileImport').onchange = function(){
  const f = this.files[0]; if(!f) return;
  const rd = new FileReader();
  rd.onload = () => { try{ if(restore(JSON.parse(rd.result))){ syncControls(); clampCam(); saveLocal(); toast(t('imported')); hide('options'); } else toast(t('badFile')); }
    catch(e){ toast(t('badFile')); } };
  rd.readAsText(f); this.value = '';
};

/* ---------- language buttons ---------- */
document.querySelectorAll('.lang button').forEach(b => { b.onclick = () => { setLang(b.getAttribute('data-lang')); applyLang(); }; });

/* ---------- inspector ---------- */
const TYPE_KEY = { herb: 'typeHerb', omni: 'typeOmni', carn: 'typeCarn' };
el('inspClose').onclick = () => { hide('inspector'); S.selected = null; };

function selectAt(mx, my){
  let best = null, bestD = 1e9;
  for(const c of S.creatures){
    const d = (c.x - mx) ** 2 + (c.y - my) ** 2;
    const r = c.g.size + 10;
    if(d < r * r && d < bestD){ bestD = d; best = c; }
  }
  if(best){ S.selected = best; show('inspector'); refreshInspector(); }
}

const barPct = (v, lo, hi) => clamp((v - lo) / (hi - lo), 0, 1) * 100;
export function refreshInspector(){
  if(!el('inspector').classList.contains('show')) return;
  const c = S.selected;
  if(!c || c.dead){ hide('inspector'); S.selected = null; return; }
  const g = c.g;
  el('inspDot').style.background = `hsl(${g.hue | 0} 60% 55%)`;
  el('inspType').textContent = t(TYPE_KEY[c.type]);
  el('inspMeta').textContent = `${t('lblEnergy')} ${c.energy | 0} · ${t('lblAge')} ${c.age} · ${t('lblGen')} ${c.gen} · ${g.sexual > 0.5 ? t('reproSex') : t('reproAsex')}`;
  el('bgSpeed').style.width = barPct(g.speed, 0.4, 3.4) + '%';
  el('bgVision').style.width = barPct(g.sense, 20, 165) + '%';
  el('bgSize').style.width = barPct(g.size, 2.5, 9) + '%';
  el('bgSocial').style.width = (g.sociality * 100) + '%';
  el('bgCamo').style.width = (g.camo * 100) + '%';
  el('bgTerr').style.width = (g.territoriality * 100) + '%';
  el('bgAcuity').style.width = (g.acuity * 100) + '%';
  el('bgSexual').style.width = (g.sexual * 100) + '%';
  drawNetwork(el('inspNet'), c);
}

export function refreshEvolution(){
  if(!el('evolution').classList.contains('show')) return;
  el('recGen').textContent = S.records.maxGen;
  el('recAge').textContent = S.records.oldestAge;
  el('recKids').textContent = S.records.maxKids;
  el('recLin').textContent = new Set(S.creatures.map(c => c.lineage)).size;
  drawEvolution();
}

/* ---------- camera: pan / zoom / tap ---------- */
const world = el('world');
const pointers = new Map();
let dragging = false, downX = 0, downY = 0, downT = 0, moved = 0, pinchDist = 0, lastRockX = 0, lastRockY = 0;
const now = () => (window.performance ? performance.now() : 0);
function twoPts(){ const it = pointers.values(); return [it.next().value, it.next().value]; }
function twoDist(){ const [a, b] = twoPts(); return Math.hypot(a.x - b.x, a.y - b.y); }
function twoMid(){ const [a, b] = twoPts(); return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

world.addEventListener('pointerdown', e => {
  try{ world.setPointerCapture(e.pointerId); }catch(_){}
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if(pointers.size === 1){ dragging = false; downX = e.clientX; downY = e.clientY; downT = now(); moved = 0; }
  else if(pointers.size === 2){ pinchDist = twoDist(); }
});
world.addEventListener('pointermove', e => {
  const prev = pointers.get(e.pointerId); if(!prev) return;
  const nx = e.clientX, ny = e.clientY;
  if(pointers.size >= 2){
    pointers.set(e.pointerId, { x: nx, y: ny });
    const d = twoDist();
    if(pinchDist > 0){ const m = twoMid(), r = world.getBoundingClientRect(); zoomAt(m.x - r.left, m.y - r.top, d / pinchDist); }
    pinchDist = d; return;
  }
  const dx = nx - prev.x, dy = ny - prev.y;
  pointers.set(e.pointerId, { x: nx, y: ny });
  moved += Math.abs(dx) + Math.abs(dy);
  if(moved > 6) dragging = true;
  if(dragging){
    if(S.tool === 'rock' || S.tool === 'water'){
      const r = world.getBoundingClientRect(), w = screenToWorld(nx - r.left, ny - r.top);
      if((w.x - lastRockX) ** 2 + (w.y - lastRockY) ** 2 > 500){ (S.tool === 'water' ? addWater : addRock)(w.x, w.y); lastRockX = w.x; lastRockY = w.y; }
    } else { S.cam.x -= dx / S.cam.zoom; S.cam.y -= dy / S.cam.zoom; clampCam(); }
  }
});
function endPointer(e){
  if(!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if(pointers.size < 2) pinchDist = 0;
  if(pointers.size === 0 && !dragging && (now() - downT) < 400){
    const r = world.getBoundingClientRect(), w = screenToWorld(downX - r.left, downY - r.top);
    const tool = S.tool;
    if(tool === 'inspect') selectAt(w.x, w.y);
    else if(tool === 'meteor'){ meteor(w.x, w.y); S.tool = 'plant'; updateModeBtn(); }
    else if(tool === 'rock') addRock(w.x, w.y);
    else if(tool === 'water') addWater(w.x, w.y);
    else placeFood(w.x, w.y);
  }
}
world.addEventListener('pointerup', endPointer);
world.addEventListener('pointercancel', endPointer);
world.addEventListener('wheel', e => {
  e.preventDefault();
  const r = world.getBoundingClientRect();
  zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
}, { passive: false });
el('btnZoomIn').onclick = () => zoomAt(S.W / 2, S.H / 2, 1.25);
el('btnZoomOut').onclick = () => zoomAt(S.W / 2, S.H / 2, 1 / 1.25);
function placeFood(wx, wy){
  for(let i = 0; i < 6; i++) if(S.food.length < P.maxFood + 400) S.food.push({ x: wx + rnd(-18, 18), y: wy + rnd(-18, 18) });
}
