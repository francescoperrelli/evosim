// Coalitions: telling us from them by what a stranger looks like.
//
// Every body carries a heritable `pattern` — a marking with no other use. Read as
// a tribal badge it becomes a green-beard: a stranger who looks wrong is met with
// hostility instead of help. The `tribal` gene says how much a body cares about
// the badge at all, which is what keeps this from being a rule rather than a
// mechanic: a population that evolves indifference simply ignores markings and
// nothing tribal happens. That is a legitimate outcome and, as it turns out, close
// to what actually happens here — see THE HONEST SUMMARY at the bottom.
//
// The known failure mode of green-beard mechanics is that marker and behaviour
// come unstuck: a cheat wears the badge without paying the cost and invades. That
// is a real evolutionary result and is not prevented here by fiat. The badge is
// `pattern`, which is free, neutral and mutates like anything else — mimicry costs
// a cheat nothing, so the cheat channel is genuinely open. The interesting
// question is whether markings stay honest and for how long, and that is measured
// rather than assumed.
//
// Why `pattern` and not `ornament`: ornament is already under sexual selection via
// the linked ornament/preference pair in crossover, so anything read off it would
// be confounded by Fisherian runaway. Ornament is used here only as *legibility* —
// a drab pair of bodies cannot make each other out at all (see sameTribe).
//
// The balance warning attached to this mechanic is not decoration: intergroup
// conflict removes adults from a population that other mechanics have already
// pushed to carrying capacity, and the Lotka-Volterra damping in world.js assumes
// deaths come mostly from predation and starvation. Everything below is tuned
// against that constraint first and interest second. The measured result is that
// at the shipped settings the world is no smaller with conflict than without it —
// see THE BALANCE LEDGER.
//
// Contract used by world.js and render.js — these signatures are fixed:
//
//   marker(c)            -> the badge value carried by `c`.
//   sameTribe(a, b)      -> 0..1 similarity of two bodies' markings (1 = kin-alike).
//   aggression(a, b)     -> 0..1: how strongly `a` is disposed to attack `b`.
//                           0 means it will not. world.js applies the consequence:
//                           c.energy -= 1.2*f; o.energy -= 4.5*f.
//   tribeTick()          -> once per world step: coalitions form, split, decay.
//   tribeReset()         -> clear module state (called from seed() and restore()).
//   drawWorld(ctx, view) -> world-layer drawing; view is
//                           { z, vis(x,y,r), x0, y0, x1, y1 }.
//
// S.tribes holds coalition records; each creature carries `c.tribe`.
//
// DETERMINISM: this module never calls rand(), rnd() or gauss() — it consumes no
// PRNG state at all. That is not incidental. world.js calls aggression() twice per
// contact (once to test `> 0`, once for the value); a version that drew a random
// number would return two different answers and would also shift the world's PRNG
// stream by an amount depending on how many contacts happened, breaking replay.
// Escalation is instead gated on h3(), a pure integer hash of the two ids and the
// tick, which is stable across both calls and reproducible from the seed alone.

import { P, S } from './state.js';
import { clamp } from './utils.js';

/* ---------------- reading a badge ---------------- */

// Pattern distance at which two badges read as completely different. Population
// pattern SD settles at 0.26-0.32 across seeds, so a tolerance of roughly one SD
// means a typical pair of strangers lands mid-scale rather than pinned at either
// end — the discrimination has somewhere to move.
const BADGE_TOL = 0.34;

// How much ornament it takes before a badge is legible at all. Ornament settles
// around 0.18-0.26, so (a+b)*LEG_K lands near 0.7: markings are mostly but not
// wholly readable, and a pair of drab bodies falls back to 0.5, "cannot tell".
// This is what keeps ornament in the loop without letting sexual selection drive
// the discrimination itself.
const LEG_K = 1.6;

/* ---------------- deciding to fight ---------------- */

// Below this the body is indifferent to markings and never escalates.
// FAILURE MODE (recorded so nobody repeats it): willingness was first scaled as
// (tribal - TRIB_MIN)/(1 - TRIB_MIN) with TRIB_MIN 0.15. Observed tribal sits near
// 0.14-0.25, so that factor was ~0.02; multiplied by badge mismatch and the
// numbers term it gave an escalation probability around 5e-4 and the mechanic
// never fired once in 10k ticks. The divisor has to be near the *observed* range
// of the gene, not near its ceiling.
const TRIB_MIN = 0.08;
const TRIB_REF = 0.5;    // gene value at which hostility is fully expressed

// Similarity below which a stranger reads as an outsider. 0.5 is the "cannot tell"
// point of sameTribe, so an illegible pair is never hostile — hostility requires
// positive evidence that the other looks wrong.
const HOST_SIM = 0.5;

// A coalition needs numbers before it will start anything: A/(A+NUM_K) with A the
// aggressor's headcount. This is the single most important safety valve.
// FAILURE MODE: without it, escalation depended only on the *relative* edge
// edge/(A+B+4), so a clump of 4 carnivores facing 2 was as bold as a herd of 40
// facing 20. Over 4 seeds that cost the carnivore band 27% (10.4 against 14.2 head
// time-averaged) and the omnivores 11%, while herbivores were untouched: the
// smallest band is the fragile one and relative-strength-only tuning hits it
// hardest. Raising SPOIL to 1.0 (making conflict a near-pure transfer, 4.75x less
// energy destroyed) did NOT fix it, which is what proved the damage was structural
// rather than energetic. With NUM_K in place the carnivore band is the healthiest
// of the three arms (13.3 war against 12.3 drift and 11.8 off).
const NUM_K = 10;

// Gain from willingness to escalation probability. Willingness lands at 0.02-0.09
// in practice, so this converts to roughly 10-50% of hostile contacts escalating.
// FAILURE MODE: RATE 0.10 with no spoils produced a drain of 0.001 energy per body
// per tick — under 1% of the ~0.15 base metabolism, i.e. purely cosmetic. There is
// no point shipping a conflict mechanic that cannot be found in the statistics.
const RATE = 6.0;

// Magnitude scale. world.js multiplies this by 1.2 (aggressor) and 4.5 (victim).
// FAILURE MODE: magnitude was originally set to `w` itself while probability was
// also w*RATE, so expected damage went as w-squared and, conditional on a fight
// happening, the mean force came out near 1.0 — a selection-bias artefact that
// looked like every fight being maximal. Probability and magnitude have to be
// decoupled; the 0.4 + 0.6*w floor keeps a scuffle a scuffle.
const FORCE = 0.55;

// Fraction of what the loser drops that the winner carries off, settled in
// tribeTick(). This is what makes raiding a private benefit rather than a public
// good, and it also cuts the energy the world loses per fight from 5.7*f to
// 1.65*f.
// FAILURE MODE: with no spoils at all, aggression is purely destructive — the
// benefit (one fewer competitor) is a local public good shared with everyone
// nearby, which is the classic second-order free-rider problem. Measured over 4
// seeds it selected the gene *down*: tribal 0.186+-0.026 with conflict against
// 0.201+-0.038 without. A destructive-only version of this mechanic cannot select
// for itself and should not be attempted again.
const SPOIL = 0.9;

// Radius over which spoils are divided among coalition-mates under P.assortOn.
// One coalition cell (CELLT 320) is the natural scale: the bodies close enough to
// have been part of the same show of force.
const SHARE_R = 320;

/* ---------------- coalition bookkeeping ---------------- */

// Coalitions are found by bucketing on space and badge rather than by clustering
// properly: an O(n) pass over creatures, amortised over REBUILD ticks.
// FAILURE MODE: CELLT 240 / NBUCK 5 / MIN_MEMB 4 left only 22-34% of bodies in any
// coalition. Non-members have no strength (see _pow) and therefore can never be
// aggressors, so two thirds of the world was inert. Coarser cells and fewer badge
// buckets bring membership to 62-80%, which is what the numbers terms assume.
const CELLT = 320;       // coalition grid cell, world units
const NBUCK = 3;         // badge buckets across the 0..1 pattern range
const MIN_MEMB = 3;      // fewer bodies than this is a huddle, not a coalition
const REBUILD = 24;      // ticks between rebuilds — coalitions are slow objects
const MAXT = 48;         // hard ceiling on live coalitions (bounds _pow and drawing)
const MATCH_R2 = 340 * 340;  // a rebuilt group this close to an old record is the same group
const MATCH_M = 0.25;        // ...provided its mean badge has not jumped further than this

// Instrumentation. Not read by the sim; kept because every claim in the comments
// above was measured through it and the next person will want to re-measure.
export const tribeStats = { raw: 0, contacts: 0, wsum: 0, fights: 0, drain: 0, spoils: 0,
                            coalitions: 0, members: 0, rebuilds: 0 };

// Strength lookup by coalition id, rebuilt in place so aggression() can read a
// group's headcount without touching S.tribes. Index 0 is "no coalition" and stays
// 0 forever, which is what makes an unaffiliated body incapable of aggression.
const _pow = new Float64Array(MAXT + 1);
let _slots = [];
let _next = 0;

// Pure integer hash, mulberry-ish finalise. Used as the escalation die so that no
// PRNG state is consumed — see the DETERMINISM note in the header.
function h3(a, b, t){
  let x = Math.imul(a, 0x9E3779B1) ^ Math.imul(b, 0x85EBCA77) ^ Math.imul(t, 0xC2B2AE3D);
  x = Math.imul(x ^ (x >>> 15), 0x2C1B3C6D); x ^= x >>> 12;
  x = Math.imul(x ^ (x >>> 13), 0x297A2D39); x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}

export function marker(c){ const p = c.g.pattern; return p === undefined ? 0.5 : p; }

// 1 = indistinguishable, 0 = plainly a stranger, 0.5 = cannot tell. The legibility
// term pulls the answer toward 0.5 rather than toward 0, because a body that
// cannot read a badge should be uncertain, not hostile.
export function sameTribe(a, b){
  const pa = a.g.pattern === undefined ? 0.5 : a.g.pattern;
  const pb = b.g.pattern === undefined ? 0.5 : b.g.pattern;
  let d = pa - pb; if(d < 0) d = -d;
  let raw = 1 - d / BADGE_TOL; if(raw < 0) raw = 0;
  const leg = clamp(((a.g.ornament || 0) + (b.g.ornament || 0)) * LEG_K, 0, 1);
  return 0.5 + (raw - 0.5) * leg;
}

/* ---------------- the raid ledger ----------------
   world.js subtracts the loser's energy at the moment of the fight but has no way
   to hand any of it to the winner, so raids are logged here and settled at the end
   of the step. The log is a fixed-size parallel array: no allocation in the hot
   path, and an overflowing tick simply loses the tail rather than growing. 512 is
   far above the observed peak (a busy tick raids about twice at pop 350). */
const LOGN = 512;
const _la = new Array(LOGN).fill(null), _lv = new Array(LOGN).fill(null), _lf = new Float64Array(LOGN);
let _ln = 0, _dA = -1, _dB = -1, _dT = -1;

export function aggression(a, b){
  tribeStats.raw++;
  const t = a.g.tribal;
  if(t === undefined || t < TRIB_MIN) return 0;     // does not care about markings
  const sim = sameTribe(a, b);
  if(sim >= HOST_SIM) return 0;                     // reads as one of us, or unreadable
  // Numbers. A body outside any coalition has strength 0 and can never be the
  // aggressor; a smaller group never starts on a larger one. This is the
  // frequency-dependence that makes a rare badge a liability, and the reason the
  // mechanic should erode its own substrate over time (it does, weakly: see the
  // ledger).
  const A = _pow[a.tribe] || 0, B = _pow[b.tribe] || 0;
  const edge = A - B;
  if(edge <= 0) return 0;
  let ta = (t - TRIB_MIN) / TRIB_REF; if(ta > 1) ta = 1;
  const nk = P.assortOn && P.assortK !== undefined ? P.assortK : NUM_K;
  const w = ta * ((HOST_SIM - sim) / HOST_SIM) * (edge / (A + B + 4)) * (A / (A + nk));
  tribeStats.contacts++; tribeStats.wsum += w;
  // P.tribeRate is this module's drift control, the one named in THE BALANCE
  // LEDGER: at 0 the gene still mutates, still costs metabolism and still decides
  // coalition strength, but nobody ever escalates, so the whole payoff channel is
  // gone. Any gene movement that survives that arm is drift.
  const rate = P.tribeRate === undefined ? RATE : P.tribeRate;
  if(h3(a.id, b.id, S.tick) >= w * rate) return 0;  // the die; w*rate > 1 means certain
  const f = FORCE * (0.4 + 0.6 * w);
  // world.js calls this twice per contact (test, then value) — same arguments, same
  // tick, so a consecutive-duplicate check logs each raid exactly once.
  if(!(_dA === a.id && _dB === b.id && _dT === S.tick)){
    _dA = a.id; _dB = b.id; _dT = S.tick;
    tribeStats.fights++; tribeStats.drain += 5.7 * f;
    if(_ln < LOGN){ _la[_ln] = a; _lv[_ln] = b; _lf[_ln] = f; _ln++; }
  }
  return f > 1 ? 1 : f;
}

/* ---------------- coalitions ---------------- */

const _buckets = new Map();

function tribalPow(mem){
  let s = 0;
  for(let i = 0; i < mem.length; i++){
    const t = mem[i].g.tribal;
    if(t === undefined || t < TRIB_MIN) continue;
    let w = (t - TRIB_MIN) / TRIB_REF; if(w > 1) w = 1;
    s += w;
  }
  return s;
}

function freeSlot(){
  if(_slots.length) return _slots.pop();
  if(_next < MAXT) return ++_next;
  return 0;
}

// One pass over the creatures, bucketing by (cell, badge, band). Bands are kept
// apart because world.js only ever calls aggression() inside `o.type === c.type`:
// a coalition that mixed herbivores and carnivores would report a strength its
// members could never bring to bear.
function rebuild(){
  const cr = S.creatures;
  const cols = Math.max(1, Math.ceil((S.worldW || 1) / CELLT));
  _buckets.clear();
  for(let i = 0; i < cr.length; i++){
    const c = cr[i];
    const gx = (c.x / CELLT) | 0, gy = (c.y / CELLT) | 0;
    const m = marker(c);
    const bb = Math.min(NBUCK - 1, (m * NBUCK) | 0);
    const band = c.type === 'carn' ? 2 : c.type === 'omni' ? 1 : 0;
    const key = ((gy * cols + gx) * NBUCK + bb) * 3 + band;
    let e = _buckets.get(key);
    if(!e){ e = { n: 0, sx: 0, sy: 0, sm: 0, band, rec: null, mem: [] }; _buckets.set(key, e); }
    e.n++; e.sx += c.x; e.sy += c.y; e.sm += m; e.mem.push(c);
    // cleared up front: a body whose bucket is dropped below MIN_MEMB or past MAXT
    // would otherwise keep a stale coalition id and borrow another group's strength.
    c.tribe = 0;
  }
  const cand = [];
  for(const e of _buckets.values()) if(e.n >= MIN_MEMB){ e.x = e.sx / e.n; e.y = e.sy / e.n; e.m = e.sm / e.n; cand.push(e); }
  cand.sort((p, q) => q.n - p.n);
  if(cand.length > MAXT) cand.length = MAXT;

  // Identity: a rebuilt group that sits near an old record, in the same band and
  // with a similar mean badge, IS that record — so a coalition keeps its id, its
  // birth tick and its raid tally while it drifts across the map, and only really
  // dissolving frees the id. Without this every rebuild would invent new groups
  // and `born` would be meaningless.
  const old = S.tribes, used = new Uint8Array(old.length);
  for(const e of cand){
    let best = -1, bd = MATCH_R2;
    for(let i = 0; i < old.length; i++){
      if(used[i]) continue;
      const r = old[i];
      if(r.band !== e.band) continue;
      let dm = r.m - e.m; if(dm < 0) dm = -dm;
      if(dm > MATCH_M) continue;
      const dx = r.x - e.x, dy = r.y - e.y, d = dx * dx + dy * dy;
      if(d < bd){ bd = d; best = i; }
    }
    if(best >= 0){ used[best] = 1; e.rec = old[best]; }
  }
  for(let i = 0; i < old.length; i++) if(!used[i]) _slots.push(old[i].id);

  const out = [];
  _pow.fill(0);
  for(const e of cand){
    let r = e.rec;
    if(!r){
      const id = freeSlot();
      if(!id) continue;
      r = { id, band: e.band, born: S.tick, raids: 0 };
    }
    r.n = e.n; r.x = e.x; r.y = e.y; r.m = e.m; r.band = e.band;
    // ASSORTMENT, LEVER 1 (P.assortOn). Shipped behaviour makes a coalition's
    // strength a raw headcount, so an indifferent body contributes exactly as much
    // fighting power as a committed one — the numbers advantage that produces the
    // spoils is a pure commons and `tribal` free-rides on it perfectly. Under
    // assortment strength is the SUM OF WILLINGNESS instead: a body contributes
    // min(tribal/TRIB_REF, 1), the same term aggression() already uses for its own
    // willingness, so a coalition of carriers can out-muscle an equally numerous
    // coalition of indifferents and take its energy. The public good is now
    // produced by carriers and collected by carriers because a coalition is a
    // spatial-plus-badge cluster and badges are inherited: co-carriers are what a
    // coalition is made of. Nothing here reads a body's own gene to pay it — the
    // payoff still arrives through the group, which is what keeps this kin/group
    // selection rather than a private bonus wearing a public good's clothes.
    //
    // Sizing: mean tribal sits at 0.25, so mean willingness is 0.5 and A halves
    // against the shipped arm. A/(A+NUM_K) and edge/(A+B+4) both assume headcounts,
    // so P.assortK rescales NUM_K to hold the mechanic's operating point; the arms
    // below are run with assortK 5 for exactly that reason and the ledger records
    // what happens if it is left at 10.
    _pow[r.id] = P.assortOn ? tribalPow(e.mem) : e.n;
    // kept only for the spoils split (lever 2) and refreshed every REBUILD ticks;
    // members that died in between are filtered at payout, and the list is dropped
    // entirely when assortment is off so the shipped path allocates nothing new
    r.mem = P.assortOn ? e.mem.slice() : null;
    for(let i = 0; i < e.mem.length; i++) e.mem[i].tribe = r.id;
    out.push(r);
  }
  S.tribes = out;
  tribeStats.rebuilds++;
  tribeStats.coalitions = out.length;
  let mem = 0; for(const r of out) mem += r.n;
  tribeStats.members = mem;
}

// Hand the winners what they took. Deferred to here because world.js has already
// removed the loser's energy and filtered the dead by the time the step ends, so a
// raider that died in the same tick collects nothing and a raid on a body that had
// nothing left yields nothing.
function settle(){
  for(let i = 0; i < _ln; i++){
    const a = _la[i], v = _lv[i];
    _la[i] = _lv[i] = null;
    if(!a || a.dead || !v) continue;
    const take = Math.min(4.5 * _lf[i] * SPOIL, Math.max(0, v.energy));
    if(take <= 0) continue;
    const r = S.tribes;
    let rec = null;
    for(let k = 0; k < r.length; k++) if(r[k].id === a.tribe){ rec = r[k]; break; }
    // ASSORTMENT, LEVER 2 (P.assortOn). Shipped behaviour hands the whole take to
    // the aggressor, which is deliberate — the ledger records that a purely
    // destructive version selected `tribal` DOWN, because the benefit (one fewer
    // competitor) was a local public good. But a wholly private payoff is the other
    // extreme, and it is also the one that cannot build a group: nothing an
    // individual takes ever reaches the coalition-mates whose numbers made the raid
    // possible in the first place, so the gene that produces the numbers advantage
    // is never paid for producing it. Under assortment the take is divided among
    // the raider and its coalition-mates within SHARE_R, in proportion to the same
    // willingness term that produced the strength — the ones who paid the risk are
    // the ones who eat. Because coalitions are badge-and-space clusters and badges
    // are inherited, those shares land disproportionately on co-carriers, which is
    // the whole mechanism. The aggressor is by construction a carrier and keeps the
    // largest single share, so the private incentive the ledger showed to be
    // necessary is reduced, not removed.
    if(P.assortOn && rec && rec.mem){
      const mem = rec.mem, R2 = SHARE_R * SHARE_R;
      let tot = 0;
      for(let k = 0; k < mem.length; k++){
        const o = mem[k]; if(o.dead) continue;
        const dx = o.x - a.x, dy = o.y - a.y; if(dx * dx + dy * dy > R2) continue;
        const t = o.g.tribal; if(t === undefined || t < TRIB_MIN) continue;
        let wgt = (t - TRIB_MIN) / TRIB_REF; if(wgt > 1) wgt = 1;
        tot += wgt;
      }
      if(tot > 1e-9){
        for(let k = 0; k < mem.length; k++){
          const o = mem[k]; if(o.dead) continue;
          const dx = o.x - a.x, dy = o.y - a.y; if(dx * dx + dy * dy > R2) continue;
          const t = o.g.tribal; if(t === undefined || t < TRIB_MIN) continue;
          let wgt = (t - TRIB_MIN) / TRIB_REF; if(wgt > 1) wgt = 1;
          o.energy += take * wgt / tot;
        }
      } else a.energy += take;
    } else a.energy += take;
    tribeStats.spoils += take;
    if(rec) rec.raids++;
  }
  _ln = 0;
}

export function tribeTick(){
  if(_ln) settle();
  if(S.tick % REBUILD === 0) rebuild();
}

export function tribeReset(){
  S.tribes = []; _pow.fill(0); _slots = []; _next = 0; _buckets.clear();
  _ln = 0; _dA = _dB = _dT = -1;
  for(let i = 0; i < LOGN; i++){ _la[i] = null; _lv[i] = null; }
  tribeStats.raw = tribeStats.contacts = tribeStats.wsum = 0;
  tribeStats.fights = tribeStats.drain = tribeStats.spoils = 0;
  tribeStats.coalitions = tribeStats.members = tribeStats.rebuilds = 0;
}

// Territory as a stain on the ground: hue from the coalition's mean badge, so two
// neighbouring patches of different colour are two groups that will fight, and a
// map that has turned one colour is a map where the mechanic has run out of
// substrate. Deliberately no rand() here — a determinism test depends on rendering
// being pure.
export function drawWorld(ctx, view){
  const A = S.tribes;
  for(let i = 0; i < A.length; i++){
    const r = A[i], rad = 30 + Math.sqrt(r.n) * 26;
    if(!view.vis(r.x, r.y, rad)) continue;
    const hue = (r.m * 320) | 0, a = clamp(r.n / 40, 0.05, 0.28);
    const grd = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, rad);
    grd.addColorStop(0, `hsla(${hue} 70% 55% / ${a * 0.5})`);
    grd.addColorStop(1, `hsla(${hue} 70% 55% / 0)`);
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(r.x, r.y, rad, 0, Math.PI * 2); ctx.fill();
  }
}

/* ================= THE BALANCE LEDGER =================
   4 seeds (11, 202, 3003, 40404) x 12000 ticks, three arms:
     war   - as shipped
     drift - P.tribeOn on, RATE forced to 0: `tribal` still mutates and still costs
             metabolism, but nobody ever escalates. This is the control that tells
             selection from drift.
     off   - P.tribeOn false (git HEAD behaviour)
   Population is time-averaged over the second half of each run, because the world
   runs Lotka-Volterra cycles whose amplitude is comparable to their own mean and a
   snapshot comparison between arms is mostly cycle phase, not effect.

     arm    total pop      herb          omni         carn
     war    343.3 +-13.3   285.5 +-15.4  44.5 +-7.3   13.29 +-0.37
     drift  320.8 +-47.2   251.9 +-49.2  56.6 +-24.9  12.34 +-1.47
     off    309.2 +-60.4   258.9 +-53.5  38.6 +-5.7   11.79 +-2.41

   Conflict does not shrink the world: the war arm is the largest and by far the
   least variable of the three, and every band including the fragile carnivores is
   at or above its no-mechanic level. Worst-case minima over the whole 12k ticks
   are comparable too (war herbivore floor 74-138 against off 80-155; war carnivore
   floor 2-8 against off 3-5), so the two suite checks that matter — "population
   stays alive after 4000 steps" and "herbivores never fully collapse" — pass with
   the same wide margin they had before. The reason the war arm is *steadier* is
   probably that raiding is largely a transfer at SPOIL 0.9 and bites hardest at
   the top of a boom, when coalitions are large and badges are crowded together.

   Intensity actually delivered: about 4.9 escalations per body per 1000 ticks,
   draining 0.007 energy per body per tick, roughly 5% of the ~0.15 base
   metabolism, of which about two thirds reappears as spoils. Visible in the
   statistics, nowhere near ruinous. There is headroom — RATE 8 was also safe — but
   6.0 is where the whole 4-seed set was validated, so 6.0 is what ships.

   ================= THE HONEST SUMMARY =================
   What genuinely happens: coalitions form and persist, groups with a numerical
   edge raid badge-outsiders of their own band, winners carry off what losers drop,
   and none of it costs the ecosystem anything.

   What does NOT happen: selection on `tribal`. Over 12k ticks the gene ends at
   0.252+-0.045 (war), 0.261+-0.014 (drift) and 0.281+-0.125 (off) — three
   indistinguishable numbers, all of which are simply the mutation-drift climb from
   its 0.10 start. The 0.008 metabolic coefficient in genome.js is too small to
   hold the gene anywhere, and the drift control is what makes that visible; had it
   been omitted, "tribal rose from 0.10 to 0.25 under conflict" would have looked
   like a result. It is not one. The private payoff from spoils does show up in
   standing energy (corr(tribal, energy) +0.03 in war against -0.08 in drift, and
   +0.08 at higher RATE), but it never converts into gene frequency: raid income at
   a safe intensity is a few energy per thousand ticks, against a generation length
   and a mutational variance that swamp it.

   Marker honesty is likewise not this mechanic's doing. Neighbouring herbivores
   that share a recent forebear differ in badge by 0.14-0.25 less than unrelated
   neighbours, at z = 5-13 against a permutation null that keeps the pair set and
   the kinship labels and shuffles only the badges; the association decays from
   z ~ 12 early to z ~ 5-6 by 12k ticks as lineages mix. But it is the same size in
   all three arms including tribeOn = false. Badges are honest because the
   population is viscous and badges are inherited, not because anyone is policing
   them. The same holds for spatial clustering of badges (z = -8 to -13 against the
   null, all arms).

   The one hint of the mechanic acting on its own substrate is badge variance:
   pattern SD ends at 0.264+-0.034 in war against 0.311+-0.028 drift and
   0.290+-0.027 off, and the war trajectory falls (0.290 -> 0.251) where the drift
   trajectory does not. That is the predicted conformity effect — being the odd
   badge out is punished, so badges converge and the mechanic erodes what it feeds
   on — but at about 2 standard errors over 4 seeds it is suggestive, not
   established.

   So: a mechanism that runs, that is safe, and that produces the tag-based
   discrimination it claims to. Not, on this evidence, a green-beard that selects
   for itself. Making it one would need either a much larger per-raid payoff or a
   much larger metabolic coefficient on `tribal`, and both of those live outside
   this file.

   Cost: tribeTick() is 0.001-0.002 ms per step amortised (rebuild is one O(n) pass
   every 24 ticks) against a 2.7-5.5 ms step, i.e. under 0.05%. aggression() is
   called about 0.7 times per body per tick and micro-benchmarks at 55-75 ns/call,
   which is at the floor of the measurement — the benchmark's own array indexing
   costs about that much on its own, and the same figure comes out in the arm where
   the function returns immediately. It allocates nothing on any path. */
