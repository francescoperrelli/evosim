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
// ===========================================================================
// WHAT THIS ACTUALLY DOES, MEASURED. Read this before tuning anything below.
//
// --- 1. THE PUBLIC GOOD: does assortment rescue `terra` where cost cannot? ---
//
// The brief for this module was explicit that bigger costs are not the lever —
// genome.js's l2Cost sweep already showed a functionless gene moves 0.228 -> 0.097
// only when the charge reaches half a herbivore's entire energy budget. The theory
// says the lever is ASSORTMENT: make the return land on the bodies that paid.
// So the mechanic was built with the assorting channel as a switch (TERRA.assort)
// and measured in three arms against a matched drift control.
//
// 3 seeds (2024 / 4048 / 777) x 14000 ticks, population-mean `terra` sampled every
// 250 ticks after a 4000-tick warm-up, then averaged. Founding mean is 0.075
// (genome.js seeds it rnd(0, 0.15)). Figures are mean +- sd ACROSS SEEDS.
//
//   arm                                              terra mean   per seed        pop
//   drift  TERRA.payoff = 0: improved ground gives   0.193+-0.023  .167/.191/.222  217
//          nothing at all, cost still charged,
//          gene still mutating
//   pub    payoff on, assort = 0: the whole return   0.255+-0.062  .237/.189/.338  211
//          goes into the public fertility channel
//   kin    payoff on, assort = 1: half the return    0.246+-0.040  .298/.239/.202  205
//          is withheld from the commons and paid
//          to co-clade bodies standing on the patch
//
// READ IT HONESTLY: THIS IS DRIFT IN ALL THREE ARMS. The two payoff arms sit 0.05
// above the drift control while the between-seed sd is 0.02-0.06, so the arms
// overlap inside a single seed's worth of noise and the per-seed columns interleave
// (drift's best seed, 0.222, beats kin's worst, 0.202). Every arm climbs from 0.075
// toward the middle of the range, including the arm where the gene does literally
// nothing — that rise is diffusion off the lower clamp under a gaussian random
// walk, not selection. It is the same signature village.js recorded for `civic`
// and genome.js for `fidelity`.
//
// ***************************************************************************
// --- 1b. THAT VERDICT IS OVERTURNED AT 40 000 TICKS. THE RUN WAS TOO SHORT. --
// ***************************************************************************
// The measurement above is correct as far as it goes and its own last bullet said
// what was wrong with it: 14000 ticks is ~21 generations, and nothing with a small
// coefficient is resolvable in 21 generations. Re-run at 40 000 ticks (~41
// generations, S.maxGen 41 at t=40000) the arms separate cleanly and in every seed.
//
// 15 runs, 3 seeds (1234 / 2024 / 4048) x 5 arms x 40 000 ticks, one short-lived
// headless process per (arm, seed), population-mean `terra` sampled every 1000
// ticks. The control is TERRA.payoff = 0 as before. The other FOUR arms all leave
// terra at its shipped settings while knocking out an unrelated mechanic (fire off,
// tools off, marks shuffled, or nothing at all), so they are four independent
// replicates of "payoff on" against the same three seeds — 12 paired contrasts.
//
//   window     mean(payoff-on  -  payoff-off), paired by seed   n positive
//   0-5k       -0.005  (sd 0.016)                                5/12
//   5-10k      +0.004  (sd 0.047)                                7/12
//   10-15k     +0.036  (sd 0.083)                                8/12
//   15-20k     +0.063  (sd 0.111)                                8/12
//   20-25k     +0.142  (sd 0.108)                               11/12
//   25-30k     +0.155  (sd 0.114)                               12/12
//   30-35k     +0.171  (sd 0.113)                               12/12
//   35-40k     +0.232  (sd 0.163)                               11/12
//
// Endpoint means over 30-40k: payoff-off 0.265 +- 0.078 (.269/.186/.341) against
// 0.485 +- 0.147 for the shipped arm and 0.418 / 0.448 / 0.518 for the other three
// payoff-on arms. THE SIGNAL DOES NOT EXIST BEFORE ~20 000 TICKS AND IS UNAMBIGUOUS
// AFTER 25 000. That is the whole finding: this gene is under real but weak
// selection, and 14000 ticks is inside the interval where selection has not yet
// beaten the mutational random walk. Nothing about the mechanic changed; only the
// length of the observation did.
//
// Two things to keep honest about it:
//   * The trajectory is monotone. It is NOT "it moved and a population crash reset
//     it" — the paired difference grows in every window from 10k on and never
//     retraces, across four independent payoff-on arms.
//   * The control is not a fixed baseline. A functionless level-3 gene sits near
//     0.19 at 6-10k ticks (which is what every earlier level-3 write-up quotes) but
//     it does not stop there: the mutation operator is a gaussian clamped into
//     [0,1], whose stationary distribution is uniform, so a neutral gene keeps
//     diffusing toward a population mean of 0.5. Measured: the tools-off control
//     gene reaches 0.505 +- 0.115 and the fire-off control 0.526 +- 0.097 by
//     30-40k. Long runs therefore do NOT buy free statistical power — the
//     between-seed sd of a neutral gene grows with time too (0.02 at 5k, 0.10-0.16
//     at 40k). Terra separates because its effect grows faster than that spread,
//     not because the noise went away.
//
// The structural objections in the bullets below are all still true — the return is
// spatial, the modal improved cell is empty, the public channel feeds free riders,
// and fertilityAt() cannot grow a planet's carrying capacity. The correct reading
// is that they bound the size of the coefficient, not its sign, and 40 generations
// is enough time for a coefficient that small to express. ASSORTMENT STILL DOES NOT
// APPEAR TO BE THE LEVER: at 30-40k the kin arm (shipped, assort = 1) and the three
// arms that also run assort = 1 are all in the same band, and this batch did not
// re-run assort = 0, so what is demonstrated is PAYOFF vs NO PAYOFF, not kin vs
// commons. Re-running the assort = 0 arm at 40 000 ticks is the obvious next
// measurement and it has not been done.
//
// ASSORTMENT DID NOT RESCUE THE GENE. The reason is structural, not a tuning
// failure, and it is worth writing down precisely:
//
//   * There is no kinship key in this repo fine enough to assort on. c.lineage is
//     minted at the founder and never re-minted, so after a few thousand ticks a
//     "lineage" is the whole planet: paying co-lineage bodies produced 781096 kin
//     payments over 1481370 body-ticks (seed 2024, 8000 ticks) — 53% of all
//     body-ticks collected, i.e. a universal subsidy, not assortment. Re-keying to
//     an ancestry-chain clade (cladeKey(), CLADE = 8) barely moved it: still 52.7%
//     of body-ticks collecting, and the pay-weighted gene of the payers (0.366)
//     against the gain-weighted gene of the collectors (0.311) with a population
//     mean near 0.35 puts the assortment coefficient at or slightly BELOW zero.
//     Finer relatedness would need parent-chain machinery world.js does not expose.
//   * Even with a perfect kinship key the return is spatial and the cost is
//     immediate: a body pays now, at its own position, and collects only if it or a
//     relative stands on that exact cell later. A 56 px cell on a 1200x820 planet
//     holds well under one body at the ~200-body equilibrium, so the modal improved
//     cell is empty and the modal collector is nobody.
//   * The public channel cannot select the gene by construction — raising
//     fertilityAt() feeds the free-rider exactly as much as the contributor.
//     village.js recorded the identical result for the identical reason.
//   * Deeper still, and the finding that most limits this whole mechanic: in
//     world.js the total food on a planet is capped at P.maxFood and grows
//     logistically INDEPENDENT of fertility. fertilityAt() is only a best-of-3
//     argmax for WHERE a seed lands. Terraforming therefore redistributes food
//     inside a planet; it does not raise the planet's carrying capacity. A public
//     good that cannot grow the pie can only ever be a positional good.
//   * And the run is too short in generations to resolve a weak effect anyway:
//     S.maxGen reaches 12 by tick 8000, i.e. ~660 ticks per generation, so 14000
//     ticks is about 21 generations. genome.js's own sweep needed a 100x cost to
//     move a functionless gene 0.13 over comparable runs. Nothing with a
//     coefficient this small is resolvable against mutational noise in 21
//     generations, whatever the assortment.
//
// REJECTED TUNINGS, with the numbers that rejected them:
//   * Kin return x3.4 (TERRA.assort = 3.4, i.e. KIN_YIELD 0.10 -> 0.34 energy at
//     q = 1, roughly a whole herbivore's metabolism): terra 0.239 +- 0.040
//     (.188/.244/.286) against kin's 0.246 +- 0.040 and drift's 0.193 +- 0.023.
//     Tripling the private return moved the gene by less than the seed noise.
//     Rejected: it stopped being a bounded niche-construction return and became a
//     food source, and it still did not select the gene. This is the measurement
//     that says the failure is not about the size of the number.
//   * Q_GAIN 0.012 (first cut): equilibrium q settled at 0.05, so fertBonus
//     contributed +0.012 against a planet baseline of 0.75-1.55 — under 1%, i.e.
//     the mechanic was inert and the three-arm comparison would have been vacuous.
//     Raised to 0.05, which puts equilibrium q at 0.13-0.24 and a live payoff.
//   * Paying the kin return scaled by the COLLECTOR's own `terra` gene. Not
//     measured, and deliberately so: it makes improved ground a private good only
//     carriers can eat, which is a green-beard written by hand rather than
//     assortment arising from viscosity. It would have manufactured the headline
//     number instead of measuring it.
//
// --- 2. LOCALISED PLANETARY EVENTS ---
//
// Three kinds, each confined to ONE planet: an impact (a crater of sterile ground
// plus a bounded energy hit), a bloom (a planet-wide fertility lift) and a winter
// (a planet-wide fertility drop). Measured over 3 seeds x 10000 ticks:
//
//   events fired        12 per run (3.0 impacts / 4.3 blooms / 4.7 winters)
//   mean population     events on   195   (147 / 244 / 195)
//                       events off  210   (166 / 248 / 215)   -> -6.8%
//   planets emptied     0 with events on AND 0 with events off
//   lowest population   events on   3 / 12 / 10
//   on any one planet   events off  1 / 12 /  6
//
// The -6.8% is the same sign in all three seeds, so events do cost population, but
// the size is inside the seed-to-seed spread (147-244) and cannot be quoted more
// precisely than "a few percent" from three seeds. The line that matters for the
// blocked population regression is the last one: the deepest single-planet minimum
// in the whole experiment happens with events switched OFF (1 body, seed 2024), so
// near-emptying is a pre-existing property of this world and not something the
// asteroids introduced.
//
// The damage is bounded in three independent places: an event never fires on a
// planet holding fewer than EV_MIN_POP bodies, the impact crater is capped at 22%
// of the planet's short side, and the energy hit is capped at IMP_FRAC of the
// body's current energy per tick, so it thins a population along a gradient instead
// of killing a cohort. An asteroid that empties a planet is a worse bug than a
// boring one, and 'every planet sustains life' in the test suite is the check that
// says so.
//
// --- 3. RECONTACT ---
//
// Recontact is defined as: a species with >= 3 members arrives on a planet it has
// been absent from for >= 1500 ticks, on which a different species of the same tree
// has been resident. The isolation verdict comes from phylo.compatible(), i.e. the
// SAME criterion the mating loop uses — this module does not reimplement
// speciation, it only asks the question.
//
// Pooled over the nine arm runs above (9 x 14000 ticks):
//
//   recontacts detected        93 total, 10.3 per run  (~1 per 1350 ticks)
//   of which reproductively    85 of 93  =  91%
//   isolated
//   mean separation before     4433 ticks (min 1620, max 8040; n = 18, seed 2024)
//   recontact
//
// The honest reading of "91% isolated" is that it is mostly a statement about
// P.specThresh: by the time two populations have been apart for four thousand ticks
// their genome vectors have drifted past 0.42, so the answer was close to foregone.
// The informative half is the other one — 9% of recontacts were between lineages
// that could still interbreed, which is what makes the measurement a measurement
// and not a tautology. Cost: one pass over the population every 60 ticks.
//
// --- 4. COST ---
//
// Measured on a warmed field of 1185 patches, on a loaded 2-core box:
//   terraTick()   0.011-0.014 ms/step, with S.tick advancing so the 1/8 sweep and
//                 1/60 census cadences fire, against a 6.3-8.2 ms baseline step
//                 (~0.2%).
//   fertBonus()   0.13-0.18 microseconds/call — one integer cell key, one Map.get,
//                 and a rectangle scan over <= 6 planets that is skipped entirely
//                 when no planet-scale event is running. It is called once per
//                 dropped seed, so a few calls per step.
// The whole-step on/off delta was NOT resolvable above machine noise (+-1.5 ms
// between repeats of the identical replayed snapshot), which is itself the useful
// statement: the module costs less than the measurement error of a step.
//
// Flag-off identity, 1500 ticks with P.terraOn = false, fingerprints identical in
// this tree and in a clean checkout of f8051d2:
//   seed 1234 -> 7680651     seed 2024 -> 6602274     seed 777 -> 7244530
// ===========================================================================

import { P, S, TYPES } from './state.js';
import { rand, rnd, clamp, gauss } from './utils.js';
import * as phylo from './phylo.js';

/* ------------------------------------------------------------------ *
 * Research knobs. Exported and mutable ONLY so an experiment can knock
 * the payoff out from under the mechanic (payoff = 0) or switch the
 * assorting channel off (assort = 0) while leaving every cost and the
 * gene's mutation intact. That is the three-arm design recorded above.
 * Nothing in the shipped game writes these.
 * ------------------------------------------------------------------ */
export const TERRA = {
  payoff: 1,   // 0 = drift control: improved ground gives no benefit at all
  assort: 1,   // 0 = the whole return goes into the commons; 1 = half of it is kin-limited
  events: 1    // 0 = no localised planetary events (population-impact control)
};

/* ---------- tuning ---------- */

// Cell size of the improved-ground field. This is the spatial index: S.terra is a
// list of cells and `patches` maps cell key -> cell, so fertBonus() is one integer
// division and one Map.get however long the game has been running. 56 px is a
// little under the 58 px neighbour radius, so a cell is roughly "the ground one
// body is working" rather than a region.
const TCELL = 56;
const MAX_PATCH = 4200;         // hard ceiling on the field (a 4-planet world has ~3000 cells)

// What a body pays to improve the ground, and what the ground gains for it.
// WORK_EVERY staggers the work by body id so the cost is smooth across the
// population rather than a spike every N ticks.
const WORK_EVERY = 6;
const MIN_G = 0.04;             // below this the gene is not expressed and costs nothing
const WORK_E = 0.55;            // energy per work event at terra = 1 (~0.092/tick, ~26% of a herb's budget)
const WORK_FLOOR = 0.34;        // must hold this fraction of its reproduction threshold to work at all
const Q_GAIN = 0.05;            // improvement added to the cell per work event at terra = 1
const Q_CAP = 1;

// Relaxation back toward the planet's baseline. Half-life ~900 ticks for improved
// ground (long enough to outlive the body that made it, which is the whole point)
// and ~380 ticks for a crater (a scar heals faster than a garden decays).
const SWEEP_EVERY = 8;
const DECAY_UP = 0.99385;       // 0.99923^8
const DECAY_DOWN = 0.98551;     // 0.99819^8
const Q_EPS = 0.004;            // below this a cell is dropped from the field

// The two return channels. FERT_PER is the additive fertility a fully improved
// cell contributes in fertilityAt() (which clamps the total to 0.1..2.4, and whose
// planet baselines run 0.75..1.55). PUB_SHARE is how much of that survives when
// the assorting channel is on — the kin channel is not free extra benefit, it is
// the same benefit rerouted, so the three arms deliver comparable totals.
const FERT_PER = 0.50;
const PUB_SHARE = 0.5;
const KIN_YIELD = 0.10;         // energy/tick a co-clade body standing on a q=1 cell collects

// The kinship key the assorting channel uses. `c.lineage` was the obvious choice —
// it is what world.js already uses for kin food-sharing and village nursing — and
// it was measured and REJECTED: lineage is the founder's id and is never re-minted,
// so after a few thousand ticks a "lineage" is most of a planet. Measured at
// KIN_YIELD 0.10 over 8000 ticks (seed 2024): 781096 kin payments across 1481370
// body-ticks, i.e. 53% of all body-ticks collected. A key that everybody matches is
// not assortment, it is a subsidy, and it would have made the kin arm differ from
// the public arm only by injecting energy.
//
// So the key is a CLADE instead, cut out of the ancestry chain world.js already
// maintains (c.anc, the last 10 forebears with their generation numbers): the id of
// the oldest forebear on record whose generation is a multiple of CLADE. Two bodies
// share it when they share an ancestor inside the same 8-generation block, which is
// siblings, cousins and second cousins — a real family, not a phylum. It is stable
// under descent (a parent and its child agree except at a block boundary, once per
// CLADE generations) and it costs one scan of at most 10 entries.
const CLADE = 8;
function cladeKey(c){
  const a = c.anc;
  if(a && a.length){
    for(let i = 0; i < a.length; i++){ const e = a[i]; if(e.gen !== undefined && (e.gen % CLADE) === 0) return e.id; }
    return a[0].id;
  }
  return c.lineage || c.id;
}

/* ---------- localised planetary events ---------- */
// Rare, one planet at a time, and bounded everywhere it could hurt. EV_P is per
// planet per tick: ~1 event per planet per 2600 ticks, i.e. ~5 per planet over a
// 14000-tick run, which is often enough for the planets' histories to diverge and
// rare enough that a body may never see one.
const EV_P = 1 / 2600;
const EV_COOL = 700;            // ticks a planet is immune after an event
const EV_MIN_POP = 30;          // never fire on a planet that is already struggling
const IMP_LIFE = 1400, IMP_HOT = 40;
const IMP_R_FRAC = 0.22;        // crater radius as a fraction of the planet's short side
const IMP_Q = -0.85;            // how sterile the crater floor is (fertilityAt clamps at 0.1)
const IMP_DMG = 0.9;            // energy/tick at the centre during the hot window
const IMP_FRAC = 0.06;          // ...but never more than this fraction of the body's energy
const BLOOM_LIFE = 2200, BLOOM_MAG = 0.32;
const WINTER_LIFE = 2000, WINTER_MAG = -0.30;

/* ---------- recontact ---------- */
const RECON_EVERY = 60;         // ticks between per-planet species censuses
const RECON_MIN = 3;            // fewer members than this on a planet is a straggler, not a presence
const RECON_SEP = 1500;         // ticks of absence/residency that count as "long separated"
const RECON_MAX = 40;           // records kept

/* ---------- module state ---------- */

let patches = new Map();        // cell key -> patch object (the SAME objects held in S.terra)
let gcols = 0, gw = 0, grows = 0;
let events = [];                // active localised events
let cool = [];                  // per-planet event cooldown
let plOff = null;               // per-planet additive fertility offset from bloom/winter
let offActive = false;          // fast-path guard so fertBonus skips the planet scan
let hotImpacts = 0;             // number of impacts currently in their damage window
let presence = new Map();       // planet*1e6 + speciesId -> { first, last }
let seenPl = 0;

// live diagnostics: read by experiments and by the report, not part of the save
export const terraStats = {
  work: 0, energySpent: 0, kinPaid: 0, kinEnergy: 0,
  // the assortment measurement itself: gene value of the bodies that PAY, weighted
  // by what they pay, against gene value of the bodies that COLLECT, weighted by
  // what they collect. If the assorting channel works these two diverge from the
  // population mean in the same direction; if it does not, both sit on it.
  payGene: 0, colGene: 0, bodyTicks: 0, collectTicks: 0,
  impacts: 0, blooms: 0, winters: 0,
  recontacts: 0, isolated: 0, sepSum: 0
};
export const recontacts = [];   // { tick, planet, a, b, sep, isolated }

/* ---------- spatial index ---------- */
// The whole reason S.terra is indexed rather than scanned: fertBonus() is called
// once per dropped seed for the whole life of the game, and the improved field
// only ever grows. An array scan would be O(field); this is O(1).
function grid(){
  if(gw === S.worldW && gcols) return;
  gw = S.worldW;
  gcols = Math.max(1, Math.ceil((S.worldW || 1) / TCELL));
  grows = Math.max(1, Math.ceil((S.worldH || 1) / TCELL));
}
function keyAt(x, y){
  const cx = x < 0 ? 0 : (x / TCELL) | 0, cy = y < 0 ? 0 : (y / TCELL) | 0;
  return (cy < grows ? cy : grows - 1) * gcols + (cx < gcols ? cx : gcols - 1);
}

// which planet a point sits on (-1 = the void). Inlined rather than imported from
// world.js: terra.js is imported BY world.js, and a cycle here would be evaluated
// before world.js finished defining its exports.
function planetAt(x, y){
  const A = S.planets;
  for(let i = 0; i < A.length; i++){ const p = A[i]; if(x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) return i; }
  return -1;
}

/* ---------- lifecycle ---------- */

export function terraReset(){
  S.terra = [];
  patches = new Map(); gcols = 0; gw = 0;
  events = []; cool = []; plOff = null; offActive = false; hotImpacts = 0;
  presence = new Map(); seenPl = 0;
  recontacts.length = 0;
  terraStats.work = terraStats.energySpent = terraStats.kinPaid = terraStats.kinEnergy = 0;
  terraStats.payGene = terraStats.colGene = terraStats.bodyTicks = terraStats.collectTicks = 0;
  terraStats.impacts = terraStats.blooms = terraStats.winters = 0;
  terraStats.recontacts = terraStats.isolated = terraStats.sepSum = 0;
}

// A chronicle entry, written the same shape world.js's logEvent() writes. Not
// imported from world.js on purpose (see planetAt above). i18n.js has no keys for
// `chr_impact` / `chr_recontact` yet — that file belongs to another owner, so the
// entries currently render as their key until it is given the two strings.
function chron(key, n, x, y){
  S.chronicle.unshift({ tick: S.tick, key, n: n === undefined ? null : n,
    x: x === undefined ? null : Math.round(x), y: y === undefined ? null : Math.round(y), cid: null });
  if(S.chronicle.length > 80) S.chronicle.pop();
}

/* ---------- the field ---------- */

// Add `dq` to the cell containing (x, y), attributing it to clade `lin` (see
// cladeKey). Ownership is a Boyer-Moore majority vote, so a cell belongs to
// whichever family has put the most work into it and one passing stranger cannot
// take it over — which is what makes the improved ground a place rather than a pool.
function deposit(x, y, dq, lin){
  grid();
  const k = keyAt(x, y);
  let p = patches.get(k);
  if(!p){
    if(S.terra.length >= MAX_PATCH) return null;
    p = { k, x: ((x / TCELL) | 0) * TCELL + TCELL * 0.5, y: ((y / TCELL) | 0) * TCELL + TCELL * 0.5,
          q: 0, lin: lin || 0, own: 0 };
    patches.set(k, p); S.terra.push(p);
  }
  p.q = clamp(p.q + dq, -1, Q_CAP);
  if(dq > 0 && lin){
    if(p.lin === lin) p.own += dq;
    else { p.own -= dq; if(p.own < 0){ p.lin = lin; p.own = -p.own; } }
  }
  return p;
}

// Relaxation back toward the planet's baseline, plus compaction. One pass over the
// field every SWEEP_EVERY ticks rather than a per-cell timestamp and a pow() in the
// hot fertBonus() path.
function sweep(){
  const A = S.terra;
  let w = 0;
  for(let i = 0; i < A.length; i++){
    const p = A[i];
    p.q *= p.q > 0 ? DECAY_UP : DECAY_DOWN;
    if(p.q > -Q_EPS && p.q < Q_EPS){ patches.delete(p.k); continue; }
    p.own *= DECAY_UP;
    A[w++] = p;
  }
  A.length = w;
}

/* ---------- localised planetary events ---------- */

function fireEvent(pi){
  const pl = S.planets[pi];
  const r = rand();
  if(r < 0.36){
    // Impact: a crater of sterile ground and a bounded energy hit inside it. The
    // crater is written straight into the patch field as negative q, so it decays,
    // draws and serialises through exactly the same path improved ground does.
    const rad = Math.min(pl.w, pl.h) * IMP_R_FRAC;
    const cx = rnd(pl.x + rad, pl.x + pl.w - rad), cy = rnd(pl.y + rad, pl.y + pl.h - rad);
    grid();
    const c0 = Math.max(0, ((cx - rad) / TCELL) | 0), c1 = Math.min(gcols - 1, ((cx + rad) / TCELL) | 0);
    const r0 = Math.max(0, ((cy - rad) / TCELL) | 0), r1 = Math.min(grows - 1, ((cy + rad) / TCELL) | 0);
    for(let ry = r0; ry <= r1; ry++) for(let rx = c0; rx <= c1; rx++){
      const px = rx * TCELL + TCELL * 0.5, py = ry * TCELL + TCELL * 0.5;
      const d = Math.hypot(px - cx, py - cy);
      if(d > rad) continue;
      const p = deposit(px, py, 0, 0);
      if(p){ p.q = clamp(Math.min(p.q, IMP_Q * (1 - d / rad)), -1, Q_CAP); p.lin = 0; p.own = 0; }
    }
    events.push({ kind: 0, pl: pi, x: cx, y: cy, r: rad, mag: IMP_Q, t0: S.tick, life: IMP_LIFE });
    terraStats.impacts++;
    chron('impact', pi + 1, cx, cy);
  } else if(r < 0.68){
    events.push({ kind: 1, pl: pi, x: pl.x + pl.w * 0.5, y: pl.y + pl.h * 0.5, r: 0, mag: BLOOM_MAG, t0: S.tick, life: BLOOM_LIFE });
    terraStats.blooms++;
    chron('bloom', pi + 1, pl.x + pl.w * 0.5, pl.y + pl.h * 0.5);
  } else {
    events.push({ kind: 2, pl: pi, x: pl.x + pl.w * 0.5, y: pl.y + pl.h * 0.5, r: 0, mag: WINTER_MAG, t0: S.tick, life: WINTER_LIFE });
    terraStats.winters++;
    chron('winter', pi + 1, pl.x + pl.w * 0.5, pl.y + pl.h * 0.5);
  }
}

// Events are the one part of this module that must not be allowed to run away, so
// every gate is here in one place: the mechanic switch, the research knob, a per
// planet cooldown, and a population floor that refuses to kick a planet that is
// already down. An asteroid that empties a world is a worse bug than a boring one.
function eventTick(){
  const nP = S.planets.length;
  if(cool.length !== nP){ cool = new Array(nP).fill(0); }
  // age out finished events and rebuild the per-planet offsets
  if(!plOff || plOff.length !== nP) plOff = new Float64Array(nP);
  plOff.fill(0);
  offActive = false; hotImpacts = 0;
  let w = 0;
  for(let i = 0; i < events.length; i++){
    const e = events[i];
    const age = S.tick - e.t0;
    if(age > e.life) continue;
    events[w++] = e;
    // a planet-scale event ramps in over its first eighth and out over its last quarter
    const f = Math.min(1, age / (e.life * 0.125)) * clamp((e.life - age) / (e.life * 0.25), 0, 1);
    if(e.kind === 0){ if(age < IMP_HOT) hotImpacts++; }
    else if(e.pl >= 0 && e.pl < nP){ plOff[e.pl] += e.mag * f; offActive = true; }
  }
  events.length = w;
  if(!TERRA.events || !nP) return;

  // per-planet population, for the floor
  const pop = new Int32Array(nP);
  const cr = S.creatures;
  for(let i = 0; i < cr.length; i++){ const pi = planetAt(cr[i].x, cr[i].y); if(pi >= 0) pop[pi]++; }
  for(let i = 0; i < nP; i++){
    if(cool[i] > 0){ cool[i]--; continue; }
    if(pop[i] < EV_MIN_POP) continue;
    if(rand() >= EV_P) continue;
    fireEvent(i);
    cool[i] = EV_COOL;
  }
}

/* ---------- recontact ---------- */
// Only DETECTION. Whether two lineages actually interbreed is decided by
// phylo.compatible(), which is the same call world.js's mating loop makes, and
// nothing here touches it.
function reconTick(){
  const nP = S.planets.length;
  if(nP < 2) return;
  const cr = S.creatures;
  // one pass: per-planet species counts, and one representative body per (planet, species)
  const count = new Map(), rep = new Map();
  for(let i = 0; i < cr.length; i++){
    const c = cr[i]; if(!c.sp) continue;
    const pi = planetAt(c.x, c.y); if(pi < 0) continue;
    const k = pi * 1000000 + c.sp;
    count.set(k, (count.get(k) || 0) + 1);
    if(!rep.has(k)) rep.set(k, c);
  }
  const t = S.tick;
  for(const [k, n] of count){
    if(n < RECON_MIN) continue;
    const pi = (k / 1000000) | 0, sp = k % 1000000;
    let rec = presence.get(k);
    if(!rec){ presence.set(k, { first: t, last: t }); continue; }
    const gap = t - rec.last;
    if(gap <= RECON_EVERY * 2){ rec.last = t; continue; }   // continuously present
    // an arrival: this species has been away from this planet for `gap` ticks
    if(gap >= RECON_SEP){
      // is there a long-resident different species of the same tree standing here?
      for(const [k2, n2] of count){
        if(k2 === k || n2 < RECON_MIN) continue;
        if(((k2 / 1000000) | 0) !== pi) continue;
        const r2 = presence.get(k2);
        if(!r2 || t - r2.first < RECON_SEP || t - r2.last > RECON_EVERY * 2) continue;
        const a = rep.get(k2), b = rep.get(k);
        if(!a || !b) continue;
        // the payoff question, asked of the machinery that already answers it
        const iso = P.speciesOn === false ? false : !phylo.compatible(a.g, b.g);
        const r = { tick: t, planet: pi, a: k2 % 1000000, b: sp, sep: gap, isolated: iso };
        recontacts.push(r); if(recontacts.length > RECON_MAX) recontacts.shift();
        terraStats.recontacts++; terraStats.sepSum += gap;
        if(iso) terraStats.isolated++;
        chron('recontact', pi + 1, b.x, b.y);
        break;
      }
    }
    rec.first = t; rec.last = t;
  }
  // forget planet/species pairs that have been gone long enough to be irrelevant
  if((seenPl++ % 40) === 0 && presence.size > 400){
    for(const [k, r] of presence) if(t - r.last > RECON_SEP * 6) presence.delete(k);
  }
}

/* ---------- per-step entry point ---------- */

export function terraTick(){
  grid();
  if(S.tick % SWEEP_EVERY === 0) sweep();
  eventTick();
  if(S.tick % RECON_EVERY === 11) reconTick();
}

/* ---------- what a body does to the ground ---------- */

// Called once per body per step by world.js. Three things happen here, in order:
// the body takes any damage an impact is doing to the ground it is standing on, it
// collects the kin-limited half of the return if the ground under it was improved
// by its own lineage, and — if it carries the gene, can afford it, and this is its
// turn in the WORK_EVERY rota — it pays to improve the ground.
export function terraform(c){
  if(c.dead) return;
  terraStats.bodyTicks++;

  // 1. standing in a fresh crater. Bounded twice over: a flat rate scaled by
  // proximity to the centre, and never more than IMP_FRAC of what the body is
  // carrying, so a starving animal is thinned rather than executed.
  if(hotImpacts){
    for(let i = 0; i < events.length; i++){
      const e = events[i];
      if(e.kind !== 0 || S.tick - e.t0 >= IMP_HOT) continue;
      const dx = c.x - e.x, dy = c.y - e.y, d2 = dx * dx + dy * dy;
      if(d2 > e.r * e.r) continue;
      const near = 1 - Math.sqrt(d2) / e.r;
      c.energy -= Math.min(IMP_DMG * near, c.energy * IMP_FRAC);
      break;
    }
  }

  const g = c.g.terra || 0;
  grid();
  const p = patches.get(keyAt(c.x, c.y));

  // 2. the assorting channel. The return is withheld from the commons and paid to
  // bodies of the lineage that built the patch — NOT to bodies that carry the gene.
  // That distinction is the whole honesty of the experiment: paying carriers would
  // be a green-beard, paying relatives is kin selection, and only the second is a
  // real answer to the free-rider problem. Note what it means: a free-rider inside
  // the improving lineage still collects in full, which is exactly the situation
  // Hamilton's rule is about.
  if(p && p.q > 0 && TERRA.payoff && TERRA.assort && p.lin && p.lin === cladeKey(c)){
    const gain = KIN_YIELD * p.q * TERRA.assort;
    c.energy += gain;
    terraStats.kinPaid++; terraStats.kinEnergy += gain; terraStats.colGene += gain * (c.g.terra || 0);
    terraStats.collectTicks++;
  }

  // 3. the work itself
  if(g < MIN_G) return;
  if((S.tick + c.id) % WORK_EVERY !== 0) return;
  const cfg = TYPES[c.type];
  if(c.energy < P[cfg.reproE] * WORK_FLOOR) return;
  if(S.planets.length && planetAt(c.x, c.y) < 0) return;
  const pay = WORK_E * g;
  c.energy -= pay;
  terraStats.work++; terraStats.energySpent += pay; terraStats.payGene += pay * g;
  const q = deposit(c.x, c.y, Q_GAIN * g, cladeKey(c));
  if(q) c.terra = (c.terra || 0) + Q_GAIN * g;
}

/* ---------- what the rest of the simulation reads ---------- */

// Called from fertilityAt(), once per dropped seed, for the whole life of the game.
// One integer cell key, one Map.get, and — only while a planet-scale event is
// actually running — a rectangle test over at most six planets.
export function fertBonus(x, y){
  if(!TERRA.payoff) return 0;
  grid();
  let f = 0;
  const p = patches.get(keyAt(x, y));
  if(p) f += p.q * FERT_PER * (p.q > 0 ? (TERRA.assort ? PUB_SHARE : 1) : 1);
  if(offActive){
    const pi = planetAt(x, y);
    if(pi >= 0 && plOff) f += plOff[pi];
  }
  return f;
}

/* ---------- save / load ---------- */
// The field and the running events. Recontact history and the presence census are
// deliberately not persisted: they are a measurement of a run, not a property of a
// world, and rebuilding them from a restored save would invent separations that
// never happened. Craters ride the same rows as improved ground (negative q), so
// there is one format and one code path.
export function packTerra(){
  const out = [];
  for(const p of S.terra) out.push([Math.round(p.x), Math.round(p.y), Math.round(p.q * 1000), p.lin | 0]);
  // sentinel row: x = -1 marks the event tail rather than a patch
  for(const e of events) out.push([-1, e.kind, Math.round(e.x), Math.round(e.y), Math.round(e.r), +e.mag.toFixed(3), e.t0 | 0, e.life | 0, e.pl | 0]);
  return out;
}
export function unpackTerra(a){
  terraReset();
  grid();
  for(const r of (a || [])){
    if(!r) continue;
    if(r[0] === -1){
      events.push({ kind: r[1] | 0, x: r[2], y: r[3], r: r[4], mag: r[5], t0: r[6] | 0, life: r[7] | 0, pl: r[8] | 0 });
      continue;
    }
    const p = deposit(r[0], r[1], 0, 0);
    if(p){ p.q = clamp((r[2] || 0) / 1000, -1, Q_CAP); p.lin = r[3] | 0; p.own = 0; }
  }
}

/* ---------- drawing ---------- */
// Improved ground is TERRAIN. render.js calls this first of all the world layers,
// below bodies and structures, so a garden reads as ground the village is standing
// on and not as a decal laid over it. The visual register is village.js's: low
// alpha fills off the record, no strokes at low zoom, and never a random number —
// rendering that called rand() would desynchronise the world from its seed.
const QB = 5;                    // alpha buckets, so the whole field is a handful of fills
export function drawWorld(ctx, view){
  const A = S.terra;
  const z = view.z, vis = view.vis;

  if(A.length){
    // improved ground: warm tilled green-brown, deeper where the work has piled up
    for(let b = 1; b <= QB; b++){
      const lo = (b - 1) / QB, hi = b / QB;
      let any = false;
      ctx.beginPath();
      for(let i = 0; i < A.length; i++){
        const p = A[i];
        if(p.q < lo || p.q >= hi || p.q <= 0) continue;
        if(!vis(p.x, p.y, TCELL)) continue;
        ctx.rect(p.x - TCELL * 0.5, p.y - TCELL * 0.5, TCELL, TCELL);
        any = true;
      }
      if(any){ ctx.fillStyle = `rgba(126,158,74,${0.035 + 0.105 * (b / QB)})`; ctx.fill(); }
    }
    // craters: cold, ashen, and darkest at the floor
    for(let b = 1; b <= QB; b++){
      const lo = (b - 1) / QB, hi = b / QB;
      let any = false;
      ctx.beginPath();
      for(let i = 0; i < A.length; i++){
        const p = A[i], nq = -p.q;
        if(nq < lo || nq >= hi || nq <= 0) continue;
        if(!vis(p.x, p.y, TCELL)) continue;
        ctx.rect(p.x - TCELL * 0.5, p.y - TCELL * 0.5, TCELL, TCELL);
        any = true;
      }
      if(any){ ctx.fillStyle = `rgba(52,44,40,${0.05 + 0.22 * (b / QB)})`; ctx.fill(); }
    }
    // at close zoom, a furrow across each worked cell — enough to read as ground
    // that has been worked rather than ground that is merely a different colour
    if(z >= 0.6){
      ctx.strokeStyle = 'rgba(150,182,96,0.20)'; ctx.lineWidth = 1 / z;
      ctx.beginPath();
      for(let i = 0; i < A.length; i++){
        const p = A[i];
        if(p.q < 0.25) continue;
        if(!vis(p.x, p.y, TCELL)) continue;
        // deterministic per-cell furrow direction, from the cell key
        const d = (p.k & 3) * 0.7854, dx = Math.cos(d) * TCELL * 0.36, dy = Math.sin(d) * TCELL * 0.36;
        ctx.moveTo(p.x - dx, p.y - dy); ctx.lineTo(p.x + dx, p.y + dy);
      }
      ctx.stroke();
    }
  }

  // planet-scale events: a wash over the whole world that is having the weather,
  // and a rim on a fresh crater while it is still hot
  for(let i = 0; i < events.length; i++){
    const e = events[i], age = S.tick - e.t0;
    const f = Math.min(1, age / (e.life * 0.125)) * clamp((e.life - age) / (e.life * 0.25), 0, 1);
    if(e.kind === 0){
      if(age >= IMP_HOT * 6 || !vis(e.x, e.y, e.r)) continue;
      const a = clamp(1 - age / (IMP_HOT * 6), 0, 1);
      ctx.strokeStyle = `rgba(232,150,86,${0.5 * a})`; ctx.lineWidth = (1.5 + 3 * a) / z;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2); ctx.stroke();
      continue;
    }
    const pl = S.planets[e.pl]; if(!pl || f <= 0.01) continue;
    if(!vis(pl.x + pl.w * 0.5, pl.y + pl.h * 0.5, Math.max(pl.w, pl.h))) continue;
    ctx.fillStyle = e.kind === 1 ? `rgba(140,214,120,${0.055 * f})` : `rgba(126,164,214,${0.075 * f})`;
    ctx.fillRect(pl.x, pl.y, pl.w, pl.h);
  }
}
