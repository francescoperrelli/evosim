// Minimal recurrent neural network: NIN -> NH -> NOUT (tanh).
// Two of the outputs are written back as "memory" inputs next tick,
// giving each creature a tiny short-term memory.
import { clamp, gauss } from './utils.js';
import { P } from './state.js';

// Inputs (17): food fwd/lat/pres, prey fwd/lat/pres, threat fwd/lat/pres,
//              neighbour fwd/lat/density, energy, season, mem0, mem1, bias
export const NIN = 17, NH = 10, NOUT = 4;   // outputs: moveX, moveY, mem0, mem1
export const NMEM = 2;
const OFF_B1 = NIN * NH;
const OFF_W2 = OFF_B1 + NH;
const OFF_B2 = OFF_W2 + NH * NOUT;
export const BRAINLEN = OFF_B2 + NOUT;

export function randomBrain(){
  const a = new Array(BRAINLEN);
  for(let i = 0; i < BRAINLEN; i++) a[i] = gauss() * 0.45;
  return a;
}
export function mutateBrain(b){
  const m = P.mut, a = new Array(BRAINLEN);
  for(let i = 0; i < BRAINLEN; i++) a[i] = clamp(b[i] + gauss() * m * 0.6, -5, 5);
  return a;
}

const _h = new Array(NH);
export function brainForward(b, inp, out){
  for(let j = 0; j < NH; j++){
    let s = b[OFF_B1 + j];
    for(let i = 0; i < NIN; i++) s += inp[i] * b[i * NH + j];
    _h[j] = Math.tanh(s);
  }
  for(let k = 0; k < NOUT; k++){
    let s = b[OFF_B2 + k];
    for(let j = 0; j < NH; j++) s += _h[j] * b[OFF_W2 + j * NOUT + k];
    out[k] = Math.tanh(s);
  }
}

// Expose layer sizes and last hidden activations for the inspector
export const LAYERS = { NIN, NH, NOUT };
export const getHidden = () => _h;
