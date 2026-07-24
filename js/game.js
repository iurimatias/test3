/* =========================================================================
   Game — players, world state, simulation loop
   ========================================================================= */
'use strict';

class Player {
  constructor(id, name, isHuman) {
    this.id = id;
    this.name = name;
    this.isHuman = isHuman;
    this.color = PLAYER_COLORS[id];
    this.resources = Object.assign({}, CFG.START_RES);
    this.gathered = { food: 0, wood: 0, gold: 0, stone: 0 };
    this.pop = 0;
    this.popCap = 0;
    this.age = 0;
    this.research = {};
    this.researching = {};
    this.kills = 0;
    this.losses = 0;
    this.defeated = false;
    this.upg = {
      meleeAtk: 0, rangedAtk: 0, meleeArmor: 0, pierceArmor: 0,
      rangedRange: 0, villagerHp: 0, villagerSpeed: 0, carry: 0,
    };
    this.builtTypes = {};   // type -> count ever built (for tech tree gating)
  }

  bonusHp(def) { return def.role === 'worker' ? this.upg.villagerHp : 0; }

  applyResearch(key) {
    const r = RESEARCH_DEFS[key];
    if (!r) return;
    this.research[key] = true;
    this.researching[key] = false;
    for (const k in r.effect) this.upg[k] += r.effect[k];
    if (r.effect.villagerHp) {
      for (const u of G.units)
        if (u.owner === this.id && u.isWorker) { u.maxHp += r.effect.villagerHp; u.hp += r.effect.villagerHp; }
    }
  }

  setAge(age) {
    this.age = age;
    // each age toughens existing troops a little, mirroring AoE's tech creep
    for (const u of G.units) {
      if (u.owner !== this.id || u.isWorker) continue;
      const bump = Math.round(u.def.hp * 0.06);
      u.maxHp += bump; u.hp += bump;
    }
  }

  recomputePopCap() {
    let cap = 0;
    for (const b of G.buildings)
      if (b.alive && b.owner === this.id && b.built && b.def.pop) cap += b.def.pop;
    this.popCap = Math.min(CFG.MAX_POP, cap);
  }

  countBuildingsOfAge(age) {
    let n = 0;
    for (const b of G.buildings)
      if (b.alive && b.owner === this.id && b.built && (b.def.age || 0) >= age && b.type !== 'house' && b.type !== 'farm') n++;
    return n;
  }

  hasBuilding(type) {
    for (const b of G.buildings)
      if (b.alive && b.owner === this.id && b.built && b.type === type) return true;
    return false;
  }

  canBuild(type) {
    const def = BUILDING_DEFS[type];
    if (!def) return false;
    if ((def.age || 0) > this.age) return false;
    if (type === 'farm' && !this.hasBuilding('mill') && !this.hasBuilding('towncenter')) return false;
    return true;
  }
}

/* ------------------------------------------------------------------------ */

const G = {
  /* --- collections --- */
  units: [], buildings: [], resources: [], projectiles: [], corpses: [],
  decor: [], floats: [], pings: [], minimapPings: [], toasts: [],
  players: [], selection: [],
  humanId: 0,

  time: 0,
  running: false,
  paused: false,
  gameOver: null,
  speed: 1,

  hoverEntity: null,
  placing: null,
  placeTile: null,
  placeValid: false,
  dragSelect: null,
  controlGroups: {},

  /* ------------------------------------------------------------------ init */

  init(canvas, minimapCanvas, opts) {
    this.canvas = canvas;
    this.minimapCanvas = minimapCanvas;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.opts = opts || {};

    this.units.length = 0; this.buildings.length = 0; this.resources.length = 0;
    this.projectiles.length = 0; this.corpses.length = 0; this.decor.length = 0;
    this.floats.length = 0; this.pings.length = 0; this.minimapPings.length = 0;
    this.toasts.length = 0; this.selection.length = 0;
    this.controlGroups = {};
    this.gameOver = null;
    this.time = 0;
    this.paused = false;

    const seed = (opts && opts.seed) || ((Math.random() * 1e9) | 0);
    this.seed = seed;
    this.map = new GameMap(CFG.MAP_W, CFG.MAP_H, seed).generate(2);
    this.grid = this.map.grid;
    this.pathSvc = new PathService(this.grid);
    this.occupancy = new Int32Array(CFG.MAP_W * CFG.MAP_H);

    this.players = [new Player(0, 'You', true), new Player(1, 'Red Empire', false)];
    this.humanId = 0;
    this.difficulty = (opts && opts.difficulty) || 'normal';

    this.map.populate((type, tx, ty) => {
      const n = new ResourceNode(type, tx, ty);
      if (n.def.blocks) this.grid.setRect(tx, ty, 1, 1, true);
      this.resources.push(n);
    });

    this.cam = new Camera();
    this.fog = new FogOfWar(CFG.MAP_W, CFG.MAP_H);
    this.renderer = new Renderer(canvas);
    this.renderer.buildTerrain(this.map);

    // --- starting bases ---
    this.map.starts.forEach((s, i) => {
      if (i >= this.players.length) return;
      const tc = this.placeBuilding('towncenter', s.x - 1, s.y - 1, i, true);
      const p = this.players[i];
      p.recomputePopCap();
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * TAU + 0.5;
        const px = s.x + Math.cos(a) * 2.6, py = s.y + Math.sin(a) * 2.6;
        const spot = this.grid.nearestFree(Math.round(px), Math.round(py), 6) || [s.x, s.y + 2];
        const u = this.spawnUnit('villager', tileCenter(spot[0]), tileCenter(spot[1]), i);
        // start them on the nearest food, like a real AoE opening
        const node = this.findNearestResource(u.x, u.y, 'food', 16 * CFG.TILE, i);
        if (node) u.commandGather(node);
      }
      if (tc) tc.rally = { x: tc.x, y: tc.bottom + CFG.TILE * 1.5 };
    });

    this.ai = new AIPlayer(this.players[1], this);

    const home = this.map.starts[0];
    this.cam.zoom = 1;
    this.cam.centerOn(tileCenter(home.x), tileCenter(home.y));

    this.fog.update([...this.units, ...this.buildings], this.humanId);
    if (opts && opts.revealMap) this.fog.revealAll();

    this.running = true;
  },

  /* --------------------------------------------------------- spawn helpers */

  spawnUnit(type, x, y, owner) {
    const u = new Unit(type, x, y, owner);
    this.units.push(u);
    const p = this.players[owner];
    if (p) p.pop++;
    return u;
  },

  /** Purely geometric: is this footprint physically buildable? */
  canPlace(type, tx, ty, owner) {
    const def = BUILDING_DEFS[type];
    if (!def) return false;
    for (let y = ty; y < ty + def.h; y++) {
      for (let x = tx; x < tx + def.w; x++) {
        if (x < 0 || y < 0 || x >= CFG.MAP_W || y >= CFG.MAP_H) return false;
        if (this.map.t(x, y) === TERRAIN.WATER) return false;
        if (this.occupancy[y * CFG.MAP_W + x]) return false;
        // Farms don't block movement, but still can't sit on trees or walls.
        if (!def.noBlock && !this.grid.isFree(x, y)) return false;
        if (def.noBlock && this.grid.blocked[y * CFG.MAP_W + x] > 0) return false;
      }
    }
    return true;
  },

  /** You may only build on ground you have scouted. */
  rectExplored(type, tx, ty) {
    if (!CFG.FOG) return true;
    const def = BUILDING_DEFS[type];
    for (let y = ty; y < ty + def.h; y++)
      for (let x = tx; x < tx + def.w; x++)
        if (!this.fog.isExplored(x, y)) return false;
    return true;
  },

  placeBuilding(type, tx, ty, owner, prebuilt) {
    if (!this.canPlace(type, tx, ty, owner)) return null;
    const b = new Building(type, tx, ty, owner, prebuilt);
    this.buildings.push(b);
    const def = b.def;
    for (let y = ty; y < ty + def.h; y++)
      for (let x = tx; x < tx + def.w; x++)
        this.occupancy[y * CFG.MAP_W + x] = b.id;
    const p = this.players[owner];
    if (p) {
      p.builtTypes[type] = (p.builtTypes[type] || 0) + 1;
      if (prebuilt) p.recomputePopCap();
    }
    // shove any units standing inside out of the way
    if (!def.noBlock) {
      for (const u of this.units) {
        if (u.x > b.left && u.x < b.right && u.y > b.top && u.y < b.bottom) {
          const spot = this.grid.nearestFree(b.tileX + def.w, b.tileY + def.h, 8);
          if (spot) { u.x = tileCenter(spot[0]); u.y = tileCenter(spot[1]); u.clearPath(); }
        }
      }
    }
    return b;
  },

  /**
   * Pay for and lay a foundation, then send `builders` to raise it.
   * Shared by the player's build cursor and the AI.
   */
  startConstruction(type, tx, ty, playerId, builders) {
    const p = this.players[playerId];
    const def = BUILDING_DEFS[type];
    if (!p.canBuild(type)) {
      if (playerId === this.humanId) this.toast(`${def.name} is not available yet`);
      return null;
    }
    if (!canAfford(p.resources, def.cost)) {
      if (playerId === this.humanId) this.toast(`Not enough resources for ${def.name}`);
      return null;
    }
    if (!this.canPlace(type, tx, ty, playerId)) {
      if (playerId === this.humanId) this.toast('Cannot build there');
      return null;
    }
    if (playerId === this.humanId && !this.rectExplored(type, tx, ty)) {
      this.toast('You have not explored that ground yet');
      return null;
    }
    payCost(p.resources, def.cost);
    const b = this.placeBuilding(type, tx, ty, playerId, false);
    if (!b) { refundCost(p.resources, def.cost); return null; }
    if (builders && builders.length) for (const v of builders) v.commandBuild(b);
    return b;
  },

  onBuildingComplete(b, builder) {
    const p = this.players[b.owner];
    p.recomputePopCap();
    if (b.owner === this.humanId) {
      this.toast(`${b.def.name} complete`);
      this.floatText(b.x, b.top - 6, '✔', 'food');
    }
    if (!b.rally && (b.def.trains || b.def.trainLines))
      b.rally = { x: b.x, y: b.bottom + CFG.TILE * 1.5 };
  },

  onUnitTrained(u) { /* hook for UI feedback */ },

  spawnProjectile(from, target, dmg, dtype, delay) {
    this.projectiles.push(new Projectile(from, target, dmg, dtype, delay));
  },

  spawnCorpse(u) {
    u.deathT = 0;
    u.dieDir = Math.random() < 0.5 ? -1 : 1;
    this.corpses.push(u);
  },

  spawnRubble(b) {
    this.decor.push({ x: b.x, y: b.y + b.pxH * 0.2, kind: 'rubble', seed: b.seed, r: b.pxW * 0.35 });
    if (this.decor.length > 700) this.decor.splice(0, 100);
  },

  floatText(x, y, text, kind) {
    this.floats.push({ x, y, text, kind, t: 0, life: 1.1 });
  },

  ping(x, y, color) {
    this.pings.push({ x, y, color: color || 'rgba(47,122,47,0.9)', t: 0, life: 0.55 });
  },

  toast(msg, life) {
    this.toasts.push({ msg, t: 0, life: life || 2.4 });
    if (this.toasts.length > 5) this.toasts.shift();
    if (typeof UI !== 'undefined') UI.renderToasts();
  },

  bigBanner(text) {
    this.banner = { text, t: 0, life: 2.6 };
  },

  notifyAttacked(entity, attacker) {
    if (entity.owner !== this.humanId) return;
    if (this.time - (this._lastAttackWarn || -99) < 12) return;
    this._lastAttackWarn = this.time;
    this.toast('⚠ You are under attack!', 3);
    this.minimapPings.push({ x: entity.x, y: entity.y, t: 0, life: 2.5 });
    this.lastAttackPos = { x: entity.x, y: entity.y };
  },

  dealDamage(attacker, target, atk, dtype) {
    if (!target || !target.alive || target.kind === 'resource') return;
    const armor = dtype === 'melee'
      ? (target.armorValue !== undefined ? target.armorValue : 0)
      : (target.pierceArmorValue !== undefined ? target.pierceArmorValue : 0);
    let dmg = Math.max(1, atk - armor);
    const bonus = attacker && attacker.def && attacker.def.bonus;
    if (bonus && target.def && bonus[target.def.role]) dmg += bonus[target.def.role];
    if (target.kind === 'building' && attacker && attacker.def && attacker.def.role === 'ranged') dmg *= 0.5;
    target.takeDamage(dmg, attacker);
  },

  /* ------------------------------------------------------------- queries */

  rebuildSpatial() {
    const cell = 96;
    const cols = Math.ceil(WORLD_W / cell);
    const rows = Math.ceil(WORLD_H / cell);
    if (!this._hash || this._hashCols !== cols) {
      this._hash = new Array(cols * rows);
      for (let i = 0; i < cols * rows; i++) this._hash[i] = [];
      this._hashCols = cols; this._hashRows = rows; this._hashCell = cell;
    }
    for (let i = 0; i < this._hash.length; i++) this._hash[i].length = 0;
    for (const u of this.units) {
      if (!u.alive) continue;
      const cx = clamp((u.x / cell) | 0, 0, cols - 1);
      const cy = clamp((u.y / cell) | 0, 0, rows - 1);
      this._hash[cy * cols + cx].push(u);
    }
  },

  forEachNearbyUnit(x, y, radius, fn) {
    const cell = this._hashCell, cols = this._hashCols, rows = this._hashRows;
    const x0 = clamp(((x - radius) / cell) | 0, 0, cols - 1);
    const x1 = clamp(((x + radius) / cell) | 0, 0, cols - 1);
    const y0 = clamp(((y - radius) / cell) | 0, 0, rows - 1);
    const y1 = clamp(((y + radius) / cell) | 0, 0, rows - 1);
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        const bucket = this._hash[cy * cols + cx];
        for (let i = 0; i < bucket.length; i++) fn(bucket[i]);
      }
  },

  findNearestEnemy(from, radius, buildingsToo) {
    let best = null, bestD = radius * radius;
    this.forEachNearbyUnit(from.x, from.y, radius, (u) => {
      if (!u.alive || u.owner === from.owner || u.owner < 0) return;
      const d = dist2(from.x, from.y, u.x, u.y);
      if (d < bestD) { bestD = d; best = u; }
    });
    if (best) return best;
    // fall back to structures (towers shoot them, troops siege them)
    for (const b of this.buildings) {
      if (!b.alive || b.owner === from.owner || b.owner < 0) continue;
      const d = b.edgeDistTo(from.x, from.y);
      if (d < radius) {
        const dd = d * d;
        if (dd < bestD) { bestD = dd; best = b; }
      }
    }
    return best;
  },

  findNearestResource(x, y, resType, radius, ownerId) {
    let best = null, bestD = radius * radius;
    for (const r of this.resources) {
      if (!r.alive || r.resType !== resType || r.amount <= 0) continue;
      const d = dist2(x, y, r.x, r.y);
      if (d < bestD) { bestD = d; best = r; }
    }
    // farms count as food sources for their owner
    if (resType === 'food') {
      for (const b of this.buildings) {
        if (!b.alive || !b.def.farmFood || !b.built || b.owner !== ownerId || b.amount <= 0) continue;
        const d = dist2(x, y, b.x, b.y);
        if (d < bestD) { bestD = d; best = b; }
      }
    }
    return best;
  },

  findDropoff(unit, resType) {
    let best = null, bestD = Infinity;
    for (const b of this.buildings) {
      if (!b.alive || !b.built || b.owner !== unit.owner) continue;
      if (!b.def.dropoff || !b.def.dropoff.includes(resType)) continue;
      const d = b.edgeDistTo(unit.x, unit.y);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  },

  findNearbyConstruction(x, y, owner, radius) {
    let best = null, bestD = radius * radius;
    for (const b of this.buildings) {
      if (!b.alive || b.built || b.owner !== owner) continue;
      const d = dist2(x, y, b.x, b.y);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  },

  entityAt(wx, wy) {
    // units first (smallest targets), then buildings, then resources
    let best = null, bestD = Infinity;
    for (const u of this.units) {
      if (!u.alive) continue;
      if (CFG.FOG && u.owner !== this.humanId && !this.fog.isVisiblePx(u.x, u.y)) continue;
      const d = dist2(wx, wy, u.x, u.y - 18);
      if (d < (u.radius + 10) ** 2 && d < bestD) { bestD = d; best = u; }
    }
    if (best) return best;
    for (const b of this.buildings) {
      if (!b.alive) continue;
      if (CFG.FOG && !this.fog.isExplored(b.tileX, b.tileY)) continue;
      if (wx >= b.left && wx <= b.right && wy >= b.top && wy <= b.bottom) return b;
    }
    for (const r of this.resources) {
      if (!r.alive) continue;
      if (CFG.FOG && !this.fog.isExplored(r.tileX, r.tileY)) continue;
      if (Math.abs(wx - r.x) < CFG.TILE * 0.6 && Math.abs(wy - r.y) < CFG.TILE * 0.7) return r;
    }
    return null;
  },

  /* ---------------------------------------------------------------- update */

  update(dt) {
    if (this.paused || this.gameOver) { this._updateFx(dt); return; }
    dt = Math.min(dt, 0.05) * this.speed;
    this.time += dt;

    this.pathSvc.process();
    this.rebuildSpatial();

    for (const b of this.buildings) if (b.alive) b.update(dt);
    for (const u of this.units) if (u.alive) u.update(dt);
    for (const p of this.projectiles) p.update(dt);

    this._separate(dt);

    if (this.ai) this.ai.update(dt);

    // fog
    if (CFG.FOG) {
      this.fog.timer -= dt * 1000;
      if (this.fog.timer <= 0) {
        this.fog.timer = CFG.FOG_UPDATE_MS;
        this._fogEntities = this._fogEntities || [];
        this._fogEntities.length = 0;
        for (const u of this.units) if (u.owner === this.humanId && u.alive) this._fogEntities.push(u);
        for (const b of this.buildings) if (b.owner === this.humanId && b.alive) this._fogEntities.push(b);
        this.fog.update(this._fogEntities, this.humanId);
      }
    }

    this._compact();
    this._updateFx(dt);
    this._checkVictory();
  },

  /** Soft push-apart so units don't stack into a single pixel. */
  _separate(dt) {
    const arr = this.units;
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i];
      if (!a.alive) continue;
      let pushX = 0, pushY = 0;
      this.forEachNearbyUnit(a.x, a.y, 34, (b) => {
        if (b === a || !b.alive) return;
        const dx = a.x - b.x, dy = a.y - b.y;
        const minD = (a.radius + b.radius) * 0.82;
        const d2v = dx * dx + dy * dy;
        if (d2v > minD * minD || d2v < 0.0001) return;
        const d = Math.sqrt(d2v);
        const overlap = (minD - d) / minD;
        pushX += (dx / d) * overlap;
        pushY += (dy / d) * overlap;
      });
      if (pushX || pushY) {
        const mag = Math.hypot(pushX, pushY);
        const cap = Math.min(mag, 2.2);
        const s = (cap / mag) * 46 * dt;
        let nx = a.x + pushX * s, ny = a.y + pushY * s;
        // don't get shoved into walls
        if (this.grid.isFree(Math.floor(nx / CFG.TILE), Math.floor(ny / CFG.TILE))) { a.x = nx; a.y = ny; }
        a.x = clamp(a.x, 4, WORLD_W - 4);
        a.y = clamp(a.y, 4, WORLD_H - 4);
      }
    }
  },

  _updateFx(dt) {
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i]; f.t += dt;
      if (f.t >= f.life) this.floats.splice(i, 1);
    }
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i]; p.t += dt;
      if (p.t >= p.life) this.pings.splice(i, 1);
    }
    for (let i = this.minimapPings.length - 1; i >= 0; i--) {
      const p = this.minimapPings[i]; p.t += dt;
      if (p.t >= p.life) this.minimapPings.splice(i, 1);
    }
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i]; c.deathT += dt;
      if (c.deathT > 2.2) {
        this.decor.push({ x: c.x, y: c.y, kind: 'bones', seed: c.id });
        if (this.decor.length > 700) this.decor.splice(0, 100);
        this.corpses.splice(i, 1);
      }
    }
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      const t = this.toasts[i]; t.t += dt;
      if (t.t >= t.life) { this.toasts.splice(i, 1); if (typeof UI !== 'undefined') UI.renderToasts(); }
    }
    if (this.banner) {
      this.banner.t += dt;
      if (this.banner.t >= this.banner.life) this.banner = null;
    }
  },

  _compact() {
    let dead = false;
    for (const u of this.units) if (!u.alive) { dead = true; break; }
    if (dead) {
      this.units = this.units.filter(u => u.alive);
      this.selection = this.selection.filter(e => e.alive);
    }
    let db = false;
    for (const b of this.buildings) if (!b.alive) { db = true; break; }
    if (db) {
      for (const b of this.buildings) {
        if (b.alive) continue;
        for (let y = b.tileY; y < b.tileY + b.h; y++)
          for (let x = b.tileX; x < b.tileX + b.w; x++)
            if (this.occupancy[y * CFG.MAP_W + x] === b.id) this.occupancy[y * CFG.MAP_W + x] = 0;
      }
      this.buildings = this.buildings.filter(b => b.alive);
      this.selection = this.selection.filter(e => e.alive);
    }
    let dr = false;
    for (const r of this.resources) if (!r.alive) { dr = true; break; }
    if (dr) {
      this.resources = this.resources.filter(r => r.alive);
      this.selection = this.selection.filter(e => e.alive);
    }
    if (this.projectiles.some(p => !p.alive))
      this.projectiles = this.projectiles.filter(p => p.alive);
  },

  _checkVictory() {
    if (this.gameOver) return;
    for (const p of this.players) {
      if (p.defeated) continue;
      let has = false;
      for (const b of this.buildings) if (b.alive && b.owner === p.id) { has = true; break; }
      if (!has) for (const u of this.units) if (u.alive && u.owner === p.id) { has = true; break; }
      if (!has) {
        p.defeated = true;
        this.gameOver = { winner: p.id === this.humanId ? 1 - this.humanId : this.humanId };
        if (typeof UI !== 'undefined') UI.showGameOver(this.gameOver);
      }
    }
  },

  /* ------------------------------------------------------------- selection */

  clearSelection() {
    for (const e of this.selection) e.selected = false;
    this.selection.length = 0;
  },

  select(entities, additive) {
    if (!additive) this.clearSelection();
    for (const e of entities) {
      if (!e || !e.alive || e.selected) continue;
      e.selected = true;
      this.selection.push(e);
    }
    if (typeof UI !== 'undefined') UI.refreshSelection();
  },

  selectOne(e, additive) { this.select(e ? [e] : [], additive); },

  get selectedUnits() { return this.selection.filter(e => e.kind === 'unit' && e.owner === this.humanId); },
  get selectedBuilding() {
    return this.selection.find(e => e.kind === 'building' && e.owner === this.humanId) || null;
  },

  selectAllOfTypeOnScreen(type) {
    const cam = this.cam;
    const found = this.units.filter(u =>
      u.alive && u.owner === this.humanId && u.type === type &&
      u.x > cam.x && u.x < cam.x + cam.vw && u.y > cam.y && u.y < cam.y + cam.vh);
    this.select(found, false);
  },

  findIdleVillager() {
    const list = this.units.filter(u =>
      u.alive && u.owner === this.humanId && u.isWorker &&
      u.state === 'idle' && !u.target);
    if (!list.length) return null;
    this._idleIdx = ((this._idleIdx || 0) + 1) % list.length;
    return list[this._idleIdx];
  },
};
