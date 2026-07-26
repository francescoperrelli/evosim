// Tools: a rock is not a tool until something carries it somewhere.
//
// Rocks already litter this world as terrain. The whole of tool use is the step
// from "a rock is an obstacle" to "a rock is a thing I pick up and take with me",
// and that step needs a reason: food that cannot be opened bare-handed. A hard-
// shelled plant that is worth more than an ordinary one and is simply inedible
// without something to crack it is the cleanest possible selective reason for the
// behaviour, because a body without the gene is not punished — it just walks past
// a meal it cannot have.
//
// Keep the gradient smooth. If cracking is all-or-nothing at some threshold, the
// gene has a cliff in the middle of it and selection cannot climb the cliff from
// below; partial use has to give partial benefit, or nothing will ever start.
//
// The other honest constraint: a carried rock must cost something to carry, or
// the gene is a free lunch and rises in worlds that have no shells in them at all.
// That world — shells off, gene still mutating — is the drift control every claim
// about this mechanic has to be measured against.
//
// Contract used by world.js and render.js — these signatures are fixed:
//
//   toolTick()           -> once per world step: shelled food appears and decays.
//                           MUST use rand()/gauss() from utils.js only.
//   toolReset()          -> clear module state (called from seed() and restore()).
//   carry(c)             -> called per body per step: pick a rock up, or drop it.
//   killBonus(c)         -> multiplier on `c`'s kill probability (1 = no effect).
//   tryEat(c)            -> energy `c` extracts from shelled food within reach
//                           this step, or 0. world.js adds it and charges nothing.
//   drawWorld(ctx, view) -> world-layer drawing; view is
//                           { z, vis(x,y,r), x0, y0, x1, y1 }.
//   packShells() / unpackShells(a)  -> save-file encoding.
//
// S.shells holds the hard-shelled food; each creature carries `c.rock` (0 = empty
// handed). S.cracked counts successful openings for the HUD.
//
// ---------------------------------------------------------------------------
// HOW IT WORKS
//
// Three things, and the third is the one that makes it a tool.
//
// 1. SCREE. The world has stony ground: a fixed, patchy field derived from a hash
//    of the position, so it is the same in every run of a seed and costs no state
//    and no rand() to consult. About a third of the ground is stony. A body
//    standing on scree may pick up a stone; anywhere else it may not.
//
// 2. SHELLS. Hard-shelled plants grow on the NON-stony ground (placement retries
//    away from scree). They hold ~3x an ordinary plant's energy and no mouth can
//    open them. They rot if nobody does.
//
// 3. THE CARRY. Because 1 and 2 are disjoint by construction, the stone has to be
//    picked up in one place and still be in hand somewhere else. That is the whole
//    mechanic; everything below is bookkeeping around it.
//
// The gradient is smooth in two independent, multiplied ways, and neither has a
// threshold anywhere in it:
//   - possession. Pick-up probability is PICK * tool per step on scree, against a
//     constant drop hazard, so the FRACTION OF ITS LIFE a body spends holding a
//     stone is a smooth saturating function of the gene (0.24 at tool 0.05, 0.47
//     at 0.14, 0.86 at 1.0).
//   - extraction. A strike removes STRIKE * tool * stone-quality energy from a
//     shell and hands exactly that to the striker. There is no "cracked / not
//     cracked" state: a shell is eaten down continuously, by whoever turns up,
//     at whatever rate their gene affords. A tool = 0.05 body with a stone gets
//     5% of the meal per tick it stands there, not zero and not all of it.
// S.cracked counts shells emptied to zero, which is a HUD statistic, not a
// mechanic — nothing in the code branches on it.
//
// The cost is charged at the moment the behaviour happens, per genome.js's note:
// CARRY_E per tick WHILE a stone is held (scaled by its mass), LIFT_E once for
// stooping to pick it up, and wear that consumes the stone as it is used. A body
// that carries a stone through a world with no shells in it pays all three and
// collects nothing, which is exactly what the drift control has to measure.
//
// ---------------------------------------------------------------------------
// WHAT THIS ACTUALLY DOES, MEASURED — read this before tuning anything below.
//
// 3 seeds (1234/2024/4048) x 10000 ticks per arm, population-mean `tool` sampled
// every 250 ticks after a 3500-tick warm-up, quoted mean +- sd ACROSS SEEDS.
// Founding mean is 0.10 (genome.js seeds it rnd(0,0.2)).
//
//   arm                                        all bodies      herbivores only
//   off    toolsOn=false — gene mutates and     0.189 +- 0.050  0.179 +- 0.069
//          nothing reads it: free, functionless
//   null   toolsOn, TOOL.shells=0, kill=0 —     0.172 +- 0.043  0.163 +- 0.032
//          stones carried and paid for, and
//          nothing whatever to use them on
//   kill   TOOL.shells=0, kill=1 — the weapon   0.187 +- 0.035  0.164 +- 0.023
//          channel alone, no shells
//   full   shipped: shells on                   0.312 +- 0.120  0.308 +- 0.131
//
// THE DRIFT CONTROL SAYS THE MECHANIC IS DOING THE WORK. `off` is the honest
// baseline and it is NOT the founding value: a gene nobody reads still climbs
// 0.10 -> 0.19, because mutation is a gaussian clamped at 0 and a reflecting
// boundary pushes the mean up. Any claim here has to beat 0.19, not 0.10. With
// stones real but shells absent the gene does not rise at all — `null` 0.172 and
// `kill` 0.187 are both at or slightly below `off`, i.e. the carrying cost is
// visible and the weapon channel is worth nothing measurable. Only `full` moves,
// to 0.312. Paired by seed, full - off is +0.079 / +0.048 / +0.241 (herbivores
// +0.106 / +0.063 / +0.219): same sign in all three, and +0.123 is 2.4x the off
// arm's between-seed sd.
//
// The honest caveat is that full's own between-seed spread (0.120) is as large as
// the effect, and it is not noise — it is dose. Delivered shell energy differs
// three-fold between seeds and the gene tracks it monotonically:
//
//     seed 2024  22.7 energy/tick delivered -> herbivore tool 0.164
//     seed 1234  32.1                       -> 0.341
//     seed 4048  45.1                       -> 0.419
//
// and four rejected tunings extend the same curve downwards, all of them at or
// below the `off` arm: 4.2 -> 0.220, 10.8 -> 0.193, 15.7 -> 0.229, and the 22.7
// above. So the threshold is real and it is high: BELOW ROUGHLY 25 ENERGY/TICK
// DELIVERED — about a third of what the herbivores eat — THIS GENE IS
// INDISTINGUISHABLE FROM DRIFT. That matches what genome.js records about this
// world: selection here is weak, and only differentials worth a large fraction of
// a body's upkeep move a gene at all.
//
// Assortment is what makes even this possible, and it shows up cleanly inside a
// single run: in seed 1234's full arm the herbivores — the only bodies that can
// eat a shell — end at 0.341 while the carnivores, who pay the carrying cost and
// can only ever use a stone as a club, end at 0.207, below their own `off` value
// of 0.259. The gene rises in the bodies that can use it and falls in the bodies
// that merely carry it. That is the private-benefit argument made visible.
//
// The price is ecological and it is not small: population rises from 195 to 327
// (+68%) and shells supply about a third of the herbivore diet. That is the deal
// this world offers — an energy channel big enough for selection to see is big
// enough to move the carrying capacity. It is not destabilising (the minimum
// herbivore count over a run rises from 87 to 151, i.e. the world gets safer, not
// more brittle), but it is the single biggest thing to weigh before shipping this
// at these constants. Everything is behind P.toolsOn; with the flag off the world
// is bit-identical to the pre-tools build, verified on 3 seeds x 1500 steps.
//
// Cost: 0.138 ms per step for carry + tryEat + killBonus over 343 bodies plus
// toolTick over 2324 shells (median of 5, range 0.101-0.158), against a whole
// step of ~5 ms — differencing whole steps puts it under this box's noise floor.
// drawWorld is 1.6 ms/frame median at 960x720, z=1, 2324 shells; it was 5.6 ms
// before the path batching described down in the drawing code.
// ---------------------------------------------------------------------------

import { S, TYPES } from './state.js';
import { rand, rnd, clamp } from './utils.js';

/* ------------------------------------------------------------------ *
 * Research knob, in the shape village.js uses. Nothing in the shipped
 * game writes it; it exists so an experiment can knock one channel out
 * from under the mechanic while leaving its costs and its mutation
 * intact. `shells: 0` is the drift control the header names.
 * ------------------------------------------------------------------ */
export const TOOL = { shells: 1, kill: 1, cost: 1 };

/* ---------- scree: where a stone can be picked up ---------- */
// A hash of the cell, not a stored field and not a rand() draw, so the stony
// ground is identical in every replay of a seed, survives save/load for free, and
// cannot desynchronise the world by being consulted a different number of times.
const STONE_CELL = 120;          // ~26x20 cells over the whole world
const STONE_FRAC = 0.34;         // about a third of the ground carries loose stone
const STONE_MIN = 0.45;          // worst usable stone; the best is 1.0

function hash2(a, b){
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// 0 = bare ground, else the quality of the stone lying here (STONE_MIN..1)
function stoneAt(x, y){
  const q = hash2(Math.floor(x / STONE_CELL), Math.floor(y / STONE_CELL));
  return q < STONE_FRAC ? STONE_MIN + (1 - STONE_MIN) * (q / STONE_FRAC) : 0;
}

/* ---------- carrying ---------- */
// PICK is per tick at tool = 1 while standing on scree. Against DROP this sets the
// possession curve quoted in the header. DROP was the one constant that mattered:
// at 0.0015 (half-life ~460 ticks) possession saturated — a tool = 0.14 body held a
// stone 64% of the time against a tool = 1.0 body's 93%, so nearly the whole
// population paid the carrying cost and the gene barely moved possession at all.
// At 0.006 possession is responsive but the bottom of the range goes flat (0.11 at
// tool 0.05), which is the cliff the header warns about arriving by the back door.
// 0.003 keeps the curve monotone and steep exactly where the founding population
// sits.
//
// REJECTED, MEASURED: DROP = 0.010. The reasoning for it was good and it was wrong.
// It grades possession more steeply through the middle of the range (0.09 / 0.16 /
// 0.27 / 0.48 / 0.65 at tool 0.05 / 0.1 / 0.2 / 0.5 / 1.0, against 0.24 / 0.38 /
// 0.56 / 0.79 / 0.86 here), so a smaller and more gene-selected slice of the
// population carries — better assortment on paper, and cheaper. Measured on seed
// 1234 it halved the delivered energy (32.1 -> 15.7/tick) and the gene collapsed
// straight back to drift: herbivore tool 0.229 against this arm's 0.341 and the
// off arm's 0.234. Sharpening the assortment does not pay for shrinking the
// resource. In this world the size of the energy channel is the binding constraint
// and everything else is second order.
const PICK = 0.055, DROP = 0.003;
const LIFT_E = 0.6;              // stooping for it, charged once
const CARRY_E = 0.08;            // per tick, scaled by the stone's mass/quality
const WEAR = 0.020;              // stone consumed per full-power strike
const MIN_ROCK = 0.10;           // below this it is gravel and gets thrown away

/* ---------- shelled food ---------- */
// REJECTED: SHELL_CAP 70, SHELL_EVERY 8, STRIKE 2.5. That world looked plausible
// and did nothing: 8-15 shells emptied per 8000 ticks and a delivered income of
// ~0.002 energy/tick/body against a herbivore upkeep of ~0.40 — about 0.6% of
// upkeep at the founding gene value, two orders of magnitude below the level where
// genome.js's own control experiment can see anything at all. `tool` finished at
// 0.108 and 0.164 on two seeds, i.e. inside the noise of not being selected. Two
// further steps up the same ladder were also rejected and for the same reason:
// SHELL_CAP 200 / STRIKE 7 delivered 4.2 energy/tick and left herbivore tool at
// 0.220, and SHELL_CAP 600 / STRIKE 7 delivered 10.8 and left it at 0.193 — both
// at or below the off arm's 0.179 +- 0.069. STRIKE 20 at SHELL_CAP 600 is the
// first setting anywhere on that ladder that clears drift. The
// mechanic was correct and the resource was a rounding error; the fix was to make
// the food supply real, not to make the gene cheaper.
const SHELL_E = 70;              // ~3x an ordinary plant (P.foodEnergy = 24)
const SHELL_CAP = 600;           // standing shells per planet
const SHELL_EVERY = 1;           // one growth attempt this often
const SHELL_TTL = 3000;          // an unopened shell rots
const STRIKE = 20;                // energy freed per tick at tool = 1 with a perfect stone
const REACH = 14;                // how close a body must be to work on one
const KILL_G = 0.25;             // a stone in hand as a weapon: up to +25% kill chance

/* ---------- shell index (spatial hash, rebuilt once per tick) ---------- */
// world.js's own grid is local to step(); this is the same idea over S.shells so
// that tryEat() reads a handful of cells instead of the whole list. Cell size is
// >= REACH so a body only ever needs the one cell it stands in plus its neighbours
// — in practice a single cell lookup with a radius test, because SCELL >> REACH.
// A counting sort into two flat typed arrays, not an array-of-arrays. The obvious
// version — `new Array(cells)` and a push() per shell — rebuilt ~520 sub-arrays and
// allocated ~2800 objects EVERY TICK, and at the shipped shell density that alone
// was most of the module's per-step cost; the GC churn showed up as a per-step delta
// of ~2.5 ms against a step that otherwise took 5 ms. This version allocates only
// when the world or the shell count grows, and is the same O(n) walk otherwise.
const SCELL = 120;
let scols = 0, srows = 0, sn = 0;
let sstart = null;               // cells+1 prefix offsets into sitem
let sitem = null;                // shell indices, grouped by cell
const TAU = Math.PI * 2;
const vshell = [];               // drawing scratch: the shells visible this frame

function rebuildIndex(){
  const cols = Math.max(1, Math.ceil((S.worldW || 1) / SCELL));
  const rows = Math.max(1, Math.ceil((S.worldH || 1) / SCELL));
  const sh = S.shells, n = sh.length;
  if(cols !== scols || rows !== srows || !sstart){
    scols = cols; srows = rows;
    sstart = new Int32Array(cols * rows + 1);
  } else sstart.fill(0);
  if(!sitem || sitem.length < n) sitem = new Int32Array(Math.max(64, n * 2));
  sn = n;
  const cells = cols * rows;
  // 1: count per cell (stored one slot right, so the prefix sum lands in place)
  for(let i = 0; i < n; i++){
    const s = sh[i];
    const cx = clamp(Math.floor(s.x / SCELL), 0, cols - 1), cy = clamp(Math.floor(s.y / SCELL), 0, rows - 1);
    sstart[cy * cols + cx + 1]++;
  }
  // 2: prefix sum
  for(let k = 0; k < cells; k++) sstart[k + 1] += sstart[k];
  // 3: scatter. Uses a running cursor per cell taken from the offsets themselves.
  const cur = sstart;
  for(let i = 0; i < n; i++){
    const s = sh[i];
    const cx = clamp(Math.floor(s.x / SCELL), 0, cols - 1), cy = clamp(Math.floor(s.y / SCELL), 0, rows - 1);
    sitem[cur[cy * cols + cx]++] = i;
  }
  // step 3 advanced every offset by its own count, so sstart[k] now holds what
  // sstart[k+1] should: shift it back down in one pass.
  for(let k = cells; k > 0; k--) sstart[k] = sstart[k - 1];
  sstart[0] = 0;
}

export function toolReset(){ S.shells = []; S.cracked = 0; sstart = null; sitem = null; sn = 0; scols = srows = 0; }

/* ---------- the world's half: shells grow and rot ---------- */

function plantShell(){
  const pl = S.planets;
  let x, y;
  // Shells grow on bare ground, never on scree. Three tries, then wherever the
  // third landed — the point is that stone and shell are usually in different
  // places, not that they never coincide.
  for(let t = 0; t < 3; t++){
    if(pl.length){ const p = pl[(rand() * pl.length) | 0]; x = rnd(p.x + 10, p.x + p.w - 10); y = rnd(p.y + 10, p.y + p.h - 10); }
    else { x = rnd(8, (S.worldW || 100) - 8); y = rnd(8, (S.worldH || 100) - 8); }
    if(!stoneAt(x, y)) break;
  }
  S.shells.push({ x, y, e: SHELL_E, born: S.tick, hue: rand() });
}

export function toolTick(){
  const sh = S.shells;
  // rot and removal, in one compacting pass
  let w = 0;
  for(let i = 0; i < sh.length; i++){
    const s = sh[i];
    if(s.e <= 0.01 || S.tick - s.born > SHELL_TTL) continue;
    sh[w++] = s;
  }
  sh.length = w;
  // growth: one attempt per planet on the cadence, capped per planet
  if(TOOL.shells > 0 && S.tick % SHELL_EVERY === 0){
    const nP = S.planets.length || 1;
    const cap = SHELL_CAP * nP * TOOL.shells;
    if(sh.length < cap) plantShell();
  }
  rebuildIndex();
}

/* ---------- a body's half ---------- */

// Pick a stone up, carry it, put it down. Everything here is charged to the
// individual at the moment it happens; nothing is charged to the disposition.
export function carry(c){
  const g = c.g.tool || 0;
  if(c.rock > 0){
    // the standing cost of having your hands full of rock
    if(TOOL.cost > 0) c.energy -= CARRY_E * c.rock * TOOL.cost;
    // a body drops what it is carrying when the stone is spent, when it is too
    // hungry to bother, or simply because it put it down and walked away
    if(c.rock < MIN_ROCK || c.energy < 6 || rand() < DROP) c.rock = 0;
    return;
  }
  if(g <= 0.005) return;
  if(rand() >= PICK * g) return;          // one draw per empty-handed body per tick
  const q = stoneAt(c.x, c.y);
  if(q <= 0) return;                      // no loose stone on this ground
  c.rock = q;
  if(TOOL.cost > 0) c.energy -= LIFT_E * TOOL.cost;
}

// A stone in hand is also a weapon. Private benefit — the holder eats the kill —
// so it has the same assortment as the shells do, and it is reported separately
// because it is the one channel that survives with the shells switched off.
export function killBonus(c){
  if(TOOL.kill <= 0 || !c.rock) return 1;
  return 1 + KILL_G * TOOL.kill * (c.g.tool || 0) * c.rock;
}

// Work on any shelled food within reach. No threshold: the return is the gene's
// share of one tick's work, and a shell is whittled down by however many bodies
// turn up with however good a stone.
export function tryEat(c){
  const rk = c.rock;
  if(rk <= 0 || !sstart || sn === 0) return 0;
  const g = c.g.tool || 0;
  if(g <= 0.005) return 0;
  const eff = TYPES[c.type].plantEff;     // a shelled seed is plant food; carnivores get nothing
  if(eff <= 0) return 0;
  const reach = (c.rad || 2) + REACH, r2 = reach * reach;
  // SCELL is ~7x the reach, so the bounding box of the reach is one cell almost
  // always and never more than four — walking a fixed 3x3 would triple the work
  // for nothing.
  const gx0 = clamp(Math.floor((c.x - reach) / SCELL), 0, scols - 1), gx1 = clamp(Math.floor((c.x + reach) / SCELL), 0, scols - 1);
  const gy0 = clamp(Math.floor((c.y - reach) / SCELL), 0, srows - 1), gy1 = clamp(Math.floor((c.y + reach) / SCELL), 0, srows - 1);
  let got = 0;
  const sh = S.shells;
  for(let ny = gy0; ny <= gy1; ny++){
    for(let nx = gx0; nx <= gx1; nx++){
      const k = ny * scols + nx, e0 = sstart[k], e1 = sstart[k + 1];
      for(let j = e0; j < e1; j++){
        const s = sh[sitem[j]];
        if(!s || s.e <= 0) continue;
        if((s.x - c.x) ** 2 + (s.y - c.y) ** 2 > r2) continue;
        const take = Math.min(s.e, STRIKE * g * c.rock);
        s.e -= take; got += take;
        c.rock -= WEAR * (take / STRIKE);      // the stone is spent doing the work
        if(s.e <= 0.01){ s.e = 0; S.cracked++; }
        if(c.rock < MIN_ROCK){ c.rock = 0; break; }
      }
    }
    if(c.rock <= 0) break;
  }
  return got * eff;
}

/* ---------- save / load ---------- */

export function packShells(){
  return S.shells.map(s => [Math.round(s.x), Math.round(s.y), +s.e.toFixed(1), s.born | 0, +s.hue.toFixed(3)]);
}
export function unpackShells(a){
  S.shells = (a || []).map(r => ({ x: r[0], y: r[1], e: r[2], born: r[3] || 0, hue: r[4] === undefined ? 0.5 : r[4] }));
  rebuildIndex();
}

/* ---------- drawing ---------- */
// Three things to read off the ground: where stone can be had, where the shelled
// food is and how far into it something has got, and who is carrying. All of it is
// a function of state or of the position hash — rendering never calls rand(), or a
// repaint would desynchronise the world from its seed.
export function drawWorld(ctx, view){
  const z = view.z, vis = view.vis;
  let bould = null;

  // 1. scree. Zoomed out it is a wash over the cell; close in it resolves into
  // individual stones, so the ground the player is told to look for is legible at
  // the scale they are actually looking at it.
  const c0 = Math.max(0, Math.floor(view.x0 / STONE_CELL)), c1 = Math.floor(view.x1 / STONE_CELL);
  const r0 = Math.max(0, Math.floor(view.y0 / STONE_CELL)), r1 = Math.floor(view.y1 / STONE_CELL);
  const close = z > 0.42;
  for(let cy = r0; cy <= r1; cy++){
    for(let cx = c0; cx <= c1; cx++){
      const q = hash2(cx, cy);
      if(q >= STONE_FRAC) continue;
      const qual = STONE_MIN + (1 - STONE_MIN) * (q / STONE_FRAC);
      const gx = cx * STONE_CELL, gy = cy * STONE_CELL;
      ctx.fillStyle = `rgba(146,142,134,${0.05 + 0.07 * qual})`;
      ctx.fillRect(gx, gy, STONE_CELL, STONE_CELL);
      if(!close) continue;
      // scattered boulders, placed by the hash so they never move. Collected into
      // one path across every visible cell and filled once — see the note on
      // batching above the shell loop.
      if(!bould) bould = [];
      for(let k = 0; k < 7; k++){
        const hx = hash2(cx * 71 + k, cy * 131 + 17), hy = hash2(cx * 197 + k, cy * 53 + 91);
        bould.push(gx + hx * STONE_CELL, gy + hy * STONE_CELL, 1.6 + 3.2 * qual * hash2(cx + k, cy - k));
      }
    }
  }
  if(bould){
    ctx.fillStyle = 'rgba(128,124,118,0.48)';
    ctx.beginPath();
    for(let i = 0; i < bould.length; i += 3){
      ctx.moveTo(bould[i] + bould[i + 2], bould[i + 1]);
      ctx.arc(bould[i], bould[i + 1], bould[i + 2], 0, TAU);
    }
    ctx.fill();
  }

  // 2. shells. A pale husk with a dark seam down it; as it is eaten the seam opens
  // into a gap and the kernel showing through it shrinks.
  //
  // Batched, and the batching is the whole reason this is readable at 60fps. The
  // first version drew each husk with its own save/translate/rotate, its own
  // fillStyle string and four separate paths; at the shipped shell density that is
  // ~400 husks on screen at z = 1 and it cost 5.6 ms per frame, a third of the
  // frame budget, measured against 8.8 ms for the rest of the world. Collecting
  // every husk into ONE path and filling it once takes the module's whole drawing
  // cost to the figure quoted in the header. The price is that the husk alpha can
  // no longer vary per shell — the emptiness of a shell is read from the kernel and
  // the seam instead, which is where a player was looking anyway.
  // The visible set is culled ONCE into a reused scratch array. Culling per pass
  // instead cost more than the batching saved: S.shells runs to a few thousand and
  // the passes below would each have called vis() on all of them.
  const sh = S.shells;
  let hn = 0;
  for(let i = 0; i < sh.length; i++){
    const s = sh[i];
    if(s.e <= 0 || !vis(s.x, s.y, 9)) continue;
    vshell[hn++] = s;
  }
  if(hn){
    ctx.fillStyle = 'rgba(206,190,158,0.86)';
    ctx.beginPath();
    for(let i = 0; i < hn; i++){
      const s = vshell[i], rr = 3.4 + 2.2 * clamp(s.e / SHELL_E, 0, 1);
      ctx.moveTo(s.x + rr * 1.25, s.y);
      ctx.ellipse(s.x, s.y, rr * 1.25, rr, s.hue * Math.PI, 0, TAU);
    }
    ctx.fill();
    ctx.strokeStyle = 'rgba(104,92,70,0.85)'; ctx.lineWidth = Math.min(1.5, 1.1 / z + 0.25);
    ctx.stroke();                                    // same path, no rebuild
    // the kernel showing through the widening seam, and the seam itself. Two alpha
    // bands for the kernel, so this is two fills rather than one per shell.
    for(let band = 0; band < 2; band++){
      let any = false;
      ctx.beginPath();
      for(let i = 0; i < hn; i++){
        const s = vshell[i];
        const f = clamp(s.e / SHELL_E, 0, 1), open = 1 - f;
        if(open <= 0.04 || (open > 0.5 ? 1 : 0) !== band) continue;
        const rr = 3.4 + 2.2 * f, kx = rr * 1.05 * open, ky = rr * 0.82 * f + 0.6;
        ctx.moveTo(s.x + kx, s.y);
        ctx.ellipse(s.x, s.y, kx, ky, s.hue * Math.PI, 0, TAU);
        any = true;
      }
      if(any){ ctx.fillStyle = band ? 'rgba(236,178,96,0.9)' : 'rgba(236,178,96,0.62)'; ctx.fill(); }
    }
    ctx.strokeStyle = 'rgba(88,74,54,0.72)'; ctx.lineWidth = Math.min(1.4, 1.0 / z);
    ctx.beginPath();
    for(let i = 0; i < hn; i++){
      const s = vshell[i];
      const rr = (3.4 + 2.2 * clamp(s.e / SHELL_E, 0, 1)) * 1.15;
      const a = s.hue * Math.PI, ca = Math.cos(a) * rr, sa = Math.sin(a) * rr;
      ctx.moveTo(s.x - ca, s.y - sa); ctx.lineTo(s.x + ca, s.y + sa);
      vshell[i] = null;                              // do not pin dead shells alive
    }
    ctx.stroke();
  }

  // 3. the stone in a body's hands. This is the only place the carry is visible,
  // and it is the whole mechanic, so it is drawn whenever a body is worth drawing.
  if(z > 0.3){
    const cr = S.creatures;
    ctx.fillStyle = 'rgba(150,146,138,0.95)';
    ctx.strokeStyle = 'rgba(60,58,54,0.8)'; ctx.lineWidth = Math.min(1, 0.8 / z);
    let n = 0;
    ctx.beginPath();
    for(let i = 0; i < cr.length; i++){
      const c = cr[i];
      if(!c.rock || !vis(c.x, c.y, 10)) continue;
      const rr = 1.5 + 1.7 * c.rock;
      const d = (c.rad || 2) + rr * 0.9;
      // held on the side the body is heading, so it reads as carried, not dropped
      const sp = Math.hypot(c.vx, c.vy) || 1, ux = -c.vy / sp, uy = c.vx / sp;
      const px = c.x + ux * d, py = c.y + uy * d;
      ctx.moveTo(px + rr, py); ctx.arc(px, py, rr, 0, TAU);
      n++;
    }
    if(n){ ctx.fill(); ctx.stroke(); }
  }
}
