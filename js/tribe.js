// Coalitions: telling us from them by what a stranger looks like.
//
// The `ornament` gene already gives every body a visible, heritable marking that
// selection can act on. Read as a tribal badge it becomes a green-beard: help
// those who look like you, withhold from — or fight — those who do not. The
// `tribal` gene says how much a body cares about the badge at all, which is what
// keeps the mechanic from being a rule: an indifferent population simply ignores
// markings and nothing tribal happens.
//
// The known failure mode of green-beard mechanics is that the marker and the
// behaviour come unstuck: a cheat that wears the badge without paying the cost
// invades and the whole thing collapses. That is a real evolutionary result and
// should be allowed to happen rather than being prevented by fiat — but it means
// the interesting question is whether markers stay honest, and for how long, and
// that has to be measured.
//
// The balance warning attached to this mechanic is not decoration: intergroup
// conflict removes adults from a population that other mechanics have already
// pushed to its carrying capacity. War that costs more than it wins will empty
// the world, and an emptied world is not a more interesting one.
//
// Contract used by world.js and render.js — these signatures are fixed:
//
//   marker(c)            -> the badge value carried by `c`.
//   sameTribe(a, b)      -> 0..1 similarity of two bodies' markings (1 = kin-alike).
//   aggression(a, b)     -> 0..1: how strongly `a` is disposed to attack `b`.
//                           0 means it will not. world.js applies the consequence.
//   tribeTick()          -> once per world step: coalitions form, split, decay.
//                           MUST use rand()/gauss() from utils.js only.
//   tribeReset()         -> clear module state (called from seed() and restore()).
//   drawWorld(ctx, view) -> world-layer drawing; view is
//                           { z, vis(x,y,r), x0, y0, x1, y1 }.
//
// S.tribes holds coalition records; each creature carries `c.tribe`.
//
// This stub is behaviour-neutral: everyone is one undifferentiated crowd.

import { P, S, TYPES } from './state.js';
import { rand, rnd, clamp, gauss } from './utils.js';

export function marker(c){ return c.g.ornament || 0; }

export function sameTribe(a, b){ return 1; }

export function aggression(a, b){ return 0; }

export function tribeTick(){}

export function tribeReset(){ S.tribes = []; }

export function drawWorld(ctx, view){}
