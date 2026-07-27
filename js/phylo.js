// Phylogeny: reproductive isolation, species identity and the family tree.
//
// Contract used by world.js and render.js — fixed signatures:
//
//   compatible(a, b)  -> boolean. Given two creatures' GENOMES, may they breed?
//                        world.js already screens by feeding band; this adds
//                        reproductive isolation on top.
//   phyloTick()       -> once per world step: assign/split species, keep the
//                        records in S.phylo up to date.
//   phyloReset()      -> clear species state (called from seed() and restore()).
//   speciesName(rec)  -> short display label for a species record.
//
// S.phylo is an array of records:
//   { id, parent, born, died, n, peak, type, hue, cx, cy, g, absorbed }
//   id     unique species id (1-based)          parent  id of the species it split from (0 = root)
//   born   tick of origin                        died   tick of extinction (0 while extant)
//   n      current headcount                     peak   highest headcount ever
//   type   feeding band at origin                hue    representative hue
//   cx,cy  centroid of living members            g      representative gene vector
//   absorbed  how many pruned sublineages this record now stands for (see prune())
//
// Each creature carries `c.sp` = its species id.
//
// What this record can and cannot support, for whoever draws it:
//
//   * The topology is complete for everything still in S.phylo — `parent` is
//     always an id that was minted earlier, so the structure is a forest of
//     strictly increasing ids and can never contain a cycle. It is a FOREST and
//     not a tree: a fresh world names each of its founding forms as a separate
//     root (parent 0), and a world that goes totally extinct starts a new set of
//     roots at the tick it is repopulated.
//   * Extinct branches are kept. They are only ever removed by prune(), and a
//     prune is now recorded on the surviving ancestor as `absorbed` so a node can
//     say how much vanished history it stands for.
//   * There is NO per-lineage population history: only `peak` and the current
//     `n`. A drawing may scale a branch by those two numbers, but it cannot draw
//     a population curve through time without inventing one.
//   * `g` does NOT survive a save. world.js serialises id/parent/born/died/n/
//     peak/type/hue only, and restore() sets `g: null`; the next census refills
//     it for LIVING species and never for extinct ones. `absorbed` is dropped by
//     the same serialiser, so it restarts at 0 after a reload. Both degrade by
//     under-reporting, which is the correct direction: a restored world admits it
//     does not know, rather than inventing history it never had.
//   * A record restored from a save may carry `g` as a plain object (Float64Array
//     does not round-trip through JSON). recVec() below normalises both shapes.
//
// How a species is born here, in evolutionary terms:
//
//   * Isolation is a mate-recognition failure, not a decree. compatible() asks
//     how far apart two genomes sit in the traits a courting animal can judge;
//     past P.specThresh they simply no longer recognise each other. Gene flow
//     stops, and two halves of one cloud start drifting independently.
//   * Allopatry does most of the work, as it does in nature. The void between
//     planets is an absolute barrier — only a lineage carrying the `disperse`
//     gene ever crosses it — so a colony has exactly zero gene flow with its
//     source from the moment it lands. It needs only partial divergence
//     (ALLO_F of the sympatric threshold) before we call it a separate species.
//   * Sympatric splits still happen, but demand the full threshold: the cloud
//     must have pulled apart into two genuinely non-interbreeding clusters on
//     the same ground, which is the hard case in nature too.
//   * A species is a population, never an individual. A daughter needs MIN_SP
//     living members and the mother must keep as many, and a lineage that has
//     just split cannot split again for COOL ticks. Without those brakes drift
//     alone shatters the population into singletons every generation, which is
//     bookkeeping, not speciation.
//
// ===========================================================================
// WHAT ISOLATION ACTUALLY PRODUCES, MEASURED. Read this before tuning anything.
//
// The four questions were: does allopatric divergence happen at all; does
// secondary contact ever occur at the shipped dispersal rate; what happens when
// it does; and is P.specThresh calling these separations "species" consistently
// with the genetic distance the world actually generates.
//
// METHOD. Headless chromium over the tests/sim.test.mjs harness, seed() then a
// bare step() loop, sampling every 2500 ticks. The statistic is the distance
// between two groups' centroids in tv()'s own eight weighted axes — the same
// space compatible() judges in, so a number here is directly comparable to
// P.specThresh. Group centroids are noisy, and the noise grows as the groups
// shrink, so every figure below is SAMPLING-NOISE CORRECTED: for two samples of
// one cloud with per-axis variance v_k, E|cA-cB|^2 = sum_k v_k (1/na + 1/nb),
// and the reported value is sqrt(max(0, raw^2 - noise^2)). Bands are measured
// separately and never pooled; a pair needs 8 bodies a side to be counted.
//
// THREE CONTROLS, at the same tick and the same run length, never optional:
//   * even/odd creature id inside ONE planet — a pure sampling null. It returns
//     0.016 +- 0.014 (max 0.069) over 64 samples, which is how we know the
//     correction above works rather than merely sounds plausible.
//   * left/right SPATIAL halves of one planet — real population structure with
//     gene flow left switched on. This is the control that actually threatens
//     the result and it is the one quoted in every table below.
//   * a 20-gene panel that tv() never reads (altruism, trade, tribal, pyro...),
//     as an independent set of axes.
//
// --- 1. ALLOPATRIC DIVERGENCE IS REAL, AND ITS SIGNATURE IS DRIFT ---
//
// P.dispOn = false, 4 planets, 4 seeds (11 / 55 / 321 / 777) x 40 000 ticks,
// herbivores. Mean +- sd ACROSS SEEDS of the corrected between-planet distance,
// against the two within-planet controls at the same tick:
//
//   tick     between-planet     spatial halves   even/odd
//     150    0.019 +- 0.009 *   0.015            0.030      * 5 seeds, founding
//    2500    0.144 +- 0.028     0.177            0.015
//    5000    0.194 +- 0.010     0.226            0.015
//   10000    0.326 +- 0.013     0.166            0.032
//   20000    0.370 +- 0.111     0.120            0.018
//   30000    0.534 +- 0.104     0.143            0.007
//   40000    0.575 +- 0.179     0.084            0.018
//
// Endpoint per seed 0.490 / 0.572 / 0.825 / 0.413. The between-planet number
// climbs in all four seeds; the spatial control is FLAT for the whole run
// (0.143 +- 0.066 over 64 samples, 0.163 in the first half of the run against
// 0.123 in the second). At 40 000 ticks isolation has produced roughly seven
// times what within-planet structure produces, and the two curves have opposite
// shapes. Isolation is doing something that distance alone does not.
//
// It is doing DRIFT, not adaptation. A one-parameter fit d = k*sqrt(t) — the
// neutral random-walk law — gives k = 2.62 / 3.05 / 3.19 / 3.05 e-3 per
// sqrt(tick) with R^2 = 0.78 / 0.89 / 0.74 / 0.51. The 20-gene panel tv() never
// reads diverges in lockstep (0.20 at 2500 -> 1.37 at 40 000), which is what
// drift does to every axis at once and what a diet- or terrain-specific
// selective response would not.
//
// THE OBVIOUS CONFOUND, KILLED. world.js re-seeds a planet with 20 fresh
// randomGenome() bodies whenever its herbivores hit zero, and that fired 10 / 20
// / 46 / 11 times in these four runs. A planet re-rolled from the founding
// distribution could plausibly manufacture between-planet distance out of
// nothing. Measured at t = 150-300 across 5 seeds, two planets freshly drawn from
// that distribution sit 0.019 +- 0.009 apart — indistinguishable from the
// even/odd null. The rescue is therefore a HOMOGENISING force that drags the
// statistic back toward 0.02, and the runs reach 0.41-0.83 anyway. It cannot be
// the cause; if anything it makes the measurement conservative. (Seed 321 has the
// most rescues, 46, and the highest endpoint, 0.825, so the confound does not
// even correlate in the direction it would need to.)
//
// READ THE LIMITS HONESTLY:
//   * The spatial control rules out cluster composition. It does not rule out
//     DISTANCE: two planets are farther apart than two halves of one planet, and
//     this world has no same-planet pair at matched separation with gene flow
//     blocked, so "barrier" and "far" are not separated by anything here.
//   * The 20-gene panel is neutral to tv(), not neutral to selection — several of
//     those genes are read by the level-2/3 modules. It is an independent-axes
//     check, not a proof of neutrality.
//   * genome.js's warning that a functionless gene diffuses toward 0.5, which
//     would pull two isolated populations back together and SHRINK the apparent
//     divergence at long run lengths, DID NOT BITE inside 40 000 ticks: trait
//     variance rose in every seed (0.087 -> 0.127, 0.121 -> 0.144, 0.099 ->
//     0.161, 0.121 -> 0.151) and the between-planet distance ends at its
//     highest value in all four. Past 40 000 it may. This measurement does not
//     say what happens at 100 000, and the mechanism that would cause it is real.
//
// --- 2. THE SAFETY NET IS A CROSS-PLANET GENE-FLOW CHANNEL ---
//
// Herbivores are quoted above because they are the only band with no artificial
// gene flow. world.js's reinforce() copies a living omni/carn's whole genome AND
// its lineage onto a starved planet every 25 ticks. With dispersal off and zero
// crossings, 322/387, 454/484, 410/519 and 361/413 reinforcement births still
// landed on a planet other than their lineage's founding planet — a hidden
// cross-planet channel running at roughly 85% of all reinforcements, in a world
// whose whole premise is that the void cannot be crossed. Same worlds, same
// ticks, same statistic, at 40 000:
//
//   seed        11      55     321     777     mean
//   herb     0.490   0.572   0.825   0.413    0.575    (geography only)
//   omni     0.195   0.421   0.547   0.491    0.414    (geography + reinforce())
//
// Four seeds out of four, same direction. The confound is that omnivores also
// differ from herbivores in population size and in being sexual, so this is an
// upper bound on reinforce()'s effect and not a clean isolation of it — but any
// measurement of isolation that POOLS THE BANDS understates it by about a third.
//
// --- 3. SECONDARY CONTACT: NONE FOR 10 000 TICKS, THEN A FLOOD ---
//
// Shipped parameters, seeds 11 and 55 to 40 000 ticks and seed 321 to 30 000. A
// surviving creature id whose planet index changes between ticks is provably a
// dispersal: world.js reverts every other step into the void, so nothing else can
// produce it. Crossings by living bodies, per 4000-tick window:
//
//   seed   0-4k   4-8k   8-12k   12-16k   16-20k   20-24k   24-28k   total
//     11      1      1       2       21       67      117       71    1007
//     55      0      3      10       29      118      168      172     878
//    321      0      1      17       33       78      233      238     769
//
// (The event log caps at 600 entries, so the windows past 28k are truncated; the
// totals are complete.) All three seeds do the same thing: essentially nothing
// for the first eight to ten thousand ticks, and then it does not stop.
//
// The gate is drift, not adaptation. tryDisperse() requires g.disperse >=
// P.dispThresh = 0.5; genome.js already records `disperse` as DRIFT with a 30k
// midpoint of 0.556; and the count of bodies over the gate goes 1 -> 14 -> 47 ->
// 150 -> 199 as the population mean walks 0.105 -> 0.343. P.dispThresh sits
// essentially ON the neutral attractor of the gene that opens it, so the shipped
// world spends its opening as four sealed planets and the rest of its life as one
// — and the switch-over is a random walk arriving, not a strategy succeeding.
// It is not selection for dispersal: at 40 000 the population mean `disperse` is
// 0.343 with the void crossable against 0.247 / 0.331 with it sealed — same band,
// no separation. Colonisation of all four planets completes at t = 16000 (seed 11),
// t = 12500 (seeds 55 and 321).
//
// --- 4. WHAT HAPPENS ON CONTACT: DISPLACEMENT, ALMOST NEVER MERGING ---
//
// The clean case first. Planet 2's herbivores, seed 11 — two arrivals, opposite
// outcomes, separated by exactly the thing compatible() measures:
//
//   tick   immigrants  residents  frac  d(imm,res)  species called
//   12000       4 (from pl0)  60   0.06     0.136   SAME  (1 vs 1)
//   16000       5 (from pl0)  28   0.14     0.322   SAME  (1 vs 1)
//   20000      29 (from pl3)  27   0.52     0.680   DIFFERENT (24 vs 22)
//   24000     115 (from pl3)   0   1.00       --    resident gone
//   28000     134 (from pl3)   0   1.00       --
//   40000      21 (from pl3)   0   1.00       --
//
// The pl0 lineage arrived 0.136 away, inside P.specThresh, and MERGED — it never
// appears again as a distinct group because it stopped being one. The pl3 lineage
// arrived 0.680 away, could not exchange a single gene with the residents, and
// DISPLACED them: 27 residents to 0 in 4000 ticks while the immigrants went
// 29 -> 115. Coexistence as a distinct cluster existed for exactly one 4000-tick
// window, at 29 against 27.
//
// Displacement is the normal outcome, not the interesting exception. Across the
// three shipped seeds, 26 of 96 herbivore contact episodes read resident count 0
// with 10 or more immigrants standing on the planet (13 of 19 in seed 11, 7 of 50
// in seed 55, 6 of 27 in seed 321). Nothing in any run looks like two populations
// settling into a stable hybrid zone.
//
// THE SEEDS DISAGREE ABOUT THE ENDING, AND THAT MATTERS.
//   * Seed 11 ends in a GLOBAL SWEEP. From t = 24000 every contact episode reads
//     residents 0, fraction 1.00; distinct lineages fall 40 -> 3, extant species
//     16 -> 6, and the herbivore between-planet distance collapses 0.421 (24000)
//     -> 0.009 (36000) -> 0.000 (40000). One lineage founded on planet 3 holds all
//     four planets, and forty thousand ticks of allopatry is undone in twelve.
//   * Seed 321 goes the same way and is not quite finished at 30 000. A single
//     lineage founded on planet 3 takes planet 2 (residents 0 from t = 20000),
//     planet 0 (0 by 30000) and is at 21 against 26 on planet 1 when the run ends.
//     Lineages 81 -> 3, extant 13 -> 7, between-planet distance 0.383 (17500) ->
//     0.185 (30000) and still falling.
//   * Seed 55 does NOT. Two clades founded on planets 0 and 1 both spread and
//     partition the world between them — at 40 000 they sit on planet 3 together
//     (5 and 14 bodies, species 44 and 42). Its between-planet distance dips to
//     0.157 at 27500 and RECOVERS to 0.440 by 40 000.
// So contact reliably destroys the resident and reliably erodes divergence, and
// two of three seeds end with one lineage owning the sky. It is a strong tendency,
// not a law: seed 55 shows a stable two-clade world is reachable from the shipped
// parameters. Three seeds cannot say how often.
//
// The erosion is caused by crossing, not by ordinary lineage turnover: the
// isolated control loses lineages just as fast (96 -> 7, 111 -> 16, 81 -> 15,
// 57 -> 10 across the four dispersal-off seeds) while its between-planet distance
// rises the whole way. Turnover alone does not homogenise the planets.
//
// THE ANIMALS CAN MERGE. THE TREE CANNOT. This is the one real defect the
// measurement turned up. Of 49 herbivore contact episodes with a measurable
// immigrant-resident distance across the three shipped seeds, 25 were CLOSER than
// P.specThresh — compatible() would have let every one of those pairs breed — and
// the tree still called 23 of the 25 different species. Twenty of the twenty-five
// sit in the 0.2436-0.42 band, which is precisely the window ALLO_F opens and
// P.specThresh does not close: trySplit() mints an allopatric daughter at
// specThresh * ALLO_F, and NOTHING IN THIS MODULE EVER FUSES TWO LIVE RECORDS
// BACK TOGETHER. A record leaves S.phylo by going extinct or by being pruned,
// never by rejoining its sister. Secondary contact between 0.2436 and 0.42 there-
// fore produces populations that interbreed freely under two different names.
// The rate is not a fluke of one world: seed 321 alone contributes 10 of 10
// below-threshold episodes labelled distinct, 8 of them inside the band.
// The error is one-directional and that is the saving grace: of the 24 episodes
// FARTHER apart than P.specThresh, the tree called 0 of them the same species. It
// never claims two things are one when they cannot breed; it only fails to notice
// when two things have become one again.
//
// --- 5. IS P.specThresh 0.42 CALIBRATED? YES, FOR WHAT ISOLATION PRODUCES ---
//
// Same seed, same 12 000 ticks, shipped dispersal, only P.specThresh changed:
//
//   measurement                                    0.42        0.16
//   herb between-planet distance (the WORLD)       0.262       0.163
//   herb within-planet halves (the WORLD)          0.250       0.141
//   records / MAX_REC 150                          18          150 (pinned from 3000)
//   roots                                          11          128-150
//   extant species                                 11          39-56
//   allopatric : sympatric splits                  5 : 2       4 : 18
//   cross-planet pairs called different species    5/6         6/6
//   within-planet halves called different          1/3         3/4
//
// 0.42 sits in the gap the world leaves. Complete isolation saturates the
// between-planet distance at 0.49-0.83 by 40 000, just above the threshold, while
// the within-planet halves sit at 0.06-0.20, well below it. In the isolated arm at
// 40 000 the classifier called 3 of 3 cross-planet pairs different species and 0 of
// 2 within-planet halves — it agrees with the measurement on both sides. At 0.16
// it starts calling the two halves of a single planet different species 3 times in
// 4, which is isolation-by-distance being promoted to speciation.
//
// Three riders on that verdict:
//   * The threshold itself is not what makes allopatric speciation happen in a run
//     of watchable length — 0.42 is not reached until ~22 500 ticks of total
//     isolation. ALLO_F is. 0.42 * 0.58 = 0.2436 is crossed at about t = 6000, and
//     the first allopatric split is recorded at t = 5000. ALLO_F is load-bearing,
//     not a garnish; raise it and allopatry stops happening inside a session.
//   * ALLO_F is therefore load-bearing in BOTH directions, and the second one is a
//     cost. Because the two-thirds threshold is only ever crossed downwards by the
//     animals and never by the record, the module deliberately labels at 0.2436
//     while it breeds at 0.42, and there is no path back. P.specThresh is well
//     calibrated to what isolation produces; the SPECIES LABEL over-splits relative
//     to the breeding rule by design, and section 4 counts what that costs — 23 of
//     25 freely-interbreeding contact pairs carrying two names. Fixing that is a
//     re-merge path, not a different threshold.
//   * "Allopatry does most of the work" (above) is true EARLY and not true at
//     40 000. Split ledger over the four isolated runs: 10:7, 15:23, 15:9, 18:25 —
//     58 allopatric against 64 sympatric. At 12 000 ticks it is 5:2. Sympatry
//     catches up once populations are large and variable enough to bisect.
//
// --- 6. TWO CLAIMS IN THIS FILE'S OWN HEADER, CHECKED AGAINST THE RUNS ---
//
// (a) prune()'s graft path is DEAD CODE IN PRACTICE, and `absorbed` is always 0.
//     At shipped settings the question never arises: 42 records after 40 000 ticks
//     against a cap of 150, so prune() is never entered at all. Forced to run by
//     dropping P.specThresh to 0.16 (records pin at MAX_REC from t = 3000):
//
//       tick    3000   6000   9000  12000
//       pruned   115    122    128    137
//       rootLost 115    122    128    137
//       absorbed   0      0      0      0
//
//     pruned == rootLost at every single sample. The reason is structural, not
//     bad luck: prune() drops the lowest peak*duration records first, which are
//     exactly the singleton roots adopt() minted, and a root's parent is 0, so
//     resolve() returns 0 and the whole weight goes to rootLost. `absorbed` is a
//     field no world has ever set. It is not wrong — it is unreachable, and the
//     header paragraph promising a node can "say how much vanished history it
//     stands for" describes a capability that has never once been exercised.
//
// (b) The adopt() comment claiming the min-population rule is "what stops the tree
//     fragmenting into hundreds of singletons" was FALSE, and is corrected below.
//     MIN_SP constrains trySplit() and nothing else. The founding pass —
//     phyloTick() calling adopt(c, true) for every creature whenever nothing is
//     extant — reaches mint(null, [c], v) with a SINGLE creature, and how many
//     singleton roots it mints is set by P.specThresh alone. From the identical
//     268-body seed: 11 roots at 0.42, and at 0.16, 265 roots (150 still held plus
//     115 already pruned, every one of them a root, no split having yet occurred).
//     Hundreds of singletons is precisely what happens. The only thing preventing
//     it at shipped settings is that 0.42 is coarse enough to swallow 268 founders
//     into 11 groups — a threshold, not a population rule.
//
//     The header's other structural claim survives, and more strongly than it is
//     stated: this is a FOREST, and the number of trees in it is fixed at t = 0.
//     Across all seven long runs the root count never moved once — 11, 11, 11 and
//     12 depending only on which seed drew the founding population — while records
//     grew to 28-54. Nothing after the founding pass can mint a root, and nothing
//     joins two of them, so 11 of the 42 records at the end of the shipped seed-11
//     run have no parent and never will.
//
// --- 7. WHAT WAS NOT SHOWN ---
//
//   * The divergence result of section 1 has four seeds; the contact results of
//     sections 3 and 4 have three, and one of those three ran to 30 000 ticks
//     rather than 40 000. Two of the three end in a global sweep and the third
//     does not, which is enough to say the sweep is common and not enough to say
//     how common. Nobody should quote a probability from n = 3.
//   * `carn` was never measurable. Fewer than 8 bodies per planet on every planet
//     at every sample in every run; every carnivore cell in every table is empty.
//   * "Drift, not adaptation" is an inference from the sqrt(t) shape and the
//     neutral panel, not a direct test. The direct test — hold every planet's
//     ecology identical and look for the same curve — was not run.
//   * No per-lineage population history was added to this module. This measurement
//     wanted one and took it from an external harness instead, so the save format
//     and its memory cost are untouched, and the header bullet saying a drawing
//     cannot draw a population curve through time is still true.
//   * Nothing here measures whether a player can SEE any of it.

import { P, S, typeOf } from './state.js';

/* ---------- the trait space isolation acts in ---------- */
// The traits weighted here are the ones a courting animal can actually assess:
// what the other eats, how big and how fast it is, and the signals it wears
// (colour, shape, pattern, ornament). Pre-zygotic barriers of exactly this kind
// — song, plumage, body size, host plant — separate most young sister species
// in the wild; genome-wide incompatibility only arrives long afterwards.
const K = 8;
function tv(g, o){
  o[0] = (g.diet === undefined ? 0.15 : g.diet) * 1.25;
  o[1] = (g.size === undefined ? 5 : g.size) / 9 * 0.95;
  o[2] = (g.speed === undefined ? 1.4 : g.speed) / 3.4 * 0.85;
  o[3] = (g.hue === undefined ? 0 : g.hue) / 360 * 1.05;
  o[4] = (g.shape === undefined ? 0.3 : g.shape) * 0.8;
  o[5] = (g.pattern === undefined ? 0.5 : g.pattern) * 0.75;
  o[6] = (g.ornament === undefined ? 0 : g.ornament) * 0.65;
  o[7] = (g.sense === undefined ? 60 : g.sense) / 165 * 0.55;
  return o;
}
const dist = (a, b) => { let s = 0; for(let i = 0; i < K; i++){ const d = a[i] - b[i]; s += d * d; } return Math.sqrt(s); };
// scratch vectors: compatible() runs inside the mating loop, so it must not allocate
const _a = new Float64Array(K), _b = new Float64Array(K), _c = new Float64Array(K);

/* ---------- tuning ---------- */
const MIN_SP = 10;        // a species is a population: fewer members than this is a straggler, not a lineage
const COOL = 520;         // ticks a lineage must consolidate before it may split again
const ALLO_F = 0.58;      // an isolated colony needs only partial divergence — there is no gene flow to erode it
const MAX_EXTANT = 40;    // ecological ceiling: the world holds this many coexisting species at most
const MAX_REC = 150;      // total records kept (S.phylo is serialised into localStorage)
const CENSUS = 64;        // ticks between full censuses — everything else is amortised

// live diagnostics (read by tests / tuning; not part of the save format)
export const phyloStats = { tested: 0, blocked: 0, splits: 0, allo: 0, sym: 0, extinct: 0, pruned: 0 };

// Revision counter for anything that draws the tree. `rev` is bumped only when
// the SHAPE of the forest changes — a species minted, a species declared extinct,
// a prune — so a view can cache its layout and rebuild on a compare of one
// integer instead of walking S.phylo every frame. Headcounts move on their own
// (every CENSUS ticks) without bumping it: a drawing reads r.n live.
// `rootLost` counts records pruned away that had no surviving ancestor to be
// grafted onto, i.e. founding lineages that fell out of the record window.
export const phyloInfo = { rev: 0, rootLost: 0 };

let cursor = 0;           // rolling position of the amortised scan over the population
let idx = new Map();      // species id -> record
let idxArr = null, idxLen = -1;

function reindex(){
  const A = S.phylo;
  if(A === idxArr && A.length === idxLen) return;
  idx = new Map();
  for(const r of A) idx.set(r.id, r);
  idxArr = A; idxLen = A.length;
}

// which planet a point sits on (-1 = the void between worlds). Inlined rather
// than imported from world.js to keep this module free of cycles.
function planetAt(x, y){
  const A = S.planets;
  for(let i = 0; i < A.length; i++){ const p = A[i]; if(x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) return i; }
  return -1;
}

/* ---------- reproductive isolation ---------- */
export function compatible(a, b){
  phyloStats.tested++;
  const d = dist(tv(a, _a), tv(b, _b));
  if(d < P.specThresh) return true;
  phyloStats.blocked++;
  return false;
}

/* ---------- species bookkeeping ---------- */
function mint(parent, members, gv){
  const rec = {
    id: ++S.speciesN, parent: parent ? parent.id : 0, born: S.tick, died: 0,
    n: members.length, peak: members.length,
    type: 'herb', hue: 0, cx: 0, cy: 0, g: Float64Array.from(gv), split: S.tick, absorbed: 0
  };
  let dietS = 0, hueS = 0, xs = 0, ys = 0;
  for(const c of members){ c.sp = rec.id; dietS += c.g.diet || 0; hueS += c.g.hue || 0; xs += c.x; ys += c.y; }
  const m = members.length || 1;
  rec.type = typeOf(dietS / m); rec.hue = hueS / m; rec.cx = xs / m; rec.cy = ys / m;
  S.phylo.push(rec); idxArr = null;
  phyloStats.splits++; phyloInfo.rev++;
  return rec;
}

// Adopt a creature with no valid species. Outside the founding pass it always
// joins the closest living lineage, however far that is: an oddball is a variant
// within its species, not a species of one. So outside the founding pass this
// function cannot mint anything at all.
//
// `found` is true only while naming the forms a fresh world was seeded with —
// a fresh seed, or the aftermath of total extinction. In THAT pass mint() is
// reached with a single creature, and the number of one-body roots it produces is
// set by P.specThresh and by nothing else. Measured from the same 268-body seed:
// 11 roots at the shipped 0.42, and 265 at 0.16. MIN_SP does not enter into it —
// it constrains trySplit() only, and the founding pass never consults it. An
// earlier version of this comment claimed the min-population rule was "what stops
// the tree fragmenting into hundreds of singletons"; hundreds of singletons is
// exactly what a finer threshold produces here, and the numbers are in section 6b
// of the header block.
function adopt(c, found){
  const v = tv(c.g, _a);
  let best = null, bd = found ? P.specThresh : Infinity;
  for(const r of S.phylo){
    if(r.died || !r.g) continue;
    const d = dist(v, r.g);
    if(d < bd){ bd = d; best = r; }
  }
  if(best){ c.sp = best.id; return; }
  if(!found){ c.sp = 0; return; }
  mint(null, [c], v);
}

/* ---------- split tests ---------- */
// 2-means over a species' members, seeded by the two most distant individuals
// found with a deterministic farthest-point walk (no rand(), so a world stays
// reproducible from its seed). Returns the two clusters, or null.
let _vs = new Float64Array(0), _lab = new Uint8Array(0);
function bisect(members){
  const m = members.length;
  if(_vs.length < m * K){ _vs = new Float64Array(m * K); _lab = new Uint8Array(m); }
  const vs = _vs, lab = _lab, sc = _c;
  for(let i = 0; i < m; i++){ tv(members[i].g, sc); vs.set(sc, i * K); }
  const dv = (i, c) => { let s = 0, o = i * K; for(let k = 0; k < K; k++){ const d = vs[o + k] - c[k]; s += d * d; } return Math.sqrt(s); };
  const farthest = from => { const c = vs.subarray(from * K, from * K + K); let far = 0, fd = -1; for(let i = 0; i < m; i++){ const d = dv(i, c); if(d > fd){ fd = d; far = i; } } return far; };
  const bi = farthest(0), ai = farthest(bi);
  if(bi === ai) return null;
  const ca = vs.slice(ai * K, ai * K + K), cb = vs.slice(bi * K, bi * K + K);
  for(let it = 0; it < 3; it++){
    for(let i = 0; i < m; i++) lab[i] = dv(i, ca) <= dv(i, cb) ? 0 : 1;
    ca.fill(0); cb.fill(0);
    let na = 0, nb = 0;
    for(let i = 0; i < m; i++){
      const o = i * K, t = lab[i] ? cb : ca;
      if(lab[i]) nb++; else na++;
      for(let k = 0; k < K; k++) t[k] += vs[o + k];
    }
    if(!na || !nb) return null;
    for(let k = 0; k < K; k++){ ca[k] /= na; cb[k] /= nb; }
  }
  const A = [], B = [];
  for(let i = 0; i < m; i++) (lab[i] ? B : A).push(members[i]);
  if(A.length < MIN_SP || B.length < MIN_SP) return null;
  return { A, B, ca, cb, gap: dist(ca, cb) };
}

const centroid = (members, out) => {
  out.fill(0);
  for(const c of members){ const v = tv(c.g, _c); for(let k = 0; k < K; k++) out[k] += v[k]; }
  for(let k = 0; k < K; k++) out[k] /= members.length;
  return out;
};

// A species splits when a part of it has stopped exchanging genes with the rest.
// Geography is tried first — it is the cheap, historically dominant route — and
// only then the harder sympatric case.
function trySplit(rec, members){
  if(members.length < MIN_SP * 2) return false;
  if(S.tick - (rec.split || rec.born || 0) < COOL) return false;

  // allopatric: sort the members by the planet they live on. A colony that no
  // longer resembles the mainland is already a separate evolutionary unit —
  // there is no migration left to pull the two back together.
  if(S.planets.length > 1){
    const byPl = new Map();
    for(const c of members){ const p = planetAt(c.x, c.y); if(p < 0) continue; let g = byPl.get(p); if(!g) byPl.set(p, g = []); g.push(c); }
    if(byPl.size > 1){
      let home = null, hn = -1;
      for(const [, g] of byPl) if(g.length > hn){ hn = g.length; home = g; }
      if(hn >= MIN_SP){
        const hc = centroid(home, new Float64Array(K));
        let best = null, bd = P.specThresh * ALLO_F;
        for(const [, g] of byPl){
          if(g === home || g.length < MIN_SP) continue;
          const d = dist(centroid(g, _b), hc);
          if(d > bd){ bd = d; best = g; }
        }
        if(best){
          const gv = centroid(best, new Float64Array(K));
          mint(rec, best, gv); rec.split = S.tick; phyloStats.allo++;
          return true;
        }
      }
    }
  }

  // sympatric: the cloud has pulled apart into two clusters that can no longer
  // interbreed even standing on the same ground — the full barrier is required.
  const bs = bisect(members);
  if(bs && bs.gap >= P.specThresh){
    const small = bs.A.length <= bs.B.length ? bs.A : bs.B;
    mint(rec, small, small === bs.A ? bs.ca : bs.cb); rec.split = S.tick; phyloStats.sym++;
    return true;
  }
  return false;
}

/* ---------- census ---------- */
function census(){
  reindex();
  const groups = new Map();
  const orphans = [];
  for(const c of S.creatures){
    const r = c.sp ? idx.get(c.sp) : null;
    if(!r || r.died){ orphans.push(c); continue; }
    let g = groups.get(r.id); if(!g) groups.set(r.id, g = []); g.push(c);
  }
  // headcounts, centroids and extinctions
  for(const r of S.phylo){
    const g = groups.get(r.id);
    if(!g || !g.length){
      r.n = 0;
      if(!r.died){ r.died = S.tick; phyloStats.extinct++; phyloInfo.rev++; }
      continue;
    }
    r.n = g.length; if(r.n > r.peak) r.peak = r.n;
    r.g = centroid(g, r.g && r.g.length === K ? r.g : new Float64Array(K));
    let hue = 0, diet = 0, xs = 0, ys = 0;
    for(const c of g){ hue += c.g.hue || 0; diet += c.g.diet || 0; xs += c.x; ys += c.y; }
    r.hue = hue / r.n; r.cx = xs / r.n; r.cy = ys / r.n; r.type = typeOf(diet / r.n);
  }
  for(const c of orphans) adopt(c);

  // At most one new species per census, so the tree grows by events rather than
  // by noise. Candidates are tried biggest first — a large population holds more
  // standing variation and more scattered colonies, so that is where a split is
  // most likely to be real — and the first one that qualifies takes the slot.
  let extant = 0; for(const r of S.phylo) if(!r.died) extant++;
  if(extant < MAX_EXTANT){
    const cand = [];
    for(const [id, g] of groups){
      const r = idx.get(id);
      if(!r || r.died || g.length < MIN_SP * 2) continue;
      if(S.tick - (r.split || r.born || 0) < COOL) continue;
      cand.push({ r, g });
    }
    cand.sort((a, b) => b.g.length - a.g.length);
    if(cand.length > 6) cand.length = 6;      // the sympatric test is the costly one — keep the census bounded
    for(const cd of cand) if(trySplit(cd.r, cd.g)) break;
  }
  prune();
}

// S.phylo rides along in the save file, so the fossil record has to be finite.
// Extinct twigs that never amounted to anything go first; a pruned record's
// children are grafted onto its own parent so the tree stays connected.
//
// The graft used to be silent, and that was a lie by omission: a node that had
// swallowed thirty extinct sublineages looked exactly like one that had swallowed
// none. Each surviving ancestor now carries `absorbed` — the number of records
// folded into it, including anything those records had already absorbed — so a
// drawing can make the collapsing visible instead of pretending it never
// happened. It is a counter incremented inside a prune, which only runs when the
// record list is over MAX_REC, so it costs nothing per tick.
function prune(){
  if(S.phylo.length <= MAX_REC) return;
  const dead = S.phylo.filter(r => r.died);
  if(!dead.length) return;
  dead.sort((a, b) => (a.peak * (a.died - a.born + 1)) - (b.peak * (b.died - b.born + 1)));
  const drop = new Set();
  for(let i = 0; i < dead.length && S.phylo.length - drop.size > MAX_REC; i++) drop.add(dead[i].id);
  if(!drop.size) return;
  const graft = new Map();
  for(const r of S.phylo) if(drop.has(r.id)) graft.set(r.id, r.parent);
  const resolve = id => { let g = id, n = 0; while(drop.has(g) && n++ < MAX_REC) g = graft.get(g) || 0; return g; };
  // roll each dropped record's weight onto whichever ancestor survives it; the
  // ones whose whole ancestry went with them are counted at the root instead
  const carry = new Map();
  for(const r of S.phylo){
    if(!drop.has(r.id)) continue;
    const w = 1 + (r.absorbed || 0), g = resolve(r.parent);
    if(g) carry.set(g, (carry.get(g) || 0) + w); else phyloInfo.rootLost += w;
  }
  S.phylo = S.phylo.filter(r => !drop.has(r.id));
  for(const r of S.phylo){
    if(drop.has(r.parent)) r.parent = resolve(r.parent);
    const a = carry.get(r.id); if(a) r.absorbed = (r.absorbed || 0) + a;
  }
  phyloStats.pruned += drop.size;
  phyloInfo.rev++;
  idxArr = null;
}

/* ---------- per-step entry point ---------- */
export function phyloTick(){
  const cr = S.creatures, n = cr.length;
  if(!n) return;
  reindex();

  // a world with nothing living left on the tree — a fresh seed, or the aftermath
  // of total extinction — names its founding forms in one pass, and the tree
  // starts again from those roots
  if(!extantCount()){ for(const c of cr) adopt(c, true); census(); return; }

  // amortised scan: a slice of the population each tick. Newcomers (founders,
  // reinforcements, restored saves) are adopted; individuals that have drifted
  // clean out of their own species look for one they still belong to.
  const slice = Math.min(n, Math.max(24, Math.ceil(n / 18)));
  for(let i = 0; i < slice; i++){
    const c = cr[(cursor + i) % n];
    const r = c.sp ? idx.get(c.sp) : null;
    if(!r || r.died){ adopt(c); continue; }
    if(!r.g) continue;
    if(dist(tv(c.g, _a), r.g) > P.specThresh * 1.5){ c.sp = 0; adopt(c); }
  }
  cursor = (cursor + slice) % n;

  if(S.tick % CENSUS === 7) census();
}

export function phyloReset(){
  S.phylo = []; S.speciesN = 0;
  cursor = 0; idx = new Map(); idxArr = null; idxLen = -1;
  phyloStats.tested = phyloStats.blocked = phyloStats.splits = 0;
  phyloStats.allo = phyloStats.sym = phyloStats.extinct = phyloStats.pruned = 0;
  phyloInfo.rev++; phyloInfo.rootLost = 0;   // bump, never reset: a view must notice
}

/* ---------- display ---------- */
// A pronounceable binomial-ish tag, derived from the id so a species keeps the
// same name for the whole run (and across saves).
const SY1 = ['Ver', 'Cal', 'Mor', 'Sil', 'Thal', 'Ryn', 'Ost', 'Vel', 'Ner', 'Dra', 'Pyr', 'Lum', 'Xan', 'Cor', 'Ith', 'Bry'];
const SY2 = ['ia', 'ex', 'os', 'ura', 'ida', 'ys', 'ara', 'on', 'eth', 'ula'];
export function speciesName(rec){
  const i = rec && rec.id ? rec.id : 0;
  if(!i) return '—';
  return SY1[(i * 7) % SY1.length] + SY2[(i * 3) % SY2.length] + ' ' + i;
}

// how many species are alive right now (the honest count, unlike the old
// distance-clustering estimate, which counted shapes rather than lineages)
export function extantCount(){
  let n = 0; for(const r of S.phylo) if(!r.died && r.n > 0) n++;
  return n;
}

/* ---------- the trait space, for whoever explains a split to a player ---------- */
// The eight axes tv() measures, in order, with the factor that turns a component
// back into the gene's own units. Exported because a view that says "this lineage
// split from its sister on size and diet" has to name them, and must not
// re-derive the weights by hand and drift out of step with tv().
export const TRAIT_KEYS = ['diet', 'size', 'speed', 'hue', 'shape', 'pattern', 'ornament', 'sense'];
export const TRAIT_SCALE = [1 / 1.25, 9 / 0.95, 3.4 / 0.85, 360 / 1.05, 1 / 0.8, 1 / 0.75, 1 / 0.65, 165 / 0.55];

// A record's representative vector, normalised. Live records carry a
// Float64Array; a record restored from a save carries either null (extinct, gone
// for good) or the plain object JSON turns a typed array into. Returns null when
// there is nothing trustworthy to compare, and callers must say "unknown" rather
// than draw a zero.
export function recVec(r){
  const g = r && r.g;
  if(!g) return null;
  const out = new Float64Array(K);
  for(let i = 0; i < K; i++){ const v = +g[i]; if(!isFinite(v)) return null; out[i] = v; }
  return out;
}
export const traitDist = (a, b) => (a && b ? dist(a, b) : NaN);
// the genome vector of a living creature, on the same axes
export const creatureVec = c => Float64Array.from(tv(c.g, new Float64Array(K)));

/* ---------- the forest, assembled for drawing ---------- */
// Pure structure: no layout, no pixels, no rand(). One pass to wrap the records,
// one to link them, one iterative DFS for depth, one reverse pass for subtree
// aggregates. O(records), and records are capped at MAX_REC, so this is bounded
// work no matter how long the world has been running.
//
// A parent link is only honoured when it points at a record that exists AND has
// a smaller id. mint() guarantees both, but a hand-edited or truncated save need
// not, and a cycle here would hang the renderer; this makes one impossible.
export function phyloForest(){
  const A = S.phylo, nmap = new Map(), nodes = [];
  for(const r of A){
    const n = {
      rec: r, id: r.id, kids: [], parent: null, depth: 0,
      born: r.born | 0, died: r.died | 0, n: r.n | 0, peak: r.peak | 0,
      type: r.type || 'herb', hue: +r.hue || 0, absorbed: r.absorbed | 0,
      subN: 0, subCount: 1, subPeak: 0, subAbsorbed: 0, subDead: true, subEnd: 0, subBorn: 0
    };
    nodes.push(n); nmap.set(r.id, n);
  }
  const roots = [];
  for(const n of nodes){
    const pid = n.rec.parent | 0;
    const p = pid > 0 && pid < n.id ? nmap.get(pid) : null;
    if(p){ n.parent = p; p.kids.push(n); } else roots.push(n);
  }
  const cmp = (a, b) => (a.born - b.born) || (a.id - b.id);
  roots.sort(cmp);
  for(const n of nodes) if(n.kids.length > 1) n.kids.sort(cmp);

  const order = [];
  for(const r of roots){
    const st = [r];
    while(st.length){
      const n = st.pop(); order.push(n);
      for(let i = n.kids.length - 1; i >= 0; i--){ const k = n.kids[i]; k.depth = n.depth + 1; st.push(k); }
    }
  }
  for(let i = order.length - 1; i >= 0; i--){
    const n = order[i];
    n.subDead = !!n.died; n.subN = n.n; n.subCount = 1;
    n.subPeak = n.peak; n.subAbsorbed = n.absorbed;
    n.subEnd = n.died || 0; n.subBorn = n.born;
    for(const k of n.kids){
      n.subN += k.subN; n.subCount += k.subCount; n.subAbsorbed += k.subAbsorbed;
      if(k.subPeak > n.subPeak) n.subPeak = k.subPeak;
      if(!k.subDead) n.subDead = false;
      if(k.subEnd > n.subEnd) n.subEnd = k.subEnd;
    }
  }

  let extant = 0, dead = 0, tMin = Infinity, tMax = 0;
  for(const n of nodes){
    if(n.died) dead++; else extant++;
    if(n.born < tMin) tMin = n.born;
    if(n.died > tMax) tMax = n.died;
  }
  if(!isFinite(tMin)) tMin = 0;
  return { nodes, roots, order, byId: nmap, extant, dead,
    tMin, tMax: Math.max(tMax, S.tick), rev: phyloInfo.rev,
    pruned: phyloStats.pruned, rootLost: phyloInfo.rootLost, cap: MAX_REC };
}
