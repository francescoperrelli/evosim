// Simulation engine: seasons, spatial-grid perception (egocentric vision,
// prey/threat channels, memory), brain + instinct steering, interactions, save/load.
import { rnd, clamp } from './utils.js';
import { P, S, TYPES, PREDATORS, BRAIN_W, INNATE_W, NEIGH_R2, SEP_R2, CELL, SAVE_KEY, seasonInfo } from './state.js';
import { randomGenome, mutateGenome, crossover, makeCreature, metabolism } from './genome.js';
import { brainForward, getHidden, NIN, NOUT } from './nn.js';

const _in = new Array(NIN), _out = new Array(NOUT);
const TAU2 = Math.PI * 2;

export function spawnFood(n){
  const k = Math.floor(n) + (Math.random() < (n % 1) ? 1 : 0);
  for(let i = 0; i < k && S.food.length < P.maxFood; i++)
    S.food.push({ x: rnd(6, S.worldW - 6), y: rnd(6, S.worldH - 6) });
}

function founder(type){ const c = makeCreature(rnd(0, S.worldW), rnd(0, S.worldH), type, randomGenome(type), 0); c.lineage = c.id; return c; }
export function seed(){
  S.creatures = []; S.food = []; S.tick = 0; S.predations = 0; S.maxGen = 0;
  S.popHist.length = 0; S.traitHist.length = 0; S.evoHist.length = 0; S.ID = 1; S.selected = null;
  S.records = { oldestAge: 0, maxKids: 0, maxGen: 0 };
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
  spawnFood(P.foodRate * si.foodMult);

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
    const gcx = clamp(Math.floor(c.x / CELL), 0, cols - 1), gcy = clamp(Math.floor(c.y / CELL), 0, rows - 1);

    const sp = Math.hypot(c.vx, c.vy);
    const hx = sp > 1e-4 ? c.vx / sp : 1, hy = sp > 1e-4 ? c.vy / sp : 0;

    let preyRef = null, preyD = senseSq, preyx = 0, preyy = 0;
    let thrHas = false, thrD = senseSq, thrx = 0, thry = 0;
    let cnt = 0, sumx = 0, sumy = 0, sumvx = 0, sumvy = 0, sepx = 0, sepy = 0;
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
          if(o.type === c.type){
            if(d < NEIGH_R2){ cnt++; sumx += o.x; sumy += o.y; sumvx += o.vx; sumvy += o.vy;
              if(d < SEP_R2){ sepx += (c.x - o.x); sepy += (c.y - o.y); } }
            if(d < mateD && o.g.sexual > 0.5 && o.energy >= mateReadyE && o.matedTick !== S.tick){
              mateD = d; mateRef = o; matex = dx; matey = dy;
            }
            continue;
          }
          if(hunts.length && hunts.indexOf(o.type) >= 0){
            let er = senseSq;
            if(P.mimicOn){ const f = 1 - o.g.camo * (1 - g.acuity) * 0.7; er = senseSq * f * f; }
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
    _in[16] = 1;
    brainForward(g.brain, _in, _out);
    c.mem[0] = _out[2]; c.mem[1] = _out[3];
    if(c === S.selected){ c.act = { inp: _in.slice(), hid: getHidden().slice(), out: _out.slice() }; }

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

    // combine brain + instinct
    let dx = _out[0] * BRAIN_W + ix * INNATE_W, dy = _out[1] * BRAIN_W + iy * INNATE_W;
    if(dx * dx + dy * dy < 1e-4){ dx = rnd(-1, 1); dy = rnd(-1, 1); }
    const dl = Math.hypot(dx, dy) || 1;
    c.vx = dx / dl * g.speed; c.vy = dy / dl * g.speed;
    c.x += c.vx; c.y += c.vy;
    if(c.x < 4){ c.x = 4; c.vx = Math.abs(c.vx); } if(c.x > WW - 4){ c.x = WW - 4; c.vx = -Math.abs(c.vx); }
    if(c.y < 4){ c.y = 4; c.vy = Math.abs(c.vy); } if(c.y > HH - 4){ c.y = HH - 4; c.vy = -Math.abs(c.vy); }

    c.energy -= metabolism(c) * (P.seasonsOn && si.idx === 3 ? 1.15 : 1);

    // interactions
    if(cfg.eatsPlants && bfRef){
      const er = g.size + 4;
      if((bfRef.x - c.x) ** 2 + (bfRef.y - c.y) ** 2 < er * er){
        c.energy += P.foodEnergy * cfg.plantEff;
        const fi = food.indexOf(bfRef); if(fi >= 0){ food[fi] = food[food.length - 1]; food.pop(); }
      }
    }
    if(preyRef && !preyRef.dead){
      const er = g.size + preyRef.g.size + 2;
      if((preyRef.x - c.x) ** 2 + (preyRef.y - c.y) ** 2 < er * er){
        preyRef.dead = true; S.predations++; c.energy += P.preyEnergy * cfg.preyEff;
        if(S.selected === preyRef) S.selected = null;
      }
    }
    if(c.energy >= P[cfg.reproE] && creatures.length + newborns.length < P.maxPop){
      if(g.sexual > 0.5){
        // sexual: needs a ready mate in contact; offspring recombines both parents
        if(mateRef && !mateRef.dead && mateRef.matedTick !== S.tick){
          const er = g.size + mateRef.g.size + 12;
          if((mateRef.x - c.x) ** 2 + (mateRef.y - c.y) ** 2 < er * er){
            const childE = (c.energy + mateRef.energy) * 0.22 * 1.2;   // hybrid vigor
            c.energy *= 0.6; mateRef.energy *= 0.6;
            c.matedTick = S.tick; mateRef.matedTick = S.tick;
            const ch = makeCreature((c.x + mateRef.x) / 2, (c.y + mateRef.y) / 2, c.type, crossover(g, mateRef.g, c.type), Math.max(c.gen, mateRef.gen) + 1);
            ch.energy = childE; ch.lineage = c.lineage; if(cfg.terr){ ch.homeX = ch.x; ch.homeY = ch.y; }
            c.kids++; mateRef.kids++;
            if(c.kids > S.records.maxKids) S.records.maxKids = c.kids;
            newborns.push(ch); if(ch.gen > S.maxGen) S.maxGen = ch.gen;
          }
        }
      } else {
        // asexual: clone with mutation
        c.energy *= 0.5;
        const ch = makeCreature(c.x + rnd(-6, 6), c.y + rnd(-6, 6), c.type, mutateGenome(g, c.type), c.gen + 1);
        ch.energy = c.energy; ch.lineage = c.lineage; if(cfg.terr){ ch.homeX = c.x; ch.homeY = c.y; }
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
  if(P.omnivoresOn && omniN === 0 && herbN > 40) for(let i = 0; i < 10; i++) creatures.push(founder('omni'));
  if(P.predatorsOn && carnN === 0 && herbN > 50) for(let i = 0; i < 8; i++) creatures.push(founder('carn'));

  S.creatures = creatures;

  if(S.tick % 6 === 0){
    let hn = 0, cn = 0, on = 0, camo = 0, acu = 0, sx = 0, tot = 0, genSum = 0;
    const lin = new Set();
    for(const c of creatures){
      tot++; if(c.g.sexual > 0.5) sx++; genSum += c.gen; lin.add(c.lineage);
      if(c.type === 'carn'){ cn++; acu += c.g.acuity; } else if(c.type === 'omni'){ on++; camo += c.g.camo; } else { hn++; camo += c.g.camo; }
    }
    S.popHist.push({ h: hn, c: cn, o: on, f: food.length });
    S.traitHist.push({ camo: (hn + on) ? camo / (hn + on) : 0, acu: cn ? acu / cn : 0, sex: tot ? sx / tot : 0 });
    S.evoHist.push({ gen: tot ? genSum / tot : 0, sex: tot ? sx / tot : 0, lin: lin.size });
    if(S.popHist.length > 240){ S.popHist.shift(); S.traitHist.shift(); }
    if(S.evoHist.length > 240){ S.evoHist.shift(); }
    if(S.maxGen > S.records.maxGen) S.records.maxGen = S.maxGen;
  }
}

/* ---------- save / load ---------- */
export function snapshot(){
  return {
    v: 6, tick: S.tick, predations: S.predations, maxGen: S.maxGen, ID: S.ID,
    worldW: S.worldW, worldH: S.worldH,
    params: { foodRate: P.foodRate, mut: P.mut, predatorsOn: P.predatorsOn, omnivoresOn: P.omnivoresOn,
              flocksOn: P.flocksOn, terrOn: P.terrOn, mimicOn: P.mimicOn, seasonsOn: P.seasonsOn },
    creatures: S.creatures.map(c => ({
      x: +c.x.toFixed(1), y: +c.y.toFixed(1), t: c.type,
      e: +c.energy.toFixed(1), a: c.age, gn: c.gen, id: c.id, hx: +c.homeX.toFixed(1), hy: +c.homeY.toFixed(1),
      g: [+c.g.speed.toFixed(3), +c.g.sense.toFixed(1), +c.g.size.toFixed(2), +c.g.hue.toFixed(1),
          +c.g.sociality.toFixed(2), +c.g.camo.toFixed(2), +c.g.territoriality.toFixed(2),
          +c.g.territoryR.toFixed(1), +c.g.acuity.toFixed(2), +c.g.sexual.toFixed(2)],
      b: c.g.brain.map(x => +x.toFixed(3))
    })),
    food: S.food.map(f => [+f.x.toFixed(1), +f.y.toFixed(1)])
  };
}

export function restore(s){
  if(!s || s.v !== 6) return false;
  if(s.worldW){ S.worldW = s.worldW; S.worldH = s.worldH; }
  S.creatures = s.creatures.map(o => ({
    id: o.id, x: o.x, y: o.y, vx: 0, vy: 0, type: (o.t === 'carn' || o.t === 'omni' || o.t === 'herb') ? o.t : 'herb',
    energy: o.e, age: o.a, gen: o.gn, dead: false, homeX: (o.hx || o.x), homeY: (o.hy || o.y),
    mem: [0, 0], matedTick: -1, lineage: o.id, kids: 0, act: null,
    g: { speed: o.g[0], sense: o.g[1], size: o.g[2], hue: o.g[3], sociality: o.g[4], camo: o.g[5],
         territoriality: o.g[6], territoryR: o.g[7], acuity: o.g[8],
         sexual: o.g[9] !== undefined ? o.g[9] : 0.5, brain: o.b.slice() }
  }));
  S.food = s.food.map(a => ({ x: a[0], y: a[1] }));
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
