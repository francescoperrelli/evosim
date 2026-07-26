// Trade: a second resource, and therefore something to exchange.
//
// The reciprocity ledger already exists, but with one resource there is nothing
// to trade — giving away food is charity, not commerce. A second resource that a
// body genuinely needs and cannot always get locally is what makes exchange pay,
// and the world already supplies the asymmetry for free: the planets differ in
// fertility, so comparative advantage falls out of the map rather than being
// written in.
//
// The design constraint is that minerals must be *needed*, not merely collectable.
// A resource nobody requires is a decoration, and a `trade` gene over a decoration
// is drift. Whatever the requirement ends up being — a breeding cost, an upkeep,
// a growth cost — it has to be steep enough that a mineral-poor neighbourhood is a
// real problem and shallow enough that a mineral-poor planet is not a death
// sentence, or the mechanic just prunes the map.
//
// Contract used by world.js and render.js — these signatures are fixed:
//
//   mineralTick()        -> once per world step: minerals appear, deplete, regrow.
//                           MUST use rand()/gauss() from utils.js only.
//   tradeTick()          -> once per world step: exchanges between neighbours.
//   tradeReset()         -> clear module state (called from seed() and restore()).
//   canBreed(c)          -> boolean: does `c` hold what reproduction requires?
//                           world.js checks this alongside its energy threshold.
//   payBreed(c)          -> called once a birth has been committed, so the module
//                           can charge whatever canBreed() was testing for.
//   gather(c)            -> called per body per step while it moves, so minerals
//                           on the ground can be picked up.
//   drawWorld(ctx, view) -> world-layer drawing; view is
//                           { z, vis(x,y,r), x0, y0, x1, y1 }.
//   packMinerals() / unpackMinerals(a)  -> save-file encoding.
//
// S.minerals holds the deposits; each creature carries `c.min`. S.trades counts
// completed exchanges for the HUD.
//
// This stub is behaviour-neutral: no minerals, no requirement, no exchange.

import { P, S, TYPES } from './state.js';
import { rand, rnd, clamp, gauss } from './utils.js';

export function mineralTick(){}

export function tradeTick(){}

export function tradeReset(){ S.minerals = []; S.trades = 0; }

export function canBreed(c){ return true; }

export function payBreed(c){}

export function gather(c){}

export function drawWorld(ctx, view){}

export function packMinerals(){ return []; }

export function unpackMinerals(a){ S.minerals = []; }
