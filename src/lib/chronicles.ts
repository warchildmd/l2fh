import {useSyncExternalStore} from 'react';

export type ChronicleId = 'c1' | 'c2' | 'c5';

export type Element = 'none' | 'fire' | 'water' | 'wind' | 'earth' | 'holy' | 'dark';

export type Weapon = 'sword' | 'blunt' | 'dagger' | 'pole' | 'bow' | 'dual' | 'fist';

export type MagicDamageInput = {
  matk: number;
  shotMultiplier: number;
  skillPower: number;
  mdef: number;
};

export type Chronicle = {
  id: ChronicleId;
  label: string;
  dataPath: string;
  wikiBaseUrl: string;
  hasHerbs: boolean;
  elements: Element[];
  // Monster traits are skills, and the IDs differ per chronicle. For each element,
  // the damage multiplier a monster's skill applies. Several skills multiply.
  elementSkills: Partial<Record<Element, Record<number, number>>>;
  // M.Def multipliers from skills, on top of the monster's M.Def.
  mDefSkills: Record<number, number>;
  // Weapon traits as the wiki states them, one value per skill level: negative is a
  // weakness, positive a resistance. A single value applies to every level.
  weaponTraits: Partial<Record<Weapon, Record<number, number[]>>>;
  // P.Def multipliers from passive skills, one per skill level, on top of the monster's
  // P.Def. Active buffs such as 4029 are left out, because they aren't always up.
  pDefSkills: Record<number, number[]>;
  magicDamage: (input: MagicDamageInput) => number;
  // False until the formula has been checked against in-game hits.
  damageVerified: boolean;
};

function c5MagicDamage({matk, shotMultiplier, skillPower, mdef}: MagicDamageInput): number {
  return 92 * Math.sqrt(Math.max(0, matk) * shotMultiplier) * Math.max(0, skillPower) / Math.max(1, mdef);
}

const EARLY_CHRONICLE = {
  hasHerbs: false,
  elements: ['none', 'fire', 'water', 'wind', 'earth', 'holy'] as Element[],
  // From the skill tooltips on lineage2wiki.org's C1 monster pages. They state
  // resistance, so +50% is taken as x0.5 damage and -15% as x1.15.
  elementSkills: {
    fire: {4006: 1.15, 4008: 1.15, 4013: 0.5, 4014: 1.15, 4021: 1.5, 4062: 2},
    water: {4013: 1.15, 4014: 0.5},
    wind: {4005: 1.15, 4015: 0.5, 4122: 1.5},
    earth: {4015: 1.15, 4122: 0.05},
    holy: {4007: 1.2},
  },
  mDefSkills: {4116: 1.2},
  // Same tooltips. 4003 Golem Body, 4004 Fragile Skull, 4005 Floating Target.
  weaponTraits: {
    bow: {4003: [70], 4005: [-10], 4021: [80], 4062: [80], 4071: [50]},
    dagger: {4003: [30]},
    blunt: {4003: [-10], 4004: [-10]},
  },
  pDefSkills: {4084: [1.2]},
  magicDamage: c5MagicDamage,
  damageVerified: false,
};

const STRONG_WEAKNESS = [-11, -25, -43, -67, -100];
const STRONG_RESISTANCE = [15, 30, 50, 70, 90];

export const CHRONICLES: Record<ChronicleId, Chronicle> = {
  c1: {
    ...EARLY_CHRONICLE,
    id: 'c1',
    label: 'C1: Harbingers of War',
    dataPath: '/c1',
    wikiBaseUrl: 'https://lineage2wiki.org/c1/monster',
  },
  c2: {
    ...EARLY_CHRONICLE,
    id: 'c2',
    label: 'C2: Age of Splendor',
    dataPath: '/c2',
    wikiBaseUrl: 'https://lineage2wiki.org/c2/monster',
  },
  c5: {
    id: 'c5',
    label: 'C5: Oath of Blood',
    dataPath: '/c5',
    wikiBaseUrl: 'https://lineage2wiki.org/c5/monster',
    hasHerbs: true,
    elements: ['none', 'fire', 'water', 'wind', 'earth', 'holy', 'dark'],
    // Tested in-game. The wiki has no percentages for these in C5.
    elementSkills: {
      fire: {4279: 1.11, 4009: 0.9},
      water: {4280: 1.11, 4010: 0.9},
      wind: {4281: 1.11, 4011: 0.9},
      earth: {4282: 1.11, 4012: 0.9},
      holy: {4275: 1.11},
      dark: {4336: 1.11, 4333: 0.9},
    },
    mDefSkills: {},
    // From the skill pages on lineage2wiki.org. Dual swords have no trait skills.
    weaponTraits: {
      sword: {4460: STRONG_WEAKNESS},
      blunt: {4274: [-11, -15, -20, -30, -50]},
      dagger: {4461: STRONG_WEAKNESS, 4273: STRONG_RESISTANCE},
      pole: {4458: STRONG_WEAKNESS, 4379: STRONG_RESISTANCE},
      bow: {4276: [-10, -15, -20, -30, -50], 4071: [5, 10, 20, 30, 40], 4444: [60, 70, 80, 90, 100]},
      fist: {4457: STRONG_WEAKNESS},
    },
    pDefSkills: {
      4412: [0.39, 0.43, 0.47, 0.52, 0.57, 0.63, 0.69, 0.76, 0.83, 0.91, 1, 1.1, 1.21, 1.33, 1.46, 1.61, 1.77, 1.94, 2.14, 2.35, 2.59, 10],
    },
    magicDamage: c5MagicDamage,
    damageVerified: true,
  },
};

export const CHRONICLE_IDS: ChronicleId[] = ['c1', 'c2', 'c5'];

export const DEFAULT_CHRONICLE: ChronicleId = 'c1';

const STORAGE_KEY = 'l2fh.chronicle';

// Kept in memory too, so switching still works when localStorage is blocked.
let currentChoice: ChronicleId | null = null;
const listeners = new Set<() => void>();

function isChronicleId(value: unknown): value is ChronicleId {
  return typeof value === 'string' && value in CHRONICLES;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ChronicleId {
  if (currentChoice) return currentChoice;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isChronicleId(stored)) return stored;
  } catch {
    // Storage can be unavailable, for example in a private window.
  }
  return DEFAULT_CHRONICLE;
}

function getServerSnapshot(): null {
  return null;
}

export function chooseChronicle(id: ChronicleId) {
  currentChoice = id;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // The choice still applies until the page is reloaded.
  }
  for (const listener of listeners) listener();
}

// Null during server rendering, where the saved choice isn't known yet.
export function useChronicleId(): ChronicleId | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
