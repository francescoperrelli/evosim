// Motore della simulazione: nascita, percezione, cervello+istinto, interazioni,
// oltre a salvataggio/caricamento dello stato del mondo.
import { rnd, clamp } from './utils.js';
import { P, S, BRAIN_W, INNATE_W, NEIGH_R2, SEP_R2, SAVE_KEY } from './state.js';
import { randomGenome, mutateGenome, makeCreature, metabolism } from './genome.js';
import { brainForward, NIN, NOUT } from './nn.js';

const _in = new Array(NIN), _out = new Array(NOUT);

export function spawnFood(n){
  for(let i = 0; i < n && S.food.length < P.maxFood; i++)
    S.food.push({ x: rnd(6, S.W - 6), y: rnd(6, S.H - 6) });
}

export function seed(){
  S.creatures = []; S.food = []; S.tick = 0; S.predations = 0; S.maxGen = 0;
  S.popHist.length = 0; S.traitHist.length = 0; S.ID = 1;
  for(let i = 0; i < P.herbStart; i++)
    S.creatures.push(makeCreature(rnd(0, S.W), rnd(0, S.H), 'herb', randomGenome('herb'), 0));
  if(P.predatorsOn) for(let i = 0; i < P.carnStart; i++)
    S.creatures.push(makeCreature(rnd(0, S.W), rnd(0, S.H), 'carn', randomGenome('carn'), 0));
  spawnFood(P.maxFood * 0.6 | 0);
}

export function step(){
  S.tick++; spawnFood(P.foodRate);
  const W = S.W, H = S.H, food = S.food;
  let creatures = S.creatures;
  const newborns = [];
  const n = creatures.length;

  for(let ci = 0; ci < n; ci++){
    const c = creatures[ci];
    if(c.dead) continue;
    c.age++;
    const g = c.g, senseSq = g.sense * g.sense;

    // --- scansione vicini/avversari ---
    let oppx = 0, oppy = 0, oppHas = false, oppD = senseSq;
    let cnt = 0, sumx = 0, sumy = 0, sumvx = 0, sumvy = 0, sepx = 0, sepy = 0;
    for(let k = 0; k < n; k++){
      if(k === ci) continue;
      const o = creatures[k];
      if(o.dead) continue;
      const dx = o.x - c.x, dy = o.y - c.y, d = dx * dx + dy * dy;
      if(o.type === c.type){
        if(d < NEIGH_R2){
          cnt++; sumx += o.x; sumy += o.y; sumvx += o.vx; sumvy += o.vy;
          if(d < SEP_R2){ sepx += (c.x - o.x); sepy += (c.y - o.y); }
        }
      } else if(c.type === 'carn' && o.type === 'herb'){
        let er = senseSq;
        if(P.mimicOn){ const f = 1 - o.g.camo * (1 - g.acuity) * 0.7; er = senseSq * f * f; }
        if(d < er && d < oppD){ oppD = d; oppx = dx; oppy = dy; oppHas = true; }
      } else if(c.type === 'herb' && o.type === 'carn'){
        if(d < oppD){ oppD = d; oppx = dx; oppy = dy; oppHas = true; }
      }
    }

    // --- cibo (solo erbivori) ---
    let bf = -1, bfx = 0, bfy = 0, bfD = senseSq;
    if(c.type === 'herb'){
      const fSense = P.mimicOn ? senseSq * (1 - 0.3 * g.camo) * (1 - 0.3 * g.camo) : senseSq;
      for(let fi = 0; fi < food.length; fi++){
        const dx = food[fi].x - c.x, dy = food[fi].y - c.y, d = dx * dx + dy * dy;
        if(d < bfD && d < fSense){ bfD = d; bf = fi; bfx = dx; bfy = dy; }
      }
    }

    // --- input della rete ---
    const inv = 1 / g.sense;
    _in[0] = bf >= 0 ? bfx * inv : 0;
    _in[1] = bf >= 0 ? bfy * inv : 0;
    _in[2] = bf >= 0 ? 1 - Math.sqrt(bfD) * inv : 0;
    _in[3] = oppHas ? oppx * inv : 0;
    _in[4] = oppHas ? oppy * inv : 0;
    _in[5] = oppHas ? 1 - Math.sqrt(oppD) * inv : 0;
    _in[6] = cnt ? (sumx / cnt - c.x) * inv : 0;
    _in[7] = cnt ? (sumy / cnt - c.y) * inv : 0;
    _in[8] = clamp(c.energy / (c.type === 'carn' ? P.carnReproE : P.herbReproE), 0, 1.5);
    _in[9] = 1;
    brainForward(g.brain, _in, _out);

    // --- istinto (prior) ---
    let ix = 0, iy = 0;
    if(c.type === 'herb'){
      if(oppHas){ const d = Math.sqrt(oppD) || 1; ix -= oppx / d * 1.6; iy -= oppy / d * 1.6; }
      else if(bf >= 0){ const d = Math.sqrt(bfD) || 1; ix += bfx / d; iy += bfy / d; }
      if(P.flocksOn && cnt){
        const s = g.sociality;
        ix += (sumx / cnt - c.x) * 0.010 * s; iy += (sumy / cnt - c.y) * 0.010 * s;
        ix += (sumvx / cnt) * 0.10 * s;        iy += (sumvy / cnt) * 0.10 * s;
        ix += sepx * 0.05;                     iy += sepy * 0.05;
      }
    } else {
      if(oppHas){ const d = Math.sqrt(oppD) || 1; ix += oppx / d * 1.4; iy += oppy / d * 1.4; }
      else if(P.terrOn){
        const hx = c.homeX - c.x, hy = c.homeY - c.y, hd = Math.hypot(hx, hy);
        if(hd > g.territoryR){ ix += hx / hd * g.territoriality * 1.2; iy += hy / hd * g.territoriality * 1.2; }
      }
    }

    // --- combinazione cervello + istinto ---
    let dx = _out[0] * BRAIN_W + ix * INNATE_W, dy = _out[1] * BRAIN_W + iy * INNATE_W;
    if(dx * dx + dy * dy < 1e-4){ dx = rnd(-1, 1); dy = rnd(-1, 1); }
    const dl = Math.hypot(dx, dy) || 1;
    c.vx = dx / dl * g.speed; c.vy = dy / dl * g.speed;
    c.x += c.vx; c.y += c.vy;
    if(c.x < 4){ c.x = 4; c.vx = Math.abs(c.vx); } if(c.x > W - 4){ c.x = W - 4; c.vx = -Math.abs(c.vx); }
    if(c.y < 4){ c.y = 4; c.vy = Math.abs(c.vy); } if(c.y > H - 4){ c.y = H - 4; c.vy = -Math.abs(c.vy); }

    c.energy -= metabolism(c);

    // --- interazioni ---
    if(c.type === 'herb'){
      if(bf >= 0){
        const f = food[bf], er = g.size + 4;
        if((f.x - c.x) ** 2 + (f.y - c.y) ** 2 < er * er){
          c.energy += P.foodEnergy; food[bf] = food[food.length - 1]; food.pop();
        }
      }
      if(c.energy >= P.herbReproE && creatures.length + newborns.length < P.maxPop){
        c.energy *= 0.5;
        const ch = makeCreature(c.x + rnd(-6, 6), c.y + rnd(-6, 6), 'herb', mutateGenome(g, 'herb'), c.gen + 1);
        ch.energy = c.energy; newborns.push(ch); if(ch.gen > S.maxGen) S.maxGen = ch.gen;
      }
      if(c.energy <= 0 || c.age > P.herbMaxAge) c.dead = true;
    } else {
      if(oppHas){
        for(let k = 0; k < n; k++){
          const o = creatures[k];
          if(o.dead || o.type !== 'herb') continue;
          const er = g.size + o.g.size + 2;
          if((o.x - c.x) ** 2 + (o.y - c.y) ** 2 < er * er){
            o.dead = true; S.predations++; c.energy += P.preyEnergy; break;
          }
        }
      }
      if(c.energy >= P.carnReproE && creatures.length + newborns.length < P.maxPop){
        c.energy *= 0.5;
        const ch = makeCreature(c.x + rnd(-6, 6), c.y + rnd(-6, 6), 'carn', mutateGenome(g, 'carn'), c.gen + 1);
        ch.energy = c.energy; ch.homeX = c.x; ch.homeY = c.y; newborns.push(ch); if(ch.gen > S.maxGen) S.maxGen = ch.gen;
      }
      if(c.energy <= 0 || c.age > P.carnMaxAge) c.dead = true;
    }
  }

  if(newborns.length) creatures = creatures.concat(newborns);
  creatures = creatures.filter(c => !c.dead);

  // rete di sicurezza contro l'estinzione totale
  let herbN = 0, carnN = 0;
  for(const c of creatures){ c.type === 'carn' ? carnN++ : herbN++; }
  if(herbN === 0) for(let i = 0; i < 12; i++)
    creatures.push(makeCreature(rnd(0, W), rnd(0, H), 'herb', randomGenome('herb'), 0));
  if(P.predatorsOn && carnN === 0 && herbN > 25) for(let i = 0; i < 3; i++)
    creatures.push(makeCreature(rnd(0, W), rnd(0, H), 'carn', randomGenome('carn'), 0));

  S.creatures = creatures;

  if(S.tick % 6 === 0){
    let hn = 0, cn = 0, camo = 0, acu = 0;
    for(const c of creatures){ if(c.type === 'carn'){ cn++; acu += c.g.acuity; } else { hn++; camo += c.g.camo; } }
    S.popHist.push({ h: hn, c: cn, f: food.length });
    S.traitHist.push({ camo: hn ? camo / hn : 0, acu: cn ? acu / cn : 0 });
    if(S.popHist.length > 240){ S.popHist.shift(); S.traitHist.shift(); }
  }
}

/* ---------- salvataggio / caricamento ---------- */
export function snapshot(){
  return {
    v: 3, tick: S.tick, predations: S.predations, maxGen: S.maxGen, ID: S.ID, W: S.W, H: S.H,
    params: { foodRate: P.foodRate, mut: P.mut, predatorsOn: P.predatorsOn, flocksOn: P.flocksOn, terrOn: P.terrOn, mimicOn: P.mimicOn },
    creatures: S.creatures.map(c => ({
      x: +c.x.toFixed(1), y: +c.y.toFixed(1), t: c.type === 'carn' ? 1 : 0,
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
  if(!s || s.v !== 3) return false;
  const sx = s.W ? S.W / s.W : 1, sy = s.H ? S.H / s.H : 1;
  S.creatures = s.creatures.map(o => ({
    id: o.id, x: o.x * sx, y: o.y * sy, vx: 0, vy: 0, type: o.t ? 'carn' : 'herb',
    energy: o.e, age: o.a, gen: o.gn, dead: false, homeX: (o.hx || o.x) * sx, homeY: (o.hy || o.y) * sy,
    g: { speed: o.g[0], sense: o.g[1], size: o.g[2], hue: o.g[3], sociality: o.g[4], camo: o.g[5],
         territoriality: o.g[6], territoryR: o.g[7], acuity: o.g[8], brain: o.b.slice() }
  }));
  S.food = s.food.map(a => ({ x: a[0] * sx, y: a[1] * sy }));
  S.tick = s.tick || 0; S.predations = s.predations || 0; S.maxGen = s.maxGen || 0; S.ID = s.ID || S.creatures.length + 1;
  if(s.params) Object.assign(P, s.params);
  S.popHist.length = 0; S.traitHist.length = 0;
  return true;
}

export function saveLocal(){ try{ localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot())); return true; }catch(e){ return false; } }
export function hasSave(){ try{ return !!localStorage.getItem(SAVE_KEY); }catch(e){ return false; } }
export function loadLocal(){ try{ const r = localStorage.getItem(SAVE_KEY); return r ? restore(JSON.parse(r)) : false; }catch(e){ return false; } }
export function clearLocal(){ try{ localStorage.removeItem(SAVE_KEY); }catch(e){} }
