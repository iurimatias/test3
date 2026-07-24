/* =========================================================================
   UI — HUD, command card, build menu, overlays
   ========================================================================= */
'use strict';

const ICON_CACHE = {};

/**
 * Icons are cached as data URLs, not canvases: cloning a <canvas> element
 * copies the node but not its bitmap, so every cloned icon would come out
 * blank. <img> clones keep their src.
 */
function iconEl(url, cls) {
  const img = document.createElement('img');
  img.src = url;
  img.className = cls || 'icon';
  img.draggable = false;
  return img;
}

/** Render a unit as a small icon by reusing the in-game art. */
function makeUnitIcon(type, colorIdx) {
  const key = `u:${type}:${colorIdx}`;
  if (ICON_CACHE[key]) return ICON_CACHE[key];
  const cv = document.createElement('canvas');
  const S = 64;
  cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d');
  const def = UNIT_DEFS[type];
  const fake = {
    def, type, x: 0, y: 0, facing: 0, hitFlash: 0, swing: 0,
    path: null, walkPhase: 0, anim: 0, state: 'idle',
    carry: { type: null, amount: 0 }, radius: def.radius,
  };
  // prefer the real artwork, fitted to the button
  const sprite = unitSpriteName(fake) + '.f0';
  if (Sprites.has(sprite)) {
    fitSprite(ctx, sprite, S, colorIdx);
  } else {
    const scale = def.art === 'horse' ? 1.15 : 1.35;
    ctx.save();
    ctx.translate(S / 2, S - 8);
    ctx.scale(scale, scale);
    drawUnit(ctx, fake, PLAYER_COLORS[colorIdx]);
    ctx.restore();
  }
  ICON_CACHE[key] = cv.toDataURL();
  return ICON_CACHE[key];
}

function makeBuildingIcon(type, colorIdx) {
  const key = `b:${type}:${colorIdx}`;
  if (ICON_CACHE[key]) return ICON_CACHE[key];
  const def = BUILDING_DEFS[type];
  const cv = document.createElement('canvas');
  const S = 64;
  cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d');
  const pxW = def.w * CFG.TILE, pxH = def.h * CFG.TILE;
  const fake = {
    def, type, kind: 'building', seed: 12345, built: true, hitFlash: 0,
    w: def.w, h: def.h, tileX: 0, tileY: 0,
    left: 0, top: 0, right: pxW, bottom: pxH,
    pxW, pxH, x: 0, y: 0, anim: 0,
    amount: def.farmFood || 0, maxAmount: def.farmFood || 1,
    buildProgress: 1,
  };
  // Fit the projected diamond plus whatever the structure rises to.
  if (Sprites.has('b.' + type)) {
    fitSprite(ctx, 'b.' + type, S, colorIdx);
  } else {
    const tall = { towncenter: 118, castle: 104, tower: 86, farm: 12 }[type] || 66;
    const wide = (pxW + pxH) * 0.5;
    const scale = Math.min((S - 4) / wide, (S - 4) / (tall + (pxW + pxH) * 0.25));
    ctx.save();
    ctx.translate(S / 2, S - 5);
    ctx.scale(scale, scale);
    drawBuilding(ctx, fake, PLAYER_COLORS[colorIdx], 0);
    ctx.restore();
  }
  ICON_CACHE[key] = cv.toDataURL();
  return ICON_CACHE[key];
}

/** Draw an atlas sprite scaled to fill a square icon of side `S`. */
function fitSprite(ctx, name, S, colorIdx) {
  const sp = Sprites.atlas[name];
  const k = Math.min((S - 4) / sp.w, (S - 4) / sp.h);
  const w = sp.w * k, h = sp.h * k;
  Sprites.draw(ctx, name, S / 2 + (sp.ax - sp.w / 2) * k, S - 2 - (sp.h - sp.ay) * k,
    colorIdx, false, (k * sp.w) / sp.worldW);
}

const HOTKEY_SEQ = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY'];
const HOTKEY_LABEL = { KeyQ: 'Q', KeyW: 'W', KeyE: 'E', KeyR: 'R', KeyT: 'T', KeyY: 'Y' };

const UI = {
  buildMenuOpen: false,
  buttons: [],

  init() {
    this.el = {
      food: document.getElementById('res-food'),
      wood: document.getElementById('res-wood'),
      gold: document.getElementById('res-gold'),
      stone: document.getElementById('res-stone'),
      pop: document.getElementById('res-pop'),
      age: document.getElementById('hud-age'),
      clock: document.getElementById('hud-clock'),
      idle: document.getElementById('hud-idle'),
      card: document.getElementById('command-card'),
      selName: document.getElementById('sel-name'),
      selBody: document.getElementById('sel-body'),
      selIcon: document.getElementById('sel-icon'),
      queue: document.getElementById('queue'),
      toasts: document.getElementById('toasts'),
      banner: document.getElementById('banner'),
      gameover: document.getElementById('gameover'),
      goTitle: document.getElementById('go-title'),
      goBody: document.getElementById('go-body'),
      objectives: document.getElementById('obj-list'),
    };

    document.getElementById('btn-idle').addEventListener('click', () => {
      const v = G.findIdleVillager();
      if (v) { G.selectOne(v, false); G.cam.centerOn(v.x, v.y); } else G.toast('No idle villagers');
    });
    document.getElementById('btn-army').addEventListener('click', () => {
      const list = G.units.filter(u => u.alive && u.owner === G.humanId && u.isMilitary);
      if (list.length) G.select(list.slice(0, 60), false); else G.toast('No army yet');
    });
    for (const id of ['btn-help', 'btn-help2', 'btn-score', 'btn-diplo', 'btn-tech'])
      document.getElementById(id).addEventListener('click', () => this.toggleHelp());
    document.getElementById('help-close').addEventListener('click', () => this.toggleHelp(false));
    document.getElementById('go-again').addEventListener('click', () => location.reload());
  },

  toggleHelp(force) {
    const h = document.getElementById('help');
    const show = force === undefined ? h.classList.contains('hidden') : force;
    h.classList.toggle('hidden', !show);
  },

  /* ------------------------------------------------------------ HUD tick */

  update() {
    const p = G.players[G.humanId];
    if (!p) return;
    this.el.food.textContent = fmtRes(p.resources.food);
    this.el.wood.textContent = fmtRes(p.resources.wood);
    this.el.gold.textContent = fmtRes(p.resources.gold);
    this.el.stone.textContent = fmtRes(p.resources.stone);
    this.el.pop.textContent = `${p.pop}/${p.popCap}`;
    this.el.pop.classList.toggle('warn', p.pop >= p.popCap);
    this.el.age.textContent = AGES[p.age].name;

    const t = Math.floor(G.time);
    this.el.clock.textContent = `${String((t / 60) | 0).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;

    const idle = G.units.filter(u => u.alive && u.owner === G.humanId && u.isWorker && u.state === 'idle' && !u.target).length;
    this.el.idle.textContent = idle;
    this.el.idle.parentElement.classList.toggle('warn', idle > 0);
    this.updateObjectives(p);

    // banner
    if (G.banner) {
      this.el.banner.textContent = G.banner.text;
      this.el.banner.classList.remove('hidden');
      this.el.banner.style.opacity = String(Math.min(1, (G.banner.life - G.banner.t) * 1.5));
    } else this.el.banner.classList.add('hidden');

    this.updateButtonStates();
    this.updateQueue();
    this.updateSelectionStats();
  },

  /**
   * A short rolling goal list. Derived from live state rather than scripted,
   * so it always points at something useful to do next.
   */
  updateObjectives(p) {
    const mine = (t) => G.buildings.some(b => b.alive && b.built && b.owner === p.id && b.type === t);
    const army = G.units.filter(u => u.alive && u.owner === p.id && u.isMilitary).length;
    const vils = G.units.filter(u => u.alive && u.owner === p.id && u.isWorker).length;
    const goals = [];

    if (vils < 12) goals.push({ t: `Train ${12 - vils} more Villagers`, done: false });
    if (!mine('house') && p.popCap - p.pop <= 2) goals.push({ t: 'Build a House', done: false });
    if (!mine('lumbercamp')) goals.push({ t: 'Build a Lumber Camp', done: mine('lumbercamp') });
    else if (!mine('mill')) goals.push({ t: 'Build a Mill', done: false });
    if (!mine('barracks')) goals.push({ t: 'Build a Barracks', done: false });
    else if (p.age >= 1 && !mine('blacksmith')) goals.push({ t: 'Build a Blacksmith', done: false });
    if (mine('barracks') && army < 10) goals.push({ t: `Train ${10 - army} more Soldiers`, done: false });
    if (p.age < AGES.length - 1) goals.push({ t: `Advance to ${AGES[p.age + 1].name}`, done: false });
    goals.push({ t: 'Destroy the Red Empire', done: false });

    const show = goals.slice(0, 3);
    const sig = show.map(g => g.t).join('|');
    if (sig === this._objSig) return;
    this._objSig = sig;
    this.el.objectives.innerHTML = '';
    for (const g of show) {
      const li = document.createElement('li');
      li.textContent = g.t;
      if (g.done) li.className = 'done';
      this.el.objectives.appendChild(li);
    }
  },

  updateButtonStates() {
    const p = G.players[G.humanId];
    for (const b of this.buttons) {
      if (!b.el) continue;
      let ok = true;
      if (b.cost && !canAfford(p.resources, b.cost)) ok = false;
      if (b.check && !b.check()) ok = false;
      b.el.classList.toggle('disabled', !ok);
    }
  },

  updateQueue() {
    const b = G.selectedBuilding;
    const q = this.el.queue;
    if (!b || !b.queue.length) { q.innerHTML = ''; q.classList.add('hidden'); return; }
    q.classList.remove('hidden');
    const sig = b.id + ':' + b.queue.map(i => i.key).join(',');
    if (this._qSig !== sig) {
      this._qSig = sig;
      q.innerHTML = '';
      const count = document.createElement('div');
      count.className = 'qitem count';
      count.textContent = b.queue.length;
      count.title = 'Items queued';
      q.appendChild(count);
      b.queue.forEach((item, i) => {
        const d = document.createElement('div');
        d.className = 'qitem';
        if (item.kind === 'unit') d.appendChild(iconEl(makeUnitIcon(item.key, G.humanId)));
        else d.textContent = item.kind === 'age' ? '⏫' : '⚒';
        d.title = 'Click to cancel';
        d.addEventListener('click', () => { b.cancelQueue(i); this._qSig = null; });
        if (i === 0) { const bar = document.createElement('span'); bar.className = 'qbar'; d.appendChild(bar); }
        q.appendChild(d);
      });
    }
    const first = q.querySelector('.qbar');
    if (first && b.trainTotal) {
      first.style.width = `${clamp(1 - b.trainTimer / b.trainTotal, 0, 1) * 100}%`;
    }
    q.classList.toggle('blocked', !!b.blockedByPop);
  },

  updateSelectionStats() {
    const sel = G.selection;
    if (sel.length !== 1) return;
    const e = sel[0];
    const hpEl = this.el.selBody.querySelector('.hp-val');
    if (hpEl) hpEl.textContent = `${Math.max(0, Math.ceil(e.hp))}/${e.maxHp}`;
    const amtEl = this.el.selBody.querySelector('.amt-val');
    if (amtEl && e.amount !== undefined) amtEl.textContent = Math.ceil(e.amount);
    const carEl = this.el.selBody.querySelector('.carry-val');
    if (carEl && e.carry) carEl.textContent = e.carry.amount > 0.5
      ? `${Math.floor(e.carry.amount)} ${e.carry.type}` : '—';
    const prEl = this.el.selBody.querySelector('.prog-val');
    if (prEl && e.kind === 'building' && !e.built) prEl.style.width = `${e.buildProgress * 100}%`;
  },

  /* -------------------------------------------------------- selection UI */

  refreshSelection() {
    const sel = G.selection;
    this.buttons = [];
    this.el.card.innerHTML = '';
    this._qSig = null;

    if (!sel.length) {
      this.buildMenuOpen = false;
      this.el.selName.textContent = 'Nothing selected';
      this.el.selBody.innerHTML = '<div class="hint">Left-click to select · right-click to command</div>';
      this.el.selIcon.innerHTML = '';
      this.el.queue.classList.add('hidden');
      return;
    }

    // ---- header ----
    const first = sel[0];
    const mine = first.owner === G.humanId;
    this.el.selIcon.innerHTML = '';
    if (sel.length > 1 && sel.every(e => e.kind === 'unit')) {
      this.el.selName.textContent = `${sel.length} units`;
      this.el.selBody.innerHTML = '';
      const grid = document.createElement('div');
      grid.className = 'unit-grid';
      const counts = {};
      for (const u of sel) counts[u.type] = (counts[u.type] || 0) + 1;
      for (const type in counts) {
        const chip = document.createElement('div');
        chip.className = 'chip';
        chip.appendChild(iconEl(makeUnitIcon(type, first.owner)));
        const n = document.createElement('span');
        n.textContent = '×' + counts[type];
        chip.appendChild(n);
        chip.title = UNIT_DEFS[type].name;
        chip.addEventListener('click', () => {
          G.select(sel.filter(u => u.type === type), false);
        });
        grid.appendChild(chip);
      }
      this.el.selBody.appendChild(grid);
    } else {
      const def = first.def;
      this.el.selName.textContent = first.kind === 'resource'
        ? { tree: 'Tree', bush: 'Berry Bush', gold: 'Gold Mine', stone: 'Stone Mine' }[first.type]
        : def.name;
      const icon = first.kind === 'unit' ? makeUnitIcon(first.type, first.owner)
        : first.kind === 'building' ? makeBuildingIcon(first.type, first.owner) : null;
      if (icon) this.el.selIcon.appendChild(iconEl(icon));

      const stat = (icon, value, cls) =>
        `<div class="stat"><i class="si si-${icon}"></i><span class="sv ${cls || ''}">${value}</span></div>`;
      const rows = [];
      if (first.kind !== 'resource') {
        rows.push(stat('hp', `${Math.ceil(first.hp)}/${first.maxHp}`, 'hp-val'));
      }
      if (first.kind === 'unit') {
        rows.push(stat('atk', first.attackValue));
        rows.push(stat('armor', `${first.armorValue}/${first.pierceArmorValue}`));
        if (first.isWorker) rows.push(stat('pop', '<span class="carry-val">—</span>'));
      } else if (first.kind === 'resource') {
        rows.push(stat('pop', `<span class="amt-val">${Math.ceil(first.amount)}</span> ${first.resType}`));
      } else if (first.kind === 'building') {
        rows.push(stat('armor', `${first.def.armor || 0}/${first.def.pierceArmor || 0}`));
        if (first.def.atk) rows.push(stat('atk', first.def.atk));
        if (first.def.pop) rows.push(stat('pop', `${first.def.pop}+1`));
        if (first.def.farmFood) rows.push(stat('pop', `<span class="amt-val">${Math.ceil(first.amount)}</span> food`));
      }
      const prog = (first.kind === 'building' && !first.built)
        ? `<div class="progress"><span class="prog-val" style="width:${first.buildProgress * 100}%"></span></div>` : '';
      this.el.selBody.innerHTML =
        `<div class="stats">${rows.join('')}</div>` + prog +
        (first.def && first.def.desc ? `<div class="desc">${first.def.desc}</div>` : '');
    }

    if (!mine) return;

    // ---- command card ----
    if (this.buildMenuOpen) this.buildBuildMenu();
    else this.buildDefaultCard();
    this.layoutCard();
  },

  buildDefaultCard() {
    const sel = G.selection;
    const units = G.selectedUnits;
    const p = G.players[G.humanId];

    if (units.length) {
      const workers = units.filter(u => u.isWorker);
      if (workers.length) {
        this.addButton({
          id: 'build', label: 'Build', emoji: '🔨',
          tooltip: 'Open the build menu  [B]',
          onClick: () => this.toggleBuildMenu(),
        });
      }
      this.addButton({
        id: 'stop', label: 'Stop', emoji: '✋', hotkeyOverride: 'S',
        tooltip: 'Stop what you are doing  [S]',
        onClick: () => { for (const u of units) u.stop(); },
      });
      this.addButton({
        id: 'amove', label: 'Attack', emoji: '⚔', hotkeyOverride: 'A',
        tooltip: 'Attack-move to a point  [A]',
        onClick: () => {
          Input.attackMoveMode = true;
          document.body.classList.add('cursor-attack');
          G.toast('Attack-move: click a destination');
        },
      });
      return;
    }

    const b = G.selectedBuilding;
    if (!b) return;
    if (!b.built) {
      this.addButton({
        id: 'cancelb', label: 'Cancel', emoji: '✖',
        tooltip: 'Cancel construction and refund',
        onClick: () => {
          refundCost(p.resources, b.def.cost);
          b.die();
          G.clearSelection(); this.refreshSelection();
        },
      });
      return;
    }

    // trainable units
    const trainKeys = [];
    if (b.def.trains) for (const t of b.def.trains) trainKeys.push(t);
    if (b.def.trainLines) for (const line of b.def.trainLines) {
      const k = unitForLine(line, p.age);
      if (k) trainKeys.push(k);
    }
    for (const key of trainKeys) {
      const def = UNIT_DEFS[key];
      this.addButton({
        id: 'train:' + key, label: def.name, unitIcon: key, cost: def.cost,
        tooltip: `${def.name}\n${def.desc || ''}\nHP ${def.hp} · Attack ${def.atk} · ${def.trainTime}s\n${costString(def.cost)}`,
        check: () => p.pop < p.popCap || b.queue.length > 0,
        onClick: () => { b.enqueueUnit(key); this._qSig = null; },
      });
    }

    // research
    if (b.def.researches) {
      for (const key of b.def.researches) {
        const rd = RESEARCH_DEFS[key];
        if ((rd.age || 0) > p.age) continue;
        if (p.research[key]) continue;
        this.addButton({
          id: 'res:' + key, label: rd.name, emoji: '⚒', cost: rd.cost,
          tooltip: `${rd.name}\n${rd.desc}\n${costString(rd.cost)}`,
          check: () => !p.researching[key],
          onClick: () => { b.enqueueResearch(key); this._qSig = null; },
        });
      }
    }
    if (b.type === 'towncenter') {
      for (const key of ['loom', 'wheelbarrow']) {
        const rd = RESEARCH_DEFS[key];
        if ((rd.age || 0) > p.age || p.research[key]) continue;
        this.addButton({
          id: 'res:' + key, label: rd.name, emoji: '⚒', cost: rd.cost,
          tooltip: `${rd.name}\n${rd.desc}\n${costString(rd.cost)}`,
          check: () => !p.researching[key],
          onClick: () => { b.enqueueResearch(key); this._qSig = null; },
        });
      }
    }

    // age advance
    if (b.def.canAge && p.age < AGES.length - 1) {
      const next = AGES[p.age + 1];
      this.addButton({
        id: 'age', label: next.name, emoji: '⏫', cost: next.cost,
        tooltip: `Advance to the ${next.name}\nRequires ${next.needBuildings} buildings of the current age\n${costString(next.cost)}`,
        check: () => p.countBuildingsOfAge(p.age) >= (next.needBuildings || 0),
        onClick: () => { b.enqueueAge(); this._qSig = null; },
      });
    }
  },

  buildBuildMenu() {
    const p = G.players[G.humanId];
    for (const type of BUILD_MENU) {
      const def = BUILDING_DEFS[type];
      if ((def.age || 0) > p.age) continue;
      this.addButton({
        id: 'place:' + type, label: def.name, buildingIcon: type, cost: def.cost,
        tooltip: `${def.name}\n${def.desc}\nHP ${def.hp} · ${def.buildTime}s\n${costString(def.cost)}`,
        check: () => p.canBuild(type),
        onClick: () => {
          G.placing = type;
          G.placeTile = null;
          G.toast(`Placing ${def.name} — click a spot, Esc to cancel`);
        },
      });
    }
    this.addButton({
      id: 'back', label: 'Back', emoji: '✕', cls: 'cancel',
      tooltip: 'Back to commands  [Esc]',
      onClick: () => this.closeBuildMenu(),
    });
  },

  addButton(spec) {
    const el = document.createElement('button');
    el.className = 'cmd' + (spec.cls ? ' ' + spec.cls : '');
    el.type = 'button';

    if (spec.unitIcon) el.appendChild(iconEl(makeUnitIcon(spec.unitIcon, G.humanId)));
    else if (spec.buildingIcon) el.appendChild(iconEl(makeBuildingIcon(spec.buildingIcon, G.humanId)));
    else {
      const s = document.createElement('span');
      s.className = 'emoji';
      s.textContent = spec.emoji || '?';
      el.appendChild(s);
    }

    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = spec.label;
    el.appendChild(lbl);

    if (spec.cost) {
      const c = document.createElement('span');
      c.className = 'cost';
      c.textContent = costString(spec.cost);
      el.appendChild(c);
    }

    el.title = spec.tooltip || spec.label;
    el.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (el.classList.contains('disabled')) return;
      spec.onClick();
      if (spec.id !== 'build' && !spec.id.startsWith('place:')) this.updateButtonStates();
    });

    spec.el = el;
    this.buttons.push(spec);
    this.el.card.appendChild(el);
  },

  layoutCard() {
    // assign hotkeys in order
    let i = 0;
    for (const b of this.buttons) {
      let label = b.hotkeyOverride;
      if (!label && i < HOTKEY_SEQ.length) {
        b.hotkey = HOTKEY_SEQ[i];
        label = HOTKEY_LABEL[b.hotkey];
        i++;
      }
      if (label) {
        const k = document.createElement('span');
        k.className = 'hk';
        k.textContent = label;
        b.el.appendChild(k);
      }
    }
    this.updateButtonStates();
  },

  hotkey(code) {
    for (const b of this.buttons) {
      if (b.hotkey === code && b.el && !b.el.classList.contains('disabled')) {
        b.onClick();
        b.el.classList.add('flash');
        setTimeout(() => b.el && b.el.classList.remove('flash'), 140);
        return;
      }
    }
  },

  toggleBuildMenu() {
    this.buildMenuOpen = !this.buildMenuOpen;
    G.placing = null;
    this.refreshSelection();
  },
  closeBuildMenu() {
    this.buildMenuOpen = false;
    G.placing = null;
    this.refreshSelection();
  },

  /* ------------------------------------------------------------- overlays */

  renderToasts() {
    const el = this.el.toasts;
    el.innerHTML = '';
    for (const t of G.toasts) {
      const d = document.createElement('div');
      d.className = 'toast';
      d.textContent = t.msg;
      el.appendChild(d);
    }
  },

  showGameOver(res) {
    const won = res.winner === G.humanId;
    this.el.goTitle.textContent = won ? 'Victory!' : 'Defeat';
    this.el.goTitle.className = won ? 'win' : 'lose';
    const p = G.players[G.humanId];
    const t = Math.floor(G.time);
    this.el.goBody.innerHTML = `
      <div class="go-stats">
        <div><span>Time</span><b>${String((t / 60) | 0).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}</b></div>
        <div><span>Age reached</span><b>${AGES[p.age].name}</b></div>
        <div><span>Units killed</span><b>${p.kills}</b></div>
        <div><span>Units lost</span><b>${p.losses}</b></div>
        <div><span>Food gathered</span><b>${Math.floor(p.gathered.food)}</b></div>
        <div><span>Wood gathered</span><b>${Math.floor(p.gathered.wood)}</b></div>
        <div><span>Gold gathered</span><b>${Math.floor(p.gathered.gold)}</b></div>
        <div><span>Stone gathered</span><b>${Math.floor(p.gathered.stone)}</b></div>
      </div>`;
    this.el.gameover.classList.remove('hidden');
  },
};
