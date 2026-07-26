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
// ---------------------------------------------------------------------------
// WHAT THIS ACTUALLY DOES, MEASURED — read this before tuning anything below.
//
// 4 seeds x 10000 ticks per arm, sampled every 200 ticks after a 3500-tick warm-up.
// The figure is the population-mean gene value, mean +- sd ACROSS SEEDS. Founding
// means are civic 0.125 and caste 0.15 (genome.js seeds them rnd(0,0.25)/rnd(0,0.3)).
//
//   arm                                          civic          caste
//   off    villageOn=false — no cost, no          0.194+-0.009   0.242+-0.048
//          benefit, gene still mutating
//   null   villages on, every payoff zeroed       0.215+-0.082   0.220+-0.050
//          (defence, nurse, thatch), all costs
//          still charged
//   vill   villageOn only                         0.266+-0.066   0.261+-0.054
//   full   villageOn + labourOn                   0.225+-0.049   0.224+-0.039
//
// Read honestly: THIS IS DRIFT, not selection. Every arm lies inside one
// between-seed sd of every other, and the tell is the `null` arm — it pays every
// cost and collects nothing at all, and still lands at or above the free `off`
// arm. A gene under selection does not do that. All four arms climb from the
// founding mean toward 0.5, which is exactly what an unselected gene clamped to
// [0,1] does under a gaussian random walk. civic does not collapse to zero
// either: the costs are far too small for purifying selection to resolve them
// against this much seed noise.
//
// Doubling the payoff does not rescue it, and the reason is the theory rather
// than the tuning. A separate 4-seed x 6000-tick arm with the defence roughly
// doubled (defStr 0.85, defWatch 0.55, cap 0.90 — a measured 0.346 mean reduction
// in being caught, against 0.174 as shipped) gives civic 0.188+-0.037 against its
// own matched drift control's 0.170+-0.011. Strengthening a public good raises the
// free-rider's payoff by precisely as much as the contributor's, so it selects for
// living in a village, never for paying for one. That is the correct answer for a
// pure commons — and it is the whole reason the upkeep below has a kin-limited
// half. Anyone who wants civic to actually be selected has to widen that channel
// (or add village-level competition), not turn the defence up.
//
// What IS real, and needs no statistics to see:
//   - settlements persist and outlive their founders — ~6.6 standing villages over
//     ~29 shelters, keeping their id and their stock across the complete turnover
//     of every body that ever lived in them
//   - ~16% of the population is inside one at any moment (54 of 338 bodies)
//   - villages come out kin-clustered without being built that way: the modal
//     lineage is 0.74+-0.06 of a village's residents, purely because relatives
//     build near relatives. Clustering shelters BY lineage was rejected precisely
//     because it would have manufactured this number instead of measuring it.
//   - all three castes coexist and none collapses: 69% forager / 17% guard /
//     14% nurse of residents, out of aptitude alone, with no quota anywhere
//   - the ecosystem survives the defence multiplier, which was the real balance
//     risk: with villages on the herbivore band rises (259 -> 276) and the
//     carnivores rise with it (11.9 -> 13.4). Nothing escapes predation; the
//     0.174 mean reduction over 16% of bodies is ~3% of total predation pressure,
//     well inside the Lotka-Volterra damping.
//
// Cost: villageTick() is 0.003 ms/step amortised (measured with S.tick advancing,
// so the 1/5 census and 1/30 re-cluster cadences actually fire — timing it with a
// frozen tick measures two modulo operations and reports a meaningless zero)
// against a 2.7-3.5 ms baseline step, i.e. ~0.1%. drawWorld() is below measurement
// resolution: draw() is 7.18 ms/frame at 1200x800 with villages off and 7.17 with
// 8 villages on. With P.villageOn = false the world is bit-identical to the
// pre-village build — verified by fingerprint on 4 seeds x 3000 ticks.
// ---------------------------------------------------------------------------

// No randomness is imported on purpose. Every decision below (which shelters form
// a settlement, who lives in one, who takes which job, who pays) is a function of
// world state that is already deterministic, so the mechanic cannot desynchronise a
// seeded world — and a coin flip would have made the caste proportions noise rather
// than a reading of what the settlement needs.
import { P, S, TYPES } from './state.js';
import { clamp } from './utils.js';

const NEUTRAL_ROLE = { speedMul: 1, senseMul: 1, metaMul: 1 };

/* ------------------------------------------------------------------ *
 * Tuning. Every constant here was set against a measurement, and the
 * comment says which. VILL is exported (and mutable) purely so an
 * experiment can knock the payoff out from under the mechanic while
 * leaving its costs and its mutation intact — that is the drift control
 * that tells selection from noise. Nothing in the shipped game writes it.
 * ------------------------------------------------------------------ */
export const VILL = {
  defStr: 0.40,     // how much of the defence a full fortification stock is worth
  defWatch: 0.26,   // how much standing guards are worth on top of it
  defCap: 0.46,     // hard ceiling on the total (see the predator-crash note below)
  nurse: 1,         // scales the nurse transfer; 0 disables it for a control run
  thatch: 1         // scales the kin-limited half of upkeep (see the note at UP_E)
};

// A settlement is a place, not a family: two shelters within LINK of each other
// are one village whoever built them. (Clustering by lineage instead was tried —
// it makes every village kin-pure by construction, which hands civic a kin-selection
// subsidy that the mechanic did not earn. Measured below.)
const LINK = 150, LINK2 = LINK * LINK;
const MIN_SH = 2;                 // fewer than this is a lone refuge, not a settlement
// Village radius = the spread of its huts plus the ground between and around them.
// R_MIN started at 74 (a little wider than one shelter) and that put only ~9% of the
// population inside a settlement at any time, which is too thin a slice for anything
// to be selected through: the whole mechanic was invisible against drift. 110 puts
// ~16% inside. Going wider than this stops being a settlement and starts being a
// region, and it also begins to matter for the predator balance (see DEF note).
const R_PAD = 70, R_MIN = 110, R_MAX = 300;

// Two cadences, because the two jobs cost very different amounts. Re-clustering
// walks the shelter list pairwise (<=30 shelters, so <=900 checks) and only
// matters when a shelter is raised or weathers away, which happens on the order
// of once every few hundred ticks. The census walks every body once per village
// and is the expensive half, so it runs at 1/5 of the step rate; every rate below
// is therefore quoted per census, not per tick.
const CLUSTER_EVERY = 30;
const RESCAN = 5;
const GRACE = 6;                  // censuses a village survives with no shelters left

// Fortification stock. Decay is per census: 0.991^(1/5 tick) is a half-life of
// ~390 ticks, deliberately longer than the ~1000-tick half-life world.js gives a
// single shelter but far shorter than a body's life, so a village that everyone
// stops paying for visibly rots inside one generation instead of coasting forever.
const STR_DECAY = 0.991, WATCH_DECAY = 0.90;   // watch fades in ~33 ticks: guards must keep turning up
// Half-saturation points of the two defence channels. Both were set from measured
// equilibria, not from taste: a village's stock settles around 10-15 (inflow from
// upkeep against STR_DECAY) and its watch around 0.5-1.5, so STR_K = 46 / WATCH_K = 3.2
// — the first guesses — put both channels down in the flat foot of the Michaelis
// curve where a doubling of everyone's contribution bought ~0.02 of extra defence.
// A payoff that small cannot be selected on. These values put the observed range on
// the responsive part of the curve instead, which is the only place the public good
// is worth arguing about.
const STR_K = 28, WATCH_K = 2.0;
const STR_CAP = 260, WATCH_CAP = 26;

// What a civic body pays per census, and what the settlement gets for it.
// UP_E is per census at civic = 1, i.e. 0.05 energy/tick — the same order as the
// 0.010*civic/tick metabolic charge genome.js already levies for carrying the gene,
// so the gene's total cost is roughly a sixth of a herbivore's upkeep at civic = 1.
const UP_E = 0.25, UP_MIN = 0.42, STR_PER_E = 1.0;
// Re-thatching rate, matched to world.js's own builder: it charges 8 energy for
// +2 shelter strength, so 0.25 str per energy is the same exchange rate a builder
// gets. Civic maintains what `build` raised; it does not undercut it.
const SH_PER_E = 0.25;
// A guard's shift, and a nurse's ration. Both are charged to the individual and
// collected by the settlement / the young, which is what makes them altruism
// rather than self-interest.
const GUARD_E = 0.12, GUARD_W = 0.55;
const NURSE_E = 3.2, NURSE_EFF = 0.75;         // same 25% transfer loss world.js uses for kin food-sharing

let nextId = 1;
let byId = new Map();

/* ---------- lifecycle ---------- */

export function villageReset(){ S.villages = []; nextId = 1; byId = new Map(); }

// Grow / retire settlements from the standing shelters. An existing village keeps
// its identity (and its stock, and its founding tick) as long as MIN_SH shelters
// still stand inside it, so a settlement outlives every body that ever paid into
// it — that persistence is the whole reason it is a village and not a hut.
function recluster(){
  const sh = S.shelters, n = sh.length, V = S.villages;
  // 1. existing villages re-claim the shelters that still stand inside them
  const taken = new Uint8Array(n);
  for(let vi = V.length - 1; vi >= 0; vi--){
    const v = V[vi];
    let cnt = 0, sx = 0, sy = 0, far = 0;
    for(let i = 0; i < n; i++){
      if(taken[i]) continue;
      const dx = sh[i].x - v.x, dy = sh[i].y - v.y, d2 = dx * dx + dy * dy;
      if(d2 < v.r * v.r){ taken[i] = 1; cnt++; sx += sh[i].x; sy += sh[i].y; if(d2 > far) far = d2; }
    }
    if(cnt >= MIN_SH){
      v.n = cnt; v.miss = 0;
      v.x += (sx / cnt - v.x) * 0.35; v.y += (sy / cnt - v.y) * 0.35;   // the site drifts with its huts, slowly
      v.r = clamp(Math.sqrt(far) + R_PAD, R_MIN, R_MAX);
    } else if(++v.miss > GRACE){
      // abandoned: the huts are gone and the stock has nobody to hold it up
      byId.delete(v.id); V.splice(vi, 1);
    }
  }
  // 2. anything left over that still forms a cluster founds a new settlement
  const lab = new Int32Array(n).fill(-1), stack = [];
  let k = 0;
  for(let i = 0; i < n; i++){
    if(taken[i] || lab[i] >= 0) continue;
    lab[i] = k; stack.length = 0; stack.push(i);
    while(stack.length){
      const a = stack.pop();
      for(let j = 0; j < n; j++){
        if(taken[j] || lab[j] >= 0) continue;
        const dx = sh[a].x - sh[j].x, dy = sh[a].y - sh[j].y;
        if(dx * dx + dy * dy <= LINK2){ lab[j] = k; stack.push(j); }
      }
    }
    k++;
  }
  for(let g = 0; g < k; g++){
    let cnt = 0, sx = 0, sy = 0;
    for(let i = 0; i < n; i++) if(lab[i] === g){ cnt++; sx += sh[i].x; sy += sh[i].y; }
    if(cnt < MIN_SH) continue;
    const cx = sx / cnt, cy = sy / cnt;
    let far = 0, lin = 0, bestLin = 0;
    const tally = new Map();
    for(let i = 0; i < n; i++) if(lab[i] === g){
      const d2 = (sh[i].x - cx) ** 2 + (sh[i].y - cy) ** 2; if(d2 > far) far = d2;
      const t = (tally.get(sh[i].lineage) || 0) + 1; tally.set(sh[i].lineage, t);
      if(t > bestLin){ bestLin = t; lin = sh[i].lineage; }
    }
    const v = { id: nextId++, x: cx, y: cy, r: clamp(Math.sqrt(far) + R_PAD, R_MIN, R_MAX),
                lin, n: cnt, str: 0, watch: 0, def: 1, pop: 0, kin: 0, juv: 0, pred: 0,
                up: 0, roles: [0, 0, 0], need: [1, 0.5, 0.3], born: S.tick, miss: 0, res: null };
    S.villages.push(v); byId.set(v.id, v);
    if(S.villages.length > 24) { const dead = S.villages.shift(); byId.delete(dead.id); }
  }
}

function defOf(v){
  const s = v.str / (v.str + STR_K), w = v.watch / (v.watch + WATCH_K);
  return 1 - clamp(VILL.defStr * s + (P.labourOn ? VILL.defWatch * w : 0), 0, VILL.defCap);
}

// The census: who lives here, what the place needs, who does what about it, and
// who pays. One pass over the population per RESCAN ticks.
function census(){
  const V = S.villages;
  for(let i = 0; i < V.length; i++){
    const v = V[i];
    v.str = Math.min(v.str * STR_DECAY, STR_CAP); v.watch = Math.min(v.watch * WATCH_DECAY, WATCH_CAP);
    v.pop = 0; v.kin = 0; v.juv = 0; v.pred = 0; v.up = 0; v.roles[0] = v.roles[1] = v.roles[2] = 0;
    v.res = [];
  }
  const creatures = S.creatures;
  if(V.length) for(let ci = 0; ci < creatures.length; ci++){
    const c = creatures[ci];
    // A settlement belongs to the species that builds it. Predators do not live in
    // one (they would collect a defence bonus nothing hunts them for, and a guard
    // that eats the villagers is not a guard) — they only press on it from outside.
    if(TYPES[c.type].terr){
      for(let i = 0; i < V.length; i++){ const v = V[i], rr = v.r * 1.7;
        if((v.x - c.x) ** 2 + (v.y - c.y) ** 2 < rr * rr) v.pred++; }
      c.vill = 0; c.role = 0; continue;
    }
    let best = null, bd = Infinity;
    for(let i = 0; i < V.length; i++){
      const v = V[i], dx = v.x - c.x, dy = v.y - c.y, d2 = dx * dx + dy * dy;
      if(d2 < v.r * v.r && d2 < bd){ bd = d2; best = v; }
    }
    if(!best){ c.vill = 0; c.role = 0; continue; }
    c.vill = best.id; best.res.push(c); best.pop++;
    if(c.lineage === best.lin) best.kin++;
  }
  else for(let ci = 0; ci < creatures.length; ci++){ const c = creatures[ci]; if(c.vill){ c.vill = 0; c.role = 0; } }

  const juv = [], nurses = [], huts = [];
  for(let i = 0; i < V.length; i++){
    const v = V[i], res = v.res, n = res.length;
    v.def = defOf(v);
    if(!n) continue;
    juv.length = 0; nurses.length = 0; huts.length = 0;
    for(let s = 0; s < S.shelters.length; s++){
      const sh = S.shelters[s];
      if((sh.x - v.x) ** 2 + (sh.y - v.y) ** 2 < v.r * v.r) huts.push(sh);
    }
    let hungry = 0;
    for(let j = 0; j < n; j++){
      const c = res[j], cfg = TYPES[c.type], re = P[cfg.reproE];
      if(c.energy < re * 0.4) hungry++;
      if(c.age < P[cfg.maxAge] * 0.16){ v.juv++; if(c.energy < re * 0.5) juv.push(c); }
    }
    // Task demand, in the response-threshold sense: the settlement's state is the
    // stimulus, and every resident reads the same stimulus through its own genes.
    // Nothing assigns quotas — the proportions of the three castes are whatever
    // falls out of the residents' aptitudes, which is where the emergence lives.
    // First cut made feeding the least urgent job (0.42 baseline against a guard
    // baseline of 0.18 + 0.52 * an always-large stock deficit) and the settlements
    // came out 96% guards, which is a caste system in name only. Foraging is what a
    // body does when nothing is wrong, so it holds the high baseline and the other
    // two are demands that have to be raised by something actually happening.
    // The three are normalised against each other, so what steers the split is the
    // RELATIVE urgency of the three jobs and not the absolute size of the constants.
    // Absolute scores were tried first and are a trap: whichever term happened to
    // carry the larger baseline simply won everywhere (96% guards on the first cut,
    // then 76% foragers and zero nurses on the second), and the caste proportions
    // stopped responding to anything happening in the settlement.
    // Brood-care demand counts every juvenile present, not only the starving ones.
    // Keying it on `juv.length` (juveniles actually short of energy) was tried and
    // produced exactly zero nurses over 5000 ticks in every seed: hungry young are
    // rare enough that n2 sat at its 0.12 floor, and a demand of 0.10 after
    // normalisation can never beat foraging's 0.6 whatever a body's aptitude is.
    // With the whole cohort counted the demand tracks how young the settlement is,
    // which is what a colony's brood-care load actually depends on.
    const nd = v.need;
    let n0 = 0.55 + 0.45 * (hungry / n);
    let n1 = 0.16 + 0.34 * clamp(1 - v.str / STR_K, 0, 1) + 0.50 * clamp(v.pred / 3, 0, 1);
    let n2 = 0.10 + 1.30 * (v.juv / n);
    const nt = n0 + n1 + n2;
    nd[0] = n0 / nt; nd[1] = n1 / nt; nd[2] = n2 / nt;

    for(let j = 0; j < n; j++){
      const c = res[j], g = c.g, cfg = TYPES[c.type];
      if(P.labourOn){
        // Aptitude: which job this body is already built for. Reusing the genes
        // the rest of the simulation is selecting on means a caste is not a free
        // label — a fast, far-seeing body really is the better forager, and taking
        // the guard's job costs it what it was good at. The three are normalised
        // per body, so what decides is COMPARATIVE advantage: a slow, small, unsocial
        // body is nobody's idea of a specialist but it still has a job it is least
        // bad at, which is exactly the argument for a division of labour existing.
        // The 0.22 floor (0.30 first) sets how much of a body's aptitude is fixed
        // and how much its genes can move: with a high floor every body scores
        // ~equally on all three and the assignment collapses to "whatever the
        // settlement needs most", i.e. no division of labour, just a rota.
        const af = 0.22 + g.speed / 3.4 * 0.50 + g.sense / 165 * 0.38;
        const ag = 0.22 + g.size / 9 * 0.55 + g.territoriality * 0.38;
        const an = 0.22 + (g.altruism || 0) * 0.66 + g.sociality * 0.38;
        const at = af + ag + an;
        const sf = nd[0] * af / at, sg = nd[1] * ag / at, sn = nd[2] * an / at;
        c.role = sg > sf ? (sn > sg ? 2 : 1) : (sn > sf ? 2 : 0);
      } else c.role = 0;
      v.roles[c.role]++;
      // Upkeep. Anyone may pay; nobody has to; everyone standing here collects the
      // defence either way. That asymmetry IS the mechanic — a free-rider is a
      // resident with civic ~ 0, and it is strictly better off than its neighbour
      // unless kinship or something else pays the difference back.
      //
      // Half of what a civic body spends goes into the common fortification, which
      // anybody standing here collects. The other half goes into re-thatching its
      // OWN lineage's huts inside the settlement — and world.js only lets a body of
      // that lineage shelter in them. That half is therefore a kin-limited return,
      // which is what gives Hamilton's rule anything to work with here. It is not a
      // subsidy: a body with no hut of its own in this village pays the whole lot
      // into the commons and gets nothing back that its neighbours don't also get.
      const civ = g.civic || 0;
      if(civ > 0.02 && c.energy > P[cfg.reproE] * UP_MIN){
        const pay = civ * UP_E;
        c.energy -= pay; v.up += pay;
        let mine = null;
        for(let s = 0; s < huts.length; s++) if(huts[s].lineage === c.lineage){ mine = huts[s]; break; }
        if(mine && VILL.thatch > 0){
          v.str += pay * 0.5 * STR_PER_E;
          mine.str = Math.min(mine.str + pay * 0.5 * SH_PER_E * VILL.thatch, 14);   // same ceiling world.js builds to
          mine.r = 30 + mine.str * 3;
        } else v.str += pay * STR_PER_E;
      }
      if(P.labourOn){
        const k = clamp(g.caste || 0, 0, 1);
        if(k > 0.05){
          if(c.role === 1 && c.energy > P[cfg.reproE] * 0.25){
            // a guard stands watch instead of feeding: it pays energy, and what it
            // buys is collected by everyone inside the fence, kin or not
            c.energy -= GUARD_E * k; v.watch += GUARD_W * k;
          } else if(c.role === 2) nurses.push(c);
        }
      }
    }
    // Nurses feed the young — but only their own lineage's young. That is the
    // deliberate hook into the kin selection already in the simulation: brood care
    // is the one village job whose payoff is inclusive fitness rather than a share
    // of a commons, so it is the job that has a route to being selected for at all.
    if(nurses.length && juv.length && VILL.nurse > 0){
      let cur = 0;
      for(let ni = 0; ni < nurses.length; ni++){
        const nu = nurses[ni], k = clamp(nu.g.caste || 0, 0, 1), give = NURSE_E * k * VILL.nurse;
        if(nu.energy < give * 4) continue;
        let found = -1;
        for(let s = 0; s < juv.length; s++){
          const idx = (cur + s) % juv.length, ju = juv[idx];
          if(ju === nu || ju.lineage !== nu.lineage) continue;
          found = idx; break;
        }
        if(found < 0) continue;
        const ju = juv[found];
        juv.splice(found, 1);                     // one ration per juvenile per census
        cur = juv.length ? found % juv.length : 0;
        nu.energy -= give; ju.energy += give * NURSE_EFF;
      }
    }
    v.res = null;   // don't hold creature references between censuses
  }
  // recompute defence after this census's payments, so a village that was just
  // topped up defends at its new strength rather than one census late
  for(let i = 0; i < V.length; i++) V[i].def = defOf(V[i]);
}

export function villageTick(){
  const t = S.tick;
  if(t % CLUSTER_EVERY === 0) recluster();
  if(t % RESCAN === 0) census();
}

/* ---------- what the rest of the simulation reads ---------- */

export function defence(c){
  const id = c.vill; if(!id) return 1;
  const v = byId.get(id); if(!v) return 1;
  // residency is only refreshed every RESCAN ticks, so confirm the body is really
  // still standing in the village before handing it the settlement's protection
  const dx = v.x - c.x, dy = v.y - c.y;
  return (dx * dx + dy * dy < v.r * v.r) ? v.def : 1;
}

// Polyethism as a body plan, not a job title: `caste` is how far the individual
// commits, and every multiplier below is scaled by it, so caste ~ 0 is a generalist
// with a generalist's body whatever role it was nominally assigned.
//
// NOTE (measured, and it matters for reading the caste numbers): world.js currently
// applies only `metaMul` — it reads g.speed and g.sense before roleEffect() is
// called, so speedMul/senseMul are computed and thrown away. They are returned
// honestly anyway so the day world.js wires them up nothing here has to change.
// The consequence is that today a specialist's whole *physiological* trade-off runs
// through its burn rate: the forager's lean body is cheap, the guard's is not.
const _re = { speedMul: 1, senseMul: 1, metaMul: 1 };
export function roleEffect(c){
  if(!P.villageOn || !P.labourOn || !c.vill) return NEUTRAL_ROLE;
  const k = clamp(c.g.caste || 0, 0, 1);
  if(k <= 0.05) return NEUTRAL_ROLE;
  const r = c.role;
  if(r === 1){        // guard: heavy, watchful, expensive to run
    _re.speedMul = 1 - 0.16 * k; _re.senseMul = 1 + 0.22 * k; _re.metaMul = 1 + 0.10 * k;
  } else if(r === 2){ // nurse: stays at the huts, sees little, feeds the young
    _re.speedMul = 1 - 0.24 * k; _re.senseMul = 1 - 0.08 * k; _re.metaMul = 1 + 0.03 * k;
  } else {            // forager: lean, quick and far-sighted, and defends nothing
    _re.speedMul = 1 + 0.26 * k; _re.senseMul = 1 + 0.30 * k; _re.metaMul = 1 - 0.09 * k;
  }
  return _re;
}

export function villageAt(x, y){
  const V = S.villages;
  for(let i = 0; i < V.length; i++){ const v = V[i]; if((v.x - x) ** 2 + (v.y - y) ** 2 < v.r * v.r) return v; }
  return null;
}

/* ---------- save / load ---------- */

export function packVillages(){
  return S.villages.map(v => [v.id, Math.round(v.x), Math.round(v.y), Math.round(v.r), v.lin || 0,
                              +v.str.toFixed(1), +v.watch.toFixed(1), v.born | 0, v.n | 0]);
}
export function unpackVillages(a){
  S.villages = []; byId = new Map(); nextId = 1;
  for(const r of (a || [])){
    const v = { id: r[0], x: r[1], y: r[2], r: r[3], lin: r[4] || 0, n: r[8] || MIN_SH,
                str: r[5] || 0, watch: r[6] || 0, def: 1, pop: 0, kin: 0, juv: 0, pred: 0,
                up: 0, roles: [0, 0, 0], need: [1, 0.5, 0.3], born: r[7] || 0, miss: 0, res: null };
    v.def = defOf(v);
    S.villages.push(v); byId.set(v.id, v);
    if(v.id >= nextId) nextId = v.id + 1;
  }
}

/* ---------- drawing ---------- */
// A settlement reads as ground plus a fence: the ground is how many live here, the
// fence is how well defended it is. Both come off the record, never off a random
// number — rendering that called rand() would desynchronise the world from its seed.
export function drawWorld(ctx, view){
  const V = S.villages; if(!V.length) return;
  const z = view.z, vis = view.vis;
  for(let i = 0; i < V.length; i++){
    const v = V[i];
    if(!vis(v.x, v.y, v.r + 6)) continue;
    const d = clamp(1 - v.def, 0, 1);                       // 0 = undefended, ~0.46 = fully fortified
    const warm = clamp(v.pop / 14, 0.12, 1);
    ctx.fillStyle = `rgba(196,164,96,${0.045 + 0.075 * warm})`;
    ctx.beginPath(); ctx.arc(v.x, v.y, v.r, 0, Math.PI * 2); ctx.fill();
    // the palisade: solid where the stock is high, dashed and faint where it is rotting
    ctx.strokeStyle = `rgba(222,190,110,${0.20 + 0.62 * d})`;
    ctx.lineWidth = (0.9 + 2.4 * d) / z;
    if(d < 0.16) ctx.setLineDash([7 / z, 6 / z]);
    ctx.beginPath(); ctx.arc(v.x, v.y, v.r - 2, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    if(z < 0.34) continue;                                   // zoomed out, the fence is the whole story
    // watch posts: one mark per standing guard shift, evenly spaced on the fence
    const posts = Math.min(9, Math.round(v.watch / 2.2));
    if(posts > 0){
      ctx.fillStyle = `rgba(238,206,128,${0.30 + 0.5 * d})`;
      for(let g = 0; g < posts; g++){
        const a = (g / posts) * Math.PI * 2 + v.id * 0.7;
        ctx.beginPath(); ctx.arc(v.x + Math.cos(a) * (v.r - 2), v.y + Math.sin(a) * (v.r - 2), 2.6 / z + 0.8, 0, Math.PI * 2); ctx.fill();
      }
    }
    // the hearth: a small mark at the centre whose size tracks the fortification stock
    const hr = 3 + 7 * clamp(v.str / STR_CAP, 0, 1);
    ctx.fillStyle = `rgba(210,120,60,${0.22 + 0.4 * d})`;
    ctx.beginPath(); ctx.arc(v.x, v.y, hr, 0, Math.PI * 2); ctx.fill();
  }
}
