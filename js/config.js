/* =========================================================================
   Stick Empires — configuration, unit/building data tables
   ========================================================================= */
'use strict';

const CFG = {
  TILE: 32,
  MAP_W: 96,
  MAP_H: 96,

  START_RES: { food: 250, wood: 250, gold: 120, stone: 150 },
  MAX_POP: 200,

  CARRY_CAP: 12,
  GATHER_RATE: { food: 0.75, wood: 0.68, gold: 0.6, stone: 0.55 },

  BUILD_RATE: 3.2,        // hp of construction per second per villager
  REPAIR_RATE: 6,

  // How close a villager must be to work on something, measured from the
  // target's edge. A diagonally adjacent tile is ~34px away and crowding
  // pushes workers further out, so these are deliberately forgiving.
  GATHER_REACH: 48,
  BUILD_REACH: 46,
  DROP_REACH: 43,

  EDGE_SCROLL_PX: 18,
  SCROLL_SPEED: 900,      // px/sec

  FOG: true,
  FOG_UPDATE_MS: 180,

  SIM_HZ: 60,
};

const WORLD_W = CFG.MAP_W * CFG.TILE;
const WORLD_H = CFG.MAP_H * CFG.TILE;

/* ---------------------------------------------------------------- ages -- */

const AGES = [
  { name: 'Dark Age',     cost: null },
  { name: 'Feudal Age',   cost: { food: 500 },              needBuildings: 2 },
  { name: 'Castle Age',   cost: { food: 800, gold: 200 },   needBuildings: 2 },
  { name: 'Imperial Age', cost: { food: 1000, gold: 800 },  needBuildings: 2 },
];

/* --------------------------------------------------------------- units -- */
// range is in tiles. speed in tiles/sec. los = line of sight in tiles.

const UNIT_DEFS = {
  villager: {
    name: 'Villager', short: 'Vil', role: 'worker', art: 'villager',
    hp: 45, atk: 4, armor: 0, pierceArmor: 0, range: 0.6, atkSpeed: 2.0,
    speed: 2.7, los: 6, radius: 8,
    cost: { food: 50 }, trainTime: 11,
  },

  /* --- infantry line --- */
  militia: {
    name: 'Militia', short: 'Mil', role: 'melee', art: 'sword', line: 'infantry',
    hp: 45, atk: 5, armor: 0, pierceArmor: 1, range: 0.7, atkSpeed: 2.0,
    speed: 2.6, los: 5, radius: 9,
    cost: { food: 60, gold: 20 }, trainTime: 13,
  },
  manatarms: {
    name: 'Man-at-Arms', short: 'MAA', role: 'melee', art: 'sword', line: 'infantry',
    hp: 60, atk: 7, armor: 1, pierceArmor: 1, range: 0.7, atkSpeed: 2.0,
    speed: 2.6, los: 6, radius: 9,
    cost: { food: 60, gold: 20 }, trainTime: 13,
  },
  longswordsman: {
    name: 'Long Swordsman', short: 'LS', role: 'melee', art: 'sword', line: 'infantry',
    hp: 80, atk: 10, armor: 1, pierceArmor: 1, range: 0.7, atkSpeed: 2.0,
    speed: 2.6, los: 6, radius: 9,
    cost: { food: 60, gold: 20 }, trainTime: 13,
  },
  champion: {
    name: 'Champion', short: 'Chp', role: 'melee', art: 'sword', line: 'infantry',
    hp: 110, atk: 14, armor: 2, pierceArmor: 2, range: 0.7, atkSpeed: 2.0,
    speed: 2.6, los: 6, radius: 9,
    cost: { food: 60, gold: 20 }, trainTime: 13,
  },

  /* --- spear line (bonus vs cavalry) --- */
  spearman: {
    name: 'Spearman', short: 'Spr', role: 'melee', art: 'spear', line: 'spear',
    hp: 50, atk: 4, armor: 0, pierceArmor: 0, range: 0.9, atkSpeed: 2.2,
    speed: 2.6, los: 5, radius: 9,
    cost: { food: 35, wood: 25 }, trainTime: 11,
    bonus: { cavalry: 16 },
  },
  pikeman: {
    name: 'Pikeman', short: 'Pik', role: 'melee', art: 'spear', line: 'spear',
    hp: 60, atk: 5, armor: 0, pierceArmor: 0, range: 0.9, atkSpeed: 2.2,
    speed: 2.6, los: 5, radius: 9,
    cost: { food: 35, wood: 25 }, trainTime: 11,
    bonus: { cavalry: 24 },
  },

  /* --- archer line --- */
  archer: {
    name: 'Archer', short: 'Arc', role: 'ranged', art: 'bow', line: 'archer',
    hp: 32, atk: 4, armor: 0, pierceArmor: 0, range: 4.5, atkSpeed: 2.0,
    speed: 2.8, los: 7, radius: 8, projSpeed: 620,
    cost: { wood: 25, gold: 45 }, trainTime: 15,
  },
  crossbowman: {
    name: 'Crossbowman', short: 'Xbw', role: 'ranged', art: 'bow', line: 'archer',
    hp: 38, atk: 6, armor: 0, pierceArmor: 0, range: 5.2, atkSpeed: 2.0,
    speed: 2.8, los: 8, radius: 8, projSpeed: 660,
    cost: { wood: 25, gold: 45 }, trainTime: 15,
  },
  arbalester: {
    name: 'Arbalester', short: 'Arb', role: 'ranged', art: 'bow', line: 'archer',
    hp: 44, atk: 7, armor: 0, pierceArmor: 1, range: 5.6, atkSpeed: 1.9,
    speed: 2.8, los: 8, radius: 8, projSpeed: 700,
    cost: { wood: 25, gold: 45 }, trainTime: 15,
  },

  /* --- cavalry line --- */
  scout: {
    name: 'Scout Cavalry', short: 'Sct', role: 'cavalry', art: 'horse', line: 'cavalry',
    hp: 55, atk: 5, armor: 0, pierceArmor: 2, range: 0.8, atkSpeed: 2.0,
    speed: 4.4, los: 9, radius: 11,
    cost: { food: 80 }, trainTime: 14,
  },
  knight: {
    name: 'Knight', short: 'Kni', role: 'cavalry', art: 'horse', line: 'cavalry',
    hp: 100, atk: 10, armor: 2, pierceArmor: 2, range: 0.8, atkSpeed: 1.8,
    speed: 3.9, los: 7, radius: 11,
    cost: { food: 60, gold: 75 }, trainTime: 18,
  },
  cavalier: {
    name: 'Cavalier', short: 'Cav', role: 'cavalry', art: 'horse', line: 'cavalry',
    hp: 120, atk: 12, armor: 2, pierceArmor: 2, range: 0.8, atkSpeed: 1.8,
    speed: 3.9, los: 7, radius: 11,
    cost: { food: 60, gold: 75 }, trainTime: 18,
  },
  paladin: {
    name: 'Paladin', short: 'Pal', role: 'cavalry', art: 'horse', line: 'cavalry',
    hp: 160, atk: 14, armor: 3, pierceArmor: 3, range: 0.8, atkSpeed: 1.8,
    speed: 4.0, los: 8, radius: 11,
    cost: { food: 60, gold: 75 }, trainTime: 18,
  },
};

// Which unit of each line is available at each age index (0..3).
const UNIT_LINES = {
  infantry: ['militia', 'manatarms', 'longswordsman', 'champion'],
  spear:    ['spearman', 'spearman', 'pikeman', 'pikeman'],
  archer:   [null, 'archer', 'crossbowman', 'arbalester'],
  cavalry:  [null, 'scout', 'knight', 'paladin'],
};

function unitForLine(line, age) {
  const arr = UNIT_LINES[line];
  if (!arr) return null;
  return arr[Math.min(age, arr.length - 1)];
}

/* ----------------------------------------------------------- buildings -- */

const BUILDING_DEFS = {
  towncenter: {
    name: 'Town Center', short: 'TC', w: 3, h: 3, hp: 1200, art: 'towncenter',
    cost: { wood: 275, stone: 100 }, buildTime: 40, los: 9, pop: 5, age: 0,
    dropoff: ['food', 'wood', 'gold', 'stone'],
    trains: ['villager'], canAge: true, armor: 3, pierceArmor: 7,
    desc: 'Trains villagers, stores resources, advances ages.',
  },
  house: {
    name: 'House', short: 'Hse', w: 2, h: 2, hp: 550, art: 'house',
    cost: { wood: 25 }, buildTime: 12, los: 4, pop: 5, age: 0,
    armor: 0, pierceArmor: 5,
    desc: 'Supports 5 population.',
  },
  mill: {
    name: 'Mill', short: 'Mil', w: 2, h: 2, hp: 600, art: 'mill',
    cost: { wood: 100 }, buildTime: 20, los: 6, age: 0,
    dropoff: ['food'], armor: 0, pierceArmor: 5,
    desc: 'Drop-off for food. Lets you build farms nearby.',
  },
  lumbercamp: {
    name: 'Lumber Camp', short: 'Lum', w: 2, h: 2, hp: 600, art: 'lumbercamp',
    cost: { wood: 100 }, buildTime: 18, los: 5, age: 0,
    dropoff: ['wood'], armor: 0, pierceArmor: 5,
    desc: 'Drop-off for wood. Build it next to forest.',
  },
  miningcamp: {
    name: 'Mining Camp', short: 'Min', w: 2, h: 2, hp: 600, art: 'miningcamp',
    cost: { wood: 100 }, buildTime: 18, los: 5, age: 0,
    dropoff: ['gold', 'stone'], armor: 0, pierceArmor: 5,
    desc: 'Drop-off for gold and stone.',
  },
  farm: {
    name: 'Farm', short: 'Frm', w: 2, h: 2, hp: 240, art: 'farm',
    cost: { wood: 60 }, buildTime: 12, los: 2, age: 0,
    farmFood: 300, armor: 0, pierceArmor: 3, noBlock: true,
    desc: 'Renewable food. Villagers harvest 300 food from it.',
  },
  barracks: {
    name: 'Barracks', short: 'Bar', w: 3, h: 3, hp: 900, art: 'barracks',
    cost: { wood: 175 }, buildTime: 28, los: 6, age: 0,
    trainLines: ['infantry', 'spear'], armor: 1, pierceArmor: 6,
    desc: 'Trains infantry and spearmen.',
  },
  archeryrange: {
    name: 'Archery Range', short: 'Rng', w: 3, h: 3, hp: 900, art: 'archeryrange',
    cost: { wood: 175 }, buildTime: 28, los: 6, age: 1,
    trainLines: ['archer'], armor: 1, pierceArmor: 6,
    desc: 'Trains archers.',
  },
  stable: {
    name: 'Stable', short: 'Stb', w: 3, h: 3, hp: 900, art: 'stable',
    cost: { wood: 175 }, buildTime: 28, los: 6, age: 1,
    trainLines: ['cavalry'], armor: 1, pierceArmor: 6,
    desc: 'Trains cavalry.',
  },
  blacksmith: {
    name: 'Blacksmith', short: 'Bsm', w: 2, h: 2, hp: 800, art: 'blacksmith',
    cost: { wood: 150 }, buildTime: 26, los: 5, age: 1,
    researches: ['forging', 'scalemail', 'fletching', 'padded'],
    armor: 1, pierceArmor: 6,
    desc: 'Researches weapon and armor upgrades.',
  },
  tower: {
    name: 'Watch Tower', short: 'Twr', w: 1, h: 1, hp: 700, art: 'tower',
    cost: { wood: 50, stone: 125 }, buildTime: 22, los: 8, age: 1,
    atk: 6, range: 6.5, atkSpeed: 2.0, projSpeed: 640, armor: 1, pierceArmor: 7,
    desc: 'Shoots arrows at nearby enemies.',
  },
  castle: {
    name: 'Castle', short: 'Cas', w: 4, h: 4, hp: 3500, art: 'castle',
    cost: { stone: 650 }, buildTime: 60, los: 10, age: 2, pop: 10,
    atk: 12, range: 8, atkSpeed: 1.4, projSpeed: 700, armor: 8, pierceArmor: 11,
    trainLines: ['infantry'],
    desc: 'Powerful fortress. Fires many arrows, supports 10 pop.',
  },
};

/* ---------------------------------------------------------- researches -- */

const RESEARCH_DEFS = {
  forging:   { name: 'Forging',      cost: { food: 150 },             time: 20, age: 1, desc: '+1 melee attack', effect: { meleeAtk: 1 } },
  scalemail: { name: 'Scale Mail',   cost: { food: 100 },             time: 20, age: 1, desc: '+1 melee armor',  effect: { meleeArmor: 1 } },
  fletching: { name: 'Fletching',    cost: { food: 100, gold: 50 },   time: 22, age: 1, desc: '+1 archer attack & range', effect: { rangedAtk: 1, rangedRange: 0.5 } },
  padded:    { name: 'Padded Armor', cost: { food: 100 },             time: 22, age: 1, desc: '+1 pierce armor', effect: { pierceArmor: 1 } },
  loom:      { name: 'Loom',         cost: { gold: 50 },              time: 18, age: 0, desc: '+15 villager HP', effect: { villagerHp: 15 } },
  wheelbarrow:{name: 'Wheelbarrow',  cost: { food: 175, wood: 50 },   time: 22, age: 1, desc: 'Villagers move & carry more', effect: { villagerSpeed: 0.5, carry: 5 } },
};

/* ------------------------------------------------------------ resource -- */

const RESOURCE_DEFS = {
  tree:  { res: 'wood',  amount: 120, art: 'tree',  radius: 12, blocks: true },
  bush:  { res: 'food',  amount: 160, art: 'bush',  radius: 11, blocks: true },
  gold:  { res: 'gold',  amount: 900, art: 'gold',  radius: 12, blocks: true },
  stone: { res: 'stone', amount: 450, art: 'stone', radius: 12, blocks: true },
};

/* ------------------------------------------------------------- players -- */

const PLAYER_COLORS = [
  { key: 'blue', ink: '#1c3f8f', fill: '#4a76d4', light: '#a8c1f0', name: 'Blue' },
  { key: 'red',  ink: '#8f1c1c', fill: '#d44a4a', light: '#f0aaaa', name: 'Red'  },
];

/* --------------------------------------------------------- build menus -- */

const BUILD_MENU = [
  'house', 'mill', 'lumbercamp', 'miningcamp', 'farm',
  'barracks', 'archeryrange', 'stable', 'blacksmith',
  'tower', 'towncenter', 'castle',
];

const TERRAIN = { GRASS: 0, DIRT: 1, WATER: 2, SAND: 3 };
