// Flora: plants as an evolving population rather than inert energy pellets.
//
// Contract used by world.js and render.js — these exports are the whole
// public surface and their signatures are fixed:
//
//   plantGenome(parent)  -> object merged onto a new food item at {x, y}.
//                           `parent` is an existing plant to inherit from, or
//                           null/undefined for a founder. MUST use rand()/gauss()
//                           from utils.js only, so the world stays deterministic.
//   bite(c, f)           -> { gain, harm }  energy the eater gets, energy the
//                           plant's chemistry takes back. world.js applies both.
//   plantStyle(f)        -> { hue, sat, light, r } for render.js.
//   floraTick()          -> per-step plant dynamics (called once per world step).
//   floraReset()         -> clear any module-local state (called from seed/restore).
//   packPlant(f) / unpackPlant(a)  -> save-file encoding of the heritable fields.
//
// The biology
// -----------
// A plant cannot run, so its only answer to being eaten is chemistry. `tox` is a
// single allocation locus: what the plant spends on defence it cannot spend on
// growth. Defence buys survival — a grazer that cannot stomach a mouthful spits
// it out and the rootstock resprouts — and it costs seed set and standing life,
// so where nothing grazes, the cheap palatable plants win. The herbivores' reply
// is `detox`, which carries its own metabolic upkeep (see genome.js), so it is
// only worth carrying as much of it as the local flora demands. Neither side can
// win outright: full defence is only useful against grazers that lack the liver
// for it, and a liver is only useful against plants that are actually defended.
//
// Plants are sessile, so inheritance is local: a seed landing on the ground takes
// its chemistry from a plant already standing in the same patch. Grazing therefore
// edits the local gene pool, and heavily grazed ground grows its own defended
// strain while ungrazed ground stays soft — the arms race runs patch by patch.

import { P, S, TYPES } from './state.js';
import { rand, rnd, clamp, gauss } from './utils.js';

const PCELL = 200;        // patch size for local inheritance (a seed's neighbourhood)
const REGRID = 6;         // ticks between rebuilds of the patch index
const PMUT = 0.030;       // fine drift of expression level per plant generation
const LOSS = 0.16;        // rate at which a seed breaks an enzyme in the defence pathway
const LOSSE = 0.50;       // ...and how much of the pathway one break costs
const GAIN = 0.030;       // far rarer: a duplicated gene lengthens the pathway
const GAINE = 0.55;       // ...but a gain is a big one when it happens
const HMUT = 3.2;         // drift of the neutral marker locus (degrees of hue)
const LIFE = 8000;        // ticks an undefended plant stands before it senesces
const LIFE_TOX = 0.35;    // defence shortens that standing life by up to this much
const FEC_TOX = 0.85;     // ...and cuts seed set by up to this much, accelerating
const SOFT = 0.27;        // no liver is perfect: this much toxin always gets through
const TOUGH = 0.03;       // share of defence that is bulk fibre, not chemistry
const RESPROUT = 0.95;    // chance an unstomachable mouthful is cropped, not killed
const RDIM = 0.28;        // sharply diminishing returns: a trace of alkaloid does most of the work
const REGROW = 34;        // ticks a cropped rootstock takes to put up leaves again
const GAIN_LOSS = 0.65;   // share of the meal an unneutralised toxin ruins
const HARM = 0.65;        // ...plus this share of a meal paid back as poisoning
const MAXREG = 800;       // ceiling on rootstocks waiting to resprout

let grid = null, gcols = 0, grows = 0;   // patch index: standing plants by cell
let regrow = [];                          // cropped rootstocks, waiting to releaf
let meanTox = 0;                          // standing crop's mean defence

// Rebuild the patch index. Buckets are reused rather than reallocated, because
// this runs over the whole standing crop (thousands of plants) as the world grows.
function rebuild(){
  const cols = Math.max(1, Math.ceil((S.worldW || 1700) / PCELL));
  const rows = Math.max(1, Math.ceil((S.worldH || 1050) / PCELL));
  if(!grid || gcols !== cols || grows !== rows){ gcols = cols; grows = rows; grid = new Array(cols * rows); }
  for(let i = 0; i < grid.length; i++){ const b = grid[i]; if(b) b.length = 0; }
  for(const f of S.food){
    if(f.nw || f.eaten) continue;
    const cx = clamp(Math.floor(f.x / PCELL), 0, gcols - 1), cy = clamp(Math.floor(f.y / PCELL), 0, grows - 1);
    const i = cy * gcols + cx;
    (grid[i] || (grid[i] = [])).push(f);
  }
}

// Draw the plant a seed inherits from: one of the neighbours already standing on
// this ground. Seed set falls with defence investment, so a well-defended plant is
// rejected more often — the chemistry it builds is seed it never set. The cost is
// quadratic, not linear: a trace of alkaloid is nearly free, while saturating the
// whole leaf with it starves the flowers. That is what stops toxicity ratcheting
// to its bound — the benefit saturates while the price keeps accelerating.
function pickParent(x, y){
  if(!grid) return null;
  const cx = clamp(Math.floor(x / PCELL), 0, gcols - 1), cy = clamp(Math.floor(y / PCELL), 0, grows - 1);
  let b = grid[cy * gcols + cx];
  if(!b || !b.length){
    // bare ground: the seed takes its chemistry from the nearest standing patch
    b = null;
    for(let dy = -1; dy <= 1 && !b; dy++) for(let dx = -1; dx <= 1; dx++){
      const nx = cx + dx, ny = cy + dy;
      if(nx < 0 || ny < 0 || nx >= gcols || ny >= grows) continue;
      const nb = grid[ny * gcols + nx];
      if(nb && nb.length){ b = nb; break; }
    }
  }
  if(!b || !b.length) return null;
  let p = null;
  for(let t = 0; t < 5; t++){
    const q = b[(rand() * b.length) | 0];
    if(q.eaten) continue;                                   // grazed since the index was built
    p = q;
    if(rand() > FEC_TOX * q.tox * q.tox) return q;
  }
  return p;
}

// Give a seed its chemistry once world.js has put it on the ground.
function germinate(f){
  const par = pickParent(f.x, f.y);
  if(par){
    // A defence pathway is a chain of enzymes, and mutation breaks a chain far more
    // often than it lengthens one. Losses are common and each costs half the
    // chemistry; gains are rare but large. Left unselected the pathway rots away —
    // island floras that grew up without herbivores really are defenceless — while
    // the rare big gains keep enough well-defended plants standing in every patch
    // for grazing to have something to select on.
    let t = par.tox;
    if(rand() < LOSS) t *= 1 - LOSSE;
    else if(rand() < GAIN) t += rand() * GAINE;
    f.tox = clamp(t + gauss() * PMUT, 0, 1);
    f.hue = clamp((par.hue || 0) + gauss() * HMUT, -16, 16);
  } else {
    // a pioneer colonising bare ground: colonisers grow fast and undefended
    f.tox = rand() * 0.08;
    f.hue = rnd(-10, 10);
  }
  f.age = 0; f.life = LIFE * (1 - LIFE_TOX * f.tox); f.nw = 0; f.eaten = 0;
}

export function plantGenome(parent){
  if(parent) return { tox: parent.tox || 0, hue: parent.hue || 0, age: 0, life: parent.life || LIFE, nw: 0, eaten: 0 };
  // world.js has not placed the seed yet when it asks for this, so the neighbours
  // it will land among are still unknown. The seed carries the standing crop's
  // average chemistry until floraTick finds it a parent one step later.
  return { tox: meanTox, hue: 0, age: 0, life: LIFE, nw: 1, eaten: 0 };
}

export function bite(c, f){
  const base = P.foodEnergy * TYPES[c.type].plantEff;
  f.eaten = 1;
  const tox = f.tox > 0 ? f.tox : 0;
  if(P.floraOn === false || tox <= 0) return { gain: base, harm: 0 };
  // The grazer's liver neutralises toxin up to its own capacity, but no liver is
  // perfect: SOFT smooths the match into a soft threshold rather than a cliff, so a
  // slightly-better-defended plant is always slightly harder to eat. A hard cliff
  // would put a fitness valley in front of any plant whose neighbours' grazers have
  // already out-evolved it, and defence could never get started.
  const d = tox - (c.g.detox || 0);
  const load = 0.5 * (d + Math.sqrt(d * d + SOFT * SOFT));
  // A mouthful it cannot stomach is spat out: the rootstock survives the visit and
  // resprouts, so chemistry buys the plant its life rather than fewer visits. Almost
  // all of that defence is chemistry a grazer can evolve to handle — only the sliver
  // TOUGH is fibre and spines that no liver helps with — so the benefit is earned
  // against the local grazers, not banked once and kept. Returns diminish sharply:
  // the first trace of a bitter alkaloid does most of the work of putting a grazer
  // off, while the price of making it keeps accelerating.
  const def = TOUGH * tox + (1 - TOUGH) * load;
  if(rand() < RESPROUT * Math.pow(def, RDIM) && regrow.length < MAXREG)
    regrow.push({ x: f.x, y: f.y, tox: tox, hue: f.hue || 0, t: S.tick + REGROW });
  return { gain: base * (1 - GAIN_LOSS * load), harm: base * HARM * load };
}

// Cached, quantised styles: the renderer calls this once per visible plant every
// frame, so it allocates nothing and returns one of ~30 shared objects — identical
// references can be used directly as a batching key. Callers must not mutate it.
const STYLES = [];
export function plantStyle(f){
  const t = f && f.tox > 0 ? (f.tox < 1 ? f.tox : 1) : 0;
  const tb = (t * 5 + 0.5) | 0;                                    // 6 defence bands
  const hq = f ? Math.round(clamp(f.hue || 0, -16, 16) / 8) : 0;    // 5 marker bands
  const k = tb * 5 + hq + 2;
  let s = STYLES[k];
  if(!s){
    const q = tb / 5;
    // defended foliage turns waxy and blue-green, darker and coarser than the soft
    // light green of a plant that spends everything it has on growing
    STYLES[k] = s = { hue: 96 + 62 * q + hq * 8, sat: 62 - 12 * q, light: 46 - 9 * q, r: 2.6 + q };
  }
  return s;
}

export function floraTick(){
  const food = S.food;
  let sum = 0, n = 0;
  for(let i = food.length - 1; i >= 0; i--){
    const f = food[i];
    if(f.nw || f.life === undefined) germinate(f);           // seeds, and plants placed by hand
    else if(++f.age > f.life){
      // senescence: a defended leaf is expensive to build and cannot be held as
      // long, so on ground nothing grazes the cheap plants simply outlive the toxic ones
      food[i] = food[food.length - 1]; food.pop(); continue;
    }
    sum += f.tox; n++;
  }
  meanTox = n ? sum / n : 0;

  // cropped rootstocks put up new leaves with the same chemistry — a grazed toxic
  // plant is a survivor, not a casualty, and that is what defence is for
  if(regrow.length){
    const cap = P.maxFood * (S.planets.length || 1) * 1.15;
    for(let i = regrow.length - 1; i >= 0; i--){
      const r = regrow[i];
      if(S.tick < r.t) continue;
      regrow[i] = regrow[regrow.length - 1]; regrow.pop();
      if(food.length < cap)
        food.push({ x: r.x, y: r.y, tox: r.tox, hue: r.hue, age: 0, life: LIFE * (1 - LIFE_TOX * r.tox), nw: 0, eaten: 0 });
    }
  }

  if(!grid || S.tick % REGRID === 0) rebuild();
}

export function floraReset(){ grid = null; gcols = grows = 0; regrow.length = 0; meanTox = 0; }

export function packPlant(f){
  return [+f.x.toFixed(1), +f.y.toFixed(1), f.tox > 0 ? +f.tox.toFixed(3) : 0,
          Math.round(f.hue || 0), Math.round((f.age || 0) / 32)];
}

export function unpackPlant(a){
  // tolerates the old [x, y] encoding, where every plant was an undefended pellet
  const tox = a[2] || 0;
  return { x: a[0], y: a[1], tox, hue: a[3] || 0, age: (a[4] || 0) * 32,
           life: LIFE * (1 - LIFE_TOX * tox), nw: 0, eaten: 0 };
}
