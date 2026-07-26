// Synthesized audio (WebAudio) — an adaptive score plus acoustic-ecology sonification.
// No assets are loaded: every voice is built from oscillators and noise at runtime.
// The whole system is driven by audioTick(), called once per animation frame. It reads
// the shared world state and re-tunes the music to what the ecosystem is actually doing
// (season -> mode, population -> density, biodiversity -> layers, disease/drought/crash ->
// dissonance, day/night -> timbre), sonifies the standing population as an ambient bed,
// lets nearby creatures vocalise their evolved signal channels, and fires stingers for
// chronicle events. Everything degrades silently where WebAudio is missing or asleep.
import { P, S, seasonInfo, dayInfo } from './state.js';
import { dialectStats } from './world.js';

let ctx = null, master = null, limiter = null, musicGain = null, sfxGain = null, musicLP = null, started = false;
let noiseBuf = null, lastT = 0, frameN = 0;
const cfg = { music: true, sfx: true, musicVol: 1, sfxVol: 1 };

export const musicOn = () => cfg.music;
export const sfxOn = () => cfg.sfx;

/* ---------- voice pool: a hard polyphony cap, new voices dropped when full ---------- */
const VOICE_CAP = 20;
let pool = [], peakVoices = 0, madeVoices = 0, droppedVoices = 0;
function prune(t){ let k = 0; for(let i = 0; i < pool.length; i++) if(pool[i].end > t) pool[k++] = pool[i]; pool.length = k; }
function claim(dur, nodes){                            // returns false when the pool is saturated
  const t = ctx.currentTime; prune(t);
  if(pool.length >= VOICE_CAP){ droppedVoices++; return false; }
  pool.push({ end: t + dur + 0.05, n: nodes || 3 }); madeVoices++;
  if(pool.length > peakVoices) peakVoices = pool.length;
  return true;
}
// disconnect a finished voice's chain so the graph never accumulates dead nodes
function ends(src, ...nodes){ try{ src.onended = () => { for(const n of nodes) if(n) try{ n.disconnect(); }catch(e){} }; }catch(e){} }
function noiseSrc(){ const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; return s; }

/* ---------- token buckets: per-category sounds-per-second budgets ---------- */
// with up to 1400 creatures we must never approach one sound per creature, so every
// category draws from its own refilling bucket and candidates are picked stochastically.
const BUD = {
  voc:   { t: 2, rate: 2.4, cap: 3 },    // dialect vocalisations
  herb:  { t: 2, rate: 2.6, cap: 3 },    // airy chorus
  omni:  { t: 1, rate: 1.2, cap: 2 },    // mid layer
  carn:  { t: 1, rate: 0.5, cap: 1.5 },  // low swells
  kill:  { t: 2, rate: 2.2, cap: 3 },    // predation crunches
  birth: { t: 2, rate: 2.0, cap: 3 },    // birth ticks
  sting: { t: 2, rate: 1.0, cap: 2 }     // event motifs
};
function refill(dt){ for(const k in BUD){ const b = BUD[k]; b.t = Math.min(b.cap, b.t + b.rate * dt); } }
function take(k){ const b = BUD[k]; if(b.t < 1) return false; b.t -= 1; return true; }

/* ---------- live musical parameters (all smoothed, so the score never jumps) ---------- */
const M = { mode: 0.5, root: 110, dens: 0.3, layers: 2, diss: 0, cut: 1200, light: 0.5, mourn: 0, beat: 1.6 };
const W = { pop: 0, herb: 0, omni: 0, carn: 0, sickF: 0, bio: 1, avg: 0, stress: 0 };
// reservoirs of in-view creatures, refreshed by the census and drawn from by the sonifier
const nearHerb = [], nearOmni = [], nearCarn = [], talkers = [];
let prevKills = 0, prevID = 0, pendKill = 0, pendBirth = 0, accent = null;
let nextNote = 0, melDeg = 0, seenTop = null;

const sm = (cur, tgt, tau, dt) => cur + (tgt - cur) * (1 - Math.exp(-dt / tau));
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
// scales blended degree-by-degree: mode 0 = natural minor, mode 1 = major. Interpolating
// the semitones (rather than switching tables) makes spring arrive as a slow thaw.
const SC_MIN = [0, 2, 3, 5, 7, 8, 10, 12, 14, 15, 17, 19];
const SC_MAJ = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19];
function semi(i){
  const L = SC_MIN.length, j = ((i % L) + L) % L, oct = Math.floor(i / L) * 12;
  return oct + SC_MIN[j] + (SC_MAJ[j] - SC_MIN[j]) * M.mode;
}
const hz = i => M.root * Math.pow(2, semi(i) / 12);
const hash = n => { n = (n ^ 61) ^ (n >>> 16); n = (n + (n << 3)) | 0; n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); n ^= n >>> 15; return (n >>> 0) / 4294967296; };

export function initAudio(){
  if(ctx){ if(ctx.state === 'suspended') try{ ctx.resume(); }catch(e){} return; }
  try{
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    limiter = ctx.createDynamicsCompressor();          // master limiter: many voices at once must not clip
    limiter.threshold.value = -8; limiter.knee.value = 6; limiter.ratio.value = 12;
    limiter.attack.value = 0.003; limiter.release.value = 0.18;
    limiter.connect(ctx.destination);
    master = ctx.createGain(); master.gain.value = 0.6; master.connect(limiter);
    musicGain = ctx.createGain(); musicGain.gain.value = 0.0001; musicGain.connect(master);
    sfxGain = ctx.createGain(); sfxGain.gain.value = 0.5 * cfg.sfxVol; sfxGain.connect(master);
    const n = (ctx.sampleRate * 2) | 0, buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    for(let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;   // one shared noise bed, never reallocated
    noiseBuf = buf;
    lastT = ctx.currentTime; nextNote = lastT + 0.5;
    prevKills = S.predations; prevID = S.ID;
    if(cfg.music) startMusic();
  }catch(e){ ctx = null; }
}

export function setMusic(on){
  cfg.music = on;
  if(!ctx){ if(on) initAudio(); return; }
  if(on && !started) startMusic();
  try{ musicGain.gain.setTargetAtTime(on ? 0.12 * cfg.musicVol : 0.0001, ctx.currentTime, 0.6); }catch(e){}
}
export function setSfx(on){ cfg.sfx = on; }
export function setMusicVol(v){
  cfg.musicVol = clamp01(+v || 0);
  if(!ctx) return;
  try{ musicGain.gain.setTargetAtTime(cfg.music ? Math.max(0.0001, 0.12 * cfg.musicVol) : 0.0001, ctx.currentTime, 0.2); }catch(e){}
}
export function setSfxVol(v){
  cfg.sfxVol = clamp01(+v || 0);
  if(!ctx) return;
  try{ sfxGain.gain.setTargetAtTime(Math.max(0.0001, 0.5 * cfg.sfxVol), ctx.currentTime, 0.2); }catch(e){}
}
export function suspendAudio(){ if(ctx) try{ if(ctx.state === 'running') ctx.suspend(); }catch(e){} }
export function resumeAudio(){ if(ctx) try{ if(ctx.state === 'suspended') ctx.resume(); }catch(e){} }

/* ---------- the pad: a persistent chord whose voices are the ecosystem's layers ---------- */
const PAD_DEG = [-7, 0, 2, 4, 7, 9];      // one scale degree per harmonic layer, bass first
const pad = [];
function startMusic(){
  if(!ctx || started) return; started = true;
  try{
    musicLP = ctx.createBiquadFilter(); musicLP.type = 'lowpass'; musicLP.frequency.value = 900; musicLP.Q.value = 0.6;
    musicLP.connect(musicGain);
    PAD_DEG.forEach((deg, i) => {
      const o = ctx.createOscillator(); o.type = i % 2 ? 'sine' : 'triangle'; o.frequency.value = hz(deg);
      const g = ctx.createGain(); g.gain.value = i < 2 ? 0.05 : 0.0001;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.031 + 0.019 * i;   // slow breathing detune
      const lg = ctx.createGain(); lg.gain.value = 3.5;
      lfo.connect(lg); lg.connect(o.detune); o.connect(g); g.connect(musicLP);
      lfo.start(); o.start();
      pad.push({ o, g, lg, deg });
    });
    musicGain.gain.setTargetAtTime(cfg.music ? 0.12 * cfg.musicVol : 0.0001, ctx.currentTime, 1.5);
  }catch(e){}
}

/* ---------- spatialisation: stereo position + distance muffling from the viewport ---------- */
function spat(x, y, dest){
  const z = S.cam.zoom || 1, vw = (S.W || 900) / z, vh = (S.H || 600) / z;
  const cx = S.cam.x + vw * 0.5, cy = S.cam.y + vh * 0.5;
  const px = Math.max(-1, Math.min(1, (x - cx) / (vw * 0.5)));
  const d = Math.min(1, Math.hypot(x - cx, y - cy) / (Math.hypot(vw, vh) * 0.5));
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.value = 500 + 13000 * (1 - d) * (1 - d);   // distant things arrive muffled
  const g = ctx.createGain(); g.gain.value = 1 - 0.8 * d; lp.connect(g);
  if(ctx.createStereoPanner){ const p = ctx.createStereoPanner(); p.pan.value = px; g.connect(p); p.connect(dest); }
  else g.connect(dest);
  return lp;
}
const inView = c => {
  const z = S.cam.zoom || 1, vw = (S.W || 900) / z, vh = (S.H || 600) / z;
  return c.x >= S.cam.x - vw * 0.15 && c.x <= S.cam.x + vw * 1.15 && c.y >= S.cam.y - vh * 0.15 && c.y <= S.cam.y + vh * 1.15;
};

/* ---------- world census: one bounded pass every few frames ---------- */
function census(){
  const cs = S.creatures; let herb = 0, omni = 0, carn = 0, sick = 0;
  const bins = [0, 0, 0, 0, 0, 0];
  nearHerb.length = 0; nearOmni.length = 0; nearCarn.length = 0; talkers.length = 0;
  for(let i = 0; i < cs.length; i++){
    const c = cs[i];
    if(c.type === 'carn') carn++; else if(c.type === 'omni') omni++; else herb++;
    if(c.sick > 0) sick++;
    const dt2 = c.g && c.g.diet !== undefined ? c.g.diet : 0.15;
    bins[Math.min(5, Math.max(0, (dt2 * 6) | 0))] = 1;   // occupied diet niches ~= species richness
    if(!inView(c)) continue;
    const res = c.type === 'carn' ? nearCarn : c.type === 'omni' ? nearOmni : nearHerb;
    if(res.length < 10) res.push(c); else if(Math.random() < 0.25) res[(Math.random() * 10) | 0] = c;
    // vocalisation candidates: loud, in view, dominant channel well clear of noise
    const s = c.sig; if(!s) continue;
    const mag = Math.max(Math.abs(s[0]), Math.abs(s[1]), Math.abs(s[2]));
    if(mag > 0.42){ if(talkers.length < 8) talkers.push(c); else if(Math.random() < 0.3) talkers[(Math.random() * 8) | 0] = c; }
  }
  W.herb = herb; W.omni = omni; W.carn = carn; W.pop = cs.length;
  W.sickF = cs.length ? sick / cs.length : 0;
  let b = 0; for(let i = 0; i < 6; i++) b += bins[i];
  W.bio = Math.max(1, b);
  W.avg = W.avg ? W.avg + (W.pop - W.avg) * 0.02 : W.pop;    // slow baseline, so a crash is visible
  const crash = W.avg > 60 ? clamp01((1 - W.pop / W.avg) * 2.2) : 0;
  W.stress = clamp01(W.sickF * 1.7 + (S.drought > 0 ? 0.34 : 0) + crash);
  const dk = S.predations - prevKills; prevKills = S.predations;
  if(dk > 0) pendKill = Math.min(4, pendKill + dk);
  const db = S.ID - prevID; prevID = S.ID;
  if(db > 0) pendBirth = Math.min(4, pendBirth + db);
}

/* ---------- parameter update: the world drives the score ---------- */
function updateParams(dt){
  const sea = seasonInfo(S.tick), day = dayInfo(S.tick);
  // spring/summer bright and major, autumn/winter minor and low; smoothed into a slow thaw
  const modeT = [0.85, 1, 0.35, 0.05][sea.idx], keyT = [0, 2, -2, -5][sea.idx];
  M.mode = sm(M.mode, modeT, 6, dt);
  M.root = sm(M.root, 110 * Math.pow(2, keyT / 12), 8, dt);
  M.light = sm(M.light, day.light, 1.5, dt);
  M.dens = sm(M.dens, clamp01(W.pop / 520), 3, dt);
  M.layers = sm(M.layers, Math.min(6, 1 + W.bio), 5, dt);    // richer ecosystem, thicker chord
  M.diss = sm(M.diss, W.stress, 2.5, dt);
  M.mourn = Math.max(0, M.mourn - dt / 11);                  // an extinction's silence, recovering
  // brighter by day, darker at night; trouble pulls the whole filter down
  M.cut = sm(M.cut, (420 + 2300 * (0.3 + 0.7 * M.light)) * (1 - 0.55 * M.diss), 1.2, dt);
  M.beat = 2.7 - 1.9 * M.dens;                               // a thriving world is busier
  if(day.night) M.beat *= 1.7;
  M.beat = Math.max(0.3, M.beat);
  const t = ctx.currentTime;
  try{
    if(musicLP) musicLP.frequency.setTargetAtTime(Math.max(140, M.cut), t, 0.4);
    for(let i = 0; i < pad.length; i++){
      const v = pad[i];
      const on = i < M.layers && M.mourn < 0.9 - i * 0.13;    // layers fade back one at a time
      const lvl = (i === 0 ? 0.055 : 0.038) * (0.55 + 0.45 * M.dens);
      v.o.frequency.setTargetAtTime(Math.max(20, hz(v.deg)), t, 1.2);
      v.o.detune.setTargetAtTime((i % 2 ? 1 : -1) * M.diss * 34, t, 1.5);   // stress sours the chord
      v.g.gain.setTargetAtTime(on ? lvl * (1 - 0.85 * M.mourn) : 0.0001, t, 1.6);
      v.lg.gain.setTargetAtTime(3.5 + M.diss * 12, t, 1.5);
    }
  }catch(e){}
}

/* ---------- melodic layer: scheduled from audioTick, never from a timer ---------- */
function pluck(f, vol, dur){
  if(!claim(dur, 2)) return;
  try{
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = M.mode > 0.5 ? 'sine' : 'triangle'; o.frequency.value = f;
    o.detune.value = (Math.random() * 2 - 1) * M.diss * 30;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.001, vol), t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(musicGain); ends(o, o, g); o.start(t); o.stop(t + dur + 0.02);
  }catch(e){}
}
function scheduleMusic(now){
  if(now < nextNote) return;
  nextNote = now + M.beat * (0.75 + Math.random() * 0.5);
  if(M.mourn > 0.55) return;                                 // hold the silence after an extinction
  melDeg += (Math.random() * 5 | 0) - 2;                     // gentle random walk over the scale
  if(melDeg > 16) melDeg -= 7; if(melDeg < 0) melDeg += 7;
  const vol = (0.045 + 0.05 * M.dens) * (1 - 0.4 * M.mourn) * cfg.musicVol;
  pluck(hz(melDeg + 12), vol, 1.2 + Math.random() * 0.8);
  if(Math.random() < 0.28 * M.dens) pluck(hz(melDeg + 16), vol * 0.6, 1.0);   // a busy world doubles up
}

/* ---------- ecosystem soundscape: the standing population, sonified ---------- */
function pick(a){ return a.length ? a[(Math.random() * a.length) | 0] : null; }
function chirp(c){                                          // herbivores: high, short, airy
  if(!claim(0.2, 4)) return;
  try{
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    const f = 1100 + hash(c.lineage | 0) * 1300 + M.light * 300;
    o.type = 'sine'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.22, t + 0.09);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05 * cfg.sfxVol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    const dest = spat(c.x, c.y, sfxGain);
    o.connect(g); g.connect(dest); ends(o, o, g, dest); o.start(t); o.stop(t + 0.2);
  }catch(e){}
}
function warble(c){                                         // omnivores: a mid, two-note figure
  if(!claim(0.35, 4)) return;
  try{
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    const f = 300 + hash((c.lineage | 0) + 7) * 320;
    o.type = 'triangle'; o.frequency.setValueAtTime(f, t); o.frequency.setValueAtTime(f * 1.19, t + 0.13);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.055 * cfg.sfxVol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    const dest = spat(c.x, c.y, sfxGain);
    o.connect(g); g.connect(dest); ends(o, o, g, dest); o.start(t); o.stop(t + 0.35);
  }catch(e){}
}
function growl(c){                                          // carnivores: a low guttural swell
  if(!claim(1.7, 5)) return;
  try{
    const t = ctx.currentTime, o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
    const f = 46 + hash((c.lineage | 0) + 19) * 26;
    o.type = 'sawtooth'; o.frequency.value = f; o2.type = 'sine'; o2.frequency.value = f * 0.5;
    o.detune.value = 9 + M.diss * 40;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09 * cfg.sfxVol, t + 0.55);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    const dest = spat(c.x, c.y, sfxGain);
    o.connect(g); o2.connect(g); g.connect(dest); ends(o, o, o2, g, dest);
    o.start(t); o.stop(t + 1.7); o2.start(t); o2.stop(t + 1.7);
  }catch(e){}
}
function soundscape(dt){
  const night = M.light < 0.35 ? 0.45 : 1;                   // nights are sparser
  if(Math.random() < Math.min(2.6, W.herb / 150) * dt * night && take('herb')){ const c = pick(nearHerb); if(c) chirp(c); }
  if(Math.random() < Math.min(1.2, W.omni / 90) * dt * night && take('omni')){ const c = pick(nearOmni); if(c) warble(c); }
  if(Math.random() < Math.min(0.5, W.carn / 45) * dt && take('carn')){ const c = pick(nearCarn); if(c) growl(c); }
}

/* ---------- audible dialects: the evolved signal channels, made hearable ---------- */
// sig[0] -> pitch, sig[1] -> timbre (FM index), sig[2] -> duration; the lineage id seeds a
// stable transposition and the measured accent biases it further, so two lineages that have
// drifted apart in signal space are immediately distinguishable by ear.
function vocalise(){
  if(!talkers.length || !take('voc')) return;
  // weight the choice toward the camera centre so the ear follows what the player is watching
  let best = null, bw = -1;
  for(let i = 0; i < 3; i++){
    const c = talkers[(Math.random() * talkers.length) | 0];
    const s = c.sig, mag = Math.max(Math.abs(s[0]), Math.abs(s[1]), Math.abs(s[2]));
    const z = S.cam.zoom || 1, cx = S.cam.x + (S.W || 900) / z * 0.5, cy = S.cam.y + (S.H || 600) / z * 0.5;
    const w = mag * (1 / (1 + Math.hypot(c.x - cx, c.y - cy) / 400)) * Math.random();
    if(w > bw){ bw = w; best = c; }
  }
  if(!best) return;
  const c = best, s = c.sig, lin = c.lineage | 0;
  let a0 = 0, a1 = 0;
  if(accent && accent[lin]){ a0 = accent[lin][0]; a1 = accent[lin][1]; }
  const semis = s[0] * 11 + a0 * 5 + (hash(lin) - 0.5) * 9;   // stable per-lineage transposition
  const f = Math.max(60, 260 * Math.pow(2, semis / 12));
  const idx = (Math.abs(s[1]) + Math.abs(a1) * 0.5) * 620;    // FM index -> vowel/roughness
  const dur = 0.07 + (s[2] * 0.5 + 0.5) * 0.30;
  if(!claim(dur, 5)) return;
  try{
    const t = ctx.currentTime, car = ctx.createOscillator(), mod = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain();
    car.type = 'sine'; car.frequency.value = f;
    mod.type = hash(lin + 3) > 0.5 ? 'square' : 'sine';
    mod.frequency.value = f * (0.5 + hash(lin + 11) * 2.5);   // per-lineage modulation ratio
    mg.gain.value = idx; mod.connect(mg); mg.connect(car.frequency);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.075 * cfg.sfxVol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const dest = spat(c.x, c.y, sfxGain);
    car.connect(g); g.connect(dest); ends(car, car, mod, mg, g, dest);
    car.start(t); car.stop(t + dur + 0.02); mod.start(t); mod.stop(t + dur + 0.02);
  }catch(e){}
}

/* ---------- diegetic effects ---------- */
function crunch(x, y){                                      // predation: a brief wet snap
  if(!claim(0.16, 4)) return;
  try{
    const t = ctx.currentTime, s = noiseSrc(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    bp.type = 'bandpass'; bp.frequency.setValueAtTime(1500, t); bp.frequency.exponentialRampToValueAtTime(340, t + 0.12); bp.Q.value = 1.4;
    g.gain.setValueAtTime(0.28 * cfg.sfxVol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    const dest = spat(x, y, sfxGain);
    s.connect(bp); bp.connect(g); g.connect(dest); ends(s, s, bp, g, dest);
    s.start(t, Math.random() * 1.5, 0.16); s.stop(t + 0.16);
  }catch(e){}
}
function birthTick(x, y){                                   // birth: a soft wooden tick
  if(!claim(0.12, 4)) return;
  try{
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(880 + Math.random() * 500, t);
    o.frequency.exponentialRampToValueAtTime(420, t + 0.07);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05 * cfg.sfxVol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    const dest = spat(x, y, sfxGain);
    o.connect(g); g.connect(dest); ends(o, o, g, dest); o.start(t); o.stop(t + 0.12);
  }catch(e){}
}
function diegetic(){
  if(pendKill > 0 && take('kill')){ pendKill--; const c = pick(nearCarn) || pick(nearHerb); if(c) crunch(c.x, c.y); }
  if(pendBirth > 0 && take('birth')){ pendBirth--; const c = pick(nearHerb) || pick(nearOmni); if(c) birthTick(c.x, c.y); }
}

/* ---------- chronicle stingers: one short motif per event class ---------- */
function motif(degs, step, type, vol, dur){
  if(!ctx) return;
  try{
    let t = ctx.currentTime + 0.02;
    for(const d of degs){
      if(!claim(step + dur, 2)) return;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.value = Math.max(24, hz(d));
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.001, vol * cfg.sfxVol), t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(sfxGain); ends(o, o, g); o.start(t); o.stop(t + dur + 0.02); t += step;
    }
  }catch(e){}
}
function stinger(key){
  if(!take('sting')) return;
  const k = key || '';
  if(k === 'colonize') motif([0, 4, 7, 11, 14], 0.09, 'triangle', 0.16, 0.5);          // a rising launch
  else if(k === 'husbandry') motif([0, 4, 7, 4, 7, 12], 0.15, 'sine', 0.15, 0.7);      // warm and settled
  else if(k === 'pandemic'){ motif([-14, -13, -14], 0.5, 'sawtooth', 0.14, 1.7); M.mourn = Math.max(M.mourn, 0.45); }
  else if(k === 'brain') motif([14, 18, 21, 25], 0.07, 'sine', 0.14, 0.45);            // a bright flourish
  else if(k === 'boom') motif([0, 2, 4, 7, 9, 11, 14], 0.06, 'triangle', 0.13, 0.4);
  else if(k === 'crash'){ motif([7, 4, 2, -3, -7], 0.13, 'triangle', 0.15, 0.8); M.mourn = Math.max(M.mourn, 0.5); }
  else if(k.indexOf('extinct') === 0){ M.mourn = 1; motif([-7, -14], 1.1, 'sine', 0.2, 2.6); }   // silence, then a slow toll
  else if(k.indexOf('return') === 0) motif([-7, 0, 4, 7], 0.16, 'sine', 0.14, 0.9);    // life comes back
  else if(k === 'species') motif([7, 11, 14, 18], 0.05, 'sine', 0.11, 0.7);
  else if(k === 'dialect') motif([4, 6, 9, 7], 0.11, 'square', 0.07, 0.35);            // an accent drifting apart
  else if(k === 'ornament' || k === 'armament' || k === 'herbshow') motif([9, 14, 16], 0.1, 'triangle', 0.12, 0.6);
  else if(k.indexOf('nest_') === 0) motif([2, 5], 0.09, 'sine', 0.1, 0.3);             // a soft knock
  else motif([7, 12], 0.12, 'sine', 0.1, 0.5);                                          // gen and anything new
}
function scanEvents(){
  const ch = S.chronicle;
  if(!ch || !ch.length){ seenTop = null; return; }
  const top = ch[0], id = top.tick + '|' + top.key;
  if(seenTop === id) return;
  if(seenTop === null){ seenTop = id; return; }              // first sight: adopt, do not replay history
  let fired = 0;
  for(let i = 0; i < ch.length && i < 6; i++){
    if(ch[i].tick + '|' + ch[i].key === seenTop) break;
    if(fired++ < 2) stinger(ch[i].key);                      // at most two motifs per frame
  }
  seenTop = id;
}

/* ---------- the one exported driver: called once per animation frame ---------- */
export function audioTick(){
  if(!ctx || ctx.state !== 'running') return;                // no context, or asleep: do nothing
  try{
    const now = ctx.currentTime;
    let dt = now - lastT; lastT = now;
    if(!(dt > 0) || dt > 0.5) dt = 1 / 60;                   // tab was hidden: do not fire a burst
    if((frameN++ % 12) === 0) census();                      // bounded: one pass a few times a second
    if((frameN % 900) === 3){                                // measured accents, sampled sparingly
      try{ const d = dialectStats(); accent = {}; for(const e of d.top) accent[e.lin] = e.v; }catch(e){ accent = null; }
    }
    refill(dt);
    updateParams(dt);
    if(cfg.music) scheduleMusic(now);
    if(cfg.sfx){ scanEvents(); vocalise(); soundscape(dt); diegetic(); }
    prune(now);
  }catch(e){}
}

/* ---------- one-shot effects ---------- */
export function sfxMeteor(x, y){
  if(!cfg.sfx || !ctx) return;
  if(!claim(0.6, 6)) return;
  try{
    const t = ctx.currentTime;
    const z = S.cam.zoom || 1;
    const px = x === undefined ? S.cam.x + (S.W || 900) / z * 0.5 : x, py = y === undefined ? S.cam.y + (S.H || 600) / z * 0.5 : y;
    const dest = spat(px, py, sfxGain);
    const s = noiseSrc(), lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1400, t); lp.frequency.exponentialRampToValueAtTime(120, t + 0.5);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.7 * cfg.sfxVol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    s.connect(lp); lp.connect(g); g.connect(dest); ends(s, s, lp, g);
    s.start(t, Math.random(), 0.62); s.stop(t + 0.6);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.4);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.6 * cfg.sfxVol, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(og); og.connect(dest); ends(o, o, og, dest);
    o.start(t); o.stop(t + 0.5);
    M.mourn = Math.max(M.mourn, 0.3);                        // the score flinches at an impact
  }catch(e){}
}
function tune(freqs, step){
  if(!cfg.sfx || !ctx) return;
  try{
    let t = ctx.currentTime;
    for(const f of freqs){
      if(!claim(step * 1.5, 2)) return;
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2 * cfg.sfxVol, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + step * 1.4);
      o.connect(g); g.connect(sfxGain); ends(o, o, g); o.start(t); o.stop(t + step * 1.5); t += step;
    }
  }catch(e){}
}
export function sfxWin(){ tune([523.25, 659.25, 783.99, 1046.5], 0.12); }
export function sfxLose(){ tune([392, 329.63, 261.63], 0.2); }

// instrumentation for the test harness: pool occupancy and the live score parameters
export function audioDebug(){
  return { voices: pool.length, cap: VOICE_CAP, peak: peakVoices, made: madeVoices, dropped: droppedVoices,
    nodes: pool.reduce((a, v) => a + v.n, 0), pad: pad.length,
    mode: +M.mode.toFixed(3), root: +M.root.toFixed(2), dens: +M.dens.toFixed(3), layers: +M.layers.toFixed(2),
    diss: +M.diss.toFixed(3), cut: Math.round(M.cut), light: +M.light.toFixed(3), mourn: +M.mourn.toFixed(3), beat: +M.beat.toFixed(3),
    pop: W.pop, herb: W.herb, omni: W.omni, carn: W.carn, bio: W.bio, stress: +W.stress.toFixed(3),
    ctx: ctx ? ctx.state : 'none', talkers: talkers.length };
}
export function audioResetPeak(){ peakVoices = pool.length; }
