/* =========================================================================
   AI opponent — economy management, build order, army waves
   ========================================================================= */
'use strict';

// firstAttack / waveGap are in seconds. They matter more than army size for how
// the game *feels*: a beginner needs room to fumble through the build menu
// before the first raid shows up.
// firstAttack / waveGap / militaryAfter are in seconds. Timing matters more than
// raw numbers for how the game feels: a beginner needs room to fumble through
// the build menu before the first raid, and a hard opponent has to commit to an
// army early — booming longer would otherwise make it *less* threatening.
const DIFFICULTY = {
  easy:   { vilTarget: 16, firstAttack: 330, waveGap: 115, waveBase: 5, waveGrow: 2,
            thinkEvery: 1.4, militaryAfter: 270, militaryAfterVils: 14 },
  normal: { vilTarget: 24, firstAttack: 210, waveGap: 80,  waveBase: 7, waveGrow: 3,
            thinkEvery: 1.0, militaryAfter: 175, militaryAfterVils: 10 },
  hard:   { vilTarget: 32, firstAttack: 140, waveGap: 60,  waveBase: 9, waveGrow: 4,
            thinkEvery: 0.7, militaryAfter: 105, militaryAfterVils: 7 },
};

class AIPlayer {
  constructor(player, game, enemyId) {
    this.p = player;
    this.g = game;
    // Whom to march on. Explicit rather than assuming "the human", so a second
    // AI can be dropped in without it besieging itself.
    this.enemyId = enemyId !== undefined
      ? enemyId
      : (game.players.find(p => p.id !== player.id) || {}).id;
    this.cfg = DIFFICULTY[game.difficulty] || DIFFICULTY.normal;
    this.think = 0;
    this.base = null;
    this.army = [];
    this.waveSize = this.cfg.waveBase;
    this.attacking = false;
    this.attackTarget = null;
    this.nextAttackAt = this.cfg.firstAttack;
    this.buildCooldown = 0;
    this.desired = { food: 0.42, wood: 0.36, gold: 0.16, stone: 0.06 };
  }

  get tc() {
    return this.g.buildings.find(b => b.alive && b.owner === this.p.id && b.type === 'towncenter') || null;
  }

  myBuildings(type) {
    return this.g.buildings.filter(b => b.alive && b.owner === this.p.id && (!type || b.type === type));
  }
  myUnits(filterFn) {
    return this.g.units.filter(u => u.alive && u.owner === this.p.id && (!filterFn || filterFn(u)));
  }

  update(dt) {
    this.think -= dt;
    this.buildCooldown -= dt;
    if (this.think > 0) return;
    this.think = this.cfg.thinkEvery;

    const tc = this.tc;
    if (tc) this.base = { x: tc.x, y: tc.y, tx: tc.tileX, ty: tc.tileY };
    if (!this.base) return;

    this.updateEconomy();
    this.updateBuildOrder();
    this.updateAge();          // bank for the next age before spending on troops
    this.updateTraining();
    this.updateArmy();
  }

  /**
   * Resources set aside for the next age. Military production respects this,
   * otherwise the AI dribbles every scrap of food into cheap infantry and
   * never advances.
   */
  ageReserve() {
    const p = this.p;
    if (p.age >= AGES.length - 1) return null;
    const next = AGES[p.age + 1];
    if (p.countBuildingsOfAge(p.age) < (next.needBuildings || 0)) return null;
    const tc = this.tc;
    if (!tc || !tc.built || tc.queue.some(q => q.kind === 'age')) return null;
    // Early on, a handful of troops comes before hoarding: banking every scrap
    // of food behind a 500-food wall leaves the AI teched-up and defenceless,
    // and pushes its first attack past the point of relevance. Once that window
    // closes it always banks, so it still climbs the ages in a long game.
    // (`army` is one think-tick stale; close enough for a spending rule.)
    const openingOver = this.g.time > this.cfg.firstAttack + 120;
    if (!openingOver && this.army.length < 5) return null;
    return next.cost;
  }

  affordAfterReserve(cost, reserve) {
    if (!reserve) return canAfford(this.p.resources, cost);
    for (const k in cost)
      if ((this.p.resources[k] || 0) - (reserve[k] || 0) < cost[k]) return false;
    return true;
  }

  /* ------------------------------------------------------------- economy */

  updateEconomy() {
    const vils = this.myUnits(u => u.isWorker);
    const counts = { food: 0, wood: 0, gold: 0, stone: 0 };
    const idle = [];
    for (const v of vils) {
      if (v.state === 'build') continue;
      const t = v.carry.type || (v.lastNode && v.lastNode.resType);
      if (v.state === 'idle' && !v.target) idle.push(v);
      else if (t) counts[t] = (counts[t] || 0) + 1;
      else idle.push(v);
    }

    // adapt the mix to what we're short of
    const r = this.p.resources;
    const d = Object.assign({}, this.desired);
    if (this.p.age >= 1) { d.gold += 0.06; d.food -= 0.03; d.wood -= 0.03; }
    if (r.wood < 150) { d.wood += 0.14; d.food -= 0.10; }
    if (r.food < 150) { d.food += 0.14; d.wood -= 0.08; }
    if (r.stone > 500 || this.p.age < 1) d.stone = 0.02;

    const total = Math.max(1, vils.length);
    const want = {};
    for (const k in d) want[k] = Math.round(d[k] * total);

    // put idle villagers where we're most under quota
    for (const v of idle) {
      let bestK = 'food', bestGap = -Infinity;
      for (const k in want) {
        const gap = want[k] - (counts[k] || 0);
        if (gap > bestGap) { bestGap = gap; bestK = k; }
      }
      if (!this.assignToResource(v, bestK)) {
        // no node of that type — try anything
        let ok = false;
        for (const k of ['food', 'wood', 'gold', 'stone'])
          if (k !== bestK && this.assignToResource(v, k)) { ok = true; counts[k] = (counts[k] || 0) + 1; break; }
        if (!ok) continue;
      } else counts[bestK] = (counts[bestK] || 0) + 1;
    }

    // reassign over-quota gatherers when badly skewed
    for (const k in want) {
      const excess = (counts[k] || 0) - want[k];
      if (excess < 3) continue;
      let short = null;
      for (const k2 in want) if ((counts[k2] || 0) < want[k2] - 1) { short = k2; break; }
      if (!short) break;
      const movable = vils.filter(v => (v.carry.type === k || (v.lastNode && v.lastNode.resType === k)) && v.state !== 'build');
      for (let i = 0; i < Math.min(2, movable.length); i++) {
        if (this.assignToResource(movable[i], short)) { counts[k]--; counts[short]++; }
      }
    }
  }

  assignToResource(v, type) {
    const node = this.g.findNearestResource(v.x, v.y, type, 34 * CFG.TILE, this.p.id);
    if (!node) return false;
    v.commandGather(node);
    return true;
  }

  /* ---------------------------------------------------------- build order */

  updateBuildOrder() {
    if (this.buildCooldown > 0) return;
    const p = this.p;
    const bs = this.myBuildings();
    const count = (t) => bs.filter(b => b.type === t).length;
    const underConstruction = bs.filter(b => !b.built).length;
    if (underConstruction >= 2) return;

    const vils = this.myUnits(u => u.isWorker);
    if (!vils.length) return;

    let plan = null;

    // 1. houses — never get supply blocked
    if (p.popCap - p.pop <= 4 && p.popCap < CFG.MAX_POP) plan = { type: 'house' };
    // 2. early drop-off buildings
    else if (count('lumbercamp') < 1 && p.resources.wood >= 100) plan = { type: 'lumbercamp', near: 'tree' };
    else if (count('mill') < 1 && p.resources.wood >= 100) plan = { type: 'mill', near: 'bush' };
    else if (count('barracks') < 1 && p.resources.wood >= 175) plan = { type: 'barracks' };
    else if (count('miningcamp') < 1 && p.resources.wood >= 100 && p.age >= 1) plan = { type: 'miningcamp', near: 'gold' };
    // 3. feudal military
    else if (p.age >= 1 && count('archeryrange') < 1 && p.resources.wood >= 175) plan = { type: 'archeryrange' };
    else if (p.age >= 1 && count('stable') < 1 && p.resources.wood >= 175) plan = { type: 'stable' };
    else if (p.age >= 1 && count('blacksmith') < 1 && p.resources.wood >= 150) plan = { type: 'blacksmith' };
    // 4. farms once berries thin out
    else if (this.needsFarms() && p.resources.wood >= 60 && count('farm') < 10) plan = { type: 'farm', near: 'base' };
    // 5. defense + expansion
    else if (p.age >= 1 && count('tower') < 2 && p.resources.stone >= 150 && p.resources.wood >= 60) plan = { type: 'tower', near: 'base' };
    else if (p.age >= 2 && count('barracks') < 2 && p.resources.wood >= 400) plan = { type: 'barracks' };
    else if (p.age >= 2 && count('archeryrange') < 2 && p.resources.wood >= 500) plan = { type: 'archeryrange' };
    else if (p.age >= 2 && count('castle') < 1 && p.resources.stone >= 650) plan = { type: 'castle', near: 'base' };
    else if (p.age >= 2 && count('lumbercamp') < 2 && p.resources.wood >= 300) plan = { type: 'lumbercamp', near: 'tree' };

    if (!plan) return;
    if (!p.canBuild(plan.type)) return;
    if (!canAfford(p.resources, BUILDING_DEFS[plan.type].cost)) return;

    const spot = this.findBuildSpot(plan.type, plan.near);
    if (!spot) { this.buildCooldown = 3; return; }

    // pick the closest 1-2 workers
    const sorted = vils
      .filter(v => v.state !== 'build')
      .sort((a, b) => dist2(a.x, a.y, spot.x * CFG.TILE, spot.y * CFG.TILE) - dist2(b.x, b.y, spot.x * CFG.TILE, spot.y * CFG.TILE));
    const builders = sorted.slice(0, plan.type === 'castle' ? 4 : 2);
    if (!builders.length) return;

    const b = this.g.startConstruction(plan.type, spot.x, spot.y, this.p.id, builders);
    this.buildCooldown = b ? 1.5 : 4;
  }

  needsFarms() {
    if (this.p.age < 1 && this.myBuildings('farm').length >= 2) return false;
    let berries = 0;
    for (const r of this.g.resources)
      if (r.alive && r.resType === 'food' && dist2(r.x, r.y, this.base.x, this.base.y) < (26 * CFG.TILE) ** 2)
        berries += r.amount;
    const farms = this.myBuildings('farm').filter(f => f.alive);
    let farmFood = 0;
    for (const f of farms) farmFood += f.amount || 0;
    return berries + farmFood < 700;
  }

  /** Spiral-search a legal footprint, optionally biased toward a resource type. */
  findBuildSpot(type, near) {
    const def = BUILDING_DEFS[type];
    let cx = this.base.tx, cy = this.base.ty;

    if (near && near !== 'base') {
      let best = null, bestD = (30 * CFG.TILE) ** 2;
      for (const r of this.g.resources) {
        if (!r.alive || r.type !== near) continue;
        const d = dist2(r.x, r.y, this.base.x, this.base.y);
        if (d < bestD) { bestD = d; best = r; }
      }
      if (best) { cx = best.tileX; cy = best.tileY; }
    }

    const maxR = near === 'base' ? 14 : 9;
    for (let r = 1; r <= maxR; r++) {
      const candidates = [];
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          candidates.push([cx + dx, cy + dy]);
        }
      // deterministic-ish shuffle so bases don't look gridded
      for (let i = candidates.length - 1; i > 0; i--) {
        const j = (i * 7919 + this.g.time * 13 | 0) % (i + 1);
        const t = candidates[i]; candidates[i] = candidates[j]; candidates[j] = t;
      }
      for (const [x, y] of candidates) {
        if (!this.g.canPlace(type, x, y, this.p.id)) continue;
        // keep a walkable gap around the base so villagers aren't walled in
        if (!this.g.grid.rectFree(x - 1, y - 1, def.w + 2, def.h + 2) && type !== 'farm') continue;
        return { x, y };
      }
    }
    return null;
  }

  /* -------------------------------------------------------------- training */

  updateTraining() {
    const p = this.p;
    const tc = this.tc;
    const vils = this.myUnits(u => u.isWorker).length;

    const wantsArmy = (vils >= this.cfg.militaryAfterVils || this.g.time > this.cfg.militaryAfter)
      && this.myBuildings().some(b => b.built && b.def.trainLines);

    // Villagers. Once we're meant to be raising an army, leave a food floor:
    // 50-food villagers are always affordable, so training them unconditionally
    // drains the treasury to zero and no barracks ever gets to produce anything.
    if (tc && tc.built && vils < this.cfg.vilTarget && p.pop < p.popCap && tc.queue.length < 3) {
      const floor = wantsArmy ? 140 : 0;
      if (p.resources.food >= UNIT_DEFS.villager.cost.food + floor) tc.enqueueUnit('villager');
    }

    // military — keep production buildings busy once the economy has legs
    const reserve = this.ageReserve();
    if (wantsArmy) {
      for (const b of this.myBuildings()) {
        if (!b.built || !b.def.trainLines || b.queue.length >= 2) continue;
        if (p.pop >= p.popCap) break;
        const lines = b.def.trainLines;
        // prefer archers, then cavalry, then infantry — a rough but workable mix
        const order = ['archer', 'cavalry', 'infantry', 'spear'];
        let key = null;
        for (const line of order) {
          if (!lines.includes(line)) continue;
          const k = unitForLine(line, p.age);
          if (k && this.affordAfterReserve(UNIT_DEFS[k].cost, reserve)) { key = k; break; }
        }
        if (!key) {
          for (const line of lines) {
            const k = unitForLine(line, p.age);
            if (k && this.affordAfterReserve(UNIT_DEFS[k].cost, reserve)) { key = k; break; }
          }
        }
        if (key) b.enqueueUnit(key);
      }
    }

    // blacksmith upgrades
    const bs = this.myBuildings('blacksmith').find(b => b.built && b.queue.length === 0);
    if (bs) {
      for (const key of ['forging', 'fletching', 'scalemail', 'padded']) {
        const rd = RESEARCH_DEFS[key];
        if (p.research[key] || p.researching[key]) continue;
        if ((rd.age || 0) > p.age) continue;
        if (canAfford(p.resources, rd.cost) && p.resources.food > 300) { bs.enqueueResearch(key); break; }
      }
    }
  }

  updateAge() {
    const tc = this.tc;
    if (!tc || !tc.built || this.p.age >= AGES.length - 1) return;
    if (tc.queue.some(q => q.kind === 'age')) return;
    const next = AGES[this.p.age + 1];
    if (!canAfford(this.p.resources, next.cost)) return;
    if (this.p.countBuildingsOfAge(this.p.age) < (next.needBuildings || 0)) return;
    tc.enqueueAge();
  }

  /* ------------------------------------------------------------------ army */

  updateArmy() {
    const army = this.myUnits(u => u.isMilitary);
    this.army = army;

    const idleArmy = army.filter(u => u.state === 'idle' || (!u.target && !u.attackMoveGoal));

    // defend: anything hostile near our base gets everyone's attention
    const threat = this.findThreatNearBase();
    if (threat) {
      for (const u of army) {
        if (u.target && u.target.alive && dist2(u.x, u.y, this.base.x, this.base.y) < (22 * CFG.TILE) ** 2) continue;
        u.commandAttack(threat);
      }
      this.attacking = false;
      return;
    }

    if (this.attacking) {
      // keep pushing; retarget stragglers
      if (!this.attackTarget || !this.attackTarget.alive) this.attackTarget = this.pickAttackTarget();
      if (!this.attackTarget) { this.attacking = false; return; }
      for (const u of idleArmy) u.commandAttackMove(this.attackTarget.x, this.attackTarget.y);
      if (army.length <= 2) {
        this.attacking = false;
        this.waveSize += this.cfg.waveGrow;
      }
      return;
    }

    // rally point just outside the base
    const rally = this.rallyPoint();
    for (const u of idleArmy) {
      if (dist2(u.x, u.y, rally.x, rally.y) > (7 * CFG.TILE) ** 2) u.commandMove(rally.x, rally.y);
    }

    // A wave that is badly overdue goes out understrength rather than letting
    // the AI turtle forever — otherwise the harder settings, which boom longer,
    // paradoxically apply less early pressure than the easy one.
    const overdue = this.g.time > this.nextAttackAt + 50;
    const need = overdue ? Math.max(3, Math.floor(this.waveSize * 0.55)) : this.waveSize;

    if (this.g.time >= this.nextAttackAt && army.length >= need) {
      this.attackTarget = this.pickAttackTarget();
      if (this.attackTarget) {
        this.attacking = true;
        for (const u of army) u.commandAttackMove(this.attackTarget.x, this.attackTarget.y);
        this.nextAttackAt = this.g.time + this.cfg.waveGap;
        this.waveSize += this.cfg.waveGrow;
      }
    }
  }

  rallyPoint() {
    const eb = this.g.buildings.find(b => b.alive && b.owner === this.enemyId && b.type === 'towncenter');
    const tx = eb ? eb.x : WORLD_W / 2, ty = eb ? eb.y : WORLD_H / 2;
    const a = Math.atan2(ty - this.base.y, tx - this.base.x);
    return { x: this.base.x + Math.cos(a) * CFG.TILE * 6, y: this.base.y + Math.sin(a) * CFG.TILE * 6 };
  }

  findThreatNearBase() {
    let best = null, bestD = (20 * CFG.TILE) ** 2;
    for (const u of this.g.units) {
      if (!u.alive || u.owner === this.p.id || u.owner < 0) continue;
      const d = dist2(u.x, u.y, this.base.x, this.base.y);
      if (d < bestD) { bestD = d; best = u; }
    }
    for (const b of this.g.buildings) {
      if (!b.alive || b.owner === this.p.id || b.owner < 0) continue;
      const d = dist2(b.x, b.y, this.base.x, this.base.y);
      if (d < (14 * CFG.TILE) ** 2 && d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  pickAttackTarget() {
    const hid = this.enemyId;
    // prefer military production, then town centers, then anything
    const prio = ['barracks', 'archeryrange', 'stable', 'towncenter', 'castle', 'tower'];
    let best = null, bestScore = -Infinity;
    for (const b of this.g.buildings) {
      if (!b.alive || b.owner !== hid) continue;
      const pi = prio.indexOf(b.type);
      const d = Math.sqrt(dist2(b.x, b.y, this.base.x, this.base.y));
      const score = (pi >= 0 ? (10 - pi) * 60 : 0) - d * 0.35;
      if (score > bestScore) { bestScore = score; best = b; }
    }
    if (best) return best;
    for (const u of this.g.units) if (u.alive && u.owner === hid) return u;
    return null;
  }
}
