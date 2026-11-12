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
import {
  CHRONICLE_IDS,
  CHRONICLES,
  DEFAULT_CHRONICLE,
  chooseChronicle,
  useChronicleId,
} from '@/lib/chronicles';
import type {Chronicle, ChronicleId, Element, Weapon} from '@/lib/chronicles';
import {
  WEAPONS,
  attackIntervalMs,
  attacksThatLand,
  createAttackEstimator,
  critChance,
  hitChance,
  hitsPerAttack,
  monsterEvasion,
  monsterPdef,
  physicalDamage,
  weaponMultiplier,
} from '@/lib/physical';

const ADENA_ITEM_ID = 57;

const ELEMENT_LABELS: Record<Element, string> = {
  none: 'None',
  fire: 'Fire',
  water: 'Water',
  wind: 'Wind',
  earth: 'Earth',
  holy: 'Holy',
  dark: 'Dark',
};

const WEAPON_LABELS: Record<Weapon, string> = {
  sword: 'Sword',
  blunt: 'Blunt',
  dagger: 'Dagger',
  pole: 'Pole',
  bow: 'Bow',
  dual: 'Dual swords',
  fist: 'Fist',
};

type ClassType = 'magical' | 'physical';

function WikiLink({base, id}: {base: string; id: number}) {
  return (
    <a
      href={`${base}/${id}`}
      target="_blank"
      rel="noreferrer"
      className="text-indigo-500 text-xs font-medium"
    >
      wiki
    </a>
  );
}

type ResolvedDrop = {
  itemId: number;
  name: string;
  min: number;
  max: number;
  chance: number;
  spoil: number;
  itemType?: string;
  etcItemType?: string;
};

type PhysicalStats = {
  hitChance: number;
  critChance: number;
  secondsPerKill: number;
  expPerSecond: number;
  netAdenaPerSecond: number;
};

type MonsterCalculation = {
  monster: Monster;
  hp: number;
  defense: number;
  dmg: number;
  hits: number;
  remainingHp: number;
  exp: number;
  expPerHit: number;
  adena: number;
  adenaPerHit: number;
  herbs: boolean;
  shotCostPerKill: number;
  netAdenaPerKill: number;
  // Null in magical mode.
  physical: PhysicalStats | null;
};

type ActiveEntry = { id: number; name: string; rate: number };

type ActiveEntryDetails = ActiveEntry & {
  monster: Monster;
  stats: MonsterCalculation;
  drops: ResolvedDrop[];
};

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
  avgSecondsPerKill: number;
  monsters: MonsterCalculation[];
};

type RawItem = {
  item_id?: string | number;
  id?: string | number;
  name?: string;
  item_type?: string;
  etcitem_type?: string;
  weapon_type?: string;
};
type RawLocation = { id?: string | number; name?: string };
type RawSkill = { skill_id?: string | number; id?: string | number; name?: string; level?: string | number };
type RawDrop = { item_id?: string | number; min?: string | number; max?: string | number; chance?: string | number; spoil?: string | number };
type RawMonsterSkill = { skill_id?: string | number; level?: string | number };
type RawMonster = {
  npc_id?: string | number;
  name?: string;
  level?: string | number;
  race?: string;
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
  mdef?: string | number;
  pdef?: string | number;
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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function shotMultiplier(s: 'none' | 'ss' | 'bss') {
  return s === 'none' ? 1 : s === 'ss' ? 2 : 4;
}

// Skill 4413, from the wiki. Level 10 is 0.9 rather than the wiki's 0.91, because levels
// 10-12 were tuned against in-game hits. The other levels haven't been checked in-game.
const M_DEF_SKILL_MULTIPLIERS = [
  0.39, 0.43, 0.47, 0.52, 0.57, 0.63, 0.69, 0.76, 0.83, 0.9, 1, 1.1, 1.21, 1.33, 1.46, 1.61, 1.77, 1.94, 2.14, 2.35, 2.59, 10,
];

function mDefSkillMultiplier(skills: MonsterSkill[]): number {
  const skill = skills.find((s) => s.skill_id === 4413);
  if (!skill) return 1;
  return M_DEF_SKILL_MULTIPLIERS[clamp(skill.level - 1, 0, M_DEF_SKILL_MULTIPLIERS.length - 1)];
}

function elementMultiplierFor(chronicle: Chronicle, element: Element, skills: MonsterSkill[]): number {
  const multipliers = chronicle.elementSkills[element] ?? {};
  return skills.reduce((total, skill) => total * (multipliers[skill.skill_id] ?? 1), 1);
}

function chronicleMDefMultiplier(chronicle: Chronicle, skills: MonsterSkill[]): number {
  return skills.reduce((total, skill) => total * (chronicle.mDefSkills[skill.skill_id] ?? 1), 1);
}

function formatHits(hits: number): string {
  if (!isFinite(hits)) return '∞';
  return Number.isInteger(hits) ? String(hits) : hits.toFixed(2);
}

function formatSeconds(seconds: number): string {
  return isFinite(seconds) ? `${seconds.toFixed(1)}s` : '∞';
}

function PhysicalTiles({stats, padding}: {stats: PhysicalStats; padding: string}) {
  const tiles = [
    ['Seconds/kill', formatSeconds(stats.secondsPerKill)],
    ['Hit chance', `${(stats.hitChance * 100).toFixed(0)}%`],
    ['Crit chance', `${(stats.critChance * 100).toFixed(1)}%`],
    ['Exp/sec', stats.expPerSecond.toFixed(1)],
    ['Net adena/sec', stats.netAdenaPerSecond.toFixed(1)],
  ];
  return tiles.map(([label, value]) => (
    <div key={label} className={`rounded-md bg-neutral-50 dark:bg-neutral-800/50 ${padding}`}>
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  ));
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
  const chronicleId = useChronicleId();
  const chronicle = CHRONICLES[chronicleId ?? DEFAULT_CHRONICLE];

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
  const [classType, setClassType] = useState<ClassType>('magical');
  const [matk, setMatk] = useState<number>(140);
  const [skillPower, setSkillPower] = useState<number>(26);
  const [shot, setShot] = useState<'none' | 'ss' | 'bss'>('none');
  const [element, setElement] = useState<Element>('none');
  const [damageMultiplier, setDamageMultiplier] = useState<number>(100);
  const [ssPrice, setSsPrice] = useState<number>(24);
  const [bssPrice, setBssPrice] = useState<number>(52);
  const [patk, setPatk] = useState<number>(200);
  const [atkSpeed, setAtkSpeed] = useState<number>(300);
  const [accuracy, setAccuracy] = useState<number>(60);
  const [critical, setCritical] = useState<number>(44);
  const [critMultiplier, setCritMultiplier] = useState<number>(2);
  const [weapon, setWeapon] = useState<Weapon>('sword');
  const [soulshot, setSoulshot] = useState<boolean>(false);
  const [soulshotPrice, setSoulshotPrice] = useState<number>(20);
  const [shotsPerAttack, setShotsPerAttack] = useState<number>(1);
  const [arrowPrice, setArrowPrice] = useState<number>(5);
  const [bowReuse, setBowReuse] = useState<number>(1500);
  const [remainingMonsterHp, setRemainingMonsterHp] = useState<number>(0);
  const [expRate, setExpRate] = useState<number>(1);
  const [spRate, setSpRate] = useState<number>(1);
  const [adenaRate, setAdenaRate] = useState<number>(1);

  // Selection
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounced(query, 150);
  const [selectedNpc, setSelectedNpc] = useState<Monster | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [openList, setOpenList] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Suggestion inputs
  const [suggestedMaxHits, setSuggestedMaxHits] = useState<number>(1);
  // Separate from the mage default: average attacks is always above 1.
  const [physicalMaxHits, setPhysicalMaxHits] = useState<number>(10);
  const [suggestedOptimisation, setSuggestedOptimisation] = useState<'exp' | 'adena'>('exp');
  const [suggestedHerbs, setSuggestedHerbs] = useState<boolean>(true);
  const [suggestedMinLevel, setSuggestedMinLevel] = useState<number>(1);
  const [suggestedMaxLevel, setSuggestedMaxLevel] = useState<number>(80);
  const [undeadOnly, setUndeadOnly] = useState<boolean>(false);

  // Active set
  const [active, setActive] = useState<ActiveEntry[]>([]);
  const [totalMonsters, setTotalMonsters] = useState<number>(100);

  useEffect(() => {
    if (!chronicleId) return;
    const {dataPath} = CHRONICLES[chronicleId];
    let cancelled = false;

    async function fetchWithProgress(url: string, onStage: (s: string) => void, base: number, span: number): Promise<unknown> {
      onStage(`Fetching ${url}...`);
      try {
        // Revalidates, so a rebuilt data file reaches returning visitors.
        const res = await fetch(url, {cache: 'no-cache'});
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
          fetchWithProgress(`${dataPath}/monsters_data.json`, (s) => setLoadLabel(s), 2, 24),
          fetchWithProgress(`${dataPath}/items_data.json`, (s) => setLoadLabel(s), 28, 22),
          fetchWithProgress(`${dataPath}/locations_data.json`, (s) => setLoadLabel(s), 52, 22),
          fetchWithProgress(`${dataPath}/skills_data.json`, (s) => setLoadLabel(s), 76, 20),
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
          item_type: item.item_type ? String(item.item_type) : undefined,
          etcitem_type: item.etcitem_type ? String(item.etcitem_type) : undefined,
          weapon_type: item.weapon_type ? String(item.weapon_type) : undefined,
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
          race: String(monster.race ?? ''),
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
          mdef: monster.mdef == null ? undefined : toNum(monster.mdef),
          pdef: monster.pdef == null ? undefined : toNum(monster.pdef),
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
  }, [chronicleId]);

  const handleChronicleChange = useCallback(
    (next: ChronicleId) => {
      // IDs and data differ per chronicle, so nothing selected carries over.
      // Clearing the data also brings back the loading card.
      setMonsters([]);
      setMonstersById({});
      setItems([]);
      setItemsById({});
      setLocations([]);
      setSkills([]);
      setSelectedNpc(null);
      setSelectedLocation(null);
      setQuery('');
      setActive([]);
      setLoadPct(0);
      setLoadLabel('');
      if (!CHRONICLES[next].elements.includes(element)) setElement('none');
      chooseChronicle(next);
    },
    [element],
  );

  const eligibleMonsters = useMemo(
    () => monsters.filter((mon) => !undeadOnly || mon.race?.toLowerCase() === 'undead'),
    [monsters, undeadOnly],
  );

  const filteredMonsters = useMemo(() => {
    if (!debouncedQuery) return eligibleMonsters.slice(0, 50);
    const q = debouncedQuery.toLowerCase();
    return eligibleMonsters.filter((mon) => mon.name.toLowerCase().includes(q)).slice(0, 50);
  }, [eligibleMonsters, debouncedQuery]);

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
      return (monster.items || []).map((drop) => {
        const item = itemsById[drop.item_id];
        const quantityRate = drop.item_id === ADENA_ITEM_ID ? adenaRate : 1;
        return {
          itemId: drop.item_id,
          name: item?.name ?? `#${drop.item_id}`,
          min: drop.min * quantityRate,
          max: drop.max * quantityRate,
          chance: drop.chance,
          spoil: drop.spoil,
          itemType: item?.item_type,
          etcItemType: item?.etcitem_type,
        };
      });
    },
    [itemsById, adenaRate],
  );

  const isHerbItem = useCallback(
    (itemId: number): boolean => {
      const item = itemsById[itemId];
      if (!item) return false;
      if (item.item_type !== 'etcitem') return false;
      if (item.etcitem_type !== 'potion') return false;
      return /herb/i.test(item.name);
    },
    [itemsById],
  );

  const hasHerbDrop = useCallback(
    (drops: ResolvedDrop[]): boolean => drops.some((drop) => isHerbItem(drop.itemId)),
    [isHerbItem],
  );

  const estimateAttacks = useMemo(() => createAttackEstimator(critChance(critical), critMultiplier), [critical, critMultiplier]);

  const calculate = useCallback(
    (monster: Monster): MonsterCalculation => {
      const drops = resolveDrops(monster);
      const skillsList = monster.skills || [];
      const hpRateSkill = getMonsterHpRate(monster);
      const hpMultiplier = hpRateSkill ? Math.max(0, getMonsterHpRateValue(hpRateSkill)) : 1;
      const damageMultiplierFactor = clamp(damageMultiplier, 20, 180) / 100;

      const exp = Math.round(getMonsterExp(monster) * expRate);
      const hp = Math.round(monster.org_hp * (hpMultiplier || 1));
      const effectiveHp = Math.max(0, hp - Math.min(hp, remainingMonsterHp));
      const adenaDrop = drops.find((drop) => drop.itemId === ADENA_ITEM_ID);
      const adena = adenaDrop ? ((adenaDrop.min + adenaDrop.max) / 2) * adenaDrop.chance : 0;
      const herbs = hasHerbDrop(drops);

      if (classType === 'physical') {
        const defense = monsterPdef(chronicle, monster);
        const hitsInAttack = hitsPerAttack(weapon);
        const hitRate = hitChance(accuracy, monsterEvasion(monster));
        const dmg =
          (physicalDamage(patk, soulshot, defense) * weaponMultiplier(chronicle, weapon, skillsList) * damageMultiplierFactor) /
          hitsInAttack;
        const normalHits = dmg > 0 && hp > 0 ? Math.max(1, Math.ceil(effectiveHp / dmg)) : Infinity;
        const hits = isFinite(normalHits) ? estimateAttacks(normalHits, hitRate, hitsInAttack) : Infinity;
        const killable = isFinite(hits);
        const shotCost = soulshot ? attacksThatLand(hits, hitRate, hitsInAttack) * shotsPerAttack * soulshotPrice : 0;
        const arrowCost = weapon === 'bow' ? hits * arrowPrice : 0;
        const shotCostPerKill = killable ? shotCost + arrowCost : 0;
        const netAdenaPerKill = adena - shotCostPerKill;
        const secondsPerKill = (hits * attackIntervalMs(weapon, atkSpeed, bowReuse)) / 1000;
        const hasKillTime = isFinite(secondsPerKill) && secondsPerKill > 0;

        return {
          monster,
          hp,
          defense,
          dmg,
          hits,
          remainingHp: 0,
          exp,
          expPerHit: killable ? exp / hits : 0,
          adena,
          adenaPerHit: killable ? adena / hits : 0,
          herbs,
          shotCostPerKill,
          netAdenaPerKill,
          physical: {
            hitChance: hitRate,
            critChance: critChance(critical),
            secondsPerKill,
            expPerSecond: hasKillTime ? exp / secondsPerKill : 0,
            netAdenaPerSecond: hasKillTime ? netAdenaPerKill / secondsPerKill : 0,
          },
        };
      }

      const dmgMultiplier = elementMultiplierFor(chronicle, element, skillsList);
      const baseMdef = monster.mdef ?? calcMdef(monster);
      const defense = Math.round(baseMdef * mDefSkillMultiplier(skillsList) * chronicleMDefMultiplier(chronicle, skillsList));
      const dmg =
        dmgMultiplier *
        damageMultiplierFactor *
        chronicle.magicDamage({matk, shotMultiplier: shotMultiplier(shot), skillPower, mdef: defense});
      const hits = dmg > 0 && hp > 0 ? Math.max(1, Math.ceil(effectiveHp / dmg)) : Infinity;
      const remainingHp = hits && isFinite(hits) ? Math.max(0, hp - hits * dmg) : hp;
      const expPerHit = hits && isFinite(hits) ? exp / hits : 0;
      const adenaPerHit = hits && isFinite(hits) ? adena / hits : 0;
      const shotPrice = shot === 'none' ? 0 : shot === 'ss' ? ssPrice : bssPrice;
      const shotCostPerKill = hits && isFinite(hits) ? hits * shotPrice : Infinity;
      const netAdenaPerKill = isFinite(shotCostPerKill) ? adena - shotCostPerKill : adena;

      return {
        monster,
        hp,
        defense,
        dmg,
        hits,
        remainingHp,
        exp,
        expPerHit,
        adena,
        adenaPerHit,
        herbs,
        shotCostPerKill: isFinite(shotCostPerKill) ? shotCostPerKill : 0,
        netAdenaPerKill,
        physical: null,
      };
    },
    [
      chronicle, classType, resolveDrops, element, matk, shot, skillPower, ssPrice, bssPrice, hasHerbDrop, damageMultiplier,
      remainingMonsterHp, expRate, patk, atkSpeed, accuracy, critical, weapon, soulshot, soulshotPrice, shotsPerAttack,
      arrowPrice, bowReuse, estimateAttacks,
    ],
  );

  const selectedDrops = useMemo(() => (selectedNpc ? resolveDrops(selectedNpc) : []), [selectedNpc, resolveDrops]);

  const currentStats = useMemo(() => (selectedNpc ? calculate(selectedNpc) : null), [selectedNpc, calculate]);

  const selectedLocationStats = useMemo(() => {
    if (!selectedLocation) return [];
    const entries = eligibleMonsters
      .filter((monster) => monster.locations?.some((loc) => loc.id === selectedLocation.id))
      .map((monster) => calculate(monster));
    return entries.sort((a, b) => b.netAdenaPerKill - a.netAdenaPerKill);
  }, [selectedLocation, eligibleMonsters, calculate]);

  const maxHits = classType === 'physical' ? physicalMaxHits : suggestedMaxHits;

  const suggestedMonsters = useMemo(() => {
    const results: MonsterCalculation[] = [];
    for (const monster of eligibleMonsters) {
      const level = monster.level;
      if (level < suggestedMinLevel || level > suggestedMaxLevel) continue;
      const result = calculate(monster);
      if (chronicle.hasHerbs && suggestedHerbs && !result.herbs) continue;
      if (isFinite(result.hits) && result.hits > maxHits) continue;
      results.push(result);
    }
    if (suggestedOptimisation === 'adena') {
      results.sort((a, b) => b.netAdenaPerKill - a.netAdenaPerKill);
    } else {
      results.sort((a, b) => b.expPerHit - a.expPerHit);
    }
    return results.slice(0, 32);
  }, [chronicle, eligibleMonsters, suggestedMinLevel, suggestedMaxLevel, suggestedHerbs, maxHits, suggestedOptimisation, calculate]);

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
            avgSecondsPerKill: 0,
            monsters: [],
          };
        }
        const group = groups[id];
        group.monsterCount += 1;
        group.avgExpPerHit += entry.expPerHit;
        group.avgAdenaPerHit += entry.adenaPerHit;
        group.avgNetAdenaPerKill += entry.netAdenaPerKill;
        group.avgHits += entry.hits;
        group.avgSecondsPerKill += entry.physical?.secondsPerKill ?? 0;
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
        avgSecondsPerKill: group.monsterCount ? group.avgSecondsPerKill / group.monsterCount : 0,
      }))
      .sort((a, b) => b.avgNetAdenaPerKill - a.avgNetAdenaPerKill)
      .slice(0, 16);
  }, [suggestedMonsters]);

  const hitsPerKill = currentStats?.hits ?? 0;
  const isPhysical = classType === 'physical';
  const defenseLabel = isPhysical ? 'P.Def' : 'M.Def';
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
      const next = [...prev, {id, name: monster.name, rate: 0}];
      if (next.length === 0) return next;
      const baseShare = Number((100 / next.length).toFixed(3));
      let remaining = 100;
      return next.map((entry, index) => {
        const isLast = index === next.length - 1;
        const rate = isLast ? Number(remaining.toFixed(3)) : baseShare;
        remaining = Math.max(0, remaining - rate);
        return {...entry, rate};
      });
    });
  }, []);

  const totalRate = active.reduce((acc, curr) => acc + curr.rate, 0);

  const activeDetails = useMemo<ActiveEntryDetails[]>(() => {
    return active
      .map((entry) => {
        const monster = monstersById[entry.id];
        if (!monster) return null;
        return {
          ...entry,
          monster,
          stats: calculate(monster),
          drops: resolveDrops(monster),
        };
      })
      .filter((entry): entry is ActiveEntryDetails => Boolean(entry));
  }, [active, monstersById, calculate, resolveDrops]);

  const activeDetailsMap = useMemo(() => {
    const map: Record<number, ActiveEntryDetails> = {};
    for (const detail of activeDetails) {
      map[detail.id] = detail;
    }
    return map;
  }, [activeDetails]);

  const setAggregates = useMemo(() => {
    if (activeDetails.length === 0) return null;
    let adenaPerKill = 0;
    let shotCostPerKill = 0;
    let secondsPerKill = 0;
    const itemExpectedPerKill: Record<number, {name: string; expectedQty: number; isHerb: boolean}> = {};

    for (const entry of activeDetails) {
      const weight = entry.rate / 100;
      const stats = entry.stats;
      const drops = entry.drops;
      adenaPerKill += stats.adena * weight;
      shotCostPerKill += stats.shotCostPerKill * weight;
      secondsPerKill += (stats.physical?.secondsPerKill ?? 0) * weight;
      for (const drop of drops) {
        if (drop.spoil > 0) continue;
        const avgQty = (drop.min + drop.max) / 2;
        const expected = drop.chance * avgQty * weight;
        if (expected <= 0) continue;
        if (!itemExpectedPerKill[drop.itemId]) {
          itemExpectedPerKill[drop.itemId] = {name: drop.name, expectedQty: 0, isHerb: isHerbItem(drop.itemId)};
        }
        itemExpectedPerKill[drop.itemId].expectedQty += expected;
      }
    }

    const safeTotal = Number.isFinite(totalMonsters) ? Math.max(0, totalMonsters) : 0;
    const grossAdenaForSet = adenaPerKill * safeTotal;
    const shotCostForSet = shotCostPerKill * safeTotal;
    const netAdenaPerKill = adenaPerKill - shotCostPerKill;
    const netAdenaForSet = netAdenaPerKill * safeTotal;

    const dropsList = Object.entries(itemExpectedPerKill)
      .filter(([id]) => Number(id) !== ADENA_ITEM_ID)
      .map(([id, value]) => ({
        id: Number(id),
        name: value.name,
        qtyPerKill: value.expectedQty,
        qtyForSet: value.expectedQty * safeTotal,
        isHerb: value.isHerb,
      }));

    const normalDrops = dropsList
      .filter((drop) => !drop.isHerb)
      .sort((a, b) => b.qtyPerKill - a.qtyPerKill);
    const herbDrops = dropsList
      .filter((drop) => drop.isHerb)
      .sort((a, b) => b.qtyPerKill - a.qtyPerKill);

    return {
      adenaPerKill,
      shotCostPerKill,
      netAdenaPerKill,
      grossAdenaForSet,
      shotCostForSet,
      netAdenaForSet,
      secondsPerKill,
      secondsForSet: secondsPerKill * safeTotal,
      normalDrops,
      herbDrops,
    };
  }, [activeDetails, totalMonsters, isHerbItem]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-neutral-100 dark:from-black dark:to-neutral-950 text-neutral-900 dark:text-neutral-100">
      <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
        <header className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">L2Reborn Farm Helper</h1>
            <div className="text-xs text-neutral-500">created by <b>Warchild</b> (L2Reborn Legacy) • shadcn/ui • Next.js</div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Select value={chronicle.id} onValueChange={(value: ChronicleId) => handleChronicleChange(value)}>
              <SelectTrigger className="w-56" aria-label="Chronicle">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHRONICLE_IDS.map((id) => (
                  <SelectItem key={id} value={id}>{CHRONICLES[id].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Tabs value={classType} onValueChange={(value) => setClassType(value as ClassType)}>
              <TabsList aria-label="Class type">
                <TabsTrigger value="magical">Magical</TabsTrigger>
                <TabsTrigger value="physical">Physical</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
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
                {isPhysical ? (
                  <div className="text-xs text-amber-700 dark:text-amber-400">
                    Physical results are averages for auto-attacks from the front, using L2J Mobius rules. They haven&apos;t been checked in-game yet.
                  </div>
                ) : !chronicle.damageVerified && (
                  <div className="text-xs text-amber-700 dark:text-amber-400">
                    Damage for {chronicle.label} uses the C5 formula and hasn&apos;t been checked in-game yet.
                  </div>
                )}
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {isPhysical ? (
                    <>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="patk">P. Atk</Label>
                        <Input id="patk" type="number" value={patk} onChange={(e) => setPatk(toNum(e.target.value, 0))} />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="atkSpeed">Atk. Speed</Label>
                        <Input id="atkSpeed" type="number" value={atkSpeed} onChange={(e) => setAtkSpeed(toNum(e.target.value, 0))} />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="accuracy">Accuracy</Label>
                        <Input id="accuracy" type="number" value={accuracy} onChange={(e) => setAccuracy(toNum(e.target.value, 0))} />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="critical">Critical</Label>
                        <Input id="critical" type="number" min={0} value={critical} onChange={(e) => setCritical(Math.max(0, toNum(e.target.value, 0)))} />
                        <div className="text-xs text-neutral-500">From the status window: 44 is 4.4%.</div>
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="critMultiplier">Crit damage (x)</Label>
                        <Input
                          id="critMultiplier"
                          type="number"
                          min={1}
                          step={0.1}
                          value={critMultiplier}
                          onChange={(e) => setCritMultiplier(Math.max(1, toNum(e.target.value, 2)))}
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label>Weapon</Label>
                        <Select value={weapon} onValueChange={(value: Weapon) => setWeapon(value)}>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select weapon" />
                          </SelectTrigger>
                          <SelectContent>
                            {WEAPONS.map((value) => (
                              <SelectItem key={value} value={value}>{WEAPON_LABELS[value]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox id="soulshot" checked={soulshot} onCheckedChange={(checked) => setSoulshot(checked === true)} />
                        <Label htmlFor="soulshot" className="text-sm">Soulshots</Label>
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="soulshotPrice">Soulshot price</Label>
                        <Input id="soulshotPrice" type="number" min={0} value={soulshotPrice} onChange={(e) => setSoulshotPrice(Math.max(0, toNum(e.target.value, 0)))} />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="shotsPerAttack">Shots per attack</Label>
                        <Input id="shotsPerAttack" type="number" min={1} value={shotsPerAttack} onChange={(e) => setShotsPerAttack(Math.max(1, toNum(e.target.value, 1)))} />
                        <div className="text-xs text-neutral-500">Depends on the weapon. A full miss uses none.</div>
                      </div>
                      {weapon === 'bow' && (
                        <>
                          <div className="flex flex-col gap-2">
                            <Label htmlFor="arrowPrice">Arrow price</Label>
                            <Input id="arrowPrice" type="number" min={0} value={arrowPrice} onChange={(e) => setArrowPrice(Math.max(0, toNum(e.target.value, 0)))} />
                          </div>
                          <div className="flex flex-col gap-2">
                            <Label htmlFor="bowReuse">Bow reuse (ms)</Label>
                            <Input id="bowReuse" type="number" min={0} value={bowReuse} onChange={(e) => setBowReuse(Math.max(0, toNum(e.target.value, 0)))} />
                            <div className="text-xs text-neutral-500">1500 for most bows, 820 for fast ones.</div>
                          </div>
                        </>
                      )}
                    </>
                  ) : (
                    <>
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
                        <Select value={element} onValueChange={(value: Element) => setElement(value)}>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select element" />
                          </SelectTrigger>
                          <SelectContent>
                            {chronicle.elements.map((value) => (
                              <SelectItem key={value} value={value}>{ELEMENT_LABELS[value]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  )}
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="damageMultiplier">Damage multiplier (%)</Label>
                    <Input
                      id="damageMultiplier"
                      type="number"
                      min={20}
                      max={180}
                      value={damageMultiplier}
                      onChange={(e) =>
                        setDamageMultiplier(clamp(toNum(e.target.value, 100), 20, 180))
                      }
                    />
                    <div className="text-xs text-neutral-500">Applies to final damage (20-180%).</div>
                  </div>
                  {!isPhysical && (
                    <>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="ssPrice">SS price per hit</Label>
                        <Input id="ssPrice" type="number" value={ssPrice} onChange={(e) => setSsPrice(toNum(e.target.value, 0))} />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="bssPrice">BSS price per hit</Label>
                        <Input id="bssPrice" type="number" value={bssPrice} onChange={(e) => setBssPrice(toNum(e.target.value, 0))} />
                      </div>
                    </>
                  )}
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="remainingHp">Remaining monster HP</Label>
                    <Input
                      id="remainingHp"
                      type="number"
                      min={0}
                      value={remainingMonsterHp}
                      onChange={(e) => setRemainingMonsterHp(Math.max(0, toNum(e.target.value, 0)))}
                    />
                    <div className="text-xs text-neutral-500">Allowed HP left after hits.</div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="expRate">EXP rate</Label>
                    <Input id="expRate" type="number" min={0} value={expRate} onChange={(e) => setExpRate(Math.max(0, toNum(e.target.value, 0)))} />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="spRate">SP rate</Label>
                    <Input id="spRate" type="number" min={0} value={spRate} onChange={(e) => setSpRate(Math.max(0, toNum(e.target.value, 0)))} />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="adenaRate">Adena rate</Label>
                    <Input id="adenaRate" type="number" min={0} value={adenaRate} onChange={(e) => setAdenaRate(Math.max(0, toNum(e.target.value, 0)))} />
                    <div className="text-xs text-neutral-500">Server rates. Data is stored at x1.</div>
                  </div>
                </div>
                <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="maxHits">Max hits</Label>
                    <Input
                      id="maxHits"
                      type="number"
                      value={maxHits}
                      onChange={(e) => (isPhysical ? setPhysicalMaxHits : setSuggestedMaxHits)(toNum(e.target.value, 1))}
                    />
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
                    <Checkbox
                      id="herbs"
                      disabled={!chronicle.hasHerbs}
                      checked={chronicle.hasHerbs && suggestedHerbs}
                      onCheckedChange={(checked) => setSuggestedHerbs(checked === true)}
                    />
                    <Label htmlFor="herbs" className="text-sm">
                      Only show herb drop monsters{!chronicle.hasHerbs && ' (no herbs in this chronicle)'}
                    </Label>
                  </div>
                  <div className="flex items-center gap-2 md:col-span-2">
                    <Checkbox id="undeadOnly" checked={undeadOnly} onCheckedChange={(checked) => setUndeadOnly(checked === true)} />
                    <Label htmlFor="undeadOnly" className="text-sm">Undead only</Label>
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
                        <div className="text-xs text-neutral-500">{eligibleMonsters.length.toLocaleString()} NPCs • {locations.length.toLocaleString()} locations</div>
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
                                    <span className="flex items-center gap-2">
                                      {entry.type === 'monster' ? entry.monster.name : entry.location.name}
                                    </span>
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
                          (() => {
                            const alreadyActive = active.some((entry) => entry.id === selectedNpc.npc_id);
                            return (
                              <button
                                onClick={() => addMonsterToSet(selectedNpc)}
                                disabled={alreadyActive}
                                className="text-xs rounded-md border border-black/10 dark:border-white/10 px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50"
                                type="button"
                              >
                                {alreadyActive ? 'Added' : 'Add to active set'}
                              </button>
                            );
                          })()
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
                                      <div className="text-sm font-semibold flex items-center gap-2">
                                        {entry.monster.name}
                                        <WikiLink base={chronicle.wikiBaseUrl} id={entry.monster.npc_id} />
                                      </div>
                                      <div className="text-xs text-neutral-500">
                                        Level {entry.monster.level || '-'} • ID {entry.monster.npc_id}
                                      </div>
                                    </div>
                                    <div className="text-right">
                                      <div className="text-xs text-neutral-500">Hits</div>
                                      <div className="text-sm font-medium">{formatHits(entry.hits)}</div>
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
                                      <div className="text-neutral-500">{defenseLabel}</div>
                                      <div className="text-sm font-medium">{entry.defense.toLocaleString()}</div>
                                    </div>
                                    <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-2">
                                      <div className="text-neutral-500">Damage</div>
                                      <div className="text-sm font-medium">{entry.dmg.toFixed(0)}</div>
                                    </div>
                                    {!entry.physical && (
                                      <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-2">
                                        <div className="text-neutral-500">HP left after hits</div>
                                        <div className="text-sm font-medium">{entry.remainingHp.toFixed(0)}</div>
                                      </div>
                                    )}
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
                                    {entry.physical && <PhysicalTiles stats={entry.physical} padding="p-2" />}
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
                                <WikiLink base={chronicle.wikiBaseUrl} id={selectedNpc.npc_id} />
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
                              <div className="text-xs text-neutral-500">{defenseLabel}</div>
                              <div className="font-medium">{currentStats.defense.toLocaleString()}</div>
                            </div>
                            <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-3">
                              <div className="text-xs text-neutral-500">Damage</div>
                              <div className="font-medium">{currentStats.dmg.toFixed(0)}</div>
                            </div>
                            <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-3">
                              <div className="text-xs text-neutral-500">Hits to kill</div>
                              <div className="font-medium">{formatHits(hitsPerKill)}</div>
                            </div>
                            {!currentStats.physical && (
                              <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-3">
                                <div className="text-xs text-neutral-500">HP left after hits</div>
                                <div className="font-medium">{currentStats.remainingHp.toFixed(0)}</div>
                              </div>
                            )}
                            <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-3">
                              <div className="text-xs text-neutral-500">Exp</div>
                              <div className="font-medium">{currentStats.exp.toLocaleString()}</div>
                            </div>
                            <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-3">
                              <div className="text-xs text-neutral-500">SP</div>
                              <div className="font-medium">{Math.round(selectedNpc.acquire_sp * spRate).toLocaleString()}</div>
                            </div>
                            {currentStats.physical && <PhysicalTiles stats={currentStats.physical} padding="p-3" />}
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
                                  .map((drop, index) => {
                                    const isValuable = drop.itemType === 'weapon' || drop.itemType === 'armor';
                                    return (
                                      <div
                                        key={`${drop.itemId}-${index}`}
                                        className="px-3 py-2 flex items-center justify-between text-sm"
                                      >
                                        <div>
                                          <div className={isValuable ? 'font-semibold' : 'font-medium'}>{drop.name}</div>
                                          <div className="text-xs text-neutral-500">
                                            Qty {drop.min}-{drop.max} {drop.spoil ? '• Spoil' : ''}
                                          </div>
                                        </div>
                                        <div className="text-xs text-neutral-600 dark:text-neutral-300">
                                          {(drop.chance * 100).toFixed(3)}%
                                        </div>
                                      </div>
                                    );
                                  })
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
                                <div className="text-sm font-semibold flex items-center gap-2">
                                  {entry.monster.name}
                                  <WikiLink base={chronicle.wikiBaseUrl} id={entry.monster.npc_id} />
                                </div>
                                <div className="text-xs text-neutral-500">Level {entry.monster.level || '-'} • Hits {formatHits(entry.hits)}</div>
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
                            <div className={`grid gap-2 text-xs ${isPhysical ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2'}`}>
                              <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-2">
                                <div className="text-neutral-500">HP</div>
                                <div className="text-sm font-medium">{entry.hp.toLocaleString()}</div>
                              </div>
                              <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-2">
                                <div className="text-neutral-500">{defenseLabel}</div>
                                <div className="text-sm font-medium">{entry.defense.toLocaleString()}</div>
                              </div>
                              <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-2">
                                <div className="text-neutral-500">Adena/Hit</div>
                                <div className="text-sm font-medium">{entry.adenaPerHit.toFixed(2)}</div>
                              </div>
                              <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-2">
                                <div className="text-neutral-500">Shot cost</div>
                                <div className="text-sm font-medium">{entry.shotCostPerKill.toFixed(1)}</div>
                              </div>
                              {entry.physical && <PhysicalTiles stats={entry.physical} padding="p-2" />}
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
                                {isPhysical && (
                                  <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-2">
                                    <div className="text-neutral-500">Avg seconds/kill</div>
                                    <div className="text-sm font-medium">{formatSeconds(location.avgSecondsPerKill)}</div>
                                  </div>
                                )}
                                <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-2">
                                  <div className="text-neutral-500">Avg Adena/Hit</div>
                                  <div className="text-sm font-medium">{location.avgAdenaPerHit.toFixed(2)}</div>
                                </div>
                                <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-2">
                                  <div className="text-neutral-500">Top monster</div>
                                  <div className="text-sm font-medium flex items-center gap-2">
                                    {bestMonster ? (
                                      <>
                                        {bestMonster.monster.name}
                                        <WikiLink base={chronicle.wikiBaseUrl} id={bestMonster.monster.npc_id} />
                                      </>
                                    ) : (
                                      '–'
                                    )}
                                  </div>
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
                                    <div className="font-medium flex items-center gap-2">
                                      {entry.monster.name}
                                      <WikiLink base={chronicle.wikiBaseUrl} id={entry.monster.npc_id} />
                                    </div>
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
                              {active.map((entry) => {
                                const details = activeDetailsMap[entry.id];
                                return (
                                  <div key={entry.id} className="flex flex-wrap items-center gap-2">
                                    <div className="flex-1 min-w-0">
                                      <div className="truncate font-medium flex items-center gap-2" title={entry.name}>
                                        <span className="truncate">{entry.name}</span>
                                        <WikiLink base={chronicle.wikiBaseUrl} id={entry.id} />
                                      </div>
                                      {details ? (
                                        <div className="text-xs text-neutral-500 truncate">
                                          Level {details.monster.level || '-'} • Exp {details.stats.exp.toLocaleString()} • Adena{' '}
                                      {details.stats.adena.toFixed(1)}
                                    </div>
                                  ) : (
                                    <div className="text-xs text-neutral-500">Loading stats…</div>
                                  )}
                                </div>
                                <div className="flex items-center gap-1">
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
                                </div>
                                <button
                                  onClick={() => setActive((prev) => prev.filter((p) => p.id !== entry.id))}
                                  className="text-xs rounded-md border border-black/10 dark:border-white/10 px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                                >
                                  Remove
                                </button>
                              </div>
                            );
                          })}
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
                          {isPhysical && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-3">
                                <div className="text-xs text-neutral-500">Seconds per monster</div>
                                <div className="font-medium">{formatSeconds(setAggregates.secondsPerKill)}</div>
                              </div>
                              <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-3">
                                <div className="text-xs text-neutral-500">Attack time for set</div>
                                <div className="font-medium">{(setAggregates.secondsForSet / 60).toFixed(1)} min</div>
                              </div>
                            </div>
                          )}
                          <div className="space-y-4">
                            <div>
                              <div className="text-xs font-medium mb-1">Drops for set — expected quantities</div>
                              <div className="space-y-1 max-h-64 overflow-auto">
                                {setAggregates.normalDrops.length === 0 ? (
                                  <div className="text-xs text-neutral-500">No normal drops</div>
                                ) : (
                                  setAggregates.normalDrops.map((item) => {
                                    const meta = itemsById[item.id];
                                    const isValuable = meta?.item_type === 'weapon' || meta?.item_type === 'armor';
                                    return (
                                      <div key={item.id} className="flex items-center gap-2">
                                        <div
                                          className={`${isValuable ? 'font-semibold' : 'font-medium'} flex-1 truncate`}
                                          title={item.name}
                                        >
                                          {item.name}
                                        </div>
                                        <div className="w-40 text-right text-xs" title={`${item.qtyForSet.toFixed(3)} total`}>
                                          {item.qtyForSet.toFixed(3)} qty
                                        </div>
                                      </div>
                                    );
                                  })
                                )}
                              </div>
                            </div>
                            <div>
                              <div className="text-xs font-medium mb-1">Herb drops — expected quantities</div>
                              <div className="space-y-1 max-h-64 overflow-auto">
                                {setAggregates.herbDrops.length === 0 ? (
                                  <div className="text-xs text-neutral-500">No herb drops</div>
                                ) : (
                                  setAggregates.herbDrops.map((item) => (
                                    <div key={item.id} className="flex items-center gap-2 text-xs">
                                      <div className="flex-1 truncate" title={item.name}>
                                        {item.name}
                                      </div>
                                      <div className="w-40 text-right" title={`${item.qtyForSet.toFixed(3)} total`}>
                                        {item.qtyForSet.toFixed(3)} qty
                                      </div>
                                    </div>
                                  ))
                                )}
                              </div>
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
