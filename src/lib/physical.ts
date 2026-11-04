// Physical auto-attack model. The wiki has no combat rules, so these come from L2J Mobius
// (Formulas.java and Creature.java), whose C1 and C4 branches agree on all of them.

import type {Monster, MonsterSkill} from '@/app/types';
import type {Chronicle, Weapon} from '@/lib/chronicles';
import {calcPdef} from '@/lib/formulas';

const DAMAGE_CONSTANT = 76;
const SOULSHOT_MULTIPLIER = 2;
const MAX_CRITICAL = 500;
const MIN_HIT_CHANCE = 20;
const MAX_HIT_CHANCE = 98;
const MELEE_ATTACK_TIME = 500000;
const BOW_REUSE_FACTOR = 333;
const EVASION_SKILL = 4093;
const EVASION_SKILL_BONUS = 4;
// Above this many hits a kill is long enough for the average to grow linearly.
const EXACT_HITS_LIMIT = 512;

export const WEAPONS: Weapon[] = ['sword', 'blunt', 'dagger', 'pole', 'bow', 'dual', 'fist'];

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function valueAtLevel(values: number[], level: number): number {
  return values[clamp(level - 1, 0, values.length - 1)];
}

export function monsterPdef(chronicle: Chronicle, monster: Monster): number {
  const base = monster.pdef ?? calcPdef(monster);
  const multiplier = (monster.skills ?? []).reduce((total, skill) => {
    const values = chronicle.pDefSkills[skill.skill_id];
    return values ? total * valueAtLevel(values, skill.level) : total;
  }, 1);
  return Math.round(base * multiplier);
}

// The wiki shows 34 for nearly every monster: its calcEvasion passes the level modifier
// (about 1) where the level belongs, and calcEvasion in formulas.tsx copies that.
export function monsterEvasion(monster: Monster): number {
  const highLevelBonus = monster.level > 69 ? monster.level - 69 + 2 : 0;
  const skillBonus = (monster.skills ?? []).some((skill) => skill.skill_id === EVASION_SKILL) ? EVASION_SKILL_BONUS : 0;
  return Math.round(Math.sqrt(monster.dex) * 6 + monster.level + highLevelBonus + skillBonus);
}

export function hitChance(accuracy: number, evasion: number): number {
  return clamp(80 + 2 * (accuracy - evasion), MIN_HIT_CHANCE, MAX_HIT_CHANCE) / 100;
}

// Critical is the status window value: 44 is a 4.4% chance.
export function critChance(critical: number): number {
  return clamp(critical, 0, MAX_CRITICAL) / 1000;
}

export function physicalDamage(patk: number, soulshot: boolean, pdef: number): number {
  return (DAMAGE_CONSTANT * Math.max(0, patk) * (soulshot ? SOULSHOT_MULTIPLIER : 1)) / Math.max(1, pdef);
}

export function weaponMultiplier(chronicle: Chronicle, weapon: Weapon, skills: MonsterSkill[]): number {
  const traits = chronicle.weaponTraits[weapon] ?? {};
  const defence = skills.reduce((total, skill) => {
    const values = traits[skill.skill_id];
    return values ? total * (1 + valueAtLevel(values, skill.level) / 100) : total;
  }, 1);
  return clamp(2 - defence, 0.05, 2);
}

// Dual swords and fists land two half-damage hits per attack, each rolling miss and crit.
export function hitsPerAttack(weapon: Weapon): number {
  return weapon === 'dual' || weapon === 'fist' ? 2 : 1;
}

export function attackIntervalMs(weapon: Weapon, atkSpeed: number, bowReuse: number): number {
  if (atkSpeed <= 0) return Infinity;
  const reuse = weapon === 'bow' ? Math.max(0, bowReuse) * BOW_REUSE_FACTOR : 0;
  return (MELEE_ATTACK_TIME + reuse) / atkSpeed;
}

function interpolated(table: Float64Array, position: number): number {
  if (position <= 0) return 0;
  const below = Math.floor(position);
  const fraction = position - below;
  return fraction === 0 ? table[below] : table[below] + fraction * (table[below + 1] - table[below]);
}

// Returns a function giving the average attacks for a kill that takes normalHits normal
// hits, where a crit counts as critMultiplier of them. Exact up to EXACT_HITS_LIMIT.
export function createAttackEstimator(
  critRate: number,
  critMultiplier: number,
): (normalHits: number, hitRate: number, hitsInAttack: number) => number {
  const crit = clamp(critRate, 0, 1);
  const power = Math.max(1, critMultiplier);
  const damagePerHit = 1 - crit + crit * power;

  // Average hits that must land. Misses only stretch this, so for one hit per attack
  // dividing by the hit chance gives the attacks.
  const landed = new Float64Array(EXACT_HITS_LIMIT + 1);
  for (let hits = 1; hits <= EXACT_HITS_LIMIT; hits += 1) {
    landed[hits] = 1 + (1 - crit) * landed[hits - 1] + crit * interpolated(landed, hits - power);
  }

  // With two hits per attack, a first hit that kills wastes the second, so division
  // isn't enough. Each hit chance gets its own table, built on first use.
  const doubleTables = new Map<number, Float64Array>();
  const doubleTable = (hitRate: number) => {
    const cached = doubleTables.get(hitRate);
    if (cached) return cached;
    const table = new Float64Array(EXACT_HITS_LIMIT + 1);
    const miss = 1 - hitRate;
    const normal = hitRate * (1 - crit);
    const critical = hitRate * crit;
    // Attacks left after the second hit, starting that hit from `left`. A miss on both
    // hits stays at the current state, so it's solved for below instead of read here.
    const afterSecondHit = (left: number, skipMiss: boolean) => {
      if (left <= 0) return 0;
      return (
        (skipMiss ? 0 : miss * interpolated(table, left)) +
        normal * interpolated(table, left - 1) +
        critical * interpolated(table, left - power)
      );
    };
    for (let hits = 1; hits <= EXACT_HITS_LIMIT; hits += 1) {
      const rest =
        miss * afterSecondHit(hits, true) + normal * afterSecondHit(hits - 1, false) + critical * afterSecondHit(hits - power, false);
      table[hits] = (1 + rest) / (1 - miss * miss);
    }
    doubleTables.set(hitRate, table);
    return table;
  };

  return (normalHits, hitRate, hitsInAttack) => {
    const exactHits = Math.min(normalHits, EXACT_HITS_LIMIT);
    const exact = hitsInAttack === 2 ? doubleTable(hitRate)[exactHits] : landed[exactHits] / hitRate;
    return exact + (normalHits - exactHits) / (damagePerHit * hitRate * hitsInAttack);
  };
}

// A soulshot is spent only when at least one hit of the attack lands.
export function attacksThatLand(attacks: number, hitRate: number, hits: number): number {
  return attacks * (1 - Math.pow(1 - hitRate, hits));
}
