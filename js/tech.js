// A technology tree that is inherited culturally rather than genetically.
//
// Be precise about what this is, because it is the easiest thing in the whole
// roadmap to oversell. Nothing here is invented. The capabilities are a short,
// fixed list written by us — fire-keeping, food preservation, reach, void-craft —
// and no lineage will ever produce a capability that is not on that list. What is
// genuinely open is *which* of them a lineage holds, in what order it acquired
// them, whether it keeps them, and whether it loses them again when the bodies
// that knew them die without teaching anyone. That last one is the interesting
// half: a technology that cannot be lost is not being transmitted, it is being
// hard-coded on a delay.
//
// The mechanism is deliberately the one the existing `disperse` gene already
// prototypes: a capability is gated on brain size, unlocked by contact with a body
// that already has it, and charged upkeep for as long as it is held. Upkeep is
// what makes loss possible, and loss is what makes the accumulation mean anything.
//
// `techApt` is the aptitude gene: how readily a body acquires a capability from a
// neighbour that has it. It is deliberately NOT a "which technology" gene — the
// tree is cultural state on the body, not alleles in the genome, and the two must
// not be allowed to collapse into each other or the whole point is lost. The
// control that proves they have not: run with acquisition disabled and the upkeep
// still charged, and confirm the capability vector goes empty rather than tracking
// the genome.
//
// Contract used by world.js and render.js — these signatures are fixed:
//
//   techTick()           -> once per world step: capabilities spread between
//                           neighbours, and are lost by bodies that cannot keep
//                           them. MUST use rand()/gauss() from utils.js only.
//   techReset()          -> clear module state (called from seed() and restore()).
//   teach(parent, child) -> called at birth, after the child's body exists: the
//                           parent may pass on what it knows.
//   effect(c)            -> { metaMul, killMul, foodMul, dispMul }: what `c`'s
//                           held capabilities do to it. All 1 = knows nothing.
//   techIndex()          -> 0..1 for the HUD: mean fraction of the tree held.
//   drawWorld(ctx, view) -> world-layer drawing; view is
//                           { z, vis(x,y,r), x0, y0, x1, y1 }.
//
// Each creature carries `c.tech`, a small integer bitmask of held capabilities.
// S.techPeak records the deepest any lineage has ever reached, so the chronicle
// can say when something was lost.
//
// ---------------------------------------------------------------------------
// WHAT IS ACTUALLY OPEN HERE, AND WHAT IS NOT
//
// Not open: the list. Four capabilities, written below, forever. Not open: what
// each one does — the four multipliers are wired at four fixed sites in world.js.
//
// Open: which of the four a body holds (16 states), which of them a LINEAGE holds
// at any moment, the order they arrived in, and whether they survive. A capability
// enters the world only by independent invention, which is deliberately rare and
// deliberately NOT gated on `techApt` (see below); everything after that is
// transmission. Three channels remove a capability again — a body that cannot
// feed itself sheds one, a body whose brain has fallen below the gate sheds one
// fast, and a birth transmits each held capability only with a probability set by
// the CHILD's aptitude. Add the death of the last holder in a region and a
// capability can leave a lineage entirely, which is the whole point.
//
// The one design decision worth flagging as a choice rather than a discovery:
// this is a flat SET of four, not a tree with prerequisites. A prerequisite graph
// would have made "the order it acquired them" a property of the graph rather
// than of who a body happened to stand next to, which is exactly the thing the
// header says has to stay open. So "tree" here means the four-slot vector, and
// S.techPeak means the deepest simultaneous holding any single body has reached,
// not a depth in a dependency graph.
//
// Independent invention is NOT scaled by techApt, on purpose. If it were, then in
// the acquisition-off control the standing holdings would track the genome — the
// exact collapse the header warns about — and the control would have proved
// nothing. Invention is gated on brain size only; `techApt` governs picking a
// capability up from a body that already has it, and nothing else.
// ---------------------------------------------------------------------------

import { P, S, TYPES } from './state.js';
import { rand, rnd, clamp, gauss } from './utils.js';

// exported so world.js has something to use when the mechanic is switched off,
// without every call site having to spell the four ones out again
export const NEUTRAL_TECH = { metaMul: 1, killMul: 1, foodMul: 1, dispMul: 1 };

// ---- the fixed list ----------------------------------------------------------
// One bit each. The comment on each line names the world.js site it acts on;
// those four sites are the entire behavioural surface of this module.
const FIRE  = 1;   // fire-keeping     -> metaMul  (world.js: the per-tick burn)
const PRES  = 2;   // food preservation-> foodMul  (world.js: plant bite + kill yield)
const REACH = 4;   // reach            -> killMul  (world.js: kill probability)
const VOID  = 8;   // void-craft       -> dispMul  (world.js: cost of a launch)
const NCAP = 4, ALL = 15;

// ---- what each capability is worth, and what all of them cost ----------------
// The economy note above metabolism() in genome.js is the binding constraint: a
// 0..1 behavioural gene is selectable here only when its consequence is tens of
// percent of the body's energy budget. That measurement is about a gene whose
// payoff is a public good. These payoffs are private — the holder's own mouthful,
// its own kill, its own burn — so the gradient on `techApt` runs through the
// holder's own energy balance and should be easier to see.
//
// MEASURED, and the honest answer is: barely. A two-allele invasion assay
// (techApt 0.05 vs 0.90, seeded into a settled world, 4000 steps, 4 seeds) scored
// by realised per-capita birth-minus-death rate per 1000 body-ticks gives
//   functionless control (techOn:false)  s = +0.104 +- 0.262, HI ends at 0.600
//   upkeep charged                       s = -0.081 +- 0.084, HI ends at 0.420
//   upkeep waived (P.techNoUpkeep)       s = +0.091 +- 0.092, HI ends at 0.584
// Every seed of the upkeep arm ends below 0.5 and three of four of the no-upkeep
// arm end above it, and the paired full-vs-noUp gap is -0.17 +- 0.09 — so upkeep
// really is the thing holding the gene down. But neither arm is separable from
// the +-0.26 drift floor on its own. The correct statement is that `techApt` is
// close to neutral with the price on and close to neutral with the price off, and
// that upkeep is worth roughly 0.17 per 1000 body-ticks of that. It is not a gene
// under visible directional selection, and this comment is not going to pretend
// it is. What the aptitude *does* do, unambiguously, is set holdings: 0.56 held
// capabilities per HI body against 0.16 per LO body in the same world.
//
// Upkeep is multiplicative per held capability and rides on metaMul, which is the
// only always-charged channel world.js gives us. genome.js explicitly forbids a
// flat per-gene line in metabolism() for the level-3 genes ("holding a technique
// costs only while it is held"), and this is the other half of that contract.
const UPKEEP  = 1.05;    // per held capability, +5% on the metabolic burn
const WARM    = 0.72;    // fire-keeping: a kept fire is 28% off the metabolic burn
const PRES_F  = 1.42;    // preservation: 42% more out of the same mouthful/carcass
const REACH_K = 1.20;    // reach: 20% on the kill roll
const VOID_D  = 0.55;    // void-craft: a crossing costs 55% of what it otherwise would
//
// Note the asymmetry: one capability pays for its own upkeep several times over
// (FIRE alone is 0.72 * 1.05 = 0.756 on the burn), and three of the four are of no
// use at all to a herbivore, which is ~70% of the population. That is deliberate.
// A body that has picked up REACH and VOID and cannot use either is carrying 10%
// of extra burn for nothing, so the standing holdings are not a free ratchet — a
// lineage can be actively burdened by knowledge it has no use for.
//
// REJECTED TUNINGS (measured, 4 seeds x 6000 ticks, "apt" = population-mean techApt
// sampled every 200 ticks after tick 3000 against a techOn:false control of
// 0.159 +- 0.027; founding mean is 0.125):
//
//   UPKEEP 1.09, payoffs as above — apt 0.167 +- 0.030, techIndex 0.109 +- 0.032.
//     Indistinguishable from 1.05 (0.164 +- 0.027 / 0.106 +- 0.048) on every
//     readout, but the population spread widened from 272 +- 12 to 264 +- 63 and
//     seed 3 bottomed at 173. Rejected: it bought no measurable selection and cost
//     ecological stability. This is also the honest limit of the instrument — at
//     N ~ 250 over ~10 generations, drift swamps any upkeep in the 1.05..1.09 band.
//   UPKEEP 1.03 / WARM 0.84 / PRES_F 1.22 / no REACH — apt 0.189 +- 0.041 against
//     a 0.166 +- 0.028 control, i.e. inside one between-seed sd, and mean pop
//     217 +- 29 against a 233 +- 48 baseline. The payoffs are too small to be seen:
//     exactly the genome.js result ("a few percent is nothing here") reproducing.
//   UPKEEP 1.035 / WARM 0.80 / PRES_F 1.30 — apt 0.178 +- 0.024, techIndex
//     0.142 +- 0.033, pop 205 +- 25. Same verdict, and the lowest population of any
//     arm tried; the extra foodMul does not pay for the bodies it feeds.
//   INV_P 3e-6 with ACQ_K 0.012 — a dead mechanic: 1-2 inventions per 6000 ticks
//     and techIndex 0.011. Invention has to seed the world often enough for the
//     transmission channel to have anything to amplify.

// ---- gates and rates ---------------------------------------------------------
// Brain gate, the same shape husbandry uses (`g.brain.nh >= P.herdBrain`).
// Brains start at 6..10 hidden neurons, so 8 leaves roughly half the founding
// population unable to pick anything up and lets the gate be selected past.
const BRAIN = 8;
// Acquisition from a neighbour that holds it: per body, per step, scaled by the
// body's own aptitude. At the founding mean apt (0.125) this is ~1.5e-3/step, so
// a body in continuous contact with a holder picks it up on a timescale of a few
// hundred ticks — under one generation (~600 ticks), which is what makes horizontal
// transmission faster than the genome and therefore worth having at all.
const ACQ_K = 0.06;
// Independent invention. Rare on purpose: it exists so the world is not empty
// forever, not so it can supply the standing stock. At ~300 eligible bodies this
// is one invention per ~1100 ticks across the whole world, against an acquisition
// channel that moves a capability between bodies hundreds of times in that span.
// Deliberately flat in techApt — see the header note.
const INV_P = 1.2e-5;
// Vertical transmission at birth, per held capability, set by the CHILD's aptitude.
// At the founding mean only a third of what a parent knows reaches its child, so
// a lineage that does not also pick things up horizontally bleeds its holdings out
// within a few generations. This is the single largest loss channel and the main
// thing `techApt` is selected on.
const TEACH_B = 0.04, TEACH_A = 0.80;
// Shedding. A body below this fraction of its breeding reserve is not keeping
// anything alive but itself, and drops one capability at this rate.
const SHED_E = 0.25, SHED_P = 0.006;
// A body whose brain has fallen back below the gate cannot maintain what it holds
// and sheds fast. This is what makes the gate bite on holdings and not only on
// acquisition — without it a dumb lineage keeps forever whatever it inherited.
const DUMB_SHED = 0.06;
// Ghost marks left where a capability was lost, so the player can watch one go.
const GHOST_LIFE = 150, GHOST_MAX = 60;

// popcount for a 4-bit mask
const POP = new Uint8Array(16);
for(let m = 0; m < 16; m++) POP[m] = (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);

// ---- effect(): a table, not a loop ------------------------------------------
// world.js reads this once per body per step and reuses the answer at four sites,
// so it has to be a single array index and no allocation. Sixteen frozen objects,
// built once; EFF[0] is NEUTRAL_TECH itself so a body that knows nothing gets the
// identical object world.js uses when the mechanic is off.
let EFF = null, _effSig = '';
function buildEff(){
  const noUp = !!P.techNoUpkeep;           // research control: benefits, no price
  const up = noUp ? 1 : UPKEEP;
  const t = new Array(16);
  for(let m = 0; m < 16; m++){
    if(m === 0){ t[0] = NEUTRAL_TECH; continue; }
    let meta = 1;
    for(let k = 0; k < POP[m]; k++) meta *= up;
    if(m & FIRE) meta *= WARM;
    t[m] = { metaMul: meta,
             killMul: (m & REACH) ? REACH_K : 1,
             foodMul: (m & PRES) ? PRES_F : 1,
             dispMul: (m & VOID) ? VOID_D : 1 };
  }
  EFF = t; _effSig = noUp ? 'u0' : 'u1';
}
buildEff();
function syncEff(){ const s = P.techNoUpkeep ? 'u0' : 'u1'; if(s !== _effSig) buildEff(); }

export function effect(c){ return EFF[c.tech & ALL]; }

// ---- module state ------------------------------------------------------------
let _cellMask = null, _cCols = 0, _cRows = 0;   // spatial hash of "who knows what, where"
let _index = 0;                                  // cached HUD number
let _ghosts = [];                                // fading marks where something was lost
let _villMask = new Map();                       // settlement id -> pooled capabilities
let _gained = 0, _lost = 0, _invented = 0, _taught = 0, _forgot = 0;

export function techReset(){
  S.techPeak = 0;
  _cellMask = null; _cCols = _cRows = 0; _index = 0;
  _ghosts.length = 0; _villMask.clear();
  _gained = _lost = _invented = _taught = _forgot = 0;
  syncEff();
}

// Instrumentation only. Nothing in world.js, render.js or ui.js calls this; it
// exists so an experiment harness can read the transmission and loss counters
// without this module having to write undeclared fields onto S.
export function techStats(){
  return { gained: _gained, lost: _lost, invented: _invented, taught: _taught, forgot: _forgot,
           index: _index, peak: S.techPeak || 0 };
}

// ---- birth: what the parent passes on ---------------------------------------
// Each capability the parent holds is offered to the child separately and reaches
// it only with probability p, set by the CHILD's aptitude — the child is the one
// doing the learning, which is what makes the gene an aptitude rather than a
// broadcast strength. Gated on the child's brain: a child too dumb to hold a
// technique is born knowing nothing, however much its parent knew.
export function teach(parent, child){
  const pt = parent.tech; if(!pt) return;
  const g = child.g;
  if(g.brain.nh < (P.techBrain === undefined ? BRAIN : P.techBrain)) return;
  const p = clamp(TEACH_B + TEACH_A * (g.techApt || 0), 0, 1);
  let got = 0;
  for(let b = 0; b < NCAP; b++){
    const bit = 1 << b; if(!(pt & bit)) continue;
    if(rand() < p) got |= bit; else _forgot++;
  }
  if(got){ child.tech |= got; _taught += POP[got]; }
}

// ---- the step ----------------------------------------------------------------
// Two O(n) passes over a coarse hash of the world. Pass 1 ORs every holder's mask
// into its cell; pass 2 reads the 3x3 neighbourhood of cells around each body,
// which is the "is there anyone near me who knows this" question answered without
// ever comparing two bodies. That is what keeps this off the O(n^2) path: the
// cost per body is nine integer reads, not a scan of its neighbours.
//
// TECH_CELL is smaller than world.js's CELL (175, sized for the largest sense
// radius) because contact for teaching is not the same distance as sight: a 3x3
// block of 56 spans 168 world units, so a body learns from roughly the range at
// which world.js already counts it as a flockmate (NEIGH_R = 58).
const TECH_CELL = 56;

export function techTick(){
  syncEff();
  const cr = S.creatures, n = cr.length;
  if(!n){ _index = 0; return; }
  const cols = Math.max(1, Math.ceil((S.worldW || 1) / TECH_CELL));
  const rows = Math.max(1, Math.ceil((S.worldH || 1) / TECH_CELL));
  if(!_cellMask || _cCols !== cols || _cRows !== rows){ _cellMask = new Uint8Array(cols * rows); _cCols = cols; _cRows = rows; }
  else _cellMask.fill(0);
  const gate = P.techBrain === undefined ? BRAIN : P.techBrain;
  const noLearn = !!P.techNoLearn;     // research control: upkeep still charged
  const grid = _cellMask;

  // pass 1 — deposit what is known, where it is known
  for(let i = 0; i < n; i++){
    const c = cr[i]; const t = c.tech; if(!t) continue;
    const gx = c.x < 0 ? 0 : (c.x / TECH_CELL) | 0, gy = c.y < 0 ? 0 : (c.y / TECH_CELL) | 0;
    grid[(gy < rows ? gy : rows - 1) * cols + (gx < cols ? gx : cols - 1)] |= t;
  }

  // pass 2 — learn, invent, shed
  let held = 0, peak = S.techPeak || 0;
  _villMask.clear();
  for(let i = 0; i < n; i++){
    const c = cr[i], g = c.g;
    let t = c.tech;
    const brainy = g.brain.nh >= gate;
    // pooled knowledge of the 3x3 block this body stands in
    let pool = 0;
    if(brainy && !noLearn && t !== ALL){
      const gx = clamp((c.x / TECH_CELL) | 0, 0, cols - 1), gy = clamp((c.y / TECH_CELL) | 0, 0, rows - 1);
      const x0 = gx > 0 ? gx - 1 : 0, x1 = gx < cols - 1 ? gx + 1 : cols - 1;
      const y0 = gy > 0 ? gy - 1 : 0, y1 = gy < rows - 1 ? gy + 1 : rows - 1;
      for(let yy = y0; yy <= y1; yy++){ const row = yy * cols;
        for(let xx = x0; xx <= x1; xx++) pool |= grid[row + xx]; }
    }
    const missing = (~t) & ALL;
    const canLearn = pool & missing;
    // one rand() per body per step, partitioned across three disjoint tails. The
    // uniform is reused to choose WHICH capability is acquired (r/pAcq is itself
    // uniform on [0,1) given the acquisition branch), so a successful transmission
    // costs no extra draw and the RNG stream stays short and predictable.
    const pAcq = canLearn ? ACQ_K * (g.techApt || 0) : 0;
    const cfg = TYPES[c.type];
    const pShed = t ? (g.brain.nh < gate ? DUMB_SHED
                       : (c.energy < P[cfg.reproE] * SHED_E ? SHED_P : 0)) : 0;
    const pInv = (brainy && missing) ? INV_P : 0;
    if(pAcq > 0 || pShed > 0 || pInv > 0){
      const r = rand();
      if(r < pAcq){
        // pick one of the capabilities actually available nearby
        let k = POP[canLearn], j = (r / pAcq) * k | 0; if(j >= k) j = k - 1;
        for(let b = 0; b < NCAP; b++){ const bit = 1 << b; if(!(canLearn & bit)) continue;
          if(j-- === 0){ t |= bit; _gained++; break; } }
      } else if(r < pAcq + pShed){
        // shed one held capability, and leave a mark where it went
        const u = (r - pAcq) / pShed;
        let k = POP[t], j = u * k | 0; if(j >= k) j = k - 1;
        for(let b = 0; b < NCAP; b++){ const bit = 1 << b; if(!(t & bit)) continue;
          if(j-- === 0){ t &= ~bit; _lost++; ghost(c.x, c.y, b); break; } }
      } else if(pInv > 0 && r > 1 - pInv){
        let k = POP[missing], j = ((1 - r) / pInv) * k | 0; if(j >= k) j = k - 1;
        for(let b = 0; b < NCAP; b++){ const bit = 1 << b; if(!(missing & bit)) continue;
          if(j-- === 0){ t |= bit; _invented++; break; } }
      }
    }
    c.tech = t;
    const np = POP[t];
    held += np;
    if(np > peak) peak = np;
    if(t && c.vill) _villMask.set(c.vill, (_villMask.get(c.vill) || 0) | t);
  }
  S.techPeak = peak;
  _index = held / (n * NCAP);
  // fade the loss marks
  if(_ghosts.length){
    let w = 0;
    for(let i = 0; i < _ghosts.length; i++){ const gh = _ghosts[i]; if(--gh.t > 0) _ghosts[w++] = gh; }
    _ghosts.length = w;
  }
}

function ghost(x, y, b){
  if(_ghosts.length >= GHOST_MAX) _ghosts.shift();
  _ghosts.push({ x, y, b, t: GHOST_LIFE });
}

export function techIndex(){ return _index; }

// ---- drawing -----------------------------------------------------------------
// Three registers, matching village.js / property.js: a thin coloured arc round a
// settlement for what that settlement collectively holds, a row of tiny pips on
// the bodies themselves when the camera is close enough to read them, and an
// expanding open ring where a capability was just lost. No rand() anywhere — the
// determinism tests compare a rendered run against an unrendered one.
const COL = [[236, 146, 62], [148, 200, 120], [188, 202, 228], [176, 142, 226]];

export function drawWorld(ctx, view){
  const z = view.z, vis = view.vis;
  // settlements: an arc per capability held by anyone living there. A ring that
  // loses a segment is a settlement that has forgotten something.
  const V = S.villages;
  if(V && V.length && _villMask.size){
    ctx.lineWidth = 2.2 / z;
    for(let i = 0; i < V.length; i++){
      const v = V[i], m = _villMask.get(v.id); if(!m) continue;
      const rr = v.r + 6; if(!vis(v.x, v.y, rr + 4)) continue;
      const k = POP[m]; let s = 0;
      for(let b = 0; b < NCAP; b++){
        if(!(m & (1 << b))) continue;
        const a0 = -Math.PI / 2 + (s / k) * Math.PI * 2 + 0.12, a1 = -Math.PI / 2 + ((s + 1) / k) * Math.PI * 2 - 0.12;
        const c = COL[b];
        ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},0.5)`;
        ctx.beginPath(); ctx.arc(v.x, v.y, rr, a0, a1); ctx.stroke();
        s++;
      }
    }
  }
  // the bodies that hold them. Pips are 1-2 screen px, so they are only drawn
  // once the camera is close enough for them to be anything but noise.
  if(z >= 0.5){
    const cr = S.creatures, sz = 2.2 / z, gap = 2.9 / z;
    for(let i = 0; i < cr.length; i++){
      const c = cr[i], t = c.tech; if(!t) continue;
      const rad = c.rad || 4;
      if(!vis(c.x, c.y, rad + 8)) continue;
      const k = POP[t], y = c.y - rad - 4.5 / z;
      let s = 0;
      for(let b = 0; b < NCAP; b++){
        if(!(t & (1 << b))) continue;
        const col = COL[b];
        ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},0.85)`;
        ctx.fillRect(c.x + (s - (k - 1) / 2) * gap - sz / 2, y - sz / 2, sz, sz);
        s++;
      }
    }
  }
  // and where one just went: a ring that widens and fades out
  for(let i = 0; i < _ghosts.length; i++){
    const gh = _ghosts[i], f = gh.t / GHOST_LIFE, r = 5 + (1 - f) * 22;
    if(!vis(gh.x, gh.y, r + 3)) continue;
    const c = COL[gh.b];
    ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.45 * f})`;
    ctx.lineWidth = 1.6 / z;
    ctx.beginPath(); ctx.arc(gh.x, gh.y, r, 0, Math.PI * 2); ctx.stroke();
  }
}
