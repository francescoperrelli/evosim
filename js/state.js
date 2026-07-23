// Parametri, costanti e stato del mondo (oggetto condiviso tra i moduli)

// Parametri regolabili dell'ecosistema
export const P = {
  herbStart:70, carnStart:9, maxPop:420,
  maxFood:340, foodEnergy:24, foodRate:4, mut:0.08,
  herbReproE:120, herbStartE:70, herbMaxAge:2600,
  carnReproE:255, carnStartE:150, carnMaxAge:3200, preyEnergy:82,
  predatorsOn:true, flocksOn:true, terrOn:true, mimicOn:true
};

// Costanti di comportamento
export const BRAIN_W = 1.0;      // peso dell'output del cervello
export const INNATE_W = 0.75;    // peso dell'istinto (prior)
export const NEIGH_R = 58, NEIGH_R2 = NEIGH_R * NEIGH_R;   // raggio del branco
export const SEP_R = 15, SEP_R2 = SEP_R * SEP_R;           // raggio di separazione

export const SAVE_KEY = 'evosim_save_v3';
export const LANG_KEY = 'evosim_lang';

// Stato mutabile del mondo (un unico oggetto condiviso)
export const S = {
  creatures: [], food: [],
  tick: 0, predations: 0, maxGen: 0,
  running: true, stepsPerFrame: 1,
  W: 0, H: 0, ID: 1,
  popHist: [], traitHist: []
};
