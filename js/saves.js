// Named save slots (multiple worlds) stored in localStorage, alongside autosave.
import { snapshot, restore } from './world.js';

const IDX = 'evosim_slots';
const dataKey = name => 'evosim_slotdata_' + encodeURIComponent(name);

function readIdx(){ try{ return JSON.parse(localStorage.getItem(IDX)) || []; }catch(e){ return []; } }
function writeIdx(a){ try{ localStorage.setItem(IDX, JSON.stringify(a)); }catch(e){} }

export function listSlots(){ return readIdx(); }

export function saveSlot(name){
  name = (name || '').trim().slice(0, 40);
  if(!name) return false;
  const snap = snapshot();
  try{ localStorage.setItem(dataKey(name), JSON.stringify(snap)); }catch(e){ return false; }
  const idx = readIdx().filter(s => s.name !== name);
  idx.unshift({ name, tick: snap.tick, pop: snap.creatures.length, at: Date.now() });
  writeIdx(idx);
  return true;
}

export function loadSlot(name){
  try{ const raw = localStorage.getItem(dataKey(name)); if(!raw) return false; return restore(JSON.parse(raw)); }
  catch(e){ return false; }
}

export function deleteSlot(name){
  try{ localStorage.removeItem(dataKey(name)); }catch(e){}
  writeIdx(readIdx().filter(s => s.name !== name));
}
