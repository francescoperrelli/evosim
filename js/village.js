// Villages: settlements that outlive the bodies that built them, and the
// division of labour inside them.
//
// Shelters already exist as isolated lineage refuges. A village is what happens
// when several of them stand close enough to lean on each other: the cluster is
// maintained collectively, defends collectively, and persists as long as somebody
// keeps paying for it. That "somebody keeps paying" is the whole point — a village
// is a public good, so it is also a public-goods problem, and the `civic` gene is
// the strategy that plays it.
//
// Division of labour rides on the same structure. In a settlement with something
// worth defending and young worth feeding, a body that does one job well can beat
// a body that does all three adequately — polyethism, as in social insects. The
// `caste` gene says how strongly an individual commits to a single role.
//
// Contract used by world.js and render.js — these signatures are fixed:
//
//   villageTick()        -> once per world step: grow, maintain and decay villages,
//                           assign roles. MUST use rand()/gauss() from utils.js only.
//   villageReset()       -> clear module state (called from seed() and restore()).
//   defence(c)           -> multiplier on a predator's chance of catching `c`
//                           (1 = no protection, <1 = safer). world.js applies it.
//   roleEffect(c)        -> { speedMul, senseMul, metaMul } applied by world.js
//                           this step. All 1 means the body is a generalist.
//   villageAt(x, y)      -> the village record covering this point, or null.
//   drawWorld(ctx, view) -> world-layer drawing. `view` is
//                           { z, vis(x,y,r), x0, y0, x1, y1 }.
//   packVillages() / unpackVillages(a)   -> save-file encoding.
//
// S.villages holds the records; each creature carries `c.vill` (village id, 0 =
// none) and `c.role` (0 forager, 1 guard, 2 nurse).
//
// This stub is behaviour-neutral: it reproduces today's world exactly.

import { P, S, TYPES } from './state.js';
import { rand, rnd, clamp, gauss } from './utils.js';

const NEUTRAL_ROLE = { speedMul: 1, senseMul: 1, metaMul: 1 };

export function villageTick(){}

export function villageReset(){ S.villages = []; }

export function defence(c){ return 1; }

export function roleEffect(c){ return NEUTRAL_ROLE; }

export function villageAt(x, y){ return null; }

export function drawWorld(ctx, view){}

export function packVillages(){ return []; }

export function unpackVillages(a){ S.villages = []; }
