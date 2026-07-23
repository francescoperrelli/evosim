// Interfaccia: overlay, controlli, menu, lingua, tocco per il cibo
import { el, rnd } from './utils.js';
import { P, S, LANG_KEY } from './state.js';
import { seed, saveLocal, hasSave, loadLocal, clearLocal, snapshot, restore } from './world.js';
import { makeCreature, randomGenome } from './genome.js';
import { I18N, t, setLang, getLang } from './i18n.js';

/* ---------- overlay ---------- */
function show(id){ el(id).classList.add('show'); }
function hide(id){ el(id).classList.remove('show'); }
function hideAll(){ ['menu','tutorial','options'].forEach(hide); }
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
  [['tPred','predatorsOn'],['tFlock','flocksOn'],['tTerr','terrOn'],['tMimic','mimicOn']]
    .forEach(([id, k]) => { const e = el(id); if(e) e.checked = P[k]; });
}

/* ---------- lingua ---------- */
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
  syncPlayBtn();
  document.querySelectorAll('.lang button').forEach(b => b.classList.toggle('on', b.getAttribute('data-lang') === lang));
  try{ localStorage.setItem(LANG_KEY, lang); }catch(e){}
}

/* ---------- controlli pannello ---------- */
el('btnPlay').onclick = function(){ S.running = !S.running; syncPlayBtn(); };
el('rSpeed').oninput = function(){ S.stepsPerFrame = +this.value; el('vSpeed').textContent = (S.stepsPerFrame || '0') + '×'; };
el('rFood').oninput = function(){ P.foodRate = +this.value;
  el('vFood').textContent = this.value == 0 ? t('lvNone') : this.value < 3 ? t('lvLow') : this.value < 7 ? t('lvMed') : t('lvHigh'); };
el('rMut').oninput = function(){ P.mut = +this.value / 100; el('vMut').textContent = this.value + '%'; };

const bindToggle = (id, key, onOff) => { el(id).onchange = function(){ P[key] = this.checked; if(onOff) onOff(this.checked); }; };
bindToggle('tPred', 'predatorsOn', on => {
  if(!on) S.creatures = S.creatures.filter(c => c.type !== 'carn');
  else if(!S.creatures.some(c => c.type === 'carn'))
    for(let i = 0; i < P.carnStart; i++) S.creatures.push(makeCreature(rnd(0, S.W), rnd(0, S.H), 'carn', randomGenome('carn'), 0));
});
bindToggle('tFlock', 'flocksOn'); bindToggle('tTerr', 'terrOn'); bindToggle('tMimic', 'mimicOn');

el('btnSave').onclick = () => toast(saveLocal() ? t('saved') : t('noStore'));
el('btnOpt').onclick = () => show('options');
el('btnMenu').onclick = () => { refreshMenu(); show('menu'); };

/* ---------- menu ---------- */
el('mNew').onclick = () => { clearLocal(); seed(); saveLocal(); hideAll(); S.running = true; syncPlayBtn(); };
el('mResume').onclick = () => { hideAll(); S.running = true; syncPlayBtn(); };
el('mTut').onclick = () => show('tutorial');
el('mLoad').onclick = () => { if(loadLocal()){ syncControls(); toast(t('loaded')); hideAll(); S.running = true; syncPlayBtn(); } else toast(t('noSave')); };
el('mSave').onclick = () => toast(saveLocal() ? t('saved') : t('noStore'));
el('mOpt').onclick = () => show('options');
el('tClose').onclick = () => { hide('tutorial'); if(!S.creatures.length){ seed(); saveLocal(); } hideAll(); S.running = true; syncPlayBtn(); };

/* ---------- opzioni: export/import ---------- */
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

/* ---------- lingua ---------- */
document.querySelectorAll('.lang button').forEach(b => {
  b.onclick = () => { setLang(b.getAttribute('data-lang')); applyLang(); };
});

/* ---------- cibo col tocco ---------- */
const world = el('world');
let pressing = false;
world.addEventListener('pointerdown', e => { pressing = true; place(e); });
world.addEventListener('pointermove', e => { if(pressing) place(e); });
window.addEventListener('pointerup', () => pressing = false);
function place(e){
  const r = world.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  for(let i = 0; i < 6; i++) if(S.food.length < P.maxFood + 200) S.food.push({ x: mx + rnd(-18, 18), y: my + rnd(-18, 18) });
}
