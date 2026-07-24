// Challenge mode: pick an objective; it is evaluated live with win/lose states.
import { S } from './state.js';

// Each challenge has a translation-key base (chXName / chXDesc) and a goal.
export const CHALLENGES = [
  { key: 'dynasty' },     // reach generation 30
  { key: 'balance' },     // keep all three diet bands >=15 for 1500 ticks
  { key: 'predators' },   // make carnivores outnumber herbivores
  { key: 'survivors' },   // keep population >=80 for 2500 ticks (lose if it crashes)
  { key: 'giant' }        // evolve a creature of size >= 8.5
];

export function startChallenge(key){
  S.challenge = { key, status: 'active', startTick: S.tick, lastTick: S.tick, progress: 0, hold: 0 };
}
export function stopChallenge(){ S.challenge = null; }

export function evalChallenge(){
  const ch = S.challenge;
  if(!ch || ch.status !== 'active') return;
  const dt = S.tick - ch.lastTick; ch.lastTick = S.tick;

  let herb = 0, omni = 0, carn = 0, maxSize = 0;
  for(const c of S.creatures){
    if(c.type === 'carn') carn++; else if(c.type === 'omni') omni++; else herb++;
    if(c.g.size > maxSize) maxSize = c.g.size;
  }
  const total = S.creatures.length, maxGen = S.maxGen;
  let progress = 0, won = false, lost = false;

  switch(ch.key){
    case 'dynasty':
      progress = Math.min(1, maxGen / 30); won = maxGen >= 30; break;
    case 'balance': {
      const cond = herb >= 15 && omni >= 15 && carn >= 15;
      ch.hold = cond ? ch.hold + dt : 0;
      progress = Math.min(1, ch.hold / 1500); won = ch.hold >= 1500; break;
    }
    case 'predators':
      progress = Math.min(1, carn / (herb + 1)); won = carn > herb && carn > 0; break;
    case 'survivors': {
      if(total < 25){ lost = true; break; }
      ch.hold = total >= 80 ? ch.hold + dt : 0;
      progress = Math.min(1, ch.hold / 2500); won = ch.hold >= 2500; break;
    }
    case 'giant':
      progress = Math.min(1, maxSize / 8.5); won = maxSize >= 8.5; break;
  }
  ch.progress = progress;
  if(won) ch.status = 'won';
  else if(lost) ch.status = 'lost';
}
