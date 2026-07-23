// Rete neurale minima (feed-forward): NIN -> NH -> NOUT, attivazione tanh.
// I pesi sono il "cervello" della creatura e vengono ereditati con mutazioni.
import { clamp, gauss } from './utils.js';
import { P } from './state.js';

export const NIN = 10, NH = 8, NOUT = 2;
const OFF_B1 = NIN * NH;                 // bias strato nascosto
const OFF_W2 = OFF_B1 + NH;              // pesi nascosto->uscita
const OFF_B2 = OFF_W2 + NH * NOUT;       // bias uscita
export const BRAINLEN = OFF_B2 + NOUT;

export function randomBrain(){
  const a = new Array(BRAINLEN);
  for(let i = 0; i < BRAINLEN; i++) a[i] = gauss() * 0.7;
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
