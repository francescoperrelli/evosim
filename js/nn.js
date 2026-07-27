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
// Inventing a neuron from scratch (the `else` branch) drops a random function
// into a working circuit, so it is almost always harmful the moment it appears
// and selection removes it before it can ever be refined. Real genomes do not
// gain parts that way: they gain them by DUPLICATION, and the duplicate is
// retained precisely because it changes nothing at first.
//
// So with evolvability on we copy an existing neuron instead. What is copied is
// the thing that took selection a long time to build: the duplicate's INCOMING
// weights and bias are inherited from its template, so it already computes a
// feature the lineage has been rewarded for detecting. What it does not inherit
// is a voice — its outgoing weights start at ~0, so it is silent on arrival and
// the circuit behaves exactly as it did before. The lineage pays only the
// metabolic cost of the extra unit, so selection has no reason to remove it, and
// a single later mutation on one outgoing weight recruits a ready-made detector
// to a new job. That is what makes duplicates a cheaper source of function than
// invention: the `else` branch has to random-walk a whole 20-dimensional input
// filter into something meaningful, which essentially never happens.
//
// The template is deliberately left untouched. Sharing the output between the
// twins instead (halving the original's outgoing weights, the classic dosage
// model) is also exactly neutral on arrival, but it was measurably WORSE than
// random invention here — a redundant twin adds no new feature to a hidden layer,
// and every later deletion of one twin tears the shared function in half.
function addNeuron(b){
  const s = sections(b);
  if(P.evolvOn){
    const j = rand() * b.nh | 0;                 // the template neuron
    const newW1 = new Array(NIN), newW2 = new Array(NOUT);
    for(let i = 0; i < NIN; i++) newW1[i] = s.W1[j * NIN + i] + gauss() * 0.03;   // inherit the evolved feature detector
    for(let k = 0; k < NOUT; k++) newW2[k] = gauss() * 0.02;                      // but arrive silent
    return { nh: b.nh + 1, w: [...s.W1, ...newW1, ...s.B1, s.B1[j] + gauss() * 0.03, ...s.W2, ...newW2, ...s.B2] };
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
  return nb;
}

// recombine two brains: equal size -> per-weight crossover; else inherit one
export function crossBrain(ba, bb){
  if(ba.nh === bb.nh){
    const w = new Array(ba.w.length);
    for(let i = 0; i < w.length; i++) w[i] = rand() < 0.5 ? ba.w[i] : bb.w[i];
    return { nh: ba.nh, w };
  }
  return rand() < 0.5 ? { nh: ba.nh, w: ba.w.slice() } : { nh: bb.nh, w: bb.w.slice() };
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
