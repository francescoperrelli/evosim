// Recurrent neural network with an EVOLVABLE hidden-layer size.
// A brain is { nh, w }: nh hidden neurons and a flat weight array `w`,
// laid out hidden-major so neurons can be added/removed by mutation.
// Two outputs feed back as memory, giving each creature short-term memory.
import { clamp, gauss, rand } from './utils.js';
import { P } from './state.js';

// Inputs (20): food fwd/lat/pres, prey fwd/lat/pres, threat fwd/lat/pres,
//              neighbour fwd/lat/density, energy, season, mem0, mem1,
//              heard-signal x3 (a small evolvable "vocabulary"), bias
// Outputs (7): moveX, moveY, mem0, mem1, signal0/1/2 (three broadcast channels)
export const NCHAN = 3;                 // number of communication channels
export const NIN = 20, NOUT = 7, NMEM = 2;
export const IN_HEARD = 16;             // heard channels occupy inputs 16..16+NCHAN-1
export const OUT_SIG = 4;               // signal channels occupy outputs 4..4+NCHAN-1
export const MIN_NH = 4, MAX_NH = 24;

// previous topology (single signal channel) — kept for migrating old saved brains
const NIN_OLD = 18, NOUT_OLD = 5;
export const brainLenOld = nh => nh * NIN_OLD + nh + nh * NOUT_OLD + NOUT_OLD;
// remap a v8 brain (18 in / 5 out) into the new 20 in / 7 out layout,
// preserving every learned weight and seeding the two new channels faintly.
export function migrateBrain(nh, wOld){
  const b1o = nh * NIN_OLD, w2o = nh * NIN_OLD + nh, b2o = nh * NIN_OLD + nh + nh * NOUT_OLD;
  const w = new Array(brainLen(nh)); let p = 0;
  for(let j = 0; j < nh; j++){                     // input->hidden
    const base = j * NIN_OLD;
    for(let i = 0; i < 16; i++) w[p++] = wOld[base + i];  // 0..15 unchanged
    w[p++] = wOld[base + 16];                             // heard0 <- old heard
    w[p++] = gauss() * 0.2; w[p++] = gauss() * 0.2;       // heard1, heard2 (new)
    w[p++] = wOld[base + 17];                             // bias(19) <- old bias(17)
  }
  for(let j = 0; j < nh; j++) w[p++] = wOld[b1o + j];     // hidden bias (unchanged)
  for(let j = 0; j < nh; j++){                     // hidden->output
    const base = w2o + j * NOUT_OLD;
    for(let k = 0; k < 5; k++) w[p++] = wOld[base + k];   // move,mem,sig0
    w[p++] = gauss() * 0.2; w[p++] = gauss() * 0.2;       // sig1, sig2 (new)
  }
  for(let k = 0; k < 5; k++) w[p++] = wOld[b2o + k];      // output bias 0..4
  w[p++] = gauss() * 0.2; w[p++] = gauss() * 0.2;         // sig1, sig2 bias
  return { nh, w };
}

// weight layout for a given hidden size (hidden-major):
//   [0 .. nh*NIN)          input->hidden, neuron j inputs contiguous at j*NIN
//   [nh*NIN .. +nh)        hidden bias
//   [.. +nh*NOUT)          hidden->output, neuron j outputs at j*NOUT
//   [.. +NOUT)             output bias
export const brainLen = nh => nh * NIN + nh + nh * NOUT + NOUT;

export function randomBrain(){
  const nh = 6 + (rand() * 5 | 0);   // 6..10 to start
  const len = brainLen(nh), w = new Array(len);
  for(let i = 0; i < len; i++) w[i] = gauss() * 0.45;
  return { nh, w };
}

// split a brain's weight array into its four sections
function sections(b){
  const nh = b.nh, w = b.w;
  return {
    W1: w.slice(0, nh * NIN),
    B1: w.slice(nh * NIN, nh * NIN + nh),
    W2: w.slice(nh * NIN + nh, nh * NIN + nh + nh * NOUT),
    B2: w.slice(nh * NIN + nh + nh * NOUT)
  };
}
// Growing the brain by one hidden neuron.
//
// THIS IS THE DESIGN INTENT, WRITTEN BEFORE IT WAS MEASURED. Read it together
// with THE DUPLICATION AUDIT below, which tests it against its own control and
// disproves the second half of it. The sentences marked [1]..[4] are the ones
// the audit contradicts; they are left standing, and marked, because the design
// they describe is still the design — it just does not do what it claims.
//
// Inventing a neuron from scratch (the `else` branch) drops a random function
// into a working circuit, so it is almost always harmful the moment it appears
// and selection removes it before it can ever be refined. [1] Real genomes do not
// gain parts that way: they gain them by DUPLICATION, and the duplicate is
// retained precisely because it changes nothing at first.
//
// So with evolvability on we copy an existing neuron instead. What is copied is
// the thing that took selection a long time to build: the duplicate's INCOMING
// weights and bias are inherited from its template, so it already computes a
// feature the lineage has been rewarded for detecting. What it does not inherit
// is a voice — its outgoing weights start at ~0, so it is silent on arrival and
// the circuit behaves exactly as it did before. The lineage pays only the
// metabolic cost of the extra unit, so selection has no reason to remove it, [2] and
// a single later mutation on one outgoing weight recruits a ready-made detector
// to a new job. [3] That is what makes duplicates a cheaper source of function than
// invention: [4] the `else` branch has to random-walk a whole 20-dimensional input
// filter into something meaningful, which essentially never happens.
//
// The template is deliberately left untouched. Sharing the output between the
// twins instead (halving the original's outgoing weights, the classic dosage
// model) is also exactly neutral on arrival, but it was measurably WORSE than
// random invention here — a redundant twin adds no new feature to a hidden layer,
// and every later deletion of one twin tears the shared function in half.
//
// P.dupMode is a research knob, not a game setting, and it exists only so the
// claims above have a control. Leave it undefined and this function is the shipped
// path, bit for bit — verified by fingerprinting 3 seeds x 3000 ticks against
// `git show <base>:js/nn.js` and getting the same hash, population, generation and
// creature-id counts. The three arms consume an IDENTICAL random stream (one
// rand() for `j`, then 20 + 7 + 1 gauss() in that order), so they are PRNG-paired
// at every structural event and differ only in what the drawn numbers are used
// for. 'dup' inherits filter and bias and arrives silent; 'invent' is the `else`
// branch's recipe run inside the evolvOn arm (random filter at 0.2, loud voice at
// 0.2); 'silent' is the decomposition arm — random filter, silent voice — which
// separates "inherits an evolved feature detector" from "arrives quiet".
function addNeuron(b){
  const s = sections(b);
  if(P.evolvOn){
    const mode = P.dupMode === undefined ? 'dup' : P.dupMode;   // research knob; see THE DUPLICATION AUDIT
    const dup = mode === 'dup', loud = mode === 'invent';
    const j = rand() * b.nh | 0;                 // the template neuron
    const newW1 = new Array(NIN), newW2 = new Array(NOUT);
    for(let i = 0; i < NIN; i++) newW1[i] = dup ? s.W1[j * NIN + i] + gauss() * 0.03 : gauss() * 0.2;
    for(let k = 0; k < NOUT; k++) newW2[k] = loud ? gauss() * 0.2 : gauss() * 0.02;
    const nb1 = dup ? s.B1[j] + gauss() * 0.03 : gauss() * 0.2;
    return { nh: b.nh + 1, w: [...s.W1, ...newW1, ...s.B1, nb1, ...s.W2, ...newW2, ...s.B2] };
  }
  const newW1 = []; for(let i = 0; i < NIN; i++) newW1.push(gauss() * 0.2);
  const newW2 = []; for(let k = 0; k < NOUT; k++) newW2.push(gauss() * 0.2);
  return { nh: b.nh + 1, w: [...s.W1, ...newW1, ...s.B1, gauss() * 0.2, ...s.W2, ...newW2, ...s.B2] };
}
// A deletion falls where it falls: it takes out an arbitrary neuron, not the most
// recently acquired one. Always deleting the last one made loss the exact inverse
// of gain, so every duplicate was the next deletion's first target and nothing new
// ever survived long enough to diverge.
function removeNeuron(b){
  const nh = b.nh, s = sections(b), j = rand() * nh | 0;
  const W1 = s.W1.slice(0, j * NIN).concat(s.W1.slice((j + 1) * NIN));
  const B1 = s.B1.slice(0, j).concat(s.B1.slice(j + 1));
  const W2 = s.W2.slice(0, j * NOUT).concat(s.W2.slice((j + 1) * NOUT));
  return { nh: nh - 1, w: [...W1, ...B1, ...W2, ...s.B2] };
}

// ---------------------------------------------------------------------------
// THE DUPLICATION AUDIT. Everything above about duplication had been argued and
// never measured against its own control. It has now been measured, and the
// headline is a null: DUPLICATION BUYS NO FITNESS HERE. It is not harmful, it is
// not a bug, and the duplicates it makes are real and long-lived — but on every
// statistic that means "this lineage is doing better", duplication and random
// invention are the same world.
//
// Harness: headless chromium, one process per (arm, seed), P.dupMode switching
// the arm. Two batteries. (A) STRUCTURE, 20000 ticks (30000 on seed 11), census
// every 500 ticks plus a per-neuron provenance census at the end; seeds
// 11/23/37/53/71/89 for dup and invent, 11/23/37/53 for silent. Every neuron
// carries a lineage tag through mutation, crossover and structural resize, so a
// duplicate can be followed across generations and its incoming weights compared
// against a frozen copy of what it was given at birth. (B) FITNESS, 10000 ticks,
// 8 seeds (11/23/37/53/71/89/101/113), `income` accumulated from tick 3500 and
// defined exactly as in culture.js finding 11: mean per-tick POSITIVE energy
// delta per established body, computed from outside the world. All figures are
// mean +- sd ACROSS SEEDS; paired figures are per-seed dup-minus-control.
//
// 1. NO FITNESS DIFFERENCE. Battery B, 8 seeds:
//        dup      income 0.4856 +- 0.0217   pop 373 +- 36   nh 8.08 +- 0.58   maxGen 16.0 +- 4.2
//        invent   income 0.4891 +- 0.0376   pop 319 +- 61   nh 8.02 +- 0.34   maxGen 16.6 +- 2.7
//        silent   income 0.4724 +- 0.0311   pop 349 +- 60   nh 8.11 +- 0.35   maxGen 15.0 +- 1.9
//    Paired dup-invent: income -0.0035 +- 0.0460 (sign 6/8), nh +0.055 +- 0.434,
//    maxGen -0.63 +- 5.93. Income is the statistic this project uses to decide
//    such questions and it is dead flat — the difference is a tenth of the
//    between-seed sd and the wrong sign. Duplication does not make bodies richer,
//    does not make brains bigger, and does not turn generations faster.
//
// 2. THE ONE THING THAT DID MOVE, AND WHY IT IS NOT A RESULT. Standing population
//    is higher under duplication, and consistently so: +53.9 +- 51.6 bodies at
//    10000 ticks (sign 6/8), and in battery A over ticks 2000..20008, dup 405 +- 43
//    against invent 353 +- 22, paired +51.7 +- 29.3 with sign 6/6, t(5) = 4.32.
//    That is a 15% population gap that survives pairing and lengthens with the
//    run. I spent most of this study trying to make it mean something, and it
//    does not, for two reasons. First, income is flat, so the extra bodies are
//    not better bodies — and this file already contains the precedent: the RPE
//    arm below moved population 11% the OTHER way with income flat, and that was
//    correctly read as noise rather than harm. A population shift of this size
//    with no income shift is what this world's between-seed variance looks like.
//    Second, the decomposition arm kills it. If duplication won because it
//    inherits an evolved detector, 'silent' — quiet arrival WITHOUT the inherited
//    filter — should sit with 'invent'. It does not: paired dup-silent is
//    income +0.0132 +- 0.0410 (sign 5/8) and pop +23.7 +- 57.8 (sign 4/8), i.e.
//    nothing. On two seeds the population gap reverses outright. At n=2 seeds
//    this arm looked like a clean confirmation of the design story; at n=8 it is
//    a coin flip. Short runs and small n lie, in that order.
//
// 3. THE OLD FAILURE MODE IS GONE, BUT NOT FOR THE STATED REASON. The comment on
//    removeNeuron is right that duplicates now survive: of the 314.5 +- 52.4
//    duplications in a 20000-tick run (against 253.8 +- 42.3 deletions), 14.4% +-
//    4.1% of the neurons created are still present at the end, the ones that are
//    lost persisted a mean of 1755 +- 271 ticks (median 1025, so roughly two
//    generations at ~600 ticks each), and the survivors have a mean age of
//    4525 +- 3019 ticks. Nothing is being created and immediately pruned.
//    But this is NOT because arriving silent protects it. The loud arm is
//    retained at exactly the same rate — invent 14.5% +- 5.5%, silent 15.7% +-
//    4.1%, against dup's 14.4% — and its lost neurons persist just as long
//    (1687 +- 245 ticks). Retention is a property of removeNeuron picking
//    uniformly, not of the duplicate being neutral. Claim [1] and claim [2] both
//    fail on this: selection does not remove the loud invented neuron either.
//
// 4. DUPLICATES DIVERGE, BY PURE DIFFUSION, AND ARE NEVER RECRUITED. Outgoing
//    (hidden->output) rms of a duplicate, binned by its age in ticks, against a
//    founding neuron's 0.441 +- 0.039:
//        0-1k 0.077 | 1-2.5k 0.090 | 2.5-5k 0.110 | 5-10k 0.143 | 10-20k 0.235 | 20k+ 0.234
//    Now the null model. mutateBrain adds gauss()*P.mut*0.6 to every weight once
//    per generation, i.e. sd 0.048, and a generation is ~600 ticks, so a neuron
//    that started at 0.02 and was touched by nothing but mutation would read
//    sqrt(0.02^2 + g*0.048^2): 0.070 at g=2, 0.118 at g=6, 0.167 at g=12, 0.240
//    at g=25. The measured curve IS that curve. A duplicate's voice is a free
//    random walk from silence; it is not being pushed up by selection, and it
//    never reaches founder scale even after 20000 ticks of being alive. Claim [3]
//    — "a single later mutation recruits a ready-made detector to a new job" — is
//    not observed at any age, in any arm, on any seed.
//
// 5. THE INHERITED FILTER IS REAL AND IT DOES PERSIST. This is the half of the
//    design that works. A duplicate's incoming weights stay at founder magnitude
//    (rms 0.427 +- 0.043 against founders' 0.440 +- 0.045) and stay pointed where
//    they were pointed: cos with a frozen copy of what it was handed at birth is
//    0.877 +- 0.043, cos with the template as the template is NOW is 0.826 +-
//    0.065, and |dW1|/|W1| is 0.455 +- 0.081 — consistent with the same 0.048
//    per-generation walk on a vector of norm ~2, which erodes the filter but does
//    not erase it over a duplicate's observed lifetime. The template is still
//    alive in the same brain 94% of the time. The `else` branch, for contrast,
//    genuinely cannot hold a filter: incoming rms 0.225 +- 0.017, cos with its own
//    birth state -0.01 +- 0.09, |dW1|/|W1| 1.151 +- 0.046. Its filter is re-drawn
//    by drift faster than it is built. Claim [4] is CONFIRMED. So duplication does
//    hand its offspring a proven detector, and that detector does last — there is
//    simply nothing in this world that then pays for using it.
//
// 6. HOW MUCH OF A BRAIN IS DUPLICATE-DERIVED. At the end of a 20000-tick run,
//    12.9% +- 6.2% of the hidden neurons in live brains trace to a duplication
//    event; on the single 30000-tick run it is 23.5%. The other ~87% (~77% at
//    30k) are still the founding architecture handed out by randomBrain. The
//    share climbs roughly linearly with run length, so duplication is slowly
//    turning the layer over — it is just turning it over neutrally.
//
// 7. WHY, IN ONE NUMBER. A hidden neuron costs 0.0016 energy per tick
//    (metabolism() in genome.js). Measured income is 0.486 per body per tick. So
//    a neuron is 0.33% of a body's income and a whole eight-neuron hidden layer
//    is 2.6%. genome.js's cost sweep established that a trait in this world is
//    selectable only when its consequence is tens of percent of the body's energy
//    budget, and that a few percent is drift no run length repairs. Neuron count
//    sits an order of magnitude below that line, which is why all three arms
//    settle at nh ~ 8.1 regardless of what an added neuron does, why a silent
//    duplicate is never purged, and equally why a loud invented one is never
//    purged either. The duplication machinery is not failing; it is operating
//    entirely inside the drift zone, where selection has no grip on anything it
//    produces. Making it matter would mean making brain size expensive enough to
//    hurt — and genome.js's sweep says that costs a fifth of the population
//    before the gene even starts responding.
//
// WHAT THIS DOES NOT SHOW. It does not show duplication is harmful; income and
// generation turnover are flat, not worse. It does not test worlds where a brain
// is under real pressure (P.mut far from 0.08, a much larger MAX_NH, or a
// metabolic price on nh in the tens-of-percent range) — the audit's own point is
// that such a world is where the mechanism would first become visible, and it is
// not the shipped one. And it does not test beyond 30000 ticks on a single seed;
// the duplicate-derived share of the layer is still climbing there, so a world
// run to fixation might yet look different.
//
// KEPT AS THE DEFAULT ANYWAY. It costs nothing, it is not worse than its control
// on any statistic, it is the biologically honest way for a layer to grow, and
// finding 5 shows the one mechanical claim under it — that a duplicate carries a
// real, persistent, evolved filter — is true. What is retired is the claim that
// this buys the lineage anything. P.dupMode stays because it is the control that
// retires it.
// ---------------------------------------------------------------------------

// `scale` is the parent's own mutability (genome.js passes mutScale(g)). The brain
// is part of the phenotype like any other organ, so a mutator lineage must garble
// its circuits as readily as its body — otherwise a high mutation rate would be a
// free option, adaptive under change with no deleterious load to purge it under
// stasis. Structural mutation (gaining or losing a neuron) scales with it too.
export function mutateBrain(b, scale){
  const sc = scale === undefined ? 1 : scale;
  let nb;
  const r = rand();
  if(r < 0.05 * sc && b.nh < MAX_NH) nb = addNeuron(b);
  else if(r < 0.09 * sc && b.nh > MIN_NH) nb = removeNeuron(b);
  else nb = { nh: b.nh, w: b.w.slice() };
  const m = P.mut * sc, w = nb.w;
  for(let i = 0; i < w.length; i++) w[i] = clamp(w[i] + gauss() * m * 0.6, -5, 5);
  // carry crossBrain's provenance mask across the mutation step, but only while
  // the weight indices still mean the same thing. addNeuron/removeNeuron renumber
  // the whole array, so the mask is dropped there by simply not re-pointing the
  // owner token — crossMask() then returns null and the caller falls back.
  if(_xOwner === b && nb.nh === b.nh) _xOwner = nb;
  return nb;
}

// ---------------------------------------------------------------------------
// PER-WEIGHT PROVENANCE FROM THE LAST RECOMBINATION.
//
// culture.js has to take a parent's taught offset back out of the germline its
// child just inherited, so that a lesson stays a lesson and does not quietly
// become DNA. For an asexual birth that is easy: the child's brain is the
// parent's, so subtract the whole offset. For a sexual pair it was not possible
// at all — inherit() is handed one parent, and crossBrain() had already thrown
// away which parent each weight came from, so culture.js subtracted HALF the
// offset from EVERY weight. That is right in expectation and wrong on every
// individual: each child kept a fraction of learned weight on the loci it took
// from the other parent, and had a fraction of noise subtracted from the rest.
// A small, systematic, one-directional Lamarckian leak, biased toward whichever
// parent happened to be passed first.
//
// The mask below is the missing information. It is module-level scratch rather
// than a property on the brain, because it is needed for exactly the few
// microseconds between crossover() and inherit() and would otherwise be pinned
// for the whole life of every creature ever born. `_xOwner` is the identity of
// the brain the mask describes: a caller that asks about any other brain — a
// stale one, an asexual child, a child whose hidden layer was resized by
// mutation — gets null and is expected to fall back.
//
// 1 means the weight came from the FIRST argument of crossBrain(), which is the
// first argument of crossover(), which world.js guarantees is the same body it
// then passes to culture.inherit(). That chain is the contract; it is asserted
// by the culture test rather than by a comment alone.
let _xMask = null, _xOwner = null;
export function crossMask(brain){ return _xOwner === brain ? _xMask : null; }

// recombine two brains: equal size -> per-weight crossover; else inherit one
export function crossBrain(ba, bb){
  if(ba.nh === bb.nh){
    const n = ba.w.length, w = new Array(n);
    if(!_xMask || _xMask.length < n) _xMask = new Uint8Array(n);
    for(let i = 0; i < n; i++){ const a = rand() < 0.5; w[i] = a ? ba.w[i] : bb.w[i]; _xMask[i] = a ? 1 : 0; }
    const nb = { nh: ba.nh, w };
    _xOwner = nb;
    return nb;
  }
  // whole-brain inheritance. If it came from bb the child's hidden size differs
  // from the primary parent's and culture.inherit() bails out before it can ask;
  // if it came from ba every weight is the parent's, so the mask is all ones.
  if(rand() < 0.5){
    const n = ba.w.length;
    if(!_xMask || _xMask.length < n) _xMask = new Uint8Array(n);
    _xMask.fill(1, 0, n);
    const nb = { nh: ba.nh, w: ba.w.slice() };
    _xOwner = nb;
    return nb;
  }
  _xOwner = null;
  return { nh: bb.nh, w: bb.w.slice() };
}

// cultural transmission: nudge a brain's weights toward a role model's
// (only when they share the same hidden size). Used at birth for imitation.
export function blendToward(child, model, alpha){
  if(child.nh !== model.nh) return child;
  const w = child.w, m = model.w;
  for(let i = 0; i < w.length; i++) w[i] = w[i] * (1 - alpha) + m[i] * alpha;
  return child;
}

const _h = new Array(MAX_NH);
let _lastNH = 0;
// There was a `motorGain` hook here: a scalar applied to the two motor outputs,
// which — both being tanh-bounded — is exactly equivalent to changing BRAIN_W.
// It existed only because the sweep of brain-versus-instinct authority had to be
// run from a module that did not own state.js. state.js now exposes the real
// knobs, P.brainW and P.innateW, so the equivalent-but-indirect version is gone.
// The sweep it produced still stands, and is recorded in the tuning log at the
// bottom of culture.js: authority is saturated at the shipped 0.7.
// `plast` (optional) is a per-creature plastic overlay on the hidden->output
// weights, learned within a single lifetime and NOT inherited.
export function brainForward(b, inp, out, plast){
  const nh = b.nh, w = b.w, b1off = nh * NIN, w2off = nh * NIN + nh, b2off = nh * NIN + nh + nh * NOUT;
  for(let j = 0; j < nh; j++){
    let s = w[b1off + j]; const base = j * NIN;
    for(let i = 0; i < NIN; i++) s += inp[i] * w[base + i];
    _h[j] = Math.tanh(s);
  }
  const rpe = plast && P.learnRule === 'rpe';
  let e = null;
  if(rpe){
    e = plast._e || (plast._e = new Float32Array(nh * NOUT));
    if(plast._b === undefined) plast._b = 0;
  }
  const sig = P.learnSigma === undefined ? RPE_SIGMA : P.learnSigma;
  const lam = P.learnLam === undefined ? RPE_LAM : P.learnLam;
  const lr = P.learnLR === undefined ? RPE_LR : P.learnLR;
  for(let k = 0; k < NOUT; k++){
    let s = w[b2off + k];
    if(plast) for(let j = 0; j < nh; j++) s += _h[j] * (w[w2off + j * NOUT + k] + plast[j * NOUT + k]);
    else      for(let j = 0; j < nh; j++) s += _h[j] * w[w2off + j * NOUT + k];
    if(rpe){
      // node perturbation: the exploration this body is being graded on
      const n = gauss() * sig;
      out[k] = Math.tanh(s + n);
      // eligibility trace of (which unit fired) x (which way the output was pushed),
      // and the baseline half of the update, paid on every tick because this tick's
      // reward is zero unless world.js calls learn() below.
      const bb = lr * plast._b;
      for(let j = 0; j < nh; j++){
        const i = j * NOUT + k;
        const ev = e[i] = lam * e[i] + (1 - lam) * _h[j] * n;
        const v = plast[i] - bb * ev;
        plast[i] = v > 0.9 ? 0.9 : v < -0.9 ? -0.9 : v;
      }
    } else out[k] = Math.tanh(s);
  }
  if(rpe) plast._b *= (1 - RPE_BETA);        // this tick contributed no reward
  _lastNH = nh;
}
export const getHidden = () => ({ h: _h, nh: _lastNH });

// reward-modulated Hebbian learning: reinforce the hidden->output associations
// that were just active, in proportion to the reward received. Uses the hidden
// activations still held in _h from this creature's most recent forward pass.
export function learn(b, plast, out, reward){
  if(P.learnRule === 'rpe') return learnRPE(b, plast, reward);
  const nh = b.nh, lr = 0.03 * reward;
  for(let j = 0; j < nh; j++){
    const hj = _h[j], base = j * NOUT;
    for(let k = 0; k < NOUT; k++){
      let v = plast[base + k] + lr * hj * out[k];
      plast[base + k] = v > 0.9 ? 0.9 : v < -0.9 ? -0.9 : v;   // bounded so it only nudges the evolved brain
    }
  }
}

// ---------------------------------------------------------------------------
// AN ALTERNATIVE LEARNING RULE (P.learnRule === 'rpe'), AND WHY IT WAS BUILT.
//
// The default rule above is reward-modulated Hebbian: dp = lr*r*h_j*out_k, with r
// always POSITIVE (world.js pays 0.12 for a meal and 0.2 for a kill and never calls
// learn() otherwise). Three things follow, and together they are the reason that
// deleting lifetime learning from this world costs nothing measurable:
//
//   * No negative case. Every update reinforces whatever the body was already
//     doing at the moment it happened to be fed. The rule has no way to represent
//     "that was worse than usual", so it cannot discriminate between actions; it
//     can only entrench the current policy. Its fixed point is output saturation.
//   * No exploration. out_k is a deterministic function of the genome and the
//     inputs, so h_j*out_k is too. The overlay a body accumulates is therefore
//     close to a deterministic function of its own genome — measured directly:
//     cos(germline hidden->output block, plast) = 0.345 +- 0.010 across 4 seeds,
//     and culture.js finding 6 has sibling plast agreeing at 0.85 even when the
//     teaching content is randomised. There is no variance for a reward to select.
//   * No credit assignment in time. learn() fires on the tick the food is eaten,
//     using the activations of that tick. The behaviour that earned the meal was
//     the approach over the preceding tens of ticks, and it is never reinforced.
//
// 'rpe' replaces all three with the standard continuing-task policy-gradient form:
// perturb each output's pre-activation with gaussian noise (the exploration), keep
// an eligibility trace of h_j * noise_k (which unit was firing when the output was
// pushed which way), and apply dp = LR * (r_t - rbar) * e on every tick, where rbar
// is an exponentially-weighted average of the per-tick reward. The baseline half
// (-LR*rbar*e) is paid inside brainForward because that is the only entry point
// world.js calls on the ticks where r_t is zero; the reward half is learnRPE().
// Subtracting the baseline is what turns "reinforce what you did when fed" into
// "reinforce what you did better than usual", which is the whole difference.
//
// All randomness is gauss() from utils.js. Note that this consumes the world PRNG,
// so an 'rpe' arm is NOT bit-paired with a hebb arm — comparisons below are
// seed-matched, not PRNG-paired.
// MEASURED, AND REJECTED AS THE DEFAULT. It does what it was built to do — the
// overlay stops being an echo of the genome (cos(germline hidden->output, plast)
// falls from 0.345 +- 0.010 to 0.000 +- 0.002) and can be driven to any magnitude
// (overlay rms 0.036 / 0.137 / 0.337 at learnLR 10 / 40 / 120, against 0.0095 for
// the Hebbian rule and a ~0.45 genetic weight scale). It buys nothing. 8 seeds x
// 10000 ticks at learnLR 40, against its own control — identical exploration noise
// with learnLR 0, so the only difference is whether the reward is used at all:
//     learnLR 40   income 0.5026 +- 0.0219   pop 379 +- 72   maxGen 15.8 +- 2.3
//     learnLR 0    income 0.5005 +- 0.0271   pop 427 +- 63   maxGen 14.6 +- 1.7
// +0.002 income and 11% fewer bodies. Income is flat (0.456 / 0.444 / 0.450) while
// the overlay grows to three quarters of the genetic weight scale, and raising the
// exploration noise from 0.15 to 0.4 does not change that either. So the default
// rule's inertness is not caused by the default rule being wrong; it is caused by
// the world not paying enough for good steering to select on it (genome.js's cost
// sweep, and findings 11-16 in culture.js). Kept behind the flag because it is the
// control that retires the hypothesis.
const RPE_SIGMA = 0.15;   // exploration noise on the output pre-activations
const RPE_LAM = 0.95;     // trace decay, tau ~20 ticks (the approach-to-meal latency)
const RPE_LR = 1.0;       // trace is (1-lam)-normalised, so this is O(1), not O(0.03)
const RPE_BETA = 0.002;   // baseline EWMA, tau ~500 ticks (about one lifetime)
function learnRPE(b, plast, reward){
  const e = plast._e; if(!e) return;
  const n = b.nh * NOUT, lr = (P.learnLR === undefined ? RPE_LR : P.learnLR) * reward;
  for(let i = 0; i < n; i++){
    const v = plast[i] + lr * e[i];
    plast[i] = v > 0.9 ? 0.9 : v < -0.9 ? -0.9 : v;
  }
  plast._b += RPE_BETA * reward;
}
