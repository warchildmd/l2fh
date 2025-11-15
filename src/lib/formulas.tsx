// src/utils/formulas.ts

// ----------------- Constants -----------------

import {Monster, MonsterSkill} from "@/app/types";

export const HP_REGENERATE_PERIOD = 3000;

export const SHIELD_DEFENSE_FAILED = 0;
export const SHIELD_DEFENSE_SUCCEED = 1;
export const SHIELD_DEFENSE_PERFECT_BLOCK = 2;

export const SKILL_REFLECT_FAILED = 0;
export const SKILL_REFLECT_SUCCEED = 1;
export const SKILL_REFLECT_VENGEANCE = 2;

export const MELEE_ATTACK_RANGE = 40;
export const MAX_STAT_VALUE = 100 as const;

// [base, shift]
const STR_COMPUTE: [number, number] = [1.036, 34.845];
const INT_COMPUTE: [number, number] = [1.02, 31.375];
const DEX_COMPUTE: [number, number] = [1.009, 19.36];
const WIT_COMPUTE: [number, number] = [1.05, 20.0];
const CON_COMPUTE: [number, number] = [1.03, 27.632];
const MEN_COMPUTE: [number, number] = [1.01, -0.06];

// ----------------- Helpers to build tables -----------------

function buildBonusTable([base, shift]: [number, number]): number[] {
  const table: number[] = [];
  for (let i = 0; i < MAX_STAT_VALUE; i++) {
    const value = Math.pow(base, i - shift);
    table.push(Math.floor(value * 100 + 0.5) / 100);
  }
  return table;
}

function buildEvasionAccuracyTable(): number[] {
  const table: number[] = [];
  for (let i = 0; i < MAX_STAT_VALUE; i++) {
    table.push(Math.sqrt(i) * 6);
  }
  return table;
}

// ----------------- Precomputed tables -----------------

export const STR_BONUS = buildBonusTable(STR_COMPUTE);
export const MEN_BONUS = buildBonusTable(MEN_COMPUTE);
export const INT_BONUS = buildBonusTable(INT_COMPUTE);
export const CON_BONUS = buildBonusTable(CON_COMPUTE);
export const DEX_BONUS = buildBonusTable(DEX_COMPUTE);
export const WIT_BONUS = buildBonusTable(WIT_COMPUTE);

const HP_RATE_SKILL_IDS: number[] = [
  4303, 4304, 4305, 4306, 4307, 4308, 4309, 4310, 4311, 4408,
];

const STRENGTH_SKILL_IDS: number[] = [
  4009, 4010, 4011, 4012, 4071, 4084, 4116, 4225, 4273, 4277, 4284, 4285, 4287,
  4333, 4337, 4379, 4388, 4389, 4424, 4425, 4426, 4427, 4428, 4429, 4430, 4431,
  4432, 4433, 4434, 4435, 4436, 4437, 4438, 4439, 4440, 4441, 4442, 4443, 4444,
  4445, 4446, 4447, 4448, 4449, 5479, 5598, 5599, 5601, 5663,
];

const WEAKNESS_SKILL_IDS: number[] = [
  4274, 4275, 4276, 4279, 4280, 4281, 4282, 4336, 4450, 4451, 4452, 4453, 4454,
  4455, 4456, 4457, 4458, 4459, 4460, 4461, 4462, 4602, 4603, 4604, 5620, 5664,
  5918,
];

// These were declared but unused in your original mixin.
// Expose them if you plan to use later:
export const BASE_EVASION_ACCURACY = buildEvasionAccuracyTable();

// Optional: sqrt-based variants if you ever need them:
export const SQRT_MEN_BONUS = MEN_BONUS.map((v) => Math.sqrt(v));
export const SQRT_CON_BONUS = CON_BONUS.map((v) => Math.sqrt(v));

// ----------------- Small helpers -----------------

export function getStrBonusFromValue(str: number): number {
  return STR_BONUS[str] ?? STR_BONUS[0];
}

export function getLevelMod(level: number): number {
  return (100.0 - 11 + Number(level)) / 100.0;
}

/**
 * HP regen period – simplified (no Door class in Next.js).
 */
export function getRegeneratePeriod(isDoor: boolean): number {
  return isDoor ? HP_REGENERATE_PERIOD * 100 : HP_REGENERATE_PERIOD;
}

// ----------------- Regen formulas -----------------

/**
 * NOTE: In your original JS there were TWO calcHpRegen functions.
 * In JS the second one overwrites the first, so we keep the 2-arg version.
 */
export function calcHpRegen(conVal: number, levelMod: number): number {
  let init = 1;
  const hpRegenMultiplier = 1;
  const hpRegenBonus = 0;

  init *= levelMod * CON_BONUS[conVal];

  if (init < 1) {
    init = 1;
  }

  return init * hpRegenMultiplier + hpRegenBonus;
}

export function calcMpRegen(init: number, menVal: number, levelMod: number): number {
  const mpRegenMultiplier = 1;
  const mpRegenBonus = 0;

  init *= levelMod * MEN_BONUS[menVal];

  if (init < 1) {
    init = 1;
  }

  return init * mpRegenMultiplier + mpRegenBonus;
}

// ----------------- Max HP/MP / base stat formulas -----------------

export function calcPatkBase(strVal: number, levelMod: number): number {
  return STR_BONUS[strVal] * levelMod;
}

export function calcPdefBase(levelMod: number): number {
  return levelMod;
}

export function calcMpMaxBase(menVal: number): number {
  return MEN_BONUS[menVal];
}

export function calcHpMaxBase(conVal: number): number {
  return CON_BONUS[conVal];
}

export function calcMdefBase(menVal: number, levelMod: number): number {
  return MEN_BONUS[menVal] * levelMod;
}

export function calcMatkBase(intVal: number, levelMod: number): number {
  const intBonus = INT_BONUS[intVal];
  const lvlBonus = levelMod;
  return (lvlBonus * lvlBonus) * (intBonus * intBonus);
}

export function calcPatkSpeedBase(dexVal: number): number {
  return DEX_BONUS[dexVal];
}

export function calcMatkSpeedBase(witVal: number): number {
  return WIT_BONUS[witVal];
}

export function calcPatkCriticalBase(dexVal: number): number {
  return DEX_BONUS[dexVal] * 10;
}

export function calcMoveSpeedBase(dexVal: number): number {
  return DEX_BONUS[dexVal];
}

export function calcEvasionBase(dexVal: number, level: number): number {
  return BASE_EVASION_ACCURACY[dexVal] + level;
}

// ----------------- Monster helpers (using the base formulas) -----------------

export function calcPatk(monster: Monster): number {
  const levelMod = getLevelMod(monster.level) * monster.base_physical_attack;
  return Math.round(calcPatkBase(monster.str, levelMod));
}

export function calcPdef(monster: Monster): number {
  const levelMod = getLevelMod(monster.level) * monster.base_defend;
  return Math.round(calcPdefBase(levelMod));
}

export function calcMdef(monster: Monster): number {
  const levelMod = getLevelMod(monster.level);
  return Math.round(calcMdefBase(monster.men, levelMod) * monster.base_magic_defend);
}

export function calcMatk(monster: Monster): number {
  const levelMod = getLevelMod(monster.level);
  return Math.round(calcMatkBase(monster.int, levelMod) * monster.base_magic_attack);
}

export function calcPatkSpeed(monster: Monster): number {
  return Math.round(calcPatkSpeedBase(monster.dex) * monster.base_attack_speed);
}

export function calcMatkSpeed(monster: Monster): number {
  return Math.round(calcMatkSpeedBase(monster.wit) * 333);
}

export function calcPatkCritical(monster: Monster): number {
  return Math.round(calcPatkCriticalBase(monster.dex) * monster.base_critical);
}

export function calcEvasion(monster: Monster): number {
  // NOTE: your original code passed getLevelMod(level) here, not plain level.
  // I keep the same behavior for fidelity, even though using `monster.level`
  // might make more sense.
  const levelMod = getLevelMod(monster.level);
  return Math.round(calcEvasionBase(monster.dex, levelMod));
}

export function calcAccuracy(monster: Monster): number {
  return Math.round(
    Math.sqrt(monster.dex) * 6.0 +
    Number(monster.level) +
    Number(monster.physical_hit_modify)
  );
}

export function calcWalkSpeed(monster: Monster): number {
  const factor = calcMoveSpeedBase(monster.dex);
  const base = parseFloat(monster.ground_low.split(";")[0] ?? "0");
  return Math.round(factor * base);
}

export function calcRunSpeed(monster: Monster): number {
  const factor = calcMoveSpeedBase(monster.dex);
  const base = parseFloat(monster.ground_high.split(";")[0] ?? "0");
  return Math.round(factor * base);
}

// EXP from monster
export function getMonsterExp(monster: Monster): number {
  return Math.round(monster.acquire_exp_rate * monster.level * monster.level);
}

// HP rate value for a specific hp_rate item (usually a skill)
export function getMonsterHpRateValue(item: MonsterSkill): number {
  const skillId = String(item.skill_id);
  const level = String(item.level);

  switch (skillId) {
    case "4311":
      return 0.5;
    case "4303":
      return 2;
    case "4304":
      return 3;
    case "4305":
      return 4;
    case "4306":
      return 5;
    case "4307":
      return 6;
    case "4308":
      return 6;
    case "4309":
      return 8;
    case "4310":
      return 9;
    case "4408":
      switch (level) {
        case "8":
          return 0.25;
        case "9":
          return 0.5;
        case "10":
          return 2;
        case "11":
          return 3;
        case "12":
          return 4;
        case "13":
          return 5;
        case "14":
          return 6;
        case "15":
          return 7;
        case "16":
          return 8;
        case "17":
          return 9;
        case "18":
          return 10;
        case "19":
          return 11;
        case "20":
          return 12;
        default:
          return -1;
      }
    default:
      return -1;
  }
}

// Find the HP-rate skill on a monster (last one that matches)
export function getMonsterHpRate(monster: Monster): MonsterSkill | null {
  let ret: MonsterSkill | null = null;

  for (const skill of monster.skills ?? []) {
    if (
      HP_RATE_SKILL_IDS.includes(skill.skill_id)
    ) {
      ret = skill;
    }
  }

  return ret;
}

// Strength skills
export function getMonsterStrengths(monster: Monster): MonsterSkill[] {
  const result: MonsterSkill[] = [];

  for (const skill of monster.skills ?? []) {
    if (STRENGTH_SKILL_IDS.includes(skill.skill_id)) {
      result.push(skill);
    }
  }

  return result;
}

// Weakness skills
export function getMonsterWeaknesses(monster: Monster): MonsterSkill[] {
  const result: MonsterSkill[] = [];

  for (const skill of monster.skills ?? []) {
    if (WEAKNESS_SKILL_IDS.includes(skill.skill_id)) {
      result.push(skill);
    }
  }

  return result;
}
