// EvoSim test suite — headless checks of the simulation's core invariants.
//
// Runs a tiny static server over the repo and drives the real page with
// Playwright/Chromium, so the tests exercise the actual shipped modules.
//
//   npm install         # once, to get playwright
//   npx playwright install chromium
//   npm test
//
// In a preinstalled-browser environment, point CHROMIUM_PATH at the binary.

import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join, normalize } from 'path';
import { chromium } from 'playwright';

const ROOT = normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml' };

function serve(){
  return new Promise(resolve => {
    const server = createServer(async (req, res) => {
      try{
        let p = decodeURIComponent(req.url.split('?')[0]);
        if(p === '/') p = '/index.html';
        const full = normalize(join(ROOT, p));
        if(!full.startsWith(ROOT)){ res.writeHead(403); return res.end(); }
        const body = await readFile(full);
        const ext = full.slice(full.lastIndexOf('.'));
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
        res.end(body);
      }catch(e){ res.writeHead(404); res.end('not found'); }
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

let passed = 0, failed = 0;
function check(name, cond, detail){
  if(cond){ passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? '  — ' + detail : ''}`); }
}

const { server, port } = await serve();
const base = `http://127.0.0.1:${port}/index.html`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
const consoleErrors = [];
page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
page.on('console', m => { if(m.type() === 'error' && !m.text().includes('favicon')) consoleErrors.push(m.text()); });

console.log('EvoSim test suite\n');

// ---- load cleanly ----
await page.goto(base);
await page.evaluate(() => localStorage.setItem('evosim_tut_seen', '1'));
await page.goto(base);
await page.waitForTimeout(400);
check('page loads without console errors', consoleErrors.length === 0, consoleErrors[0]);

// ---- determinism: same seed -> identical world ----
const det = await page.evaluate(async () => {
  const w = await import('./js/world.js'), st = await import('./js/state.js');
  const fp = () => { let h = 0; for(const c of st.S.creatures) h = (h + Math.round(c.x) * 13 + Math.round(c.y) * 7 + Math.round(c.energy) * 3 + c.gen * 11 + c.g.brain.nh * 17) >>> 0; return h >>> 0; };
  const run = sd => { w.seed(sd); for(let i = 0; i < 1000; i++) w.step(); return fp(); };
  const a = run(2024), a2 = run(2024), b = run(4048);
  return { identical: a === a2, differ: a !== b };
});
check('same seed reproduces an identical world', det.identical);
check('different seeds diverge', det.differ);

// ---- ecosystem stays alive and finite over a long run ----
const eco = await page.evaluate(async () => {
  const w = await import('./js/world.js'), st = await import('./js/state.js');
  w.seed(777); let herbMin = 1e9, nan = false;
  for(let i = 0; i < 4000; i++){ w.step();
    if(i > 400){ let h = 0; for(const c of st.S.creatures){ if(c.type === 'herb') h++; if(!isFinite(c.energy) || !isFinite(c.x)) nan = true; } if(h < herbMin) herbMin = h; }
  }
  return { pop: st.S.creatures.length, herbMin, nan, gen: st.S.maxGen };
});
check('no NaN/Inf in creature state', !eco.nan);
check('herbivores never fully collapse', eco.herbMin > 0, 'min=' + eco.herbMin);
check('population stays alive after 4000 steps', eco.pop > 0, 'pop=' + eco.pop);
check('generations advance', eco.gen >= 1, 'gen=' + eco.gen);

// ---- save / load round-trip ----
const rt = await page.evaluate(async () => {
  const w = await import('./js/world.js'), st = await import('./js/state.js');
  w.seed(9); for(let i = 0; i < 800; i++) w.step();
  const snap = w.snapshot();
  const ok = w.restore(snap);
  let err = null; try{ for(let i = 0; i < 100; i++) w.step(); }catch(e){ err = e.message; }
  return { v: snap.v, gLen: snap.creatures[0] ? snap.creatures[0].g.length : 0, ok, err, hasSeed: snap.seed !== undefined };
});
check('snapshot is versioned (v12)', rt.v === 12);
check('genome serialises 38 fields', rt.gLen === 38, 'len=' + rt.gLen);
check('snapshot records the seed', rt.hasSeed);
check('restore + step runs without error', rt.ok && !rt.err, rt.err);

// ---- v8 brain migration ----
const mig = await page.evaluate(async () => {
  const w = await import('./js/world.js'), st = await import('./js/state.js'), nn = await import('./js/nn.js');
  const nh = 6, oldLen = nh * 18 + nh + nh * 5 + 5;
  const wOld = Array.from({ length: oldLen }, (_, i) => ((i % 9) - 4) / 5);
  const v8 = { v: 8, tick: 5, ID: 3, worldW: st.S.worldW, worldH: st.S.worldH,
    creatures: [{ x: 100, y: 100, t: 'omni', e: 80, a: 10, gn: 1, id: 2, hx: 100, hy: 100,
      g: [1.5, 60, 5, 270, 0.5, 0.2, 0.1, 120, 0.3, 1, 0.5, 0.3, 0.5, 0.2], b: { nh, w: wOld } }],
    food: [[60, 60]], rocks: [], water: [], biomes: [] };
  const ok = w.restore(v8);
  const c = st.S.creatures[0];
  const expLen = nn.NIN * nh + nh + nn.NOUT * nh + nn.NOUT;
  let err = null; try{ for(let i = 0; i < 60; i++) w.step(); }catch(e){ err = e.message; }
  return { ok, brainLen: c ? c.g.brain.w.length : 0, expLen, err };
});
check('accepts and migrates a v8 save', mig.ok);
check('migrated brain has the new layout', mig.brainLen === mig.expLen, mig.brainLen + ' vs ' + mig.expLen);
check('runs after migration without error', !mig.err, mig.err);

// ---- each level-3 mechanic, alone, is deterministic and does not kill the world ----
// While the five modules were stubs this asserted that switching the layer on
// changed nothing. That guarantee died the moment they started doing something,
// and replacing it with a frozen fingerprint would only have frozen level-1 and
// level-2 as well. What is worth protecting instead is what a broken module
// actually does: it desynchronises the run from its seed (by reaching for
// Math.random(), usually from drawing code) or it eats the ecology on its own.
// Each mechanic is therefore run by itself, twice, against the same seed.
const l3 = await page.evaluate(async () => {
  const w = await import('./js/world.js'), st = await import('./js/state.js');
  const FLAGS = ['toolsOn', 'fireOn', 'marksOn', 'techOn', 'terraOn'];
  const fp = () => { let h = 0; for(const c of st.S.creatures) h = (h + Math.round(c.x) * 13 + Math.round(c.y) * 7 + Math.round(c.energy) * 3 + c.gen * 11) >>> 0; return h >>> 0; };
  const run = () => { w.seed(1234); for(let i = 0; i < 1000; i++) w.step(); return fp(); };
  const out = [];
  for(const on of FLAGS){
    for(const f of FLAGS) st.P[f] = (f === on);
    const a = run(), b = run();
    out.push({ f: on, det: a === b, pop: st.S.creatures.length, a, b });
  }
  for(const f of FLAGS) st.P[f] = true;
  const a = run(), b = run();
  out.push({ f: 'all', det: a === b, pop: st.S.creatures.length, a, b });
  return out;
});
const l3det = l3.filter(r => !r.det), l3dead = l3.filter(r => r.pop === 0);
check('every level-3 mechanic stays deterministic', l3det.length === 0,
  l3det.map(r => r.f + ' ' + r.a + ' vs ' + r.b).join(', '));
check('no level-3 mechanic empties the world on its own', l3dead.length === 0,
  l3dead.map(r => r.f).join(', '));

// ---- the phylogeny panel is a view, and a view may not touch the world ----
// It reads S.creatures every frame to list who is alive in a lineage, it lays out
// a canvas, and it runs its own rAF loop while open. Any of those three is a place
// where a stray rand() would desynchronise the run from its seed without anything
// visibly breaking. Run the same seed with the panel shut and with it open and
// refreshed on every step; the worlds must be bit-identical.
const phDet = await page.evaluate(async () => {
  const w = await import('./js/world.js'), st = await import('./js/state.js'), ui = await import('./js/ui.js');
  const run = open => {
    w.seed(11);
    if(open) document.getElementById('btnPhylo').click();
    for(let i = 0; i < 3000; i++){ w.step(); if(open) ui.refreshPhylo(); }
    const h = st.S.creatures.reduce((a, c) => ((a * 31 + Math.round(c.x * 97) + Math.round(c.y * 89)) >>> 0), 7);
    if(open) document.getElementById('phClose').click();
    return h;
  };
  return { off: run(false), on: run(true) };
});
check('the phylogeny panel does not perturb the world', phDet.on === phDet.off,
  phDet.on + ' vs ' + phDet.off);

// ---- folding may hide an extinct branch, never a living one ----
// The tree stays readable by folding whole clades and bundling dead twigs, and the
// only thing making that honest rather than convenient is the rule that a lineage
// with creatures alive in it right now always gets its own row. It is exactly the
// kind of promise that decays silently the next time the fold heuristic is tuned.
//
// P.specThresh is lowered from the shipped 0.42 for the duration, and that is the
// whole point of this test rather than an incidental detail. At 0.42 a run this
// long produces about 26 lineages, which fit on screen, so NOTHING is ever folded
// and the assertion holds vacuously -- the first version of this test passed
// happily against a fold predicate with the is-it-dead check deliberately deleted.
// At 0.16 the forest pins against the record cap and the fold path is forced to
// run, which is the only state in which the promise means anything.
const phHid = await page.evaluate(async () => {
  const w = await import('./js/world.js'), st = await import('./js/state.js'), ui = await import('./js/ui.js');
  const th0 = st.P.specThresh;
  st.P.specThresh = 0.16;
  w.seed(11);
  document.getElementById('btnPhylo').click();
  for(let i = 0; i < 8000; i++){ w.step(); if(i % 16 === 0) ui.refreshPhylo(); }
  const p = ui.phyloPerf();
  document.getElementById('phClose').click();
  st.P.specThresh = th0;
  return p;
});
check('the tree folds no living lineage out of sight',
  phHid.extantHidden === 0 && (phHid.bundles + phHid.folded) > 0,
  'hidden=' + phHid.extantHidden + ' of ' + phHid.records +
  ' records, bundles=' + phHid.bundles + ' folded=' + phHid.folded);

// ---- culture does not leak into the germline ----
// The point of culture.js's __t bookkeeping is that a lesson stays a lesson: the
// parent's taught offset is added to the child's brain as culture and subtracted
// back out of the genes the child inherited. For an asexual birth that is one
// subtraction. For a sexual pair the child's weights come from two parents, and
// the purge is only correct if it removes the offset from exactly the loci that
// came from the parent doing the teaching. It used to subtract half of it from
// all of them, which balances on average and is wrong for every individual.
//
// Rather than assert the arithmetic, this drives the real chain — crossover(),
// then inherit() — and checks the invariant that makes it right: after the purge
// a child's germline weight must land EXACTLY on one of its two parents' values,
// never between them. Mutation is switched off (P.mut = 0) for the duration so
// the comparison can be exact rather than a tolerance wide enough to hide the
// very error being looked for; the first version of this test used a 0.25 window
// and passed happily against the buggy code, because half a taught offset is
// smaller than that. The offset is also made large relative to a weight so a
// half-subtraction cannot be mistaken for rounding.
const cult = await page.evaluate(async () => {
  const g = await import('./js/genome.js'), c = await import('./js/culture.js'),
        nn = await import('./js/nn.js'), st = await import('./js/state.js'), w = await import('./js/world.js');
  w.seed(4242);
  const mut0 = st.P.mut, cv0 = st.P.cultureVertOn;
  st.P.mut = 0; st.P.cultureVertOn = true;
  const NOUT = nn.NOUT, NIN = nn.NIN, EPS = 1e-5;
  let checked = 0, offMask = 0, blended = 0, noMask = 0, resized = 0;
  for(let trial = 0; trial < 400; trial++){
    const ga = g.randomGenome('omni'), gb = g.randomGenome('omni');
    if(ga.brain.nh !== gb.brain.nh) continue;
    ga.sexual = gb.sexual = 1;
    ga.fidelity = 0;                            // isolate the purge from the teaching step
    const nh = ga.brain.nh, n = nh * NOUT, off = nh * NIN + nh;
    // give parent A a taught overlay, and put it into A's own germline the way a
    // real birth does. Amplitude ~0.6, well above any plausible noise floor.
    ga.__t = new Float32Array(n);
    for(let i = 0; i < n; i++){ ga.__t[i] = ((i % 5) - 2) * 0.3; ga.brain.w[off + i] += ga.__t[i]; }
    const parent = { g: ga, plast: null };
    const aW = ga.brain.w.slice(), bW = gb.brain.w.slice();
    const cg = g.crossover(ga, gb);
    if(cg.brain.nh !== nh){ resized++; continue; }   // hidden layer resized; inherit() bails
    const mask = nn.crossMask(cg.brain);
    if(!mask){ noMask++; continue; }
    const maskCopy = mask.slice();                   // inherit() must not disturb it, but be safe
    c.inherit(parent, cg);
    checked++;
    for(let i = 0; i < n; i++){
      const k = off + i;
      const wantA = aW[k] - ga.__t[i];          // A's value with its culture removed
      const wantB = bW[k];                      // B never carried A's culture
      const got = cg.brain.w[k];
      const dA = Math.abs(got - wantA), dB = Math.abs(got - wantB);
      if(Math.min(dA, dB) > EPS) blended++;              // sitting between the two parents
      if((maskCopy[k] ? dA : dB) > EPS) offMask++;       // matched the wrong parent
    }
  }
  st.P.mut = mut0; st.P.cultureVertOn = cv0;
  return { checked, blended, offMask, noMask, resized };
});
check('sexual births purge culture per-weight, not on average',
  cult.checked > 20 && cult.blended === 0 && cult.offMask === 0,
  `checked=${cult.checked} blended=${cult.blended} offMask=${cult.offMask} noMask=${cult.noMask}`);

// ---- multi-planet world: planets build, creatures stay confined ----
const pl = await page.evaluate(async () => {
  const w = await import('./js/world.js'), st = await import('./js/state.js');
  w.seed(321); let voidSamples = 0;
  for(let i = 0; i < 1500; i++){ w.step();
    if(i > 200){ for(const c of st.S.creatures){ if(w.planetIndexAt(c.x, c.y) < 0) voidSamples++; } }
  }
  const per = new Array(st.S.planets.length).fill(0);
  for(const c of st.S.creatures){ const pi = w.planetIndexAt(c.x, c.y); if(pi >= 0) per[pi]++; }
  const alive = per.filter(n => n > 0).length;
  return { nPlanets: st.S.planets.length, alive, voidSamples };
});
check('world builds multiple planets', pl.nPlanets >= 2, 'n=' + pl.nPlanets);
check('every planet sustains life', pl.alive === pl.nPlanets, pl.alive + '/' + pl.nPlanets);
check('creatures stay confined to planets', pl.voidSamples < 40, 'void=' + pl.voidSamples);

// ---- dispersal: a high-tech lineage can cross the void to colonise ----
const dp = await page.evaluate(async () => {
  const w = await import('./js/world.js'), st = await import('./js/state.js');
  w.seed(55); for(let i = 0; i < 300; i++) w.step();
  // force the whole population to be launch-ready dispersers
  for(const c of st.S.creatures){ c.g.disperse = 0.95; c.energy = 400; }
  st.S.colonized = [];
  for(let i = 0; i < 2500; i++){ w.step();
    for(const c of st.S.creatures){ if(c.g.disperse < 0.6) c.g.disperse = 0.9; if(c.energy > 260) c.energy = 260; }
  }
  return { colonized: (st.S.colonized || []).length };
});
check('evolved dispersal can colonise other planets', dp.colonized >= 1, 'colonized=' + dp.colonized);

// ---- husbandry: intelligent herders tame livestock, and only they can ----
const hus = await page.evaluate(async () => {
  const w = await import('./js/world.js'), st = await import('./js/state.js');
  w.seed(88); for(let i = 0; i < 300; i++) w.step();
  // willing herders, and drop the intelligence gate so the gene alone can express
  st.P.herdBrain = 0;
  let tamed = 0, dumbTamed = 0;
  for(let i = 0; i < 600; i++){ w.step();
    for(const c of st.S.creatures){ if(c.type !== 'herb') c.g.husbandry = 0.95; }
  }
  for(const c of st.S.creatures){ if(c.owner) tamed++; }
  // now raise the intelligence gate above every brain — husbandry must NOT express
  st.S.creatures.forEach(c => { c.owner = 0; });
  st.P.herdBrain = 999;
  for(let i = 0; i < 400; i++){ w.step();
    for(const c of st.S.creatures){ if(c.type !== 'herb') c.g.husbandry = 0.95; }
  }
  for(const c of st.S.creatures){ if(c.owner) dumbTamed++; }
  st.P.herdBrain = 10;
  return { tamed, dumbTamed };
});
check('intelligent species tame livestock', hus.tamed >= 1, 'tamed=' + hus.tamed);
check('husbandry needs intelligence (gated on brain)', hus.dumbTamed === 0, 'dumbTamed=' + hus.dumbTamed);

// A test asserting that the standing crop varies more across space than over time
// -- the load-bearing fact behind the refuted spatial-structure work in world.js --
// was written here and then deleted, because it could not be made to fail. Killing
// the fertility bias in dropFood() did not move it, and neither did a hard
// per-patch ceiling on placement. See the note at the end of that block in
// world.js: the heterogeneity is manufactured by grazing, not by planting, so no
// reachable change to the flora side can homogenise the crop. It is structurally
// guaranteed rather than contingent, and an assertion of something guaranteed is
// not a test. Rule 2 in ROADMAP.md.

// ---- neutral drift scales with P.mut ----
// The re-measurement written into state.js standardises every effect against the
// drift of a functionless-gene pool. That denominator is only valid if the pool's
// drift actually tracks P.mut, and nothing guarded it. A change to the mutation
// step or to mutScale() could otherwise invalidate every signal-to-noise number in
// the repo without breaking a single test. Ratio measured at 6000 ticks is ~7x;
// the floor is 2x so this only fires on a real regression.
const DRIFT_POOL = ['camo','acuity','shape','altruism','ornament','preference',
  'resist','reciprocity','migrate','hoard','build','disperse','pace','detox'];
const drift = await page.evaluate(async (pool) => {
  const w = await import('./js/world.js'), st = await import('./js/state.js');
  const P = st.P, S = st.S, mut0 = P.mut;
  const poolMean = () => {
    const cs = S.creatures; if(!cs.length) return NaN;
    let t = 0;
    for(const c of cs) for(const g of pool) t += (c.g[g] === undefined ? 0.5 : c.g[g]);
    return t / (cs.length * pool.length);
  };
  const run = mut => {
    P.mut = mut; w.seed(4242);
    const start = poolMean();
    for(let i = 0; i < 1500; i++) w.step();
    return { d: Math.abs(poolMean() - start), pop: S.creatures.length };
  };
  const lo = run(0.02), hi = run(0.16);
  P.mut = mut0;
  return { lo, hi };
}, DRIFT_POOL);
check('both drift arms kept a live population',
  drift.lo.pop > 20 && drift.hi.pop > 20, 'pops ' + drift.lo.pop + ' / ' + drift.hi.pop);
check('neutral drift scales with P.mut',
  drift.hi.d > 2 * drift.lo.d,
  '|d| = ' + drift.lo.d.toFixed(4) + ' at 0.02 vs ' + drift.hi.d.toFixed(4) + ' at 0.16');

// ---- P.dupMode is a research knob, not a behaviour change ----
// nn.js gained a three-arm control for the neuron-duplication study. The arm that
// ships must be bit-identical to what shipped before it existed, and the knob must
// actually switch something -- a knob that silently does nothing would have made
// the whole duplication measurement a comparison of an arm with itself.
const dupKnob = await page.evaluate(async () => {
  const w = await import('./js/world.js'), st = await import('./js/state.js');
  const fp = () => { let h = 7;
    for(const c of st.S.creatures)
      h = (h * 31 + Math.round(c.x * 97) + Math.round(c.y * 89) + c.g.brain.nh * 17) >>> 0;
    return h >>> 0; };
  const run = mode => { st.P.dupMode = mode; w.seed(4242);
    for(let i = 0; i < 2500; i++) w.step();
    return { fp: fp(), pop: st.S.creatures.length }; };
  const undef = run(undefined), dup = run('dup'), invent = run('invent');
  st.P.dupMode = undefined;
  return { undef, dup, invent };
});
check('P.dupMode undefined is exactly the shipped duplication path',
  dupKnob.undef.fp === dupKnob.dup.fp, dupKnob.undef.fp + ' vs ' + dupKnob.dup.fp);
check('P.dupMode actually switches the arm',
  dupKnob.invent.fp !== dupKnob.dup.fp, 'both arms hashed ' + dupKnob.dup.fp);

// ---- the void is impassable with dispersal off ----
// Every number in the allopatry study in phylo.js was taken on runs with dispOn
// false, on the assumption that no body can then change planet. Nothing checked it.
//
// THE POSITIVE CONTROL BELOW IS THE TEST. The obvious version of this -- run with
// dispOn false and assert zero crossings -- cannot fail, and that was verified, not
// assumed: with the gate deleted outright the suite still reported it passing. The
// reason is that the `disperse` gene has to drift past P.dispThresh before anything
// crosses at all, and phylo.js measured the first crossings arriving around tick
// 12000-16000. Three thousand ticks of a world that would not have crossed anyway
// is not evidence that something stopped it. So the gene is forced to 1 in both
// arms, which puts every body over the threshold and leaves P.dispOn as the only
// thing standing between them and the void, and the same run is done twice. The
// `on` arm is what makes the `off` arm mean anything.
const sealed = await page.evaluate(async () => {
  const w = await import('./js/world.js'), st = await import('./js/state.js');
  const was = st.P.dispOn;
  const run = on => {
    st.P.dispOn = on; w.seed(11);
    const home = new Map(); let crossings = 0;
    for(let i = 0; i < 3000; i++){
      w.step();
      for(const c of st.S.creatures){
        c.g.disperse = 1;                       // over P.dispThresh by construction
        const pi = w.planetIndexAt(c.x, c.y);
        if(pi < 0) continue;
        if(home.has(c.id)){ if(home.get(c.id) !== pi) crossings++; }
        else home.set(c.id, pi);
      }
    }
    return { crossings, tracked: home.size };
  };
  const off = run(false), on = run(true);
  st.P.dispOn = was;
  return { off, on };
});
check('with dispersal on and the gene forced, bodies do cross the void',
  sealed.on.crossings > 0, 'crossings=' + sealed.on.crossings);
check('with dispersal off no body ever changes planet',
  sealed.off.crossings === 0 && sealed.off.tracked > 100,
  'crossings=' + sealed.off.crossings + ' over ' + sealed.off.tracked + ' bodies');

await browser.close();
server.close();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
