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
  const run = sd => { w.seed(sd); for(let i = 0; i < 1500; i++) w.step(); return fp(); };
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
check('snapshot is versioned (v9)', rt.v === 9);
check('genome serialises 17 fields', rt.gLen === 17, 'len=' + rt.gLen);
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

await browser.close();
server.close();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
