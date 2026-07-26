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
// This stub keeps today's behaviour: one implicit species, no isolation.

import { P, S } from './state.js';
import { clamp } from './utils.js';

export function compatible(a, b){ return true; }

export function phyloTick(){}

export function phyloReset(){ S.phylo = []; S.speciesN = 0; }

export function speciesName(rec){ return 'sp.' + (rec && rec.id ? rec.id : 0); }
