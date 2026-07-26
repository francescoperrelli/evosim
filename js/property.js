// Property: whether a granary you did not fill is food or is somebody else's.
//
// Caches already exist and only kin may draw from them — a hard rule written into
// world.js. That rule is the thing to remove. Once a stranger *can* take, whether
// they do becomes a strategy: `raid` is the willingness to take what you did not
// store, `respect` is the willingness to leave it and, more expensively, to punish
// those who don't. Altruistic punishment is what turns a norm into a right: the
// punisher pays and the whole neighbourhood collects, so respect can only survive
// if enough bodies carry it at once.
//
// Nothing here scripts a property right. It sets up the game and lets the
// population find whichever equilibrium its numbers support — which may well be
// theft, in some worlds.
//
// Contract used by world.js and render.js — these signatures are fixed:
//
//   mayTake(c, cache)     -> boolean: will `c` draw from this cache? world.js has
//                            already established that `c` is NOT of the cache's
//                            lineage; kin always may and never come through here.
//   onTake(c, cache, amt) -> called after a non-kin withdrawal actually happened,
//                            so the module can record who owes what.
//   propertyTick()        -> once per world step: punishment, grudges, decay.
//                            MUST use rand()/gauss() from utils.js only.
//   propertyReset()       -> clear module state (called from seed() and restore()).
//   drawWorld(ctx, view)  -> world-layer drawing; view is
//                            { z, vis(x,y,r), x0, y0, x1, y1 }.
//
// Each creature carries `c.grudge` (punishment pressure aimed at it) and
// `c.stolen` (energy it has taken from others). S.thefts and S.punishments are
// running counters for the HUD.
//
// This stub is behaviour-neutral: non-kin never take, exactly as today.

import { P, S, TYPES } from './state.js';
import { rand, rnd, clamp, gauss } from './utils.js';

export function mayTake(c, cache){ return false; }

export function onTake(c, cache, amt){}

export function propertyTick(){}

export function propertyReset(){ S.thefts = 0; S.punishments = 0; }

export function drawWorld(ctx, view){}
