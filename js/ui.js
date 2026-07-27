// UI: overlays, controls, menu, language, inspect mode, creature inspector
import { el, rnd, clamp } from './utils.js';
import { cultureIndex } from './culture.js';
import { markIndex } from './marks.js';
import { techIndex } from './tech.js';
import { P, S, LANG_KEY, screenToWorld, zoomAt, clampCam } from './state.js';
import { seed, saveLocal, hasSave, loadLocal, clearLocal, snapshot, restore, meteor, startDrought, startEpidemic, addRock, addWater, clearTerrain, speciesCount, dialectStats, logEvent } from './world.js';
import { makeCreature, randomGenome } from './genome.js';
import { drawNetwork, drawEvolution, selectedThought } from './render.js';
import { CHALLENGES, startChallenge, stopChallenge } from './challenges.js';
import { initAudio, setMusic, setSfx, musicOn, sfxMeteor, sfxWin, sfxLose, setMusicVol, setSfxVol, suspendAudio, resumeAudio } from './audio.js';
import { listSlots, saveSlot, loadSlot, deleteSlot } from './saves.js';
import { I18N, t, setLang, getLang } from './i18n.js';
import { phyloInfo, phyloForest, speciesName, recVec, traitDist, creatureVec, TRAIT_KEYS, TRAIT_SCALE } from './phylo.js';

/* ---------- overlays ---------- */
function show(id){ const e = el(id); if(e) e.classList.add('show'); }
function hide(id){ const e = el(id); if(e) e.classList.remove('show'); }
function hideAll(){ ['menu','tutorial','options','inspector','evolution','events','genealogy','challenges','slots','chronicle','legend','phylo'].forEach(hide); }
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
  [['tPred','predatorsOn'],['tOmni','omnivoresOn'],['tFlock','flocksOn'],['tTerr','terrOn'],['tMimic','mimicOn'],['tSeason','seasonsOn'],['tDay','dayNightOn'],['tBubbles','bubblesOn'],['tPher','pherOn'],['tCulture','cultureOn'],['tLearn','learnOn'],['tNests','nestsOn'],['tPlagues','plaguesOn'],['tMigrate','migrateOn'],['tHoard','hoardOn'],['tBuild','buildOn'],['tDisp','dispOn'],['tHusband','husbandOn'],['tStars','starsOn'],['tLights','lightsOn'],['tFx','fxOn'],['tStable','stableOn'],['tLifeHist','lifeHistOn'],['tEvolv','evolvOn'],['tFlora','floraOn'],['tSpecies','speciesOn'],
  ['tVillage','villageOn'],['tLabour','labourOn'],['tProperty','propertyOn'],['tPunish','propertyPunish'],['tCultureV','cultureVertOn'],['tTrade','tradeOn'],['tTribe','tribeOn'],
  ['tTools','toolsOn'],['tFire','fireOn'],['tMarks','marksOn'],['tTech','techOn'],['tTerra','terraOn']]
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
  document.querySelectorAll('[data-i18n-ph]').forEach(n => { const k = n.getAttribute('data-i18n-ph'); if(I18N[lang][k] !== undefined) n.placeholder = I18N[lang][k]; });
  el('btnAudio').textContent = musicOn() ? '🔊' : '🔇';
  syncPlayBtn();
  document.querySelectorAll('.lang button').forEach(b => b.classList.toggle('on', b.getAttribute('data-lang') === lang));
  if(el('tutorial').classList.contains('show')) renderTour();
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
bindToggle('tFlock', 'flocksOn'); bindToggle('tTerr', 'terrOn'); bindToggle('tMimic', 'mimicOn'); bindToggle('tSeason', 'seasonsOn'); bindToggle('tDay', 'dayNightOn'); bindToggle('tBubbles', 'bubblesOn'); bindToggle('tPher', 'pherOn'); bindToggle('tCulture', 'cultureOn'); bindToggle('tLearn', 'learnOn'); bindToggle('tNests', 'nestsOn'); bindToggle('tPlagues', 'plaguesOn'); bindToggle('tMigrate', 'migrateOn'); bindToggle('tHoard', 'hoardOn'); bindToggle('tBuild', 'buildOn'); bindToggle('tDisp', 'dispOn'); bindToggle('tHusband', 'husbandOn');
bindToggle('tStars', 'starsOn'); bindToggle('tLights', 'lightsOn'); bindToggle('tFx', 'fxOn'); bindToggle('tStable', 'stableOn');
bindToggle('tLifeHist', 'lifeHistOn'); bindToggle('tEvolv', 'evolvOn'); bindToggle('tFlora', 'floraOn'); bindToggle('tSpecies', 'speciesOn');
  bindToggle('tVillage', 'villageOn'); bindToggle('tLabour', 'labourOn'); bindToggle('tProperty', 'propertyOn'); bindToggle('tPunish', 'propertyPunish');
  bindToggle('tCultureV', 'cultureVertOn'); bindToggle('tTrade', 'tradeOn'); bindToggle('tTribe', 'tribeOn');
  bindToggle('tTools', 'toolsOn'); bindToggle('tFire', 'fireOn'); bindToggle('tMarks', 'marksOn');
  bindToggle('tTech', 'techOn'); bindToggle('tTerra', 'terraOn');

el('btnSave').onclick = () => toast(saveLocal() ? t('saved') : t('noStore'));
el('btnOpt').onclick = () => { updateSeedUI(); show('options'); };
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

/* ---------- challenges ---------- */
const chCap = k => k.charAt(0).toUpperCase() + k.slice(1);
function openChallenges(){
  const list = el('chList'); list.innerHTML = '';
  for(const c of CHALLENGES){
    const cap = chCap(c.key), btn = document.createElement('button');
    btn.className = 'btn ch-item';
    btn.innerHTML = `<b>${t('ch' + cap + 'Name')}</b><span>${t('ch' + cap + 'Desc')}</span>`;
    btn.onclick = () => { startChallenge(c.key); hide('challenges'); toast('🎯 ' + t('ch' + cap + 'Name')); };
    list.appendChild(btn);
  }
  el('chAbandon').style.display = S.challenge ? '' : 'none';
  show('challenges');
}
el('btnChallenge').onclick = openChallenges;
el('mChallenge').onclick = openChallenges;
el('chClose').onclick = () => hide('challenges');
el('chAbandon').onclick = () => { stopChallenge(); hide('challenges'); };
el('chDismiss').onclick = () => stopChallenge();

/* ---------- audio ---------- */
window.addEventListener('pointerdown', initAudio);   // browsers require a gesture to start audio
el('btnAudio').onclick = () => { const on = !musicOn(); setMusic(on); el('btnAudio').textContent = on ? '🔊' : '🔇'; const t2 = el('tMusic'); if(t2) t2.checked = on; };
el('tMusic').onchange = function(){ setMusic(this.checked); el('btnAudio').textContent = this.checked ? '🔊' : '🔇'; };
el('tSfx').onchange = function(){ setSfx(this.checked); };
el('rVolM').oninput = function(){ setMusicVol(+this.value / 100); el('vVolM').textContent = this.value + '%'; };
el('rVolS').oninput = function(){ setSfxVol(+this.value / 100); el('vVolS').textContent = this.value + '%'; };
// free the audio graph while the tab is in the background
document.addEventListener('visibilitychange', () => { if(document.hidden) suspendAudio(); else resumeAudio(); });

/* ---------- save slots ---------- */
function buildSlotList(){
  const list = el('slotList'); list.innerHTML = '';
  const slots = listSlots();
  if(!slots.length){ list.innerHTML = `<div class="slot-empty">${t('slotEmpty')}</div>`; return; }
  for(const s of slots){
    const item = document.createElement('div'); item.className = 'slot-item';
    const info = document.createElement('div'); info.className = 'info';
    const b = document.createElement('b'); b.textContent = s.name;
    const d = new Date(s.at), meta = document.createElement('span');
    meta.textContent = `${s.pop} · t${s.tick} · ${d.toLocaleDateString()} ${d.toLocaleTimeString().slice(0, 5)}`;
    info.appendChild(b); info.appendChild(meta);
    const load = document.createElement('button'); load.className = 'btn'; load.textContent = t('slotLoad');
    load.onclick = () => { if(loadSlot(s.name)){ syncControls(); clampCam(); saveLocal(); toast(t('slotLoaded')); hideAll(); S.running = true; syncPlayBtn(); } };
    const del = document.createElement('button'); del.className = 'btn ghost'; del.textContent = t('slotDelete');
    del.onclick = () => { deleteSlot(s.name); buildSlotList(); toast(t('slotDeleted')); };
    item.appendChild(info); item.appendChild(load); item.appendChild(del); list.appendChild(item);
  }
}
function openSlots(){ buildSlotList(); show('slots'); }
el('mSlots').onclick = openSlots;
el('slotsClose').onclick = () => hide('slots');
el('slotSave').onclick = () => { if(saveSlot(el('slotName').value)){ el('slotName').value = ''; buildSlotList(); toast(t('slotSaved')); } };

/* ---------- chronicle ---------- */
let lastChronLen = -1;
// pan the camera to a world point and reveal it (used by clickable chronicle events)
function centerCameraOn(x, y){
  const z = S.cam.zoom = Math.min(2.5, Math.max(S.cam.zoom, 1.5));
  S.cam.x = x - (S.W / z) / 2; S.cam.y = y - (S.H / z) / 2;
  clampCam(); hide('chronicle');
}
// clicking a located event jumps there; if it names a still-living creature, select + inspect it
function chronClick(e){
  if(e.cid != null){
    const cr = S.creatures.find(c => c.id === e.cid && !c.dead);
    if(cr){ S.selected = cr; centerCameraOn(cr.x, cr.y); show('inspector'); refreshInspector(); return; }
  }
  centerCameraOn(e.x, e.y); toast('📍 ' + t('chronJump'));
}
let chronTopTick = -1;
function buildChronicle(){
  const list = el('chronList'); list.innerHTML = '';
  if(!S.chronicle.length){ list.innerHTML = `<div class="chron-empty">${t('chronEmpty')}</div>`; chronTopTick = -1; return; }
  for(const e of S.chronicle){
    const located = e.x != null && e.y != null;
    const item = document.createElement('div');
    item.className = 'chron-item' + (located ? ' clickable' : '') + (e.tick > chronTopTick ? ' chron-new' : '');
    const tk = document.createElement('span'); tk.className = 'tk'; tk.textContent = 't' + e.tick;
    const tx = document.createElement('span'); tx.textContent = t('chr_' + e.key).replace('{n}', e.n);
    item.appendChild(tk); item.appendChild(tx);
    if(located){ const pin = document.createElement('span'); pin.className = 'chron-pin'; pin.textContent = '📍';
      item.appendChild(pin); item.onclick = () => chronClick(e); }
    list.appendChild(item);
  }
  chronTopTick = S.chronicle[0].tick;
}
/* ---------- legend: what the level-3 world layers look like ---------- */
const openLegend = () => show('legend');
el('btnLegend').onclick = openLegend;
el('mLegend').onclick = openLegend;
el('legendClose').onclick = () => hide('legend');

el('btnChronicle').onclick = () => {
  chronTopTick = S.chronicle.length ? S.chronicle[0].tick : -1;   // nothing flashes on first open
  buildChronicle(); lastChronLen = S.chronicle.length; show('chronicle');
};
el('chronClose').onclick = () => hide('chronicle');
export function refreshChronicle(){
  if(!el('chronicle').classList.contains('show')) return;
  if(S.chronicle.length !== lastChronLen){
    const list = el('chronList'); const prev = list.scrollTop, nearTop = prev < 40;
    buildChronicle();                       // new events are flagged .chron-new and flash
    lastChronLen = S.chronicle.length;
    list.scrollTop = nearTop ? 0 : prev;    // reveal new events if at top; otherwise hold the reader's place
  }
}

export function refreshChallenge(){
  const bar = el('challengeBar'), ch = S.challenge;
  if(!ch){ bar.classList.remove('show', 'won', 'lost'); return; }
  bar.classList.add('show');
  const cap = chCap(ch.key);
  el('chName').textContent = t('ch' + cap + 'Name');
  el('chFill').style.width = Math.round(ch.progress * 100) + '%';
  bar.classList.toggle('won', ch.status === 'won');
  bar.classList.toggle('lost', ch.status === 'lost');
  el('chStatus').textContent = ch.status === 'won' ? t('chWon') : ch.status === 'lost' ? t('chLost') : Math.round(ch.progress * 100) + '%';
  if(ch.status !== 'active' && !ch._notified){ ch._notified = true; (ch.status === 'won' ? sfxWin : sfxLose)(); logEvent(ch.status === 'won' ? 'challengeWon' : 'challengeLost', t('ch' + cap + 'Name')); toast((ch.status === 'won' ? t('chWon') : t('chLost')) + ' — ' + t('ch' + cap + 'Name')); }
}
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
el('mTut').onclick = () => showTour();
el('mLoad').onclick = () => { if(loadLocal()){ syncControls(); clampCam(); toast(t('loaded')); hideAll(); S.running = true; syncPlayBtn(); } else toast(t('noSave')); };
el('mSave').onclick = () => toast(saveLocal() ? t('saved') : t('noStore'));
el('mOpt').onclick = () => { updateSeedUI(); show('options'); };
el('mEvo').onclick = () => show('evolution');
el('mEvents').onclick = () => show('events');
el('evClose').onclick = () => hide('evolution');
/* ---------- guided tour ---------- */
const TOUR = [
  { icon: '🌱', t: 'tour1t', b: 'tour1b' },
  { icon: '🧭', t: 'tour2t', b: 'tour2b' },
  { icon: '🔍', t: 'tour3t', b: 'tour3b' },
  { icon: '🧬', t: 'tour4t', b: 'tour4b' },
  { icon: '🪨', t: 'tour6t', b: 'tour6b' },   // the level-3 layers, before the chronicle step closes the tour
  { icon: '📜', t: 'tour5t', b: 'tour5b' }
];
let tourStep = 0;
function renderTour(){
  const s = TOUR[tourStep];
  el('tourIcon').textContent = s.icon;
  el('tourTitle').textContent = t(s.t);
  el('tourBody').innerHTML = t(s.b);
  el('tourBack').style.visibility = tourStep === 0 ? 'hidden' : 'visible';
  el('tourNext').textContent = tourStep === TOUR.length - 1 ? t('tourStart') : t('tourNext');
  const dots = el('tourDots'); dots.innerHTML = '';
  for(let i = 0; i < TOUR.length; i++){ const dd = document.createElement('span'); dd.className = 'tour-dot' + (i === tourStep ? ' on' : ''); dots.appendChild(dd); }
}
export function showTour(){ tourStep = 0; renderTour(); show('tutorial'); }
function endTour(){
  hide('tutorial');
  try{ localStorage.setItem('evosim_tut_seen', '1'); }catch(e){}
  if(!S.creatures.length){ seed(); saveLocal(); }
  hideAll(); S.running = true; syncPlayBtn();
}
el('tourBack').onclick = () => { if(tourStep > 0){ tourStep--; renderTour(); } };
el('tourNext').onclick = () => { if(tourStep < TOUR.length - 1){ tourStep++; renderTour(); } else endTour(); };
el('tourSkip').onclick = endTour;

/* ---------- world seed: reproduce & share ---------- */
function updateSeedUI(){ const e = el('seedVal'); if(e) e.textContent = S.seed || '—'; }
el('oRegen').onclick = () => {
  const raw = el('seedInput').value.trim();
  const sv = raw === '' ? undefined : (isFinite(+raw) ? (+raw >>> 0) : undefined);
  clearLocal(); seed(sv); resetCam(); saveLocal(); syncControls(); updateSeedUI();
  hideAll(); S.running = true; syncPlayBtn(); toast('🌱 ' + t('worldRegen') + ' ' + S.seed);
};
el('oShare').onclick = () => {
  const url = location.origin + location.pathname + '?seed=' + (S.seed || 0);
  const done = () => toast('🔗 ' + t('linkCopied'));
  if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(url).then(done, () => toast(url)); }
  else toast(url);
};

/* ---------- options: export / import ---------- */
el('oClose').onclick = () => hide('options');
el('oExport').onclick = () => {
  const blob = new Blob([JSON.stringify(snapshot())], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'evosim-mondo.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); toast(t('exported'));
};
el('oImport').onclick = () => el('fileImport').click();
el('oData').onclick = () => {
  const rows = S.dataLog;
  if(!rows.length){ toast(t('noData')); return; }
  const cols = ['tick', 'pop', 'herb', 'omni', 'carn', 'food', 'maxGen', 'species', 'avgBrain', 'sexPct', 'ornH', 'ornO', 'ornC', 'resist', 'infPct', 'dialect'];
  const csv = [cols.join(',')].concat(rows.map(r => cols.map(c => r[c]).join(','))).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'evosim-dati-' + (S.seed || 0) + '.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); toast('📊 ' + t('dataExported') + ' (' + rows.length + ')');
};
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

/* ---------- genealogy ---------- */
function dietDot(diet){ return `<span class="gen-dot" style="background:hsl(${(120 * (1 - (diet || 0))) | 0} 60% 52%)"></span>`; }
function buildGenealogy(){
  const wrap = el('genTree'), c = S.selected;
  if(!c){ wrap.innerHTML = ''; return; }
  const living = new Set(S.creatures.map(x => x.id));
  const anc = c.anc || [];
  let html = '<div class="gen-chain">';
  if(!anc.length) html += `<div class="gen-hint">${t('genFounder')}</div>`;
  for(const a of anc){
    const live = living.has(a.id);
    html += `<div class="gen-node${live ? ' gen-live' : ''}"${live ? ` data-nav="${a.id}"` : ''}>${dietDot(a.diet)}<span>gen ${a.gen} · ${t(TYPE_KEY[a.type] || 'typeHerb')}${live ? ' ▸' : ''}</span></div>`;
  }
  html += `<div class="gen-node gen-current">${dietDot(c.g.diet)}<span>gen ${c.gen} · ${t(TYPE_KEY[c.type])} — ${t('genThis')}</span></div></div>`;
  const kids = S.creatures.filter(x => x.parent === c.id);
  html += `<div class="gen-kids-label">${t('genChildren')}${kids.length ? ' (' + kids.length + ')' : ''}</div>`;
  if(kids.length){
    html += '<div class="gen-kids">';
    for(const k of kids.slice(0, 30)) html += `<span class="gen-chip" data-nav="${k.id}">${dietDot(k.g.diet)}gen ${k.gen}</span>`;
    html += '</div>';
  } else html += `<div class="gen-hint">${t('genNoChildren')}</div>`;
  wrap.innerHTML = html;
}
el('btnGenealogy').onclick = () => { if(S.selected){ buildGenealogy(); show('genealogy'); } };
el('genClose').onclick = () => hide('genealogy');
el('genTree').addEventListener('click', e => {
  const n = e.target.closest('[data-nav]'); if(!n) return;
  const found = S.creatures.find(x => x.id === +n.getAttribute('data-nav'));
  if(found){ S.selected = found; buildGenealogy(); }
});

function selectAt(mx, my){
  let best = null, bestD = 1e9;
  for(const c of S.creatures){
    const d = (c.x - mx) ** 2 + (c.y - my) ** 2;
    const r = (c.rad || c.g.size) + 10;
    if(d < r * r && d < bestD){ bestD = d; best = c; }
  }
  if(best){ S.selected = best; show('inspector'); refreshInspector(); }
}

/* ---------- inspector: the level-3 layers ----------
   For each of the five newer mechanics: the inherited gene on the left, and on
   the right what this particular body is carrying right now — the thing none of
   the existing surfaces showed. Values mirrored from the owning modules; the
   comment on each constant names the file it was copied from, because ui.js must
   not import private module internals and must never touch the sim's rand(). */

// tech.js: bit order FIRE=1, PRES=2, REACH=4, VOID=8, and its COL palette.
const TECH_CAPS = [
  { key: 'capFire',  col: '#ec923e' },
  { key: 'capPres',  col: '#94c878' },
  { key: 'capReach', col: '#bccae4' },
  { key: 'capVoid',  col: '#b08ee2' }
];
// marks.js: one shape per glyph, in the hue that module draws it with. The glyph
// carries no fixed meaning — which one stands for what is the lineage's
// convention — so this is deliberately shown as a shape and never as a word.
const MARK_GLYPHS = [
  { ch: '▲', col: '#78d6b2' },
  { ch: '✕', col: '#e27abe' },
  { ch: '◎', col: '#7ea8ee' }
];
const PYRO_THRESH = 0.18, PYRO_BRAIN = 8;   // fire.js: the gene floor and the brain gate
const MARK_G = 3;                            // marks.js: rot(c) = floor(g.mark * G)

const dim = s => `<span class="dim">${s}</span>`;
const l3Bar = v => `<div class="track"><div class="fill" style="width:${clamp(v, 0, 1) * 100}%"></div></div>`;
const l3Conv = on => `<div class="conv">${[0, 1, 2].map(i => `<i class="${i === on ? 'on' : ''}"></i>`).join('')}</div>`;

function l3Row(label, meter, state, on){
  return `<div class="l3-row${on ? '' : ' off'}"><span>${t(label)}</span>${meter}` +
         `<span class="st">${on ? state : dim(t('l3Off'))}</span></div>`;
}

// refreshInspector() runs every frame, so the rows are only rebuilt when
// something in them actually changed. The signature covers everything rendered.
let _l3sig = '';
function buildL3(c){
  const g = c.g;
  const sig = [c.id, getLang(), +P.toolsOn, +P.fireOn, +P.marksOn, +P.techOn, +P.terraOn,
    Math.round((c.rock || 0) * 100), c.mark | 0, c.tech | 0, Math.round((c.terra || 0) * 100)].join(',');
  if(sig === _l3sig) return;
  _l3sig = sig;
  const out = [];

  // tools: the carry is the whole mechanic, so say plainly whether it is carrying
  const rock = c.rock || 0;
  out.push(l3Row('tTool', l3Bar(g.tool || 0),
    rock > 0 ? `🪨 ${t('l3Rock')} ${dim(Math.round(rock * 100) + '%')}` : dim(t('l3RockNone')),
    P.toolsOn));

  // fire: nothing persists on the body, so report the two gates the gene has to
  // clear before it expresses at all — that is the honest per-body fact here
  const canLight = (g.pyro || 0) >= PYRO_THRESH && g.brain.nh >= PYRO_BRAIN;
  out.push(l3Row('tPyro', l3Bar(g.pyro || 0),
    canLight ? `🔥 ${t('l3CanLight')}` : dim(t('l3NoLight')), P.fireOn));

  // marks: g.mark is ONLY the convention dial, so it is drawn as a choice of one
  // in three and never as a "how much it writes" bar
  const rot = Math.min(MARK_G - 1, Math.floor((g.mark || 0) * MARK_G));
  const read = (c.mark | 0) - 1;
  const gl = read >= 0 && read < MARK_G ? MARK_GLYPHS[read] : null;
  out.push(l3Row('tMark', l3Conv(rot),
    (gl ? `${t('l3MarkRead')}<span class="glyph" style="color:${gl.col}">${gl.ch}</span> · ` : dim(t('l3MarkNone')) + ' · ') +
    dim(t('l3Conv').replace('{n}', rot + 1)), P.marksOn));

  // tech: name what it holds, in the pip colours drawn over its head
  const mask = c.tech | 0;
  const held = TECH_CAPS.filter((_, i) => mask & (1 << i))
    .map(cp => `<span class="cap" style="background:${cp.col}"></span>${t(cp.key)}`).join(' · ');
  out.push(l3Row('tTechApt', l3Bar(g.techApt || 0), held || dim(t('l3TechNone')), P.techOn));

  // terra: ground this body has improved in its own life
  const tr = c.terra || 0;
  out.push(l3Row('tTerraG', l3Bar(g.terra || 0),
    tr > 0.005 ? t('l3Terra').replace('{n}', tr.toFixed(2)) : dim(t('l3TerraNone')), P.terraOn));

  el('inspL3').innerHTML = out.join('');
}

const barPct = (v, lo, hi) => clamp((v - lo) / (hi - lo), 0, 1) * 100;
export function refreshInspector(){
  if(!el('inspector').classList.contains('show')) return;
  const c = S.selected;
  if(!c || c.dead){ hide('inspector'); S.selected = null; return; }
  const g = c.g;
  el('inspDot').style.background = `hsl(${g.hue | 0} 60% 55%)`;
  el('inspType').textContent = t(TYPE_KEY[c.type]);
  el('inspMeta').textContent = `${t('lblEnergy')} ${c.energy | 0} · ${t('lblAge')} ${c.age} · ${t('lblGen')} ${c.gen} · ${g.sexual > 0.5 ? t('reproSex') : t('reproAsex')} · 🧠 ${g.brain.nh}`;
  el('inspThought').textContent = '💭 « ' + selectedThought(c) + ' »';
  el('bgSpeed').style.width = barPct(g.speed, 0.4, 3.4) + '%';
  el('bgVision').style.width = barPct(g.sense, 20, 165) + '%';
  el('bgSize').style.width = barPct(g.size, 2.5, 9) + '%';
  el('bgSocial').style.width = (g.sociality * 100) + '%';
  el('bgCamo').style.width = (g.camo * 100) + '%';
  el('bgTerr').style.width = (g.territoriality * 100) + '%';
  el('bgAcuity').style.width = (g.acuity * 100) + '%';
  el('bgSexual').style.width = (g.sexual * 100) + '%';
  el('bgDiet').style.width = ((g.diet || 0) * 100) + '%';
  el('bgAltruism').style.width = ((g.altruism || 0) * 100) + '%';
  el('bgOrnament').style.width = ((g.ornament || 0) * 100) + '%';
  el('bgPreference').style.width = ((g.preference || 0) * 100) + '%';
  el('bgResist').style.width = ((g.resist || 0) * 100) + '%';
  el('bgReciprocity').style.width = ((g.reciprocity || 0) * 100) + '%';
  el('bgMigrate').style.width = ((g.migrate || 0) * 100) + '%';
  el('bgHoard').style.width = ((g.hoard || 0) * 100) + '%';
  el('bgBuild').style.width = ((g.build || 0) * 100) + '%';
  { const bd = el('bgDisperse'); if(bd) bd.style.width = ((g.disperse || 0) * 100) + '%'; }
  { const bh = el('bgHusbandry'); if(bh) bh.style.width = ((g.husbandry || 0) * 100) + '%'; }
  buildL3(c);
  // live "voice": each channel's current output as a centre-anchored bar
  const CHCOL = ['#e6a578', '#78c8e6', '#aa8ce6'], sg = c.sig || [0, 0, 0];
  for(let k = 0; k < 3; k++){
    const f = el('vc' + k); if(!f) continue;
    const v = Math.max(-1, Math.min(1, sg[k]));
    f.style.width = Math.abs(v) * 50 + '%';
    f.style.marginLeft = (v >= 0 ? 50 : 50 - Math.abs(v) * 50) + '%';
    f.style.background = CHCOL[k];
  }
  drawNetwork(el('inspNet'), c);
}

export function refreshEvolution(){
  if(!el('evolution').classList.contains('show')) return;
  el('recGen').textContent = S.records.maxGen;
  el('recAge').textContent = S.records.oldestAge;
  el('recKids').textContent = S.records.maxKids;
  el('recLin').textContent = new Set(S.creatures.map(c => c.lineage)).size;
  el('recSpecies').textContent = speciesCount();
  el('recShares').textContent = S.shares;
  el('recDialect').textContent = Math.round(dialectStats().divergence * 100);
  // the level-2 counters, each owned by its module and simply read here
  el('recVillages').textContent = S.villages.length;
  el('recTribes').textContent = S.tribes.length;
  el('recTrades').textContent = S.trades;
  el('recThefts').textContent = S.thefts;
  el('recPunish').textContent = S.punishments;
  el('recCulture').textContent = Math.round(cultureIndex() * 100);
  // the level-3 counters, on the same terms: each module owns its number
  el('recCracked').textContent = S.cracked || 0;
  el('recBurns').textContent = S.burns || 0;
  el('recMarks').textContent = Math.round(markIndex() * 100);
  el('recTech').textContent = Math.round(techIndex() * 100);
  el('recTerra').textContent = (S.terra || []).length;
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
    else if(tool === 'meteor'){ meteor(w.x, w.y); sfxMeteor(); S.tool = 'plant'; updateModeBtn(); }
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

/* =====================================================================
   PHYLOGENETIC TREE  (ROADMAP §2.5)

   phylo.js has always recorded the topology; what was missing was a way to
   look at it. This is a time-calibrated phylogram: the x axis is the tick a
   lineage was minted and the tick it died, so a horizontal distance is real
   elapsed time, not a made-up branch length. The y axis is nothing but a DFS
   row index — it carries no meaning and is never claimed to.

   Four things this view refuses to do, because phylo.js cannot honestly
   support them:
     - no population curve per lineage (only `peak` and current `n` are kept);
     - no genetic distance when `g` is missing, which is the case for every
       record that came back from a save; it says so instead of drawing a zero;
     - no silent collapsing (see below);
     - no hiding of extinct branches. Most branches end. A tree that draws only
       the survivors is a lie, and a duller picture besides.

   COLLAPSING. Records are hard-capped at MAX_REC = 150 by phylo.js's prune(),
   so the feared 400-node hairball cannot happen by construction. A natural
   20 000-tick run settles around 25-30 records. But a low specThresh drives it
   to the cap, and 150 rows do not fit on a screen, so above a budget of 48
   rows whole clades fold into a classic collapsed-clade wedge. The order is a
   total order on (subtree peak, id) — smallest first, extinct clades before
   living ones — so it is deterministic and never calls rand(). A folded clade
   is drawn as a triangle whose height grows with the number of things inside
   it and is labelled with that number: a node standing for 30 sublineages
   looks like it stands for 30. Clicking it unfolds it.

   The same honesty applies one level up: prune() itself deletes records, and
   phylo.js now credits every deleted record to the surviving ancestor it was
   grafted onto (`absorbed`). Those show as an amber diamond and a "+N".
   Records whose whole ancestry was pruned away are counted in
   phyloInfo.rootLost and reported in the footer rather than vanishing.

   COST. phyloInfo.rev is bumped only when the shape of the forest changes.
   The layout is rebuilt on a change of that one integer; the canvas is
   repainted only when the layout, the selection, the view transform or the
   "now" cursor's pixel column actually moved. While the panel is shut,
   refreshPhylo() returns after a single classList test.
   ===================================================================== */

const PHYLO_I18N = {
  it: {
    phyloBtn: "🌳 Albero", phyloEyebrow: "La forma della discendenza", phyloTitle: "Albero filogenetico",
    phyloHint: "Trascina per spostarti · rotella per lo zoom sul tempo · tocca un ramo per selezionarlo · tocca un triangolo per aprire un gruppo",
    phyloEmpty: "Nessun lignaggio registrato. Lascia correre il mondo.",
    phyloOff: "La speciazione è disattivata nelle opzioni: non c'è nessun albero da mostrare.",
    phyloReset: "Reinquadra", phyloClose: "Chiudi",
    phyloAlive: "vivo", phyloExtinct: "estinto",
    phyloBorn: "Comparso", phyloDied: "Estinto", phyloSpan: "Durata", phyloPeak: "Picco", phyloNow: "Ora",
    phyloParent: "Discende da", phyloRoot: "Lignaggio fondatore",
    phyloSister: "Rispetto alla sorella", phyloNoSister: "Nessuna sorella registrata: il ramo gemello è stato potato o non c'è mai stato.",
    phyloNoVec: "Genetica non disponibile: questo record viene da un salvataggio, che non conserva il vettore dei tratti.",
    phyloMembers: "Creature vive in questo lignaggio", phyloNoMembers: "Nessuna creatura viva porta questo lignaggio.",
    phyloJump: "Vai", phyloMore: "…e altre {n}",
    phyloFolded: "Contiene {n} lignaggi ripiegati, tutti estinti tranne quelli segnati. Tocca per aprirlo.",
    phyloAbsorbed: "Ha assorbito {n} record potati dalla memoria.",
    phyloSelHint: "Tocca un ramo per leggerlo.",
    phyloRecs: "record", phyloPruned: "potati", phyloRootLost: "radici perse",
    phyloFoldedRows: "gruppi ripiegati", phyloBundles: "mazzi di rami morti",
    phTrdiet: "dieta", phTrsize: "taglia", phTrspeed: "velocità", phTrhue: "colore",
    phTrshape: "forma", phTrpattern: "livrea", phTrornament: "ornamento", phTrsense: "vista"
  },
  en: {
    phyloBtn: "🌳 Tree", phyloEyebrow: "The shape of descent", phyloTitle: "Phylogenetic tree",
    phyloHint: "Drag to pan · wheel to zoom time · tap a branch to select it · tap a triangle to open a folded group",
    phyloEmpty: "No lineages recorded yet. Let the world run.",
    phyloOff: "Speciation is switched off in the options, so there is no tree to show.",
    phyloReset: "Reframe", phyloClose: "Close",
    phyloAlive: "alive", phyloExtinct: "extinct",
    phyloBorn: "Appeared", phyloDied: "Extinct", phyloSpan: "Lasted", phyloPeak: "Peak", phyloNow: "Now",
    phyloParent: "Descends from", phyloRoot: "Founding lineage",
    phyloSister: "Against its sister", phyloNoSister: "No sister on record: the twin branch was pruned away, or never existed.",
    phyloNoVec: "Genetics unavailable: this record came back from a save, which does not keep the trait vector.",
    phyloMembers: "Creatures alive in this lineage", phyloNoMembers: "No living creature carries this lineage.",
    phyloJump: "Go", phyloMore: "…and {n} more",
    phyloFolded: "Holds {n} folded lineages, all extinct unless marked. Tap to open it.",
    phyloAbsorbed: "Absorbed {n} records pruned out of memory.",
    phyloSelHint: "Tap a branch to read it.",
    phyloRecs: "records", phyloPruned: "pruned", phyloRootLost: "roots lost",
    phyloFoldedRows: "folded groups", phyloBundles: "bundles of dead twigs",
    phTrdiet: "diet", phTrsize: "size", phTrspeed: "speed", phTrhue: "colour",
    phTrshape: "shape", phTrpattern: "livery", phTrornament: "ornament", phTrsense: "sight"
  }
};
// Merge only what is missing, so moving these strings into i18n.js later is a
// no-op rather than a conflict.
for(const lang of ['it', 'en']){
  const src = PHYLO_I18N[lang], dst = I18N[lang];
  if(!dst) continue;
  for(const k in src) if(dst[k] === undefined) dst[k] = src[k];
}
const tf = (k, vals) => { let s = t(k); for(const v in vals) s = s.split('{' + v + '}').join(vals[v]); return s; };

const PHYLO_CSS = `
.ph-card{width:min(980px,100%)}
#phWrap{position:relative;border:1px solid #24331f;border-radius:12px;background:#0d130d;overflow:hidden}
#phCanvas{display:block;width:100%;height:min(52vh,440px);touch-action:none;cursor:grab}
#phCanvas.drag{cursor:grabbing}
#phFoot{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:11px;color:#6f8168;margin:7px 2px 0}
#phDetail{margin-top:12px;border-top:1px solid #1e2a1c;padding-top:11px;font-size:12.5px;min-height:74px}
#phDetail .ph-h{display:flex;align-items:center;gap:8px;margin-bottom:6px}
#phDetail .ph-dot{width:12px;height:12px;border-radius:50%;flex:0 0 auto;box-shadow:0 0 0 1px rgba(0,0,0,.5) inset}
#phDetail .ph-nm{font-family:var(--serif,serif);font-size:17px}
#phDetail .ph-tag{font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;padding:1px 6px;border-radius:6px;border:1px solid #33452c;color:#8fa585}
#phDetail .ph-tag.dead{color:#a07a72;border-color:#4a332e}
#phDetail .ph-grid{display:flex;flex-wrap:wrap;gap:3px 20px;color:#93a68c}
#phDetail .ph-grid b{color:#d6e4cf;font-weight:500}
#phDetail .ph-sub{color:#7d8f77;margin:8px 0 3px;font-size:11px;letter-spacing:.04em;text-transform:uppercase}
#phDetail .ph-bar{display:flex;align-items:center;gap:7px;margin:2px 0}
#phDetail .ph-bar i{display:block;height:6px;border-radius:3px;background:#6f9a4c;flex:0 0 auto}
#phDetail .ph-mem{display:flex;flex-wrap:wrap;gap:5px;margin-top:3px}
#phDetail .ph-mem button{font:inherit;font-size:11px;padding:2px 8px;border-radius:7px;cursor:pointer;
  background:#182218;border:1px solid #2c3d28;color:#b9cbb2}
#phDetail .ph-mem button:hover{background:#22301f}
#phDetail .ph-note{color:#8a7f63;font-size:11.5px;line-height:1.45}
`;

/* ---------- DOM, built from here so index.html need not change ---------- */
function phEl(tag, attrs, parent){
  const n = document.createElement(tag);
  if(attrs) for(const k in attrs){ if(k === 'text') n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]); }
  if(parent) parent.appendChild(n);
  return n;
}
function buildPhyloDom(){
  if(!el('phylo')) buildPhyloOverlay();         // skipped if the markup is already in index.html
  const rst = el('phReset'), cls = el('phClose'), ov = el('phylo');
  if(rst) rst.onclick = () => { phFit(true); phDirty = true; };
  if(cls) cls.onclick = () => closePhylo();
  if(ov && !ov._phBound){ ov._phBound = true; ov.addEventListener('pointerdown', e => { if(e.target === ov) closePhylo(); }); }
  // The launcher, next to the other panel buttons. If the owner adds a button
  // with this id to index.html, the create branch never runs and nothing duplicates.
  if(!el('btnPhylo')){
    const anchor = el('btnLegend');
    const b = phEl('button', { class: 'btn ghost', id: 'btnPhylo', 'data-i18n': 'phyloBtn', text: PHYLO_I18N.it.phyloBtn });
    if(anchor && anchor.parentNode) anchor.parentNode.appendChild(b);
    else document.body.appendChild(b);
  }
  const bp = el('btnPhylo'); if(bp) bp.onclick = () => openPhylo();
}
function buildPhyloOverlay(){
  if(!el('phyloStyle')){
    const st = document.createElement('style'); st.id = 'phyloStyle'; st.textContent = PHYLO_CSS;
    document.head.appendChild(st);
  }
  const ov = phEl('div', { class: 'overlay', id: 'phylo' });
  const card = phEl('div', { class: 'card ph-card' }, ov);
  phEl('p', { class: 'eyebrow', 'data-i18n': 'phyloEyebrow', text: PHYLO_I18N.it.phyloEyebrow }, card);
  phEl('h3', { 'data-i18n': 'phyloTitle', text: PHYLO_I18N.it.phyloTitle }, card);
  const wrap = phEl('div', { id: 'phWrap' }, card);
  phEl('canvas', { id: 'phCanvas' }, wrap);
  phEl('div', { id: 'phFoot' }, card);
  phEl('p', { class: 'caption', 'data-i18n': 'phyloHint', text: PHYLO_I18N.it.phyloHint }, card);
  phEl('div', { id: 'phDetail' }, card);
  const row = phEl('div', { class: 'row' }, card);
  phEl('button', { class: 'btn ghost', id: 'phReset', 'data-i18n': 'phyloReset', text: PHYLO_I18N.it.phyloReset }, row);
  phEl('button', { class: 'btn primary', id: 'phClose', 'data-i18n': 'close', text: 'Chiudi' }, row);
  document.body.appendChild(ov);
}

/* ---------- view state ---------- */
const PH_ROW_MAX = 15, PH_ROW_MIN = 7;
const PH_PADL = 10, PH_PADR = 30, PH_PADT = 26, PH_PADB = 10;
let PH_ROW = PH_ROW_MAX;                        // actual pitch, shrunk to fit (see phLayout)
// How many rows we are willing to draw. Derived from the canvas, not fixed: the
// default view should fit without scrolling, because a tree you have to scroll
// to see is a tree you cannot read the shape of. Unfolding a clade by hand may
// push it past this, and then you scroll — that is a choice the player made.
function phAvail(){ const c = el('phCanvas'); return ((c ? c.clientHeight : 0) || 400) - PH_PADT - PH_PADB; }
function phBudget(){ return clamp(Math.floor(phAvail() / PH_ROW_MIN), 12, 160); }
const PH_DPR = Math.min(devicePixelRatio || 1, 2);   // matches render.js
const phOpen = new Set();                       // clades the player unfolded by hand
const phShut = new Set();                       // clades the player folded by hand
let phZoom = 1, phOx = 0, phOy = 0;             // time scale, pan in CSS px
let phLay = null, phLayRev = -1, phLayW = -1, phLayH = -1;   // cached layout + what it was built for
let phSel = 0, phDirty = true, phLastCol = -1, phLastLang = '';
let phItems = [], phWedges = [];
let phRaf = 0, phMemT = 0, phMemSel = -1, phCanW = 0, phCanH = 0;
let phPaints = 0, phPaintMs = 0, phTicks = 0, phTickMs = 0;   // measured, reported in the footer under ?debug

/* ---------- layout ---------- */
// Deterministic throughout: rows come from a DFS with children already sorted by
// (born, id) in phyloForest(); the fold order is (subtree peak, id). No rand().
function phBuildLayout(){
  const F = phyloForest();
  const budget = phBudget();
  const folded = new Set();
  const ancFolded = n => { let p = n.parent; while(p){ if(folded.has(p.id)) return true; p = p.parent; } return false; };
  if(F.nodes.length > budget){
    // Only clades that are extinct root and branch are ever folded automatically:
    // a lineage that is alive right now always keeps a row of its own, because
    // "which creatures alive right now belong to this" is the question the panel
    // exists to answer, and it cannot be answered about something not drawn.
    // Folding a clade that hides a single node buys nothing and costs a glyph.
    const dead = F.nodes.filter(n => n.subDead && n.kids.length && n.subCount >= 3 && !phOpen.has(n.id))
      .sort((a, b) => (a.subPeak - b.subPeak) || (a.id - b.id));
    let rows = F.nodes.length;
    for(const n of dead){
      if(rows <= budget) break;
      if(folded.has(n.id) || ancFolded(n)) continue;
      folded.add(n.id); rows -= n.subCount - 1;
    }
  }
  for(const id of phShut){ const n = F.byId.get(id); if(n && n.kids.length) folded.add(id); }
  for(const id of phOpen) folded.delete(id);

  let rows = [];
  for(const r of F.roots){
    const st = [r];
    while(st.length){
      const n = st.pop();
      n.folded = folded.has(n.id); rows.push(n);
      if(n.folded) continue;
      for(let i = n.kids.length - 1; i >= 0; i--) st.push(n.kids[i]);
    }
  }

  // Clade folding has a floor it cannot cross: a childless root is not a clade,
  // and phylo.js produces a great many of them — a fresh world names every
  // founding form as its own root, and at a low specThresh that is most of the
  // record list (measured: 111 roots out of 150 records at specThresh 0.16).
  // Those rows are what actually makes the picture unreadable, so adjacent runs
  // of extinct twigs are bundled into one striped band labelled with its count.
  // A band is drawn unlike a clade wedge on purpose: it is a bag of unrelated
  // dead ends, not a subtree, and must not be read as one.
  let bundles = 0;
  if(rows.length > budget){
    const ok = n => n.kids.length === 0 && n.died && n.id !== phSel && !phOpen.has(n.id);
    const runs = [];
    for(let i = 0; i < rows.length;){
      if(!ok(rows[i])){ i++; continue; }
      let j = i; while(j < rows.length && ok(rows[j])) j++;
      if(j - i >= 2) runs.push({ i, j, len: j - i });
      i = j;
    }
    runs.sort((a, b) => (b.len - a.len) || (a.i - b.i));   // total order, no rand()
    let over = rows.length - budget;
    const take = [];
    for(const r of runs){ if(over <= 0) break; take.push(r); over -= r.len - 1; }
    if(take.length){
      take.sort((a, b) => a.i - b.i);
      const out = [];
      let k = 0;
      for(const r of take){
        while(k < r.i) out.push(rows[k++]);
        const mem = rows.slice(r.i, r.j);
        let born = Infinity, end = 0, peak = 0, hue = 0, abs = 0, top = mem[0];
        for(const m of mem){
          if(m.born < born) born = m.born;
          if(m.died > end) end = m.died;
          abs += m.absorbed;
          if(m.peak > peak || (m.peak === peak && m.id < top.id)){ peak = m.peak; top = m; }
          hue += m.hue;
        }
        out.push({ bundle: true, id: -mem[0].id, members: mem, born, end,
          hue: hue / mem.length, peak, absorbed: abs, count: mem.length });
        bundles++;
        k = r.j;
      }
      while(k < rows.length) out.push(rows[k++]);
      rows = out;
    }
  }
  for(let i = 0; i < rows.length; i++) rows[i].row = i;
  return { F, rows, folded, foldedCount: folded.size, bundles };
}
function phLayout(){
  const c = el('phCanvas'); const w = c ? c.clientWidth : 0, h = c ? c.clientHeight : 0;
  if(!phLay || phLayRev !== phyloInfo.rev || phLayW !== w || phLayH !== h){
    phLay = phBuildLayout(); phLayRev = phyloInfo.rev; phLayW = w; phLayH = h; phDirty = true;
    // Nothing living is ever hidden, so the row count has a floor: one row per
    // extant childless root, and phylo.js can mint a hundred of those. When the
    // fold cannot get under the budget the rows get thinner instead of going
    // away — a cramped tree is still an honest tree, a truncated one is not.
    const pitch = phLay.rows.length ? Math.floor(phAvail() / phLay.rows.length) : PH_ROW_MAX;
    PH_ROW = clamp(pitch, PH_ROW_MIN, PH_ROW_MAX);
    if(phSel && !phLay.F.byId.has(phSel)){ phSel = 0; phMemSel = -1; }
  }
  return phLay;
}
function phFit(reset){
  phZoom = 1; phOx = 0; phOy = 0;
  if(reset){ phOpen.clear(); phShut.clear(); phLayRev = -1; }
}

/* ---------- pixel mapping ---------- */
let phT0 = 0, phT1 = 1, phW = 1, phH = 1;
const phX = tk => PH_PADL + phOx + (tk - phT0) / (phT1 - phT0 || 1) * (phW - PH_PADL - PH_PADR) * phZoom;
const phY = row => PH_PADT + phOy + row * PH_ROW + PH_ROW * 0.5;
const phInvX = px => phT0 + (px - PH_PADL - phOx) / ((phW - PH_PADL - PH_PADR) * phZoom || 1) * (phT1 - phT0);
// bar thickness reports the lineage's PEAK, not its headcount right now: the
// headcount is already the round cap at the live end, and a bar that thinned as
// a species died would be indistinguishable from one that was always small.
const phBarH = peak => clamp(2 + 2.2 * Math.log2(1 + peak), 2.5, Math.min(10, PH_ROW * 0.66));
const phCapR = n => clamp(2 + Math.sqrt(n) * 0.7, 2, Math.min(9, PH_ROW * 0.6));
function phCol(node, alpha){
  const h = node.hue, dead = !!node.died;
  return dead ? `hsla(${h},14%,44%,${alpha * 0.62})` : `hsla(${h},58%,58%,${alpha})`;
}
function phNiceStep(span, px){
  const target = Math.max(60, span / Math.max(2, px / 90));
  const p = Math.pow(10, Math.floor(Math.log10(target))), r = target / p;
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * p;
}

/* ---------- paint ---------- */
function phPaint(){
  const t0 = performance.now();
  const c = el('phCanvas'); if(!c) return;
  const w = c.clientWidth | 0, h = c.clientHeight | 0;
  if(!w || !h) return;
  if(w !== phCanW || h !== phCanH){ c.width = Math.round(w * PH_DPR); c.height = Math.round(h * PH_DPR); phCanW = w; phCanH = h; }
  phW = w; phH = h;
  const g = c.getContext('2d');
  g.setTransform(PH_DPR, 0, 0, PH_DPR, 0, 0);
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#0d130d'; g.fillRect(0, 0, w, h);

  const L = phLayout(), F = L.F;
  phItems = []; phWedges = [];
  if(!F.nodes.length){
    g.fillStyle = '#6f8168'; g.font = '13px system-ui, sans-serif'; g.textAlign = 'center';
    g.fillText(P.speciesOn === false ? t('phyloOff') : t('phyloEmpty'), w / 2, h / 2);
    g.textAlign = 'left';
    phPaints++; phPaintMs += performance.now() - t0;
    return;
  }
  phT0 = F.tMin; phT1 = Math.max(F.tMax, F.tMin + 1);

  // time axis
  const step = phNiceStep(phT1 - phT0, (w - PH_PADL - PH_PADR) * phZoom);
  g.font = '10px system-ui, sans-serif'; g.textBaseline = 'alphabetic';
  for(let tk = Math.ceil(phT0 / step) * step; tk <= phT1; tk += step){
    const x = phX(tk); if(x < -40 || x > w + 40) continue;
    g.strokeStyle = 'rgba(120,150,110,.10)'; g.beginPath(); g.moveTo(x, PH_PADT - 8); g.lineTo(x, h - PH_PADB); g.stroke();
    g.fillStyle = '#5d6f58'; g.fillText(tk >= 1000 ? +(tk / 1000).toFixed(1) + 'k' : String(tk), x + 3, 12);
  }
  // "now"
  const xn = phX(S.tick);
  g.strokeStyle = 'rgba(150,200,120,.34)'; g.beginPath(); g.moveTo(xn, PH_PADT - 10); g.lineTo(xn, h - PH_PADB); g.stroke();

  const topY = PH_PADT - 6, botY = h - PH_PADB;
  for(const n of L.rows){
    const y = phY(n.row);
    if(y < topY - PH_ROW || y > botY + PH_ROW) continue;

    // a bundle of unrelated extinct twigs: a striped band, never a triangle
    if(n.bundle){
      const bx0 = phX(n.born), bx1 = Math.max(bx0 + 10, phX(n.end));
      const bh = clamp(3 + 1.6 * Math.log2(1 + n.count), 4, PH_ROW * 0.5);
      g.fillStyle = 'rgba(140,140,140,.22)';
      g.fillRect(bx0, y - bh, bx1 - bx0, bh * 2);
      g.strokeStyle = 'rgba(170,170,170,.34)'; g.lineWidth = 1;
      for(let sy = -bh + 2; sy < bh; sy += 3){
        g.beginPath(); g.moveTo(bx0, y + sy); g.lineTo(bx1, y + sy); g.stroke();
      }
      const lbl = '≡' + n.count + '†' + (n.absorbed ? '+' + n.absorbed : '');
      g.fillStyle = '#8d9a88'; g.font = '10px system-ui, sans-serif';
      const lw = g.measureText(lbl).width, lx = Math.min(bx1 + 4, w - 3 - lw);
      g.fillText(lbl, lx, y + 3.4);
      phWedges.push({ id: n.id, members: n.members, x0: bx0, x1: Math.max(bx1, lx + lw), y, h: Math.max(bh, 6) });
      continue;
    }

    const x0 = phX(n.born), xe = phX(n.died || S.tick);
    const bh = phBarH(n.peak), sel = n.id === phSel;

    // the elbow down from the parent, drawn at the tick of the split
    if(n.parent && n.parent.row != null && !n.parent.folded){
      const py = phY(n.parent.row);
      const cx = Math.round(x0) + 0.5;
      g.strokeStyle = 'rgba(186,214,176,.5)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(cx, py); g.lineTo(cx, y); g.stroke();
    }
    // the lineage itself
    g.fillStyle = phCol(n, 1);
    g.fillRect(x0, y - bh / 2, Math.max(1.5, xe - x0), bh);
    if(sel){
      g.strokeStyle = '#e8f2df'; g.lineWidth = 1.4;
      g.strokeRect(x0 - 1.6, y - bh / 2 - 1.6, Math.max(1.5, xe - x0) + 3.2, bh + 3.2);
    }
    if(n.died){
      // an honest ending: the cross sits at the census tick that declared it gone
      g.strokeStyle = 'rgba(210,140,120,.75)'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(xe - 2.6, y - 2.6); g.lineTo(xe + 2.6, y + 2.6);
      g.moveTo(xe + 2.6, y - 2.6); g.lineTo(xe - 2.6, y + 2.6); g.stroke();
    }else{
      g.fillStyle = phCol(n, 1); g.beginPath(); g.arc(xe, y, phCapR(n.n), 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(232,242,223,.55)'; g.lineWidth = 0.8; g.stroke();
    }
    // records prune() folded into this one, made visible instead of silent
    if(n.absorbed > 0){
      const dx = x0 - 6.5;
      g.fillStyle = 'rgba(224,178,80,.85)';
      g.beginPath(); g.moveTo(dx, y - 3.2); g.lineTo(dx + 3.2, y); g.lineTo(dx, y + 3.2); g.lineTo(dx - 3.2, y); g.closePath(); g.fill();
      g.fillStyle = 'rgba(224,178,80,.7)'; g.font = '9px system-ui, sans-serif';
      g.fillText('+' + n.absorbed, dx - 4 - (String(n.absorbed).length + 1) * 5, y + 3);
      g.font = '10px system-ui, sans-serif';
    }
    // a folded clade: a wedge whose height counts what is inside it
    if(n.folded){
      const hid = n.subCount - 1, hidAbs = n.subAbsorbed - n.absorbed;
      const endT = n.subDead ? Math.max(n.subEnd, n.born) : S.tick;
      const wx0 = phX(n.kids.length ? n.kids[0].born : n.born), wx1 = Math.max(wx0 + 8, phX(endT));
      const wh = clamp(2.5 + 1.9 * Math.log2(1 + hid + hidAbs), 3, PH_ROW * 0.46);
      g.fillStyle = n.subDead ? 'rgba(150,150,150,.30)' : `hsla(${n.hue},40%,52%,.42)`;
      g.beginPath(); g.moveTo(wx0, y); g.lineTo(wx1, y - wh); g.lineTo(wx1, y + wh); g.closePath(); g.fill();
      g.strokeStyle = n.subDead ? 'rgba(180,180,180,.45)' : `hsla(${n.hue},46%,66%,.6)`; g.lineWidth = 1; g.stroke();
      const lbl = '▸' + (hid + hidAbs) + (n.subDead ? '†' : '');
      g.fillStyle = '#93a68c'; g.font = '10px system-ui, sans-serif';
      const lw = g.measureText(lbl).width, lx = Math.min(wx1 + 4, w - 3 - lw);
      g.fillText(lbl, lx, y + 3.4);
      phWedges.push({ id: n.id, x0: wx0, x1: Math.max(wx1, lx + lw), y, h: Math.max(wh, 6) });
    }
    phItems.push({ id: n.id, x0: Math.min(x0, x0 - 10), x1: xe + 10, y, h: Math.max(bh, 8) });
  }
  phLastCol = Math.round(xn);
  phPaints++; phPaintMs += performance.now() - t0;
  phFoot(L);
}
function phFoot(L){
  const f = el('phFoot'); if(!f) return;
  const F = L.F;
  const bits = [
    `${F.nodes.length}/${F.cap} ${t('phyloRecs')}`,
    `${F.extant} ${t('phyloAlive')} · ${F.dead} ${t('phyloExtinct')}`
  ];
  if(L.foldedCount) bits.push(`${L.foldedCount} ${t('phyloFoldedRows')}`);
  if(L.bundles) bits.push(`${L.bundles} ${t('phyloBundles')}`);
  if(F.pruned) bits.push(`${F.pruned} ${t('phyloPruned')}`);
  if(F.rootLost) bits.push(`${F.rootLost} ${t('phyloRootLost')}`);
  const s = bits.join(' · ');
  if(f.textContent !== s) f.textContent = s;
}

/* ---------- pointer: pan, zoom, select, fold ---------- */
function phHit(px, py){
  let best = null, bd = 1e9;
  for(const it of phWedges){
    if(px >= it.x0 - 4 && px <= it.x1 + 4 && Math.abs(py - it.y) <= it.h + 3) return { wedge: it.id, members: it.members };
  }
  for(const it of phItems){
    if(px < it.x0 - 4 || px > it.x1 + 4) continue;
    const d = Math.abs(py - it.y);
    if(d <= it.h / 2 + 5 && d < bd){ bd = d; best = it.id; }
  }
  return best ? { node: best } : null;
}
function bindPhyloPointer(){
  const c = el('phCanvas'); if(!c || c._phBound) return; c._phBound = true;
  let down = false, moved = 0, lx = 0, ly = 0, pid = -1;
  c.addEventListener('pointerdown', e => {
    down = true; moved = 0; lx = e.clientX; ly = e.clientY; pid = e.pointerId;
    c.setPointerCapture(pid); c.classList.add('drag');
  });
  c.addEventListener('pointermove', e => {
    if(!down) return;
    const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    phOx += dx; phOy += dy; phClampView(); phDirty = true;
  });
  const up = e => {
    if(!down) return; down = false; c.classList.remove('drag');
    try{ c.releasePointerCapture(pid); }catch(_){}
    if(moved > 5) return;
    const r = c.getBoundingClientRect();
    const hit = phHit(e.clientX - r.left, e.clientY - r.top);
    if(hit && hit.members){
      // a bundle: unfold every twig in it, or fold them all back
      const open = phOpen.has(hit.members[0].id);
      for(const m of hit.members){ if(open) phOpen.delete(m.id); else phOpen.add(m.id); }
      phLayRev = -1;
    }else if(hit && hit.wedge != null){
      const id = hit.wedge;
      if(phOpen.has(id)) phOpen.delete(id); else phOpen.add(id);
      phShut.delete(id); phLayRev = -1;
    }else if(hit && hit.node != null){
      if(phSel === hit.node && phLay){
        const n = phLay.F.byId.get(hit.node);
        if(n && n.kids.length && !n.folded){ phShut.add(hit.node); phOpen.delete(hit.node); phLayRev = -1; }
      }
      phSel = hit.node;
    }else phSel = 0;
    phMemSel = -1; phDirty = true;
  };
  c.addEventListener('pointerup', up);
  c.addEventListener('pointercancel', () => { down = false; c.classList.remove('drag'); });
  c.addEventListener('wheel', e => {
    e.preventDefault();
    const r = c.getBoundingClientRect(), mx = e.clientX - r.left;
    const tk = phInvX(mx);
    phZoom = clamp(phZoom * (e.deltaY < 0 ? 1.18 : 1 / 1.18), 1, 64);
    phOx += mx - phX(tk); phClampView(); phDirty = true;
  }, { passive: false });
}
function phClampView(){
  const spanX = (phW - PH_PADL - PH_PADR) * phZoom;
  phOx = clamp(phOx, Math.min(0, phW - PH_PADR - PH_PADL - spanX), 0);
  const rows = phLay ? phLay.rows.length : 0;
  const spanY = rows * PH_ROW + PH_PADT + PH_PADB;
  phOy = clamp(phOy, Math.min(0, phH - spanY), 0);
}

/* ---------- the detail pane: what a selected lineage connects to ---------- */
// O(population), so it is rebuilt on a change of selection or language and
// otherwise at most once every 30 refreshes (~half a second at 60fps).
function phMembers(id){
  const out = []; let n = 0;
  for(const c of S.creatures){ if(c.sp === id && !c.dead){ n++; if(out.length < 12) out.push(c); } }
  return { list: out, n };
}
function phDiffs(a, b){
  const va = recVec(a), vb = recVec(b);
  if(!va || !vb) return null;
  const d = [];
  for(let i = 0; i < TRAIT_KEYS.length; i++) d.push({ k: TRAIT_KEYS[i], raw: va[i] - vb[i], real: (va[i] - vb[i]) * TRAIT_SCALE[i] });
  d.sort((x, y) => Math.abs(y.raw) - Math.abs(x.raw));
  return { top: d.slice(0, 3), dist: traitDist(va, vb), max: Math.abs(d[0].raw) || 1 };
}
const phEsc = s => String(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
function phBuildDetail(force){
  const box = el('phDetail'); if(!box) return;
  const L = phLay; if(!L) return;
  if(!phSel){
    if(box.dataset.sel !== '0'){ box.dataset.sel = '0'; box.innerHTML = `<div class="ph-note">${phEsc(t('phyloSelHint'))}</div>`; }
    return;
  }
  const n = L.F.byId.get(phSel); if(!n){ phSel = 0; return; }
  phMemT++;
  if(!force && box.dataset.sel === String(phSel) && phMemT % 30 !== 0) return;
  box.dataset.sel = String(phSel);

  const r = n.rec, dead = !!n.died;
  const end = n.died || S.tick;
  const rows = [
    [t('phyloBorn'), n.born],
    dead ? [t('phyloDied'), n.died] : [t('phyloNow'), n.n],
    [t('phyloSpan'), (end - n.born) + ' t'],
    [t('phyloPeak'), n.peak]
  ];
  let html = `<div class="ph-h">
    <span class="ph-dot" style="background:hsl(${n.hue},${dead ? 12 : 58}%,${dead ? 42 : 56}%)"></span>
    <span class="ph-nm">${phEsc(speciesName(r))}</span>
    <span class="ph-tag ${dead ? 'dead' : ''}">${phEsc(dead ? t('phyloExtinct') : t('phyloAlive'))}</span>
    <span class="ph-tag">${phEsc(n.type)}</span></div>`;
  html += `<div class="ph-grid">${rows.map(([k, v]) => `<span>${phEsc(k)} <b>${phEsc(v)}</b></span>`).join('')}</div>`;
  html += `<div class="ph-grid" style="margin-top:4px"><span>${phEsc(t('phyloParent'))} <b>${
    n.parent ? phEsc(speciesName(n.parent.rec)) : phEsc(t('phyloRoot'))}</b></span></div>`;
  if(n.absorbed > 0) html += `<div class="ph-note" style="margin-top:6px">◆ ${phEsc(tf('phyloAbsorbed', { n: n.absorbed }))}</div>`;
  if(n.folded) html += `<div class="ph-note" style="margin-top:4px">▸ ${phEsc(tf('phyloFolded', { n: n.subCount - 1 }))}</div>`;

  // what distinguishes it from its sibling — the reason the split happened
  const sibs = n.parent ? n.parent.kids.filter(k => k !== n) : [];
  html += `<div class="ph-sub">${phEsc(t('phyloSister'))}</div>`;
  if(!sibs.length) html += `<div class="ph-note">${phEsc(t('phyloNoSister'))}</div>`;
  else{
    const sis = sibs[0], df = phDiffs(r, sis.rec);
    if(!df) html += `<div class="ph-note">${phEsc(t('phyloNoVec'))}</div>`;
    else{
      html += `<div class="ph-grid"><span>${phEsc(speciesName(sis.rec))} · Δ <b>${df.dist.toFixed(3)}</b></span></div>`;
      for(const d of df.top){
        const wpx = Math.round(6 + 92 * Math.abs(d.raw) / df.max);
        const unit = d.k === 'hue' ? '°' : '';
        html += `<div class="ph-bar"><span style="width:74px;color:#93a68c">${phEsc(t('phTr' + d.k))}</span>
          <i style="width:${wpx}px;background:${d.raw >= 0 ? '#6f9a4c' : '#a5713f'}"></i>
          <b style="color:#d6e4cf">${d.real >= 0 ? '+' : ''}${Math.abs(d.real) >= 10 ? d.real.toFixed(0) : d.real.toFixed(2)}${unit}</b></div>`;
      }
    }
  }

  // and who is carrying it right now
  html += `<div class="ph-sub">${phEsc(t('phyloMembers'))}</div>`;
  const m = phMembers(n.id);
  if(!m.n) html += `<div class="ph-note">${phEsc(t('phyloNoMembers'))}</div>`;
  else{
    html += `<div class="ph-mem">${m.list.map(c => `<button data-cid="${c.id}">#${c.id} · ${phEsc(t('phyloJump'))}</button>`).join('')}`;
    if(m.n > m.list.length) html += `<span class="ph-note" style="align-self:center">${phEsc(tf('phyloMore', { n: m.n - m.list.length }))}</span>`;
    html += `</div>`;
  }
  box.innerHTML = html;
  box.querySelectorAll('[data-cid]').forEach(b => {
    b.onclick = () => {
      const c = S.creatures.find(x => x.id === +b.dataset.cid && !x.dead);
      if(!c) return;
      S.selected = c; hide('phylo'); stopPhyloLoop();
      centerCameraOn(c.x, c.y); show('inspector'); refreshInspector();
    };
  });
}

/* ---------- open / close / drive ---------- */
function phTick(){
  const ov = el('phylo');
  if(!ov || !ov.classList.contains('show')) return;
  const t0 = performance.now();
  phLayout();
  const lang = getLang();
  if(lang !== phLastLang){ phLastLang = lang; phDirty = true; phMemSel = -1; }
  // the "now" line and the live caps move with the clock; only repaint when
  // that actually lands on a different pixel column
  if(!phDirty && phLay && phLay.F.nodes.length && Math.round(phX(S.tick)) !== phLastCol) phDirty = true;
  if(phDirty){ phDirty = false; phPaint(); }
  phBuildDetail(phMemSel !== phSel);
  phMemSel = phSel;
  phTicks++; phTickMs += performance.now() - t0;
}
function phLoop(){ if(!phRaf) return; phTick(); phRaf = requestAnimationFrame(phLoop); }
function startPhyloLoop(){ if(phRaf) return; phRaf = requestAnimationFrame(phLoop); }
function stopPhyloLoop(){ if(phRaf) cancelAnimationFrame(phRaf); phRaf = 0; }
function closePhylo(){ hide('phylo'); stopPhyloLoop(); }
function openPhylo(){
  buildPhyloDom(); bindPhyloPointer();
  hideAll(); show('phylo');
  phLayRev = -1; phDirty = true; phMemSel = -1; phCanW = phCanH = 0;
  phFit(false);
  phTick(); startPhyloLoop();
}
// Exported so js/main.js can drive it from the frame loop like the other
// refreshers if that is preferred; the panel also self-drives while open, and
// calling both only costs the two integer compares below.
export function refreshPhylo(){ phTick(); }
// What the view is actually doing right now: the measured cost, and how many
// rows survived the fold. Exported so a test can assert the row budget is
// honoured instead of taking a screenshot's word for it.
export function phyloPerf(){
  const L = phLay;
  let hidden = 0, extantHidden = 0;
  if(L){
    const shown = new Set();
    for(const n of L.rows){
      if(n.bundle){ hidden += n.count - 1; shown.add(n.members[0].id); }
      else{ shown.add(n.id); if(n.folded) hidden += n.subCount - 1; }
    }
    // the promise the fold makes: a lineage that is alive right now is always on
    // a row of its own, whatever the record count does
    for(const n of L.F.nodes) if(!n.died && !shown.has(n.id)) extantHidden++;
  }
  return { paints: phPaints, paintMs: +phPaintMs.toFixed(3), ticks: phTicks, tickMs: +phTickMs.toFixed(3),
    perPaint: phPaints ? +(phPaintMs / phPaints).toFixed(4) : 0,
    perTick: phTicks ? +(phTickMs / phTicks).toFixed(4) : 0,
    records: L ? L.F.nodes.length : 0, rows: L ? L.rows.length : 0,
    folded: L ? L.foldedCount : 0, bundles: L ? L.bundles : 0, hidden, extantHidden,
    budget: phBudget(), rowPx: PH_ROW, selected: phSel, zoom: phZoom };
}
buildPhyloDom();
