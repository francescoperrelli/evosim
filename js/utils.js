// Utilità condivise
export const TAU = Math.PI * 2;
export const rnd = (a, b) => a + Math.random() * (b - a);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
// rumore gaussiano (Box-Muller)
export function gauss(){
  let u = 0, v = 0;
  while(!u) u = Math.random();
  while(!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
}
export const el = id => document.getElementById(id);
