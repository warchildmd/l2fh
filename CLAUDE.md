# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Client-side farming calculator for mages on the Lineage 2 Reborn servers, covering C1, C2 and C5. Given mage stats (M.Atk, skill power, shots, element), it computes hits to kill, EXP and adena per hit, and net adena after shot costs for every NPC, and ranks monsters and locations. There is no backend: the app is a single client component that loads static JSON.

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

Data files are built with `scripts/wiki_data.py` in a stock Python image (standard library only). `fetch` caches pages in the gitignored `.cache/wiki/` and resumes, so parser fixes never need a re-download:

```bash
# Run c2 first: C1 page URLs are read from C2 pages. About an hour in total, at 1 request per second.
docker run --rm -v "$PWD":/app -w /app python:3.13-slim python -u scripts/wiki_data.py fetch c2
docker run --rm -v "$PWD":/app -w /app python:3.13-slim python -u scripts/wiki_data.py fetch c1

# Write public/c1 and public/c2
docker run --rm -v "$PWD":/app -w /app python:3.13-slim python scripts/wiki_data.py build

# Fail on any C2/C1 ratio that doesn't fit the normalization rules
docker run --rm -v "$PWD":/app -w /app python:3.13-slim python scripts/wiki_data.py check

# Diff the parser's output against shipped C5 data
docker run --rm -v "$PWD":/app -w /app python:3.13-slim python scripts/wiki_data.py verify-c5 50
```

There is no test framework and no CI config. Verify changes with lint, a type check, and by running the app.

Next 16 requires Node >= 20.9 (per `package-lock.json`), so keep the image at or above that.

## Architecture

Almost all of the app lives in three files:

- `src/app/calculator.tsx`: one ~1,400-line client component holding data loading, all state, the derived calculations, and the UI for all four tabs (Search, Monsters, Locations, Active set). `src/app/page.tsx` only renders it.
- `src/lib/chronicles.ts`: everything that differs per chronicle (data path, wiki URL, herbs, elements and their skill IDs, the magic damage formula), plus the remembered selection. The default is C1.
- `src/lib/formulas.tsx`: a port of the game's stat formulas. Only `calcMdef`, `getMonsterExp`, `getMonsterHpRate` and `getMonsterHpRateValue` are used; the other exports are currently unused.

### Data loading

`calculator.tsx` fetches the selected chronicle's four files from `public/<chronicle>/` (`monsters_data.json`, `items_data.json`, `locations_data.json`, `skills_data.json`) in the browser and normalizes them. The UI stays on the loading card until all four are populated. Switching chronicle clears the data and the selection, because monster IDs don't carry across chronicles, and keeps the farming inputs.

The JSON files are objects keyed by ID. In C5 nearly every value is a string (`"level": "99"`), while C1 and C2 use numbers. The `Raw*` types describe this shape; the types in `src/app/types.ts` describe the normalized shape. Normalization also changes meaning in two places:

- Drop `chance` is stored as a percentage (`"70.000000000"`) and divided by 100, so `ItemDrop.chance` is a 0-1 fraction.
- `monster.locations` is stored as IDs and resolved to `Location` objects.

Adding a monster field means updating `Monster` in `types.ts`, `RawMonster`, and the `normalizedMonsters` mapping.

### Calculation pipeline

`calculate(monster)` in `calculator.tsx` is the core: it returns a `MonsterCalculation`, and every tab renders from that result. Its `useCallback` dependencies include all the farming inputs, so changing an input recomputes everything derived from it.

- HP: `org_hp` scaled by the monster's HP-rate skill (`getMonsterHpRate` / `getMonsterHpRateValue`).
- M.Def: `monster.mdef` when present (C1 and C2), otherwise `calcMdef`, then scaled by skill 4413 (`mDefSkillMultiplier`).
- Damage: `chronicle.magicDamage(...)`, times the element and damage-multiplier factors. Every chronicle currently uses `92 * sqrt(matk * shotMultiplier) * skillPower / mdef`. C1 and C2 have `damageVerified: false` and show a warning until that's checked in-game. The wiki's scripts contain no magic damage formula.
- EXP: `getMonsterExp` computes `acquire_exp_rate * level^2`, then the EXP rate input applies. It does not use the `exp` field.
- Rates: all data is stored at x1. The EXP, SP and Adena rate inputs apply on top.

Monster traits are encoded as skills, identified by hardcoded skill IDs. HP-rate, strength and weakness IDs are in `formulas.tsx`; element weakness and resistance mappings are in `chronicles.ts`, because they differ per chronicle (C5 has separate resistance and weakness skills, while C1 and C2 use combined ones such as 4013, which resists Fire and is weak to Water). C1 and C2 have no HP-rate or M.Def skills: their `org_hp` and `mdef` are already final.

### How the views relate

- `eligibleMonsters` applies the "Undead only" filter and feeds search, location details and suggestions.
- `suggestedMonsters` adds the level, herb and max-hits filters, sorts by the chosen goal, and keeps the top 32.
- `locationAggregates` is built from `suggestedMonsters`, not from all monsters, so the Locations tab averages only those 32 entries.
- Set aggregates in the Active set tab weight each monster by its `rate` and exclude spoil drops (`spoil > 0`) from expected drop quantities.

Herbs are detected by item metadata plus name: `item_type === 'etcitem'`, `etcitem_type === 'potion'`, and a name matching `/herb/i`. C1 and C2 have no herbs, so `hasHerbs: false` disables the herb filter there. Adena is item ID 57.

### Data files

Only `public/c1/*`, `public/c2/*` and `public/c5/*` are loaded by the app. `public/items.json`, `public/monsters.json`, `public/npcs.json` and `public/old_npcs.json` are not referenced by the code. `public/npcs.json` is the list of NPC IDs `l2wiki.py` iterated over.

`scripts/wiki_data.py` generates `public/c1` and `public/c2` from `lineage2wiki.org`. Things it has to work around:

- Monster pages no longer embed JSON (`var monster = {}` is empty), so it parses the rendered HTML. `verify-c5` proves that against shipped C5 data.
- The listing's `monsterList` is incomplete: it omits real, spawned monsters. C2 IDs come from sweeping ID ranges, and the list only supplies `acquire_exp_rate`, `type` and skill levels.
- C2 URLs use old IDs (209). C1 URLs use modern IDs (20209), although the C1 listing says 209. `npc_id` is always the ID in that chronicle's wiki URL.
- The wiki's C2 data has server rates baked in (EXP x40, SP x80, adena x250, raid bosses unscaled). `build` divides these back to x1 and `check` guards the ratios. Item drop chances stay as the wiki has them, because they differ from C1 by no single factor.

`public/c5` was generated by `l2wiki.py`, a raw Colab notebook export kept for reference. It no longer works against the site, and it isn't runnable anyway. `slim-c5` later minified those files and dropped unused fields.

## Conventions

- Import from `src/` through the `@/*` path alias.
- UI primitives in `src/components/ui/` are shadcn/ui (new-york style, see `components.json`) on Radix, styled with Tailwind v4. There is no `tailwind.config`; Tailwind setup lives in `src/app/globals.css`.
- The React Compiler is enabled (`reactCompiler: true` in `next.config.ts`).
