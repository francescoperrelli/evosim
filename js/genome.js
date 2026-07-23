// Genoma (tratti fisici + comportamentali + cervello) e fabbrica di creature
import { rnd, clamp, gauss } from './utils.js';
import { P, S } from './state.js';
import { randomBrain, mutateBrain } from './nn.js';

export function randomGenome(type){
  const hue = type === 'carn' ? rnd(0, 35) : rnd(85, 150);
  return {
    speed: rnd(0.9, 2.1), sense: rnd(45, 95), size: rnd(3.5, 6), hue,
    sociality: rnd(0.2, 0.9), camo: rnd(0, 0.3),
    territoriality: rnd(0.2, 0.8), territoryR: rnd(55, 120),
    acuity: rnd(0.2, 0.5), brain: randomBrain()
  };
}

export function mutateGenome(g, type){
  const m = P.mut, hc = type === 'carn' ? 18 : 115, hs = type === 'carn' ? 24 : 40;
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
    brain: mutateBrain(g.brain)
  };
}

export function makeCreature(x, y, type, genome, gen){
  const startE = type === 'carn' ? P.carnStartE : P.herbStartE;
  return {
    id: S.ID++, x, y, vx: rnd(-1, 1), vy: rnd(-1, 1), type, g: genome,
    energy: startE, age: 0, gen: gen || 0, dead: false, homeX: x, homeY: y
  };
}

export function metabolism(c){
  const g = c.g, base = c.type === 'carn' ? 0.09 : 0.05;
  let m = base + (g.speed * g.speed) * 0.05 + (g.size * 0.012) + (g.sense * 0.0016);
  if(c.type === 'carn' && P.mimicOn) m += g.acuity * 0.03;   // costo dell'acutezza
  return m;
}
