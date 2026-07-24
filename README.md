# 🌿 EvoSim — A Living Ecosystem

An artificial-life simulation that runs entirely in the browser. Creatures are
born, graze, hunt, flee, reproduce and **evolve** — guided by nothing but
natural selection. No behaviour is scripted: it all emerges.

**▶ Live:** https://francescoperrelli.github.io/evosim/

## What's inside

- **Neural-network brains** — every creature is steered by a small recurrent
  network (17 → 10 → 4) with egocentric directional vision and short-term
  memory. Its weights are part of the genome and evolve by mutation, on top of a
  light instinctive prior that keeps the ecosystem viable from the first frame.
- **An evolving food web** — **diet is a continuous heritable gene**
  (herbivore → omnivore → carnivore). The feeding "band" is derived from it, so a
  lineage can shift its whole feeding strategy over generations. Herbivores graze
  and flee, carnivores hunt, omnivores do both — and predator–prey oscillations
  (Lotka–Volterra) emerge on their own.
- **Reproduction, two ways** — some organisms clone (asexual); others must find a
  mate and produce offspring by **crossover of both parents' genomes and brains**,
  so mate-seeking emerges as behaviour.
- **Flocks, territories & mimicry** — herbivores school for safety; carnivores
  patrol a territory; prey evolve camouflage while predators evolve visual
  acuity, an ongoing arms race.
- **Terrain that matters** — each world has **biomes** (fertile/barren regions
  that concentrate food) plus placeable **water** (slows movement) and **rocks**
  (block it), so geography shapes evolution.
- **Seasons & day/night** — plant growth rises and falls with the season and the
  daylight; winter is harsher.
- **Play-god events** — meteor strikes, droughts, contagious epidemics.
- **Deep observability** — an inspector with a genome readout and a **live**
  neural network (neurons light up as the creature thinks), a navigable
  **genealogy tree**, an Evolution panel (average generation, sexual %, diet
  distribution, dominant lineages) and all-time records.
- **Challenge mode** — five objectives (Dynasty, Balance, Rise of the Predators,
  Survivors, The Giant) tracked live with a progress bar and win/lose states.
- **Two languages** (Italian / English), a big pannable/zoomable world backed by
  a spatial grid, and **auto-save** in the browser (export/import worlds as JSON).

## How to use it

Open the live link (works on desktop and phone). From the home screen:
**New game**, **Resume**, **Tutorial**, **Load**, **Save**, **Options**.
Drag to explore the world, wheel/pinch to zoom, tap to grow plants. Use the
top-right button to switch to **🔍 Inspect** and tap a creature to open its
genome, brain and genealogy. The side panel opens **📊 Evolution**, **⚡ Events**
and **🎯 Challenges**.

## Project structure

```
index.html            markup only
css/style.css          all styling
js/
  utils.js             shared helpers (rng, clamp, gaussian noise)
  state.js             parameters, constants, shared world state, camera, seasons
  nn.js                recurrent neural network
  genome.js            genome (incl. evolving diet), mutation/crossover, creatures
  world.js             simulation engine (spatial grid, perception, interactions,
                       terrain, events) + save/load
  render.js            canvas drawing, camera, charts, HUD, network/genealogy viz
  i18n.js              Italian / English translations
  ui.js                overlays, controls, menu, tools, inspector, genealogy
  challenges.js        challenge definitions and live evaluation
  main.js              bootstrap, animation loop, auto-save
```

The code uses native ES modules, so open it through the live URL (or any static
web server) rather than from a `file://` path.

## Publishing

Hosted with GitHub Pages from this repository's `main` branch. Any change pushed
to `index.html` (or the `css/` and `js/` files) updates the live site within
about a minute.

---

Built as an experiment in *artificial life* — genetic algorithms, evolving
neural networks and emergent behaviour.
