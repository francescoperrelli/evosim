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
  seekR: 2
};
const T = k => { const o = P._prop; return (o && o[k] !== undefined) ? o[k] : D[k]; };

const TAKE_R2 = 52 * 52;   // must match world.js's own reach test for a granary
const PUN_CELL = 160;      // punishment-witness grid cell, >= the largest punR tried

let events = [];           // thefts committed this step, resolved in propertyTick

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
  if(P.hoardOn && caches.length){
    const k = T('seekK'), lo = T('seekMin'), thr = T('seekThr'), rk = T('seekR');
    for(let i = 0; i < cs.length; i++){
      const c = cs[i], g = c.g, cfg = TYPES[c.type]; if(!cfg) continue;
      if(c.energy >= P[cfg.reproE] * thr) continue;           // only the hungry look
      const sr = (g.sense || 60) * rk, sr2 = sr * sr;
      let best = null, bd = sr2, kin = false;
      for(let j = 0; j < caches.length; j++){
        const ca = caches[j]; if(ca.amount < lo) continue;
        const dx = ca.x - c.x, dy = ca.y - c.y, dd = dx * dx + dy * dy;
        if(dd < bd){ bd = dd; best = ca; kin = ca.lineage === c.lineage; }
      }
      if(!best || kin) continue;   // world.js already walks them to the family granary
      if(best.pi === undefined) best.pi = planetOf(best.x, best.y);
      if(best.pi !== planetOf(c.x, c.y)) continue;            // never tow a body across the void
      const d = Math.sqrt(bd) || 1, s = Math.min((g.speed || 1) * k, d);
      const nx = c.x + (best.x - c.x) / d * s, ny = c.y + (best.y - c.y) / d * s;
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
            const r = o.g.respect || 0; if(r <= 0) continue;
            if(o.energy <= cost * 3) continue;   // you cannot police on an empty stomach
            if(rand() >= r * pp) continue;
            o.energy -= cost; n++;
          }
        }
        if(n){
          if(!thief) for(let i = 0; i < cs.length; i++) if(cs[i].id === ev.id){ thief = cs[i]; break; }
          if(thief){ thief.energy -= T('punDam') * n; thief.grudge = (thief.grudge || 0) + T('punGrudge') * n; }
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
  }
}

export function propertyReset(){ S.thefts = 0; S.punishments = 0; events = []; }

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
