// Property: whether a granary you did not fill is food or is somebody else's.
//
// Caches already exist and only kin may draw from them — a hard rule written into
// world.js. That rule is the thing to remove. Once a stranger *can* take, whether
// they do becomes a strategy: `raid` is the willingness to take what you did not
// store, `respect` is the willingness to leave it and, more expensively, to punish
// those who don't. Altruistic punishment is what turns a norm into a right: the
// punisher pays and the whole neighbourhood collects, so respect can only survive
// if enough bodies carry it at once.
//
// Nothing here scripts a property right. It sets up the game and lets the
// population find whichever equilibrium its numbers support — which may well be
// theft, in some worlds. What was actually measured is written down in the
// comments below, including the parts that did not work.
//
// Contract used by world.js and render.js — these signatures are fixed:
//
//   mayTake(c, cache)     -> boolean: will `c` draw from this cache? world.js has
//                            already established that `c` is NOT of the cache's
//                            lineage; kin always may and never come through here.
//   onTake(c, cache, amt) -> called after a non-kin withdrawal actually happened,
//                            so the module can record who owes what.
//   propertyTick()        -> once per world step: punishment, grudges, decay.
//                            MUST use rand()/gauss() from utils.js only.
//   propertyReset()       -> clear module state (called from seed() and restore()).
//   drawWorld(ctx, view)  -> world-layer drawing; view is
//                            { z, vis(x,y,r), x0, y0, x1, y1 }.
//
// Each creature carries `c.grudge` (punishment pressure aimed at it) and
// `c.stolen` (energy it has taken from others). S.thefts and S.punishments are
// running counters for the HUD.

import { P, S, TYPES } from './state.js';
import { rand, rnd, clamp, gauss } from './utils.js';

// Every tunable in one table so an experiment harness can override a single knob
// through P._prop without editing the file. The numbers are justified where they
// are used; the short version is that they were chosen so that a raid-heavy world
// loses roughly half its thefts to punishment without the population dropping
// more than ~10% against the mechanic-off control.
const D = {
  urgFloor: 0.35,      // even a barely-hungry raider takes sometimes: hunger scales the
                       // urge from 0.35 to 1, it does not gate it. A hard gate made theft
                       // so rare that both genes were pure drift (see the encounter note).
  guardW: 0.85, grudgeW: 0.30,   // deterrence weights: a defended cache deters much more
                                 // than a personal history of being beaten up
  restraint: 1.0,      // respect fully cancels raid at respect=1 — the two genes are
                       // deliberately a clean antagonistic pair, no hidden asymmetry
  raidK: 1.0,
  punR: 110,           // punishment witness radius. 110px ~= two body-lengths of travel;
                       // small enough that punishment is a local public good (which is
                       // the whole point: second-order free riding must be possible).
  punP: 0.5,           // per-witness intervention probability, scaled by respect
  punCost: 2,          // energy the punisher burns. Must be small next to punDam or
                       // punishment can never pay for the group; must be > 0 or it is
                       // not altruistic at all.
  punDam: 14,          // energy the thief loses per punisher. A single theft is 16 energy,
                       // so one punisher nearly cancels the gain and two make it a loss.
                       // At punDam 6 (tried) theft stayed strictly profitable and the
                       // punish arm was indistinguishable from the no-punish arm.
  punGrudge: 1.4,      // grudge added per punisher; feeds back into mayTake as deterrence
  punMax: 4,           // cap on punishers per event — without it, dense clusters produced
                       // 20-punisher pile-ons that instantly killed the thief and made
                       // raid look lethal rather than costly
  guardGain: 0.25,     // a punished theft marks the cache as defended
  guardDecay: 0.998,   // ~350-tick half-life: a granary stays "known defended" for about
  grudgeDecay: 0.9965, // ~200-tick half-life on a personal grudge. Both are short next to
                       // the 3600-tick season, so deterrence is a live phenotypic channel
                       // rather than a permanent tag.
  seekK: 0.9,          // see the encounter note below — this block is the single most
  seekMin: 6,          // consequential tuning in the file
  seekThr: 0.5,
  seekR: 2,
  rotK: 3.2e-6,        // self-limiting granary rot, per tick per unit stored. See the
                       // granary-stock note in section 3 for the derivation.
  // P.assortOn only: how hard a witness polices a granary of its own lineage
  // against one belonging to a stranger. Chosen so that the OVERALL punishment
  // rate is close to the shipped arm (roughly a third of witnesses share the
  // cache's lineage in the observed world, so 0.35*1.8 + 0.65*0.35 ~= 0.86) —
  // assortment must redirect the policing, not quietly turn its volume up, or
  // the arms are not comparable.
  punKin: 1.8, punOut: 0.35
};
const T = k => { const o = P._prop; return (o && o[k] !== undefined) ? o[k] : D[k]; };

const TAKE_R2 = 52 * 52;   // must match world.js's own reach test for a granary
const PUN_CELL = 160;      // punishment-witness grid cell, >= the largest punR tried

let events = [];           // thefts committed this step, resolved in propertyTick

// Energy this module removes from the ecology, by channel. punCost is what the
// punishers burn, punDam is what the thief loses (nobody collects it — punishment
// is destruction, not transfer, which is what makes it costly to enforce), rot is
// what spoils in the granaries. Instrument only; the sim never reads it.
export const propStats = { punCost: 0, punDam: 0, rot: 0 };

export function mayTake(c, cache){
  const g = c.g; if(!g) return false;
  // world.js calls this for EVERY cache (up to 40) before applying its own 52px
  // reach test, so the distance check has to come first or this is 40 gene reads
  // and a rand() per starving body per step.
  const dx = cache.x - c.x, dy = cache.y - c.y;
  if(dx * dx + dy * dy > TAKE_R2) return false;
  const raid = g.raid || 0; if(raid <= 0) return false;
  const cfg = TYPES[c.type]; if(!cfg) return false;
  // Hunger scales willingness. world.js only calls us for bodies already below
  // 0.32*reproE, so this is the *depth* of the starvation, not whether it exists.
  const thr = P[cfg.reproE] * 0.32;
  const urg = T('urgFloor') + (1 - T('urgFloor')) * clamp(1 - c.energy / (thr || 1), 0, 1);
  const deter = clamp((cache.guard || 0) * T('guardW') + (c.grudge || 0) * T('grudgeW'), 0, 0.96);
  const p = raid * T('raidK') * (1 - (g.respect || 0) * T('restraint')) * urg * (1 - deter);
  return p > 0 && rand() < p;
}

export function onTake(c, cache, amt){
  c.stolen = (c.stolen || 0) + amt;
  S.thefts = (S.thefts || 0) + 1;
  // Cap the event list: at pathological theft rates this was the only allocation
  // that grew without bound. 96 is far above the observed per-step maximum (~20).
  if(events.length < 96) events.push({ x: c.x, y: c.y, id: c.id, ca: cache });
}

// ---------------------------------------------------------------------------
// CARRIED-OVER ITEM (a): the non-kin cache pull belongs in world.js's steering.
//
// propertyTick() currently moves the body itself (see section 1), which is a
// teleport: it ignores the brain, the innate vector, water drag, rock collision
// and the void barrier, all of which world.js applies to every other movement.
// The correct home for it is the innate-steering block at world.js:667, next to
// the own-lineage version that is already there.
//
// This is the whole interface world.js needs. It is exported now so the change is
// a single block in world.js and nothing here has to move:
//
//   SEEK_W                       -- the innate weight to use (0.8 own-lineage today)
//   seekHungry(c, reproE)        -- boolean: is this body hungry enough to look?
//   seekTarget(c)                -- the nearest non-kin cache worth walking to on
//                                   this body's own planet, or null. Genotype-BLIND
//                                   on purpose (see the note in section 1).
//
// The world.js edit, immediately after the own-lineage `hungry hoarder` block:
//
//   if(P.propertyOn && P.hoardOn && !thrHas && S.caches.length &&
//      property.seekHungry(c, P[cfg.reproE])){
//     const t = property.seekTarget(c);
//     if(t){ const dd = Math.hypot(t.x - c.x, t.y - c.y) || 1;
//       ix += (t.x - c.x) / dd * property.SEEK_W; iy += (t.y - c.y) / dd * property.SEEK_W; }
//   }
//
// and then `P.propSteer = true` in state.js, which is what makes section 1 below
// stand down. Both halves are needed: with the flag off and no world.js block the
// mechanic keeps working exactly as measured, and with both the pull becomes a
// steering force like every other.
// ---------------------------------------------------------------------------
export const SEEK_W = 0.8;
export function seekHungry(c, reproE){ return c.energy < reproE * T('seekThr'); }
export function seekTarget(c){
  const caches = S.caches; if(!caches.length) return null;
  const g = c.g; if(!g) return null;
  const lo = T('seekMin'), sr = (g.sense || 60) * T('seekR');
  let best = null, bd = sr * sr, kin = false;
  for(let j = 0; j < caches.length; j++){
    const ca = caches[j]; if(ca.amount < lo) continue;
    const dx = ca.x - c.x, dy = ca.y - c.y, dd = dx * dx + dy * dy;
    if(dd < bd){ bd = dd; best = ca; kin = ca.lineage === c.lineage; }
  }
  if(!best || kin) return null;                 // world.js already walks them to the family granary
  if(best.pi === undefined) best.pi = planetOf(best.x, best.y);
  if(best.pi !== planetOf(c.x, c.y)) return null;   // never tow a body across the void
  return best;
}

// Planet containment copied rather than imported: property.js is imported *by*
// world.js, and a cycle for one rectangle test is not worth it.
function onPlanet(x, y){
  const ps = S.planets; if(!ps.length) return true;
  for(let i = 0; i < ps.length; i++){ const p = ps[i]; if(x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) return true; }
  return false;
}
function planetOf(x, y){
  const ps = S.planets; if(!ps.length) return 0;
  for(let i = 0; i < ps.length; i++){ const p = ps[i]; if(x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) return i; }
  return -1;
}

export function propertyTick(){
  const cs = S.creatures, caches = S.caches, punish = P.propertyPunish !== false;

  // ---- 1. encounter: walk the hungry to a stranger's granary ----
  //
  // THE FAILURE MODE THIS FIXES. With mayTake() alone the mechanic barely existed:
  // world.js steers a starving hoarder only toward its OWN-lineage cache, and
  // offspring are born within 6px of the parent, so a body practically never
  // wandered inside 52px of a stranger's granary by accident. Measured ~0.07
  // thefts/tick over a population of ~300 — so few that raid and respect moved by
  // drift alone and the property arms were statistically indistinguishable from
  // the propertyOn=false control. Adding this genotype-BLIND positional pull
  // (blind on purpose: it must not itself select for raid) raised theft rates
  // 3-5x and made the arms separable.
  //
  // Tunings that did NOT work, do not re-try them:
  //   seekK 1.5 / seekThr 0.75 / seekR 4 -> population crashed to 82 by t=3000
  //     (vs ~300 in control): bodies abandon foraging entirely and camp granaries.
  //   seekK 0.9 / seekThr 0.60 -> 1004 thefts per 3000 ticks but population 234
  //     vs 331 in the mechanic-off control. Too expensive for the signal gained.
  //   Occupancy-based ownership ("possession follows occupation": reassign
  //     ca.lineage to the dominant lineage within 140px every 45 ticks) -> no gain
  //     in theft rate (798 vs 890) and it wrecked the economy, because it also
  //     unlocks world.js's DEPOSIT path (a body then nearly always has an
  //     "own-lineage" granary within 120px). Cache energy 28432 vs 12513 and
  //     population 221 vs 256: twice as much energy locked in stores that spoil.
  //     Removed.
  // P.propSteer is set once world.js does the steering itself (see the interface
  // above); until then this block is the mechanic.
  if(P.hoardOn && caches.length && !P.propSteer){
    const k = T('seekK');
    for(let i = 0; i < cs.length; i++){
      const c = cs[i], g = c.g, cfg = TYPES[c.type]; if(!cfg) continue;
      if(!seekHungry(c, P[cfg.reproE])) continue;             // only the hungry look
      const best = seekTarget(c); if(!best) continue;
      const dx = best.x - c.x, dy = best.y - c.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1, s = Math.min((g.speed || 1) * k, d);
      const nx = c.x + dx / d * s, ny = c.y + dy / d * s;
      if(onPlanet(nx, ny)){ c.x = nx; c.y = ny; }
    }
  }

  // ---- 2. altruistic punishment ----
  //
  // Everyone within punR who carries respect may pay punCost to inflict punDam on
  // the thief. The punisher's cost is private, the deterrence is a public good for
  // the whole neighbourhood — second-order free riding is therefore possible and
  // is the reason respect does not simply sweep. Witnesses are found through a
  // coarse grid built once per step; the naive all-pairs scan was the single
  // largest cost in the profile at population 1400.
  if(events.length){
    if(punish){
      const cell = PUN_CELL, cols = Math.max(1, Math.ceil((S.worldW || 1) / cell));
      const grid = new Map();
      for(let i = 0; i < cs.length; i++){
        const c = cs[i], key = (Math.floor(c.y / cell) * cols + Math.floor(c.x / cell));
        const b = grid.get(key); if(b) b.push(c); else grid.set(key, [c]);
      }
      const R = T('punR'), R2 = R * R, cost = T('punCost'), pp = T('punP'), cap = T('punMax');
      for(let e = 0; e < events.length; e++){
        const ev = events[e];
        let n = 0, thief = null;
        const gx0 = Math.floor((ev.x - R) / cell), gx1 = Math.floor((ev.x + R) / cell);
        const gy0 = Math.floor((ev.y - R) / cell), gy1 = Math.floor((ev.y + R) / cell);
        for(let gy = gy0; gy <= gy1 && n < cap; gy++) for(let gx = gx0; gx <= gx1 && n < cap; gx++){
          const b = grid.get(gy * cols + gx); if(!b) continue;
          for(let i = 0; i < b.length && n < cap; i++){
            const o = b[i];
            if(o.id === ev.id){ thief = o; continue; }
            const dx = o.x - ev.x, dy = o.y - ev.y; if(dx * dx + dy * dy > R2) continue;
            let r = o.g.respect || 0; if(r <= 0) continue;
            if(o.energy <= cost * 3) continue;   // you cannot police on an empty stomach
            // ASSORTMENT (P.assortOn). Punishment as shipped is the textbook
            // second-order public good: the punisher pays privately and the whole
            // neighbourhood collects the deterrence, whoever's granary it was. That
            // is exactly why `respect` cannot be selected, and it is not a tuning
            // problem — see the l2Cost sweep in genome.js, which shows that making
            // the cost bigger only makes the gene drift downward faster.
            // Under assortment a body still polices for anyone, but it polices for
            // its OWN LINEAGE'S granaries much harder. The deterrence a punisher
            // buys then lands mostly on stores its relatives eat from, and relatives
            // carry `respect` at a correlated frequency, so b*r finally has an r in
            // it. Kin recognition is not invented for this: it is the same
            // `ca.lineage === c.lineage` test world.js already uses to decide who
            // may withdraw from a cache without stealing.
            if(P.assortOn && ev.ca) r *= (ev.ca.lineage === o.lineage) ? T('punKin') : T('punOut');
            if(rand() >= r * pp) continue;
            o.energy -= cost; n++; propStats.punCost += cost;
          }
        }
        if(n){
          if(!thief) for(let i = 0; i < cs.length; i++) if(cs[i].id === ev.id){ thief = cs[i]; break; }
          if(thief){ thief.energy -= T('punDam') * n; propStats.punDam += T('punDam') * n;
                     thief.grudge = (thief.grudge || 0) + T('punGrudge') * n; }
          S.punishments = (S.punishments || 0) + n;
          if(ev.ca) ev.ca.guard = Math.min(1, (ev.ca.guard || 0) + T('guardGain') * n);
        }
      }
    }
    events.length = 0;
  }

  // ---- 3. decay ----
  // Batched every 8 ticks with the decay raised to the 8th power: the per-body
  // multiply showed up in the profile as a measurable fraction of propertyTick
  // when run every step, and nothing reads grudge/guard with finer resolution
  // than the 200-350 tick half-lives they represent.
  if(S.tick % 8 === 0){
    const gd = Math.pow(T('grudgeDecay'), 8);
    for(let i = 0; i < cs.length; i++){ const g = cs[i].grudge; if(g) cs[i].grudge = g > 0.02 ? g * gd : 0; }
    const cd = Math.pow(T('guardDecay'), 8);
    for(let i = 0; i < caches.length; i++){ const ca = caches[i]; if(ca.guard) ca.guard = ca.guard > 0.01 ? ca.guard * cd : 0; }

    // ---- granary rot ----
    //
    // READ THE REFUTATION FIRST. This block was written to fix the level-2
    // population regression. It does not fix it. It is kept because the stock it
    // holds down was genuinely unbounded and because the accounting it produced is
    // what found the real cause (the ore breeding gate; see canBreed() in trade.js).
    //
    // THE HYPOTHESIS, AND ITS NUMBERS (3 seeds x 6000 ticks, sampled every 200
    // after t=2400; mean+-sd between seeds), all six level-2 flags off vs all on:
    //
    //             pop      per-body E   bodies hold   caches hold   total
    //   off     289+-55       101          29189       6308+-3092   35497
    //   on      192+-6         97          18624      17370+-5516   35994
    //
    // Mobile energy looked CONSERVED across the two arms to within 1.4%, and the
    // level-2 layer did not appear to starve anyone: standing food is HIGHER with it
    // on (3308 vs 3081), bodies below the hunger line are FEWER (32 vs 41), mean
    // per-body energy is unchanged, and local density is LOWER (4.34 vs 5.52) so the
    // (1+1.8dd^2) reproduction brake is *less* binding. The reading was that ~11000
    // units — 31% of the world's energy — were immobilised in granaries, and that
    // since per-body energy is pinned near the reproduction threshold, population is
    // near-linear in body energy (0.638 energy ratio vs 0.664 population ratio).
    // Single-removal arms agreed: only noProp brought the stock back to baseline
    // (5296+-1626); noTrade 18614, noLabour 18425, noTribe 13190, noCult 13125.
    //
    // REFUTED BY ITS OWN FIX. The rot below does exactly what it was designed to do
    // to the stock — cacheE 17370+-5516 -> 5752+-1167, i.e. back at the 6308+-3092
    // baseline — and the population did not move: 192+-6 -> 201+-62 against a
    // baseline of 289+-55. Worse, post-fix world energy is 25048 against 35994, so
    // the energy was destroyed, not released to bodies. The conservation above was
    // an accounting coincidence: an equilibrium stock and an equilibrium population
    // are both consequences of the same throughput, and neither causes the other.
    // The lesson, recorded because it cost a day: a stock-vs-stock identity is not a
    // mechanism. Only per-channel FLOW instrumentation (propStats/villStats/
    // tradeStats/tribeStats, all added for this) settled it, and what it showed is
    // that the whole level-2 layer destroys ~7.4 energy/tick — of which this rot is
    // 5.85, by far the largest single channel — while the population is limited by
    // something that costs no energy at all.
    //
    // REJECTED — raising the upkeep coefficients, or lowering them. l2Cost=0 gives
    // pop 185+-11, *worse* than l2Cost=1 at 192+-6, confirming the sweep recorded
    // above metabolism() in genome.js. The metabolism lines are not the problem.
    // REJECTED — a hard cap on ca.amount: it makes the granary a step function, so
    // hoarding stops paying abruptly at a number nothing in the genome can see.
    // REJECTED — returning rot to the ground as food. spawnFood()'s logistic term
    // is capped at P.maxFood (900/planet, 3600 total) and standing crop is already
    // 3081-3334, so returned energy would displace new growth instead of adding to
    // it — a null change dressed up as recycling.
    //
    // WHAT THIS IS, AND WHY IT STAYS. world.js already spoils every cache by 0.985 per 120 ticks, a
    // LINEAR loss: at equilibrium the stock self-adjusts until spoilage equals the
    // deposit rate, so the coefficient sets how fast the stock relaxes but not
    // where it settles — which is why raising it does not hold the heap down.
    // Damp, vermin and heat do not scale with the heap, they scale with the heap
    // SQUARED (surface contact times contents), so the honest form is
    //   d(amount)/dt = -k * amount^2
    // whose equilibrium per cache is sqrt(deposit/k) — a soft ceiling with no cliff
    // and no magic number in the genome's way. At steady state this destroys
    // exactly the same energy per tick as the linear form (inflow == outflow either
    // way); all it changes is the SIZE OF THE STANDING STOCK, which is the thing
    // holding the population down. Sizing: mean cache 434 units under the linear
    // rot implies a net inflow near 0.054/tick/cache; k = 3.2e-6 puts equilibrium
    // at sqrt(0.054/3.2e-6) ~= 130 units, ~5200 across the 40-cache cap, i.e. back
    // at the mechanic-off baseline.
    //
    // Written in the implicit form a/(1+k8*a) rather than a - k8*a^2: identical to
    // second order, cannot go negative, and stays stable if a cache is ever much
    // larger than the equilibrium (a raid-fed spike of 5000+ was observed).
    const k8 = T('rotK') * 8;
    if(k8 > 0) for(let i = 0; i < caches.length; i++){
      const ca = caches[i], a = ca.amount;
      if(a > 0){ ca.amount = a / (1 + k8 * a); propStats.rot += a - ca.amount; }
    }
  }
}

export function propertyReset(){ S.thefts = 0; S.punishments = 0; events = [];
  propStats.punCost = propStats.punDam = propStats.rot = 0; }

export function drawWorld(ctx, view){
  // A defended granary wears a ring that widens and brightens with `guard`, so a
  // watching player can see where a norm is actually being enforced. No rand()
  // here — the determinism test compares fingerprints across a rendered and an
  // unrendered run.
  const z = view.z, vis = view.vis;
  for(let i = 0; i < S.caches.length; i++){
    const ca = S.caches[i], gd = ca.guard || 0; if(gd < 0.02) continue;
    const r = 26 + gd * 26; if(!vis(ca.x, ca.y, r)) continue;
    ctx.strokeStyle = `rgba(210,170,90,${0.18 + gd * 0.42})`; ctx.lineWidth = 1.6 / z;
    ctx.beginPath(); ctx.arc(ca.x, ca.y, r, 0, Math.PI * 2); ctx.stroke();
  }
}
