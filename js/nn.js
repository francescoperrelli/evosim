// Recurrent neural network with an EVOLVABLE hidden-layer size.
// A brain is { nh, w }: nh hidden neurons and a flat weight array `w`,
// laid out hidden-major so neurons can be added/removed by mutation.
// Two outputs feed back as memory, giving each creature short-term memory.
import { clamp, gauss } from './utils.js';
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
  const nh = 6 + (Math.random() * 5 | 0);   // 6..10 to start
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
function addNeuron(b){
  const s = sections(b);
  const newW1 = []; for(let i = 0; i < NIN; i++) newW1.push(gauss() * 0.2);
  const newW2 = []; for(let k = 0; k < NOUT; k++) newW2.push(gauss() * 0.2);
  return { nh: b.nh + 1, w: [...s.W1, ...newW1, ...s.B1, gauss() * 0.2, ...s.W2, ...newW2, ...s.B2] };
}
function removeNeuron(b){
  const nh = b.nh, s = sections(b);
  return { nh: nh - 1, w: [...s.W1.slice(0, (nh - 1) * NIN), ...s.B1.slice(0, nh - 1), ...s.W2.slice(0, (nh - 1) * NOUT), ...s.B2] };
}

export function mutateBrain(b){
  let nb;
  const r = Math.random();
  if(r < 0.05 && b.nh < MAX_NH) nb = addNeuron(b);
  else if(r < 0.09 && b.nh > MIN_NH) nb = removeNeuron(b);
  else nb = { nh: b.nh, w: b.w.slice() };
  const m = P.mut, w = nb.w;
  for(let i = 0; i < w.length; i++) w[i] = clamp(w[i] + gauss() * m * 0.6, -5, 5);
  return nb;
}

// recombine two brains: equal size -> per-weight crossover; else inherit one
export function crossBrain(ba, bb){
  if(ba.nh === bb.nh){
    const w = new Array(ba.w.length);
    for(let i = 0; i < w.length; i++) w[i] = Math.random() < 0.5 ? ba.w[i] : bb.w[i];
    return { nh: ba.nh, w };
  }
  return Math.random() < 0.5 ? { nh: ba.nh, w: ba.w.slice() } : { nh: bb.nh, w: bb.w.slice() };
}

const _h = new Array(MAX_NH);
let _lastNH = 0;
export function brainForward(b, inp, out){
  const nh = b.nh, w = b.w, b1off = nh * NIN, w2off = nh * NIN + nh, b2off = nh * NIN + nh + nh * NOUT;
  for(let j = 0; j < nh; j++){
    let s = w[b1off + j]; const base = j * NIN;
    for(let i = 0; i < NIN; i++) s += inp[i] * w[base + i];
    _h[j] = Math.tanh(s);
  }
  for(let k = 0; k < NOUT; k++){
    let s = w[b2off + k];
    for(let j = 0; j < nh; j++) s += _h[j] * w[w2off + j * NOUT + k];
    out[k] = Math.tanh(s);
  }
  _lastNH = nh;
}
export const getHidden = () => ({ h: _h, nh: _lastNH });
