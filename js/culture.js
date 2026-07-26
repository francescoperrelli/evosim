// Cumulative culture: a second channel of inheritance that is not the genome.
//
// Lifetime learning already exists — `learn()` in nn.js nudges a brain's weights
// while it forages and survives. But every one of those nudges dies with the body.
// The missing piece is vertical transmission: a parent passing on what it learned
// rather than only what it was born with. With a `fidelity` gene deciding how much
// of that deviation actually reaches the child, the population gets a ratchet:
// where fidelity is high, an improvement found by one generation is still there
// three generations later, having been improved on again — and none of it is in
// the DNA.
//
// This is the honest route to anything that deserves the word "civilisation" in
// this simulation, and it is also the one that can most easily fool us. A learned
// trait that merely tracks a genetically-determined optimum is not culture; it is
// the genome taking a slower path to the same place. The measurement that matters
// is whether the taught component persists when the genes for it do not — which is
// what cultureIndex() has to be built to show, not to assert.
//
// Contract used by world.js and render.js — these signatures are fixed:
//
//   inherit(parent, childGenome) -> called at birth, after the child's genome
//                                   exists and before it is turned into a body.
//                                   Mutates childGenome.brain in place to carry
//                                   some of what the parent LEARNED. MUST use
//                                   rand()/gauss() from utils.js only.
//   cultureTick()                -> once per world step.
//   cultureReset()               -> clear module state (seed() and restore()).
//   cultureIndex()               -> 0..1: how much of the population's competence
//                                   is taught rather than inherited. For the HUD.
//
// Each creature carries `c.culture`: how much of its brain came from teaching.
//
// This stub is behaviour-neutral: nothing is taught, exactly as today.

import { P, S, TYPES } from './state.js';
import { rand, rnd, clamp, gauss } from './utils.js';

export function inherit(parent, childGenome){}

export function cultureTick(){}

export function cultureReset(){ S.culture = null; }

export function cultureIndex(){ return 0; }
