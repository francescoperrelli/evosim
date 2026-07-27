// Genome (physical + behavioural traits + brain) and creature factory.
// Diet is a continuous heritable gene; the feeding "band" (herb/omni/carn)
// is derived from it, so a lineage's diet can evolve over generations.
import { rnd, clamp, gauss, rand } from './utils.js';
import { P, S, TYPES, typeOf } from './state.js';
import { randomBrain, mutateBrain, crossBrain, NMEM } from './nn.js';

// P.geneInit is a research knob, not a game setting: a map of gene name -> founding
// value, applied on top of the natural founding draw. It exists because the decisive
// question about a gene ("is this under selection, or is it drifting?") is answered by
// starting a population off its equilibrium and asking whether selection brings it
// back. A selected gene forgets where it started; a drifting one remembers. See THE
// 38-GENE AUDIT below. Undefined by default, so the shipped world is untouched.
export function randomGenome(type){
  const cfg = TYPES[type];
  const g = _randomGenome(cfg);
  const gi = P.geneInit;
  if(gi) for(const k in gi){ if(g[k] !== undefined) g[k] = gi[k]; }
  return g;
}
function _randomGenome(cfg){
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
    // level-2: civic (upkeep of shared works), caste (how strongly a body
    // specialises into one job), raid (taking what is not yours), respect
    // (leaving it alone, and paying to punish those who don't), fidelity
    // (how faithfully what you learned reaches your children), trade
    // (willingness to exchange), tribal (how much a stranger's markings matter)
    civic: rnd(0, 0.25), caste: rnd(0, 0.3), raid: rnd(0, 0.2), respect: rnd(0, 0.25),
    fidelity: rnd(0, 0.3), trade: rnd(0, 0.25), tribal: rnd(0, 0.2),
    // level-3: tool (carry a rock and use it), pyro (set fire to the ground), mark
    // (leave a mark that carries content rather than mere intensity), techApt (how
    // readily a capability is picked up from a neighbour that already holds it),
    // terra (improve the fertility of the ground you stand on, at your own expense)
    tool: rnd(0, 0.2), pyro: rnd(0, 0.15), mark: rnd(0, 0.2), techApt: rnd(0, 0.25), terra: rnd(0, 0.15),
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

// Mutational step size of the level-2 social genes. Everything else in this file
// steps by gauss() * m * 1.3, which at the default P.mut = 0.08 means a child
// differs from its parent by about 0.10 on a 0..1 scale — a tenth of the whole
// range, every single generation. See the note above metabolism() for what that
// does to a gene's ability to be selected at all. P.l2Mut overrides it for sweeps.
//
// The level-3 genes use the same step for the same reason: they are the same kind
// of object — a 0..1 behavioural dial whose consequence is a few percent of an
// energy budget — so the measurement below applies to them unchanged, and a sweep
// of P.l2Mut has to move them together or it is not measuring the class.
const L2_MUT = 1.3;

// Mutate a genome. Diet mutates first; the band (and its hue/mode) follows.
export function mutateGenome(g){
  const sc = mutScale(g), m = P.mut * sc;
  const m2 = m * (P.l2Mut === undefined ? L2_MUT : P.l2Mut);   // see the note on L2_MUT
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
    civic: clamp((g.civic === undefined ? 0.1 : g.civic) + gauss() * m2, 0, 1),
    caste: clamp((g.caste === undefined ? 0.15 : g.caste) + gauss() * m2, 0, 1),
    raid: clamp((g.raid === undefined ? 0.1 : g.raid) + gauss() * m2, 0, 1),
    respect: clamp((g.respect === undefined ? 0.1 : g.respect) + gauss() * m2, 0, 1),
    fidelity: clamp((g.fidelity === undefined ? 0.15 : g.fidelity) + gauss() * m2, 0, 1),
    trade: clamp((g.trade === undefined ? 0.1 : g.trade) + gauss() * m2, 0, 1),
    tribal: clamp((g.tribal === undefined ? 0.1 : g.tribal) + gauss() * m2, 0, 1),
    tool: clamp((g.tool === undefined ? 0.1 : g.tool) + gauss() * m2, 0, 1),
    pyro: clamp((g.pyro === undefined ? 0.08 : g.pyro) + gauss() * m2, 0, 1),
    mark: clamp((g.mark === undefined ? 0.1 : g.mark) + gauss() * m2, 0, 1),
    techApt: clamp((g.techApt === undefined ? 0.12 : g.techApt) + gauss() * m2, 0, 1),
    terra: clamp((g.terra === undefined ? 0.08 : g.terra) + gauss() * m2, 0, 1),
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
    pace: pk(ga.pace, gb.pace), mutRate: pk(ga.mutRate, gb.mutRate), detox: pk(ga.detox, gb.detox),
    civic: pk(ga.civic, gb.civic), caste: pk(ga.caste, gb.caste), raid: pk(ga.raid, gb.raid), respect: pk(ga.respect, gb.respect),
    fidelity: pk(ga.fidelity, gb.fidelity), trade: pk(ga.trade, gb.trade), tribal: pk(ga.tribal, gb.tribal),
    tool: pk(ga.tool, gb.tool), pyro: pk(ga.pyro, gb.pyro), mark: pk(ga.mark, gb.mark),
    techApt: pk(ga.techApt, gb.techApt), terra: pk(ga.terra, gb.terra),
    brain: crossBrain(ga.brain, gb.brain)
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
    // level-2 per-body state, owned by the modules named in the comments
    vill: 0, role: 0,                  // village.js: settlement id, job within it
    grudge: 0, stolen: 0,              // property.js: punishment pressure, energy taken from others
    min: 0,                            // trade.js: minerals held
    tribe: 0,                          // tribe.js: coalition id
    culture: 0,                        // culture.js: how much of this brain was taught rather than inherited
    owner: 0, tamedTick: -1, herd: 0,  // owner: id of the herder tending this creature as livestock; herd: livestock a herder tends
    // level-3 per-body state, owned by the modules named in the comments
    rock: 0,                           // tools.js: the rock in its hands (0 = empty handed)
    tech: 0,                           // tech.js: bitmask of the capabilities it holds
    mark: 0,                           // marks.js: content of the last mark it read
    terra: 0                           // terra.js: ground it has improved in its life
  };
}

// ---------------------------------------------------------------------------
// HOW BIG DOES A FITNESS DIFFERENCE HAVE TO BE BEFORE THIS SIMULATION CAN SELECT
// ON IT? Measured, because all five level-2 module authors independently reported
// their gene reading as drift and it was worth finding out whether that was their
// tuning or something structural.
//
// The clean test is a gene that does nothing at all and is charged a pure,
// unconditional, always-paid cost: cultureVertOn with P.cultureGain = 0 makes
// `fidelity` functionless, every other level-2 flag off leaves it the only gene
// paying, and P.l2Cost scales the coefficient. 4 seeds x 12000 ticks, sampled
// every 200 after 3500. Founding mean 0.15.
//
//   l2Cost   coefficient   fidelity mean +- sd   mean pop
//      0       (free)        0.228 +- 0.027        344
//      1        0.010        0.231 +- 0.029        311
//      3        0.030        0.226 +- 0.024        337
//      6        0.060        0.246 +- 0.040        284
//     10        0.100        0.207 +- 0.044        274
//     20        0.200        0.199 +- 0.036        300
//     50        0.500        0.143 +- 0.016        225
//    100        1.000        0.097 +- 0.021        254
//
// Read it honestly. A cost of 0.100 — twice what any level-2 line charges, and
// enough to knock a fifth off the population — does not move the gene outside one
// between-seed sd. The gene only starts responding at 0.5, which is ten times the
// baseMeta of a herbivore and roughly a third of its whole energy budget.
//
// So the threshold is not a tuning detail, it is a property of the architecture:
// a 0..1 behavioural gene here is selectable only when its consequence is tens of
// percent of the body's energy budget. A few percent is drift, and no run length a
// player will ever sit through changes that. Slowing the mutational step does not
// rescue it either — at P.l2Mut = 0.35 the free arm stops climbing (0.153, i.e.
// the diffusion is gone) but the costed arm sits at 0.147, because removing the
// noise does not create a signal that was never there.
//
// The one level-2 gene that IS cleanly selected is `raid`, and the reason is the
// shape of its payoff rather than its size: a raider eats what it takes, now, and
// keeps all of it. Every gene that failed — civic, respect, trade, tribal,
// fidelity — pays for a public good whose benefit is spread over neighbours who
// mostly do not carry it. That is the free-rider problem behaving exactly as the
// theory says it should, and it is a result rather than a bug. What the theory
// also says is that public-goods genes are rescued by assortment, not by bigger
// numbers, so the honest lever is making village and coalition payoffs flow to
// co-carriers rather than to whoever happens to be standing nearby.
//
// ---------------------------------------------------------------------------
// THE ASSORTMENT RESULT. That lever was then built and measured, and it does not
// work either. This is the honest write-up.
//
// WHAT WAS BUILT (all behind P.assortOn, default off, so the shipped world is
// bit-identical to the world without it):
//   * village.js — defFor(v, lineage) replaces v.def. A village's walls and watch
//     are kept in PER-LINEAGE buckets (v.lstr / v.lwat / v.lpop); a body is
//     sheltered in proportion to what its own lineage built and to that lineage's
//     share of the village. A free rider standing inside somebody else's stockade
//     gets nothing. This is the exact Hamilton fix: the theorem that kills `civic`
//     un-assorted is that strengthening a public good raises the free rider's
//     payoff by precisely as much as the contributor's, and per-lineage defence
//     is what breaks that equality.
//   * property.js — a witness polices a granary of its own lineage at 1.8x and a
//     stranger's at 0.35x, sized so the OVERALL punishment rate is close to the
//     un-assorted arm (assortment must redirect policing, not raise its volume).
//   * tribe.js — coalition strength is the sum of its members' `tribal` weights
//     instead of a head count, and raid spoils are split among nearby coalition
//     mates weighted by `tribal` instead of going whole to the attacker.
//
// MEASURED, 3 seeds (11/23/37) x 6000 ticks, sampled every 200 after t=2400, all
// six level-2 flags on. Every arm reports the four target genes alongside the five
// FUNCTIONLESS level-3 genes (tool/pyro/mark/techApt/terra), which mutate with the
// same m2 step and are clamped the same way, so each run carries its own drift
// yardstick and between-seed noise cancels. Control pool mean is the mean of the
// five. CAVEAT FOR ANYONE REUSING THIS POOL: `terra` is no longer functionless.
// It was later shown selected past ~25k ticks. At the 6000 ticks run here the pool
// is still clean -- terra's signal does not exist yet at that length -- but the
// same five genes are NOT a neutral yardstick for a run of 30k or more. Drop terra
// from the pool, or re-derive the pool, before reusing it long. "null" is the drift control: assortment on, every payoff channel removed
// (propertyPunish off, tribeRate 0, village defStr/defWatch/nurse/thatch 0) while
// the genes still mutate, still pay metabolism and still assign roles.
//
//   arm     civic          caste          respect        tribal         ctrl pool
//   base    0.203+-0.006   0.202+-0.051   0.191+-0.024   0.165+-0.032   0.158
//   assort  0.160+-0.011   0.188+-0.023   0.183+-0.027   0.145+-0.027   0.156
//   null    0.180+-0.029   0.176+-0.012   0.185+-0.011   0.151+-0.048   0.147
//
//   gene minus control pool:      base      assort      null (= drift)
//     civic                      +0.045     +0.004     +0.033
//     caste                      +0.044     +0.032     +0.029
//     respect                    +0.033     +0.027     +0.038
//     tribal                     +0.007     -0.011     +0.004
//     fidelity                   +0.019     +0.022     +0.035
//     trade                      -0.004     +0.020     +0.005
//     raid                       +0.032     -0.002     +0.027
//
// VERDICT: no. Read the third column. Every excess a target gene shows over the
// control pool is reproduced, at the same size, in the arm where its benefit has
// been deleted — which is the definition of drift. Assortment does not raise a
// single one; `civic`, the gene the village fix was designed for, goes DOWN
// (+0.045 -> +0.004), and the exact matched-founding-mean pairs behave the same
// way: civic vs techApt (both founded at 0.125) is +0.030 un-assorted, -0.012
// assorted and +0.011 in the drift control — the sign is not even stable.
//
// It is not free, either. Turning assortment on costs 21% of the population
// (277+-40 -> 220+-39), halves raiding (5252+-2042 -> 2665+-1804 fights) and cuts
// punishments 45% (474+-64 -> 261+-8), because a payoff that only reaches
// co-carriers is a smaller payoff and fewer bodies find it worth acting on. So the
// mechanism is left in the tree, exercised by P.assortOn, and OFF by default.
//
// WHY IT FAILS, as far as the numbers say. Assortment needs relatedness within the
// beneficiary group to exceed c/b. This world's lineages are ~4-8 bodies inside a
// village of 20-40, so the within-village co-carrier fraction is a third at best,
// while c/b for these genes is order 1 because b is itself only a few percent of
// an energy budget (the l2Cost sweep above). Multiplying a benefit that is already
// below the selection threshold by r < 1/3 moves it further below it. Assortment
// is the right theory; it cannot rescue a benefit this small. The binding
// constraint remains the one the sweep found — consequences here are a few percent
// of a body's energy, and a few percent is drift.
//
// THE TRIBE MODULE'S REQUEST, SETTLED. tribe.js asked for the `tribal` upkeep
// coefficient (0.008) to be raised "roughly an order of magnitude" so the gene
// would respond. Measured at 0.08 with assortment on (P.tribalCoef, 3 seeds x
// 6000 ticks): tribal 0.156+-0.020 against 0.145+-0.027 at 0.008, with the
// matched controls at tool 0.147 / mark 0.144 — a shift of +0.010 inside a
// between-seed sd of 0.02-0.03, i.e. nothing. It is also the wrong sign to want: a
// bigger coefficient is a bigger COST, so if it did anything it would select
// against `tribal`. This is the l2Cost sweep repeating itself on a second gene.
// REJECTED; shipped coefficient stays 0.008. The request was reasonable and the
// answer is a measurement, not a preference.
//
// ---------------------------------------------------------------------------
// THE 38-GENE AUDIT. Every field of this genome, classified as SELECTED (it beats
// a matched control), DRIFT (it does not) or INERT (no code path lets it change a
// body's fitness at all). The two studies above kept asking this question one gene
// at a time and getting the same answer; this asks it once, for all of them, with
// a method that cannot flatter them.
//
// WHY THE OBVIOUS TEST IS WRONG, AND WHAT REPLACES IT. The tempting test is to
// found a gene at 0.15, run a long time, and call it selected if it has moved. It
// will have moved. Mutation here is gaussian and the result is clamped into [0,1],
// so a gene that does NOTHING AT ALL still walks to the middle of its clamp range
// and settles there. Measured on a functionless gene over successive 10k-tick
// windows: 0.165 -> 0.327 -> 0.480 -> 0.505 +- 0.115, with the between-seed sd
// growing 0.016 -> 0.115 along the way. Two consequences, both load-bearing:
//
//   * The drift attractor is the MIDPOINT OF THE CLAMP RANGE, not the founding
//     value. "Rose from 0.15 to 0.48" is a fact about the clamp, not about
//     fitness. Every founding value in this file is below 0.5, so every gene in
//     the file rises, and none of that rising is evidence of anything.
//   * Long runs do not buy free statistical power. The between-seed sd grows
//     faster than any of these signals do. A 40k-tick run is not a better version
//     of a 10k-tick run, it is a noisier one.
//
// So nothing below is ever compared to where a gene started. Every claim is a gene
// against a matched control AT THE SAME RUN LENGTH ON THE SAME SEEDS: either a
// functionless gene riding along in the same run (the `fidelity` trick from the
// l2Cost sweep above), or the same gene in an arm where its payoff has been
// deleted with a P.* flag. Three instruments, in increasing cost:
//
//   1. STRUCTURAL READING. Every field grepped for its readers, every reader
//      traced to ask whether it can change a body's energy, its offspring count
//      or its death. Done first and exhaustively, because a gene with no such
//      reader needs no simulation, and simulation time is the scarce resource.
//   2. PAIRED FLAG ARMS. 6000 ticks, 4 seeds (11/23/37/53), sampled every 200
//      after t=2400. One arm ships, the other has one subsystem's flag off. The
//      ~30 genes NOT targeted by that flag are the run's own noise floor.
//   3. REVERSION TO EQUILIBRIUM. 30000 ticks, sampled every 500 after t=20000.
//      P.geneInit (added for this, see randomGenome) founds a population off
//      equilibrium; two arms, symmetric at 0.25 and 0.75. A selected gene forgets
//      where it started and the arms converge; a drifting one remembers. The
//      MIDPOINT of the two arms estimates where selection pulls, because the
//      founding bias cancels; the GAP between them estimates how much of the
//      founding value survived.
//
// GENERATIONS, NOT TICKS, ARE THE CURRENCY OF SELECTION. 6000 ticks is about 9
// generations and has no power for instrument 3 at all — the first attempt at it
// reported that even `speed` and `size` retain ~100% of an imposed gap, which is
// not a result about `speed`, it is nine generations being too few to erase
// anything. 30000 ticks is 33-36 generations, and there the test discriminates.
//
// RESULT 1: AT 6000 TICKS, NOTHING BEATS ITS CONTROL. Six paired arms — mimicOn
// alone, four physiology flags, the behaviour flags, the level-2 set, the level-3
// set, speciesOn+tribeOn, plaguesOn — and in every one the targeted genes sat
// inside the noise floor of the untargeted ones. Noise floor, as |base - control|
// across the ~30 untargeted 0..1 genes, quoted as a range over the six arms:
// median 0.008-0.011, 90th percentile 0.022-0.040, worst case 0.032-0.072. The
// largest targeted move in the entire set apart from `sociality` was `migrate` at
// +0.024, which is its own arm's 90th percentile of noise.
//
// One near-miss is worth recording, because it is the trap this method exists to
// catch. Turning four physiology flags off together moved `acuity` by -0.051,
// comfortably outside that arm's noise floor, and it looked like a result. It was
// not. That arm also lost a quarter of its population (260 +- 36 against 344 +-
// 90). Re-run with mimicOn off ALONE, population matched at 344 vs 349, `acuity`
// moved -0.015 and went straight back inside the noise. An arm that changes the
// population is not a matched control, it is a different ecology, and every gene
// in it will shift. Population is reported for every arm here for that reason.
//
// RESULT 2: THREE GENES SURVIVE, FOR THREE DIFFERENT REASONS.
//
// `sociality` — DIRECTIONAL, and the only large effect in the genome. Against a
// matched control with flocksOn and pherOn off, at 6000 ticks: 0.366 +- 0.047 vs
// 0.531 +- 0.034, a difference of -0.166, while every other gene in that same arm
// pair moved 0.021 or less. It is selected DOWNWARD — flocking costs more than it
// returns in this world. At 30000 ticks it reaches the same place from anywhere:
// 0.141 +- 0.027 from its natural founding of 0.55, 0.145 +- 0.053 from 0.25,
// 0.177 +- 0.013 from 0.75. Across the 31 soft genes the symmetric-founding
// midpoint averages 0.448 +- 0.072; `sociality` sits at 0.161, a 4.0-sigma
// outlier, and nothing else in the genome exceeds 1.5 sigma. The reason it works
// is structural. It is the only 0..1 gene wired into the movement integrator
// rather than into a metabolism line item: it changes WHERE the body is, every
// tick, and therefore what it eats and what eats it. It moves the whole income
// statement instead of a few percent of one line.
//
// `speed` — DIRECTIONAL, weak, and the only hard gene with a verdict. 30000-tick
// mean 2.311 +- 0.125 against a drift attractor of 1.900, i.e. +3.3 sigma, held
// against a quadratic metabolic cost that is one of the largest terms below. Same
// reason as sociality: it is a movement gene.
//
// `pattern` — STABILISING, not directional. This one needed its own control and
// nearly went down as drift. It retains 99% of an imposed 0.25-vs-0.75 founding
// gap at 30000 ticks where the other 30 soft genes retain 6-75%, but high
// retention is exactly what a gene that simply is not moving looks like, so
// retention alone proves nothing. The control is the same gene, same seeds, same
// run length, with its readers deleted:
//
//   arm                    lo (from 0.25)   hi (from 0.75)   gap kept   midpoint
//   shipped defaults       0.276 +- 0.094   0.771 +- 0.061      99%       0.524
//   speciesOn+tribeOn off  0.395 +- 0.114   0.619 +- 0.145      45%       0.507
//   paired difference 0.271 +- 0.160 over 6 seeds, t(5) = 4.16, same sign 6/6
//
// The pinning is real, and the 45% is the honest drift baseline for a soft gene
// over 30k ticks. Note the two midpoints: both are 0.5. There is no preferred
// value — selection resists displacement from wherever the population already is,
// which is the signature of a badge rather than of a trait. `shape` rode through
// the same arms as a control and shows nothing (43% vs 38% kept, t(5) = 0.66,
// sign consistent in only 3 of 6 seeds), and that also identifies the agent:
// phylo.js's trait vector reads shape at weight 0.80 and pattern at 0.75, so it
// cannot be pinning the lighter-weighted of the two and not the heavier.
// tribe.js's marker() reads `pattern` and nothing else. The tribe badge is doing
// this, and a similarity-matching badge producing stabilising selection is the
// theory behaving exactly as it should.
//
// A structural fact fell out of those runs and is worth keeping. With speciesOn
// and tribeOn off, the 0.25 and 0.75 arms are BIT-IDENTICAL worlds in 6 seeds of
// 6 — same population, same alive count, same value for every other gene. With
// the flags on, 0 of 6 match. `pattern` and `shape` have no causal channel into
// this simulation other than those two subsystems; and since world.js's geneVec()
// feeds only speciesCount(), which is a number drawn on a panel, `shape` has no
// fitness-affecting reader anywhere at all.
//
// THE TABLE. Soft genes are quoted as the symmetric-founding midpoint at 30000
// ticks with its z against the 31-gene pool (mean 0.448 +- 0.072); a gene at
// z ~ 0 is sitting on the neutral point with everything else. Hard genes are
// quoted against their own clamp midpoint. Spread is shown for every number,
// because a number without its spread is not a result.
//
//   FIELD           VERDICT     EVIDENCE
//   speed           SELECTED    30k 2.311 +- 0.125 vs 1.900 attractor, +3.3 sd
//   sense           UNRESOLVED  30k 92.3 +- 4.2 vs a 92.5 attractor, +0.0 sd. Its
//                               equilibrium and its attractor coincide, so this
//                               test cannot separate them. Not measured, not drift.
//   size            UNRESOLVED  30k 5.008 +- 0.804 vs 5.750, -0.9 sd; the spread is
//                               too wide for this design to resolve
//   territoryR      DRIFT       30k 95.2 +- 17.4 vs 105.0, -0.6 sd; carnivore-only
//   diet            SELECTED*   structural, not measured: it sets the feeding band
//                               and with it plantEff, preyEff and baseMeta. No
//                               control arm exists, because deleting its payoff
//                               deletes the ecology. Verdict read, not run.
//   hue             DRIFT       30k 146.5 +- 17.4; its only fitness reader is a weak
//                               mate-recognition term, and it mutates gauss()*8,
//                               ignoring P.mut entirely
//   sexual          NOT A GENE  provably non-heritable: set from TYPES[typeOf(diet)]
//                               in BOTH randomGenome and mutateGenome, and absent
//                               from crossover's recombination list. A derived
//                               field carried and serialised as if it were a gene.
//   sociality       SELECTED    -0.166 vs matched control, noise floor 0.021;
//                               30k midpoint 0.161, -4.0 sd. The strong result.
//   camo            DRIFT       -0.005 vs mimicOn control; 30k midpoint 0.427, -0.3
//   acuity          DRIFT       -0.015 vs mimicOn control; 30k midpoint 0.456, +0.1.
//                               The -0.051 seen in the four-flag arm was a
//                               population artefact and is retracted.
//   territoriality  DRIFT       30k midpoint 0.406, -0.6
//   shape           DRIFT       no pinning: 43% vs 38% kept, t(5)=0.66, 3/6 seeds.
//                               Structurally it has no fitness reader at all.
//   pattern         SELECTED    stabilising: 99% vs 45% kept, t(5)=4.16, 6/6 seeds
//   altruism        DRIFT       30k midpoint 0.437, -0.2
//   ornament        DRIFT       +0.012 vs control; 30k midpoint 0.422, -0.4
//   preference      DRIFT       +0.010 vs control; 30k midpoint 0.517, +1.0
//   resist          DRIFT       +0.019 vs plaguesOn control; 30k midpoint 0.468, +0.3
//   reciprocity     DRIFT       30k midpoint 0.413, -0.5
//   migrate         DRIFT       +0.024 vs control (its arm's 90th pct of noise);
//                               30k midpoint 0.372, -1.1
//   hoard           DRIFT       -0.015 vs control; 30k midpoint 0.433, -0.2
//   build           DRIFT       +0.015 vs control; 30k midpoint 0.448, -0.0
//   disperse        DRIFT       -0.010 vs control; 30k midpoint 0.556, +1.5
//   husbandry       DRIFT       +0.003 vs control; 30k midpoint 0.423, -0.4
//   pace            DRIFT       +0.002 vs control; 30k midpoint 0.531, +1.2
//   mutRate         DRIFT       +0.012 vs control; 30k midpoint 0.425, -0.3. Steps at
//                               gauss()*m*0.5, not *1.3, so its gap retention is not
//                               comparable to the rest of the pool.
//   detox           DRIFT       -0.006 vs control; 30k midpoint 0.462, +0.2
//   civic           DRIFT       -0.006 vs control; 30k midpoint 0.489, +0.6. The
//                               textbook case: from 0.25 and 0.75 it lands on
//                               0.470 +- 0.150 and 0.507 +- 0.152, fully diffused.
//   caste           DRIFT       -0.016 vs control; 30k midpoint 0.444, -0.1
//   raid            DRIFT       +0.010 vs control; 30k midpoint 0.452, +0.0
//   respect         DRIFT       +0.008 vs control; 30k midpoint 0.446, -0.0
//   fidelity        DRIFT       -0.013 vs control; 30k midpoint 0.407, -0.6
//   trade           DRIFT       +0.015 vs control; 30k midpoint 0.458, +0.1
//   tribal          DRIFT       +0.016 vs control; 30k midpoint 0.413, -0.5
//   tool            DRIFT       +0.022 vs control; 30k midpoint 0.559, +1.5
//   pyro            DRIFT       +0.004 vs control; 30k midpoint 0.444, -0.1
//   mark            DRIFT       -0.019 vs control; 30k midpoint 0.546, +1.4
//   techApt         DRIFT       +0.004 vs control; 30k midpoint 0.499, +0.7
//   terra           DRIFT       +0.003 vs control; 30k midpoint 0.423, -0.4
//                   -- SUPERSEDED. Re-run at 40k in terra.js, terra IS selected,
//                      and the signal only appears past ~25k ticks. This row is
//                      correct for the length it was run at and wrong as a verdict.
//                      It is the clearest case in the project of rule 3 in
//                      ROADMAP.md: short runs lie.
//
// Tally: 3 selected and measured, 1 selected by structure, 2 unresolved, 1 not a
// gene, 31 drifting. `raid` is listed here as drift, which is not a contradiction
// of the l2Cost study above — that study found it selected among the level-2 genes
// against a level-3 control pool, and this one asks the harder question of whether
// it beats its own deleted-payoff arm, where it does not.
//
// THE MUTATION RATE. The standing hypothesis was that P.mut = 0.08 is too high for
// 38 dimensions. Swept at 6000 ticks, 4 seeds, each rate run as its own base and
// its own matched flocks-off control, with signal-to-noise defined as the size of
// the `sociality` effect divided by the between-seed sd of the drifting genes in
// the same runs — i.e. how visible the one real signal is against the noise the
// rest of the genome is making:
//
//   P.mut   pop         sociality base    sociality ctrl   effect   pool sd   S/N
//   0.02    344 +- 42   0.434 +- 0.036    0.565 +- 0.030   -0.130    0.017    7.6
//   0.04    339 +- 35   0.418 +- 0.021    0.575 +- 0.054   -0.157    0.016    9.8
//   0.08    344 +- 90   0.366 +- 0.047    0.531 +- 0.034   -0.166    0.022    7.5
//   0.16    300 +- 29   0.344 +- 0.032    0.539 +- 0.057   -0.195    0.037    5.3
//
// The hypothesis is half right. Signal-to-noise peaks at 0.04 and 0.16 is clearly
// worse — it also costs 13% of the population — so the shipped 0.08 is on the high
// side and gives up roughly a quarter of the achievable ratio. But the effect size
// itself grows monotonically with the rate; what degrades at high rates is the
// noise, not the signal, so the gain from halving P.mut is modest and it is bought
// by making every lineage change more slowly, which is a thing a player watches
// for. Two honest caveats before anyone acts on this table: it is measured at 6000
// ticks, so it is a rate of approach and not an equilibrium, and it is measured on
// the one gene with a large effect, so it says nothing about rescuing the other 31.
// P.mut lives in state.js. This is a recommendation, not a change.
//
// TRIED AND REJECTED, so nobody spends the runtime again:
//   * Comparing a gene to its founding value. Rejected: the clamp midpoint is the
//     attractor, so every gene "rises" and the statistic is meaningless.
//   * The off-attractor distance as a selection statistic. Rejected: it conflates
//     selection with incomplete diffusion. `hoard` sits 5.5 sd below its attractor
//     at 30k purely because it was founded at 0.15 and has not finished diffusing;
//     its symmetric midpoint, where founding bias cancels, is 0.433 at z = -0.2.
//   * Reversion tests at 6000 ticks. Rejected: ~9 generations, no power.
//   * Multi-flag arms. Rejected: they change the population, and a different
//     ecology moves every gene (see the retracted `acuity` result).
//   * Longer runs as a substitute for a matched control. Rejected: between-seed sd
//     grows with run length faster than these effects do.
//
// PRUNING: THE CASE, WHICH IS NOT THE CASE ANYONE EXPECTED. The premise behind
// asking for this audit was that 38 dimensions dilute selection and that cutting
// dead genes would let the survivors breathe. The architecture says otherwise, and
// this is the most useful thing in the study. There is no shared budget being
// divided: each gene draws its own independent gaussian, and each pays its own
// separate line in metabolism(). Deleting twenty drifting genes would not raise
// the selection on `sociality` by one part in a thousand, because nothing those
// genes consume is taken from it. The binding constraint is the one the l2Cost
// sweep already found — a consequence worth a few percent of an energy budget is
// below this world's selection threshold no matter how few genes share the world.
// A gene earns its slot here by moving the body's whole income (where it goes:
// `sociality`; how fast and far: `speed`) or by being a badge others react to
// (`pattern`), not by adding a line item.
//
// So the recommendation is NOT to prune for statistical reasons; there are none.
// The short honest list, for a maintainer to decide on, is:
//   * `sexual` is the one field that is not a gene. It is a pure function of
//     `diet`, recomputed on every mutation and every recombination, and it can
//     never carry information. It is the strongest deletion candidate on clarity
//     grounds alone. Deleting it changes the 38-field serialisation and the
//     snapshot version, which is a cross-cutting change and not made here.
//   * `shape` and `hue` have no fitness reader worth the name, but both are what
//     makes lineages look different on screen, and that is a real job. Keep them;
//     just do not expect them to evolve toward anything.
//   * Three genes are charged a cost in metabolism() unconditionally while their
//     benefit is gated: `resist` (benefit needs plaguesOn, which SHIPS FALSE, so
//     by default every body pays upkeep on an immune system against a disease that
//     never arrives), `disperse` (benefit needs the gene above P.dispThresh = 0.5
//     and dispOn, while the cost is paid from the founding 0..0.12 upward) and
//     `ornament` (benefit is mate choice, which only omnivores use). The
//     measurements say the mismatch is far too small to matter — `resist` sits at
//     z = +0.3, indistinguishable from drift — so gating those costs is a
//     correctness and readability fix rather than a balance one, and it would
//     change the shipped world's metabolism, so it is left for a decision.
// ---------------------------------------------------------------------------
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
  // Level-2 upkeep. Each of these is gated on its own switch so that turning a
  // mechanic off removes its cost as well as its benefit, and none of them is a
  // free trait: paying for the commons, carrying a specialised body, keeping
  // watch on your neighbours' honesty and teaching your young all cost energy.
  // P.l2Cost is a research knob, not a game setting: it scales every line below at
  // once. It exists because "is this gene selected or is it drifting?" is a question
  // about the size of a fitness differential relative to mutational noise, and the
  // only way to answer it is to sweep the differential. Default 1.
  const l2 = P.l2Cost === undefined ? 1 : P.l2Cost;
  if(g.civic && P.villageOn) m += g.civic * 0.010 * l2;
  if(g.caste && P.labourOn) m += g.caste * 0.008 * l2;
  if(g.respect && P.propertyOn) m += g.respect * 0.009 * l2;
  if(g.fidelity && P.cultureVertOn) m += g.fidelity * 0.010 * l2;
  // P.tribalCoef exists only to settle a specific request from the tribe module
  // ("0.008 is too small for `tribal` to be under any selection at all; that
  // coefficient needs to be roughly an order of magnitude larger"). It is a
  // research knob on one line, in the same spirit as l2Cost. The answer it gives is
  // recorded in THE ASSORTMENT RESULT below; the shipped value is 0.008.
  if(g.tribal && P.tribeOn) m += g.tribal * (P.tribalCoef === undefined ? 0.008 : P.tribalCoef) * l2;
  // trade.js charged this itself until now, which made it the one level-2 gene
  // priced outside the common line. P.tradeNoExchange is that module's drift
  // control and has to suspend the cost as well as the payoff, or the control arm
  // is a pure-cost arm and measures the wrong thing.
  if(g.trade && P.tradeOn && !P.tradeNoExchange) m += g.trade * 0.006 * l2;
  // No level-3 line here, and that is deliberate rather than an omission. Every
  // level-2 gene is a standing disposition whose cost is paid whether or not the
  // occasion arises, so it belongs on the always-charged line. The level-3 genes
  // are not: carrying a rock costs only while a rock is carried, keeping a fire
  // costs only while one burns, holding a technique costs only while it is held.
  // Each module charges its own conditional cost at the moment the behaviour
  // happens. Do not add a flat per-gene charge here to "make it costly" — that
  // prices the disposition instead of the act, and it is exactly the shape of cost
  // the sweep below shows cannot be selected on anyway.
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
