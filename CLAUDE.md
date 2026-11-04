# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Client-side farming calculator for mages on the Lineage 2 Reborn Classic (C5) server. Given mage stats (M.Atk, skill power, shots, element), it computes hits to kill, EXP and adena per hit, and net adena after shot costs for every NPC, and ranks monsters and locations. There is no backend: the app is a single client component that loads static JSON.

## Commands

For local development, never install anything on the host machine: no Node, npm packages, or other tools. Run everything in a Docker container, including one-off commands. A PreToolUse hook (`.claude/hooks/block-host-npm.py`) rejects `npm` and `npx` run outside Docker.

The repo has no Dockerfile or compose file, so use the stock Node image. Dependencies live in the `l2fh_node_modules` named volume, not on the host:

```bash
# Install dependencies (rerun after package.json or package-lock.json changes)
docker run --rm -v "$PWD":/app -v l2fh_node_modules:/app/node_modules -w /app node:24-bookworm-slim npm ci

# Dev server at http://localhost:3000
docker run --rm -it -p 3000:3000 -v "$PWD":/app -v l2fh_node_modules:/app/node_modules -w /app node:24-bookworm-slim npm run dev

# Lint (eslint, flat config in eslint.config.mjs)
docker run --rm -v "$PWD":/app -v l2fh_node_modules:/app/node_modules -w /app node:24-bookworm-slim npm run lint

# Type check (there is no npm script for this)
docker run --rm -v "$PWD":/app -v l2fh_node_modules:/app/node_modules -w /app node:24-bookworm-slim npx tsc --noEmit

# Production build
docker run --rm -v "$PWD":/app -v l2fh_node_modules:/app/node_modules -w /app node:24-bookworm-slim npm run build

# Serve the production build at http://localhost:3000
docker run --rm -it -p 3000:3000 -v "$PWD":/app -v l2fh_node_modules:/app/node_modules -w /app node:24-bookworm-slim npm start
```

There is no test framework and no CI config. Verify changes with lint, a type check, and by running the app.

Next 16 requires Node >= 20.9 (per `package-lock.json`), so keep the image at or above that.

## Architecture

Almost all of the app lives in two files:

- `src/app/calculator.tsx`: one ~1,400-line client component holding data loading, all state, the derived calculations, and the UI for all four tabs (Search, Monsters, Locations, Active set). `src/app/page.tsx` only renders it.
- `src/lib/formulas.tsx`: a port of the game's stat formulas. Only `calcMdef`, `getMonsterExp`, `getMonsterHpRate` and `getMonsterHpRateValue` are used; the other exports are currently unused.

### Data loading

On mount, `calculator.tsx` fetches the four files in `public/c5/` (`monsters_data.json`, `items_data.json`, `locations_data.json`, `skills_data.json`) in the browser and normalizes them. The UI stays on the loading card until all four are populated.

The JSON files are objects keyed by ID, and nearly every value is a string (`"level": "99"`). The `Raw*` types describe this shape; the types in `src/app/types.ts` describe the normalized shape. Normalization also changes meaning in two places:

- Drop `chance` is stored as a percentage (`"70.000000000"`) and divided by 100, so `ItemDrop.chance` is a 0-1 fraction.
- `monster.locations` is stored as IDs and resolved to `Location` objects.

Adding a monster field means updating `Monster` in `types.ts`, `RawMonster`, and the `normalizedMonsters` mapping.

### Calculation pipeline

`calculate(monster)` in `calculator.tsx` is the core: it returns a `MonsterCalculation`, and every tab renders from that result. Its `useCallback` dependencies include all the farming inputs, so changing an input recomputes everything derived from it.

- HP: `org_hp` scaled by the monster's HP-rate skill (`getMonsterHpRate` / `getMonsterHpRateValue`).
- M.Def: `calcMdef` scaled by skill 4413 (`mDefSkillMultiplier`).
- Damage: `92 * sqrt(matk * shotMultiplier) * skillPower / mdef`, times the element and damage-multiplier factors.
- EXP: `getMonsterExp` computes `acquire_exp_rate * level^2`. It does not use the `exp` field.

Monster traits are encoded as skills, identified by hardcoded skill IDs. HP-rate, strength and weakness IDs are in `formulas.tsx`; element weakness and resistance mappings are in `elementMultiplierFor` / `elementResistFor` in `calculator.tsx`.

### How the views relate

- `eligibleMonsters` applies the "Undead only" filter and feeds search, location details and suggestions.
- `suggestedMonsters` adds the level, herb and max-hits filters, sorts by the chosen goal, and keeps the top 32.
- `locationAggregates` is built from `suggestedMonsters`, not from all monsters, so the Locations tab averages only those 32 entries.
- Set aggregates in the Active set tab weight each monster by its `rate` and exclude spoil drops (`spoil > 0`) from expected drop quantities.

Herbs are detected by item metadata plus name: `item_type === 'etcitem'`, `etcitem_type === 'potion'`, and a name matching `/herb/i`. Adena is item ID 57.

### Data files

Only `public/c5/*` is loaded by the app. `public/items.json`, `public/monsters.json` and `public/old_npcs.json` are not referenced by the code. `public/npcs.json` is not loaded either, but it is the list of NPC IDs the scraper iterates over.

`l2wiki.py` is the scraper that generates `public/c5/*` from `lineage2wiki.org/c5/monster/<id>` by parsing the `var monster/skills/items/locations` blocks in each page. It is a raw Colab notebook export, not a runnable script: it contains `!git clone`, uses `tqdm.notebook`, and its last lines reference an undefined variable.

## Conventions

- Import from `src/` through the `@/*` path alias.
- UI primitives in `src/components/ui/` are shadcn/ui (new-york style, see `components.json`) on Radix, styled with Tailwind v4. There is no `tailwind.config`; Tailwind setup lives in `src/app/globals.css`.
- The React Compiler is enabled (`reactCompiler: true` in `next.config.ts`).
