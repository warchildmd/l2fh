# L2Reborn Mage Farm Helper (C5)

A web-based farming calculator for Lineage 2 Reborn Classic (C5 era). The app indexes NPCs, items, skills, and locations from bundled JSON datasets and lets you experiment with mage stats to see expected hits to kill, experience per hit, adena per hit, herb availability, and net profit once spiritshot costs are considered.

## Features

- Loads C5 monster, item, skill, and location data directly in the browser with a progress indicator.
- Calculates HP, M.Def, expected damage, required hits, EXP per hit, adena per hit, herb presence, and shot costs for any NPC.
- Quick search for NPCs or locations, including direct Lineage2.wiki links for deeper details.
- Suggested monsters list filtered by level, hit count, herb requirement, and optimisation goal (EXP or net adena).
- Location view that aggregates the best farming spots and highlights their top monsters.
- Active set builder that mixes several NPCs with encounter rates to forecast total and per-monster gross/net adena plus expected drops.

## Getting started

Prerequisites:

- Node.js 18.18+ (Node 20 LTS recommended)
- npm (comes with Node.js)

Install dependencies and start the dev server:

```bash
npm install
npm run dev
```

Then open http://localhost:3000 in your browser. To create an optimised production build use:

```bash
npm run build
npm start
```

## Quick tutorial

1. **Set your mage stats**: In "Farming inputs", enter M.Atk, skill power, shot type (None/SS/BSS), elemental attribute, damage multiplier, shot prices, and any remaining HP you can leave on a mob. Use the filter inputs to limit levels, require herbs, or focus on undead mobs.
2. **Search**: Use the **Search** tab to find an NPC or location. Selecting an NPC shows calculated hits, EXP/adena, net profit, and its drop list. Selecting a location lists every matching NPC in that area, sorted by profitability.
3. **Monsters**: The **Monsters** tab lists suggested targets based on your filters and optimisation goal. Add promising NPCs to your active set with one click.
4. **Locations**: The **Locations** tab highlights the best zones with average metrics and the top monsters for each so you can choose a hunting spot quickly.
5. **Active set**: In the **Active set** tab, set how often you expect to fight each chosen NPC. The tool aggregates gross adena, shot costs, net adena, and expected drop quantities (including herbs) for your total pull count.

That’s it—adjust the inputs and filters to match your gear, shots, and hunting plan, then pick the monsters or locations that maximise your EXP or adena.
