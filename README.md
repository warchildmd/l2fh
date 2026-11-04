# L2Reborn Mage Farm Helper

A web-based farming calculator for the Lineage 2 Reborn servers, covering C1, C2 and C5. The app indexes NPCs, items, skills, and locations from bundled JSON datasets and lets you experiment with mage stats to see expected hits to kill, experience per hit, adena per hit, herb availability, and net profit once spiritshot costs are considered.

## Features

- Chronicle selector for C1, C2 and C5. Your choice is remembered, and only that chronicle's data is downloaded.
- Loads monster, item, skill, and location data directly in the browser with a progress indicator.
- Calculates HP, M.Def, expected damage, required hits, EXP per hit, adena per hit, herb presence, and shot costs for any NPC.
- Quick search for NPCs or locations, including direct Lineage2.wiki links for deeper details.
- Suggested monsters list filtered by level, hit count, herb requirement, and optimisation goal (EXP or net adena).
- Location view that aggregates the best farming spots and highlights their top monsters.
- Active set builder that mixes several NPCs with encounter rates to forecast total and per-monster gross/net adena plus expected drops.

## Getting started

Local development runs entirely in Docker, so Docker is the only prerequisite. Don't install Node.js or npm packages on your machine. Dependencies are kept in the `l2fh_node_modules` Docker volume.

Install dependencies:

```bash
docker run --rm -v "$PWD":/app -v l2fh_node_modules:/app/node_modules -w /app node:24-bookworm-slim npm ci
```

Start the dev server:

```bash
docker run --rm -it -p 3000:3000 -v "$PWD":/app -v l2fh_node_modules:/app/node_modules -w /app node:24-bookworm-slim npm run dev
```

Then open http://localhost:3000 in your browser. To create an optimised production build and serve it:

```bash
docker run --rm -v "$PWD":/app -v l2fh_node_modules:/app/node_modules -w /app node:24-bookworm-slim npm run build
```

```bash
docker run --rm -it -p 3000:3000 -v "$PWD":/app -v l2fh_node_modules:/app/node_modules -w /app node:24-bookworm-slim npm start
```

## Quick tutorial

1. **Pick your chronicle** in the header. Physical classes aren't supported yet.
2. **Set your mage stats**: In "Farming inputs", enter M.Atk, skill power, shot type (None/SS/BSS), elemental attribute, damage multiplier, shot prices, server rates, and any remaining HP you can leave on a mob. Use the filter inputs to limit levels, require herbs, or focus on undead mobs.
3. **Search**: Use the **Search** tab to find an NPC or location. Selecting an NPC shows calculated hits, EXP/adena, net profit, and its drop list. Selecting a location lists every matching NPC in that area, sorted by profitability.
4. **Monsters**: The **Monsters** tab lists suggested targets based on your filters and optimisation goal. Add promising NPCs to your active set with one click.
5. **Locations**: The **Locations** tab highlights the best zones with average metrics and the top monsters for each so you can choose a hunting spot quickly.
6. **Active set**: In the **Active set** tab, set how often you expect to fight each chosen NPC. The tool aggregates gross adena, shot costs, net adena, and expected drop quantities (including herbs) for your total pull count.

C1 and C2 damage uses the C5 formula and hasn't been checked in-game yet, so treat hits to kill as an estimate there.

That’s it—adjust the inputs and filters to match your gear, shots, and hunting plan, then pick the monsters or locations that maximise your EXP or adena.
