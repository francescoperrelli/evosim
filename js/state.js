// Parameters, constants and shared world state (one object shared across modules)

// THE MUTATION RATE, RE-MEASURED. `mut` below is the per-gene mutation rate. The
// table in genome.js recommended halving it to 0.04 on the strength of a 6000-tick
// sweep that put signal-to-noise at 9.8 for 0.04 against 7.5 for 0.08. That sweep
// predates the damping work, and it ran on a world whose population swung far
// harder than this one's; the swing, not the mutation rate, was plausibly the
// dominant noise source. So it was re-run from scratch before anyone acted on it.
//
// Design: 4 rates x 5 seeds x 2 arms, 12000 ticks each, genome sampled every 200
// ticks from t=2400. The arms are the shipped flags (base) and the same run with
// flocksOn and pherOn off (ctrl), which is the matched control that gave the one
// large known signal in this project: `sociality` is selected downward, and with
// both of its readers deleted it has nothing to do but drift. The statistic is the
// per-seed base-minus-ctrl difference in mean `sociality`, averaged over seeds.
//
// THE DENOMINATOR IS THE POINT. Raising P.mut moves every gene faster, selected or
// not, so a raw displacement cannot compare rates -- at 0.02 everything moves less
// and the comparison is rigged. The denominator here is the null distribution of
// the *same statistic*: compute the across-seed mean base-minus-ctrl difference for
// each of 27 functionless genes and take its RMS. That quantity is centred on zero
// if nothing is selected, and it scales with P.mut automatically, which is exactly
// the correction the raw effect size needs. `terra` is NOT in the pool (it is
// selected past ~25k, per the caveat in genome.js), `mutRate` is not either (it
// steps at m*0.5 rather than m*1.3, so it is not on the same mutational scale), and
// neither is `hue` (it ignores P.mut entirely). S/N below is |effect| / that RMS;
// the CI is a 2000-draw bootstrap over seeds; rank is where `sociality` falls when
// all 28 genes are ordered by |paired t across seeds|, so 1/28 means the signal is
// the loudest thing in the genome and 13/28 means it is indistinguishable.
//
//   window 2.4-6k ticks (mean living generation ~3.0)
//   P.mut   pop        soc base   soc ctrl   effect   noise   S/N  [90% CI]   rank
//   0.02    339 +- 76    0.434      0.530    -0.096   0.012   7.9  [3.4,7.9]  1/28
//   0.04    322 +- 61    0.470      0.556    -0.086   0.016   5.4  [2.0,7.2]  1/28
//   0.08    310 +- 12    0.441      0.553    -0.112   0.018   6.2  [3.3,6.6]  1/28
//   0.16    262 +- 34    0.427      0.532    -0.105   0.032   3.3  [0.9,3.9]  6/28
//
//   window 6-12k ticks (mean living generation ~7.4)
//   0.02    359 +- 76    0.390      0.536    -0.146   0.030   4.8  [1.2,6.0]  3/28
//   0.04    380 +-121    0.432      0.552    -0.119   0.043   2.8  [0.3,4.1]  7/28
//   0.08    397 +- 59    0.354      0.558    -0.203   0.041   5.0  [2.3,6.7]  1/28
//   0.16    346 +- 42    0.310      0.479    -0.169   0.064   2.6  [1.3,3.7]  1/28
//
// THE 0.04 RESULT DOES NOT REPLICATE. It is not merely weaker; the contrast changes
// sign. Bootstrapping the difference in S/N over a jointly resampled seed set gives
// 0.04 minus 0.08 = -0.75, 90% CI [-2.67, 2.29], P(0.04 better) = 0.34 in the early
// window, and -2.22, CI [-4.24, 0.04], P = 0.06 in the late one. Matched on
// generations rather than ticks it is worse still: at 6 generations 0.04 scores 2.9
// and ranks 13/28, i.e. the signal cannot be told from the drifting genes at all,
// while 0.08 scores 6.0 at rank 1/28. 0.04 is also the least reproducible rate --
// the between-seed sd of its effect is 0.079 early and 0.215 late against 0.052 and
// 0.103 for 0.08 (F = 2.3 and 4.4 on 4,4 df), and it is one of only two rates where
// a seed comes out with the wrong sign (seed 53, +0.182). The old table's other
// claim, that the effect size grows monotonically with the rate, does not replicate
// either: -0.096 / -0.086 / -0.112 / -0.105 is flat, not a ramp.
//
// WHAT DOES REPLICATE IS THAT 0.16 IS WORSE, and that it costs population: 262
// against 310 at 0.08 in the early window, a 16% loss, matching the 13% the old
// table found. 0.08 beats 0.16 by 2.87 in S/N, CI [1.11, 2.94], P = 1.00 early and
// 2.36, CI [-0.29, 4.50], P = 0.92 late -- the only contrast in the sweep whose
// interval clears zero. 0.02 and 0.08 are indistinguishable (+1.73, CI [-1.97,
// 2.00] then -0.15, CI [-2.89, 1.65]). The shape of the curve is therefore a
// plateau from 0.02 to 0.08 with a cliff after it, not a peak at 0.04.
//
// TRIED TO KILL THE 0.16 RESULT, FAILED, BUT ONE THING SURVIVES. (a) The arms are
// not population-matched -- base runs 15-26% smaller than ctrl at every rate -- so
// some of the effect is ecology rather than selection. But the shared component of
// the 27 control genes' shift is only -0.002 to -0.018, between a seventh and
// seven tenths of their scatter, and subtracting it moves S/N by less than 0.25 at
// every rate. Not the explanation. (b) A saturated control pool would flatter the
// high rates, not penalise them; the pool sits at 0.18 / 0.19 / 0.21 / 0.28 early
// and 0.19 / 0.20 / 0.27 / 0.37 late, all well short of the 0.5 attractor, and its
// between-seed sd is still growing at every rate. Nothing has saturated. (c) Rates
// differ in generations per tick (maxGen at 12k runs 15.7 to 23.5), so the whole
// analysis was redone at matched generation; the ordering holds. What survives, and
// is the honest weak point of this entry: under a *different* denominator the sign
// flips. The paired t across seeds is largest of all four rates at 0.16 in the late
// window (-8.97, against -4.42 for 0.08) precisely where S/N is smallest. At 0.16
// the effect is the most reproducible across seeds and simultaneously the least
// distinguishable from what 27 functionless genes are doing in the same runs. Both
// statements are true; the doctrine of this project -- a gene moving is not
// evidence unless a functionless gene in the same run moves less -- says the
// control-gene denominator is the one to believe, so 0.16 is judged worse. Anyone
// who disagrees with that doctrine should read this entry as a null result.
//
// NOT SHOWN: anything about a gene other than `sociality`; anything past 12000
// ticks, which is ~7 living generations and well short of the ~25k where `terra`
// turned out to be selected; whether the rates between 0.04 and 0.08 do something
// the endpoints do not; and whether 0.16's population cost is separable from its
// noise cost. Five seeds is enough to reject the old 0.04 recommendation and not
// enough to resolve 0.02 against 0.08.
//
// RECOMMENDATION: leave `mut` at 0.08 and delete the 0.04 recommendation from
// anyone's plans. The claimed gain was a measurement artefact of the pre-damping
// world. Do not go to 0.16. This is a finding, not a change.

// Tunable ecosystem parameters
export const P = {
  herbStart:200, carnStart:24, omniStart:44, maxPop:1400,
  maxFood:900, foodEnergy:24, foodRate:4, mut:0.08, preyEnergy:82,
  herbReproE:120, herbStartE:70, herbMaxAge:2600,
  omniReproE:140, omniStartE:85, omniMaxAge:2800,
  carnReproE:255, carnStartE:150, carnMaxAge:3200,
  seasonLength:3600, dayLength:1400, sexSel:1.4, planetCount:4, dispThresh:0.5, herdBrain:8, husbandThresh:0.06,
  predatorsOn:true, omnivoresOn:true, flocksOn:true, terrOn:true, mimicOn:true, seasonsOn:true, dayNightOn:true, bubblesOn:true, pherOn:true, cultureOn:true, learnOn:true, nestsOn:true, plaguesOn:false, migrateOn:true, hoardOn:true, buildOn:true, dispOn:true, husbandOn:true,
  // presentation + stability switches
  stableOn:true,      // density-dependent damping of the boom-bust cycle
  starsOn:true,       // starfield / nebula in the void
  lightsOn:true,      // real directional lighting instead of a flat night wash
  fxOn:true,          // particles, birth/death animations, motion trails
  // level-1 evolution mechanics
  lifeHistOn:true,    // r/K life-history strategies (the `pace` gene)
  evolvOn:true,       // evolvable mutation rate + gene/neuron duplication
  floraOn:true,       // plant genomes: chemical defence vs. herbivore detoxification
  speciesOn:true,     // reproductive isolation -> speciation + phylogeny
  specThresh:0.42,    // genetic distance above which two lineages stop interbreeding
  // level-2 civilisation mechanics
  villageOn:true,     // co-located shelters coalesce into maintained settlements
  labourOn:true,      // polyethism: forager / guard / nurse roles inside a settlement
  // How loudly the evolved brain speaks against the innate steering prior. These
  // were fixed constants; they are knobs because the question "does anything a body
  // learns in its life reach its legs?" cannot be asked without sweeping them, and
  // until the brain-output frame was fixed the answer was structurally no.
  brainW:0.7, innateW:1.25,
  propSteer:true,      // the non-kin cache pull is a steering force in world.js, not a private walk
  propertyOn:true,    // raiding a granary vs. respecting it, and punishing raiders
  propertyPunish:true,// the second-order half of it: whether respecters pay to punish raiders
  cultureVertOn:true, // parents teach children what they learned, with a fidelity gene
  tradeOn:true,       // a second resource (minerals) and exchange between neighbours
  tribeOn:true,       // group markers, coalitions and intergroup conflict
  // level-3 technology mechanics
  toolsOn:true,       // rocks carried and used to open what a bare mouth cannot
  fireOn:true,        // burning ground: a cost now against fertility much later
  marksOn:true,       // marks that carry content, and the conventions they settle into
  techOn:true,        // capabilities acquired from neighbours, kept at a price, lost when untaught
  terraOn:true        // improving the ground, and what diverged planets do when they meet again
};

// Per-species configuration. `hunts` = types this species preys on.
export const TYPES = {
  herb:{ hueC:115, hueSpan:40, reproE:'herbReproE', startE:'herbStartE', maxAge:'herbMaxAge',
         baseMeta:0.05, eatsPlants:true, hunts:[], terr:false, social:true, plantEff:1.0, preyEff:0, sexual:false, dietLo:0.03, dietHi:0.30 },
  omni:{ hueC:272, hueSpan:20, reproE:'omniReproE', startE:'omniStartE', maxAge:'omniMaxAge',
         baseMeta:0.064, eatsPlants:true, hunts:['herb'], terr:false, social:true, plantEff:0.81, preyEff:0.73, sexual:true, dietLo:0.40, dietHi:0.60 },
  carn:{ hueC:18, hueSpan:24, reproE:'carnReproE', startE:'carnStartE', maxAge:'carnMaxAge',
         baseMeta:0.09, eatsPlants:false, hunts:['herb','omni'], terr:true, social:false, plantEff:0, preyEff:1.0, sexual:false, dietLo:0.72, dietHi:0.97 }
};
// Diet is a continuous gene [0..1]; the feeding "band" (species) is derived from it.
export function typeOf(diet){ return diet < 0.34 ? 'herb' : diet < 0.67 ? 'omni' : 'carn'; }
// Predators of each type (computed from `hunts`)
export const PREDATORS = {};
for(const T in TYPES){ PREDATORS[T] = []; }
for(const T in TYPES){ for(const prey of TYPES[T].hunts){ if(PREDATORS[prey]) PREDATORS[prey].push(T); } }

// Behaviour constants
export const BRAIN_W = 0.7;
export const INNATE_W = 1.25;
export const NEIGH_R = 58, NEIGH_R2 = NEIGH_R * NEIGH_R;
export const SEP_R = 15, SEP_R2 = SEP_R * SEP_R;
export const CELL = 175;          // spatial-grid cell (>= max sense radius)
export const MAX_ZOOM = 2.5;

export const SAVE_KEY = 'evosim_save_v8';
export const LANG_KEY = 'evosim_lang';

// Seasons: returns { idx 0..3, name key, foodMult, phase }
const SEASON_KEYS = ['spring','summer','autumn','winter'];
export function seasonInfo(tick){
  const L = P.seasonLength, f = (tick % L) / L;          // 0..1 through the year
  const idx = Math.floor(f * 4) % 4;
  const foodMult = P.seasonsOn ? (0.78 + 0.6 * Math.sin(f * Math.PI * 2 - Math.PI / 2)) : 1;
  return { idx, key: SEASON_KEYS[idx], foodMult: Math.max(0.15, foodMult), phase: f };
}

// Day/night: light in [0..1] (1 = full day), plus a night flag
export function dayInfo(tick){
  const f = (tick % P.dayLength) / P.dayLength;           // 0..1 through the day
  const light = 0.5 + 0.5 * Math.sin(f * Math.PI * 2 - Math.PI / 2);   // 0 at midnight, 1 at noon
  return { f, light, night: light < 0.35 };
}

// Mutable world state (single shared object)
export const S = {
  creatures: [], food: [],
  tick: 0, predations: 0, maxGen: 0, seed: 0,
  running: true, stepsPerFrame: 1,
  W: 0, H: 0,                 // viewport (screen) size in CSS px
  worldW: 0, worldH: 0,       // logical world size (larger than viewport)
  cam: { x: 0, y: 0, zoom: 1 },
  ID: 1,
  popHist: [], traitHist: [], evoHist: [], ornHist: [], behHist: [], dataLog: [],
  records: { oldestAge: 0, maxKids: 0, maxGen: 0 },
  selected: null, tool: 'plant',        // 'plant' | 'inspect' | 'meteor' | 'rock' | 'water'
  drought: 0, effects: [], parts: [], flights: [], rocks: [], water: [], biomes: [], nests: [], caches: [], shelters: [], planets: [], colonized: [],
  challenge: null, shares: 0, packKills: 0, tamedEver: false,
  chronicle: [], chronPrev: null,
  // phylogeny: species records maintained by phylo.js, read by the tree view.
  // Each record: { id, parent, born, died, n, peak, type, hue, cx, cy }
  phylo: [], speciesN: 0,
  // level-3 technology state, each owned by its own module
  shells: [], cracked: 0,        // tools.js: hard-shelled food, and openings counted
  fires: [], scars: [], burns: 0,// fire.js: burning fronts, the ground they left, ignitions counted
  marks: [],                     // marks.js: deposits that carry content
  techPeak: 0,                   // tech.js: deepest any lineage has ever reached
  terra: [],                     // terra.js: patches of improved ground
  // level-2 civilisation state, each owned by its own module
  villages: [],       // village.js: settlements grown from clustered shelters
  minerals: [],       // trade.js: the second resource
  trades: 0,          // trade.js: running count of completed exchanges
  tribes: [],         // tribe.js: coalition records
  culture: null,      // culture.js: cumulative-culture bookkeeping
  thefts: 0, punishments: 0,   // property.js: running counts
  // emergent-lexicon meter: how each of the 3 signal channels correlates with
  // context (threat / prey / food / crowd), measured live from the population
  lex: null,
  // regional dialects: per-lineage average "accent" (signal vector) measured in a
  // shared reference context (idle chatter among neighbours), keyed by lineage id
  dialect: {}
};
export function newLex(){
  return { s: [0, 0, 0], n: 0, ctx: [ { s: [0, 0, 0], n: 0 }, { s: [0, 0, 0], n: 0 }, { s: [0, 0, 0], n: 0 }, { s: [0, 0, 0], n: 0 } ] };
}

// Camera helpers
export function minZoom(){ return Math.max(S.W / (S.worldW || 1), S.H / (S.worldH || 1), 0.05); }
export function clampCam(){
  const z = S.cam.zoom = Math.min(MAX_ZOOM, Math.max(minZoom(), S.cam.zoom));
  const viewW = S.W / z, viewH = S.H / z;
  S.cam.x = Math.min(Math.max(0, S.cam.x), Math.max(0, S.worldW - viewW));
  S.cam.y = Math.min(Math.max(0, S.cam.y), Math.max(0, S.worldH - viewH));
}
export function zoomAt(sx, sy, factor){
  const wx = S.cam.x + sx / S.cam.zoom, wy = S.cam.y + sy / S.cam.zoom;
  S.cam.zoom = Math.min(MAX_ZOOM, Math.max(minZoom(), S.cam.zoom * factor));
  S.cam.x = wx - sx / S.cam.zoom; S.cam.y = wy - sy / S.cam.zoom;
  clampCam();
}
export const screenToWorld = (sx, sy) => ({ x: S.cam.x + sx / S.cam.zoom, y: S.cam.y + sy / S.cam.zoom });
