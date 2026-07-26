// Planets as separate evolutionary theatres, and what happens when they meet again.
//
// The map already does the hard half of this: several planets, an impassable void
// between them, and an evolvable `disperse` gene that occasionally gets a body
// across. That is allopatry — the textbook engine of speciation — and it is already
// running. What is missing is the second act. Populations that diverged in
// isolation and then meet again either interbreed, in which case the divergence
// was not speciation after all, or they do not, in which case it was. The
// speciation machinery from level 1 already decides which, so this module's job is
// to notice it happened and to make the planets differ enough that it means
// something.
//
// Terraforming is the other half: a lineage that raises the fertility of the ground
// it lives on. This is niche construction with the longest lever in the game, and
// it has the same shape as fire — a cost paid now against a return that mostly
// lands on whoever is standing there later, which is to say on kin if the
// population is viscous and on nobody in particular if it is not. That makes it a
// public good, and the level-2 measurement recorded above metabolism() in genome.js
// is unambiguous about what happens to public-good genes here: they drift unless
// the benefit is assorted onto the bodies that pay for it. Design accordingly, and
// if it drifts anyway, say so.
//
// Localised planetary events — an asteroid that hits one world and not the others —
// are what stop the planets converging on the same answer. They are also the
// cheapest possible source of the thing this whole simulation is for: two lineages,
// same ancestor, different history.
//
// Contract used by world.js and render.js — these signatures are fixed:
//
//   terraTick()          -> once per world step: fertility relaxes back toward the
//                           planet's baseline, localised events fire, recontact
//                           between long-separated lineages is detected and logged.
//                           MUST use rand()/gauss() from utils.js only.
//   terraReset()         -> clear module state (called from seed() and restore()).
//   terraform(c)         -> called per body per step: it may improve the ground it
//                           is standing on, at its own expense.
//   fertBonus(x, y)      -> additive fertility at this point from terraforming.
//                           Called from fertilityAt(), so it must be cheap.
//   drawWorld(ctx, view) -> world-layer drawing; view is
//                           { z, vis(x,y,r), x0, y0, x1, y1 }.
//   packTerra() / unpackTerra(a)  -> save-file encoding.
//
// S.terra holds the improved patches; S.planets already exists and its `fert`
// field is the baseline this module works against. Each creature carries `c.terra`
// (how much ground it has improved in its life), for the inspector.
//
// This stub is behaviour-neutral: no improvement, no events, no recontact notice.

import { P, S, TYPES } from './state.js';
import { rand, rnd, clamp, gauss } from './utils.js';

export function terraTick(){}

export function terraReset(){ S.terra = []; }

export function terraform(c){}

export function fertBonus(x, y){ return 0; }

export function drawWorld(ctx, view){}

export function packTerra(){ return []; }

export function unpackTerra(a){ S.terra = []; }
