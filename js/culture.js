// Cumulative culture: a second channel of inheritance that is not the genome.
//
// Lifetime learning already exists — `learn()` in nn.js nudges a brain's weights
// while it forages and survives. But every one of those nudges dies with the body.
// The missing piece is vertical transmission: a parent passing on what it learned
// rather than only what it was born with. With a `fidelity` gene deciding how much
// of that deviation actually reaches the child, the population gets a ratchet:
// where fidelity is high, an improvement found by one generation is still there
// three generations later, having been improved on again — and none of it is in
// the DNA.
//
// This is the honest route to anything that deserves the word "civilisation" in
// this simulation, and it is also the one that can most easily fool us. A learned
// trait that merely tracks a genetically-determined optimum is not culture; it is
// the genome taking a slower path to the same place. The measurement that matters
// is whether the taught component persists when the genes for it do not — which is
// what cultureIndex() has to be built to show, not to assert.
//
// Contract used by world.js and render.js — these signatures are fixed:
//
//   inherit(parent, childGenome) -> called at birth, after the child's genome
//                                   exists and before it is turned into a body.
//                                   Mutates childGenome.brain in place to carry
//                                   some of what the parent LEARNED. MUST use
//                                   rand()/gauss() from utils.js only.
//   cultureTick()                -> once per world step.
//   cultureReset()               -> clear module state (seed() and restore()).
//   cultureIndex()               -> 0..1: how much of the population's competence
//                                   is taught rather than inherited. For the HUD.
//
// Each creature carries `c.culture`: how much of its brain came from teaching.

import { P, S } from './state.js';
// rand/rnd/gauss are deliberately NOT imported: nothing in this module may consume
// the world's PRNG (see inherit() below for why the experiments depend on it).
import { clamp } from './utils.js';
import { NIN, NOUT } from './nn.js';   // nn.js imports only utils/state, so no cycle

// ---------------------------------------------------------------------------
// WHAT IS TRANSMITTED, AND WHY IT IS KEPT OUT OF THE GERMLINE
//
// The only thing a body acquires in its lifetime is `c.plast`, the plastic
// overlay on the hidden->output weights that learn() writes at each rewarded
// moment. So that overlay, plus whatever the body was itself taught at birth, is
// the entire acquired part of a brain, and it is exactly what a parent has to
// give. Teaching writes it into the child's hidden->output block.
//
// The trap is one line further on. world.js builds the child's genome from the
// parent's brain BEFORE calling us — so if we simply add a taught offset, that
// offset is inside `childGenome.brain.w` and it will be copied again by the next
// crossover, and the next. It becomes DNA. The `fidelity` gene would then decide
// only how loud the first shout was, and after that the lesson would ride the
// germline for free no matter how faithless the descendants were. That is
// Lamarckian soft inheritance, not culture, and it would have shown up in the
// measurements as a perfect ratchet — the most convincing fake available here.
//
// So `inherit` does two things, and the first matters more than the second:
//
//   1. it SUBTRACTS the taught offset the parent itself received at birth, which
//      crossover has just copied into the child's brain, and
//   2. it adds a fresh taught offset scaled by the parent's fidelity.
//
// The germline the child passes on is therefore culture-free: the taught part is
// re-created from the parent's own acquired state at every single birth, or it is
// gone. Cut teaching for one generation and the lineage falls back to its genes.
// That is what makes `fidelity` load-bearing rather than decorative, and it is
// what lets cultureIndex() ask an honest question at all: with the offset tracked
// separately (`genome.__t`) we always know a body's realised brain AND the
// germline brain underneath it, and can compare them.
//
// `__t` lives on the genome object rather than in a Map keyed by creature id
// because inherit() runs before the body (and its id) exists. genome.js builds
// every genome field by field, so `__t` is never copied by crossover/mutation by
// accident, and it is collected with the dead body. snapshot() serialises the
// genome field by field too, so a save stores the realised brain and forgets the
// decomposition — the same thing restore() does to every other derived table.
// ---------------------------------------------------------------------------

// How emphatically a lesson is retold. plast at its natural equilibrium has an
// rms of only ~0.011 (measured, 4 seeds x 10k ticks) against a genetic weight
// scale of ~0.45, because learn()'s step is 0.03*reward (reward 0.12..0.2) while
// the overlay is decayed by 0.985 every 6 ticks — so a single lifetime's learning
// is roughly 2% of a weight. Transmitting it at unit gain is behaviourally a
// no-op, and was: at TEACH_GAIN 1 nothing in the world moved at all (see the
// tuning log at the bottom of this file). The gain is what turns "the parent
// nudged its weights while feeding" into "the parent taught the child a habit".
const TEACH_GAIN = 8;
// Ceiling on any one taught weight. The recursion t' = f*(t + gain*plast) is a
// geometric series in f, so at fidelity 0.95 an unbounded lesson would grow ~20x
// before selection could react and would simply drown the genetic brain. 0.8 is
// about two genetic weight sd's: a lesson can dominate a weight, never erase it.
const T_CAP = 0.8;
// Ceiling on the lesson's RMS as a fraction of the child's own germline weight
// scale. See "THE AMPLITUDE CONFOUND" below: this is what stops `fidelity` from
// secretly being a volume knob. P.cultureRel overrides it; set it huge to recover
// the pre-fix behaviour for a paired control.
const T_REL = 0.25;
// How often the culture meter is recomputed. The sweep is the only per-step cost
// this module has and it is O(pop * nh * NOUT) with the paired control doubling
// it; at every 6 ticks (the cadence of world.js's own population meters) it cost
// 0.185 ms/step against a ~3 ms step, which is too much for a HUD number. Every
// 24 ticks it is 0.05 ms/step and the meter still updates ~2.5x per second at
// normal speed. Culture changes on a generational timescale (~600 ticks), so
// nothing is lost by sampling it four times slower.
const SWEEP = 24;

// deterministic pseudo-noise for the P.cultureNoise control arm only (teach random
// content at the same fidelity and the same magnitude). Never used in normal play;
// kept out of rand() so switching the control on does not shift the world's RNG
// stream and the control run stays paired with the real one tick for tick.
let _ns = 0x9e3779b9;
function nrand(){ _ns ^= _ns << 13; _ns ^= _ns >>> 17; _ns ^= _ns << 5; _ns |= 0; return (_ns >>> 0) / 4294967296 - 0.5; }

// Called at birth. `parent` is the primary parent (the body that carried the
// pregnancy, in world.js's sexual branch); `childGenome` already holds the
// recombined + mutated genetic brain.
//
// Deliberately consumes no rand(). Transmission loss is modelled as attenuation
// (fidelity < 1) rather than as added noise, so that a world with the mechanic on
// draws exactly the same random numbers as one with it off. Every paired
// experiment below depends on that: any difference between the arms is caused by
// teaching and not by the two runs having desynchronised their PRNG.
export function inherit(parent, childGenome){
  const pg = parent.g, pb = pg.brain, cb = childGenome.brain;
  const nh = pb.nh;
  // A gained or lost hidden neuron renumbers the whole hidden->output block, so
  // weight i in the child is no longer weight i in the parent and the lesson has
  // no address. Teaching is simply skipped for that birth (~4% of them at the
  // default mutation rate) and the lineage's culture restarts from its genes.
  // Trying to re-index the offset across an addNeuron() was tried and dropped:
  // removeNeuron() takes an arbitrary neuron, so the mapping is not recoverable
  // from the child's genome alone.
  if(cb.nh !== nh) return;
  const n = nh * NOUT, off = nh * NIN + nh;
  const pt = pg.__t;                            // what the parent was taught at ITS birth
  const pl = P.learnOn ? parent.plast : null;   // what the parent learned in its own life
  const w = cb.w;
  // (1) take the parent's culture back out of the germline the child just
  // inherited. Exact for asexual lineages, where the child's brain is the
  // parent's plus mutation noise. For a sexual pair crossBrain() takes each
  // weight from one parent or the other, so only about half of the child's
  // weights carry the parent's offset at all: subtracting half of it is right in
  // expectation and wrong weight by weight. Omnivores therefore leak a little
  // culture into their germline (and subtract a little noise from the mate's
  // weights). inherit() only receives one parent, so a per-weight purge is not
  // possible under the fixed signature — see the report.
  if(pt){
    const share = childGenome.sexual > 0.5 ? 0.5 : 1;
    for(let i = 0; i < n; i++) w[off + i] -= pt[i] * share;
  }
  const f = clamp(pg.fidelity === undefined ? 0 : pg.fidelity, 0, 1);
  if(f <= 0 || (!pt && !pl)) return;             // a faithless parent teaches nothing
  const gain = P.cultureGain === undefined ? TEACH_GAIN : P.cultureGain;
  // (2) the lesson: everything the parent itself was taught, plus everything it
  // worked out for itself, attenuated by fidelity. This sum is the whole of the
  // cumulative claim — a child does not receive its parent's discoveries, it
  // receives its parent's discoveries added to its grandparent's, which is the
  // only way an improvement can be improved on rather than merely repeated.
  const t = new Float32Array(n);
  for(let i = 0; i < n; i++){
    const lesson = (pt ? pt[i] : 0) + (pl ? pl[i] * gain : 0);
    t[i] = clamp(f * lesson, -T_CAP, T_CAP);
  }
  // -------------------------------------------------------------------------
  // THE AMPLITUDE CONFOUND, AND THE ONE PART OF FINDING 3 THAT IS FIXABLE HERE.
  //
  // Finding 3 in the tuning log says high fidelity is actively harmful and that
  // it is the taught offset, not its metabolic price, doing the harm: pinned at
  // f=0.9, income 0.4704+-0.0204 and pop 202+-88, against 0.5513+-0.0325 and
  // 378+-32 for an arm paying the identical metabolic charge but teaching
  // nothing. The mechanism is right there in the recursion t' = f*(t + gain*p):
  // it is a geometric series with ratio f, so its fixed point is gain*|p|/(1-f).
  // At f=0.9 that is ten times the one-generation lesson and taught rms reaches
  // 0.376 against a genetic weight scale of ~0.45. The brain is overwritten.
  //
  // So `fidelity` was not measuring what its name says. It was doing two jobs at
  // once: how much of the parent's CONTENT survives (faithfulness, the thing the
  // mechanic is about) and how LOUD the accumulated lesson is (amplitude, an
  // artefact of the series). Amplitude is monotonically damaging past a low
  // optimum, so the amplitude job buries the faithfulness job and the gene reads
  // as weak stabilising selection toward 0.227 no matter what the content is
  // worth. That is a confound in the instrument, not a fact about the world.
  //
  // Fixing it means bounding the lesson's SIZE while leaving its DIRECTION
  // untouched, which is exactly what a uniform rescale does and exactly what the
  // per-component clamp at T_CAP does not: clamping components changes the
  // direction of any vector that hits the cap, i.e. it corrupts the content of
  // precisely the loudest lessons. The bound is relative to the child's own
  // germline weight scale rather than absolute, because "a nudge" only means
  // anything next to the weights being nudged, and nh varies across the
  // population. At T_REL 0.25 a fully-faithful lineage's accumulated lesson can
  // reach a quarter of its genetic weight scale and no further: enough to change
  // behaviour, never enough to erase the genome underneath it.
  //
  // NOT a way of making culture "stronger" — it is strictly a cap, so it can only
  // ever reduce a taught offset. It removes the amplitude channel from fidelity
  // and leaves the faithfulness channel, which is the only one worth measuring.
  const rel = P.cultureRel === undefined ? T_REL : P.cultureRel;
  if(rel > 0 && rel < 1e6){
    let ww = 0, tt = 0;
    for(let i = 0; i < n; i++){ const a = w[off + i]; ww += a * a; tt += t[i] * t[i]; }
    const lim = Math.sqrt(ww / n) * rel, mag = Math.sqrt(tt / n);
    if(mag > lim && mag > 1e-9){ const s = lim / mag; for(let i = 0; i < n; i++) t[i] *= s; }
  }
  // -------------------------------------------------------------------------
  // CONTROL ARM (off in normal play): teach random content of the same magnitude
  // at the same fidelity. If the world does not care which of these it gets, then
  // teaching is moving bandwidth and not competence.
  if(P.cultureNoise){
    let m = 0; for(let i = 0; i < n; i++) m += t[i] * t[i];
    m = Math.sqrt(m / n);
    for(let i = 0; i < n; i++) t[i] = nrand() * 3.464 * m;   // uniform with the same rms
  }
  for(let i = 0; i < n; i++) w[off + i] = clamp(w[off + i] + t[i], -5, 5);
  childGenome.__t = t;
}

// ---------------------------------------------------------------------------
// THE MEASUREMENT
//
// cultureIndex() has to separate two things that look identical from outside: a
// lesson that carries competence, and a lesson that is merely a copy of what the
// child's own genes would have produced anyway.
//
// The material available per body is its taught offset t (= genome.__t) and its
// own plastic overlay p (= c.plast). p is written by learn() only at moments when
// the world actually paid the body, so p is the environment's own verdict on what
// this body should be doing. If a lesson is worth anything, the child's own
// rewards should be pushing its weights the same way the lesson already did:
// cos(t, p) > 0.
//
// That alone would be a fake, and it is the specific fake this project asked to be
// protected from. Parent and child share genes, and the Hebbian rule has a
// structural bias — if the genetic brain makes some hidden unit fire positive and
// some output sit positive, then EVERY body of that lineage accumulates p in
// roughly the same direction whether or not anybody taught it anything. cos(t, p)
// would then be large and would be measuring heredity, not culture.
//
// So the index is a difference of two alignments, not an alignment:
//
//     excess_i = cos(t_i, p_i) - cos(t_j, p_i)
//
// where j is another living body OF THE SAME LINEAGE and the same hidden-layer
// size. The second term is a control run inside the meter: it asks how well a
// COUSIN'S lesson would have predicted this body's own rewards. Anything the two
// terms share — the structural bias of the Hebbian rule, the lineage's shared
// genetic optimum, a seasonal signal the whole population is chasing — cancels.
// What survives is only the part of the lesson that is specific to this body's own
// parent rather than to its lineage, and that this body's own experience confirms.
//
// The control was first written to draw j from anywhere in the population. That
// version reads ~0.37 in a live world and it is worthless: a cross-lineage
// stranger has a different genetic brain, so the excess it measures is mostly the
// shared genome of parent and child — precisely the "genes taking a slower path"
// artefact. Pairing within the lineage cuts the index to ~0.05 (measured), and
// that difference is the size of the artefact the naive version was reporting as
// culture. Anyone tempted to widen the pairing again should read that as the cost.
//
// It is scaled by the taught share of the non-genetic part of the brain,
// |t|/(|t|+|p|), so a body whose lesson is confirmed but vanishingly small does
// not read as a cultured one. A newborn scores 0 (p is still zero and it has
// confirmed nothing yet), which is the correct reading: it has been told
// something, and nothing has yet vouched for it.
//
// WHAT THIS NUMBER IS NOT. It measures whether transmitted content is confirmed by
// the receiver's own reward experience — faithful, non-genetic, individually
// specific transmission. It does NOT measure competence, and in this world it must
// not be read as competence, because there is currently no acquired competence to
// transmit: knocking lifetime learning out entirely, amplifying it 3x, or replacing
// it with noise ten times its size all leave energy income unchanged at 0.50
// (4 seeds x 8.5k ticks, spread +-0.03 in every arm). Still true after world.js's
// motor-frame fix, after sweeping the brain-versus-instinct balance to 4x, and after
// replacing the Hebbian rule with a policy-gradient one — see findings 11-16.
// ---------------------------------------------------------------------------
const _buckets = new Map();      // reused across sweeps: this runs every 24 ticks forever
function sweep(){
  const cs = S.creatures;
  // bucket the living by hidden size, so the paired control body has a
  // comparable brain (weight i means something different at a different nh)
  const buckets = _buckets;
  buckets.clear();     // keyed by lineage, and lineages die: reuse would leak
  // The denominator is every established body, taught or not — an untaught body
  // contributes a hard 0. The index is a share of the POPULATION's competence, so
  // a world in which only a tenth of births are taught must not read the same as
  // one in which all of them are.
  let taught = 0, cnt = 0;
  for(let i = 0; i < cs.length; i++){
    const c = cs[i];
    if(!c.plast) continue;                       // newborn: has not run a brain yet
    cnt++;
    if(!c.g.__t){ c.culture = 0; continue; }
    taught++;
    // bucket key is (lineage, hidden size): the control body must be a cousin with
    // a comparable brain, not a stranger with a different one
    const nh = c.g.brain.nh, k = c.lineage + ':' + nh;
    let b = buckets.get(k); if(!b) buckets.set(k, b = []);
    b.nh = nh; b.push(c);
  }
  let sum = 0;
  for(const b of buckets.values()){
    const n = b.nh * NOUT, L = b.length;
    // pair i with i + L/2 (deterministic, no RNG, and never a body with itself).
    // A lineage bucket of one has no cousin to compare against, so its control
    // term is 0 and it scores its raw alignment — deliberately, since refusing to
    // score it would quietly drop exactly the founders and the rare topologies.
    const half = L > 1 ? (L >> 1) || 1 : 0;
    for(let i = 0; i < L; i++){
      const c = b[i], t = c.g.__t, p = c.plast;
      let tt = 0, pp = 0, tp = 0;
      for(let k = 0; k < n; k++){ tt += t[k] * t[k]; pp += p[k] * p[k]; tp += t[k] * p[k]; }
      const tn = Math.sqrt(tt), pn = Math.sqrt(pp);
      if(tn < 1e-9 || pn < 1e-9){ c.culture = 0; continue; }
      let ctrl = 0;
      if(half){
        const o = b[(i + half) % L].g.__t;
        let oo = 0, op = 0;
        for(let k = 0; k < n; k++){ oo += o[k] * o[k]; op += o[k] * p[k]; }
        const on = Math.sqrt(oo);
        if(on > 1e-9) ctrl = op / (on * pn);
      }
      const excess = clamp(tp / (tn * pn) - ctrl, 0, 1);
      c.culture = excess * (tn / (tn + pn));
      sum += c.culture;
    }
  }
  const st = S.culture || (S.culture = { idx: 0, n: 0, taught: 0 });
  st.idx = cnt ? sum / cnt : 0;
  st.n = cnt;
  st.taught = cnt ? taught / cnt : 0;    // share of the living that were taught anything
}

export function cultureTick(){
  if(S.tick % SWEEP === 0) sweep();
}

export function cultureReset(){ S.culture = null; _ns = 0x9e3779b9; }

export function cultureIndex(){ return S.culture ? S.culture.idx : 0; }

// ---------------------------------------------------------------------------
// TUNING LOG — what was measured, and what did not work, so nobody re-tries it.
//
// All figures: headless chromium, 4 seeds (11/23/37/51), 10k ticks unless stated,
// reported as mean +- sd across seeds. Arms are PRNG-paired (inherit() consumes no
// rand()), which was verified: the fidelity-pinned-to-0 arm produced numbers
// bit-identical to the mechanic-off arm in every window.
//
// 1. THE SUBSTRATE CARRIES ALMOST NO ACQUIRED COMPETENCE.
//
//    SUPERSEDED IN ITS DIAGNOSIS, NOT IN ITS RESULT — see findings 11-15, which
//    re-ran all of this after the egocentric-motor-frame bug named below was fixed
//    in world.js. The two structural causes this finding blamed have both now been
//    removed and tested, and the number did not move. Read 11-15 before acting on
//    anything here.
//
//    Intervening on plast directly at tick 6000 and measuring energy income over
//    the next 2500 ticks:
//        untouched                            income 0.4983 +- 0.0394  |plast| 0.012
//        learning zeroed every tick           income 0.5023 +- 0.0256  |plast| 0.000
//        plast decay removed (3x bigger)      income 0.5012 +- 0.0242  |plast| 0.034
//        plast replaced by noise (10x bigger) income 0.5010 +- 0.0261  |plast| 0.102
//    Deleting lifetime learning entirely costs nothing. The structural reason is in
//    world.js: the brain's motor outputs are applied in WORLD frame while its inputs
//    are egocentric, and BRAIN_W (0.7) is dominated by INNATE_W (1.25) on a
//    hand-written instinct vector, so no setting of the hidden->output weights can
//    express "turn toward the food". A vertical-transmission channel over a
//    substrate that carries nothing can only transmit nothing. Do not read any
//    number produced by this module as evidence of transmitted COMPETENCE until
//    that is fixed.
//
//    THE EXACT FIX, which is one line and is NOT in this module's ownership.
//    world.js:580 builds every spatial input in the body's heading frame:
//        const ego = (dx,dy,i) => { _in[i] = (dx*hx+dy*hy)*inv; _in[i+1] = (-dx*hy+dy*hx)*inv; };
//    with (hx,hy) the unit heading from world.js:482. world.js:683 then spends the
//    motor outputs in WORLD frame:
//        let dx = _out[0]*BRAIN_W + ix*INNATE_W, dy = _out[1]*BRAIN_W + iy*INNATE_W;
//    The two frames differ by the body's own rotation, which changes every step, so
//    the map from "food is 30 degrees to my left" to "accelerate north-east" is a
//    different map at every heading. No fixed weight matrix can represent it, and
//    learn() is therefore chasing a target that moves as fast as the body turns.
//    That is why zeroing plast, tripling it, and replacing it with 10x noise all
//    give the same income to three decimal places. Rotate the output back with the
//    same basis and the mapping becomes stationary:
//        const bx = _out[0]*hx - _out[1]*hy, by = _out[0]*hy + _out[1]*hx;
//        let dx = bx*BRAIN_W + ix*INNATE_W, dy = by*BRAIN_W + iy*INNATE_W;
//    hx/hy are already in scope at that point (world.js:482, same loop body; the
//    hx/hy at world.js:678 are a different, nested block scope and are unaffected).
//    _out[0]/_out[1] are read nowhere else, so nothing else changes. This WILL move
//    every evolved brain's behaviour and must be measured as a world change, not
//    slipped in: existing weights were selected under the broken map.
//    The second half — BRAIN_W 0.7 against INNATE_W 1.25 on a hand-written instinct
//    vector that already points at the food — is a state.js number. Even a perfect
//    brain is outvoted by instinct; without raising BRAIN_W above INNATE_W (or
//    gating the instinct prior by a gene) the rotation fix buys headroom, not
//    behaviour. Both are needed, and neither is mine to make.
//
// 2. TEACH_GAIN = 1 IS A NO-OP. plast's equilibrium rms is 0.011 against a ~0.45
//    genetic weight scale, so an unamplified lesson perturbs a weight by ~2%.
//    At gain 1 every world statistic was indistinguishable from the mechanic being
//    off. Gain 8 is the point at which teaching is at least visible in the brain
//    (taught rms reaches 0.044 by tick 10k) without saturating T_CAP.
//
// 3. HIGH FIDELITY IS ACTIVELY HARMFUL, AND IT IS THE TEACHING THAT HURTS, NOT ITS
//    METABOLIC PRICE. Pinning fidelity at 0.9 for everyone:
//        fidelity 0.9, teaching on   income 0.4704 +- 0.0204  final pop 202 +- 88
//        fidelity 0.9, gain 0        income 0.5513 +- 0.0325  final pop 378 +- 32
//    The second arm pays exactly the same metabolic charge (0.9 * 0.010) and teaches
//    nothing, and it does not collapse. So the loss is the taught offset itself: at
//    f 0.9 the geometric recursion drives taught rms to 0.376, roughly the genetic
//    weight scale, and the lesson stops being a nudge and becomes a lesion.
//    This is why the free-fidelity arm settles at 0.227 +- 0.015 rather than
//    climbing: there is a real optimum and it is LOW. Raising T_CAP or TEACH_GAIN
//    to make culture "stronger" moves the world toward the 0.4704 arm, not away.
//
// 4. FIDELITY IS NOT UNDER MEASURABLE POSITIVE SELECTION. It drifts from 0.15 up to
//    0.22-0.30 in EVERY arm over 10k ticks, including the mechanic-off arm where it
//    is free and does nothing. Under real teaching it ends at 0.227 +- 0.015, under
//    random teaching at 0.298 +- 0.049, with the mechanic off at 0.250 +- 0.075:
//    the only signal is that real teaching narrows the spread and holds the mean
//    slightly down, i.e. weak stabilising selection against high fidelity. Anyone
//    reporting "fidelity evolved upward" from a single run is reading the drift.
//
// 5. A SPECIFIC LESSON DOES SURVIVE THREE GENERATIONS, BUT MOST OF WHAT SURVIVES IS
//    LINEAGE, NOT TRANSMISSION. Tagging every taught vector at tick 8000 and
//    measuring cosine similarity to descendants >= 3 generations later:
//        vs its own tagged ancestor                    0.683 +- 0.042
//        vs an unrelated tagged body of the same lineage  0.560 +- 0.041
//    The excess is +0.12 and it is consistent across seeds, so transmission is real
//    and individually specific. But the control term is 0.56: five sixths of the
//    apparent persistence is the lineage arriving at the same lesson anyway. The
//    same measurement with random content taught at the same fidelity gives
//    -0.002 +- 0.009, confirming the metric is not manufacturing the 0.68.
//    Splitting the survivors by fidelity: > 0.5 gives 0.686 +- 0.141, <= 0.5 gives
//    0.666 +- 0.053. Persistence does NOT track fidelity. That was the decisive test
//    and the mechanic does not pass it.
//
// 6. THERE IS LITTLE INDIVIDUAL EXPERIENCE TO TRANSMIT IN THE FIRST PLACE.
//        cos(plast) between siblings                0.850 +- 0.021
//        cos(plast) between same-lineage cousins    0.511 +- 0.033
//    and with teaching content randomised (so siblings share no lesson) siblings are
//    still at 0.824 +- 0.036. Sibling agreement is therefore genetic, not taught:
//    plast is close to a deterministic function of the genome plus the season. A
//    parent teaching its plast to its child is mostly telling it something its own
//    genes were going to say.
//
// 7. THE CULTURE INDEX DOES DISCRIMINATE CONTENT FROM BANDWIDTH, WHICH IS THE ONE
//    THING IT WAS BUILT TO DO. Real teaching 0.049 -> 0.116 across the five windows;
//    random content at identical fidelity and identical magnitude 0.027 -> 0.044.
//    A factor of 2.6, growing. Note that taught rms grows at the SAME rate in both
//    (0.019 -> 0.044 real, 0.018 -> 0.048 random): the ratchet accumulates
//    magnitude in both arms, and only the index can tell them apart. Reporting
//    "the taught component grows across generations" is therefore not evidence of
//    anything; the noise arm does it just as well.
//
// 8. AN EARLIER CONTROL PAIRING WAS A FAKE WORTH REMEMBERING. Drawing the control
//    body j from anywhere in the population (rather than from the same lineage) put
//    the index at ~0.37. A cross-lineage stranger has a different genetic brain, so
//    that excess was mostly the genome parent and child share — the exact
//    "genes taking a slower path" artefact. Same-lineage pairing reads ~0.05-0.12.
//    The gap between 0.37 and 0.12 is the size of the artefact, not a tuning choice.
//
// 9. COMPETENCE DIFFERENCES ARE NOT RESOLVABLE AT THIS SAMPLE SIZE. Final-window
//    energy income: mechanic off 0.5407 +- 0.0461, cost-only 0.5538 +- 0.0222,
//    real teaching 0.5760 +- 0.0317, random teaching 0.5595 +- 0.0397. Teaching is
//    nominally best and the ordering is the one culture would predict, but the
//    real-vs-random gap (0.017) is half a standard deviation with n=4 seeds. It is
//    not a result. Given finding 1 it would be surprising if it were.
//
// 10. REJECTED IMPLEMENTATION CHOICES.
//     - Re-indexing the taught offset across a hidden-layer size change: abandoned.
//       removeNeuron() drops an arbitrary neuron, so the permutation is not
//       recoverable from the child's genome, and inherit() only sees the child.
//       Teaching is skipped for those births (~4%) instead.
//     - Sweeping the meter every 6 ticks (world.js's own cadence): 0.185 ms/step,
//       ~6% of a 3 ms step for a HUD readout. At 24 it is 0.011 ms/step amortised
//       (one sweep 0.22 ms) and the meter still refreshes ~2.5x/second.
//     - A Map keyed by creature id instead of genome.__t: inherit() runs before the
//       body exists, so there is no id to key on at the moment the offset is made.
//     - The sexual germline purge subtracts half the parent's offset because
//       crossBrain() takes each weight from one parent or the other and inherit()
//       is handed only one parent. Right in expectation, wrong weight by weight;
//       omnivore lineages therefore leak a little culture into the germline. The
//       fix needs a second parent in the signature — see the report.
//
// ===========================================================================
// RE-MEASUREMENT AFTER THE MOTOR-FRAME FIX (findings 11-15).
//
// world.js now rotates the brain's two motor outputs back into world frame by the
// body's own heading before adding the innate pull (world.js:699), which is the
// exact fix demanded in finding 1. Everything below was therefore re-opened: every
// earlier conclusion about lifetime learning, the Baldwin effect and `fidelity` had
// been measured against a motor system that could not act.
//
// Harness: headless chromium, ONE short-lived process per (arm, seed), 10000 ticks,
// metrics accumulated from tick 3500. `income` is the mean per-tick positive energy
// delta per established body, computed from outside the world (world.js exposes no
// income counter and is not ours to change). Seeds 11/23/37/51, plus 67/83/101/113
// where n=8 is stated. All figures mean +- sd ACROSS SEEDS.
//
// 11. THE FRAME FIX DID NOT MAKE LIFETIME LEARNING MEASURABLE. Learning on vs off,
//     everything else at defaults (4 seeds):
//         learnOn true    income 0.5053 +- 0.0315   pop 423 +- 51   maxGen 15.5 +- 1.7
//         learnOn false   income 0.4920 +- 0.0288   pop 439 +- 15   maxGen 14.8 +- 1.0
//     The gap is +0.013 income against a between-seed sd of 0.03, and population goes
//     the WRONG way. Deleting lifetime learning still costs nothing measurable. The
//     frame fix is correct and necessary — it just was not the thing that was
//     stopping learning from paying.
//
// 12. THE BRAINW/INNATEW SWEEP. This was run before state.js exposed P.brainW, by
//     scaling the two tanh-bounded motor outputs in nn.js by a `motorGain` hook —
//     exactly equivalent to running at BRAIN_W = 0.7*mg. The hook has since been
//     deleted in favour of the real knob; to reproduce, set P.brainW to the
//     "effective BRAIN_W" column directly. 4 seeds each:
//         mg   effective BRAIN_W   income            pop          maxGen   learning
//         0    0.00               0.1230 +- 0.0293    41 +-  4     1.0      on
//         1    0.70 (shipping)    0.5053 +- 0.0315   423 +- 51    15.5      on
//         1    0.70              0.4920 +- 0.0288   439 +- 15    14.8      off
//         2    1.40              0.4850 +- 0.0231   418 +- 17    16.3      on
//         2    1.40              0.5093 +- 0.0504   436 +- 38    15.5      off
//         4    2.80              0.4983 +- 0.0343   361 +- 49    15.5      on
//         4    2.80              0.4991 +- 0.0314   397 +- 68    15.0      off
//     Two things, and they point opposite ways.
//     (a) The brain is NOT decoration. Silencing its motor outputs entirely (mg 0,
//         i.e. pure hand-written instinct) collapses the world: income falls 4x, the
//         population falls from ~420 to 41 and no lineage reaches generation 2. The
//         reason is visible in world.js:701 — with no brain term, a body that senses
//         nothing has ix=iy=0 and falls through to rnd(-1,1) every tick, i.e. a
//         Brownian walk that never finds food. The brain supplies the persistent
//         directed search; instinct only supplies the final approach.
//     (b) But its AUTHORITY is already saturated at the shipped 0.7. Raising it past
//         INNATE_W (mg 2) and to 4x INNATE_W (mg 4) changes income by less than one
//         between-seed sd in either direction and costs ~15% of the population at
//         mg 4. There is no setting of the balance at which learning starts to pay:
//         the learning-on-minus-off gap is +0.013, -0.024 and -0.001 at mg 1, 2, 4.
//     So "the instinct prior is doing all the work" is false, and "raising BRAIN_W
//     would let learning express itself" is also false. REJECTED as a tuning.
//
// 13. NO BALDWIN EFFECT. The classic assay: evolve 10000 ticks with plasticity, then
//     freeze the world and measure income for 1500 ticks with the overlay zeroed and
//     learning off, versus the same world with it left on (snapshot/restore, so both
//     assays start from the identical state). 4 seeds:
//                                   assay WITH plasticity   assay WITHOUT
//         evolved with learning     0.4978 +- 0.0279        0.5198 +- 0.0339
//         evolved without learning  0.4815 +- 0.0438        0.4968 +- 0.0470
//     A Baldwin effect predicts the top-right cell rising toward the top-left over
//     generations as the innate prior assimilates the learned behaviour. Instead the
//     overlay is worth NEGATIVE 0.022 in the lineages that grew up with it: removing
//     plasticity improves income in both arms. Cross-arm, a genome evolved alongside
//     plasticity is +0.023 better without it than a genome evolved without it ever
//     existing — half a between-seed sd, n=4. There is nothing here to assimilate,
//     which is the only honest reading given finding 11.
//
// 14. `fidelity` IS STILL DRIFT, WITH ITS DRIFT CONTROL RUN. Each arm carries its own
//     yardstick: the five functionless level-3 genes (tool/pyro/mark/techApt/terra)
//     mutate with the same step and are clamped the same way, so the number that
//     matters is fidelity MINUS that arm's own control-pool mean, not fidelity's
//     distance from its founding 0.15. 4 seeds x 10000 ticks:
//         arm                             fidelity          ctrl pool   excess
//         real teaching                   0.1883 +- 0.0056    0.2017    -0.013
//         cost only (cultureGain 0)       0.2218 +- 0.0339    0.1950    +0.027
//         drift control (cultureVertOn 0) 0.2194 +- 0.0233    0.2071    +0.012
//         random content (cultureNoise)   0.2248 +- 0.0312    0.2154    +0.009
//         teaching on, learnOn false      0.2435 +- 0.0367    0.1984    +0.045
//     The drift control is the third row: the gene is free, functionless and still
//     mutating, and it climbs to 0.219 anyway. Real teaching produces the LOWEST
//     excess of the five arms and the only negative one. Nothing here beats its own
//     control; the direction of the only nominal signal is still weak stabilising
//     selection AGAINST fidelity, exactly as finding 4 said before the fix.
//
// 15. THE CULTURE INDEX STILL DISCRIMINATES CONTENT FROM BANDWIDTH, AND STILL BUYS
//     NOTHING. Real teaching 0.0631 +- 0.0091, random content at the same fidelity
//     and near-identical taught rms (0.0255 vs 0.0257) 0.0362 +- 0.0040 — a factor
//     of 1.7, consistent across seeds. Income in the same four arms: real 0.5053
//     +- 0.0315, noise 0.5086 +- 0.0541, cost-only 0.4957 +- 0.0182, mechanic off
//     0.5161 +- 0.0442. Transmission is real, individually specific and faithful,
//     and it has no fitness consequence whatsoever. That gap — a working channel
//     carrying content nobody can eat — is the honest state of culture in this world.
//
// 16. THE LEARNING RULE ITSELF WAS REPLACED, MEASURED AND THE REPLACEMENT REJECTED.
//     Only after 11-15 was the rule in nn.js suspected. It is reward-modulated
//     Hebbian with a strictly positive reward, no exploration and no temporal credit
//     assignment, so the overlay it accumulates is close to a deterministic function
//     of the genome: cos(germline hidden->output block, plast) = 0.345 +- 0.010.
//     nn.js now also carries 'rpe', a continuing-task policy-gradient rule (output
//     perturbation, eligibility trace, reward baseline) behind P.learnRule. It does
//     break the genetic echo — the same cosine falls to 0.000 +- 0.002 — and it can
//     be driven to any overlay magnitude wanted. At P.learnLR 40 the overlay reaches
//     rms 0.140, i.e. 31% of the ~0.45 genetic weight scale, against 0.0095 (2%) for
//     the default rule. 8 seeds x 10000 ticks, against its OWN control (identical
//     exploration noise, learning rate zero, so the only difference is whether the
//     reward is used at all):
//         rpe, learnLR 40    income 0.5026 +- 0.0219  pop 379 +- 72  maxGen 15.8 +- 2.3
//         rpe, learnLR 0     income 0.5005 +- 0.0271  pop 427 +- 63  maxGen 14.6 +- 1.7
//     +0.002 income, and 11% FEWER bodies. At n=4 the maxGen gap looked like the one
//     candidate positive in this whole investigation (16.5 +- 2.4 vs 14.0 +- 1.2);
//     four more seeds took it to 15.8 vs 14.6 and it is now well inside the spread.
//     Overlay magnitude was calibrated separately (seed 11, 3000 ticks): learnLR
//     10/40/120 give overlay rms 0.036/0.137/0.337 and income 0.456/0.444/0.450 —
//     income is flat while the overlay grows to three quarters of the genetic weight
//     scale. Raising the exploration noise from 0.15 to 0.4 gives 0.450 as well.
//     REJECTED as the default. The Hebbian rule stays; 'rpe' stays behind the flag
//     because it is the control that retires the hypothesis, and re-deriving it
//     costs a day.
//
// WHAT THESE FIVE FINDINGS ADD UP TO. The two structural excuses finding 1 offered
// for lifetime learning being inert have now both been removed — the motor frame is
// fixed in world.js, and the brain-versus-instinct balance has been swept to 4x the
// instinct weight — and a correct learning algorithm with an overlay 15x the size of
// the default one was tried on top of that. Income is 0.50 in all twenty arms. The
// remaining explanation is the one genome.js already measured for every other gene
// in this simulation: an effect has to be tens of percent of a body's energy budget
// before this world can select on it, and the difference between a well-steered
// forager and an averagely-steered one is not that big. Lifetime learning here is a
// real mechanism producing a real, individually-specific, faithfully-transmitted
// signal that changes no outcome. It should be described that way and not as
// competence.
// ===========================================================================
//
// PERFORMANCE (same harness): inherit() 2.0 us per birth; cultureTick() 0.011 ms
// per step amortised, 0.22 ms on the steps where it actually sweeps. Against a
// ~3 ms step that is 0.4%. With P.cultureVertOn = false the world is bit-identical
// to the pre-mechanic build (3 seeds x 3000 ticks, identical state fingerprints).
// ---------------------------------------------------------------------------
