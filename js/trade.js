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
// ---------------------------------------------------------------------------
// WHAT THIS ACTUALLY DOES, MEASURED — read this before believing the mechanic.
// All figures headless, 4 seeds (11/23/37/51), shipped tuning unless stated.
//
// 1. Exchange happens, and it happens between the right pair of bodies.
//    Over 6k ticks a world clears 180-340 deals. For every deal, the ore
//    richness of the ground the SELLER stands on minus that of the BUYER is
//    positive on every seed: +0.017 / +0.016 / +0.006 / +0.023 against a null
//    of random pairs alive at the same tick and within the same 90px radius
//    (null mean 0.000 +-0.002; z = 8.5 / 8.8 / 2.2 / 9.5, p <= 0.03 on the
//    worst seed and p = 0.0004 on the other three, 5000 permutations). The
//    absolute size of the difference across a 90px neighbourhood is small
//    because the fertility field varies slowly, but the sign is never wrong.
//    That is comparative advantage doing the work: nothing decides who sells,
//    the map does.
//
// 2. The `trade` gene, however, is NOT measurably under selection. Over 12k
//    ticks the gene ends at 0.284 (exchange live) / 0.246 (exchange disabled,
//    gene still mutating) / 0.326 (mechanic off entirely), between-seed sd
//    0.07-0.13 — and the strictly-neutral `raid` gene climbs alongside it to
//    0.28 / 0.24 / 0.25 in the same runs. A gene drawn from rnd(0, 0.25) and
//    mutated by a clamped gaussian diffuses toward the middle whatever it does,
//    and that diffusion is much larger than any selective effect here.
//    The sharper test — mean(trade | newborn) - mean(trade | standing
//    population), accumulated over every birth (4-6k births per run), minus the
//    same quantity for `raid` — gives +1.3e-3 per birth with exchange live and
//    -5.1e-3 with it disabled, between-seed sd ~7e-3. The sign is right (and
//    the live arm is also paying the `carry` upkeep the control is not), but
//    with 4 seeds that is not a significant difference. HONEST VERDICT: the
//    mechanism is real and its spatial signature is real; selection on the gene
//    is at best weak and is not demonstrated. Do not describe this as evolved
//    commerce until a run long enough or replicated enough to separate it from
//    drift says so.
//
// 3. Interplanetary commerce does not happen and cannot: the deal radius is
//    90px and the void between planets is 240px, so no pair can span it. What
//    crosses is the carrier — a colonist arrives with its own reserve — and
//    deals then occur on every colonised planet (per-planet deal counts are
//    within a factor of ~3 of each other on all seeds). Commerce follows
//    dispersal; it does not cause it.
//
// 4. Cost of the requirement. Population over 4k ticks: 248 [187..279] with the
//    mechanic on against 269 [242..308] with it off — about 8% — and the band
//    minima (herb 137, omni 31, carn 7) sit alongside the tradeless world's
//    (155 / 30 / 6). With P.tradeOn = false the world is bit-identical to the
//    version of this file before it was written (fingerprint of every position,
//    energy, age and gene over 4 seeds x 2500 ticks).
//
// 5. Cost in time: mineralTick() + tradeTick() together are 0.048 ms/step
//    against a ~3.0 ms step, and gather() is 0.028 us per body (0.007 ms for a
//    whole 250-body population). The mechanic is ~1.6% of a step.
// ---------------------------------------------------------------------------

import { P, S, TYPES } from './state.js';
import { rand, rnd, clamp, gauss } from './utils.js';

// ---------------------------------------------------------------------------
// Tuning. Every number here is measured, not guessed; see the notes on each.
// The object is mutable so an experiment can sweep it (P.tradeK is copied in at
// reset); the shipped defaults are the ones the measurements below settled on.
//
// Tunings that were tried and rejected — do not spend an afternoon on these again
// (all 4 seeds x 3-4k ticks, population against a tradeless baseline of 269-302):
//
//   * seams only, no diffuse ore (bg = 0): population 78 against 302, and one
//     seed lost its carnivores outright. 65% of every mature, energy-ready body
//     was blocked on ore at any instant. This is the failure the header warns
//     about: the requirement pruned the map instead of shaping it.
//   * raising the pickup rate to fix that: rate 0.06 -> 0.15 -> 0.30 gave 128 ->
//     98 -> 98. It never was a mining-speed problem. The binding constraint is
//     whether a grazer ever walks over a seam at all, and a grazer follows the
//     standing crop, which grows where the seams are not. Only ore in the soil
//     everywhere fixed it.
//   * bg is the population/pressure dial and the whole curve was measured
//     (pop / block rate / deals per 4k ticks): .004 -> 203 / .222 / 182,
//     .005 -> 221 / .152 / 171, .006 -> 248 / .124 / 195, .008 -> 230 / .080 /
//     160, .010 -> 258 / .055 / 163. 0.006 is not a compromise, it is the peak:
//     it clears the most deals of any value tried while still leaving one ready
//     body in eight waiting on ore. Above it the population recovers only by the
//     requirement ceasing to matter — at .010 the reserve saturates (49% of
//     bodies carrying the full cap) and buyers stop existing.
//   * need = 2.0 with a fixed carry cap of 3: exactly zero deals ever cleared,
//     because a seller must hold need*2 = 4 and could only ever hold 3. That is
//     why the cap is holdN births' worth rather than an absolute number.
//   * need = 0.8 at bg .004 (a gentler requirement instead of more ore): 229 /
//     .094 / 159 — dominated by bg .006 on every axis, so the ore field, not the
//     price of a birth, is the right dial.
//   * meet 0.05 with tradeR 62: 0.096 deals per birth. Deals were real but far
//     too rare for anything to be measurable on top of them; a pool census showed
//     75 willing sellers and 28 willing buyers per step but only 5.5 pairs within
//     reach. Widening reach and raising the per-step chance (0.6 / 90px) took it
//     to ~0.3 deals per birth without changing who deals with whom.
// ---------------------------------------------------------------------------
const K = {
  perPlanet: 7,       // concentrated seams per planet
  rMin: 58, rMax: 96, // seam radius
  cap: 40,            // rations a seam holds when full
  regen: 0.25,        // rations/step a seam recovers (so a crowded seam still runs dry)
  rate: 0.15,         // rations/step picked up while standing on a seam
  bg: 0.006,          // rations/step from diffuse ore in the soil, times local ore richness
  holdN: 3,           // most a body will carry, in births' worth (see note at gather())
  need: 0.5,          // rations one birth costs (was 1.0; see the requirement note below)
  tradeR: 90,         // how far a deal reaches
  priceF: 0.09,       // price of one ration, as a fraction of the buyer's reproE
  keep: 0.9,          // fraction of the price that reaches the seller (the rest is the cost of dealing)
  meet: 0.6           // per-step deal chance for a willing pair, scaled by min(trade gene)
  // the upkeep of the `trade` gene used to live here as K.carry; it now sits on
  // the common level-2 line in genome.js's metabolism(), where its five siblings
  // are charged, and is suspended by P.tradeNoExchange exactly as it was here
};

// ---------------------------------------------------------------------------
// The map's own asymmetry.
//
// world.js's fertilityAt() is not imported here on purpose: world.js imports this
// module, and a cycle between the two is a needless hazard for four lines of
// arithmetic. This is the same field, recomputed locally, and it is the ONLY
// thing that decides where minerals are: a seam is placed wherever the ground is
// poorest, so mineral country and food country are never the same country. No
// rule anywhere says "herbivores are mineral-poor" — it falls out of the fact
// that a grazer follows the standing crop and the crop grows where the seams
// are not.
// ---------------------------------------------------------------------------
function fertAt(x, y){
  const PL = S.planets;
  let f = 1;
  if(PL.length){
    f = 0.1;
    for(let i = 0; i < PL.length; i++){ const p = PL[i]; if(x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h){ f = p.fert; break; } }
  }
  const B = S.biomes;
  for(let i = 0; i < B.length; i++){ const bm = B[i], d2 = (x - bm.x) ** 2 + (y - bm.y) ** 2;
    if(d2 < bm.r * bm.r) f += bm.fert * (1 - Math.sqrt(d2) / bm.r); }
  return clamp(f, 0.1, 2.4);
}

// ---------------------------------------------------------------------------
// The ore field, baked to a grid.
//
// gather() runs once per body per step, so it must not walk a list of seams and
// must not evaluate fertAt(): both are O(planets + biomes) per body per step and
// both showed up in the profile. Instead the whole map is baked once into two
// flat arrays at GCELL resolution — a yield per cell and the index of the seam
// covering it, if any — so a pickup is one index computation and one array read.
//
// The diffuse yield is the safety valve that makes the breeding requirement
// survivable. The first build had ore ONLY in seams; 65% of every energy-ready,
// mature body was blocked on ore at any moment and the population settled at a
// third of the baseline (measured: 78 vs 302 over 4 seeds x 3k ticks), with
// carnivores gone on one seed. Raising the pickup rate did not help at all
// (98 at rate 0.15, 128 at 0.06) because the binding constraint was never how
// fast you mine — it was whether you ever walk over a seam, and a grazer
// following the standing crop does not. Ore in the soil everywhere, at a rate
// that scales with how poor the ground is, turns the requirement from a cliff
// into a gradient: rich country still breeds, just slower, and a seam is worth
// walking to (or buying from) rather than being the only way to have young.
// ---------------------------------------------------------------------------
const GCELL = 32;
let _gGain = null, _gDep = null, _gCols = 0, _gRows = 0, _gVer = 0;
function bake(){
  const cols = Math.max(1, Math.ceil((S.worldW || 1) / GCELL)), rows = Math.max(1, Math.ceil((S.worldH || 1) / GCELL));
  const gain = new Float32Array(cols * rows), dep = new Int16Array(cols * rows).fill(-1);
  const M = S.minerals;
  for(let cy = 0; cy < rows; cy++) for(let cx = 0; cx < cols; cx++){
    const x = (cx + 0.5) * GCELL, y = (cy + 0.5) * GCELL, i = cy * cols + cx;
    // Ore richness is the inverse of fertility, normalised over the range
    // fertilityAt() can actually produce. This one line is the entire source of
    // comparative advantage in the module: nothing tells a species where to be,
    // the map just makes food and ore grow in different places — and the pair
    // statistic in the header (sellers stand on ore-richer ground than their
    // buyers on every seed, z = 2.2..9.5) is this line showing up in the deals.
    gain[i] = K.bg * clamp((1.9 - fertAt(x, y)) / 1.6, 0.05, 1);
    for(let k = 0; k < M.length; k++){ const d = M[k]; if((x - d.x) ** 2 + (y - d.y) ** 2 < d.r * d.r){ dep[i] = k; break; } }
  }
  _gGain = gain; _gDep = dep; _gCols = cols; _gRows = rows; _gVer++;
}

// Recent exchanges, for the render layer only: {x, y, t}. Never read by the
// simulation, so drawing it can never perturb the world.
let _flash = [];

function applyTune(){ const t = P.tradeK; if(t) for(const k in t) if(k in K) K[k] = t[k]; }

// ---------------------------------------------------------------------------
// Deposits. Placed lazily rather than in tradeReset(), because seed() calls
// tradeReset() BEFORE buildPlanets()/generateBiomes() — at reset time there is no
// map to read yet. mineralTick() runs inside the step loop, so the placement
// draws from the same seeded stream and stays reproducible.
// ---------------------------------------------------------------------------
function placeDeposits(){
  const PL = S.planets; if(!PL.length) return;
  const M = [];
  for(let pi = 0; pi < PL.length; pi++){
    const p = PL[pi];
    for(let k = 0; k < K.perPlanet; k++){
      // best-of-5 for the *poorest* ground on the planet. Best-of-N rather than a
      // hard fertility threshold because a planet with a high base fertility has no
      // ground below any fixed threshold, and would end up with no minerals at all —
      // which is exactly the "mineral-poor planet is a death sentence" failure.
      let bx = 0, by = 0, bf = 1e9;
      for(let t = 0; t < 5; t++){
        const x = rnd(p.x + 60, p.x + p.w - 60), y = rnd(p.y + 60, p.y + p.h - 60), f = fertAt(x, y);
        if(f < bf){ bf = f; bx = x; by = y; }
      }
      M.push({ x: bx, y: by, r: rnd(K.rMin, K.rMax), amt: K.cap * rnd(0.5, 1), cap: K.cap, p: pi });
    }
  }
  S.minerals = M; bake();
}

export function mineralTick(){
  applyTune();
  if(!S.minerals.length){ placeDeposits(); return; }
  // restore() hands back the seams before it restores the biomes, so the field is
  // baked here (the step after) rather than in unpackMinerals(), where the map it
  // has to read does not exist yet.
  if(!_gGain || _gCols !== Math.max(1, Math.ceil(S.worldW / GCELL))) bake();
  // Regrowth is deliberately generous compared with the world's birth rate: the
  // binding constraint is meant to be *where* the minerals are, not how many there
  // are. Depletion still matters locally — a seam with fifty grazers standing on it
  // drains at 1.0/step against 0.25/step of regrowth — so a crowded seam is a
  // commons that runs dry, and the pressure to look elsewhere (or to buy) is real.
  const M = S.minerals;
  for(let i = 0; i < M.length; i++){ const d = M[i]; if(d.amt < d.cap) d.amt = Math.min(d.cap, d.amt + K.regen); }
  if(_flash.length && S.tick % 8 === 0){
    for(let i = _flash.length - 1; i >= 0; i--) if(S.tick - _flash[i].t > 40) _flash.splice(i, 1);
  }
}

// ---------------------------------------------------------------------------
// gather(): the hot path — once per body per step. Allocation-free, no loops, two
// array reads in the worst case, and it exits on the first branch for any body
// already carrying enough. Measured at 0.028 us per body, 0.007 ms for a whole
// 250-body population, against a ~3 ms step. The reserve ceiling is three births'
// worth rather than unbounded because a body that can bank twenty never needs a
// neighbour: with no ceiling the sellers stop existing and exchange collapses.
// ---------------------------------------------------------------------------
export function gather(c){
  const m = c.min || 0;
  if(m >= K.need * K.holdN) return;
  const G = _gGain; if(!G) return;
  const cx = (c.x * (1 / GCELL)) | 0, cy = (c.y * (1 / GCELL)) | 0;
  if(cx < 0 || cy < 0 || cx >= _gCols || cy >= _gRows) return;
  const i = cy * _gCols + cx, k = _gDep[i];
  if(k < 0){ c.min = m + G[i]; return; }              // diffuse ore in the soil
  const d = S.minerals[k];                            // a worked seam: concentrated, and finite
  if(!d || d.amt <= 0){ c.min = m + G[i]; return; }
  const take = K.rate < d.amt ? K.rate : d.amt;
  d.amt -= take; c.min = m + take;
}

// ---------------------------------------------------------------------------
// The requirement. A birth costs one ration on top of the energy world.js already
// demands. This is the whole reason minerals are not a decoration, and it is the
// most dangerous number in the module: too steep and the world simply stops
// breeding. It is a *delay*, not a veto — a body with energy but no ore keeps
// living, keeps banking, and breeds as soon as it crosses a seam or buys one —
// which is why a mineral-poor patch is a fitness cost rather than a cull.
//
// AND IT WAS THE LEVEL-2 POPULATION SINK. Note 4 above measured this requirement
// against a tradeless world and called it an 8% cost. That measurement was taken
// with only `tradeOn` live. With all six level-2 flags live it is not 8%, it is
// most of the regression: the other mechanics each pull bodies below the energy
// line for a while, and every body that spends longer under the line spends
// longer accumulating ore it cannot use, while a body that is finally energy-ready
// now finds a *second* gate in front of it. The two costs multiply. Measured,
// 3 seeds (11/23/37) x 6000 ticks, sampled every 200 ticks after tick 2400,
// mean +- sd ACROSS SEEDS (`blocked` = mature, energy-ready bodies held back by
// this gate; `ready` = mature and energy-ready):
//
//   arm                pop      ready  blocked  births/1k  trades   fights  villages
//   all level-2 off  289+-55   88+-12    0.00     250+-81       0        0      0.00
//   need = 1.0       197+-62   57+-20    7.82     154+-53  201+-69     6013      7.28
//   need = 0.5       277+-40   76+-19    4.16     244+-12  199+-27     9183      6.10
//   need = 0         236+-62   62+-20    0.00     216+-75        0     8898      6.04
//
// At need 1.0 one energy-ready body in seven is standing still waiting for ore at
// any instant, and the birth rate falls by 38% against the level-2-off world.
// Halving the requirement restores the population to within 4% of that baseline
// while the exchange itself is untouched (199+-27 deals against 201+-69) and every
// other level-2 mechanic runs harder, not weaker.
//
// REJECTED: need = 0. It is worse than need = 0.5 on population (236+-62) *and*
// it clears exactly zero deals, because nothing is scarce enough to be worth
// buying. The requirement is not the problem; its size was. Do not "fix" this by
// deleting it. (Note 1's permutation test was NOT re-run at 0.5; what is known is
// that the deal count is unchanged, so the pool of pairs it tested still exists.)
// ---------------------------------------------------------------------------
export function canBreed(c){ return (c.min || 0) >= K.need; }

// world.js checks canBreed() once per breeding event but calls payBreed() once per
// egg, so a clutch of two charges twice against a single check; the clamp at zero
// is what keeps that from running the account negative. Only the primary parent
// pays for a sexual birth — world.js has no hook for the partner.
export function payBreed(c){ const m = (c.min || 0) - K.need; c.min = m > 0 ? m : 0; }

// Energy this module removes from the ecology. Only one channel: K.keep < 1, so a
// tenth of every price paid vanishes in the exchange. Instrument only.
export const tradeStats = { loss: 0 };

export function tradeReset(){ S.minerals = []; S.trades = 0; _gGain = null; _gDep = null; _flash = []; _tint = null; tradeStats.loss = 0; applyTune(); }

// ---------------------------------------------------------------------------
// Exchange.
//
// Who sells and who buys is decided by where a body lives, not by its genes: a
// body standing on a seam with a thin reserve has ore and wants energy; a body
// grazing rich ground has energy and no ore. Both are one trade away from a birth
// they cannot otherwise have, so the deal is a strict gain to both sides and no
// altruism is involved. The `trade` gene only says how readily a body deals —
// both parties must be willing, so the pair rate is min(a, b).
//
// The gene is not free: carrying it costs upkeep every step, charged on the common
// level-2 line in genome.js's metabolism() alongside its five siblings, and gated
// on P.tradeNoExchange there so the control arm stays neutral. Without a cost the gene is a free
// lunch and rises everywhere including in worlds with nothing to trade, which
// makes the whole measurement meaningless.
//
// P.tradeNoExchange is a research switch, not a game setting: it suspends both
// the exchange and its upkeep so `trade` becomes a strictly neutral gene, which
// is the drift control every claim about selection here is measured against.
// P.tradeLog is the other one: it records both ends of every deal into S.tradeLog
// so the pair statistic in the header can be recomputed. Both default to
// undefined, so the shipped game never pays for either.
//
// mineralTick() + tradeTick() together cost 0.048 ms/step against a ~3.0 ms step
// (4 seeds x 4k ticks, ~250 bodies): the bucket grid is rebuilt in place rather
// than reallocated, holds only the buyers, and is probed nine cells at a time from
// the seller list, so the pass is one sweep of the population plus a short local
// scan instead of an all-pairs test.
// ---------------------------------------------------------------------------
const CELL = 64;
let _cells = null, _cols = 0, _rows = 0;
const _sellers = [];

// ---------------------------------------------------------------------------
// CARRIED-OVER ITEM (b): a deal is a reciprocity event and should be in the ledger.
//
// world.js already keeps a per-body ledger of recent non-kin partners
// (world.js:115-125) and the reciprocal-altruism block reads it: a negative score
// means "I gave to them and they owe me", a positive one means "they helped me".
// A trade is exactly that kind of event and today it is invisible to it, so a
// body that has just bought its way out of a mineral shortage does not remember
// who sold to it, and a seller has no history to consult before dealing again.
//
// The two functions are declared in world.js but not exported. The signatures
// this module needs are the ones already in use there, unchanged:
//
//   export function ledgerScore(c, id)      // -> number, 0 if `id` is not on c's ledger
//   export function ledgerBump(c, id, d)    // d is +1 or -1
//
// THE ONE-LINE CHANGE, once world.js exports them: delete the `let` line below and
// uncomment the import. Nothing else in this file moves — the call sites are live
// and simply do nothing while the hooks are null. Note that world.js imports this
// module, so the import is a cycle; it is safe because both are hoisted function
// declarations and neither is called at module-evaluation time.
//
// import { ledgerScore as _ledgerScore, ledgerBump as _ledgerBump } from './world.js';
let _ledgerScore = null, _ledgerBump = null;
// Threshold for refusing to deal. A body only reaches -3 by having been given to
// repeatedly without reciprocating, so this is "you have taken from me three times
// and never paid it back", not a general suspicion of strangers.
const LEDGER_CUT = -3;
// ---------------------------------------------------------------------------

export function tradeTick(){
  const C = S.creatures, n = C.length;
  if(!n) return;
  const off = P.tradeNoExchange;
  if(off) return;                        // upkeep included: see the note on K above

  // A bucket grid holding only the *buyers* — bodies with spare energy and no ore.
  // Grid the smaller side and scan from the sellers, so the pass costs one sweep
  // of the population plus a nine-cell probe per seller instead of an all-pairs test.
  const cols = Math.max(1, Math.ceil(S.worldW / CELL)), rows = Math.max(1, Math.ceil(S.worldH / CELL));
  if(!_cells || _cols !== cols || _rows !== rows){ _cells = new Array(cols * rows); _cols = cols; _rows = rows; }
  else for(let i = 0; i < _cells.length; i++){ const b = _cells[i]; if(b) b.length = 0; }
  _sellers.length = 0;
  let anyBuyer = false;
  for(let i = 0; i < n; i++){
    const c = C[i], g = c.g;
    if(!g.trade) continue;
    const reproE = P[TYPES[c.type].reproE], m = c.min || 0;
    if(m < K.need && c.energy > reproE * (1.02 + K.priceF)){   // has the energy to spare, lacks the ore
      const cx = clamp(Math.floor(c.x / CELL), 0, cols - 1), cy = clamp(Math.floor(c.y / CELL), 0, rows - 1);
      const k = cy * cols + cx; (_cells[k] || (_cells[k] = [])).push(c); anyBuyer = true;
    } else if(m >= K.need * 2 && c.energy < reproE * 0.9){ // has ore to spare, wants the energy
      _sellers.push(c);
    }
  }
  if(!anyBuyer || !_sellers.length) return;

  const R2 = K.tradeR * K.tradeR;
  for(let si = 0; si < _sellers.length; si++){
    const s = _sellers[si];
    if((s.min || 0) < K.need * 2) continue;              // may have sold already this step
    const gcx = clamp(Math.floor(s.x / CELL), 0, cols - 1), gcy = clamp(Math.floor(s.y / CELL), 0, rows - 1);
    for(let ox = -1; ox <= 1; ox++){
      const nx = gcx + ox; if(nx < 0 || nx >= cols) continue;
      for(let oy = -1; oy <= 1; oy++){
        const ny = gcy + oy; if(ny < 0 || ny >= rows) continue;
        const b = _cells[ny * cols + nx]; if(!b) continue;
        for(let bi = 0; bi < b.length; bi++){
          const o = b[bi];
          if(o === s || o.dead || (o.min || 0) >= K.need) continue;
          const dx = o.x - s.x, dy = o.y - s.y;
          if(dx * dx + dy * dy > R2) continue;
          const ts = s.g.trade, to = o.g.trade;
          // a seller who has been repeatedly taken from by this buyer without
          // return will not deal with it again (inert until world.js exports the ledger)
          if(_ledgerScore && _ledgerScore(s, o.id) <= LEDGER_CUT) continue;
          if(rand() >= (ts < to ? ts : to) * K.meet) continue;
          const price = P[TYPES[o.type].reproE] * K.priceF;
          if(o.energy - price < P[TYPES[o.type].reproE]) continue;   // never sell yourself out of your own birth
          o.energy -= price; s.energy += price * K.keep;
          tradeStats.loss += price * (1 - K.keep);   // the broker's cut: destroyed, not moved
          o.min = (o.min || 0) + K.need; s.min -= K.need;
          S.trades++;
          // the deal is a reciprocity event on both ledgers: the seller has given
          // ore and is owed, the buyer has been helped and remembers it
          if(_ledgerBump){ _ledgerBump(s, o.id, -1); _ledgerBump(o, s.id, +1); }
          if(_flash.length < 120) _flash.push({ x: (s.x + o.x) * 0.5, y: (s.y + o.y) * 0.5, t: S.tick });
          // research hook: both endpoints, not just the midpoint, because the question
          // "does exchange pair ore country with food country?" is about the *pair*.
          if(P.tradeLog){ const L = S.tradeLog || (S.tradeLog = []); L.push({ x: (s.x + o.x) * 0.5, y: (s.y + o.y) * 0.5, sx: s.x, sy: s.y, ox: o.x, oy: o.y, t: S.tick }); }
          if((s.min || 0) < K.need * 2){ ox = 2; oy = 2; break; }    // sold out — next seller
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Drawing. Never calls rand(): a determinism test depends on rendering being
// free of the simulation's random stream, so every wobble here is a function of
// the deposit's own coordinates.
// ---------------------------------------------------------------------------
const TAU = Math.PI * 2;
// The diffuse ore field baked to a tiny bitmap once per world and blitted, so the
// player can see that ore country and food country are different country — the
// whole premise of the mechanic — for the cost of one drawImage per frame.
let _tint = null, _tintVer = -1;
function tintCanvas(){
  if(_tint && _tintVer === _gVer) return _tint;
  if(!_gGain || typeof document === 'undefined') return null;
  const cv = document.createElement('canvas'); cv.width = _gCols; cv.height = _gRows;
  const c2 = cv.getContext('2d'), img = c2.createImageData(_gCols, _gRows), px = img.data;
  const top = K.bg || 1;
  for(let i = 0; i < _gGain.length; i++){
    const v = clamp(_gGain[i] / top, 0, 1), j = i * 4;
    px[j] = 110; px[j + 1] = 195; px[j + 2] = 220; px[j + 3] = Math.round(v * v * 46);
  }
  c2.putImageData(img, 0, 0);
  _tint = cv; _tintVer = _gVer; return cv;
}
export function drawWorld(ctx, view){
  const M = S.minerals; if(!M.length) return;
  const z = view.z, vis = view.vis;
  const tc = tintCanvas();
  if(tc){ const sm = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tc, 0, 0, _gCols * GCELL, _gRows * GCELL); ctx.imageSmoothingEnabled = sm; }
  for(let i = 0; i < M.length; i++){
    const d = M[i]; if(!vis(d.x, d.y, d.r + 6)) continue;
    const full = clamp(d.amt / (d.cap || 1), 0, 1);
    // the seam itself: a cold mineral bloom, deliberately in a hue nothing else
    // in the palette uses, so ore country reads at a glance against green food country
    const grd = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r);
    grd.addColorStop(0, `rgba(120,205,225,${0.05 + 0.10 * full})`);
    grd.addColorStop(1, 'rgba(120,205,225,0)');
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, TAU); ctx.fill();
    ctx.strokeStyle = `rgba(140,215,235,${0.13 + 0.22 * full})`; ctx.lineWidth = 1.2 / z;
    ctx.setLineDash([3 / z, 6 / z]); ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    if(z > 0.25){
      // crystals: as many as the seam still holds, so a worked-out deposit visibly empties
      const nX = 3 + Math.round(full * 5);
      ctx.fillStyle = `rgba(168,232,246,${0.35 + 0.45 * full})`;
      ctx.strokeStyle = 'rgba(60,110,130,0.7)'; ctx.lineWidth = 0.9 / z;
      for(let k = 0; k < nX; k++){
        const a = (k * 2.399963) + (d.x + d.y) * 0.01, rr = d.r * (0.18 + 0.52 * ((k * 7 % 5) / 5));
        const cx = d.x + Math.cos(a) * rr, cy = d.y + Math.sin(a) * rr, s = 2.4 + (k % 3);
        ctx.beginPath(); ctx.moveTo(cx, cy - s); ctx.lineTo(cx + s * 0.62, cy); ctx.lineTo(cx, cy + s); ctx.lineTo(cx - s * 0.62, cy);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    }
  }
  // a brief spark where a deal was struck, so exchange is visible as it happens
  for(let i = 0; i < _flash.length; i++){
    const f = _flash[i], age = S.tick - f.t; if(age < 0 || age > 40) continue;
    if(!vis(f.x, f.y, 12)) continue;
    const a = 1 - age / 40;
    ctx.strokeStyle = `rgba(190,240,255,${0.5 * a})`; ctx.lineWidth = 1.4 / z;
    ctx.beginPath(); ctx.arc(f.x, f.y, 4 + 8 * (1 - a), 0, TAU); ctx.stroke();
  }
}

// Save encoding. Positions round to whole pixels and stock to 2dp, matching what
// the rest of snapshot() does with biomes and rocks. Verified: snapshot -> JSON ->
// restore leaves every seam and every body's reserve identical at that precision,
// the S.trades counter intact, and the world trading again immediately (81 further
// deals in the 1500 steps after a restore, no NaN, and a second round trip clean).
export function packMinerals(){
  return S.minerals.map(d => [+d.x.toFixed(0), +d.y.toFixed(0), +d.r.toFixed(0), +d.amt.toFixed(2), +(d.cap || K.cap).toFixed(0), d.p | 0]);
}

export function unpackMinerals(a){
  S.minerals = (a || []).map(v => ({ x: v[0], y: v[1], r: v[2], amt: v[3], cap: v[4] || K.cap, p: v[5] | 0 }));
  _gGain = null; _gDep = null; _tint = null;   // rebaked by the next mineralTick(), once the biomes are back
}
