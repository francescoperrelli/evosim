// Recurrent neural network with an EVOLVABLE hidden-layer size.
// A brain is { nh, w }: nh hidden neurons and a flat weight array `w`,
// laid out hidden-major so neurons can be added/removed by mutation.
// Two outputs feed back as memory, giving each creature short-term memory.
import { clamp, gauss } from './utils.js';
import { P } from './state.js';

// Inputs (18): food fwd/lat/pres, prey fwd/lat/pres, threat fwd/lat/pres,
//              neighbour fwd/lat/density, energy, season, mem0, mem1, heard-signal, bias
// Outputs (5): moveX, moveY, mem0, mem1, signal (broadcast call)
export const NIN = 18, NOUT = 5, NMEM = 2;
export const MIN_NH = 4, MAX_NH = 24;

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
