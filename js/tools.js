// Tools: a rock is not a tool until something carries it somewhere.
//
// Rocks already litter this world as terrain. The whole of tool use is the step
// from "a rock is an obstacle" to "a rock is a thing I pick up and take with me",
// and that step needs a reason: food that cannot be opened bare-handed. A hard-
// shelled plant that is worth more than an ordinary one and is simply inedible
// without something to crack it is the cleanest possible selective reason for the
// behaviour, because a body without the gene is not punished — it just walks past
// a meal it cannot have.
//
// Keep the gradient smooth. If cracking is all-or-nothing at some threshold, the
// gene has a cliff in the middle of it and selection cannot climb the cliff from
// below; partial use has to give partial benefit, or nothing will ever start.
//
// The other honest constraint: a carried rock must cost something to carry, or
// the gene is a free lunch and rises in worlds that have no shells in them at all.
// That world — shells off, gene still mutating — is the drift control every claim
// about this mechanic has to be measured against.
//
// Contract used by world.js and render.js — these signatures are fixed:
//
//   toolTick()           -> once per world step: shelled food appears and decays.
//                           MUST use rand()/gauss() from utils.js only.
//   toolReset()          -> clear module state (called from seed() and restore()).
//   carry(c)             -> called per body per step: pick a rock up, or drop it.
//   killBonus(c)         -> multiplier on `c`'s kill probability (1 = no effect).
//   tryEat(c)            -> energy `c` extracts from shelled food within reach
//                           this step, or 0. world.js adds it and charges nothing.
//   drawWorld(ctx, view) -> world-layer drawing; view is
//                           { z, vis(x,y,r), x0, y0, x1, y1 }.
//   packShells() / unpackShells(a)  -> save-file encoding.
//
// S.shells holds the hard-shelled food; each creature carries `c.rock` (0 = empty
// handed). S.cracked counts successful openings for the HUD.
//
// This stub is behaviour-neutral: no shells, nothing carried, no bonus.

import { P, S, TYPES } from './state.js';
import { rand, rnd, clamp, gauss } from './utils.js';

export function toolTick(){}

export function toolReset(){ S.shells = []; S.cracked = 0; }

export function carry(c){}

export function killBonus(c){ return 1; }

export function tryEat(c){ return 0; }

export function drawWorld(ctx, view){}

export function packShells(){ return []; }

export function unpackShells(a){ S.shells = []; }
