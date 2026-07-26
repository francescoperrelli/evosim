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
// ===========================================================================
// THE HONEST QUESTION, ANSWERED: IT DRIFTED
// ===========================================================================
// 3 seeds x 8000 ticks x 3 arms (fire off / FIRE.delay=1 / FIRE.delay=0).
//
// 1. Whole-population mean brain size does not move. off 8.29 (seeds 8.51/7.93/
//    8.43), delayed 7.99 (8.05/8.01/7.91), immediate 8.21 (8.69/8.01/7.94). The
//    between-seed sd is 0.33-0.41 and the largest between-arm difference is 0.30.
//    Fire does not make this world brainier.
//
// 2. Fire-using lineages DO read as brainier — igniter lineages 8.95 vs everyone
//    else 7.17, a gap of +1.78 — and that number is an artefact. PYRO_BRAIN=8
//    forbids ignition below nh=8 and the population mean is ~8, so "lineages that
//    lit a fire" is very nearly "lineages above the median brain" by definition.
//    Comparing igniters against the non-igniters that ALSO pass the gate collapses
//    it: 9.10 vs 8.93, a residual of +0.17 whose per-seed values are +0.93, -0.99,
//    +0.57 — the sign flips. There is no brain gap here beyond the gate.
//
// 3. The control settles it. With the delay removed the residual gap is +0.41
//    (+0.88/+0.50/-0.15) — if anything LARGER than with the delay, and equally
//    sign-unstable. So the gap does not survive the control, and more precisely it
//    never depended on the delay in the first place. Delayed payoff is not
//    selecting brain size in this world.
//
// 4. The gene itself drifts. pyro ends at 0.158 with fire off, 0.154 delayed,
//    0.164 immediate — three indistinguishable numbers, all risen from the 0.075
//    that randomGenome seeds, i.e. mutational spreading and not selection. This is
//    exactly what genome.js's cost sweep predicts: a level-3 gene's frequency is
//    set by drift, and no cost or payoff moves it out of one between-seed sd.
//
// What DOES measure is the machinery underneath. Aged scars carry 19% more of the
// standing crop than their area share (1.13/1.38/1.07 vs 1.0), so the payoff
// channel is real; it vanishes without the delay (1.04), which is the one place
// the control does separate the arms. And assortment is strong: bodies standing on
// paying ground are ~3x more likely to be of the lineage that burnt it than that
// lineage's population frequency predicts (0.33 observed vs 0.11 null, delayed;
// 0.31 vs 0.08 immediate). Viscosity puts the benefit back where it was paid for.
// It is still not enough to make the gene selectable, and this comment says so
// rather than quoting the +1.78 and stopping there.
//
// ===========================================================================
// HOW SPREAD IS BOUNDED, AND WHY IT IS NOT A CAP
// ===========================================================================
// The ground is a lattice of cells. A burning cell tries, once per tick for the
// BURN ticks it stays alight, to set each of its four neighbours alight; it
// succeeds with probability
//
//     p = SPREAD_K * dryness(cell) * min(1, fuel(cell) / FUEL_FULL)
//
// and it can never re-enter ground that has already burnt, is under water, or is
// off the edge of the planet. So the total chance that one burning cell ever
// lights a given neighbour is q = 1 - (1 - p)^BURN, and the fire is a bond
// percolation cluster on a square lattice with bond probability q. The square
// lattice percolates at q = 1/2. With SPREAD_K = 0.020 and BURN = 26, the
// absolute maximum — perfectly dry ground, saturated fuel, every neighbour
// available — is q = 0.409, which is subcritical, so every cluster is finite with
// probability one. The measured mean fire is 4.0 cells and the largest front seen
// in a 4-seed sweep was 11 cells alight at once, well under the ~11-cell mean the
// susceptibility 1/(1 - q/qc) predicts for a *full* lattice: real ground is never
// dry, fuelled and unburnt everywhere at once. Nothing anywhere in this file says
// "stop at N cells". The bound is the percolation threshold of the lattice the
// fire is burning on, and the three physical quantities that keep q under it are
// the moisture, the standing fuel and the coastline.
//
// Two of those are live: grazed ground carries less fuel and burns worse, and the
// wet half of the year does not burn at all. A world whose crop is stripped is a
// world that stops burning, which is exactly the negative feedback that keeps this
// from sterilising a planet — the mechanic runs out of the thing it destroys.
//
// MEASURED (FIRE.k sweeps SPREAD_K; 4 seeds x 4000 ticks each, fire-off control
// in the same run). burnt = share of planet surface turned over by flame:
//
//   k=1.0  SPREAD_K 0.020  q_max 0.409  burnt 0.042 (sd 0.024)  18/fire  4.0   <- shipped
//   k=1.3  SPREAD_K 0.026  q_max 0.492  burnt 0.133 (sd 0.100)  cells/fire 7.6
//   k=1.7  SPREAD_K 0.034  q_max 0.593  burnt 0.195 (sd 0.013)  cells/fire 18.4
//
// Two things in that table are worth being honest about.
//
// First, the percolation argument is real but it is not what actually stops the
// fire. q_max=0.593 is supercritical for a full lattice, yet k=1.7 saturates at a
// fifth of the surface instead of running away: the fuel test (fuelN < FUEL_MIN
// is not a bond at all) dilutes the lattice below its site threshold long before
// the bond probability matters. The fuel field is the binding constraint; the
// SPREAD_K arithmetic is the second line of defence, not the first.
//
// Second, none of these killed anything. Population across the sweep was 242.3
// (off), 239.8, 234.5, 240.1 — every arm inside the between-seed spread of the
// control, and no seed in any arm lost a planet. So k=1.0 is NOT chosen because
// the alternatives sterilise the world; they do not, and saying they did would be
// a nicer story than the measurement supports. It is chosen because of what the
// spread column says: k=1.3 sits on the critical point, where the between-seed
// sd on burnt area quadruples (0.024 -> 0.100) and one seed burns seven times as
// much ground as another — the same constant giving a wildly different world. And
// k=1.7 makes fire the dominant landscape process rather than an event in it:
// every fire is ~18 cells, an eighth of the ground is permanently mid-scar, and
// a mechanic that is always happening everywhere is not one anything can be
// selected for exploiting.
//
// REJECTED BY DESIGN, before it was written: a growing-disc fire front bounded
// only by a per-tick extinction hazard. Its size distribution has an exponential
// tail and no physical stop at all, so the only way to keep it off a whole planet
// is a maximum radius — precisely the magic number this header forbids. Replaced
// with the lattice rather than capped. This one is a design rejection and was
// never measured; it is recorded as such and not dressed up with numbers.
// ===========================================================================

import { P, S, TYPES, seasonInfo, dayInfo } from './state.js';
import { rand, rnd, clamp } from './utils.js';

/* ------------------------------------------------------------------ *
 * Research knobs. Mutable and exported for the same reason village.js
 * exports VILL: the only way to tell selection from drift is to run the
 * mechanic with a payoff and again without one, or with the delay taken
 * out, while everything else — costs, mutation, ignition — stays put.
 * Nothing in the shipped game writes this object.
 *   delay     1 = the ash pays after DELAY ticks, 0 = it pays immediately.
 *             THE control for the honest question. The size of the payoff
 *             is deliberately unchanged by it (see bonusAt): only when it
 *             arrives moves, so the two arms differ in one thing only.
 *   rich      scales the aged-scar fertility. 0 is the drift control: all
 *             of fire's costs, none of its benefit.
 *   lightning scales natural ignition. 0 makes fire exist only where the
 *             gene puts it, which is the arm that isolates the gene.
 *   haz       scales the burn damage.
 *   k         scales SPREAD_K. Exists so the percolation claim in the header
 *             can be tested rather than asserted: k = 1.3 and k = 1.7 put
 *             q_max either side of the lattice threshold, and the measured
 *             numbers under REJECTED come from sweeping it.
 * ------------------------------------------------------------------ */
export const FIRE = { delay: 1, rich: 1, lightning: 1, haz: 1, k: 1 };

// The lattice the fire burns on. 56px is a little under one herbivore's sense
// radius, so a body can see the far side of a burning cell — a fire it cannot
// perceive the edge of is a fire nothing can learn to avoid. It also puts ~1.9
// plants in a cell at the observed standing crop, which is coarse enough that
// fuel is genuinely patchy and fine enough that a scar is a patch of ground
// rather than a district.
const FCELL = 56;
const BURN = 26;             // ticks a cell stays alight
const SPREAD_K = 0.020;      // see the percolation note above — this is THE constant
const FUEL_FULL = 1.6;       // plants in a cell at which spread saturates
const FUEL_MIN = 1;          // a cell with less standing crop than this will not take

// Weather. Dryness peaks in late summer and bottoms in late winter, and night dew
// damps it; both are read off the same clocks the rest of the simulation uses, so
// a fire season lines up with the season the player can see.
const DRY_FLOOR = 0.10;      // even the wettest ground is not fireproof
const NIGHT_DAMP = 0.30;     // share of dryness the night takes away

// The scar's fertility curve. DELAY is "some hundreds of ticks" as the header
// asks: 420 is a sixth of a herbivore's maximum lifespan and about a third of a
// typical one, so the body that lit the fire usually does not collect. PAY is the
// window the ash is worth something for, and it is held FIXED when FIRE.delay is
// zeroed so that the control arm changes the timing and not the size.
const SCORCH = 0.55;         // fertility taken off freshly burnt ground
const RICH = 0.50;           // ...and added at the peak of the ash bloom
const DELAY = 420;
const PAY = 2380;            // so a scar is gone 2800 ticks after it stopped burning

// THE BUDGET, and why it comes out neutral almost by construction. fertilityAt()
// decides WHERE a seed lands (best of three candidate points) and never how many
// land, so the seed rain is conserved: a scar cannot add plants to the world, it
// can only pull the existing rain towards itself. Fire's cost is therefore the
// plants it burns outright and its benefit is local concentration, and the two
// nearly cancel. Measured over 4000 ticks x 4 seeds against a fire-off control in
// the same run: standing crop 3306.7 -> 3283.7 (-0.7%) and population 242.3 ->
// 239.8 (-1.0%), both far inside the between-seed spread of ~18 on population.
// Over 8000 ticks the crop cost widens to -4.5% while population goes the other
// way (+16%, and that one IS outside the spread) — the honest reading is that
// fire is budget-neutral to within the noise and this file does not claim more.

// What lighting a fire costs the body that lights it, over and above walking into
// its own flame. genome.js is explicit that level-3 genes must not carry a flat
// metabolic line — the cost belongs on the act, not on the disposition.
const LIGHT_E = 7;           // energy spent making fire
const LIGHT_MIN = 0.34;      // ...and you must be this fraction of reproE fed to spare it
const PYRO_BRAIN = 8;        // brain gate, the same size as P.herdBrain's default
const PYRO_THRESH = 0.18;    // gene floor below which the behaviour never expresses
// Per-body per-step chance at pyro = 1 on dry ground. Set from the equilibrium it
// produces, not from taste: the burnt fraction of a planet settles at roughly
// (ignitions per tick per planet) x (cells per fire) x (cell area / planet area) x
// (scar life). At 2.6e-4 the whole four-planet world lit 1-4 fires in 6000 ticks
// and 1.6% of the ground ever carried a scar — the mechanic was invisible and
// nothing could possibly be selected through it. Raising it saturates fast, and
// the saturation is the reason for the value here: 2.4e-3 and 5.2e-3 differ by
// more than a factor of two in ignitions (26 vs 54 per 6000 ticks) and not at all
// in scarred ground (0.046 vs 0.046), because the extra fires land on ash and
// grazed ground and die at 3.3 cells instead of 5.5. Past ~3e-3 the only thing
// more ignition buys is more energy spent lighting them. 3.2e-3 holds the standing
// scar near 3-5% of the surface and the cumulative turnover near 4% per 4000
// ticks, which is the most aged ground the world will carry at any price.
const IGNITE_P = 3.2e-3;
const SPACING = 210;         // you do not light a fire next to one already burning
const SPACING2 = SPACING * SPACING;

// Natural ignition. Dry lightning exists whether or not anything has a brain, and
// it is deliberately weak: it is the background against which the gene's private
// ignitions are measured, not a substitute for them. Per planet per tick at full
// dryness. Measured contribution: 21% of ignitions in a shipped-default world.
const LIGHT_RATE = 8.0e-4;

// Cost, measured: fireTick() is 2.9us per step against an 8-12ms step (0.03%),
// because the spread loop walks the cells that are alight (~0.7 at equilibrium)
// and not the world. fertBonus() is 33ns per call — a bounds test, one typed-array
// index and one quadratic — and fertilityAt() makes three of them per dropped
// plant, so the seed rain costs single-digit microseconds a step. The whole-step
// A/B between fireOn true and false is below the noise floor of the box this was
// measured on; the direct numbers above are the ones to trust.
const HAZ = 0.62;            // energy per tick at the hottest moment of a burning cell
const PURGE = 64;            // ticks between sweeps for healed scars
const REGRID = 10;           // ticks between rebuilds of the fuel index
const MAX_SCARS = 900;       // save-size guard only; the observed equilibrium is ~180

/* ---------------- the ground index ----------------
 * One lattice, four parallel arrays, all O(1) to read. fertBonus() is a bounds
 * check, one index and one polynomial — it is called once per candidate seed
 * position (three per dropped seed) so it cannot afford to touch a list.
 * An earlier version kept scars as discs in a bucketed grid and iterated the
 * bucket; it was ~4x the cost of this for no visual gain, because a burn scar
 * has a hard edge in the world anyway.
 */
let gcols = 0, grows = 0, gw = 0, gh = 0;
let burnRem = null;   // Int16Array: ticks of flame left in this cell, 0 = cold
let scarT = null;     // Int32Array: tick this cell stopped burning, -1 = never burnt
let scarLin = null;   // Int32Array: lineage of whatever lit it (measurement only)
let fuelN = null;     // Int16Array: standing plants in this cell
let mask = null;      // Int8Array: 1 = burnable ground, 0 = void or open water
let bucket = null;    // Array<Array<plant>>: the plants themselves, for consuming them
let gridTick = -1e9;  // when the fuel index was last rebuilt
let maskTick = -1e9;  // ...and the land mask, which changes far more slowly
let burning = [];     // indices of the cells currently alight (the work list)
let pending = 0;      // plants marked burnt this tick, awaiting compaction

// Running totals, for the budget question ("does what fire destroys come back?")
// and for measuring assortment. Read-only to everything outside this file.
const CNT = { plants: 0, cells: 0, lit: 0, struck: 0 };
export function stats(){ return CNT; }

function ensureGrid(){
  const W = S.worldW || 1700, H = S.worldH || 1050;
  if(gw === W && gh === H && burnRem) return;
  gw = W; gh = H;
  gcols = Math.max(1, Math.ceil(W / FCELL));
  grows = Math.max(1, Math.ceil(H / FCELL));
  const n = gcols * grows;
  burnRem = new Int16Array(n);
  scarT = new Int32Array(n).fill(-1);
  scarLin = new Int32Array(n);
  fuelN = new Int16Array(n);
  mask = new Int8Array(n);
  bucket = new Array(n);
  gridTick = -1e9; maskTick = -1e9;
  burning.length = 0;
}

// Which cells can burn at all. The void between planets is the sea here: a fire
// simply stops at the coastline, and so does a fire that reaches a pool. Rebuilt
// rarely because planets never move and the player paints water by hand.
function rebuildMask(){
  mask.fill(0);
  const ps = S.planets;
  if(!ps.length){ mask.fill(1); }
  else for(let i = 0; i < ps.length; i++){
    const p = ps[i];
    const x0 = Math.max(0, Math.ceil(p.x / FCELL)), x1 = Math.min(gcols - 1, Math.floor((p.x + p.w) / FCELL) - 1);
    const y0 = Math.max(0, Math.ceil(p.y / FCELL)), y1 = Math.min(grows - 1, Math.floor((p.y + p.h) / FCELL) - 1);
    for(let cy = y0; cy <= y1; cy++) for(let cx = x0; cx <= x1; cx++) mask[cy * gcols + cx] = 1;
  }
  for(let i = 0; i < S.water.length; i++){
    const w = S.water[i];
    const x0 = Math.max(0, Math.floor((w.x - w.r) / FCELL)), x1 = Math.min(gcols - 1, Math.floor((w.x + w.r) / FCELL));
    const y0 = Math.max(0, Math.floor((w.y - w.r) / FCELL)), y1 = Math.min(grows - 1, Math.floor((w.y + w.r) / FCELL));
    for(let cy = y0; cy <= y1; cy++) for(let cx = x0; cx <= x1; cx++) mask[cy * gcols + cx] = 0;
  }
  maskTick = S.tick;
}

// Index the standing crop. One pass over S.food; the buckets are reused rather
// than reallocated because this runs over thousands of plants as the world fills.
function rebuildFuel(){
  fuelN.fill(0);
  for(let i = 0; i < bucket.length; i++){ const b = bucket[i]; if(b) b.length = 0; }
  const food = S.food;
  for(let i = 0; i < food.length; i++){
    const f = food[i];
    if(f.burnt) continue;
    const cx = f.x / FCELL | 0, cy = f.y / FCELL | 0;
    if(cx < 0 || cy < 0 || cx >= gcols || cy >= grows) continue;
    const k = cy * gcols + cx;
    fuelN[k]++;
    (bucket[k] || (bucket[k] = [])).push(f);
  }
  gridTick = S.tick;
}

function freshen(){
  ensureGrid();
  if(S.tick - maskTick >= 400 || maskTick < 0) rebuildMask();
  if(S.tick - gridTick >= REGRID) rebuildFuel();
}

/* ---------------- weather ---------------- */

// 0 (soaked) .. 1 (tinder). Late summer is the fire season; night dew damps it.
// Drought is the player's own lever and it lines up with the mechanic: a famine
// is also a fire risk, which is how grassland actually behaves.
function dryness(){
  let d;
  if(P.seasonsOn){
    const ph = seasonInfo(S.tick).phase;
    d = 0.5 + 0.5 * Math.cos((ph - 0.55) * Math.PI * 2);
  } else d = 0.6;
  if(P.dayNightOn) d *= 1 - NIGHT_DAMP * (1 - dayInfo(S.tick).light);
  if(S.drought > 0) d = d + (1 - d) * 0.45;
  return DRY_FLOOR + (1 - DRY_FLOOR) * clamp(d, 0, 1);
}

/* ---------------- the fertility curve ---------------- */

// age is ticks since the cell stopped burning. Negative fertility while the ash
// is still raw, positive once it has weathered in, zero once the ground has
// recovered. FIRE.delay moves WHEN, never HOW MUCH: the positive lobe is the same
// area in both arms, which is the only way the control isolates the delay.
function bonusAt(age){
  const d = DELAY * FIRE.delay;
  if(age < d) return -SCORCH * (1 - age / d);
  const u = (age - d) / PAY;
  if(u >= 1) return 0;
  return RICH * FIRE.rich * 4 * u * (1 - u);
}

export function fertBonus(x, y){
  if(!burnRem) return 0;
  const cx = x / FCELL | 0, cy = y / FCELL | 0;
  if(cx < 0 || cy < 0 || cx >= gcols || cy >= grows) return 0;
  const i = cy * gcols + cx;
  if(burnRem[i] > 0) return -SCORCH;          // it is alight: nothing is growing here
  const t = scarT[i];
  if(t < 0) return 0;
  return bonusAt(S.tick - t);
}

/* ---------------- lighting one cell ---------------- */

// Consume the standing crop in a cell and set it alight. This is the whole cost
// side of the mechanic: the plants are gone now, and the ground is worse than
// bare for the next DELAY ticks.
function light(i, lin){
  if(burnRem[i] > 0 || !mask[i]) return false;
  burnRem[i] = BURN;
  burning.push(i);
  const b = bucket[i];
  if(b){
    for(let j = 0; j < b.length; j++){ if(!b[j].burnt){ b[j].burnt = 1; pending++; CNT.plants++; } }
    b.length = 0;
  }
  CNT.cells++;
  fuelN[i] = 0;
  scarLin[i] = lin | 0;
  const cx = i % gcols, cy = (i / gcols) | 0;
  S.fires.push({ i, x: cx * FCELL + FCELL * 0.5, y: cy * FCELL + FCELL * 0.5, t: S.tick, lin: lin | 0 });
  return true;
}

// Is this a place a body could start a fire? Fuel, dry ground, nothing already
// burning nearby. The spacing test is what stops a crowd of pyromaniacs standing
// in one spot and stacking twenty ignitions into one patch — it is a statement
// about the ground (it is already alight) rather than a cap on the mechanic.
function canStart(x, y){
  const cx = x / FCELL | 0, cy = y / FCELL | 0;
  if(cx < 0 || cy < 0 || cx >= gcols || cy >= grows) return -1;
  const i = cy * gcols + cx;
  if(!mask[i] || burnRem[i] > 0) return -1;
  // No separate "this is ash" test: the fuel count IS the test. A cell that has
  // just burnt holds nothing, and it only becomes flammable again when the seed
  // rain has actually put plants back on it. Blocking re-ignition on the scar's
  // age instead was tried and is worse in both directions — it forbids burning
  // ground that has visibly regrown, and it hides the one feedback that matters
  // (fuel), which is the thing that stops fire eating a planet.
  if(fuelN[i] < FUEL_MIN) return -1;
  const F = S.fires;
  for(let k = 0; k < F.length; k++){
    const dx = F[k].x - x, dy = F[k].y - y;
    if(dx * dx + dy * dy < SPACING2) return -1;
  }
  return i;
}

/* ---------------- what a body does ---------------- */

// Called for EVERY body every step, so the gene reads and the brain gate come
// first and the expensive tests come last. The gate is husbandry's: the gene
// simply does not express in a small-brained lineage, and it costs nothing there
// either (genome.js charges no standing line for it).
export function ignite(c){
  const g = c.g;
  const py = g.pyro || 0;
  if(py < PYRO_THRESH) return;
  if(g.brain.nh < PYRO_BRAIN) return;
  const cfg = TYPES[c.type]; if(!cfg) return;
  if(c.energy < P[cfg.reproE] * LIGHT_MIN) return;
  freshen();
  const dry = dryness();
  if(rand() >= py * IGNITE_P * dry) return;
  const i = canStart(c.x, c.y);
  if(i < 0) return;
  c.energy -= LIGHT_E;
  light(i, c.lineage || c.id);
  S.burns = (S.burns || 0) + 1; CNT.lit++;
}

// Standing in flame is damage, not upkeep: world.js subtracts this straight off
// the energy line so that a torpid body is hurt exactly as much as an active one.
// Hottest in the first third of a cell's burn, guttering afterwards.
export function hazard(c){
  if(!burnRem || !S.fires.length) return 0;
  const cx = c.x / FCELL | 0, cy = c.y / FCELL | 0;
  if(cx < 0 || cy < 0 || cx >= gcols || cy >= grows) return 0;
  const r = burnRem[cy * gcols + cx];
  if(r <= 0) return 0;
  const f = r / BURN;                        // 1 just lit, 0 about to go out
  return HAZ * FIRE.haz * (0.35 + 0.65 * f);
}

/* ---------------- the step ---------------- */

export function fireTick(){
  ensureGrid();
  if(S.tick - maskTick >= 400 || maskTick < 0) rebuildMask();
  if(S.tick - gridTick >= REGRID) rebuildFuel();

  const dry = dryness();

  // 1. dry lightning. Weak on purpose (see LIGHT_RATE): it is the background the
  //    gene is measured against, so that "fires exist" and "this lineage makes
  //    fires" stay separable questions.
  if(FIRE.lightning > 0 && S.planets.length){
    const rate = LIGHT_RATE * FIRE.lightning * dry * dry * S.planets.length;
    if(rand() < rate){
      const p = S.planets[(rand() * S.planets.length) | 0];
      const i = canStart(rnd(p.x + 8, p.x + p.w - 8), rnd(p.y + 8, p.y + p.h - 8));
      if(i >= 0){ light(i, 0); S.burns = (S.burns || 0) + 1; CNT.struck++; }
    }
  }

  // 2. spread and burn out. Only cells that are actually alight are touched, so
  //    the cost of this loop is the size of the fire and not the size of the
  //    world. The work list is compacted in place.
  if(burning.length){
    const k = SPREAD_K * FIRE.k * dry;
    let w = 0;
    const n0 = burning.length;
    for(let bi = 0; bi < n0; bi++){
      const i = burning[bi];
      const rem = burnRem[i];
      if(rem <= 0) continue;
      const cx = i % gcols, cy = (i / gcols) | 0;
      // four neighbours. A cell already alight, already burnt, wet or off the
      // coast is not a bond at all — that is where the sea and the ash come in.
      for(let d = 0; d < 4; d++){
        const nx = cx + (d === 0 ? -1 : d === 1 ? 1 : 0), ny = cy + (d === 2 ? -1 : d === 3 ? 1 : 0);
        if(nx < 0 || ny < 0 || nx >= gcols || ny >= grows) continue;
        const j = ny * gcols + nx;
        if(!mask[j] || burnRem[j] > 0) continue;
        const fu = fuelN[j];    // burnt ground reads zero here, so a fire cannot re-enter it
        if(fu < FUEL_MIN) continue;
        const p = k * (fu >= FUEL_FULL ? 1 : fu / FUEL_FULL);
        if(rand() < p) light(j, scarLin[i]);
      }
      const left = rem - 1;
      burnRem[i] = left;
      if(left > 0) burning[w++] = i;
      else {
        // the flame front has passed: this is scar now, and it starts ageing
        scarT[i] = S.tick;
        S.scars.push({ i, x: cx * FCELL + FCELL * 0.5, y: cy * FCELL + FCELL * 0.5, t: S.tick, lin: scarLin[i] });
      }
    }
    // cells lit during this pass were appended past n0 and have not burnt a tick yet
    for(let bi = n0; bi < burning.length; bi++) burning[w++] = burning[bi];
    burning.length = w;
    // S.fires mirrors the work list for rendering, hazard and saving
    if(S.fires.length){
      let fw = 0;
      for(let fi = 0; fi < S.fires.length; fi++){ const f = S.fires[fi]; if(burnRem[f.i] > 0) S.fires[fw++] = f; }
      S.fires.length = fw;
    }
  }

  // 3. take the burnt plants out of the standing crop. One compaction pass, and
  //    only on a tick that actually burnt something.
  if(pending){
    const food = S.food;
    let w = 0;
    for(let i = 0; i < food.length; i++){ const f = food[i]; if(!f.burnt) food[w++] = f; }
    food.length = w;
    pending = 0;
  }

  // 4. retire healed ground. The scar list is bounded by its own healing rate
  //    (ignitions x PAY), not by a ceiling; MAX_SCARS below is a save-size guard
  //    that the observed equilibrium of ~180 never approaches.
  if(S.tick % PURGE === 0 && S.scars.length){
    const sc = S.scars, lim = DELAY * FIRE.delay + PAY;
    let w = 0;
    for(let i = 0; i < sc.length; i++){
      const s = sc[i];
      if(S.tick - s.t >= lim){ if(scarT[s.i] === s.t) scarT[s.i] = -1; }
      else sc[w++] = s;
    }
    sc.length = w;
    while(sc.length > MAX_SCARS){ const s = sc.shift(); if(scarT[s.i] === s.t) scarT[s.i] = -1; }
  }
}

export function fireReset(){
  S.fires = []; S.scars = []; S.burns = 0;
  CNT.plants = 0; CNT.cells = 0; CNT.lit = 0; CNT.struck = 0;
  burning.length = 0; pending = 0;
  gw = gh = 0; burnRem = null; scarT = null; scarLin = null; fuelN = null; mask = null; bucket = null;
  gridTick = -1e9; maskTick = -1e9;
}

/* ---------------- save / load ---------------- */
// One tagged array so the whole ground state travels in the single `fires` slot
// world.js gives this module. row[0] 0 = burning cell, 1 = scar.

export function packFires(){
  const out = [];
  for(let i = 0; i < S.fires.length; i++){
    const f = S.fires[i];
    out.push([0, f.i, burnRem ? burnRem[f.i] : 0, f.t, f.lin | 0]);
  }
  for(let i = 0; i < S.scars.length; i++){
    const s = S.scars[i];
    out.push([1, s.i, s.t, s.lin | 0]);
  }
  return out;
}

export function unpackFires(a){
  S.fires = []; S.scars = []; burning.length = 0; pending = 0;
  gw = gh = 0; burnRem = null;
  ensureGrid();
  const n = gcols * grows;
  for(const r of (a || [])){
    if(!r || r.length < 4) continue;
    const i = r[1] | 0;
    if(i < 0 || i >= n) continue;
    if(r[0] === 0){
      const rem = clamp(r[2] | 0, 1, BURN);
      burnRem[i] = rem; burning.push(i); scarLin[i] = r[4] | 0;
      S.fires.push({ i, x: (i % gcols) * FCELL + FCELL * 0.5, y: ((i / gcols) | 0) * FCELL + FCELL * 0.5, t: r[3] | 0, lin: r[4] | 0 });
    } else {
      scarT[i] = r[2] | 0; scarLin[i] = r[3] | 0;
      S.scars.push({ i, x: (i % gcols) * FCELL + FCELL * 0.5, y: ((i / gcols) | 0) * FCELL + FCELL * 0.5, t: r[2] | 0, lin: r[3] | 0 });
    }
  }
}

/* ---------------- drawing ---------------- */
// Burn scars are terrain, so they draw under everything (render.js calls this in
// the ground band, above terra and below the settlements). The register is the
// one the rest of the world layer uses: broad low-alpha fills, no hard edges, no
// saturated colour except where something is genuinely alight.
//
// Nothing here calls rand(). Flicker is a function of the cell index and the
// tick, so a rendered run and a headless one produce the same world — which the
// determinism test relies on.
export function drawWorld(ctx, view){
  const z = view.z, vis = view.vis;
  const H = FCELL * 0.78;                      // blob radius: overlapping cells merge

  // 1. the ground the fire left. Charcoal while it is raw, ash grey as it
  //    weathers, warm loam once it is paying — the colour IS the fertility curve,
  //    so a player can read where the ground is about to come good.
  const sc = S.scars;
  for(let i = 0; i < sc.length; i++){
    const s = sc[i];
    if(!vis(s.x, s.y, H)) continue;
    const age = S.tick - s.t;
    const d = DELAY * FIRE.delay;
    let r0, g0, b0, al;
    if(age < d){
      const u = age / (d || 1);                // 0 just burnt .. 1 about to turn
      r0 = 26 + 44 * u; g0 = 21 + 36 * u; b0 = 18 + 30 * u;
      al = 0.42 - 0.16 * u;
    } else {
      const u = clamp((age - d) / PAY, 0, 1);
      const k = 4 * u * (1 - u);               // the ash bloom, same shape as bonusAt
      r0 = 74 - 18 * k; g0 = 62 + 30 * k; b0 = 44 - 8 * k;
      al = (0.26 - 0.20 * u) * (0.45 + 0.55 * k);
    }
    ctx.fillStyle = `rgba(${r0 | 0},${g0 | 0},${b0 | 0},${al.toFixed(3)})`;
    ctx.beginPath(); ctx.arc(s.x, s.y, H, 0, Math.PI * 2); ctx.fill();
  }

  // 2. what is alight. A soft heat wash under a brighter core, and — close in —
  //    a couple of embers whose flicker is hashed off the cell index so the same
  //    world always looks the same.
  const F = S.fires;
  if(!F.length) return;
  for(let i = 0; i < F.length; i++){
    const f = F[i];
    if(!vis(f.x, f.y, H * 1.6)) continue;
    const rem = burnRem ? burnRem[f.i] : BURN;
    const heat = clamp(rem / BURN, 0, 1);
    ctx.fillStyle = `rgba(210,86,26,${(0.10 + 0.16 * heat).toFixed(3)})`;
    ctx.beginPath(); ctx.arc(f.x, f.y, H * 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(238,140,44,${(0.22 + 0.34 * heat).toFixed(3)})`;
    ctx.beginPath(); ctx.arc(f.x, f.y, H * (0.55 + 0.35 * heat), 0, Math.PI * 2); ctx.fill();
    if(z < 0.34) continue;
    const h = (f.i * 2654435761) >>> 0;
    for(let e = 0; e < 3; e++){
      const ph = ((h >>> (e * 5)) & 63) / 64;
      const a = (S.tick * 0.055 + ph * 6.283 + e * 2.1);
      const rr = H * (0.28 + 0.42 * ((h >>> (e * 7 + 3)) & 15) / 15);
      const fl = 0.5 + 0.5 * Math.sin(S.tick * 0.14 + ph * 12.6);
      ctx.fillStyle = `rgba(255,${(190 + 44 * fl) | 0},120,${(0.20 + 0.45 * fl * heat).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(f.x + Math.cos(a) * rr, f.y + Math.sin(a) * rr, 1.7 / z + 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
