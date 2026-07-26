// A technology tree that is inherited culturally rather than genetically.
//
// Be precise about what this is, because it is the easiest thing in the whole
// roadmap to oversell. Nothing here is invented. The capabilities are a short,
// fixed list written by us — fire-keeping, food preservation, reach, void-craft —
// and no lineage will ever produce a capability that is not on that list. What is
// genuinely open is *which* of them a lineage holds, in what order it acquired
// them, whether it keeps them, and whether it loses them again when the bodies
// that knew them die without teaching anyone. That last one is the interesting
// half: a technology that cannot be lost is not being transmitted, it is being
// hard-coded on a delay.
//
// The mechanism is deliberately the one the existing `disperse` gene already
// prototypes: a capability is gated on brain size, unlocked by contact with a body
// that already has it, and charged upkeep for as long as it is held. Upkeep is
// what makes loss possible, and loss is what makes the accumulation mean anything.
//
// `techApt` is the aptitude gene: how readily a body acquires a capability from a
// neighbour that has it. It is deliberately NOT a "which technology" gene — the
// tree is cultural state on the body, not alleles in the genome, and the two must
// not be allowed to collapse into each other or the whole point is lost. The
// control that proves they have not: run with acquisition disabled and the upkeep
// still charged, and confirm the capability vector goes empty rather than tracking
// the genome.
//
// Contract used by world.js and render.js — these signatures are fixed:
//
//   techTick()           -> once per world step: capabilities spread between
//                           neighbours, and are lost by bodies that cannot keep
//                           them. MUST use rand()/gauss() from utils.js only.
//   techReset()          -> clear module state (called from seed() and restore()).
//   teach(parent, child) -> called at birth, after the child's body exists: the
//                           parent may pass on what it knows.
//   effect(c)            -> { metaMul, killMul, foodMul, dispMul }: what `c`'s
//                           held capabilities do to it. All 1 = knows nothing.
//   techIndex()          -> 0..1 for the HUD: mean fraction of the tree held.
//   drawWorld(ctx, view) -> world-layer drawing; view is
//                           { z, vis(x,y,r), x0, y0, x1, y1 }.
//
// Each creature carries `c.tech`, a small integer bitmask of held capabilities.
// S.techPeak records the deepest any lineage has ever reached, so the chronicle
// can say when something was lost.
//
// This stub is behaviour-neutral: nobody knows anything and nothing spreads.

import { P, S, TYPES } from './state.js';
import { rand, rnd, clamp, gauss } from './utils.js';

// exported so world.js has something to use when the mechanic is switched off,
// without every call site having to spell the four ones out again
export const NEUTRAL_TECH = { metaMul: 1, killMul: 1, foodMul: 1, dispMul: 1 };

export function techTick(){}

export function techReset(){ S.techPeak = 0; }

export function teach(parent, child){}

export function effect(c){ return NEUTRAL_TECH; }

export function techIndex(){ return 0; }

export function drawWorld(ctx, view){}
