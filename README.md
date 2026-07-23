# 🌿 EvoSim — A Living Ecosystem

An artificial-life simulation that runs entirely in the browser. Creatures are
born, graze, hunt, flee, reproduce and **evolve** — guided by nothing but
natural selection. No behavior is scripted: it all emerges.

**▶ Live:** https://francescoperrelli.github.io/evosim/

## What's inside

- **Neural-network brains** — every creature is steered by a small feed-forward
  network (10 → 8 → 2). Its weights are part of the genome and evolve by
  mutation, generation after generation, on top of a light instinctive prior
  that keeps the ecosystem viable from the first frame.
- **A food chain** — **herbivores** (green) graze on plants and flee predators;
  **carnivores** (red) hunt herbivores. The result is the classic predator–prey
  oscillation (Lotka–Volterra), with no code telling it to happen.
- **Flocks** — herbivores school together (cohesion, alignment, separation);
  sociality is an evolving gene, and moving in groups is a defense against
  predators.
- **Territories** — when not chasing prey, carnivores patrol a territory around
  their birthplace (den). Territory radius and territoriality are genetic.
- **Mimicry** — prey evolve camouflage to blend into the background, while
  predators evolve visual acuity to counter it: a genuine evolutionary arms
  race, plotted live in the charts.
- **Two languages** — full Italian / English UI, remembered across visits.
- **Auto-save** — the world saves itself to the browser and resumes when you
  reopen the page. Export / import a world as a JSON file to move it between
  devices.

## How to use it

Open the live link (works on desktop and phone). From the home screen:
**New game**, **Resume**, **Tutorial**, **Load**, **Save**, **Options**.
Tap the environment to grow plants. In **Options** you can tune plant growth,
mutation rate, and toggle predators, flocks, territories and mimicry on or off
to study each phenomenon in isolation.

The two charts read the evolution at a glance: populations over time
(herbivores, carnivores, plants) and the mimicry arms race (average prey
camouflage vs. average predator acuity).

## Project structure

```
index.html           markup only
css/style.css         all styling
js/
  utils.js            shared helpers (rng, clamp, gaussian noise)
  state.js            tunable parameters, constants, shared world state
  nn.js               minimal feed-forward neural network
  genome.js           genome, mutation and creature factory
  world.js            simulation engine (perception, brain, interactions) + save/load
  render.js           canvas drawing, charts and the numeric HUD
  i18n.js             Italian / English translations
  ui.js               overlays, controls, menu, language, touch input
  main.js             bootstrap, animation loop, auto-save
```

The code uses native ES modules, so open it through the live URL (or any static
web server) rather than from a `file://` path.

## Publishing

Hosted with GitHub Pages from this repository's `main` branch. Any change pushed
to `index.html` (or the `css/` and `js/` files) updates the live site within
about a minute.

---

Built as an experiment in *artificial life* — genetic algorithms, evolving
neural networks and emergent behavior.
