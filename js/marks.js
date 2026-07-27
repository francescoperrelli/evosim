// Persistent marks: memory that lives outside the body.
//
// Pheromone trails already exist, and they carry exactly one thing: intensity.
// Something walked here, recently, and that is all a follower can know. A mark
// that carries *content* — a small vector a body chooses when it deposits and that
// another body can read back — is a different kind of object, because the reader's
// response can depend on which mark it is rather than merely that there is one.
//
// Call this what it is and no more. It is proto-symbolic: a finite, fixed set of
// signal dimensions that acquire meaning by convention within a lineage. It is not
// writing, it is not language, and it will not become either — the vocabulary is
// written by us and cannot grow. What CAN genuinely happen, and is worth measuring,
// is that separate lineages settle on different conventions for the same dimension
// and that those conventions persist across generations. That is convention
// formation, and it is real. Claiming anything past it in the HUD or the chronicle
// would be lying to the player.
//
// The failure mode to watch: a mark nobody reads is graffiti, and a mark everybody
// reads the same way regardless of what it says is a signpost, not a symbol. The
// measurement that separates them is whether shuffling the content between marks
// changes behaviour. If it does not, this module is an expensive pheromone.
//
// Contract used by world.js and render.js — these signatures are fixed:
//
//   markTick()           -> once per world step: marks fade and are culled.
//                           MUST use rand()/gauss() from utils.js only.
//   markReset()          -> clear module state (called from seed() and restore()).
//   leave(c)             -> called per body per step: it may deposit a mark here.
//   sense(c)             -> { dx, dy, w }: a steering pull, in world units, that
//                           world.js adds to the innate prior with weight w
//                           (0 = no opinion). This is how a mark can matter without
//                           rebuilding the brain's input layer.
//   markIndex()          -> 0..1 for the HUD: how far apart the conventions of
//                           different lineages have drifted. 0 = one convention.
//   drawWorld(ctx, view) -> world-layer drawing; view is
//                           { z, vis(x,y,r), x0, y0, x1, y1 }.
//   packMarks() / unpackMarks(a)  -> save-file encoding.
//
// S.marks holds the deposits. Each creature carries `c.mark` (the last content it
// read, so the inspector can show what it is responding to).
//
// ---------------------------------------------------------------------------
// WHAT IS ACTUALLY IMPLEMENTED, AND WHY IT IS SHAPED THIS WAY
//
// The mechanic is a Lewis signalling game played on the ground.
//
//   * There are G = 3 SITUATIONS a body can be in when it writes — forage (it just
//     ate more than it burned), danger (its innate alarm channel fired recently),
//     gathering (it is standing in a crowd of its own kind). These three, and only
//     these three, are the vocabulary. We wrote them and they cannot grow. They
//     were chosen because each is a true, locally persistent fact about the ground
//     (food regrows in clumps, predators hunt in the same places, aggregations
//     recur) and because each licenses a DIFFERENT response, which is what makes
//     the shuffle control below able to separate anything at all.
//
//   * There are G = 3 GLYPHS — the content actually deposited. A glyph has no
//     intrinsic meaning whatsoever. Which glyph stands for which situation is the
//     lineage's CONVENTION, and it is genetic: rot(c) = floor(g.mark * G) is a
//     rotation, the writer stores (situation + rot) % G and the reader decodes
//     (glyph - rot + G) % G. Two bodies with the same rotation understand each
//     other perfectly; two bodies a rotation apart systematically misunderstand
//     each other — a reader with the wrong rotation is pulled TOWARD the danger
//     sites and AWAY from the food ones. Nothing labels a mark with its meaning
//     anywhere; the meaning is the agreement, exactly as the header demands.
//
// The one design choice worth defending: `g.mark` is used ONLY as the convention
// dial and NOT as a propensity to write or to read. The obvious alternative (high
// mark = writes and reads more) was rejected before it was measured, because it
// confounds the two things the module exists to distinguish: a lineage at rot 2
// would then also be a lineage that marks three times as often, and every
// "convention divergence" number would be contaminated by a magnitude gradient.
// It also walks straight into the trap documented above metabolism() in genome.js —
// a 0..1 gene whose consequence is a few percent of an energy budget is drift, and
// no amount of tuning fixes it. A pure coordination dial escapes that trap not by
// being expensive but by being frequency-dependent: the payoff to a value depends
// on how many of your neighbours share it, and offspring are born ~6px from their
// parent, so your neighbours are mostly kin. That is the assortment lever the
// economy note points at, and it is the only lever available here. It was not
// enough — see section 2 below, where the no-reader control comes out the same,
// and section 4, where attaching a real energetic payoff to decoding a mark
// correctly was built, measured over 20 000 ticks, and removed again.
//
// Reading is NOT restricted to kin. It would have been trivial to tag each mark
// with its writer's lineage and let only relatives read it, and that would have
// manufactured the result: within a lineage everybody carries nearly the same
// gene, so mismatch could never happen and there would be no game. Reading is
// restricted to the same SPECIES BAND (herb/omni/carn), on the same grounds the
// pheromone field is per-species: a herbivore's forage mark is not information a
// carnivore can act on. Assortment therefore has to come from viscosity alone.
// Viscosity delivers: ~80% of reads are within-lineage (section 2). It is still
// not enough to make agreement selectable, which is the honest result.
//
// ---------------------------------------------------------------------------
// MEASURED. Every number below was produced by scratch/marks.mjs (deleted before
// commit; it is a static server + headless Chromium driving the real modules).
// 3-4 seeds per arm, all other level-2/3 flags at their defaults. "+-" is always
// the spread ACROSS SEEDS, never within a run. Read this before tuning anything.
//
// 1. THE SHUFFLE CONTROL (the header's own separating measurement).
//    Arm A: as shipped. Arm B: identical in every respect — same deposit rule,
//    same positions, same strengths, same fade, same cost, same rand() budget —
//    except that markTick() Fisher-Yates permutes the GLYPH field among the
//    standing marks every step, so a mark's content is decoupled from the place it
//    sits on while the marks themselves are untouched (P._marks.shuffle = 1).
//    9000 ticks, warm-up 1000, sampled every 500.
//
//      seed  arm    read/body/step  decode-err  pop   |marks|  cross-lineage
//      1234  ship   0.4286          0.095       214   200      0.146
//      1234  shuf   0.4136          0.494       216   200      0.174
//      777   ship   0.3905          0.108       252   200      0.233
//      777   shuf   0.3616          0.604       236   200      0.185
//      4242  ship   0.5082          0.088       164   200      0.191
//      4242  shuf   0.3584          0.588       164   200      0.244
//      9001  ship   0.4730          0.101       190   200      0.244
//      9001  shuf   0.3581          0.556       234   200      0.270
//
//      ship  decode-err 0.098 +- 0.009   pop 205 +- 37   read 0.4501 +- 0.0513
//      shuf  decode-err 0.561 +- 0.049   pop 213 +- 34   read 0.3729 +- 0.0272
//
//    Decode error is the fraction of reads where the situation the reader decoded
//    is not the situation the writer encoded. Shipped 0.098, shuffled 0.561,
//    against a chance floor of 1 - 1/G = 0.667. The effect is 0.462 = 9.5
//    between-seed sd, so the content of a mark IS carrying information from writer
//    to reader and shuffling destroys essentially all of it. (Shuffled sits under
//    the chance floor because glyph frequencies are skewed — most bodies share
//    rotation 0, so a random glyph still lands on the right situation slightly
//    more often than 1/3.) Read rate also falls 0.450 -> 0.373: readers act on
//    fewer marks when the marks stop agreeing with the ground. The separating
//    measurement PASSES on information transmission.
//
//    Now the half that matters. Population is 205 +- 37 shipped and 213 +- 34
//    shuffled: an effect of -7.8 bodies, which is -0.21 between-seed sd, i.e.
//    nothing. Destroying every bit of the transmitted information does not move
//    fitness outside a single seed's noise. Behaviour changes — bodies demonstrably
//    steer to different places, and the decode-error and read-rate columns are the
//    proof — but nothing that depends on that behaviour pays for it. This is a
//    signalling system that works and does not pay, and that is the honest headline.
//
// 2. CONVENTION DIVERGENCE, and its no-reader control.
//    markIndex() is the size-weighted Gini-Simpson diversity of per-lineage modal
//    conventions, normalised so 1 = conventions spread evenly over all G.
//    Sampled every 500 ticks from t=1000 to t=9000, averaged over the two halves:
//
//      arm                                    first half     second half
//      shipped (write + read)                 0.057 +- 0.028  0.374 +- 0.044
//      no-reader control (P._marks.read = 0:  0.113 +- 0.050  0.405 +- 0.105
//        marks are still written, nothing reads them)
//
//    The two arms are indistinguishable, and the no-reader arm diverges if anything
//    slightly MORE. Divergence is real — every seed starts at a single founding
//    convention (genome.js seeds mark at rnd(0,0.2), so every founder is rotation
//    0) and ends multi-convention — but it is DRIFT IN THE DEPOSITING RULE. Taking
//    every reader away changes nothing.
//
//    The convention shares make the mechanism plain. Shipped, seed 1234, shares of
//    rotations [0/1/2] over the same window:
//      [1.00/0.00/0.00] ... [0.87/0.13/0.00] ... [0.79/0.21/0.01] ... [0.74/0.25/0.01]
//    That is a neutral diffusion out of the founding band, monotone in time, not a
//    convergence to distinct lineage conventions. Rotation 2 barely exists at all
//    because g.mark has to random-walk past 0.667 to reach it.
//
//    Persistence, measured as the fraction of lineages holding the same modal
//    convention across a lag, with generations elapsed over that lag:
//
//      arm       retention@2000 ticks         retention@6000 ticks
//      shipped   0.859 +- 0.099 / 1.81 gen    0.801 +- 0.176 / 4.96 gen
//      no-read   0.864 +- 0.067 / 1.47 gen    0.757 +- 0.162 / 4.42 gen
//
//    Conventions genuinely do persist across ~5 generations of complete body
//    turnover. They persist EQUALLY WELL with nothing reading them, so what
//    persists is heritability of g.mark, not a maintained agreement. Saying
//    "lineages hold their conventions across generations" is true; saying they hold
//    them *because they are used* is not, and the control is what shows the
//    difference.
//
//    Cross-lineage reads are 0.204 +- 0.045 of all reads, so ~80% of reading is
//    within-lineage. Viscosity does deliver strong assortment, and it is still not
//    enough to make agreement a selectable private good — which is the economy note
//    turning out to be right in the direction it did not want.
//
// 3. WAS THE RUN SIMPLY TOO SHORT? NO. Sections 1 and 2 were measured at 9000
//    ticks, and elsewhere in this repo a gene that genuinely evolves (dispersal)
//    needed 24 000 ticks to move. So the whole level-3 set was re-run at 40 000
//    ticks, 3 seeds (1234/2024/4048), each arm against the control its own module
//    names, with tools carried along as a positive control. Tools reproduced (see
//    the paired-window table in tools.js), so the harness is sound. Marks did not.
//
//    Two things have to be said about the baseline before any number below means
//    anything. Mutation on g.mark is a gaussian clamped into [0,1], whose
//    stationary distribution is NOT concentrated at 0.19 — it is uniform. The
//    "0.19 is where a functionless gene sits" rule of thumb is a 10 000-tick
//    TRANSIENT, not a fixed point. Measured on the marks-off control, mean g.mark
//    per 10k window: 0.17 -> 0.29 -> 0.39 -> 0.47, with the between-seed sd
//    growing from ~0.02 to ~0.10. Longer runs raise the control and widen its
//    spread at the same time, so they buy statistical power only for effects that
//    grow faster than that. Marks' does not: at 20 000 ticks mean g.mark is
//    0.399 +- 0.060 with the mechanic fully on and 0.374 +- 0.103 with its payoff
//    removed. Overlapping, and both merely on their way to 0.5.
//
//    The second thing is that DECODE ERROR RISES WITH TIME, in every arm, and
//    that is not a failure — it is the diffusion of section 2 running longer.
//    Shipped, mean over 3 seeds: 0.141 (5k) -> 0.175 (10k) -> 0.318 (15k) ->
//    0.261 (20k), while modal-convention share falls 0.74 -> 0.66 -> 0.48 -> 0.46.
//    The world starts on one convention and ends on two or three. Nothing selects
//    against that, so it happens.
//
// 4. A PAYOFF FOR READING A MARK RIGHT. BUILT, MEASURED, AND REMOVED.
//    Section 1's honest headline is that signalling here works and does not pay,
//    which points at one obvious repair: give the CONTENT of a mark a fitness
//    consequence, so that decoding it correctly is worth something and decoding it
//    wrong is not. This was implemented in full and it is not in this file, so
//    here is exactly what it was and exactly why it went.
//
//    GLEANING. A forage deposit left R_GAIN edible residue on its site (a new
//    field `m.r`, capped per site at R_MAX, carried through pack/unpackMarks).
//    A body of the same species band that decoded that mark's glyph as FORAGE and
//    was standing inside the read radius took up to GLEAN of it per step, and it
//    was gone once taken. A body that decoded the same mark as DANGER or GATHER
//    walked away from a meal it was standing on. That is frequency-dependent by
//    construction: the residue goes to whichever rotation the local writers use,
//    which is the majority, which is the only selective force this module can
//    have. leave()'s situation priority was also reordered to put FORAGE ahead of
//    DANGER, because instrumenting the glyph mix showed writes splitting
//    0.3 forage / 3.7 danger / 2.7 gather per tick — danger fired on nearly every
//    body and crowded the only situation with a payoff out of the map.
//
//    SIZING IS THE WEAK POINT, and it is worth recording because it says something
//    about the world. The channel is self-amplifying in BOTH directions: its
//    supply is forage deposits, and forage deposits are made by bodies that just
//    ate well. Energy delivered per tick over the first 10 000 ticks, 3 seeds:
//
//      R_GAIN/R_MAX/GLEAN     seed 1234   seed 2024   seed 4048   pop range
//      120 / 400 / 4.0        35-41       32-45       115-320     490-1042
//       60 / 200 / 2.5         4-5         4-5          2-4       290-572
//
//    Halving the dial did not halve the channel, it collapsed it sevenfold: less
//    food means a smaller, hungrier population, which writes fewer forage marks,
//    which leaves less residue. There is no comfortable middle setting. Earlier
//    sizings failed the other way: GLEAN_R2 = 30^2 with R_GAIN 9 and GLEAN 0.75
//    delivered 0.6 energy/tick, and widening the radius to READ_R2 with GLEAN 3.0
//    only reached 0.5-0.9, because the binding constraint was never the radius —
//    it was that almost nothing was writing FORAGE at all.
//
//    THE MEASUREMENT, at the upper sizing (120/400/4.0), 20 000 ticks, 3 seeds,
//    three arms: shipped-plus-payoff, payoff removed (P._marks.payoff = 0, the
//    one-thing-changed control), and the section 1 shuffle control with the payoff
//    left on. Between-seed sd in brackets.
//
//      t       decode err              modal share            pop
//              pay    nopay   shuf     pay    nopay  shuf     pay   nopay  shuf
//       5000   .141   .113    .568     .736   .795   .801     676   346    405
//      10000   .175   .193    .544     .661   .698   .676     585   516    610
//      15000   .318   .249    .605     .478   .568   .472     392   316    385
//      20000   .261   .260    .569     .459   .535   .447     589   491    723
//      (sd at 20000: derr .021/.082/.068, pop 122/66/366)
//
//    Paired by seed, payoff minus no-payoff decode error, 12 contrasts:
//      5k   -0.015  -0.020  +0.119
//      10k  +0.000  -0.052  -0.003
//      15k  -0.130  +0.146  +0.192
//      20k  -0.118  +0.057  +0.063
//    Seven negative, four positive, one zero, mean +0.020. THE PAYOFF DOES NOT
//    MAKE BODIES DECODE MARKS ANY BETTER. Modal-convention share is if anything
//    LOWER with the payoff on (0.459 vs 0.535 at 20k), so it does not slow the
//    diffusion either, and mean g.mark is 0.399 +- 0.060 against 0.374 +- 0.103.
//
//    What the payoff did do is feed everyone: population 589 +- 122 against
//    491 +- 66, and 32.3 generations by 20 000 ticks against 24.7. The channel was
//    delivering 66-128 energy a tick. It is a real, large energy flow, and it is
//    invisible to the gene it was built to select.
//
//    The shuffle arm is what kills the idea rather than merely failing to save it.
//    With glyphs permuted every step the content is noise, decode error sits at
//    0.569, and the arm STILL collects 23-132 energy a tick — because the residue
//    rides the mark record and a scrambled glyph is still read as FORAGE by
//    someone one time in three. Its population at 20 000 ticks is 723, the highest
//    of the three arms. Same calories, zero information, same or better fitness.
//    That is a food faucet wearing a semantics costume, and shipping it would put
//    exactly the kind of hand-scripted mechanism this repo tries to keep visible
//    behind a claim about meaning. The code was reverted in full; only this note
//    and the P._marks.payoff knob's absence remain. The shipped module is
//    unchanged, so its cost is still the 0.185 ms/step in the COST section.
//
//    WHY IT FAILED, stated so the next attempt starts further along. Mis-decoding
//    a mark is not punished, it is merely unrewarded: the wrong-rotation body
//    walks past a meal and eats something else. In a world where food regrows
//    everywhere on a logistic and the population sits near carrying capacity,
//    "you found this particular meal fractionally sooner" is worth a fraction of a
//    percent of a lifetime energy budget, which is precisely the regime the cost
//    sweep above metabolism() in genome.js says is indistinguishable from drift.
//    Frequency dependence does not rescue it, because frequency dependence
//    multiplies a payoff that is already too small to see. A payoff that COULD
//    work would have to make the wrong reading actively lethal — decoding a
//    danger mark as forage and walking into a predator — and that requires
//    world.js to route mark-derived steering into the predator-encounter path,
//    which is not this module's to change. See the report note on world.js.
//
// TUNINGS REJECTED, with the numbers that rejected them. Do not re-try these.
//   * A stronger PULL. Sweep of the steering weight over 3 seeds, 9000 ticks:
//       x0 (0.00) pop 192 +- 5    x1 (0.34) pop 219 +- 45
//       x1.6 (0.54) pop 210 +- 29  x2.6 (0.88) pop 199 +- 30
//     Nothing separates, in either direction: turning the steering off entirely
//     costs nothing and tripling it buys nothing. PULL stays at the smallest value
//     that still visibly steers, because a bigger one is unpaid risk to foraging.
//   * A bigger MARK_COST. Sweep over 3 seeds, 9000 ticks (the "make the gene
//     matter by making it expensive" move the economy note warns about):
//       x0  (0.00 e)  pop 193 +- 16  mean g.mark 0.143 +- 0.003
//       x1  (0.06 e)  pop 207 +- 44  mean g.mark 0.192 +- 0.004
//       x10 (0.60 e)  pop 180 +- 5   mean g.mark 0.136 +- 0.017
//       x40 (2.40 e)  pop 194 +- 53  mean g.mark 0.196 +- 0.014
//     A 40x cost increase leaves the gene exactly where a zero cost leaves it, and
//     the ordering is not even monotone. Cost is not a lever in this world, exactly
//     as the l2Cost sweep above metabolism() in genome.js found. This line exists so
//     nobody spends another day on it.
//   * A Map-keyed spatial hash for the marks (the obvious first implementation).
//     18 Map.get calls per body per step measured 1.85 us/body against 0.42 us/body
//     for the flat pre-sized bucket array now used; the population pass over
//     leave()+sense() fell 0.3875 -> 0.286 ms. The flat array is why this module is
//     affordable at all.
//   * A hard cap with no eviction. |S.marks| pinned at MAX_MARKS and every later
//     deposit was silently dropped, freezing the map at whatever the first 200
//     sites happened to be. Replaced with weakest-mark eviction, so the map is a
//     rolling window over the strongest and freshest sites.
//   * Kin-only reading (tag each mark with its writer's lineage, let only relatives
//     read it). REJECTED WITHOUT MEASUREMENT, on principle: within a lineage every
//     body carries nearly the same gene, so mismatch could never happen and the
//     coordination game would be hard-coded to succeed. It would have produced a
//     spectacular decode-error number that measured nothing. Same-species-band
//     reading is used instead, so assortment has to come from viscosity alone.
//   * Deposit gate on g.mark magnitude (rand() < g.mark * 0.2). Also rejected
//     without measurement, as a confound: it would make "which convention" and "how
//     much marking" the same number and contaminate every divergence figure above.
//
// COST, measured directly rather than by differencing whole steps (whole-step
// timing is useless here — the two arms drift to different populations, 174 vs 209,
// so the difference is mostly ecology). Over a live population of 217:
//     sense()    0.0873 ms per population pass = 0.402 us/body/step
//     leave()    0.0975 ms per population pass = 0.449 us/body/step
//                (0.0078 ms of that is call + situation gate; the rest is the
//                 3x3 merge search on the ~5% of calls that actually deposit)
//     markTick() 0.00033 ms/step
//   Total ~0.185 ms/step at pop 217, against a 2.8-7.9 ms baseline step: 3-6%.
//   drawWorld() is below measurement resolution.
//
//   |S.marks| sits at 200 = MAX_MARKS at every 500-tick checkpoint from t=500 to
//   t=8000. The cap BINDS CONTINUOUSLY: deposits arrive faster than the ~180-tick
//   fade can retire marks, so weakest-mark eviction, not the fade, is what sets map
//   density, and the fade's real job is to order eviction priority. Merge-on-deposit
//   is what keeps 200 records covering the whole world instead of 200 records
//   stacked on one clearing.
//
// FLAG-OFF IDENTITY. With P.marksOn = false the world is bit-identical to the
// pre-marks build. Fingerprint (the tests/sim.test.mjs hash) over 1500 steps:
//     seed   marksOn=false   clean f8051d2   marksOn=true
//     1234   7645614         7645614         6801462
//     777    7210343         7210343         7262533
//     4242   6292595         6292595         6114134
// The clean column is a `git archive f8051d2` checkout run through the same
// harness. world.js never calls into this module when the flag is off, so the
// identity is structural rather than tuned; the marksOn=true column is there to
// show the module is not simply inert.
// ---------------------------------------------------------------------------

import { P, S, TYPES } from './state.js';
import { rand, clamp } from './utils.js';

const NO_PULL = { dx: 0, dy: 0, w: 0 };
const _pull = { dx: 0, dy: 0, w: 0 };   // reused: sense() is called once per body per step

// ---- the vocabulary. Fixed, finite, written by us, and it cannot grow. ----
const G = 3;                 // situations == glyphs == conventions. Not raised: g.mark mutates
                             // ~0.10/generation, and a wider alphabet means narrower bins, so
                             // conventions would diffuse faster than a lineage can hold one.
                             // (Reasoned, not measured — the G=3 persistence numbers are.)
const SIT_FORAGE = 0;        // "I ate more than I burned standing here"
const SIT_DANGER = 1;        // "my alarm fired here"
const SIT_GATHER = 2;        // "my own kind crowd here"

// ---- tuning. Module-local by contract: none of this belongs in P. ----
const MCELL = 72;            // mark spatial-hash cell. >= READ_R so a 3x3 lookup covers the radius.
const READ_R = 68, READ_R2 = READ_R * READ_R;
const MERGE_R = 26, MERGE_R2 = MERGE_R * MERGE_R;
const MAX_MARKS = 200;       // hard cap, and it BINDS CONTINUOUSLY — see the |S.marks|
                             // note above. Eviction, not the fade, sets map density.
const DEP_P = 0.055;         // per-body per-step chance to write, GIVEN a situation worth writing
const MARK_COST = 0.06;      // energy per deposit. Small on purpose: the cost sweep above
                             // shows 40x buys nothing, so there is no case for more.
const FADE = 0.9962;         // per tick, applied batched every 8 (~180-tick half-life)
const FADE_EVERY = 8;
const MIN_STR = 0.18, MAX_STR = 3.2;
const PULL = 0.34;           // steering weight at full strength. The pheromone term is 0.4; the
                             // prey/threat instincts are 1.4-1.6. See the PULL sweep above.
const EAT_DELTA = 3.0;       // energy gained-minus-burned in one step that counts as "it ate here".
                             // A plant is 24 and a kill is 82; metabolism is 0.05-0.20.
const GATHER_N = 4;          // same-type neighbours that make a place a gathering
const ALERT_FRESH = 24;      // c.alert is set to 30 and decrements, so this is "alarmed <6 steps ago".
                             // Gating at >0 instead would smear a danger glyph over the whole
                             // 30-step decay behind every startled body, which at a cap that
                             // already binds means danger crowding out the other two glyphs.

// Research overrides, following property.js's P._prop precedent. These are NOT
// game settings and nothing in the UI touches them; they exist because the two
// controls the design brief demands (shuffle the content, take the readers away)
// cannot be run from outside the module. Defaults reproduce shipped behaviour.
const D = { read: 1, write: 1, shuffle: 0, pull: 1, cost: 1 };
const T = k => { const o = P._marks; return (o && o[k] !== undefined) ? o[k] : D[k]; };

// Instrumentation the harness reads back. `_instr` is off unless a harness turns
// it on; while it is on, a deposit also records the situation its writer MEANT, in
// a field nothing in the simulation path ever reads. That field is the only way to
// score decode agreement, and it must stay instrumentation: a mark that carried its
// own meaning would be a signpost, which is precisely the thing under test.
export const stats = { reads: 0, writes: 0, misreads: 0, kinReads: 0 };
let _instr = false;
export function instrument(on){ _instr = !!on; stats.reads = stats.writes = stats.misreads = stats.kinReads = 0; }

const TY = ['herb', 'omni', 'carn'];

// ---- spatial hash over the marks -------------------------------------------
// S.marks is scanned linearly exactly nowhere in the hot path. The grid is a flat
// bucket array (NOT a Map: 18 Map.get calls per body per step measured 1.85 us per
// body, and the same lookups against a plain array measure 0.42 us) rebuilt only
// when the set has actually changed — a deposit, a merge that nudged a position, a
// cull — so a quiet step costs nothing at all.
let grid = [];
let dirty = true;
let gcols = 1, grows = 1;

function rebuild(){
  gcols = Math.max(1, Math.ceil((S.worldW || 1700) / MCELL));
  grows = Math.max(1, Math.ceil((S.worldH || 1050) / MCELL));
  const n = gcols * grows;
  if(grid.length !== n) grid = new Array(n);
  for(let i = 0; i < n; i++) grid[i] = null;
  const ms = S.marks;
  for(let i = 0; i < ms.length; i++){
    const m = ms[i];
    const cx = m.x < 0 ? 0 : m.x >= gcols * MCELL ? gcols - 1 : (m.x / MCELL) | 0;
    const cy = m.y < 0 ? 0 : m.y >= grows * MCELL ? grows - 1 : (m.y / MCELL) | 0;
    const k = cy * gcols + cx;
    const b = grid[k]; if(b) b.push(m); else grid[k] = [m];
  }
  dirty = false;
}

// The convention a body holds: a rotation of the glyph alphabet. This is the whole
// of the genetics. `mark` is undefined on a migrated v8 save, which reads as rot 0.
function rotOf(g){
  const v = g && g.mark !== undefined ? g.mark : 0;
  const r = Math.floor(v * G);
  return r < 0 ? 0 : r >= G ? G - 1 : r;
}

// ---------------------------------------------------------------------------

export function markTick(){
  const ms = S.marks;
  if(!ms.length){ if(dirty) rebuild(); return; }

  // The shuffle control. Off by default and off in every shipped run; when on it
  // permutes the glyph field among the standing marks and touches nothing else,
  // so the arm differs from the shipped arm in content alone. Fisher-Yates on
  // rand() — the module's rule about randomness holds for instruments too.
  if(T('shuffle')){
    for(let i = ms.length - 1; i > 0; i--){
      const j = (rand() * (i + 1)) | 0;
      const t = ms[i].k; ms[i].k = ms[j].k; ms[j].k = t;
    }
  }

  // Fade and cull, batched every 8 ticks with the decay raised to the 8th power.
  // Same reasoning as property.js: nothing reads strength at finer resolution than
  // its ~180-tick half-life, and the per-mark multiply is otherwise the whole cost
  // of this function.
  if(S.tick % FADE_EVERY === 0){
    const f = Math.pow(FADE, FADE_EVERY);
    for(let i = ms.length - 1; i >= 0; i--){
      const m = ms[i]; m.s *= f;
      if(m.s < MIN_STR){ ms.splice(i, 1); dirty = true; }
    }
  }
  if(dirty) rebuild();
}

export function markReset(){
  S.marks = [];
  grid = []; dirty = true;
  stats.reads = 0; stats.writes = 0; stats.misreads = 0; stats.kinReads = 0;
  _idxTick = -1;
}

// ---- writing ---------------------------------------------------------------

export function leave(c){
  const g = c.g; if(!g || !T('write')) return;

  // "It ate here" is measured as energy gained minus energy burned between this
  // call and the last one — world.js runs eating, predation and metabolism between
  // two consecutive leave() calls, so the delta is exactly the profit of standing
  // here. The cached value is transient per-body scratch and is deliberately not
  // serialised: after a restore the first step simply produces no forage mark.
  const prev = c._mkE; c._mkE = c.energy;

  // Situation, in priority order. No rand() is spent before this test: a body with
  // nothing to say must be free.
  let sit = -1;
  if(c.alert > ALERT_FRESH) sit = SIT_DANGER;
  else if(prev !== undefined && c.energy - prev > EAT_DELTA) sit = SIT_FORAGE;
  else if(c.groupSize >= GATHER_N) sit = SIT_GATHER;
  if(sit < 0) return;

  if(rand() >= DEP_P) return;

  const k = (sit + rotOf(g)) % G;

  // Merge into a standing mark of the same glyph and band rather than adding a new
  // record. The cap binds continuously either way (see the |S.marks| note in the
  // header), so merging is not what bounds the array — it is what keeps the 200
  // records SPREAD: without it a busy clearing writes two hundred near-identical
  // marks and evicts every site elsewhere in the world.
  if(dirty) rebuild();
  const cx = (c.x / MCELL) | 0, cy = (c.y / MCELL) | 0;
  const x0 = cx > 0 ? cx - 1 : 0, x1 = cx < gcols - 1 ? cx + 1 : gcols - 1;
  const y0 = cy > 0 ? cy - 1 : 0, y1 = cy < grows - 1 ? cy + 1 : grows - 1;
  let best = null, bd = MERGE_R2;
  for(let gy = y0; gy <= y1; gy++) for(let gx = x0; gx <= x1; gx++){
    const b = grid[gy * gcols + gx]; if(b === null) continue;
    for(let i = 0; i < b.length; i++){
      const m = b[i];
      if(m.k !== k || m.t !== c.type) continue;
      const dx = m.x - c.x, dy = m.y - c.y, d = dx * dx + dy * dy;
      if(d < bd){ bd = d; best = m; }
    }
  }
  if(best){
    best.s = Math.min(MAX_STR, best.s + 0.7);
    best.x += (c.x - best.x) * 0.10; best.y += (c.y - best.y) * 0.10;   // the site drifts toward use
    best.ln = c.lineage;
    best._sit = _instr ? sit : -1;
    dirty = true;
  } else {
    // At the cap, overwrite the faintest standing mark rather than dropping the
    // deposit. The first version dropped it, and since the cap binds from about
    // t=500 onward that froze the map into whatever the opening few hundred ticks
    // happened to write — the ground stopped tracking where food and danger
    // actually were. Eviction makes it a rolling window over the strongest sites.
    // The scan is O(MAX_MARKS) and only runs when the map is full.
    const ms = S.marks;
    let m;
    if(ms.length >= MAX_MARKS){
      let wi = 0, wv = ms[0].s;
      for(let i = 1; i < ms.length; i++) if(ms[i].s < wv){ wv = ms[i].s; wi = i; }
      m = ms[wi]; m.x = c.x; m.y = c.y; m.k = k; m.t = c.type; m.s = 1; m.ln = c.lineage;
    } else {
      m = { x: c.x, y: c.y, k, t: c.type, s: 1, ln: c.lineage, _sit: -1 };
      ms.push(m);
    }
    m._sit = _instr ? sit : -1;
    dirty = true;
  }
  c.energy -= MARK_COST * T('cost');
  stats.writes++;
}

// ---- reading ---------------------------------------------------------------

export function sense(c){
  const g = c.g;
  if(!g || !T('read') || !S.marks.length) return NO_PULL;
  if(dirty) rebuild();

  // Strongest readable mark of this body's own band within READ_R, weighted by
  // proximity so a body follows the mark it is standing nearest rather than the
  // loudest one two cells away.
  const cx = (c.x / MCELL) | 0, cy = (c.y / MCELL) | 0;
  const x0 = cx > 0 ? cx - 1 : 0, x1 = cx < gcols - 1 ? cx + 1 : gcols - 1;
  const y0 = cy > 0 ? cy - 1 : 0, y1 = cy < grows - 1 ? cy + 1 : grows - 1;
  let best = null, bs = 0, bdx = 0, bdy = 0, bd2 = 1;
  for(let gy = y0; gy <= y1; gy++) for(let gx = x0; gx <= x1; gx++){
    const b = grid[gy * gcols + gx]; if(b === null) continue;
    for(let i = 0; i < b.length; i++){
      const m = b[i];
      if(m.t !== c.type) continue;
      const dx = m.x - c.x, dy = m.y - c.y, d2 = dx * dx + dy * dy;
      if(d2 > READ_R2) continue;
      const score = m.s * (1 - d2 / READ_R2);
      if(score > bs){ bs = score; best = m; bdx = dx; bdy = dy; bd2 = d2; }
    }
  }
  if(!best) return NO_PULL;

  // Decode with the READER's convention. Nothing anywhere tells it what the writer
  // meant; if their rotations differ it will confidently act on the wrong meaning.
  const sit = (best.k - rotOf(g) + G) % G;
  c.mark = best.k + 1;                   // 0 = has read nothing; 1..G = the glyph it holds

  const cfg = TYPES[c.type];
  const reproE = cfg ? P[cfg.reproE] : 120;
  const str = clamp(best.s / 2.4, 0, 1);
  let w = 0, sign = 1;
  if(sit === SIT_FORAGE){
    // only a body that needs food acts on a forage mark
    if(c.energy < reproE * 0.72){ w = PULL * str; sign = 1; }
  } else if(sit === SIT_DANGER){
    w = PULL * 1.15 * str; sign = -1;
  } else {
    // a gathering is worth joining once you are fed enough to breed, and only if
    // your band is social at all
    if(c.energy >= reproE * 0.72 && cfg && cfg.social){ w = PULL * 0.55 * str; sign = 1; }
  }
  if(w <= 0) return NO_PULL;

  stats.reads++;
  if(best.ln === c.lineage) stats.kinReads++;
  if(_instr && best._sit >= 0 && best._sit !== sit) stats.misreads++;

  const d = Math.sqrt(bd2) || 1;
  _pull.dx = sign * bdx / d; _pull.dy = sign * bdy / d;
  _pull.w = w * T('pull');
  return _pull;
}

// ---- the HUD number --------------------------------------------------------

let _idxTick = -1, _idxVal = 0;

export function markIndex(){
  if(S.tick === _idxTick) return _idxVal;
  _idxTick = S.tick;
  const cs = S.creatures;
  if(cs.length < 8){ _idxVal = 0; return 0; }
  // per lineage, the histogram of conventions its living members hold
  const per = new Map();
  for(let i = 0; i < cs.length; i++){
    const c = cs[i]; if(c.dead) continue;
    let h = per.get(c.lineage);
    if(!h){ h = new Int32Array(G); per.set(c.lineage, h); }
    h[rotOf(c.g)]++;
  }
  // each lineage votes for its modal convention, weighted by how many bodies it has
  const w = new Float64Array(G);
  let tot = 0;
  for(const h of per.values()){
    let mi = 0, mv = h[0], n = h[0];
    for(let r = 1; r < G; r++){ n += h[r]; if(h[r] > mv){ mv = h[r]; mi = r; } }
    w[mi] += n; tot += n;
  }
  if(tot <= 0){ _idxVal = 0; return 0; }
  let s = 0;
  for(let r = 0; r < G; r++){ const p = w[r] / tot; s += p * p; }
  // Gini-Simpson, normalised so an even spread over all G conventions reads 1
  _idxVal = clamp((1 - s) / (1 - 1 / G), 0, 1);
  return _idxVal;
}

// ---- rendering -------------------------------------------------------------
// One shape and one hue per glyph, so two lineages writing different glyphs for
// the same situation are visibly different on the ground — which is the only way
// the convention claim is legible to a player at all. Deliberately NOT colour-coded
// by meaning: nothing in the world knows a mark's meaning except a reader holding a
// convention, and drawing the meaning would be drawing the answer.
// No rand() here: rendering must never draw on the simulation's random stream,
// or the frame rate would become an input to evolution.

const GLYPH_FILL = ['rgba(120,214,178,', 'rgba(226,122,190,', 'rgba(126,168,238,'];
const GLYPH_LINE = ['rgba(168,240,208,', 'rgba(248,168,220,', 'rgba(176,206,250,'];

export function drawWorld(ctx, view){
  const ms = S.marks; if(!ms.length) return;
  const z = view.z, vis = view.vis;
  const tiny = z < 0.30;
  for(let i = 0; i < ms.length; i++){
    const m = ms[i];
    const str = clamp(m.s / MAX_STR, 0, 1);
    const r = 3.4 + 4.2 * str;
    if(!vis(m.x, m.y, r + 3)) continue;
    const a = 0.20 + 0.52 * str;
    if(tiny){
      ctx.fillStyle = GLYPH_FILL[m.k] + a.toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(m.x, m.y, r * 0.6, 0, Math.PI * 2); ctx.fill();
      continue;
    }
    ctx.strokeStyle = GLYPH_LINE[m.k] + a.toFixed(3) + ')';
    ctx.fillStyle = GLYPH_FILL[m.k] + (a * 0.34).toFixed(3) + ')';
    ctx.lineWidth = 1.5 / z;
    ctx.beginPath();
    if(m.k === 0){
      // a chevron pointing up
      ctx.moveTo(m.x, m.y - r); ctx.lineTo(m.x + r * 0.92, m.y + r * 0.72);
      ctx.lineTo(m.x - r * 0.92, m.y + r * 0.72); ctx.closePath();
      ctx.fill(); ctx.stroke();
    } else if(m.k === 1){
      // a saltire
      const q = r * 0.82;
      ctx.moveTo(m.x - q, m.y - q); ctx.lineTo(m.x + q, m.y + q);
      ctx.moveTo(m.x + q, m.y - q); ctx.lineTo(m.x - q, m.y + q);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(m.x, m.y, r * 0.26, 0, Math.PI * 2); ctx.fill();
    } else {
      // a ring with a centre dot
      ctx.arc(m.x, m.y, r * 0.86, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(m.x, m.y, r * 0.30, 0, Math.PI * 2); ctx.fill();
    }
  }
}

// ---- save encoding ---------------------------------------------------------

export function packMarks(){
  const ms = S.marks, out = new Array(ms.length);
  for(let i = 0; i < ms.length; i++){
    const m = ms[i];
    out[i] = [+m.x.toFixed(0), +m.y.toFixed(0), m.k, TY.indexOf(m.t), +m.s.toFixed(2), m.ln || 0];
  }
  return out;
}

export function unpackMarks(a){
  const out = [];
  if(Array.isArray(a)){
    for(let i = 0; i < a.length && out.length < MAX_MARKS; i++){
      const r = a[i]; if(!r || r.length < 5) continue;
      const t = TY[r[3]] || 'herb';
      const k = ((r[2] | 0) % G + G) % G;
      const s = clamp(+r[4] || 1, MIN_STR, MAX_STR);
      out.push({ x: +r[0] || 0, y: +r[1] || 0, k, t, s, ln: r[5] | 0, _sit: -1 });
    }
  }
  S.marks = out;
  grid = []; dirty = true;
  _idxTick = -1;
}
