// Synthesized audio (WebAudio) — generative ambient music + sound effects.
// No external assets; everything is generated at runtime.
let ctx = null, master = null, musicGain = null, sfxGain = null, started = false, pluckTimer = null;
const cfg = { music: true, sfx: true };

export const musicOn = () => cfg.music;
export const sfxOn = () => cfg.sfx;

export function initAudio(){
  if(ctx){ if(ctx.state === 'suspended') ctx.resume(); return; }
  try{
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.6; master.connect(ctx.destination);
    musicGain = ctx.createGain(); musicGain.gain.value = 0.0001; musicGain.connect(master);
    sfxGain = ctx.createGain(); sfxGain.gain.value = 0.5; sfxGain.connect(master);
    if(cfg.music) startMusic();
  }catch(e){ ctx = null; }
}

export function setMusic(on){
  cfg.music = on;
  if(!ctx){ if(on) initAudio(); return; }
  if(on && !started) startMusic();
  musicGain.gain.setTargetAtTime(on ? 0.12 : 0.0001, ctx.currentTime, 0.6);
}
export function setSfx(on){ cfg.sfx = on; }

function startMusic(){
  if(!ctx || started) return; started = true;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 720; lp.connect(musicGain);
  const chord = [110, 164.81, 220, 277.18];   // soft A-minor-ish drone
  chord.forEach((f, i) => {
    const o = ctx.createOscillator(); o.type = i % 2 ? 'sine' : 'triangle'; o.frequency.value = f;
    const g = ctx.createGain(); g.gain.value = 0.12 / chord.length; o.connect(g); g.connect(lp);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.03 + 0.02 * i;
    const lg = ctx.createGain(); lg.gain.value = 3.5; lfo.connect(lg); lg.connect(o.detune); lfo.start();
    o.start();
  });
  musicGain.gain.setTargetAtTime(cfg.music ? 0.12 : 0.0001, ctx.currentTime, 1.5);
  const notes = [440, 493.88, 587.33, 659.25, 880];   // occasional pentatonic pluck
  pluckTimer = setInterval(() => { if(cfg.music && ctx) pluck(notes[(Math.random() * notes.length) | 0]); }, 5200);
}
function pluck(f){
  try{
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.08, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    o.connect(g); g.connect(musicGain); o.start(t); o.stop(t + 1.5);
  }catch(e){}
}

function noiseSource(dur){
  const n = (ctx.sampleRate * dur) | 0, buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  for(let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const s = ctx.createBufferSource(); s.buffer = buf; return s;
}

export function sfxMeteor(){
  if(!cfg.sfx || !ctx) return;
  try{
    const t = ctx.currentTime;
    const s = noiseSource(0.6), lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1400, t); lp.frequency.exponentialRampToValueAtTime(120, t + 0.5);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.7, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    s.connect(lp); lp.connect(g); g.connect(sfxGain); s.start(t); s.stop(t + 0.6);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.4);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.6, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(og); og.connect(sfxGain); o.start(t); o.stop(t + 0.5);
  }catch(e){}
}
function tune(freqs, step){
  if(!cfg.sfx || !ctx) return;
  try{
    let t = ctx.currentTime;
    for(const f of freqs){
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + step * 1.4);
      o.connect(g); g.connect(sfxGain); o.start(t); o.stop(t + step * 1.5); t += step;
    }
  }catch(e){}
}
export function sfxWin(){ tune([523.25, 659.25, 783.99, 1046.5], 0.12); }
export function sfxLose(){ tune([392, 329.63, 261.63], 0.2); }
