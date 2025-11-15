type Skill = {
  skill_id: number;
  name: string;
  levle: string;
}

type MonsterSkill = {
  skill_id: number;
  level: number;
}

type Location = {
  id: number;
  name: string;
}

type Item = {
  item_id: number;
  name: string;
}

type ItemDrop = {
  item_id: number;
  min: number;
  max: number;
  chance: number;
  spoil: number;
}

// type Monster = {
//   npc_id: string;
//   name: string;
//   level: string;
//   skills: MonsterSkill[];
//   locations: Location[];
//   items: ItemDrop[];
// }

type Monster = {
  npc_id: number;
  name: string;
  level: number;

  // core stats
  str: number;
  int: number;
  dex: number;
  wit: number;
  con: number;
  men: number;

  // base game stats
  base_physical_attack: number;
  base_defend: number;
  base_magic_defend: number;
  base_magic_attack: number;
  base_attack_speed: number;
  base_critical: number;

  physical_hit_modify: number;

  ground_low: string;
  ground_high: string;

  acquire_exp_rate: number;
  skills: MonsterSkill[];
  locations: Location[];
  items: ItemDrop[];
}

export type {Skill, MonsterSkill, Location, Item, ItemDrop, Monster}