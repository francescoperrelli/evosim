// Genome (physical + behavioural traits + brain) and creature factory.
// Diet is a continuous heritable gene; the feeding "band" (herb/omni/carn)
// is derived from it, so a lineage's diet can evolve over generations.
import { rnd, clamp, gauss, rand } from './utils.js';
import { P, S, TYPES, typeOf } from './state.js';
import { randomBrain, mutateBrain, crossBrain, NMEM } from './nn.js';

export function randomGenome(type){
  const cfg = TYPES[type];
  return {
    speed: rnd(0.9, 2.1), sense: rnd(45, 95), size: rnd(3.5, 6),
    hue: cfg.hueC + rnd(-cfg.hueSpan, cfg.hueSpan) * 0.5,
    sociality: rnd(0.2, 0.9), camo: rnd(0, 0.3),
    territoriality: rnd(0.2, 0.8), territoryR: rnd(55, 120),
    acuity: rnd(0.2, 0.5), diet: rnd(cfg.dietLo, cfg.dietHi),
    shape: rnd(0, 0.5), pattern: rnd(0, 1), altruism: rnd(0, 0.5),
    ornament: rnd(0, 0.3), preference: rnd(0.1, 0.5), resist: rnd(0, 0.2), reciprocity: rnd(0, 0.4), migrate: rnd(0, 0.4), hoard: rnd(0, 0.3), build: rnd(0, 0.3), disperse: rnd(0, 0.12), husbandry: rnd(0, 0.2),
    // pace: r/K life-history axis (0 = many cheap fast young, 1 = few costly slow young)
    // mutRate: this lineage's own mutability, itself heritable and evolvable
    // detox: capacity to neutralise plant chemical defences
    pace: rnd(0.3, 0.7), mutRate: rnd(0.4, 0.6), detox: rnd(0, 0.15),
    sexual: cfg.sexual ? 1 : 0, brain: randomBrain()
  };
}

// Per-genome mutation scale. With evolvability off every lineage mutates at the
// global rate; with it on, `mutRate` scales each lineage's own step size, so the
// mutation rate is itself under selection — second-order selection, since the
// gene has no effect of its own and can only be selected through the quality of
// the mutations it produces in the rest of the genome.
//
// The mapping is exponential rather than linear because a mutation rate is a
// rate: real mutators differ from wild-type by factors, not by increments. A
// linear map also makes the gene nearly neutral at its top end (0.9 -> 0.95
// barely changes anything) so it silts up there by drift; on a log scale the
// selective gradient is the same everywhere along the axis. 0.5 is exactly the
// global rate, so switching the mechanic on does not shift the average.
const MUT_SPAN = 1.8;                 // e^(±0.9): ~0.41x at one end, ~2.46x at the other
export function mutScale(g){
  if(!P.evolvOn) return 1;
  const r = g.mutRate === undefined ? 0.5 : g.mutRate;
  return Math.exp(MUT_SPAN * (r - 0.5));
}

// Life history derived from the `pace` gene: the r/K axis, the oldest trade-off
// in demography. Nothing here is a free lunch — every gain on one side is paid
// for on another, and which side pays best depends entirely on how the world
// kills you.
//
//   pace -> 0  (r): mature early, breed on a shallow reserve, split it among
//                   many small young, die young. Wins where mortality is high
//                   and indiscriminate, because a body is unlikely to survive
//                   long enough for any investment in it to be repaid.
//   pace -> 1  (K): mature late, hoard a deep reserve, spend it all on one
//                   well-provisioned offspring, live long. Wins at carrying
//                   capacity, where a juvenile's starting energy decides whether
//                   it survives the competition its parents have already lost to.
//
// The one thing this axis cannot lean on is clutch size. world.js charges the
// parent a flat half of its reserve per breeding event however many young come out
// of it, and it shields a starving body by cutting its burn rate, so extra eggs are
// very nearly free and poorly provisioned ones rarely starve. Left to run, that
// arithmetic beats every other term and `pace` collapses to 0 in every world
// (measured: benign settled at 0.22 with a wide clutch swing). Charging the eggs
// back through the breeding threshold does not fix it either — a per-egg surcharge
// steep enough to matter makes the threshold U-shaped in `pace`, which pins the
// gene to the middle everywhere (also measured: 0.51 vs 0.54).
//
// So the clutch swing is kept deliberately narrow, and the weight of the trade-off
// sits on the three things world.js does price honestly: age at maturity, lifespan,
// and the reserve a body must hold before it can breed at all. Those are precisely
// the terms whose value depends on how likely you are to be killed by something
// other than your own economics — which is what makes the regime, and not the
// arithmetic, decide the winner.
//
// Neutral values while the mechanic is off, so the caller can apply it blindly.
const NEUTRAL_LH = { clutch: 1, invest: 1, matMult: 1, ageMult: 1, reproMult: 1 };
export function lifeHistory(g){
  if(!P.lifeHistOn) return NEUTRAL_LH;
  const p = g.pace === undefined ? 0.5 : g.pace, q = 1 - p;
  const clutch = 1 + 0.7 * q * q;                       // 1.7 young at the r end, 1 at the K end
  return {
    clutch,
    invest: 1,
    // maturity and lifespan carry the widest swing on purpose: they are the two
    // terms whose value depends entirely on extrinsic mortality. Growing up slowly
    // and living long are nearly free where nothing hunts you and close to suicidal
    // where something does, so this is where the regime does its sorting.
    matMult: 0.50 + 1.00 * p,                          // age at maturity: 0.5x .. 1.5x
    ageMult: 0.55 + 0.90 * p,                          // lifespan: 0.55x .. 1.45x
    reproMult: 0.62 + 0.60 * p + 0.25 * (clutch - 1)   // reserve demanded: 0.80x at the r end .. 1.22x at the K end, and still one ration per extra egg
  };
}

// Mutate a genome. Diet mutates first; the band (and its hue/mode) follows.
export function mutateGenome(g){
  const sc = mutScale(g), m = P.mut * sc;
  const diet = clamp((g.diet === undefined ? 0.15 : g.diet) + gauss() * m * 0.45, 0, 1);
  const cfg = TYPES[typeOf(diet)];
  return {
    speed: clamp(g.speed + gauss() * 0.6 * m * 3, 0.4, 3.4),
    sense: clamp(g.sense + gauss() * 40 * m * 1.6, 20, 165),
    size: clamp(g.size + gauss() * 3 * m * 1.6, 2.5, 9),
    hue: clamp(g.hue + gauss() * 8, cfg.hueC - cfg.hueSpan, cfg.hueC + cfg.hueSpan),
    sociality: clamp(g.sociality + gauss() * m * 1.3, 0, 1),
    camo: clamp(g.camo + gauss() * m * 1.3, 0, 1),
    territoriality: clamp(g.territoriality + gauss() * m * 1.3, 0, 1),
    territoryR: clamp(g.territoryR + gauss() * 30 * m * 1.5, 30, 180),
    acuity: clamp(g.acuity + gauss() * m * 1.3, 0, 1),
    diet,
    shape: clamp((g.shape === undefined ? 0.3 : g.shape) + gauss() * m * 1.3, 0, 1),
    pattern: clamp((g.pattern === undefined ? 0.5 : g.pattern) + gauss() * m * 1.3, 0, 1),
    altruism: clamp((g.altruism === undefined ? 0.2 : g.altruism) + gauss() * m * 1.3, 0, 1),
    ornament: clamp((g.ornament === undefined ? 0.1 : g.ornament) + gauss() * m * 1.3, 0, 1),
    preference: clamp((g.preference === undefined ? 0.15 : g.preference) + gauss() * m * 1.3, 0, 1),
    resist: clamp((g.resist === undefined ? 0.05 : g.resist) + gauss() * m * 1.3, 0, 1),
    reciprocity: clamp((g.reciprocity === undefined ? 0.1 : g.reciprocity) + gauss() * m * 1.3, 0, 1),
    migrate: clamp((g.migrate === undefined ? 0.1 : g.migrate) + gauss() * m * 1.3, 0, 1),
    hoard: clamp((g.hoard === undefined ? 0.1 : g.hoard) + gauss() * m * 1.3, 0, 1),
    build: clamp((g.build === undefined ? 0.1 : g.build) + gauss() * m * 1.3, 0, 1),
    disperse: clamp((g.disperse === undefined ? 0.05 : g.disperse) + gauss() * m * 1.3, 0, 1),
    husbandry: clamp((g.husbandry === undefined ? 0.05 : g.husbandry) + gauss() * m * 1.3, 0, 1),
    pace: clamp((g.pace === undefined ? 0.5 : g.pace) + gauss() * m * 1.3, 0, 1),
    // The mutability gene mutates by its own rate — a mutator makes mutator and
    // non-mutator offspring alike, which is what lets the trait sweep with the
    // beneficial mutations it happens to generate and then be dragged back down
    // once the lineage sits on an optimum and every further mutation costs.
    // The step is deliberately smaller than the other genes': the gene has no
    // direct phenotype, so selection on it is weak and a large step would let
    // drift outrun it entirely.
    mutRate: clamp((g.mutRate === undefined ? 0.5 : g.mutRate) + gauss() * m * 0.5, 0.02, 1),
    detox: clamp((g.detox === undefined ? 0.05 : g.detox) + gauss() * m * 1.3, 0, 1),
    sexual: cfg.sexual ? 1 : 0,
    brain: mutateBrain(g.brain, sc)
  };
}

// Sexual reproduction: recombine two parents' genomes and brains, then mutate
export function crossover(ga, gb){
  const pk = (x, y) => rand() < 0.5 ? x : y;
  // Ornament and preference are inherited as a LINKED pair (both from the same
  // parent). Independent assortment would break the ornament–preference genetic
  // correlation every generation and kill any Fisherian runaway; linkage lets
  // the correlation — and thus runaway sexual selection — build up.
  const sp = rand() < 0.5 ? ga : gb;
  const base = {
    speed: pk(ga.speed, gb.speed), sense: pk(ga.sense, gb.sense), size: pk(ga.size, gb.size),
    hue: pk(ga.hue, gb.hue), sociality: pk(ga.sociality, gb.sociality), camo: pk(ga.camo, gb.camo),
    territoriality: pk(ga.territoriality, gb.territoriality), territoryR: pk(ga.territoryR, gb.territoryR),
    acuity: pk(ga.acuity, gb.acuity), diet: pk(ga.diet, gb.diet),
    shape: pk(ga.shape, gb.shape), pattern: pk(ga.pattern, gb.pattern), altruism: pk(ga.altruism, gb.altruism),
    ornament: sp.ornament, preference: sp.preference, resist: pk(ga.resist, gb.resist), reciprocity: pk(ga.reciprocity, gb.reciprocity), migrate: pk(ga.migrate, gb.migrate), hoard: pk(ga.hoard, gb.hoard), build: pk(ga.build, gb.build), disperse: pk(ga.disperse, gb.disperse), husbandry: pk(ga.husbandry, gb.husbandry),
    pace: pk(ga.pace, gb.pace), mutRate: pk(ga.mutRate, gb.mutRate), detox: pk(ga.detox, gb.detox), brain: crossBrain(ga.brain, gb.brain)
  };
  return mutateGenome(base);
}

export function makeCreature(x, y, type, genome, gen){
  const t = typeOf(genome.diet !== undefined ? genome.diet : (type === 'carn' ? 0.85 : type === 'omni' ? 0.5 : 0.15));
  const startE = P[TYPES[t].startE];
  return {
    id: S.ID++, x, y, vx: rnd(-1, 1), vy: rnd(-1, 1), type: t, g: genome,
    energy: startE, age: 0, gen: gen || 0, dead: false, homeX: x, homeY: y,
    mem: new Array(NMEM).fill(0), matedTick: -1,
    lineage: 0, kids: 0, act: null, sick: 0, pathogen: null, immune: 0, ledger: [], carry: 0, parent: 0, anc: [], sig: [0, 0, 0],
    rad: genome.size * 0.45, alert: 0, groupSize: 0,
    sp: 0,                             // species id assigned by phylo.js
    owner: 0, tamedTick: -1, herd: 0   // owner: id of the herder tending this creature as livestock; herd: livestock a herder tends
  };
}

export function metabolism(c){
  const g = c.g, cfg = TYPES[c.type];
  let m = cfg.baseMeta + (g.speed * g.speed) * 0.05 + ((c.rad || g.size) * 0.012) + (g.sense * 0.0016);
  if(cfg.hunts.length && P.mimicOn) m += g.acuity * 0.03;   // cost of acuity for predators
  m += g.brain.nh * 0.0016;                                  // a bigger brain costs energy (modest, so complexity can accrue)
  if(g.ornament) m += g.ornament * 0.014;   // a showy ornament is costly to carry, whatever it advertises
  if(g.resist) m += g.resist * 0.01;         // an immune system costs upkeep (so resistance only pays under disease)
  if(g.disperse) m += g.disperse * 0.012;    // dispersal tech (space-faring machinery) is costly to build and carry
  if(g.husbandry && g.brain.nh >= P.herdBrain) m += g.husbandry * 0.012;   // husbandry only expresses (and costs) in brainy lineages
  // A detoxifying liver costs upkeep, so it only pays where plants fight back —
  // with flora off the gene is free and simply drifts, which is the control this
  // coefficient was tuned against. Measured over 4 seeds x 14k ticks, mean detox
  // in defended vs undefended worlds: 0.428/0.296 at 0.011 (ranges overlap),
  // 0.425/0.254 at 0.044 (no rank overlap), 0.369/0.327 at 0.09 (effect gone,
  // the liver is priced out before the toxins can select for it). 0.044 it is.
  if(g.detox && P.floraOn && cfg.eatsPlants) m += g.detox * 0.044;
  // Rate of living: a fast life history is a hot one. Growing up in half the time
  // and breeding on a shallow reserve is bought with a higher mass-specific
  // metabolic rate — and the same hot metabolism is why the fast body wears out
  // young. This is the one term that stops the r end being a free lunch, because it
  // is the only cost of a fast life that is charged every single tick: an early
  // maturity and a shallow breeding threshold both pay off immediately, while the
  // shortened lifespan that is supposed to balance them costs almost nothing in a
  // world where fewer than one herbivore in ten lives long enough to die of old age.
  // It scales the whole upkeep rather than adding a flat charge, so it stays
  // proportionate for a carnivore's hotter body as much as a herbivore's, and so
  // that it bites hardest exactly where net income is thinnest — a saturated world,
  // which is where K strategists are supposed to win. Centred on pace 0.5, so
  // switching the mechanic on leaves the average creature's upkeep untouched.
  if(P.lifeHistOn) m *= 1 + (0.5 - (g.pace === undefined ? 0.5 : g.pace)) * 0.75;
  return m;
}
