// Genome (physical + behavioural traits + brain) and creature factory
import { rnd, clamp, gauss } from './utils.js';
import { P, S, TYPES } from './state.js';
import { randomBrain, mutateBrain, NMEM, BRAINLEN } from './nn.js';

export function randomGenome(type){
  const cfg = TYPES[type];
  return {
    speed: rnd(0.9, 2.1), sense: rnd(45, 95), size: rnd(3.5, 6),
    hue: cfg.hueC + rnd(-cfg.hueSpan, cfg.hueSpan) * 0.5,
    sociality: rnd(0.2, 0.9), camo: rnd(0, 0.3),
    territoriality: rnd(0.2, 0.8), territoryR: rnd(55, 120),
    acuity: rnd(0.2, 0.5), sexual: cfg.sexual ? 1 : 0, brain: randomBrain()
  };
}

export function mutateGenome(g, type){
  const m = P.mut, cfg = TYPES[type], hc = cfg.hueC, hs = cfg.hueSpan;
  return {
    speed: clamp(g.speed + gauss() * 0.6 * m * 3, 0.4, 3.4),
    sense: clamp(g.sense + gauss() * 40 * m * 1.6, 20, 165),
    size: clamp(g.size + gauss() * 3 * m * 1.6, 2.5, 9),
    hue: clamp(g.hue + gauss() * 20 * m * 3, hc - hs, hc + hs),
    sociality: clamp(g.sociality + gauss() * m * 1.3, 0, 1),
    camo: clamp(g.camo + gauss() * m * 1.3, 0, 1),
    territoriality: clamp(g.territoriality + gauss() * m * 1.3, 0, 1),
    territoryR: clamp(g.territoryR + gauss() * 30 * m * 1.5, 30, 180),
    acuity: clamp(g.acuity + gauss() * m * 1.3, 0, 1),
    sexual: cfg.sexual ? 1 : 0,          // reproduction mode is a species trait
    brain: mutateBrain(g.brain)
  };
}

// Sexual reproduction: recombine two parents' genomes and brains, then mutate
function crossBrain(a, b){
  const out = new Array(BRAINLEN);
  for(let i = 0; i < BRAINLEN; i++) out[i] = Math.random() < 0.5 ? a[i] : b[i];
  return out;
}
export function crossover(ga, gb, type){
  const pk = (x, y) => Math.random() < 0.5 ? x : y;
  const base = {
    speed: pk(ga.speed, gb.speed), sense: pk(ga.sense, gb.sense), size: pk(ga.size, gb.size),
    hue: pk(ga.hue, gb.hue), sociality: pk(ga.sociality, gb.sociality), camo: pk(ga.camo, gb.camo),
    territoriality: pk(ga.territoriality, gb.territoriality), territoryR: pk(ga.territoryR, gb.territoryR),
    acuity: pk(ga.acuity, gb.acuity), sexual: pk(ga.sexual, gb.sexual), brain: crossBrain(ga.brain, gb.brain)
  };
  return mutateGenome(base, type);
}

export function makeCreature(x, y, type, genome, gen){
  const startE = P[TYPES[type].startE];
  return {
    id: S.ID++, x, y, vx: rnd(-1, 1), vy: rnd(-1, 1), type, g: genome,
    energy: startE, age: 0, gen: gen || 0, dead: false, homeX: x, homeY: y,
    mem: new Array(NMEM).fill(0), matedTick: -1,
    lineage: 0, kids: 0, act: null
  };
}

export function metabolism(c){
  const g = c.g, cfg = TYPES[c.type];
  let m = cfg.baseMeta + (g.speed * g.speed) * 0.05 + (g.size * 0.012) + (g.sense * 0.0016);
  if(cfg.hunts.length && P.mimicOn) m += g.acuity * 0.03;   // cost of acuity for predators
  return m;
}
