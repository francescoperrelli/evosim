// Parameters, constants and shared world state (one object shared across modules)

// Tunable ecosystem parameters
export const P = {
  herbStart:70, carnStart:8, omniStart:10, maxPop:460,
  maxFood:340, foodEnergy:24, foodRate:4, mut:0.08, preyEnergy:82,
  herbReproE:120, herbStartE:70, herbMaxAge:2600,
  omniReproE:165, omniStartE:90, omniMaxAge:2800,
  carnReproE:255, carnStartE:150, carnMaxAge:3200,
  seasonLength:3600,
  predatorsOn:true, omnivoresOn:true, flocksOn:true, terrOn:true, mimicOn:true, seasonsOn:true
};

// Per-species configuration. `hunts` = types this species preys on.
export const TYPES = {
  herb:{ hueC:115, hueSpan:40, reproE:'herbReproE', startE:'herbStartE', maxAge:'herbMaxAge',
         baseMeta:0.05, eatsPlants:true, hunts:[], terr:false, social:true, plantEff:1.0, preyEff:0 },
  omni:{ hueC:272, hueSpan:20, reproE:'omniReproE', startE:'omniStartE', maxAge:'omniMaxAge',
         baseMeta:0.076, eatsPlants:true, hunts:['herb'], terr:false, social:true, plantEff:0.63, preyEff:0.66 },
  carn:{ hueC:18, hueSpan:24, reproE:'carnReproE', startE:'carnStartE', maxAge:'carnMaxAge',
         baseMeta:0.09, eatsPlants:false, hunts:['herb','omni'], terr:true, social:false, plantEff:0, preyEff:1.0 }
};
// Predators of each type (computed from `hunts`)
export const PREDATORS = {};
for(const T in TYPES){ PREDATORS[T] = []; }
for(const T in TYPES){ for(const prey of TYPES[T].hunts){ if(PREDATORS[prey]) PREDATORS[prey].push(T); } }

// Behaviour constants
export const BRAIN_W = 0.7;
export const INNATE_W = 1.25;
export const NEIGH_R = 58, NEIGH_R2 = NEIGH_R * NEIGH_R;
export const SEP_R = 15, SEP_R2 = SEP_R * SEP_R;

export const SAVE_KEY = 'evosim_save_v4';
export const LANG_KEY = 'evosim_lang';

// Seasons: returns { idx 0..3, name key, foodMult, phase }
const SEASON_KEYS = ['spring','summer','autumn','winter'];
export function seasonInfo(tick){
  const L = P.seasonLength, f = (tick % L) / L;          // 0..1 through the year
  const idx = Math.floor(f * 4) % 4;
  const foodMult = P.seasonsOn ? (0.78 + 0.6 * Math.sin(f * Math.PI * 2 - Math.PI / 2)) : 1;
  return { idx, key: SEASON_KEYS[idx], foodMult: Math.max(0.15, foodMult), phase: f };
}

// Mutable world state (single shared object)
export const S = {
  creatures: [], food: [],
  tick: 0, predations: 0, maxGen: 0,
  running: true, stepsPerFrame: 1,
  W: 0, H: 0, ID: 1,
  popHist: [], traitHist: [],
  selected: null, inspectMode: false
};
