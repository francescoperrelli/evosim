// Simulation engine: seasons, spatial-grid perception (egocentric vision,
// prey/threat channels, memory), brain + instinct steering, interactions, save/load.
import { rnd, clamp } from './utils.js';
import { P, S, TYPES, PREDATORS, BRAIN_W, INNATE_W, NEIGH_R2, SEP_R2, CELL, SAVE_KEY, seasonInfo, dayInfo } from './state.js';
import { randomGenome, mutateGenome, crossover, makeCreature, metabolism } from './genome.js';
import { brainForward, getHidden, NIN, NOUT, NCHAN, IN_HEARD, OUT_SIG, migrateBrain, brainLenOld } from './nn.js';
import { evalChallenge } from './challenges.js';

const _in = new Array(NIN), _out = new Array(NOUT);
const TAU2 = Math.PI * 2;

// ---------- pheromone field (stigmergy): faint scent trails per species ----------
// Each species deposits into a coarse grid as it moves; the field blurs and decays.
// Creatures read the local gradient and drift up-scent, so paths and gathering
// points emerge on their own without any of it being scripted.
const PCELL = 46;
let pher = null;
export function pherInit(){
  const cols = Math.max(1, Math.ceil((S.worldW || 1700) / PCELL));
  const rows = Math.max(1, Math.ceil((S.worldH || 1050) / PCELL));
  pher = { cols, rows, f: { herb: new Float32Array(cols * rows), omni: new Float32Array(cols * rows), carn: new Float32Array(cols * rows) } };
  S.pher = pher;
}
function pherDeposit(c, amt){
  const cx = clamp(Math.floor(c.x / PCELL), 0, pher.cols - 1), cy = clamp(Math.floor(c.y / PCELL), 0, pher.rows - 1);
  const arr = pher.f[c.type], i = cy * pher.cols + cx;
  arr[i] = Math.min(6, arr[i] + amt);
}
const _pg = [0, 0, 0];
function pherGradient(c){
  const cols = pher.cols, rows = pher.rows, arr = pher.f[c.type];
  const cx = clamp(Math.floor(c.x / PCELL), 0, cols - 1), cy = clamp(Math.floor(c.y / PCELL), 0, rows - 1);
  const l = arr[cy * cols + Math.max(0, cx - 1)], r = arr[cy * cols + Math.min(cols - 1, cx + 1)];
  const u = arr[Math.max(0, cy - 1) * cols + cx], d = arr[Math.min(rows - 1, cy + 1) * cols + cx];
  _pg[0] = r - l; _pg[1] = d - u; _pg[2] = arr[cy * cols + cx];
}
function pherUpdate(){
  const cols = pher.cols, rows = pher.rows;
  for(const tk of ['herb', 'omni', 'carn']){
    const a = pher.f[tk], b = new Float32Array(a.length);
    for(let y = 0; y < rows; y++) for(let x = 0; x < cols; x++){
      const i = y * cols + x;
      let s = a[i] * 4;
      s += a[y * cols + Math.max(0, x - 1)] + a[y * cols + Math.min(cols - 1, x + 1)] +
           a[Math.max(0, y - 1) * cols + x] + a[Math.min(rows - 1, y + 1) * cols + x];
      b[i] = (s / 8) * 0.92;   // box-blur (diffusion) + decay
    }
    pher.f[tk] = b;
  }
  S.pher = pher;
}

// terrain: biome fertility field and water slowdown
export function fertilityAt(x, y){
  let f = 1;
  for(const bm of S.biomes){ const d2 = (x - bm.x) ** 2 + (y - bm.y) ** 2; if(d2 < bm.r * bm.r) f += bm.fert * (1 - Math.sqrt(d2) / bm.r); }
  return clamp(f, 0.1, 2);
}
function waterFactor(x, y){
  for(const w of S.water){ if((x - w.x) ** 2 + (y - w.y) ** 2 < w.r * w.r) return 0.5; }
  return 1;
}
function generateBiomes(){
  S.biomes = [];
  const n = 3 + (Math.random() * 3 | 0);
  for(let i = 0; i < n; i++)
    S.biomes.push({ x: rnd(0, S.worldW), y: rnd(0, S.worldH), r: rnd(220, 420), fert: Math.random() < 0.6 ? rnd(0.4, 0.9) : rnd(-0.7, -0.3) });
}

// reproductive isolation: sexual partners must be genetically similar enough
function mateCompatible(a, b){
  const gd = Math.abs((a.diet || 0) - (b.diet || 0)) * 1.5 + Math.abs(a.size - b.size) / 9 +
             Math.abs(a.speed - b.speed) / 3.4 + Math.abs(a.hue - b.hue) / 360;
  return gd < 0.45;
}
// genome fingerprint for approximate species clustering
function geneVec(c){ const g = c.g; return [g.speed / 3.4, g.sense / 165, g.size / 9, g.diet || 0, (g.hue || 0) / 360, g.shape || 0.3, g.pattern || 0.5]; }
// Chronicle: a running log of notable events for the player to read back
export function logEvent(key, n){
  S.chronicle.unshift({ tick: S.tick, key, n: n === undefined ? null : n });
  if(S.chronicle.length > 80) S.chronicle.pop();
}
function checkChronicle(){
  let herb = 0, omni = 0, carn = 0, maxBrain = 0;
  for(const c of S.creatures){ if(c.type === 'carn') carn++; else if(c.type === 'omni') omni++; else herb++; if(c.g.brain.nh > maxBrain) maxBrain = c.g.brain.nh; }
  const total = S.creatures.length;
  const pv = S.chronPrev || (S.chronPrev = { herb, omni, carn, total, genTier: 0, maxBrain: 0, speciesMax: 0 });
  const genTier = Math.floor(S.maxGen / 10);
  if(genTier > pv.genTier && S.maxGen >= 10) logEvent('gen', S.maxGen);
  const types = { herb, omni, carn };
  for(const tk of ['herb', 'omni', 'carn']){
    if(types[tk] === 0 && pv[tk] > 0) logEvent('extinct_' + tk);
    else if(types[tk] > 0 && pv[tk] === 0) logEvent('return_' + tk);
  }
  if(total > pv.total * 1.8 && total > 420) logEvent('boom', total);
  if(total < pv.total * 0.4 && pv.total > 180) logEvent('crash', total);
  if(maxBrain > pv.maxBrain && maxBrain >= 12) logEvent('brain', maxBrain);
  const sp = speciesCount();
  if(sp > pv.speciesMax && sp >= 6) logEvent('species', sp);
  S.chronPrev = { herb, omni, carn, total, genTier: Math.max(genTier, pv.genTier), maxBrain: Math.max(maxBrain, pv.maxBrain), speciesMax: Math.max(sp, pv.speciesMax) };
}
export { checkChronicle };

export function speciesCount(){
  const TH2 = 0.42 * 0.42, reps = [];
  for(const c of S.creatures){
    const v = geneVec(c); let found = false;
    for(const r of reps){ let s = 0; for(let i = 0; i < v.length; i++){ const d = v[i] - r[i]; s += d * d; } if(s < TH2){ found = true; break; } }
    if(!found){ reps.push(v); if(reps.length >= 60) break; }
  }
  return reps.length;
}

export function spawnFood(n){
  const k = Math.floor(n) + (Math.random() < (n % 1) ? 1 : 0);
  for(let i = 0; i < k && S.food.length < P.maxFood; i++){
    let bx = 0, by = 0, bf = -1;
    for(let t = 0; t < 3; t++){ const x = rnd(6, S.worldW - 6), y = rnd(6, S.worldH - 6), f = fertilityAt(x, y); if(f > bf){ bf = f; bx = x; by = y; } }
    S.food.push({ x: bx, y: by });
  }
}

function founder(type){ const c = makeCreature(rnd(0, S.worldW), rnd(0, S.worldH), type, randomGenome(type), 0); c.lineage = c.id; return c; }
// compact ancestry chain (last 10 forebears) inherited from the primary parent
function ancestryOf(pp){ return [...(pp.anc || []), { id: pp.id, gen: pp.gen, diet: pp.g.diet, type: pp.type, hue: pp.g.hue }].slice(-10); }
export function seed(){
  S.creatures = []; S.food = []; S.tick = 0; S.predations = 0; S.maxGen = 0;
  S.popHist.length = 0; S.traitHist.length = 0; S.evoHist.length = 0; S.ID = 1; S.selected = null;
  S.records = { oldestAge: 0, maxKids: 0, maxGen: 0 };
  S.chronicle = []; S.chronPrev = null;
  S.rocks = []; S.water = []; S.drought = 0; S.effects = []; S.challenge = null; S.shares = 0; S.packKills = 0; generateBiomes();
  pherInit();
  for(let i = 0; i < P.herbStart; i++) S.creatures.push(founder('herb'));
  if(P.omnivoresOn) for(let i = 0; i < P.omniStart; i++) S.creatures.push(founder('omni'));
  if(P.predatorsOn) for(let i = 0; i < P.carnStart; i++) S.creatures.push(founder('carn'));
  spawnFood(P.maxFood * 0.6 | 0);
}

// build a spatial hash: array of buckets, each bucket an array of items
function buildGrid(items, cols, rows){
  const b = new Array(cols * rows);
  for(const it of items){
    if(it.dead) continue;
    const cx = clamp(Math.floor(it.x / CELL), 0, cols - 1), cy = clamp(Math.floor(it.y / CELL), 0, rows - 1);
    const idx = cy * cols + cx;
    (b[idx] || (b[idx] = [])).push(it);
  }
  return b;
}

export function step(){
  S.tick++;
  const si = seasonInfo(S.tick);
  const seasonSig = Math.sin(si.phase * TAU2);
  const dn = dayInfo(S.tick);
  let fm = si.foodMult;
  if(P.dayNightOn) fm *= (0.45 + 0.55 * dn.light);   // plants grow with daylight
  if(S.drought > 0){ S.drought--; fm *= 0.12; }        // famine
  spawnFood(P.foodRate * fm);
  const rocks = S.rocks;
  if(P.pherOn){
    if(!pher || pher.cols !== Math.max(1, Math.ceil(S.worldW / PCELL))) pherInit();
    if(S.tick % 4 === 0) pherUpdate();     // diffuse + fade the scent field
  }

  const WW = S.worldW, HH = S.worldH, food = S.food;
  let creatures = S.creatures;
  const newborns = [];
  const cols = Math.max(1, Math.ceil(WW / CELL)), rows = Math.max(1, Math.ceil(HH / CELL));
  const cgrid = buildGrid(creatures, cols, rows);
  const fgrid = buildGrid(food, cols, rows);

  for(let ci = 0; ci < creatures.length; ci++){
    const c = creatures[ci];
    if(c.dead) continue;
    c.age++;
    const g = c.g, cfg = TYPES[c.type], senseSq = g.sense * g.sense;
    const preds = PREDATORS[c.type], hunts = cfg.hunts;
    const matAge = P[cfg.maxAge] * 0.16;                                  // grow to adult size over the first ~16% of life
    c.rad = g.size * clamp(0.45 + 0.55 * (c.age / matAge), 0.45, 1);
    if(c.alert > 0) c.alert--;
    const gcx = clamp(Math.floor(c.x / CELL), 0, cols - 1), gcy = clamp(Math.floor(c.y / CELL), 0, rows - 1);

    const sp = Math.hypot(c.vx, c.vy);
    const hx = sp > 1e-4 ? c.vx / sp : 1, hy = sp > 1e-4 ? c.vy / sp : 0;

    let preyRef = null, preyD = senseSq, preyx = 0, preyy = 0;
    let thrHas = false, thrD = senseSq, thrx = 0, thry = 0;
    let cnt = 0, sumx = 0, sumy = 0, sumvx = 0, sumvy = 0, sepx = 0, sepy = 0, sumS0 = 0, sumS1 = 0, sumS2 = 0;
    let bfx = 0, bfy = 0, bfD = senseSq, bfRef = null;
    let mateRef = null, mateD = senseSq, matex = 0, matey = 0;
    const mateReadyE = P[cfg.reproE] * 0.85;
    const fSense = (cfg.eatsPlants && P.mimicOn) ? senseSq * (1 - 0.3 * g.camo) * (1 - 0.3 * g.camo) : senseSq;

    for(let ox = -1; ox <= 1; ox++){
      const nx = gcx + ox; if(nx < 0 || nx >= cols) continue;
      for(let oy = -1; oy <= 1; oy++){
        const ny = gcy + oy; if(ny < 0 || ny >= rows) continue;
        const idx = ny * cols + nx;
        // creatures in this cell
        const cb = cgrid[idx];
        if(cb) for(let bi = 0; bi < cb.length; bi++){
          const o = cb[bi];
          if(o === c || o.dead) continue;
          const dx = o.x - c.x, dy = o.y - c.y, d = dx * dx + dy * dy;
          if(c.sick > 0 && o.sick === 0 && d < 700 && Math.random() < 0.04) o.sick = 500;   // contagion
          if(o.type === c.type){
            if(d < NEIGH_R2){ cnt++; sumx += o.x; sumy += o.y; sumvx += o.vx; sumvy += o.vy;
              sumS0 += o.sig[0]; sumS1 += o.sig[1]; sumS2 += o.sig[2];
              if(d < SEP_R2){ sepx += (c.x - o.x); sepy += (c.y - o.y); } }
            if(d < mateD && o.g.sexual > 0.5 && o.energy >= mateReadyE && o.matedTick !== S.tick && mateCompatible(g, o.g)){
              mateD = d; mateRef = o; matex = dx; matey = dy;
            }
            // kin food-sharing: a well-fed altruist gives energy to a starving relative nearby
            if(d < 900 && o.lineage === c.lineage && c.energy > P[cfg.reproE] * 0.7 && o.energy < P[cfg.reproE] * 0.35 && Math.random() < g.altruism * 0.08){
              c.energy -= 8; o.energy += 6; S.shares++;
            }
            continue;
          }
          if(hunts.length && hunts.indexOf(o.type) >= 0){
            let er = senseSq;
            if(P.mimicOn){ const f = 1 - o.g.camo * (1 - g.acuity) * 0.7; er = senseSq * f * f; }
            if(o.alert > 0) er *= 0.55;                    // an alert (warned) prey is harder to spot
            if(d < er && d < preyD){ preyD = d; preyRef = o; preyx = dx; preyy = dy; }
          }
          if(preds.length && preds.indexOf(o.type) >= 0){
            if(d < thrD){ thrD = d; thrx = dx; thry = dy; thrHas = true; }
          }
        }
        // food in this cell
        if(cfg.eatsPlants){
          const fb = fgrid[idx];
          if(fb) for(let bi = 0; bi < fb.length; bi++){
            const f = fb[bi]; const dx = f.x - c.x, dy = f.y - c.y, d = dx * dx + dy * dy;
            if(d < bfD && d < fSense){ bfD = d; bfRef = f; bfx = dx; bfy = dy; }
          }
        }
      }
    }

    // egocentric inputs
    const inv = 1 / g.sense;
    const ego = (dx, dy, i) => { _in[i] = (dx * hx + dy * hy) * inv; _in[i + 1] = (-dx * hy + dy * hx) * inv; };
    if(bfRef){ ego(bfx, bfy, 0); _in[2] = 1 - Math.sqrt(bfD) * inv; } else { _in[0] = _in[1] = _in[2] = 0; }
    if(preyRef){ ego(preyx, preyy, 3); _in[5] = 1 - Math.sqrt(preyD) * inv; } else { _in[3] = _in[4] = _in[5] = 0; }
    if(thrHas){ ego(thrx, thry, 6); _in[8] = 1 - Math.sqrt(thrD) * inv; } else { _in[6] = _in[7] = _in[8] = 0; }
    if(cnt){ ego(sumx / cnt - c.x, sumy / cnt - c.y, 9); _in[11] = clamp(cnt / 8, 0, 1); } else { _in[9] = _in[10] = _in[11] = 0; }
    _in[12] = clamp(c.energy / P[cfg.reproE], 0, 1.5);
    _in[13] = seasonSig;
    _in[14] = c.mem[0]; _in[15] = c.mem[1];
    const h0 = cnt ? sumS0 / cnt : 0;               // three "words" heard from same-type neighbours
    _in[IN_HEARD] = h0; _in[IN_HEARD + 1] = cnt ? sumS1 / cnt : 0; _in[IN_HEARD + 2] = cnt ? sumS2 / cnt : 0;
    _in[19] = 1;
    if(cnt && h0 < -0.4) c.alert = 30;              // channel 0 keeps its innate alarm meaning
    c.groupSize = cnt;                              // remembered for cooperative defense
    brainForward(g.brain, _in, _out);
    c.mem[0] = _out[2]; c.mem[1] = _out[3];
    c.sig[0] = _out[OUT_SIG]; c.sig[1] = _out[OUT_SIG + 1]; c.sig[2] = _out[OUT_SIG + 2];
    if(c === S.selected){ const gh = getHidden(); c.act = { inp: _in.slice(), hid: gh.h.slice(0, gh.nh), out: _out.slice() }; }

    // instinct prior
    let ix = 0, iy = 0;
    if(thrHas){ const d = Math.sqrt(thrD) || 1; ix -= thrx / d * 1.6; iy -= thry / d * 1.6; }
    if(preyRef){ const d = Math.sqrt(preyD) || 1; ix += preyx / d * 1.4; iy += preyy / d * 1.4; }
    else if(cfg.eatsPlants && bfRef){ const d = Math.sqrt(bfD) || 1; ix += bfx / d; iy += bfy / d; }
    if(P.flocksOn && cfg.social && cnt){
      const s = g.sociality;
      ix += (sumx / cnt - c.x) * 0.010 * s; iy += (sumy / cnt - c.y) * 0.010 * s;
      ix += (sumvx / cnt) * 0.10 * s;        iy += (sumvy / cnt) * 0.10 * s;
      ix += sepx * 0.05;                     iy += sepy * 0.05;
    }
    if(cfg.terr && P.terrOn && !preyRef){
      const hxx = c.homeX - c.x, hyy = c.homeY - c.y, hd = Math.hypot(hxx, hyy);
      if(hd > g.territoryR){ ix += hxx / hd * g.territoriality * 1.2; iy += hyy / hd * g.territoriality * 1.2; }
    }
    // mate-seeking (sexual organisms ready to breed steer toward a mate)
    if(g.sexual > 0.5 && !thrHas && mateRef && c.energy >= P[cfg.reproE] * 0.9){
      const d = Math.sqrt(mateD) || 1; ix += matex / d * 1.1; iy += matey / d * 1.1;
    }

    // follow the scent trail of one's own kind (stigmergy: emergent paths & gathering)
    if(P.pherOn && !thrHas){
      pherGradient(c);
      const gl = Math.hypot(_pg[0], _pg[1]);
      if(gl > 1e-3){ const s = 0.4 * (cfg.social ? 0.4 + g.sociality * 0.8 : 0.5) / gl; ix += _pg[0] * s; iy += _pg[1] * s; }
    }

    // combine brain + instinct
    let dx = _out[0] * BRAIN_W + ix * INNATE_W, dy = _out[1] * BRAIN_W + iy * INNATE_W;
    if(dx * dx + dy * dy < 1e-4){ dx = rnd(-1, 1); dy = rnd(-1, 1); }
    const dl = Math.hypot(dx, dy) || 1;
    c.vx = dx / dl * g.speed; c.vy = dy / dl * g.speed;
    const wf = S.water.length ? waterFactor(c.x, c.y) : 1;   // water slows movement
    c.x += c.vx * wf; c.y += c.vy * wf;
    if(c.x < 4){ c.x = 4; c.vx = Math.abs(c.vx); } if(c.x > WW - 4){ c.x = WW - 4; c.vx = -Math.abs(c.vx); }
    if(c.y < 4){ c.y = 4; c.vy = Math.abs(c.vy); } if(c.y > HH - 4){ c.y = HH - 4; c.vy = -Math.abs(c.vy); }
    // push out of rocks (terrain)
    for(let ri = 0; ri < rocks.length; ri++){
      const rk = rocks[ri], rdx = c.x - rk.x, rdy = c.y - rk.y, rr = rk.r + c.rad;
      if(rdx * rdx + rdy * rdy < rr * rr){ const rd = Math.hypot(rdx, rdy) || 1; c.x = rk.x + rdx / rd * rr; c.y = rk.y + rdy / rd * rr; c.vx *= 0.4; c.vy *= 0.4; }
    }

    // lay a scent mark; the better fed, the stronger the trail it leaves behind
    if(P.pherOn) pherDeposit(c, c.energy > P[cfg.reproE] * 0.5 ? 0.6 : 0.2);

    const sigCost = (Math.abs(c.sig[0]) + Math.abs(c.sig[1]) + Math.abs(c.sig[2])) * 0.012;   // honest signalling costs
    c.energy -= metabolism(c) * (P.seasonsOn && si.idx === 3 ? 1.15 : 1) + sigCost;
    if(c.sick > 0){ c.sick--; c.energy -= 0.14; }        // disease drains energy

    // interactions
    if(cfg.eatsPlants && bfRef){
      const er = c.rad + 4;
      if((bfRef.x - c.x) ** 2 + (bfRef.y - c.y) ** 2 < er * er){
        c.energy += P.foodEnergy * cfg.plantEff;
        const fi = food.indexOf(bfRef); if(fi >= 0){ food[fi] = food[food.length - 1]; food.pop(); }
      }
    }
    if(preyRef && !preyRef.dead){
      const er = c.rad + (preyRef.rad || preyRef.g.size) + 2;
      if((preyRef.x - c.x) ** 2 + (preyRef.y - c.y) ** 2 < er * er && Math.random() < 1 / (1 + 0.12 * (preyRef.groupSize || 0))){
        preyRef.dead = true; S.predations++;
        const packBonus = 1 + 0.25 * Math.min(cnt, 3);     // hunting near allies pays off
        c.energy += P.preyEnergy * cfg.preyEff * packBonus;
        if(cnt > 0) S.packKills++;
        if(S.selected === preyRef) S.selected = null;
      }
    }
    if(c.age > matAge && c.energy >= P[cfg.reproE] && creatures.length + newborns.length < P.maxPop){
      if(g.sexual > 0.5){
        // sexual: needs a ready mate in contact; offspring recombines both parents
        if(mateRef && !mateRef.dead && mateRef.matedTick !== S.tick){
          const er = g.size + mateRef.g.size + 12;
          if((mateRef.x - c.x) ** 2 + (mateRef.y - c.y) ** 2 < er * er){
            const childE = (c.energy + mateRef.energy) * 0.22 * 1.2;   // hybrid vigor
            c.energy *= 0.6; mateRef.energy *= 0.6;
            c.matedTick = S.tick; mateRef.matedTick = S.tick;
            const ch = makeCreature((c.x + mateRef.x) / 2, (c.y + mateRef.y) / 2, c.type, crossover(g, mateRef.g), Math.max(c.gen, mateRef.gen) + 1);
            ch.energy = childE; ch.lineage = c.lineage; ch.parent = c.id; ch.anc = ancestryOf(c); if(cfg.terr){ ch.homeX = ch.x; ch.homeY = ch.y; }
            c.kids++; mateRef.kids++;
            if(c.kids > S.records.maxKids) S.records.maxKids = c.kids;
            newborns.push(ch); if(ch.gen > S.maxGen) S.maxGen = ch.gen;
          }
        }
      } else {
        // asexual: clone with mutation
        c.energy *= 0.5;
        const ch = makeCreature(c.x + rnd(-6, 6), c.y + rnd(-6, 6), c.type, mutateGenome(g), c.gen + 1);
        ch.energy = c.energy; ch.lineage = c.lineage; ch.parent = c.id; ch.anc = ancestryOf(c); if(cfg.terr){ ch.homeX = c.x; ch.homeY = c.y; }
        c.kids++; if(c.kids > S.records.maxKids) S.records.maxKids = c.kids;
        newborns.push(ch); if(ch.gen > S.maxGen) S.maxGen = ch.gen;
      }
    }
    if(c.energy <= 0 || c.age > P[cfg.maxAge]){ c.dead = true; if(c.age > S.records.oldestAge) S.records.oldestAge = c.age; if(S.selected === c) S.selected = null; }
  }

  if(newborns.length) creatures = creatures.concat(newborns);
  creatures = creatures.filter(c => !c.dead);

  // safety net
  let herbN = 0, omniN = 0, carnN = 0;
  for(const c of creatures){ if(c.type === 'carn') carnN++; else if(c.type === 'omni') omniN++; else herbN++; }
  if(herbN === 0) for(let i = 0; i < 30; i++) creatures.push(founder('herb'));
  // gentle immigration keeps diet niches occupied against the herbivory-collapse
  if(S.tick % 25 === 0){
    if(P.omnivoresOn && omniN < 6 && herbN > 30) creatures.push(founder('omni'), founder('omni'));
    if(P.predatorsOn && carnN < 4 && herbN > 38) creatures.push(founder('carn'), founder('carn'));
  }

  S.creatures = creatures;

  if(S.tick % 6 === 0){
    let hn = 0, cn = 0, on = 0, camo = 0, acu = 0, sx = 0, tot = 0, genSum = 0, brainSum = 0;
    const lin = new Set();
    for(const c of creatures){
      tot++; if(c.g.sexual > 0.5) sx++; genSum += c.gen; lin.add(c.lineage); brainSum += c.g.brain.nh;
      if(c.type === 'carn'){ cn++; acu += c.g.acuity; } else if(c.type === 'omni'){ on++; camo += c.g.camo; } else { hn++; camo += c.g.camo; }
    }
    S.popHist.push({ h: hn, c: cn, o: on, f: food.length });
    S.traitHist.push({ camo: (hn + on) ? camo / (hn + on) : 0, acu: cn ? acu / cn : 0, sex: tot ? sx / tot : 0 });
    S.evoHist.push({ gen: tot ? genSum / tot : 0, sex: tot ? sx / tot : 0, lin: lin.size, nh: tot ? brainSum / tot : 0 });
    if(S.popHist.length > 240){ S.popHist.shift(); S.traitHist.shift(); }
    if(S.evoHist.length > 240){ S.evoHist.shift(); }
    if(S.maxGen > S.records.maxGen) S.records.maxGen = S.maxGen;
  }
  if(S.challenge && S.tick % 15 === 0) evalChallenge();
  if(S.tick % 60 === 0) checkChronicle();
}

/* ---------- save / load ---------- */
export function snapshot(){
  return {
    v: 9, tick: S.tick, predations: S.predations, maxGen: S.maxGen, ID: S.ID,
    worldW: S.worldW, worldH: S.worldH,
    params: { foodRate: P.foodRate, mut: P.mut, predatorsOn: P.predatorsOn, omnivoresOn: P.omnivoresOn,
              flocksOn: P.flocksOn, terrOn: P.terrOn, mimicOn: P.mimicOn, seasonsOn: P.seasonsOn },
    creatures: S.creatures.map(c => ({
      x: +c.x.toFixed(1), y: +c.y.toFixed(1), t: c.type,
      e: +c.energy.toFixed(1), a: c.age, gn: c.gen, id: c.id, hx: +c.homeX.toFixed(1), hy: +c.homeY.toFixed(1),
      g: [+c.g.speed.toFixed(3), +c.g.sense.toFixed(1), +c.g.size.toFixed(2), +c.g.hue.toFixed(1),
          +c.g.sociality.toFixed(2), +c.g.camo.toFixed(2), +c.g.territoriality.toFixed(2),
          +c.g.territoryR.toFixed(1), +c.g.acuity.toFixed(2), +c.g.sexual.toFixed(2), +c.g.diet.toFixed(3),
          +c.g.shape.toFixed(2), +c.g.pattern.toFixed(2), +c.g.altruism.toFixed(2)],
      b: { nh: c.g.brain.nh, w: c.g.brain.w.map(x => +x.toFixed(3)) }
    })),
    food: S.food.map(f => [+f.x.toFixed(1), +f.y.toFixed(1)]),
    rocks: S.rocks.map(r => [+r.x.toFixed(1), +r.y.toFixed(1), +r.r.toFixed(1)]),
    water: S.water.map(w => [+w.x.toFixed(1), +w.y.toFixed(1), +w.r.toFixed(1)]),
    biomes: S.biomes.map(bm => [+bm.x.toFixed(0), +bm.y.toFixed(0), +bm.r.toFixed(0), +bm.fert.toFixed(2)])
  };
}

export function restore(s){
  if(!s || (s.v !== 8 && s.v !== 9)) return false;
  if(s.worldW){ S.worldW = s.worldW; S.worldH = s.worldH; }
  S.creatures = s.creatures.map(o => ({
    id: o.id, x: o.x, y: o.y, vx: 0, vy: 0, type: (o.t === 'carn' || o.t === 'omni' || o.t === 'herb') ? o.t : 'herb',
    energy: o.e, age: o.a, gen: o.gn, dead: false, homeX: (o.hx || o.x), homeY: (o.hy || o.y),
    mem: [0, 0], matedTick: -1, lineage: o.id, kids: 0, act: null, sick: 0, parent: 0, anc: [], sig: [0, 0, 0], rad: o.g[2], alert: 0, groupSize: 0,
    g: { speed: o.g[0], sense: o.g[1], size: o.g[2], hue: o.g[3], sociality: o.g[4], camo: o.g[5],
         territoriality: o.g[6], territoryR: o.g[7], acuity: o.g[8],
         sexual: o.g[9] !== undefined ? o.g[9] : 0.5,
         diet: o.g[10] !== undefined ? o.g[10] : (o.t === 'carn' ? 0.85 : o.t === 'omni' ? 0.5 : 0.15),
         shape: o.g[11] !== undefined ? o.g[11] : 0.3, pattern: o.g[12] !== undefined ? o.g[12] : 0.5,
         altruism: o.g[13] !== undefined ? o.g[13] : 0.2,
         // migrate single-channel (v8) brains up to the three-channel layout
         brain: o.b.w.length === brainLenOld(o.b.nh) ? migrateBrain(o.b.nh, o.b.w) : { nh: o.b.nh, w: o.b.w.slice() } }
  }));
  S.food = s.food.map(a => ({ x: a[0], y: a[1] }));
  S.rocks = (s.rocks || []).map(a => ({ x: a[0], y: a[1], r: a[2] }));
  S.water = (s.water || []).map(a => ({ x: a[0], y: a[1], r: a[2] }));
  S.biomes = (s.biomes || []).map(a => ({ x: a[0], y: a[1], r: a[2], fert: a[3] }));
  S.drought = 0; S.effects = []; pherInit();
  S.tick = s.tick || 0; S.predations = s.predations || 0; S.maxGen = s.maxGen || 0; S.ID = s.ID || S.creatures.length + 1;
  S.selected = null;
  if(s.params) Object.assign(P, s.params);
  S.popHist.length = 0; S.traitHist.length = 0;
  return true;
}

export function saveLocal(){ try{ localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot())); return true; }catch(e){ return false; } }
export function hasSave(){ try{ return !!localStorage.getItem(SAVE_KEY); }catch(e){ return false; } }
export function loadLocal(){ try{ const r = localStorage.getItem(SAVE_KEY); return r ? restore(JSON.parse(r)) : false; }catch(e){ return false; } }
export function clearLocal(){ try{ localStorage.removeItem(SAVE_KEY); }catch(e){} }

/* ---------- play-god events ---------- */
export function meteor(x, y){
  const R = 130;
  S.effects.push({ x, y, r: R, t: 34, max: 34 });
  for(const c of S.creatures){ if((c.x - x) ** 2 + (c.y - y) ** 2 < R * R) c.dead = true; }
  S.creatures = S.creatures.filter(c => !c.dead);
  S.food = S.food.filter(f => (f.x - x) ** 2 + (f.y - y) ** 2 > R * R);
  if(S.selected && S.selected.dead) S.selected = null;
}
export function startDrought(){ S.drought = 2200; }
export function startEpidemic(){
  let n = 0;
  for(const c of S.creatures){ if(Math.random() < 0.06){ c.sick = 600; n++; } }
  if(n === 0 && S.creatures.length) S.creatures[(Math.random() * S.creatures.length) | 0].sick = 600;
}
export function addRock(x, y){ S.rocks.push({ x, y, r: rnd(16, 30) }); if(S.rocks.length > 140) S.rocks.shift(); }
export function addWater(x, y){ S.water.push({ x, y, r: rnd(28, 46) }); if(S.water.length > 140) S.water.shift(); }
export function clearTerrain(){ S.rocks = []; S.water = []; }
