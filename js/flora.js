// Flora: plants as an evolving population rather than inert energy pellets.
//
// Contract used by world.js and render.js — these five exports are the whole
// public surface and their signatures are fixed:
//
//   plantGenome(parent)  -> object merged onto a new food item at {x, y}.
//                           `parent` is an existing plant to inherit from, or
//                           null/undefined for a founder. MUST use rand()/gauss()
//                           from utils.js only, so the world stays deterministic.
//   bite(c, f)           -> { gain, harm }  energy the eater gets, energy the
//                           plant's chemistry takes back. world.js applies both.
//   plantStyle(f)        -> { hue, sat, light, r } for render.js.
//   floraTick()          -> per-step plant dynamics (called once per world step).
//   floraReset()         -> clear any module-local state (called from seed/restore).
//   packPlant(f) / unpackPlant(a)  -> save-file encoding of the heritable fields.
//
// This stub is deliberately behaviour-neutral: it reproduces today's plants
// exactly. The real implementation replaces the bodies, not the contract.

import { P, S, TYPES } from './state.js';
import { rand, rnd, clamp, gauss } from './utils.js';

export function plantGenome(parent){
  return { tox: 0, hue: 0, age: 0 };
}

export function bite(c, f){
  return { gain: P.foodEnergy * TYPES[c.type].plantEff, harm: 0 };
}

export function plantStyle(f){
  return { hue: 96, sat: 62, light: 46, r: 2.6 };
}

export function floraTick(){}

export function floraReset(){}

export function packPlant(f){ return [+f.x.toFixed(1), +f.y.toFixed(1)]; }

export function unpackPlant(a){
  return { x: a[0], y: a[1], tox: a[2] || 0, hue: a[3] || 0, age: 0 };
}
