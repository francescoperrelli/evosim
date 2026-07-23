// Simulation engine: seasons, perception (egocentric vision, prey/threat
// channels, memory), brain + instinct steering, interactions, and save/load.
import { rnd, clamp } from './utils.js';
import { P, S, TYPES, PREDATORS, BRAIN_W, INNATE_W, NEIGH_R2, SEP_R2, SAVE_KEY, seasonInfo } from './state.js';
import { randomGenome, mutateGenome, makeCreature, metabolism } from './genome.js';
import { brainForward, NIN, NOUT } from './nn.js';

const _in = new Array(NIN), _out = new Array(NOUT);
const TAU2 = Math.PI * 2;

export function spawnFood(n){
  let k = Math.floor(n) + (Math.random() < (n % 1) ? 1 : 0);
  for(let i = 0; i < k && S.food.length < P.maxFood; i++)
    S.food.push({ x: rnd(6, S.W - 6), y: rnd(6, S.H - 6) });
}

export function seed(){
  S.creatures = []; S.food = []; S.tick = 0; S.predations = 0; S.maxGen = 0;
  S.popHist.length = 0; S.traitHist.length = 0; S.ID = 1; S.selected = null;
  for(let i = 0; i < P.herbStart; i++) S.creatures.push(makeCreature(rnd(0, S.W), rnd(0, S.H), 'herb', randomGenome('herb'), 0));
  if(P.omnivoresOn) for(let i = 0; i < P.omniStart; i++) S.creatures.push(makeCreature(rnd(0, S.W), rnd(0, S.H), 'omni', randomGenome('omni'), 0));
  if(P.predatorsOn) for(let i = 0; i < P.carnStart; i++) S.creatures.push(makeCreature(rnd(0, S.W), rnd(0, S.H), 'carn', randomGenome('carn'), 0));
  spawnFood(P.maxFood * 0.6 | 0);
}

export function step(){
  S.tick++;
  const si = seasonInfo(S.tick);
  const seasonSig = Math.sin(si.phase * TAU2);
  spawnFood(P.foodRate * si.foodMult);

  const W = S.W, H = S.H, food = S.food;
  let creatures = S.creatures;
  const newborns = [];
  const n = creatures.length;

  for(let ci = 0; ci < n; ci++){
    const c = creatures[ci];
    if(c.dead) continue;
    c.age++;
    const g = c.g, cfg = TYPES[c.type], senseSq = g.sense * g.sense;
    const preds = PREDATORS[c.type], hunts = cfg.hunts;

    // heading (for egocentric vision)
    const sp = Math.hypot(c.vx, c.vy);
    const hx = sp > 1e-4 ? c.vx / sp : 1, hy = sp > 1e-4 ? c.vy / sp : 0;

    // --- scan others: prey, threat, flock ---
    let preyRef = null, preyD = senseSq, preyx = 0, preyy = 0;
    let thrHas = false, thrD = senseSq, thrx = 0, thry = 0;
    let cnt = 0, sumx = 0, sumy = 0, sumvx = 0, sumvy = 0, sepx = 0, sepy = 0;
    for(let k = 0; k < n; k++){
      if(k === ci) continue;
      const o = creatures[k];
      if(o.dead) continue;
      const dx = o.x - c.x, dy = o.y - c.y, d = dx * dx + dy * dy;
      if(o.type === c.type){
        if(d < NEIGH_R2){ cnt++; sumx += o.x; sumy += o.y; sumvx += o.vx; sumvy += o.vy;
          if(d < SEP_R2){ sepx += (c.x - o.x); sepy += (c.y - o.y); } }
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

    // --- nearest plant (herbivores/omnivores) ---
    let bf = -1, bfx = 0, bfy = 0, bfD = senseSq;
    if(cfg.eatsPlants){
      const fSense = P.mimicOn ? senseSq * (1 - 0.3 * g.camo) * (1 - 0.3 * g.camo) : senseSq;
      for(let fi = 0; fi < food.length; fi++){
        const dx = food[fi].x - c.x, dy = food[fi].y - c.y, d = dx * dx + dy * dy;
        if(d < bfD && d < fSense){ bfD = d; bf = fi; bfx = dx; bfy = dy; }
      }
    }

    // --- egocentric inputs ---
    const inv = 1 / g.sense;
    const ego = (dx, dy, i) => { _in[i] = (dx * hx + dy * hy) * inv; _in[i + 1] = (-dx * hy + dy * hx) * inv; };
    if(bf >= 0){ ego(bfx, bfy, 0); _in[2] = 1 - Math.sqrt(bfD) * inv; } else { _in[0] = _in[1] = _in[2] = 0; }
    if(preyRef){ ego(preyx, preyy, 3); _in[5] = 1 - Math.sqrt(preyD) * inv; } else { _in[3] = _in[4] = _in[5] = 0; }
    if(thrHas){ ego(thrx, thry, 6); _in[8] = 1 - Math.sqrt(thrD) * inv; } else { _in[6] = _in[7] = _in[8] = 0; }
    if(cnt){ ego(sumx / cnt - c.x, sumy / cnt - c.y, 9); _in[11] = clamp(cnt / 8, 0, 1); } else { _in[9] = _in[10] = _in[11] = 0; }
    _in[12] = clamp(c.energy / P[cfg.reproE], 0, 1.5);
    _in[13] = seasonSig;
    _in[14] = c.mem[0]; _in[15] = c.mem[1];
    _in[16] = 1;
    brainForward(g.brain, _in, _out);
    c.mem[0] = _out[2]; c.mem[1] = _out[3];

    // --- instinct prior ---
    let ix = 0, iy = 0;
    if(thrHas){ const d = Math.sqrt(thrD) || 1; ix -= thrx / d * 1.6; iy -= thry / d * 1.6; }   // flee
    if(preyRef){ const d = Math.sqrt(preyD) || 1; ix += preyx / d * 1.4; iy += preyy / d * 1.4; } // hunt
    else if(cfg.eatsPlants && bf >= 0){ const d = Math.sqrt(bfD) || 1; ix += bfx / d; iy += bfy / d; } // graze
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

    // --- combine brain + instinct ---
    let dx = _out[0] * BRAIN_W + ix * INNATE_W, dy = _out[1] * BRAIN_W + iy * INNATE_W;
    if(dx * dx + dy * dy < 1e-4){ dx = rnd(-1, 1); dy = rnd(-1, 1); }
    const dl = Math.hypot(dx, dy) || 1;
    c.vx = dx / dl * g.speed; c.vy = dy / dl * g.speed;
    c.x += c.vx; c.y += c.vy;
    if(c.x < 4){ c.x = 4; c.vx = Math.abs(c.vx); } if(c.x > W - 4){ c.x = W - 4; c.vx = -Math.abs(c.vx); }
    if(c.y < 4){ c.y = 4; c.vy = Math.abs(c.vy); } if(c.y > H - 4){ c.y = H - 4; c.vy = -Math.abs(c.vy); }

    c.energy -= metabolism(c) * (P.seasonsOn && si.idx === 3 ? 1.15 : 1);   // winter is harsher

    // --- interactions ---
    if(cfg.eatsPlants && bf >= 0){
      const f = food[bf], er = g.size + 4;
      if((f.x - c.x) ** 2 + (f.y - c.y) ** 2 < er * er){ c.energy += P.foodEnergy * cfg.plantEff; food[bf] = food[food.length - 1]; food.pop(); }
    }
    if(preyRef && !preyRef.dead){
      const er = g.size + preyRef.g.size + 2;
      if((preyRef.x - c.x) ** 2 + (preyRef.y - c.y) ** 2 < er * er){
        preyRef.dead = true; S.predations++; c.energy += P.preyEnergy * cfg.preyEff;
        if(S.selected === preyRef) S.selected = null;
      }
    }
    if(c.energy >= P[cfg.reproE] && creatures.length + newborns.length < P.maxPop){
      c.energy *= 0.5;
      const ch = makeCreature(c.x + rnd(-6, 6), c.y + rnd(-6, 6), c.type, mutateGenome(g, c.type), c.gen + 1);
      ch.energy = c.energy; if(cfg.terr){ ch.homeX = c.x; ch.homeY = c.y; }
      newborns.push(ch); if(ch.gen > S.maxGen) S.maxGen = ch.gen;
    }
    if(c.energy <= 0 || c.age > P[cfg.maxAge]){ c.dead = true; if(S.selected === c) S.selected = null; }
  }

  if(newborns.length) creatures = creatures.concat(newborns);
  creatures = creatures.filter(c => !c.dead);

  // safety net against total extinction
  let herbN = 0, omniN = 0, carnN = 0;
  for(const c of creatures){ if(c.type === 'carn') carnN++; else if(c.type === 'omni') omniN++; else herbN++; }
  if(herbN === 0) for(let i = 0; i < 12; i++) creatures.push(makeCreature(rnd(0, W), rnd(0, H), 'herb', randomGenome('herb'), 0));
  if(P.omnivoresOn && omniN === 0 && herbN > 20) for(let i = 0; i < 4; i++) creatures.push(makeCreature(rnd(0, W), rnd(0, H), 'omni', randomGenome('omni'), 0));
  if(P.predatorsOn && carnN === 0 && herbN > 25) for(let i = 0; i < 3; i++) creatures.push(makeCreature(rnd(0, W), rnd(0, H), 'carn', randomGenome('carn'), 0));

  S.creatures = creatures;

  if(S.tick % 6 === 0){
    let hn = 0, cn = 0, on = 0, camo = 0, acu = 0;
    for(const c of creatures){ if(c.type === 'carn'){ cn++; acu += c.g.acuity; } else if(c.type === 'omni'){ on++; camo += c.g.camo; } else { hn++; camo += c.g.camo; } }
    S.popHist.push({ h: hn, c: cn, o: on, f: food.length });
    S.traitHist.push({ camo: (hn + on) ? camo / (hn + on) : 0, acu: cn ? acu / cn : 0 });
    if(S.popHist.length > 240){ S.popHist.shift(); S.traitHist.shift(); }
  }
}

/* ---------- save / load ---------- */
export function snapshot(){
  return {
    v: 4, tick: S.tick, predations: S.predations, maxGen: S.maxGen, ID: S.ID, W: S.W, H: S.H,
    params: { foodRate: P.foodRate, mut: P.mut, predatorsOn: P.predatorsOn, omnivoresOn: P.omnivoresOn,
              flocksOn: P.flocksOn, terrOn: P.terrOn, mimicOn: P.mimicOn, seasonsOn: P.seasonsOn },
    creatures: S.creatures.map(c => ({
      x: +c.x.toFixed(1), y: +c.y.toFixed(1), t: c.type,
      e: +c.energy.toFixed(1), a: c.age, gn: c.gen, id: c.id, hx: +c.homeX.toFixed(1), hy: +c.homeY.toFixed(1),
      g: [+c.g.speed.toFixed(3), +c.g.sense.toFixed(1), +c.g.size.toFixed(2), +c.g.hue.toFixed(1),
          +c.g.sociality.toFixed(2), +c.g.camo.toFixed(2), +c.g.territoriality.toFixed(2),
          +c.g.territoryR.toFixed(1), +c.g.acuity.toFixed(2)],
      b: c.g.brain.map(x => +x.toFixed(3))
    })),
    food: S.food.map(f => [+f.x.toFixed(1), +f.y.toFixed(1)])
  };
}

export function restore(s){
  if(!s || s.v !== 4) return false;
  const sx = s.W ? S.W / s.W : 1, sy = s.H ? S.H / s.H : 1;
  S.creatures = s.creatures.map(o => ({
    id: o.id, x: o.x * sx, y: o.y * sy, vx: 0, vy: 0, type: (o.t === 'carn' || o.t === 'omni' || o.t === 'herb') ? o.t : 'herb',
    energy: o.e, age: o.a, gen: o.gn, dead: false, homeX: (o.hx || o.x) * sx, homeY: (o.hy || o.y) * sy,
    mem: [0, 0],
    g: { speed: o.g[0], sense: o.g[1], size: o.g[2], hue: o.g[3], sociality: o.g[4], camo: o.g[5],
         territoriality: o.g[6], territoryR: o.g[7], acuity: o.g[8], brain: o.b.slice() }
  }));
  S.food = s.food.map(a => ({ x: a[0] * sx, y: a[1] * sy }));
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
