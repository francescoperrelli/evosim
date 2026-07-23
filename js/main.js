// Punto di ingresso: avvio, ciclo di animazione, salvataggio automatico
import { S, LANG_KEY, clampCam } from './state.js';
import { resize, draw, drawCharts, updateHUD } from './render.js';
import { step, seed, loadLocal, saveLocal } from './world.js';
import { applyLang, refreshMenu, refreshInspector, refreshEvolution, show } from './ui.js';
import { I18N, setLang } from './i18n.js';

/* ---------- loop ---------- */
let saveCounter = 0;
function frame(){
  if(S.running){ for(let i = 0; i < S.stepsPerFrame; i++) step(); }
  draw(); drawCharts(); updateHUD(); refreshInspector(); refreshEvolution();
  if(S.running && ++saveCounter >= 180){ saveCounter = 0; saveLocal(); }
  requestAnimationFrame(frame);
}
window.addEventListener('pagehide', saveLocal);
document.addEventListener('visibilitychange', () => { if(document.hidden) saveLocal(); });

/* ---------- avvio ---------- */
function initWorldSize(){ S.worldW = Math.round(Math.max(1700, S.W * 2.1)); S.worldH = Math.round(Math.max(1050, S.H * 2.1)); }
resize();
try{ const sl = localStorage.getItem(LANG_KEY); if(sl && I18N[sl]) setLang(sl); }catch(e){}
if(loadLocal()){ if(!S.worldW) initWorldSize(); }
else { initWorldSize(); seed(); saveLocal(); }
clampCam();
S.running = true;
applyLang();
refreshMenu();
show('menu');
requestAnimationFrame(frame);
