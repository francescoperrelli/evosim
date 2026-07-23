// UI: overlays, controls, menu, language, inspect mode, creature inspector
import { el, rnd, clamp } from './utils.js';
import { P, S, LANG_KEY } from './state.js';
import { seed, saveLocal, hasSave, loadLocal, clearLocal, snapshot, restore } from './world.js';
import { makeCreature, randomGenome } from './genome.js';
import { drawNetwork } from './render.js';
import { I18N, t, setLang, getLang } from './i18n.js';

/* ---------- overlays ---------- */
function show(id){ el(id).classList.add('show'); }
function hide(id){ el(id).classList.remove('show'); }
function hideAll(){ ['menu','tutorial','options','inspector'].forEach(hide); }
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
  [['tPred','predatorsOn'],['tOmni','omnivoresOn'],['tFlock','flocksOn'],['tTerr','terrOn'],['tMimic','mimicOn'],['tSeason','seasonsOn']]
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
  el('btnMode').innerHTML = S.inspectMode ? t('modeInspect') : t('modeFood');
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
bindToggle('tFlock', 'flocksOn'); bindToggle('tTerr', 'terrOn'); bindToggle('tMimic', 'mimicOn'); bindToggle('tSeason', 'seasonsOn');

el('btnSave').onclick = () => toast(saveLocal() ? t('saved') : t('noStore'));
el('btnOpt').onclick = () => show('options');
el('btnMenu').onclick = () => { refreshMenu(); show('menu'); };
el('btnMode').onclick = function(){
  S.inspectMode = !S.inspectMode;
  this.innerHTML = S.inspectMode ? t('modeInspect') : t('modeFood');
  this.classList.toggle('on', S.inspectMode);
};

/* ---------- menu ---------- */
el('mNew').onclick = () => { clearLocal(); seed(); saveLocal(); hideAll(); S.running = true; syncPlayBtn(); };
el('mResume').onclick = () => { hideAll(); S.running = true; syncPlayBtn(); };
el('mTut').onclick = () => show('tutorial');
el('mLoad').onclick = () => { if(loadLocal()){ syncControls(); toast(t('loaded')); hideAll(); S.running = true; syncPlayBtn(); } else toast(t('noSave')); };
el('mSave').onclick = () => toast(saveLocal() ? t('saved') : t('noStore'));
el('mOpt').onclick = () => show('options');
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
  rd.onload = () => { try{ if(restore(JSON.parse(rd.result))){ syncControls(); saveLocal(); toast(t('imported')); hide('options'); } else toast(t('badFile')); }
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
  el('inspMeta').textContent = `${t('lblEnergy')} ${c.energy | 0} · ${t('lblAge')} ${c.age} · ${t('lblGen')} ${c.gen}`;
  el('bgSpeed').style.width = barPct(g.speed, 0.4, 3.4) + '%';
  el('bgVision').style.width = barPct(g.sense, 20, 165) + '%';
  el('bgSize').style.width = barPct(g.size, 2.5, 9) + '%';
  el('bgSocial').style.width = (g.sociality * 100) + '%';
  el('bgCamo').style.width = (g.camo * 100) + '%';
  el('bgTerr').style.width = (g.territoriality * 100) + '%';
  el('bgAcuity').style.width = (g.acuity * 100) + '%';
  drawNetwork(el('inspNet'), c);
}

/* ---------- touch: plant food or select ---------- */
const world = el('world');
let pressing = false;
world.addEventListener('pointerdown', e => {
  const r = world.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
  if(S.inspectMode){ selectAt(mx, my); return; }
  pressing = true; place(mx, my);
});
world.addEventListener('pointermove', e => {
  if(!pressing || S.inspectMode) return;
  const r = world.getBoundingClientRect(); place(e.clientX - r.left, e.clientY - r.top);
});
window.addEventListener('pointerup', () => pressing = false);
function place(mx, my){
  for(let i = 0; i < 6; i++) if(S.food.length < P.maxFood + 200) S.food.push({ x: mx + rnd(-18, 18), y: my + rnd(-18, 18) });
}
