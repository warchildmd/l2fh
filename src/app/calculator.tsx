'use client';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Card, CardContent, CardHeader} from '@/components/ui/card';
import {Label} from '@/components/ui/label';
import {Input} from '@/components/ui/input';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {Checkbox} from '@/components/ui/checkbox';
import {Progress} from '@/components/ui/progress';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs';
import type {Item, Location, Monster, MonsterSkill, Skill} from '@/app/types';
import {
  calcMdef,
  getMonsterExp,
  getMonsterHpRate,
  getMonsterHpRateValue,
} from '@/lib/formulas';

const ADENA_ITEM_ID = 57;
const HERB_MIN = 8600;
const HERB_MAX = 8605;

type ResolvedDrop = {
  itemId: number;
  name: string;
  min: number;
  max: number;
  chance: number;
  spoil: number;
};

type MonsterCalculation = {
  monster: Monster;
  hp: number;
  mdef: number;
  dmg: number;
  hits: number;
  exp: number;
  expPerHit: number;
  adena: number;
  adenaPerHit: number;
  herbs: boolean;
  shotCostPerKill: number;
  netAdenaPerKill: number;
};

type ActiveEntry = { id: number; name: string; rate: number };

type SearchResult =
  | { type: 'monster'; monster: Monster }
  | { type: 'location'; location: Location };

type LocationAggregate = {
  location: Location;
  monsterCount: number;
  avgExpPerHit: number;
  avgAdenaPerHit: number;
  avgNetAdenaPerKill: number;
  avgHits: number;
  monsters: MonsterCalculation[];
};

type RawItem = { item_id?: string | number; id?: string | number; name?: string };
type RawLocation = { id?: string | number; name?: string };
type RawSkill = { skill_id?: string | number; id?: string | number; name?: string; level?: string | number };
type RawDrop = { item_id?: string | number; min?: string | number; max?: string | number; chance?: string | number; spoil?: string | number };
type RawMonsterSkill = { skill_id?: string | number; level?: string | number };
type RawMonster = {
  npc_id?: string | number;
  name?: string;
  level?: string | number;
  exp?: string | number;
  acquire_sp?: string | number;
  org_hp?: string | number;
  org_mp?: string | number;
  str?: string | number;
  int?: string | number;
  dex?: string | number;
  wit?: string | number;
  con?: string | number;
  men?: string | number;
  base_physical_attack?: string | number;
  base_defend?: string | number;
  base_magic_defend?: string | number;
  base_magic_attack?: string | number;
  base_attack_speed?: string | number;
  base_critical?: string | number;
  physical_hit_modify?: string | number;
  ground_low?: string;
  ground_high?: string;
  acquire_exp_rate?: string | number;
  locations?: Array<string | number>;
  items?: RawDrop[];
  skills?: RawMonsterSkill[];
};

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, T>);
  }
  return [];
}

function toNum(value: unknown, fallback = 0): number {
  if (value == null) return fallback;
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

function shotMultiplier(s: 'none' | 'ss' | 'bss') {
  return s === 'none' ? 1 : s === 'ss' ? 2 : 4;
}

function hasHerbDrop(drops: ResolvedDrop[]): boolean {
  return drops.some((d) => d.itemId >= HERB_MIN && d.itemId <= HERB_MAX);
}

function mDefSkillMultiplier(skills: MonsterSkill[]): number {
  const multipliers = [
    -0.15, -0.135, -0.12, -0.1, -0.08, -0.07, -0.06, -0.04, -0.03, -0.1,
    0.0, 0.1, 0.03, 0.04, 0.06, 0.08, 0.1, 0.12, 0.135, 0.15, 0.165,
  ];
  const skill = skills.find((s) => s.skill_id === 4413);
  if (!skill) return 1;
  const idx = Math.max(0, Math.min(multipliers.length - 1, skill.level - 1));
  return 1 + multipliers[idx];
}

function elementMultiplierFor(element: string, skills: MonsterSkill[]): number {
  if (element === 'none') return 1;
  const map: Record<string, number> = {
    holy: 4275,
    fire: 4279,
    water: 4280,
    wind: 4281,
    earth: 4282,
    dark: 4336,
  };
  const target = map[element];
  if (!target) return 1;
  return skills.some((s) => s.skill_id === target) ? 1.11 : 1;
}

function elementResistFor(element: string, skills: MonsterSkill[]): number {
  if (element === 'none') return 1;
  const map: Record<string, number> = {
    fire: 4009,
    water: 4010,
    wind: 4011,
    earth: 4012,
    dark: 4333,
  };
  const target = map[element];
  if (!target) return 1;
  return skills.some((s) => s.skill_id === target) ? 0.9 : 1;
}

function useDebounced<T>(value: T, delay = 200): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

export default function Calculator() {
  const [loadLabel, setLoadLabel] = useState('');
  const [loadPct, setLoadPct] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Databases
  const [monsters, setMonsters] = useState<Monster[]>([]);
  const [monstersById, setMonstersById] = useState<Record<number, Monster>>({});
  const [items, setItems] = useState<Item[]>([]);
  const [itemsById, setItemsById] = useState<Record<number, Item>>({});
  const [locations, setLocations] = useState<Location[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);

  // Inputs
  const [matk, setMatk] = useState<number>(140);
  const [skillPower, setSkillPower] = useState<number>(26);
  const [shot, setShot] = useState<'none' | 'ss' | 'bss'>('none');
  const [element, setElement] = useState<string>('none');
  const [ssPrice, setSsPrice] = useState<number>(24);
  const [bssPrice, setBssPrice] = useState<number>(52);

  // Selection
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounced(query, 150);
  const [selectedNpc, setSelectedNpc] = useState<Monster | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [openList, setOpenList] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Suggestion inputs
  const [suggestedMaxHits, setSuggestedMaxHits] = useState<number>(1);
  const [suggestedOptimisation, setSuggestedOptimisation] = useState<'exp' | 'adena'>('exp');
  const [suggestedHerbs, setSuggestedHerbs] = useState<boolean>(true);
  const [suggestedMinLevel, setSuggestedMinLevel] = useState<number>(1);
  const [suggestedMaxLevel, setSuggestedMaxLevel] = useState<number>(80);

  // Active set
  const [active, setActive] = useState<ActiveEntry[]>([]);
  const [totalMonsters, setTotalMonsters] = useState<number>(100);

  useEffect(() => {
    let cancelled = false;

    async function fetchWithProgress(url: string, onStage: (s: string) => void, base: number, span: number): Promise<unknown> {
      onStage(`Fetching ${url}...`);
      try {
        const res = await fetch(url, {cache: 'force-cache'});
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const len = Number(res.headers.get('Content-Length') || '0');
        if (res.body && len > 0 && 'getReader' in res.body) {
          const reader = (res.body as ReadableStream).getReader();
          const chunks: BlobPart[] = [];
          let received = 0;
          while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            if (value) {
              chunks.push(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
              received += value.length;
              if (!cancelled && len > 0) setLoadPct(base + (received / len) * span * 0.7);
            }
          }
          const merged = new Blob(chunks);
          onStage('Parsing JSON...');
          const text = await merged.text();
          const data = JSON.parse(text);
          if (!cancelled) setLoadPct(base + span * 0.98);
          return data;
        }
        onStage('Downloading...');
        const data = await res.json();
        if (!cancelled) setLoadPct(base + span * 0.98);
        return data;
      } catch (err) {
        throw err;
      }
    }

    (async () => {
      try {
        setError(null);
        setLoadPct(2);
        setLoadLabel('Initializing...');
        const [monstersData, itemsData, locationsData, skillsData] = await Promise.all([
          fetchWithProgress('/c5/monsters_data.json', (s) => setLoadLabel(s), 2, 24),
          fetchWithProgress('/c5/items_data.json', (s) => setLoadLabel(s), 28, 22),
          fetchWithProgress('/c5/locations_data.json', (s) => setLoadLabel(s), 52, 22),
          fetchWithProgress('/c5/skills_data.json', (s) => setLoadLabel(s), 76, 20),
        ]);
        if (cancelled) return;

        const itemsListRaw = asArray<RawItem>(itemsData);
        const locationsListRaw = asArray<RawLocation>(locationsData);
        const skillsListRaw = asArray<RawSkill>(skillsData);
        const monstersListRaw = asArray<RawMonster>(monstersData);

        const normalizedLocations: Location[] = locationsListRaw.map((loc) => ({
          id: toNum(loc.id),
          name: String(loc.name ?? `Location ${loc.id ?? ''}`),
        }));
        const locationMap: Record<number, Location> = {};
        for (const loc of normalizedLocations) locationMap[loc.id] = loc;

        const normalizedItems: Item[] = itemsListRaw.map((item) => ({
          item_id: toNum(item.item_id ?? item.id),
          name: String(item.name ?? `#${item.item_id ?? item.id}`),
        }));
        const itemMap: Record<number, Item> = {};
        for (const it of normalizedItems) itemMap[it.item_id] = it;

        const normalizedSkills: Skill[] = skillsListRaw.map((skill) => ({
          id: String(skill.skill_id ?? skill.id ?? ''),
          skill_id: toNum(skill.skill_id ?? skill.id),
          name: String(skill.name ?? ''),
          level: String(skill.level ?? '1'),
        }));

        const normalizedMonsters: Monster[] = monstersListRaw.map((monster) => ({
          npc_id: toNum(monster.npc_id),
          name: String(monster.name ?? ''),
          level: toNum(monster.level),
          exp: toNum(monster.exp),
          acquire_sp: toNum(monster.acquire_sp),
          org_hp: toNum(monster.org_hp),
          org_mp: toNum(monster.org_mp),
          str: toNum(monster.str),
          int: toNum(monster.int),
          dex: toNum(monster.dex),
          wit: toNum(monster.wit),
          con: toNum(monster.con),
          men: toNum(monster.men),
          base_physical_attack: toNum(monster.base_physical_attack),
          base_defend: toNum(monster.base_defend),
          base_magic_defend: toNum(monster.base_magic_defend),
          base_magic_attack: toNum(monster.base_magic_attack),
          base_attack_speed: toNum(monster.base_attack_speed),
          base_critical: toNum(monster.base_critical),
          physical_hit_modify: toNum(monster.physical_hit_modify),
          ground_low: String(monster.ground_low ?? ''),
          ground_high: String(monster.ground_high ?? ''),
          acquire_exp_rate: toNum(monster.acquire_exp_rate),
          skills: (monster.skills ?? []).map((skill) => ({
            skill_id: toNum(skill?.skill_id),
            level: toNum(skill?.level, 1),
          })),
          locations: (monster.locations ?? [])
            .map((locId) => locationMap[toNum(locId, -1)])
            .filter(Boolean),
          items: (monster.items ?? []).map((drop) => ({
            item_id: toNum(drop.item_id),
            min: toNum(drop.min, 1),
            max: toNum(drop.max, 1),
            chance: toNum(drop.chance) / 100,
            spoil: toNum(drop.spoil),
          })),
        }));

        const monsterMap: Record<number, Monster> = {};
        for (const mon of normalizedMonsters) monsterMap[mon.npc_id] = mon;

        setItems(normalizedItems);
        setMonsters(normalizedMonsters);
        setLocations(normalizedLocations);
        setSkills(normalizedSkills);
        setItemsById(itemMap);
        setMonstersById(monsterMap);
        setSelectedLocation(null);
        setSelectedNpc((prev) => prev ?? (normalizedMonsters[0] ?? null));
        setLoadPct(100);
        setLoadLabel('Ready');
      } catch (e: unknown) {
        if (!cancelled) {
          const message = e instanceof Error ? e.message : 'Failed to load databases';
          setError(message);
          setLoadLabel('Error');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredMonsters = useMemo(() => {
    if (!debouncedQuery) return monsters.slice(0, 50);
    const q = debouncedQuery.toLowerCase();
    return monsters.filter((mon) => mon.name.toLowerCase().includes(q)).slice(0, 50);
  }, [monsters, debouncedQuery]);

  const filteredLocations = useMemo(() => {
    if (!debouncedQuery) return locations.slice(0, 25);
    const q = debouncedQuery.toLowerCase();
    return locations.filter((loc) => loc.name.toLowerCase().includes(q)).slice(0, 25);
  }, [locations, debouncedQuery]);

  const searchResults: SearchResult[] = useMemo(() => {
    const monsterEntries = filteredMonsters.map((monster) => ({type: 'monster' as const, monster}));
    const locationEntries = filteredLocations.map((location) => ({type: 'location' as const, location}));
    return [...monsterEntries, ...locationEntries];
  }, [filteredMonsters, filteredLocations]);

  const resolveDrops = useCallback(
    (monster: Monster): ResolvedDrop[] => {
      return (monster.items || []).map((drop) => ({
        itemId: drop.item_id,
        name: itemsById[drop.item_id]?.name ?? `#${drop.item_id}`,
        min: drop.min,
        max: drop.max,
        chance: drop.chance,
        spoil: drop.spoil,
      }));
    },
    [itemsById],
  );

  const calculate = useCallback(
    (monster: Monster): MonsterCalculation => {
      const drops = resolveDrops(monster);
      const skillsList = monster.skills || [];
      const hpRateSkill = getMonsterHpRate(monster);
      const hpMultiplier = hpRateSkill ? Math.max(0, getMonsterHpRateValue(hpRateSkill)) : 1;
      const dmgMultiplier = elementMultiplierFor(element, skillsList) * elementResistFor(element, skillsList);

      const exp = getMonsterExp(monster);
      const hp = Math.round(monster.org_hp * (hpMultiplier || 1));
      const baseMdef = calcMdef(monster);
      const mdef = Math.round(baseMdef * mDefSkillMultiplier(skillsList));
      const dmg =
        dmgMultiplier *
        92 *
        Math.sqrt(Math.max(0, matk) * shotMultiplier(shot)) *
        Math.max(0, skillPower) /
        (Math.max(1, mdef));
      const hits = dmg > 0 && hp > 0 ? Math.ceil(hp / dmg) : Infinity;
      const expPerHit = hits && isFinite(hits) ? exp / hits : 0;
      const adenaDrop = drops.find((drop) => drop.itemId === ADENA_ITEM_ID);
      const adena = adenaDrop ? ((adenaDrop.min + adenaDrop.max) / 2) * adenaDrop.chance : 0;
      const adenaPerHit = hits && isFinite(hits) ? adena / hits : 0;
      const shotPrice = shot === 'none' ? 0 : shot === 'ss' ? ssPrice : bssPrice;
      const shotCostPerKill = hits && isFinite(hits) ? hits * shotPrice : Infinity;
      const netAdenaPerKill = isFinite(shotCostPerKill) ? adena - shotCostPerKill : adena;

      return {
        monster,
        hp,
        mdef,
        dmg,
        hits,
        exp,
        expPerHit,
        adena,
        adenaPerHit,
        herbs: hasHerbDrop(drops),
        shotCostPerKill: isFinite(shotCostPerKill) ? shotCostPerKill : 0,
        netAdenaPerKill,
      };
    },
    [resolveDrops, element, matk, shot, skillPower, ssPrice, bssPrice],
  );

  const selectedDrops = useMemo(() => (selectedNpc ? resolveDrops(selectedNpc) : []), [selectedNpc, resolveDrops]);

  const currentStats = useMemo(() => (selectedNpc ? calculate(selectedNpc) : null), [selectedNpc, calculate]);

  const selectedLocationStats = useMemo(() => {
    if (!selectedLocation) return [];
    const entries = monsters
      .filter((monster) => monster.locations?.some((loc) => loc.id === selectedLocation.id))
      .map((monster) => calculate(monster));
    return entries.sort((a, b) => b.netAdenaPerKill - a.netAdenaPerKill);
  }, [selectedLocation, monsters, calculate]);

  const suggestedMonsters = useMemo(() => {
    const results: MonsterCalculation[] = [];
    for (const monster of monsters) {
      const level = monster.level;
      if (level < suggestedMinLevel || level > suggestedMaxLevel) continue;
      const result = calculate(monster);
      if (suggestedHerbs && !result.herbs) continue;
      if (isFinite(result.hits) && result.hits > suggestedMaxHits) continue;
      results.push(result);
    }
    if (suggestedOptimisation === 'adena') {
      results.sort((a, b) => b.netAdenaPerKill - a.netAdenaPerKill);
    } else {
      results.sort((a, b) => b.expPerHit - a.expPerHit);
    }
    return results.slice(0, 32);
  }, [monsters, suggestedMinLevel, suggestedMaxLevel, suggestedHerbs, suggestedMaxHits, suggestedOptimisation, calculate]);

  const locationAggregates = useMemo(() => {
    const groups: Record<number, LocationAggregate> = {};
    for (const entry of suggestedMonsters) {
      for (const loc of entry.monster.locations || []) {
        const id = loc.id;
        if (!groups[id]) {
          groups[id] = {
            location: loc,
            monsterCount: 0,
            avgExpPerHit: 0,
            avgAdenaPerHit: 0,
            avgNetAdenaPerKill: 0,
            avgHits: 0,
            monsters: [],
          };
        }
        const group = groups[id];
        group.monsterCount += 1;
        group.avgExpPerHit += entry.expPerHit;
        group.avgAdenaPerHit += entry.adenaPerHit;
        group.avgNetAdenaPerKill += entry.netAdenaPerKill;
        group.avgHits += entry.hits;
        group.monsters.push(entry);
      }
    }
    return Object.values(groups)
      .map((group) => ({
        ...group,
        avgExpPerHit: group.monsterCount ? group.avgExpPerHit / group.monsterCount : 0,
        avgAdenaPerHit: group.monsterCount ? group.avgAdenaPerHit / group.monsterCount : 0,
        avgNetAdenaPerKill: group.monsterCount ? group.avgNetAdenaPerKill / group.monsterCount : 0,
        avgHits: group.monsterCount ? group.avgHits / group.monsterCount : 0,
      }))
      .sort((a, b) => b.avgNetAdenaPerKill - a.avgNetAdenaPerKill)
      .slice(0, 16);
  }, [suggestedMonsters]);

  const hitsPerKill = currentStats?.hits ?? 0;
  const perKillShotCost = currentStats?.shotCostPerKill ?? 0;

  const handleSearchSelection = useCallback(
    (entry: SearchResult) => {
      if (entry.type === 'monster') {
        setSelectedNpc(entry.monster);
        setSelectedLocation(null);
        setQuery(entry.monster.name);
      } else {
        setSelectedLocation(entry.location);
        setSelectedNpc(null);
        setQuery(entry.location.name);
      }
      setOpenList(false);
    },
    [],
  );

  const addMonsterToSet = useCallback((monster: Monster | null) => {
    if (!monster) return;
    const id = monster.npc_id;
    setActive((prev) => {
      if (prev.some((p) => p.id === id)) return prev;
      const remain = Math.max(0, 100 - prev.reduce((a, b) => a + b.rate, 0));
      return [...prev, {id, name: monster.name, rate: remain || 0}];
    });
  }, []);

  const totalRate = active.reduce((acc, curr) => acc + curr.rate, 0);

  const setAggregates = useMemo(() => {
    if (active.length === 0) return null;
    let adenaPerKill = 0;
    let shotCostPerKill = 0;
    const itemExpectedPerKill: Record<number, {name: string; expectedQty: number}> = {};

    for (const entry of active) {
      const monster = monstersById[entry.id];
      if (!monster) continue;
      const weight = entry.rate / 100;
      const stats = calculate(monster);
      adenaPerKill += stats.adena * weight;
      shotCostPerKill += stats.shotCostPerKill * weight;
      const drops = resolveDrops(monster);
      for (const drop of drops) {
        const avgQty = (drop.min + drop.max) / 2;
        const expected = drop.chance * avgQty * weight;
        if (expected <= 0) continue;
        if (!itemExpectedPerKill[drop.itemId]) {
          itemExpectedPerKill[drop.itemId] = {name: drop.name, expectedQty: 0};
        }
        itemExpectedPerKill[drop.itemId].expectedQty += expected;
      }
    }

    const safeTotal = Number.isFinite(totalMonsters) ? Math.max(0, totalMonsters) : 0;
    const grossAdenaForSet = adenaPerKill * safeTotal;
    const shotCostForSet = shotCostPerKill * safeTotal;
    const netAdenaPerKill = adenaPerKill - shotCostPerKill;
    const netAdenaForSet = netAdenaPerKill * safeTotal;

    const itemsList = Object.entries(itemExpectedPerKill)
      .filter(([id]) => Number(id) !== ADENA_ITEM_ID)
      .map(([id, value]) => ({
        id: Number(id),
        name: value.name,
        qtyPerKill: value.expectedQty,
        qtyForSet: value.expectedQty * safeTotal,
      }))
      .sort((a, b) => b.qtyPerKill - a.qtyPerKill);

    return {
      adenaPerKill,
      shotCostPerKill,
      netAdenaPerKill,
      grossAdenaForSet,
      shotCostForSet,
      netAdenaForSet,
      itemsList,
    };
  }, [active, monstersById, calculate, resolveDrops, totalMonsters]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-neutral-100 dark:from-black dark:to-neutral-950 text-neutral-900 dark:text-neutral-100">
      <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">L2Reborn Mage Farm Helper (C5)</h1>
          <div className="text-xs text-neutral-500">created by <b>God</b> (L2Reborn Signature Franz) • shadcn/ui • Next.js</div>
        </header>

        {!monsters.length || !items.length || !locations.length || !skills.length ? (
          <Card className="max-w-3xl mx-auto">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="size-3 animate-ping rounded-full bg-indigo-500/70" />
                <div>
                  <div className="text-sm font-medium">Loading databases</div>
                  <div className="text-xs text-neutral-500">{loadLabel || 'Preparing...'}</div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <Progress value={loadPct} aria-label={loadPct < 100 ? 'Loading data' : 'Completed loading'} />
                <div className="text-xs text-neutral-500">
                  We are fetching NPCs, items, skills and locations from CDN, parsing JSON files and indexing everything. This may
                  take a few seconds.
                </div>
                {error && <div className="text-sm text-red-600">{error}</div>}
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <div className="text-sm font-semibold">Farming inputs</div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="matk">M. Atk</Label>
                    <Input id="matk" type="number" value={matk} onChange={(e) => setMatk(toNum(e.target.value, 0))} />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="skillPower">Skill power</Label>
                    <Input id="skillPower" type="number" value={skillPower} onChange={(e) => setSkillPower(toNum(e.target.value, 0))} />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>Shot type</Label>
                    <Select value={shot} onValueChange={(value: 'none' | 'ss' | 'bss') => setShot(value)}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select shot type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="ss">Spiritshots</SelectItem>
                        <SelectItem value="bss">Blessed spiritshots</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>Element</Label>
                    <Select value={element} onValueChange={(value: string) => setElement(value)}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select element" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="fire">Fire</SelectItem>
                        <SelectItem value="water">Water</SelectItem>
                        <SelectItem value="wind">Wind</SelectItem>
                        <SelectItem value="earth">Earth</SelectItem>
                        <SelectItem value="holy">Holy</SelectItem>
                        <SelectItem value="dark">Dark</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="ssPrice">SS price per hit</Label>
                    <Input id="ssPrice" type="number" value={ssPrice} onChange={(e) => setSsPrice(toNum(e.target.value, 0))} />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="bssPrice">BSS price per hit</Label>
                    <Input id="bssPrice" type="number" value={bssPrice} onChange={(e) => setBssPrice(toNum(e.target.value, 0))} />
                  </div>
                </div>
                <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="maxHits">Max hits</Label>
                    <Input id="maxHits" type="number" value={suggestedMaxHits} onChange={(e) => setSuggestedMaxHits(toNum(e.target.value, 1))} />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="optimiseFor">Optimise for</Label>
                    <Select value={suggestedOptimisation} onValueChange={(value: 'exp' | 'adena') => setSuggestedOptimisation(value)}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select optimisation" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="exp">Exp</SelectItem>
                        <SelectItem value="adena">Net adena</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="minLevel">Min level</Label>
                    <Input id="minLevel" type="number" value={suggestedMinLevel} onChange={(e) => setSuggestedMinLevel(toNum(e.target.value, 1))} />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="maxLevel">Max level</Label>
                    <Input id="maxLevel" type="number" value={suggestedMaxLevel} onChange={(e) => setSuggestedMaxLevel(toNum(e.target.value, 80))} />
                  </div>
                  <div className="flex items-center gap-2 md:col-span-2">
                    <Checkbox id="herbs" checked={suggestedHerbs} onCheckedChange={(checked) => setSuggestedHerbs(checked === true)} />
                    <Label htmlFor="herbs" className="text-sm">Only show herb drop monsters</Label>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Tabs defaultValue="search" className="space-y-4">
              <TabsList>
                <TabsTrigger value="search">Search</TabsTrigger>
                <TabsTrigger value="monsters">Monsters</TabsTrigger>
                <TabsTrigger value="locations">Locations</TabsTrigger>
                <TabsTrigger value="active" className="flex items-center gap-2">
                  Active set
                  <span className="inline-flex items-center justify-center rounded-full bg-indigo-600 text-white text-[10px] leading-none px-2 py-0.5">
                    {active.length}
                  </span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="search" className="space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <Card className="lg:col-span-1">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold">Search NPC or location</div>
                        <div className="text-xs text-neutral-500">{monsters.length.toLocaleString()} NPCs • {locations.length.toLocaleString()} locations</div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="relative">
                        <Input
                          ref={inputRef}
                          value={query}
                          onChange={(e) => {
                            setQuery(e.target.value);
                            setOpenList(true);
                          }}
                          onFocus={() => setOpenList(true)}
                          onBlur={() => setTimeout(() => setOpenList(false), 150)}
                          placeholder="Type NPC or location name..."
                        />
                        {openList && (
                          <div className="absolute z-10 mt-2 max-h-80 w-full overflow-auto rounded-md border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 shadow-lg">
                            {searchResults.length === 0 ? (
                              <div className="p-3 text-sm text-neutral-500">No results</div>
                            ) : (
                              searchResults.map((entry) => (
                                <button
                                  key={entry.type === 'monster' ? `monster-${entry.monster.npc_id}` : `location-${entry.location.id}`}
                                  type="button"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => handleSearchSelection(entry)}
                                  className={`w-full text-left px-3 py-2 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800${
                                    entry.type === 'monster' && selectedNpc?.npc_id === entry.monster.npc_id
                                      ? ' bg-neutral-100 dark:bg-neutral-800'
                                      : selectedLocation && entry.type === 'location' && selectedLocation.id === entry.location.id
                                        ? ' bg-neutral-100 dark:bg-neutral-800'
                                        : ''
                                  }`}
                                >
                                  <div className="flex items-center justify-between">
                                    <span>{entry.type === 'monster' ? entry.monster.name : entry.location.name}</span>
                                    <span className="text-xs text-neutral-500">
                                      {entry.type === 'monster' ? `Lv ${entry.monster.level || '-'}` : 'Location'}
                                    </span>
                                  </div>
                                </button>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="lg:col-span-2">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold">
                          {selectedLocation ? 'Location details' : 'NPC Details'}
                        </div>
                        {selectedNpc && (
                          <button
                            onClick={() => addMonsterToSet(selectedNpc)}
                            className="text-xs rounded-md border border-black/10 dark:border-white/10 px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                            type="button"
                          >
                            Add to active set
                          </button>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent>
                      {!selectedNpc && !selectedLocation ? (
                        <div className="text-sm text-neutral-500">Pick an NPC or location to see details.</div>
                      ) : selectedLocation ? (
                        <div className="space-y-4 text-sm">
                          <div>
                            <div className="text-lg font-medium">{selectedLocation.name}</div>
                            <div className="text-xs text-neutral-500">
                              Location ID {selectedLocation.id} • {selectedLocationStats.length} monsters
                            </div>
                          </div>
                          {selectedLocationStats.length === 0 ? (
                            <div className="text-sm text-neutral-500">No monsters recorded for this location.</div>
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {selectedLocationStats.map((entry) => (
                                <div
                                  key={entry.monster.npc_id}
                                  className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-4 space-y-3"
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <div className="text-sm font-semibold">{entry.monster.name}</div>
                                      <div className="text-xs text-neutral-500">
                                        Level {entry.monster.level || '-'} • ID {entry.monster.npc_id}
                                      </div>
                                    </div>
                                    <div className="text-right">
                                      <div className="text-xs text-neutral-500">Hits</div>
                                      <div className="text-sm font-medium">{isFinite(entry.hits) ? entry.hits : '∞'}</div>
                                    </div>
                                    <div className="text-right">
                                      <div className="text-xs text-neutral-500">Net adena</div>
                                      <div className={`text-sm font-medium ${entry.netAdenaPerKill < 0 ? 'text-red-600' : 'text-indigo-600 dark:text-indigo-400'}`}>
                                        {entry.netAdenaPerKill.toFixed(1)}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                                    <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-2">
                                      <div className="text-neutral-500">HP</div>
                                      <div className="text-sm font-medium">{entry.hp.toLocaleString()}</div>
                                    </div>
                                    <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-2">
                                      <div className="text-neutral-500">M.Def</div>
                                      <div className="text-sm font-medium">{entry.mdef.toLocaleString()}</div>
                                    </div>
                                    <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-2">
                                      <div className="text-neutral-500">Damage</div>
                                      <div className="text-sm font-medium">{entry.dmg.toFixed(0)}</div>
                                    </div>
                                    <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-2">
                                      <div className="text-neutral-500">Exp</div>
                                      <div className="text-sm font-medium">{entry.exp.toLocaleString()}</div>
                                    </div>
                                    <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-2">
                                      <div className="text-neutral-500">Exp/Hit</div>
                                      <div className="text-sm font-medium">{entry.expPerHit.toFixed(1)}</div>
                                    </div>
                                    <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-2">
                                      <div className="text-neutral-500">Adena</div>
                                      <div className="text-sm font-medium">{entry.adena.toFixed(1)}</div>
                                    </div>
                                    <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-2">
                                      <div className="text-neutral-500">Adena/Hit</div>
                                      <div className="text-sm font-medium">{entry.adenaPerHit.toFixed(2)}</div>
                                    </div>
                                  </div>
                                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
                                    <div>
                                      Shot cost:{' '}
                                      <span className="font-medium text-neutral-900 dark:text-neutral-100">
                                        {entry.shotCostPerKill.toFixed(1)} adena
                                      </span>
                                    </div>
                                    <div>
                                      Herb drop:{' '}
                                      <span className="font-medium text-neutral-900 dark:text-neutral-100">
                                        {entry.herbs ? 'Yes' : 'No'}
                                      </span>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => addMonsterToSet(entry.monster)}
                                      disabled={active.some((p) => p.id === entry.monster.npc_id)}
                                      className="ml-auto text-xs rounded-md border border-black/10 dark:border-white/10 px-3 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50"
                                    >
                                      {active.some((p) => p.id === entry.monster.npc_id) ? 'Added' : 'Add to set'}
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : !currentStats ? (
                        <div className="text-sm text-neutral-500">Pick an NPC to see details.</div>
                      ) : selectedNpc ? (
                        <div className="space-y-4 text-sm">
                          <div>
                            <div className="text-lg font-medium flex items-center gap-3">
                              {selectedNpc.name}
                              <small>
                                <a
                                  href={`https://lineage2wiki.org/interlude/monster/${selectedNpc.npc_id}`}
                                  target="_blank"
                                  className="text-indigo-500"
                                >
                                  wiki
                                </a>
                              </small>
                            </div>
                            <div className="text-xs text-neutral-500">
                              Level {selectedNpc.level || '-'} • ID {selectedNpc.npc_id}
                            </div>
                            {selectedNpc.locations?.length > 0 && (
                              <div className="text-xs text-neutral-500 mt-1">
                                Locations: {selectedNpc.locations.map((loc) => loc.name).join(', ')}
                              </div>
                            )}
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                            <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-3">
                              <div className="text-xs text-neutral-500">HP</div>
                              <div className="font-medium">{currentStats.hp.toLocaleString()}</div>
                            </div>
                            <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-3">
                              <div className="text-xs text-neutral-500">M.Def</div>
                              <div className="font-medium">{currentStats.mdef.toLocaleString()}</div>
                            </div>
                            <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-3">
                              <div className="text-xs text-neutral-500">Damage</div>
                              <div className="font-medium">{currentStats.dmg.toFixed(0)}</div>
                            </div>
                            <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-3">
                              <div className="text-xs text-neutral-500">Hits to kill</div>
                              <div className="font-medium">{isFinite(hitsPerKill) ? hitsPerKill : '∞'}</div>
                            </div>
                            <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-3">
                              <div className="text-xs text-neutral-500">Exp</div>
                              <div className="font-medium">{currentStats.exp.toLocaleString()}</div>
                            </div>
                            <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-3">
                              <div className="text-xs text-neutral-500">SP</div>
                              <div className="font-medium">{selectedNpc.acquire_sp.toLocaleString()}</div>
                            </div>
                          </div>
                          <div className="text-xs text-neutral-500">
                            Per kill shot cost: <span className="font-medium text-neutral-900 dark:text-neutral-100">{perKillShotCost.toFixed(0)} adena</span>
                          </div>
                          <div className="rounded-md border border-black/5 dark:border-white/5">
                            <div className="px-3 py-2 text-xs font-medium border-b border-black/5 dark:border-white/5">Drops</div>
                            <div className="divide-y divide-black/5 dark:divide-white/5 max-h-64 overflow-auto">
                              {selectedDrops.length === 0 ? (
                                <div className="p-3 text-sm text-neutral-500">No drop data</div>
                              ) : (
                                selectedDrops
                                  .sort((a, b) => b.chance - a.chance)
                                  .map((drop, index) => (
                                    <div key={`${drop.itemId}-${index}`} className="px-3 py-2 flex items-center justify-between text-sm">
                                      <div>
                                        <div className="font-medium">{drop.name}</div>
                                        <div className="text-xs text-neutral-500">
                                          Qty {drop.min}-{drop.max} {drop.spoil ? '• Spoil' : ''}
                                        </div>
                                      </div>
                                      <div className="text-xs text-neutral-600 dark:text-neutral-300">{(drop.chance * 100).toFixed(3)}%</div>
                                    </div>
                                  ))
                              )}
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="monsters">
                <Card>
                  <CardHeader>
                    <div className="text-sm font-semibold">Suggested monsters</div>
                  </CardHeader>
                  <CardContent>
                    {suggestedMonsters.length === 0 ? (
                      <div className="text-sm text-neutral-500">No monsters match your criteria yet.</div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {suggestedMonsters.map((entry) => (
                          <div key={entry.monster.npc_id} className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-4 space-y-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold">{entry.monster.name}</div>
                                <div className="text-xs text-neutral-500">Level {entry.monster.level || '-'} • Hits {isFinite(entry.hits) ? entry.hits : '∞'}</div>
                              </div>
                              <div className="text-right">
                                <div className="text-xs text-neutral-500">Exp/Hit</div>
                                <div className="text-sm font-medium text-indigo-600 dark:text-indigo-400">{entry.expPerHit.toFixed(2)}</div>
                              </div>
                              <div className="text-right">
                                <div className="text-xs text-neutral-500">Net Adena</div>
                                <div className="text-sm font-medium text-indigo-600 dark:text-indigo-400">{entry.netAdenaPerKill.toFixed(1)}</div>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-2">
                                <div className="text-neutral-500">HP</div>
                                <div className="text-sm font-medium">{entry.hp.toLocaleString()}</div>
                              </div>
                              <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-2">
                                <div className="text-neutral-500">M.Def</div>
                                <div className="text-sm font-medium">{entry.mdef.toLocaleString()}</div>
                              </div>
                              <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-2">
                                <div className="text-neutral-500">Adena/Hit</div>
                                <div className="text-sm font-medium">{entry.adenaPerHit.toFixed(2)}</div>
                              </div>
                              <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-2">
                                <div className="text-neutral-500">Shot cost</div>
                                <div className="text-sm font-medium">{entry.shotCostPerKill.toFixed(1)}</div>
                              </div>
                            </div>
                            <div className="flex items-center justify-between">
                              <div className="text-xs text-neutral-500">Total Exp: {entry.exp.toFixed(0)}</div>
                              <div className="text-xs text-neutral-500">Total Adena: {entry.adena.toFixed(0)}</div>
                              <button
                                onClick={() => addMonsterToSet(entry.monster)}
                                disabled={active.some((p) => p.id === entry.monster.npc_id)}
                                className="text-xs rounded-md border border-black/10 dark:border-white/10 px-3 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50"
                              >
                                {active.some((p) => p.id === entry.monster.npc_id) ? 'Added' : 'Add to set'}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="locations">
                <Card>
                  <CardHeader>
                    <div className="text-sm font-semibold">Best locations</div>
                  </CardHeader>
                  <CardContent>
                    {locationAggregates.length === 0 ? (
                      <div className="text-sm text-neutral-500">No locations to show. Adjust filters above.</div>
                    ) : (
                      <div className="space-y-4">
                        {locationAggregates.map((location) => {
                          const topMonsters = [...location.monsters]
                            .sort((a, b) => b.netAdenaPerKill - a.netAdenaPerKill)
                            .slice(0, 3);
                          const bestMonster = topMonsters[0];
                          return (
                            <div key={location.location.id} className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-4 space-y-3">
                              <div className="flex items-center justify-between">
                                <div>
                                  <div className="text-sm font-semibold">{location.location.name}</div>
                                  <div className="text-xs text-neutral-500">{location.monsterCount} monsters match</div>
                                </div>
                                <div className="text-right text-xs text-neutral-500">
                                  <div>Avg Exp/Hit: <span className="font-medium text-neutral-900 dark:text-neutral-100">{location.avgExpPerHit.toFixed(2)}</span></div>
                                  <div>Avg Net Adena: <span className="font-medium text-neutral-900 dark:text-neutral-100">{location.avgNetAdenaPerKill.toFixed(1)}</span></div>
                                </div>
                              </div>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                                <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-2">
                                  <div className="text-neutral-500">Avg hits</div>
                                  <div className="text-sm font-medium">{location.avgHits.toFixed(1)}</div>
                                </div>
                                <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-2">
                                  <div className="text-neutral-500">Avg Adena/Hit</div>
                                  <div className="text-sm font-medium">{location.avgAdenaPerHit.toFixed(2)}</div>
                                </div>
                                <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-2">
                                  <div className="text-neutral-500">Top monster</div>
                                  <div className="text-sm font-medium">{bestMonster?.monster.name || '–'}</div>
                                </div>
                                <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-2">
                                  <div className="text-neutral-500">Top net adena</div>
                                  <div className="text-sm font-medium">{bestMonster ? bestMonster.netAdenaPerKill.toFixed(1) : '0.0'}</div>
                                </div>
                              </div>
                              <div className="space-y-2">
                              {topMonsters.map((entry) => (
                                <div key={entry.monster.npc_id} className="flex items-center justify-between text-sm">
                                  <div>
                                    <div className="font-medium">{entry.monster.name}</div>
                                    <div className="text-xs text-neutral-500">Lv {entry.monster.level} • Net {entry.netAdenaPerKill.toFixed(1)}</div>
                                  </div>
                                  <button
                                    onClick={() => addMonsterToSet(entry.monster)}
                                    disabled={active.some((p) => p.id === entry.monster.npc_id)}
                                    className="text-xs rounded-md border border-black/10 dark:border-white/10 px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50"
                                  >
                                    {active.some((p) => p.id === entry.monster.npc_id) ? 'Added' : 'Add'}
                                  </button>
                                </div>
                              ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="active">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <Card>
                    <CardHeader>
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold">Active set</div>
                        <div className="flex items-center gap-2 text-xs text-neutral-500">
                          <Label htmlFor="totalMonsters" className="text-xs">Total monsters</Label>
                          <Input
                            id="totalMonsters"
                            type="number"
                            value={totalMonsters}
                            onChange={(e) => setTotalMonsters(toNum(e.target.value, 0))}
                            className="w-24 h-8"
                          />
                          <div>• Total Rate: {totalRate}%</div>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {active.length === 0 ? (
                        <div className="text-sm text-neutral-500">No NPCs yet. Add one from any tab.</div>
                      ) : (
                        <div className="space-y-2 text-sm">
                          {active.map((entry) => (
                            <div key={entry.id} className="flex items-center gap-2">
                              <div className="flex-1 truncate" title={entry.name}>{entry.name}</div>
                              <Input
                                type="number"
                                value={entry.rate}
                                onChange={(e) =>
                                  setActive((prev) =>
                                    prev.map((p) => (p.id === entry.id ? {...p, rate: toNum(e.target.value, 0)} : p)),
                                  )
                                }
                                className="w-20"
                              />
                              <span className="text-xs text-neutral-500">%</span>
                              <button
                                onClick={() => setActive((prev) => prev.filter((p) => p.id !== entry.id))}
                                className="text-xs rounded-md border border-black/10 dark:border-white/10 px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                          {totalRate !== 100 && (
                            <div className="text-xs text-amber-600">Warning: total rate should sum to 100%.</div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <div className="text-sm font-semibold">Aggregated stats</div>
                    </CardHeader>
                    <CardContent>
                      {!setAggregates ? (
                        <div className="text-sm text-neutral-500">Nothing to show yet.</div>
                      ) : (
                        <div className="space-y-4 text-sm">
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-3">
                              <div className="text-xs text-neutral-500">Gross adena for set</div>
                              <div className="text-lg font-medium">{Math.round(setAggregates.grossAdenaForSet).toLocaleString()}</div>
                            </div>
                            <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-3">
                              <div className="text-xs text-neutral-500">Shot cost for set</div>
                              <div className="text-lg font-medium">{Math.round(setAggregates.shotCostForSet).toLocaleString()}</div>
                            </div>
                            <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-3">
                              <div className="text-xs text-neutral-500">Net adena for set</div>
                              <div className={`text-lg font-medium ${setAggregates.netAdenaForSet < 0 ? 'text-red-600' : ''}`}>
                                {Math.round(setAggregates.netAdenaForSet).toLocaleString()}
                              </div>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-3">
                              <div className="text-xs text-neutral-500">Adena per monster (gross)</div>
                              <div className="font-medium">{setAggregates.adenaPerKill.toFixed(3)}</div>
                            </div>
                            <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-3">
                              <div className="text-xs text-neutral-500">Shot cost per monster</div>
                              <div className="font-medium">{setAggregates.shotCostPerKill.toFixed(3)}</div>
                            </div>
                            <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-3">
                              <div className="text-xs text-neutral-500">Adena per monster (net)</div>
                              <div className={`font-medium ${setAggregates.netAdenaPerKill < 0 ? 'text-red-600' : ''}`}>
                                {setAggregates.netAdenaPerKill.toFixed(3)}
                              </div>
                            </div>
                          </div>
                          <div>
                            <div className="text-xs font-medium mb-1">Drops for set — expected quantities only</div>
                            <div className="space-y-1 max-h-64 overflow-auto">
                              {setAggregates.itemsList.length === 0 ? (
                                <div className="text-xs text-neutral-500">No items</div>
                              ) : (
                                setAggregates.itemsList.map((item) => (
                                  <div key={item.id} className="flex items-center gap-2">
                                    <div className="flex-1 truncate" title={item.name}>{item.name}</div>
                                    <div className="w-40 text-right text-xs" title={`${item.qtyForSet.toFixed(3)} total`}>
                                      {item.qtyForSet.toFixed(3)} qty
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </div>
  );
}
