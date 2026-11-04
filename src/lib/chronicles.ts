import {useSyncExternalStore} from 'react';

export type ChronicleId = 'c1' | 'c2' | 'c5';

export type Element = 'none' | 'fire' | 'water' | 'wind' | 'earth' | 'holy' | 'dark';

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
  // Monster traits are skills, and the IDs differ per chronicle. In C1 and C2 one
  // skill can be both a resistance and a weakness.
  weaknessSkills: Partial<Record<Element, number[]>>;
  resistSkills: Partial<Record<Element, number[]>>;
  magicDamage: (input: MagicDamageInput) => number;
  // False until the formula has been checked against in-game hits.
  damageVerified: boolean;
};

function c5MagicDamage({matk, shotMultiplier, skillPower, mdef}: MagicDamageInput): number {
  return 92 * Math.sqrt(Math.max(0, matk) * shotMultiplier) * Math.max(0, skillPower) / Math.max(1, mdef);
}

const EARLY_CHRONICLE = {
  hasHerbs: false,
  elements: ['none', 'fire', 'water', 'wind', 'earth'] as Element[],
  // 4013: resists Fire, weak to Water. 4014: resists Water, weak to Fire.
  // 4015: resists Wind, weak to Earth. 4102: weak to Fire.
  weaknessSkills: {water: [4013], fire: [4014, 4102], earth: [4015]},
  resistSkills: {fire: [4013], water: [4014], wind: [4015]},
  magicDamage: c5MagicDamage,
  damageVerified: false,
};

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
    weaknessSkills: {holy: [4275], fire: [4279], water: [4280], wind: [4281], earth: [4282], dark: [4336]},
    resistSkills: {fire: [4009], water: [4010], wind: [4011], earth: [4012], dark: [4333]},
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
