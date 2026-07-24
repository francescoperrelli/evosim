// Utilità condivise
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Seeded PRNG (mulberry32) so a world is reproducible from its seed.
// Every source of simulation randomness flows through rand().
let _s = 0x2f6e2b1;
export function setSeed(s){ _s = (s >>> 0) || 1; }
export function rand(){
  _s |= 0; _s = (_s + 0x6D2B79F5) | 0;
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const rnd = (a, b) => a + rand() * (b - a);
// rumore gaussiano (Box-Muller)
export function gauss(){
  let u = 0, v = 0;
  while(!u) u = rand();
  while(!v) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
}
export const el = id => document.getElementById(id);
