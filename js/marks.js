// Persistent marks: memory that lives outside the body.
//
// Pheromone trails already exist, and they carry exactly one thing: intensity.
// Something walked here, recently, and that is all a follower can know. A mark
// that carries *content* — a small vector a body chooses when it deposits and that
// another body can read back — is a different kind of object, because the reader's
// response can depend on which mark it is rather than merely that there is one.
//
// Call this what it is and no more. It is proto-symbolic: a finite, fixed set of
// signal dimensions that acquire meaning by convention within a lineage. It is not
// writing, it is not language, and it will not become either — the vocabulary is
// written by us and cannot grow. What CAN genuinely happen, and is worth measuring,
// is that separate lineages settle on different conventions for the same dimension
// and that those conventions persist across generations. That is convention
// formation, and it is real. Claiming anything past it in the HUD or the chronicle
// would be lying to the player.
//
// The failure mode to watch: a mark nobody reads is graffiti, and a mark everybody
// reads the same way regardless of what it says is a signpost, not a symbol. The
// measurement that separates them is whether shuffling the content between marks
// changes behaviour. If it does not, this module is an expensive pheromone.
//
// Contract used by world.js and render.js — these signatures are fixed:
//
//   markTick()           -> once per world step: marks fade and are culled.
//                           MUST use rand()/gauss() from utils.js only.
//   markReset()          -> clear module state (called from seed() and restore()).
//   leave(c)             -> called per body per step: it may deposit a mark here.
//   sense(c)             -> { dx, dy, w }: a steering pull, in world units, that
//                           world.js adds to the innate prior with weight w
//                           (0 = no opinion). This is how a mark can matter without
//                           rebuilding the brain's input layer.
//   markIndex()          -> 0..1 for the HUD: how far apart the conventions of
//                           different lineages have drifted. 0 = one convention.
//   drawWorld(ctx, view) -> world-layer drawing; view is
//                           { z, vis(x,y,r), x0, y0, x1, y1 }.
//   packMarks() / unpackMarks(a)  -> save-file encoding.
//
// S.marks holds the deposits. Each creature carries `c.mark` (the last content it
// read, so the inspector can show what it is responding to).
//
// This stub is behaviour-neutral: nothing is deposited and nothing is read.

import { P, S, TYPES } from './state.js';
import { rand, rnd, clamp, gauss } from './utils.js';

const NO_PULL = { dx: 0, dy: 0, w: 0 };

export function markTick(){}

export function markReset(){ S.marks = []; }

export function leave(c){}

export function sense(c){ return NO_PULL; }

export function markIndex(){ return 0; }

export function drawWorld(ctx, view){}

export function packMarks(){ return []; }

export function unpackMarks(a){ S.marks = []; }
