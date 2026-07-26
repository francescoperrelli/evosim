// Fire: the first behaviour in this simulation whose payoff arrives after the
// body that paid for it may already be dead.
//
// Burning ground destroys what grows on it and then, some hundreds of ticks later,
// leaves it more fertile than it was. That inversion is the whole point. Every
// other mechanic here pays out within a body's own foraging range and lifetime, so
// a reflex is enough to exploit it. A reward that arrives long after the cost, in
// a place the body has to still be near, is the first thing in this world that a
// large brain could in principle be *for* — which is why the gene should be gated
// on brain size the way `husbandry` is, and why the honest question is not "does
// fire happen" but "do the lineages that use it have bigger brains than those that
// do not, and does that gap survive a control where the delay is removed".
//
// It is also the mechanic most able to wreck the world. Fire that spreads without
// bound sterilises a planet and the population with it, and a sterilised planet is
// not a more interesting one. Spread has to be bounded by something physical —
// fuel, moisture, the sea — and not by a magic cap, and the burn/regrowth budget
// has to come out roughly neutral over a full cycle or the mechanic is just a
// slow-acting drought.
//
// Contract used by world.js and render.js — these signatures are fixed:
//
//   fireTick()           -> once per world step: fires spread, burn out, and the
//                           scars they leave age from scorched to rich.
//                           MUST use rand()/gauss() from utils.js only.
//   fireReset()          -> clear module state (called from seed() and restore()).
//   ignite(c)            -> called per body per step: it may start a fire here.
//   hazard(c)            -> energy `c` loses this step for standing in flame.
//                           world.js subtracts it. 0 when it is not burning.
//   fertBonus(x, y)      -> additive fertility at this point: negative on fresh
//                           scar, positive on an aged one, 0 everywhere else.
//                           Called from fertilityAt(), so it must be cheap.
//   drawWorld(ctx, view) -> world-layer drawing; view is
//                           { z, vis(x,y,r), x0, y0, x1, y1 }.
//   packFires() / unpackFires(a)  -> save-file encoding (fires AND scars).
//
// S.fires holds burning fronts, S.scars holds the ground they left behind.
// S.burns counts ignitions for the HUD.
//
// This stub is behaviour-neutral: nothing ignites, nothing burns, fertility is
// exactly what the terrain says it is.

import { P, S, TYPES } from './state.js';
import { rand, rnd, clamp, gauss } from './utils.js';

export function fireTick(){}

export function fireReset(){ S.fires = []; S.scars = []; S.burns = 0; }

export function ignite(c){}

export function hazard(c){ return 0; }

export function fertBonus(x, y){ return 0; }

export function drawWorld(ctx, view){}

export function packFires(){ return []; }

export function unpackFires(a){ S.fires = []; S.scars = []; }
