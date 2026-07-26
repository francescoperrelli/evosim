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
//   { id, parent, born, died, n, peak, type, hue, cx, cy, g }
//   id     unique species id (1-based)          parent  id of the species it split from (0 = root)
//   born   tick of origin                        died   tick of extinction (0 while extant)
//   n      current headcount                     peak   highest headcount ever
//   type   feeding band at origin                hue    representative hue
//   cx,cy  centroid of living members            g      representative gene vector
//
// Each creature carries `c.sp` = its species id.
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
    type: 'herb', hue: 0, cx: 0, cy: 0, g: Float64Array.from(gv), split: S.tick
  };
  let dietS = 0, hueS = 0, xs = 0, ys = 0;
  for(const c of members){ c.sp = rec.id; dietS += c.g.diet || 0; hueS += c.g.hue || 0; xs += c.x; ys += c.y; }
  const m = members.length || 1;
  rec.type = typeOf(dietS / m); rec.hue = hueS / m; rec.cx = xs / m; rec.cy = ys / m;
  S.phylo.push(rec); idxArr = null;
  phyloStats.splits++;
  return rec;
}

// Adopt a creature with no valid species. Outside the founding pass it always
// joins the closest living lineage, however far that is: an oddball is a variant
// within its species, not a species of one. New species are only ever minted by
// the split machinery, which insists on a whole population — that single rule is
// what stops the tree fragmenting into hundreds of singletons.
// `found` is true only while naming the forms a fresh world was seeded with.
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
      if(!r.died){ r.died = S.tick; phyloStats.extinct++; }
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
  S.phylo = S.phylo.filter(r => !drop.has(r.id));
  for(const r of S.phylo) if(drop.has(r.parent)) r.parent = resolve(r.parent);
  phyloStats.pruned += drop.size;
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
