/* =========================================================================
   Entities — resource nodes, units, buildings, projectiles
   ========================================================================= */
'use strict';

let __nextId = 1;

class Entity {
  constructor(x, y, owner) {
    this.id = __nextId++;
    this.x = x; this.y = y;
    this.owner = owner;
    this.alive = true;
    this.selected = false;
    this.hp = 1; this.maxHp = 1;
    this.hitFlash = 0;
  }
  get tx() { return Math.floor(this.x / CFG.TILE); }
  get ty() { return Math.floor(this.y / CFG.TILE); }

  /** Distance from a point to this entity's edge (approximate). */
  edgeDistTo(px, py) {
    if (this.kind === 'building') {
      const cx = clamp(px, this.left, this.right);
      const cy = clamp(py, this.top, this.bottom);
      return dist(px, py, cx, cy);
    }
    return Math.max(0, dist(px, py, this.x, this.y) - (this.radius || 8));
  }

  takeDamage(amount, attacker) {
    if (!this.alive) return;
    this.hp -= amount;
    this.hitFlash = 0.18;
    if (this.kind === 'unit' || this.kind === 'building') {
      G.notifyAttacked(this, attacker);
      // Idle military units and villagers fight back / flee
      if (this.kind === 'unit' && attacker && attacker.alive) this.onAttacked(attacker);
    }
    if (this.hp <= 0) this.die(attacker);
  }

  onAttacked() {}
  die() { this.alive = false; }
}

/* ------------------------------------------------------------------------
   Resource node
   ------------------------------------------------------------------------ */
class ResourceNode extends Entity {
  constructor(type, tx, ty) {
    super(tileCenter(tx), tileCenter(ty), -1);
    this.kind = 'resource';
    this.type = type;
    this.def = RESOURCE_DEFS[type];
    this.resType = this.def.res;
    this.amount = this.def.amount;
    this.maxAmount = this.def.amount;
    this.radius = this.def.radius;
    this.tileX = tx; this.tileY = ty;
    this.seed = (tx * 73856093 ^ ty * 19349663) >>> 0;
    this.hp = this.maxHp = 999999;
    // Nudge foliage off the exact tile centre so woods read as a thicket
    // rather than an orchard. Tile coords are untouched, so gathering,
    // pathing and placement all still line up with the grid.
    if (type === 'tree' || type === 'bush') {
      this.x += (hashNoise(tx * 3, ty * 7) - 0.5) * 13;
      this.y += (hashNoise(ty * 5, tx * 11) - 0.5) * 10;
    }
  }
  get gatherTiles() { return 1; }

  harvest(amount) {
    const got = Math.min(this.amount, amount);
    this.amount -= got;
    if (this.amount <= 0.001) this.deplete();
    return got;
  }
  deplete() {
    this.alive = false;
    if (this.def.blocks) G.grid.setRect(this.tileX, this.tileY, 1, 1, false);
    // stumps: trees leave a small decoration
    if (this.type === 'tree') G.decor.push({ x: this.x, y: this.y, kind: 'stump', seed: this.seed });
  }
}

/* ------------------------------------------------------------------------
   Unit
   ------------------------------------------------------------------------ */
class Unit extends Entity {
  constructor(type, x, y, owner) {
    super(x, y, owner);
    this.kind = 'unit';
    this.type = type;
    this.def = UNIT_DEFS[type];
    const p = G.players[owner];
    this.maxHp = this.def.hp + (p ? p.bonusHp(this.def) : 0);
    this.hp = this.maxHp;
    this.radius = this.def.radius;
    this.facing = Math.PI / 2;
    this.state = 'idle';
    this.path = null;
    this.pathIdx = 0;
    this.goal = null;              // {x,y} pixel goal
    this.target = null;            // entity being attacked / gathered / built
    this.carry = { type: null, amount: 0 };
    this.gatherTimer = 0;
    this.attackCd = 0;
    this.anim = Math.random() * 10;
    this.walkPhase = Math.random() * TAU;
    this.stuck = 0;
    this.lastX = x; this.lastY = y;
    this.repaths = 0;
    this.stance = 'aggressive';
    this.taskAfterMove = null;
    this.attackMoveGoal = null;
    this.scanTimer = Math.random();
    this.depositTarget = null;
    this.lastNode = null;
    this.vx = 0; this.vy = 0;
    this.swing = 0;
    this.idleWander = 0;
  }

  get isWorker() { return this.def.role === 'worker'; }
  get isMilitary() { return this.def.role !== 'worker'; }
  get speed() {
    const p = G.players[this.owner];
    return (this.def.speed + (this.isWorker && p ? p.upg.villagerSpeed : 0)) * CFG.TILE;
  }
  get attackValue() {
    const p = G.players[this.owner];
    if (!p) return this.def.atk;
    if (this.def.role === 'ranged') return this.def.atk + p.upg.rangedAtk;
    return this.def.atk + p.upg.meleeAtk;
  }
  get rangeValue() {
    const p = G.players[this.owner];
    let r = this.def.range;
    if (this.def.role === 'ranged' && p) r += p.upg.rangedRange;
    return r;
  }
  get armorValue() {
    const p = G.players[this.owner];
    return this.def.armor + (p ? p.upg.meleeArmor : 0);
  }
  get pierceArmorValue() {
    const p = G.players[this.owner];
    return this.def.pierceArmor + (p ? p.upg.pierceArmor : 0);
  }
  get carryCap() {
    const p = G.players[this.owner];
    return CFG.CARRY_CAP + (p ? p.upg.carry : 0);
  }

  /* ------------------------------------------------------------ commands */

  stop() {
    this.clearPath();
    this.state = 'idle';
    this.target = null;
    this.taskAfterMove = null;
    this.attackMoveGoal = null;
    // Forget the old job, or the idle handler would put them straight back
    // to work and "Stop" would appear to do nothing.
    this.lastNode = null;
  }

  clearPath() {
    if (this._pathPending) G.pathSvc.cancel(this);
    this.path = null; this.pathIdx = 0; this.goal = null;
  }

  moveTo(px, py, onArrive) {
    this.clearPath();
    this.goal = { x: px, y: py };
    this.taskAfterMove = onArrive || null;
    this.state = 'move';
    this.repaths = 0;
    this._requestPath(px, py);
  }

  _requestPath(px, py) {
    let gx = clamp(Math.floor(px / CFG.TILE), 0, CFG.MAP_W - 1);
    let gy = clamp(Math.floor(py / CFG.TILE), 0, CFG.MAP_H - 1);
    G.pathSvc.request(this, gx, gy, (path) => {
      if (!this.alive) return;
      if (path && path.length) { this.path = path; this.pathIdx = 0; }
      else if (path && path.length === 0) { this.path = null; this._arrive(); }
      else { this.path = null; this._arrive(); }
    });
  }

  _arrive() {
    this.path = null;
    const t = this.taskAfterMove;
    this.taskAfterMove = null;
    if (t) { t(); }
    else if (this.state === 'move') this.state = 'idle';
  }

  commandMove(px, py) {
    this.attackMoveGoal = null;
    this.target = null;
    this.lastNode = null;      // an explicit move order ends the current job
    this.moveTo(px, py);
  }

  commandAttackMove(px, py) {
    this.target = null;
    this.attackMoveGoal = { x: px, y: py };
    this.moveTo(px, py, () => { this.attackMoveGoal = null; this.state = 'idle'; });
  }

  commandAttack(target) {
    this.attackMoveGoal = null;
    this.target = target;
    this.state = 'attack';
    this.clearPath();
  }

  commandGather(node) {
    this.attackMoveGoal = null;
    this.target = node;
    this.lastNode = node;
    this.state = 'gather';
    this.clearPath();
    this._gatherApproached = false;
  }

  commandBuild(building) {
    this.attackMoveGoal = null;
    this.target = building;
    this.state = 'build';
    this.clearPath();
  }

  onAttacked(attacker) {
    if (this.state === 'idle' && this.isMilitary && attacker) {
      this.commandAttack(attacker);
    } else if (this.isWorker && this.state === 'idle' && attacker) {
      // villagers fight back only if the attacker is adjacent, else keep working
      if (this.edgeDistTo(attacker.x, attacker.y) < CFG.TILE * 3) this.commandAttack(attacker);
    }
  }

  /* -------------------------------------------------------------- update */

  update(dt) {
    this.anim += dt;
    this.attackCd -= dt;
    this.swing = Math.max(0, this.swing - dt * 4);
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.scanTimer -= dt;

    switch (this.state) {
      case 'idle':     this._updIdle(dt); break;
      case 'move':     this._updMove(dt); break;
      case 'gather':   this._updGather(dt); break;
      case 'return':   this._updReturn(dt); break;
      case 'build':    this._updBuild(dt); break;
      case 'attack':   this._updAttack(dt); break;
    }

    this._followPath(dt);
  }

  _autoAcquire(radiusTiles) {
    if (this.scanTimer > 0) return null;
    this.scanTimer = 0.4 + Math.random() * 0.3;
    return G.findNearestEnemy(this, radiusTiles * CFG.TILE);
  }

  _updIdle(dt) {
    if (this.isMilitary && this.stance !== 'passive') {
      const e = this._autoAcquire(this.def.los);
      if (e) { this.commandAttack(e); this._guardPost = { x: this.x, y: this.y }; return; }
    }
    if (!this.isWorker) return;

    // Workers pick their job back up on their own — an idle villager holding a
    // full load, or one whose node ran dry, should never just stand there.
    this._idleRetry = (this._idleRetry || 0) - 1;
    if (this._idleRetry > 0) return;
    this._idleRetry = 30;

    if (this.carry.amount > 0.5) { this._startReturn(); return; }
    if (this.lastNode && this.lastNode.alive) { this.commandGather(this.lastNode); return; }
    if (this.lastNode) this._findNextNode();
  }

  _updMove(dt) {
    if (this.attackMoveGoal && this.isMilitary) {
      const e = this._autoAcquire(this.def.los);
      if (e) {
        const back = this.attackMoveGoal;
        this.commandAttack(e);
        this.attackMoveGoal = back;
        return;
      }
    }
    if (!this.path && !this._pathPending) this._arrive();
  }

  /* ---------------------------------------------------------- gathering */

  _updGather(dt) {
    const node = this.target;
    if (!node || !node.alive || node.amount <= 0) {
      this._findNextNode();
      return;
    }
    if (this.carry.amount >= this.carryCap && this.carry.type === node.resType) {
      this._startReturn(); return;
    }
    // Drop a different carried resource type first
    if (this.carry.amount > 0 && this.carry.type !== node.resType) {
      this.carry.type = node.resType; this.carry.amount = 0;
    }

    const d = node.edgeDistTo(this.x, this.y);
    if (d > CFG.GATHER_REACH) {
      if (!this.path && !this._pathPending) {
        const spot = this._standingSpotFor(node);
        this.clearPath();
        this.goal = spot;
        this._requestPath(spot.x, spot.y);
        this._gatherStuck = (this._gatherStuck || 0) + 1;
        if (this._gatherStuck > 8) { this._findNextNode(); this._gatherStuck = 0; }
      }
      return;
    }

    this.clearPath();
    this._gatherStuck = 0;
    this.facing = Math.atan2(node.y - this.y, node.x - this.x);
    this.carry.type = node.resType;
    const rate = CFG.GATHER_RATE[node.resType] || 0.6;
    const got = node.harvest(rate * dt);
    this.carry.amount += got;
    this.gatherTimer += dt;
    this.swing = Math.max(this.swing, (Math.sin(this.anim * 7) * 0.5 + 0.5));
    if (this.carry.amount >= this.carryCap) this._startReturn();
    else if (!node.alive) this._findNextNode();
  }

  _standingSpotFor(node) {
    // pick the free tile adjacent to the node nearest to us
    const best = { d: Infinity, x: node.x, y: node.y };
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const tx = node.tileX !== undefined ? node.tileX + dx : node.tx + dx;
        const ty = node.tileY !== undefined ? node.tileY + dy : node.ty + dy;
        if (!G.grid.isFree(tx, ty)) continue;
        const px = tileCenter(tx), py = tileCenter(ty);
        const d = dist2(this.x, this.y, px, py);
        if (d < best.d) { best.d = d; best.x = px; best.y = py; }
      }
    return { x: best.x, y: best.y };
  }

  _findNextNode() {
    const want = this.carry.type || (this.lastNode && this.lastNode.resType) || 'food';
    if (this.carry.amount > 0) { this._startReturn(); return; }
    const n = G.findNearestResource(this.x, this.y, want, 22 * CFG.TILE, this.owner);
    if (n) { this.commandGather(n); }
    else { this.lastNode = null; this.state = 'idle'; this.target = null; }
  }

  _startReturn() {
    const drop = G.findDropoff(this, this.carry.type);
    if (!drop) { this.state = 'idle'; return; }
    this.state = 'return';
    this.depositTarget = drop;
    this.clearPath();
  }

  _updReturn(dt) {
    const drop = this.depositTarget;
    if (!drop || !drop.alive) {
      const d2 = G.findDropoff(this, this.carry.type);
      if (!d2) { this.state = 'idle'; return; }
      this.depositTarget = d2;
      this.clearPath();
      return;
    }
    const d = drop.edgeDistTo(this.x, this.y);
    if (d < CFG.DROP_REACH) {
      this.clearPath();
      this._retStuck = 0;
      const p = G.players[this.owner];
      p.resources[this.carry.type] += this.carry.amount;
      p.gathered[this.carry.type] = (p.gathered[this.carry.type] || 0) + this.carry.amount;
      G.floatText(drop.x, drop.top - 4, `+${Math.round(this.carry.amount)}`, this.carry.type);
      this.carry.amount = 0;
      if (this.lastNode && this.lastNode.alive) this.commandGather(this.lastNode);
      else this._findNextNode();
      return;
    }
    if (!this.path && !this._pathPending) {
      this.goal = { x: drop.x, y: drop.y };
      this._requestPath(drop.x, drop.y);
      // Repeated failures mean this drop-off is unreachable — try another one
      // rather than standing around holding a full load.
      this._retStuck = (this._retStuck || 0) + 1;
      if (this._retStuck > 10) { this._retStuck = 0; this.depositTarget = null; }
    }
  }

  /* ----------------------------------------------------------- building */

  _updBuild(dt) {
    const b = this.target;
    if (!b || !b.alive) { this.state = 'idle'; this.target = null; return; }
    if (b.built && b.hp >= b.maxHp) {
      // finished — look for another nearby unfinished building of ours
      const next = G.findNearbyConstruction(this.x, this.y, this.owner, 14 * CFG.TILE);
      if (next && next !== b) { this.commandBuild(next); return; }
      this.state = 'idle'; this.target = null;
      return;
    }
    const d = b.edgeDistTo(this.x, this.y);
    if (d > CFG.BUILD_REACH) {
      if (!this.path && !this._pathPending) {
        const spot = b.nearestApproach(this.x, this.y);
        this.goal = spot;
        this._requestPath(spot.x, spot.y);
        this._bStuck = (this._bStuck || 0) + 1;
        if (this._bStuck > 10) { this._bStuck = 0; this.state = 'idle'; }
      }
      return;
    }
    this.clearPath();
    this._bStuck = 0;
    this.facing = Math.atan2(b.y - this.y, b.x - this.x);
    this.swing = Math.max(this.swing, Math.sin(this.anim * 8) * 0.5 + 0.5);
    if (!b.built) b.addConstruction(dt, this);
    else if (b.hp < b.maxHp) b.hp = Math.min(b.maxHp, b.hp + CFG.REPAIR_RATE * dt);
  }

  /* ------------------------------------------------------------ combat */

  _updAttack(dt) {
    const t = this.target;
    if (!t || !t.alive) {
      this.target = null;
      if (this.attackMoveGoal) { const g = this.attackMoveGoal; this.commandAttackMove(g.x, g.y); }
      else {
        const e = this._autoAcquire(this.def.los);
        if (e) this.commandAttack(e);
        else this.state = 'idle';
      }
      return;
    }
    const reach = this.rangeValue * CFG.TILE + 4;
    const d = t.edgeDistTo(this.x, this.y);
    if (d <= reach) {
      this.clearPath();
      this.facing = Math.atan2(t.y - this.y, t.x - this.x);
      if (this.attackCd <= 0) {
        this.attackCd = this.def.atkSpeed;
        this.swing = 1;
        this._strike(t);
      }
    } else {
      // chase
      const far = d > this.def.los * CFG.TILE * 2.2;
      if (far && this.isWorker) { this.state = 'idle'; this.target = null; return; }
      if (!this.path && !this._pathPending) {
        this._chaseRepath = (this._chaseRepath || 0) + 1;
        if (this._chaseRepath > 14) { this._chaseRepath = 0; this.target = null; this.state = 'idle'; return; }
        this.goal = { x: t.x, y: t.y };
        this._requestPath(t.x, t.y);
      } else if (this.path) {
        this._chaseRepath = 0;
        // if the target moved far from our path goal, repath
        if (this.goal && dist2(this.goal.x, this.goal.y, t.x, t.y) > (CFG.TILE * 3) ** 2) {
          this.clearPath();
        }
      }
    }
  }

  _strike(t) {
    const isRanged = this.def.role === 'ranged';
    if (isRanged) {
      G.spawnProjectile(this, t, this.attackValue, 'pierce');
    } else {
      G.dealDamage(this, t, this.attackValue, 'melee');
    }
  }

  /* -------------------------------------------------------- locomotion */

  _followPath(dt) {
    if (!this.path || this.pathIdx >= this.path.length) {
      if (this.path) { this.path = null; if (this.state === 'move') this._arrive(); }
      this.vx = 0; this.vy = 0;
      return;
    }
    const last = this.pathIdx === this.path.length - 1;
    const node = this.path[this.pathIdx];
    let tx = tileCenter(node[0]), ty = tileCenter(node[1]);
    if (last && this.goal) { tx = this.goal.x; ty = this.goal.y; }

    const dx = tx - this.x, dy = ty - this.y;
    const d = Math.hypot(dx, dy);
    const arriveDist = last ? 5 : 9;
    if (d < arriveDist) {
      this.pathIdx++;
      if (this.pathIdx >= this.path.length) {
        this.path = null;
        this.vx = this.vy = 0;
        if (this.state === 'move') this._arrive();
      }
      return;
    }
    const sp = this.speed;
    const step = Math.min(sp * dt, d);
    const nx = dx / d, ny = dy / d;
    this.x += nx * step;
    this.y += ny * step;
    this.vx = nx * sp; this.vy = ny * sp;
    this.facing = Math.atan2(ny, nx);
    this.walkPhase += (step / CFG.TILE) * 7.5;

    // stuck detection
    const moved = dist(this.x, this.y, this.lastX, this.lastY);
    if (moved < sp * dt * 0.25) {
      this.stuck += dt;
      if (this.stuck > 0.75) {
        this.stuck = 0;
        this.repaths++;
        if (this.repaths > 4) { this.stop(); }
        else if (this.goal) {
          const jitter = CFG.TILE * (0.6 + this.repaths * 0.5);
          const gx = this.goal.x + (Math.random() - 0.5) * jitter;
          const gy = this.goal.y + (Math.random() - 0.5) * jitter;
          this.path = null;
          this._requestPath(gx, gy);
        }
      }
    } else {
      this.stuck = Math.max(0, this.stuck - dt * 0.5);
    }
    this.lastX = this.x; this.lastY = this.y;
  }

  die(killer) {
    if (!this.alive) return;
    this.alive = false;
    G.spawnCorpse(this);
    const p = G.players[this.owner];
    if (p) p.pop -= 1;
    if (killer && G.players[killer.owner]) G.players[killer.owner].kills++;
    if (p) p.losses++;
  }
}

/* ------------------------------------------------------------------------
   Building
   ------------------------------------------------------------------------ */
class Building extends Entity {
  constructor(type, tx, ty, owner, prebuilt) {
    const def = BUILDING_DEFS[type];
    super(tileCenter(tx) + (def.w - 1) * CFG.TILE / 2,
          tileCenter(ty) + (def.h - 1) * CFG.TILE / 2, owner);
    this.kind = 'building';
    this.type = type;
    this.def = def;
    this.tileX = tx; this.tileY = ty;
    this.w = def.w; this.h = def.h;
    this.maxHp = def.hp;
    this.built = !!prebuilt;
    this.buildProgress = prebuilt ? 1 : 0;
    this.hp = prebuilt ? def.hp : Math.max(1, def.hp * 0.05);
    this.queue = [];
    this.trainTimer = 0;
    this.trainTotal = 0;
    this.rally = null;
    this.attackCd = 0;
    this.anim = Math.random() * 10;
    this.seed = (tx * 73856093 ^ ty * 19349663) >>> 0;
    this.smoke = 0;

    if (def.farmFood) { this.resType = 'food'; this.amount = def.farmFood; this.maxAmount = def.farmFood; }
    if (!def.noBlock) G.grid.setRect(tx, ty, this.w, this.h, true);
  }

  get left() { return this.tileX * CFG.TILE; }
  get top() { return this.tileY * CFG.TILE; }
  get right() { return (this.tileX + this.w) * CFG.TILE; }
  get bottom() { return (this.tileY + this.h) * CFG.TILE; }
  get tileW() { return this.w; }

  get pxW() { return this.w * CFG.TILE; }
  get pxH() { return this.h * CFG.TILE; }

  /** Farms are harvested like resource nodes. */
  harvest(amount) {
    const got = Math.min(this.amount, amount);
    this.amount -= got;
    if (this.amount <= 0.001) this.die();
    return got;
  }

  nearestApproach(px, py) {
    const cx = clamp(px, this.left - CFG.TILE * 0.5, this.right + CFG.TILE * 0.5);
    const cy = clamp(py, this.top - CFG.TILE * 0.5, this.bottom + CFG.TILE * 0.5);
    // push to the outside ring
    const spot = G.grid.nearestFree(Math.floor(cx / CFG.TILE), Math.floor(cy / CFG.TILE), 6);
    if (spot) return { x: tileCenter(spot[0]), y: tileCenter(spot[1]) };
    return { x: this.x, y: this.bottom + CFG.TILE };
  }

  /** `seconds` of villager-work; several builders stack, so a wall goes up faster. */
  addConstruction(seconds, builder) {
    if (this.built) return;
    this.buildProgress = Math.min(1, this.buildProgress + seconds / this.def.buildTime);
    this.hp = Math.max(this.hp, this.maxHp * (0.05 + 0.95 * this.buildProgress));
    if (this.buildProgress >= 1) {
      this.built = true;
      this.hp = this.maxHp;
      G.onBuildingComplete(this, builder);
    }
  }

  get armorValue() {
    const p = G.players[this.owner];
    return (this.def.armor || 0) + (p ? p.upg.meleeArmor : 0);
  }
  get pierceArmorValue() {
    const p = G.players[this.owner];
    return (this.def.pierceArmor || 0) + (p ? p.upg.pierceArmor : 0);
  }

  /* ------------------------------------------------------------ training */

  canQueue() { return this.queue.length < 12; }

  enqueueUnit(unitKey) {
    const p = G.players[this.owner];
    const def = UNIT_DEFS[unitKey];
    if (!def) return false;
    if (!this.canQueue()) { if (this.owner === G.humanId) G.toast('Queue is full'); return false; }
    if (!canAfford(p.resources, def.cost)) {
      if (this.owner === G.humanId) G.toast(`Not enough resources for ${def.name}`);
      return false;
    }
    payCost(p.resources, def.cost);
    this.queue.push({ kind: 'unit', key: unitKey, time: def.trainTime, cost: def.cost });
    if (this.queue.length === 1) { this.trainTimer = def.trainTime; this.trainTotal = def.trainTime; }
    return true;
  }

  enqueueResearch(key) {
    const p = G.players[this.owner];
    const def = RESEARCH_DEFS[key];
    if (!def || p.research[key] || p.researching[key]) return false;
    if (!canAfford(p.resources, def.cost)) {
      if (this.owner === G.humanId) G.toast(`Not enough resources for ${def.name}`);
      return false;
    }
    payCost(p.resources, def.cost);
    p.researching[key] = true;
    this.queue.push({ kind: 'research', key, time: def.time, cost: def.cost });
    if (this.queue.length === 1) { this.trainTimer = def.time; this.trainTotal = def.time; }
    return true;
  }

  enqueueAge() {
    const p = G.players[this.owner];
    const next = p.age + 1;
    if (next >= AGES.length) return false;
    if (this.queue.some(q => q.kind === 'age')) return false;
    const info = AGES[next];
    if (p.countBuildingsOfAge(p.age) < (info.needBuildings || 0)) {
      if (this.owner === G.humanId) G.toast(`Need ${info.needBuildings} buildings from the current age`);
      return false;
    }
    if (!canAfford(p.resources, info.cost)) {
      if (this.owner === G.humanId) G.toast(`Not enough resources to advance`);
      return false;
    }
    payCost(p.resources, info.cost);
    this.queue.push({ kind: 'age', key: next, time: 45, cost: info.cost });
    if (this.queue.length === 1) { this.trainTimer = 45; this.trainTotal = 45; }
    return true;
  }

  cancelQueue(index) {
    if (index < 0 || index >= this.queue.length) return;
    const item = this.queue[index];
    const p = G.players[this.owner];
    refundCost(p.resources, item.cost);
    if (item.kind === 'research') p.researching[item.key] = false;
    this.queue.splice(index, 1);
    if (index === 0 && this.queue.length) {
      this.trainTimer = this.queue[0].time;
      this.trainTotal = this.queue[0].time;
    }
  }

  update(dt) {
    this.anim += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.attackCd -= dt;

    if (!this.built) return;

    // production
    if (this.queue.length) {
      const item = this.queue[0];
      const p = G.players[this.owner];
      if (item.kind === 'unit' && p.pop >= p.popCap) {
        this.blockedByPop = true;
      } else {
        this.blockedByPop = false;
        this.trainTimer -= dt;
        if (this.trainTimer <= 0) {
          this.queue.shift();
          this._complete(item);
          if (this.queue.length) { this.trainTimer = this.queue[0].time; this.trainTotal = this.queue[0].time; }
        }
      }
    }

    // defensive fire
    if (this.def.atk) {
      if (this.attackCd <= 0) {
        const e = G.findNearestEnemy(this, this.def.range * CFG.TILE, true);
        if (e) {
          this.attackCd = this.def.atkSpeed;
          const shots = this.type === 'castle' ? 3 : 1;
          for (let i = 0; i < shots; i++) G.spawnProjectile(this, e, this.def.atk, 'pierce', i * 0.06);
        }
      }
    }
  }

  _complete(item) {
    const p = G.players[this.owner];
    if (item.kind === 'unit') {
      const spot = this.spawnSpot();
      const u = G.spawnUnit(item.key, spot.x, spot.y, this.owner);
      const r = this.rally;
      if (r) {
        if (r.entity && r.entity.alive) {
          if (r.entity.kind === 'resource' || (r.entity.kind === 'building' && r.entity.resType)) {
            if (u.isWorker) u.commandGather(r.entity); else u.commandMove(r.entity.x, r.entity.y);
          } else if (r.entity.owner !== this.owner && r.entity.owner >= 0) u.commandAttack(r.entity);
          else if (r.entity.kind === 'building' && !r.entity.built && u.isWorker) u.commandBuild(r.entity);
          else u.commandMove(r.entity.x, r.entity.y);
        } else u.commandMove(r.x, r.y);
      }
      if (this.owner === G.humanId) G.onUnitTrained(u);
    } else if (item.kind === 'research') {
      p.applyResearch(item.key);
      if (this.owner === G.humanId) G.toast(`${RESEARCH_DEFS[item.key].name} complete`);
    } else if (item.kind === 'age') {
      p.setAge(item.key);
      if (this.owner === G.humanId) {
        G.toast(`Advanced to the ${AGES[item.key].name}!`, 3.2);
        G.bigBanner(AGES[item.key].name);
      }
    }
  }

  spawnSpot() {
    const around = [];
    const t0x = this.tileX - 1, t0y = this.tileY - 1;
    for (let x = t0x; x <= this.tileX + this.w; x++) { around.push([x, this.tileY + this.h]); around.push([x, t0y]); }
    for (let y = t0y; y <= this.tileY + this.h; y++) { around.push([this.tileX + this.w, y]); around.push([t0x, y]); }
    // prefer tiles toward the rally point
    const rx = this.rally ? this.rally.x : this.x;
    const ry = this.rally ? this.rally.y : this.y + this.pxH;
    around.sort((a, b) =>
      dist2(tileCenter(a[0]), tileCenter(a[1]), rx, ry) - dist2(tileCenter(b[0]), tileCenter(b[1]), rx, ry));
    for (const [x, y] of around) if (G.grid.isFree(x, y)) return { x: tileCenter(x), y: tileCenter(y) };
    const nf = G.grid.nearestFree(this.tileX, this.tileY + this.h, 8);
    if (nf) return { x: tileCenter(nf[0]), y: tileCenter(nf[1]) };
    return { x: this.x, y: this.bottom + CFG.TILE };
  }

  die() {
    if (!this.alive) return;
    this.alive = false;
    if (!this.def.noBlock) G.grid.setRect(this.tileX, this.tileY, this.w, this.h, false);
    const p = G.players[this.owner];
    if (p) {
      // refund queued items
      for (const q of this.queue) refundCost(p.resources, q.cost);
      p.recomputePopCap();
    }
    G.spawnRubble(this);
  }
}

/* ------------------------------------------------------------------------
   Projectile
   ------------------------------------------------------------------------ */
class Projectile {
  constructor(from, target, damage, dtype, delay) {
    this.x = from.x; this.y = from.y - (from.kind === 'building' ? 22 : 14);
    this.sx = this.x; this.sy = this.y;
    this.target = target;
    this.damage = damage;
    this.dtype = dtype;
    this.owner = from.owner;
    this.source = from;
    this.speed = (from.def && from.def.projSpeed) || 640;
    this.alive = true;
    this.delay = delay || 0;
    this.t = 0;
    this.angle = 0;
    const d = dist(this.x, this.y, target.x, target.y);
    this.travel = d / this.speed;
    this.arc = Math.min(26, d * 0.14);
  }
  update(dt) {
    if (this.delay > 0) { this.delay -= dt; return; }
    if (!this.target || !this.target.alive) { this.alive = false; return; }
    this.t += dt / Math.max(0.05, this.travel);
    const tx = this.target.x, ty = this.target.y - (this.target.kind === 'building' ? 10 : 12);
    const px = this.x, py = this.y;
    this.x = lerp(this.sx, tx, Math.min(1, this.t));
    this.y = lerp(this.sy, ty, Math.min(1, this.t)) - Math.sin(Math.min(1, this.t) * Math.PI) * this.arc;
    this.angle = Math.atan2(this.y - py, this.x - px);
    if (this.t >= 1) {
      this.alive = false;
      G.dealDamage(this.source, this.target, this.damage, this.dtype);
    }
  }
}
