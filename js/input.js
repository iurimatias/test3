/* =========================================================================
   Input — mouse, keyboard, minimap, camera control
   ========================================================================= */
'use strict';

/**
 * Physical key identity, preferring `event.code` so the layout-independent
 * position wins on AZERTY/Dvorak. Some sources (on-screen keyboards, a few
 * IMEs, automation) leave `code` empty, so fall back to the printed key.
 */
const KEY_ALIASES = {
  ' ': 'Space', '.': 'Period', ',': 'Comma',
  '=': 'Equal', '+': 'Equal', '-': 'Minus', '_': 'Minus',
};
function keyCodeOf(e) {
  if (e.code) return e.code;
  const k = e.key;
  if (!k) return '';
  if (k.length === 1) {
    if (/[a-z]/i.test(k)) return 'Key' + k.toUpperCase();
    if (/[0-9]/.test(k)) return 'Digit' + k;
  }
  return KEY_ALIASES[k] || k;
}

const Input = {
  keys: {},
  mouse: { x: 0, y: 0, wx: 0, wy: 0, down: false, rdown: false },
  panning: false,
  panStart: null,
  attackMoveMode: false,
  dragStart: null,
  DRAG_THRESHOLD: 6,
  lastClickTime: 0,
  lastClickEntity: null,

  init(canvas, minimap) {
    this.canvas = canvas;
    this.minimap = minimap;
    // Start the pointer in the middle; edge-scrolling stays off until the
    // player actually moves the mouse, or the view slides away on frame one.
    const r0 = canvas.getBoundingClientRect();
    this.mouse.x = r0.width / 2;
    this.mouse.y = r0.height / 2;
    this.mouse.moved = false;

    canvas.addEventListener('mousedown', e => this.onMouseDown(e));
    window.addEventListener('mousemove', e => this.onMouseMove(e));
    window.addEventListener('mouseup', e => this.onMouseUp(e));
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('wheel', e => this.onWheel(e), { passive: false });
    canvas.addEventListener('mouseleave', () => { this.mouse.onCanvas = false; });
    canvas.addEventListener('mouseenter', () => { this.mouse.onCanvas = true; });

    minimap.addEventListener('mousedown', e => this.onMinimapDown(e));
    minimap.addEventListener('contextmenu', e => e.preventDefault());
    minimap.addEventListener('mousemove', e => { if (this._mmDrag) this.onMinimapDown(e); });
    window.addEventListener('mouseup', () => { this._mmDrag = false; });

    window.addEventListener('keydown', e => this.onKeyDown(e));
    window.addEventListener('keyup', e => { this.keys[keyCodeOf(e)] = false; });
    window.addEventListener('blur', () => { this.keys = {}; });
  },

  /* ------------------------------------------------------------- pointer */

  _updateMouse(e) {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.x = e.clientX - r.left;
    this.mouse.y = e.clientY - r.top;
    const [wx, wy] = G.cam.toWorld(this.mouse.x, this.mouse.y);
    const [ix, iy] = G.cam.toIso(this.mouse.x, this.mouse.y);
    this.mouse.wx = wx; this.mouse.wy = wy;
    this.mouse.ix = ix; this.mouse.iy = iy;
  },

  pick() { return G.entityAt(this.mouse.wx, this.mouse.wy, this.mouse.ix, this.mouse.iy); },

  onMouseDown(e) {
    if (!G.running || G.gameOver) return;
    this._updateMouse(e);
    this.canvas.focus();

    if (e.button === 1 || (e.button === 0 && this.keys.Space)) {
      this.panning = true;
      this.panStart = { mx: this.mouse.x, my: this.mouse.y, cx: G.cam.x, cy: G.cam.y };
      e.preventDefault();
      return;
    }

    if (e.button === 0) {
      // placing a building?
      if (G.placing) {
        this.tryPlace(e.shiftKey);
        return;
      }
      if (this.attackMoveMode) {
        this.issueAttackMove(this.mouse.wx, this.mouse.wy);
        this.attackMoveMode = false;
        document.body.classList.remove('cursor-attack');
        return;
      }
      this.mouse.down = true;
      this.dragStart = { x: this.mouse.x, y: this.mouse.y };
      G.dragSelect = null;
    } else if (e.button === 2) {
      this.issueCommand(this.mouse.wx, this.mouse.wy, e.shiftKey, this.pick());
    }
  },

  onMouseMove(e) {
    if (!G.running) return;
    this._updateMouse(e);
    this.mouse.moved = true;

    if (this.panning && this.panStart) {
      G.cam.x = this.panStart.cx - (this.mouse.x - this.panStart.mx) / G.cam.zoom;
      G.cam.y = this.panStart.cy - (this.mouse.y - this.panStart.my) / G.cam.zoom;
      G.cam.clampToWorld();
      return;
    }

    if (this.mouse.down && this.dragStart) {
      const dx = this.mouse.x - this.dragStart.x, dy = this.mouse.y - this.dragStart.y;
      if (Math.hypot(dx, dy) > this.DRAG_THRESHOLD) {
        G.dragSelect = { x0: this.dragStart.x, y0: this.dragStart.y, x1: this.mouse.x, y1: this.mouse.y };
      }
    }

    // building placement ghost
    if (G.placing) {
      const def = BUILDING_DEFS[G.placing];
      const tx = Math.floor(this.mouse.wx / CFG.TILE) - ((def.w - 1) >> 1);
      const ty = Math.floor(this.mouse.wy / CFG.TILE) - ((def.h - 1) >> 1);
      G.placeTile = { x: tx, y: ty };
      G.placeValid = G.canPlace(G.placing, tx, ty, G.humanId) &&
        G.rectExplored(G.placing, tx, ty) &&
        canAfford(G.players[G.humanId].resources, def.cost);
    }

    G.hoverEntity = this.pick();
    this._updateCursor();
  },

  _updateCursor() {
    const b = document.body;
    b.classList.remove('cursor-attack-hover', 'cursor-gather', 'cursor-build-hover');
    if (this.attackMoveMode || G.placing) return;
    const h = G.hoverEntity;
    if (!h || !G.selection.length) return;
    const mine = G.selectedUnits.length > 0;
    if (!mine) return;
    if (h.owner >= 0 && h.owner !== G.humanId) b.classList.add('cursor-attack-hover');
    else if (h.kind === 'resource' || (h.kind === 'building' && h.def.farmFood)) b.classList.add('cursor-gather');
    else if (h.kind === 'building' && h.owner === G.humanId && !h.built) b.classList.add('cursor-build-hover');
  },

  onMouseUp(e) {
    if (e.button === 1) { this.panning = false; return; }
    if (e.button === 0 && this.panning) { this.panning = false; return; }
    if (e.button !== 0) return;
    if (!this.mouse.down) return;
    this.mouse.down = false;

    if (G.dragSelect) {
      this.boxSelect(G.dragSelect, e.shiftKey);
      G.dragSelect = null;
      this.dragStart = null;
      return;
    }
    this.dragStart = null;

    // plain click select
    const ent = this.pick();
    const now = performance.now();
    const isDouble = ent && ent === this.lastClickEntity && (now - this.lastClickTime) < 320;
    this.lastClickTime = now; this.lastClickEntity = ent;

    if (isDouble && ent.kind === 'unit' && ent.owner === G.humanId) {
      G.selectAllOfTypeOnScreen(ent.type);
      return;
    }
    G.selectOne(ent, e.shiftKey);
  },

  boxSelect(box, additive) {
    // A screen rectangle maps to a rotated quad in world space, so test each
    // entity where it is actually drawn instead of inverting the rectangle.
    const sx0 = Math.min(box.x0, box.x1), sx1 = Math.max(box.x0, box.x1);
    const sy0 = Math.min(box.y0, box.y1), sy1 = Math.max(box.y0, box.y1);
    const inBox = (wx, wy) => {
      const [px, py] = G.cam.toScreen(wx, wy);
      return px >= sx0 && px <= sx1 && py >= sy0 - 20 && py <= sy1 + 8;
    };
    // prefer own units; fall back to own buildings, then anything visible
    let picked = G.units.filter(u =>
      u.alive && u.owner === G.humanId && inBox(u.x, u.y));
    if (!picked.length) {
      picked = G.buildings.filter(b =>
        b.alive && b.owner === G.humanId && inBox(b.x, b.y));
    }
    if (!picked.length) {
      picked = G.units.filter(u => u.alive && inBox(u.x, u.y) &&
        (!CFG.FOG || G.fog.isVisiblePx(u.x, u.y)));
    }
    // military first: dragging over a mixed crowd should grab the army
    const military = picked.filter(u => u.kind === 'unit' && u.isMilitary);
    if (military.length) picked = military;
    if (picked.length > 60) picked = picked.slice(0, 60);
    G.select(picked, additive);
  },

  onWheel(e) {
    e.preventDefault();
    const before = G.cam.toIso(this.mouse.x, this.mouse.y);
    const factor = e.deltaY < 0 ? 1.14 : 1 / 1.14;
    G.cam.zoom = clamp(G.cam.zoom * factor, 0.5, 2.6);
    const after = G.cam.toIso(this.mouse.x, this.mouse.y);
    G.cam.x += before[0] - after[0];
    G.cam.y += before[1] - after[1];
    G.cam.clampToWorld();
  },

  /* ------------------------------------------------------------- commands */

  /**
   * `target` is what the cursor is over, passed in explicitly: right-clicking
   * the map picks an entity, right-clicking the minimap never does.
   */
  issueCommand(wx, wy, queued, target) {
    const units = G.selectedUnits;
    const bld = G.selectedBuilding;

    // setting a rally point on a selected production building
    if (!units.length && bld && (bld.def.trains || bld.def.trainLines)) {
      const ent = target;
      bld.rally = { x: wx, y: wy, entity: ent && ent !== bld ? ent : null };
      G.ping(wx, wy, 'rgba(47,122,47,0.9)');
      return;
    }
    if (!units.length) return;


    // --- attack an enemy ---
    if (target && target.owner >= 0 && target.owner !== G.humanId) {
      for (const u of units) u.commandAttack(target);
      G.ping(target.x, target.y, 'rgba(190,50,40,0.95)');
      return;
    }

    // --- gather / build / repair ---
    if (target) {
      const workers = units.filter(u => u.isWorker);
      const soldiers = units.filter(u => !u.isWorker);

      if (target.kind === 'resource' || (target.kind === 'building' && target.def.farmFood && target.built)) {
        for (const u of workers) u.commandGather(target);
        this.spreadMove(soldiers, target.x, target.y);
        if (workers.length) G.ping(target.x, target.y, 'rgba(200,150,40,0.95)');
        return;
      }
      if (target.kind === 'building' && target.owner === G.humanId) {
        if (!target.built) {
          for (const u of workers) u.commandBuild(target);
          this.spreadMove(soldiers, target.x, target.bottom + CFG.TILE);
          G.ping(target.x, target.y, 'rgba(60,120,200,0.95)');
          return;
        }
        if (target.hp < target.maxHp) {
          for (const u of workers) u.commandBuild(target);   // repair
          G.ping(target.x, target.y, 'rgba(60,160,120,0.95)');
          if (workers.length) return;
        }
        // drop-off
        const carrying = workers.filter(u => u.carry.amount > 0 &&
          target.def.dropoff && target.def.dropoff.includes(u.carry.type));
        if (carrying.length) {
          for (const u of carrying) { u.depositTarget = target; u.state = 'return'; u.clearPath(); }
          G.ping(target.x, target.y, 'rgba(47,122,47,0.9)');
          return;
        }
      }
    }

    this.spreadMove(units, wx, wy);
    G.ping(wx, wy, 'rgba(47,122,47,0.95)');
  },

  issueAttackMove(wx, wy) {
    const units = G.selectedUnits;
    if (!units.length) return;
    const offsets = this.formationOffsets(units.length);
    units.forEach((u, i) => u.commandAttackMove(wx + offsets[i].x, wy + offsets[i].y));
    G.ping(wx, wy, 'rgba(190,50,40,0.95)');
  },

  /** Spread a group over a small block so they don't fight over one tile. */
  spreadMove(units, wx, wy) {
    if (!units.length) return;
    const offsets = this.formationOffsets(units.length);
    units.forEach((u, i) => {
      const tx = wx + offsets[i].x, ty = wy + offsets[i].y;
      u.commandMove(clamp(tx, 8, WORLD_W - 8), clamp(ty, 8, WORLD_H - 8));
    });
  },

  formationOffsets(n) {
    if (n === 1) return [{ x: 0, y: 0 }];
    const out = [];
    const cols = Math.ceil(Math.sqrt(n));
    const spacing = CFG.TILE * 0.85;
    for (let i = 0; i < n; i++) {
      const cx = i % cols, cy = (i / cols) | 0;
      const rows = Math.ceil(n / cols);
      out.push({
        x: (cx - (cols - 1) / 2) * spacing,
        y: (cy - (rows - 1) / 2) * spacing,
      });
    }
    return out;
  },

  tryPlace(keepPlacing) {
    const t = G.placeTile;
    if (!t) return;
    const type = G.placing;
    const workers = G.selectedUnits.filter(u => u.isWorker);
    const builders = workers.length ? workers.slice(0, 5) : [];
    const b = G.startConstruction(type, t.x, t.y, G.humanId, builders);
    if (b) {
      G.ping(b.x, b.y, 'rgba(60,120,200,0.95)');
      if (!keepPlacing) { G.placing = null; UI.refreshSelection(); }
      if (!builders.length) G.toast('No villager selected — the foundation is waiting');
    }
  },

  /* ------------------------------------------------------------- minimap */

  onMinimapDown(e) {
    // Invert the minimap's isometric projection rather than treating it as a
    // plain square, or clicks land in the wrong corner of the map.
    const r = this.minimap.getBoundingClientRect();
    const R = G.renderer;
    const px = ((e.clientX - r.left) / r.width) * R.mmSize;
    const py = ((e.clientY - r.top) / r.height) * R.mmSize;
    const dx = (px - R.mmSize / 2) / R.mmScale;
    const dy = (py - R.mmOY) / (R.mmScale * 0.5);
    const wx = clamp((dx + dy) / 2, 0, CFG.MAP_W - 1) * CFG.TILE;
    const wy = clamp((dy - dx) / 2, 0, CFG.MAP_H - 1) * CFG.TILE;
    if (e.button === 2) {
      this.issueCommand(wx, wy, e.shiftKey, null);
    } else {
      this._mmDrag = true;
      G.cam.centerOn(wx, wy);
    }
  },

  /* ------------------------------------------------------------ keyboard */

  onKeyDown(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const code = keyCodeOf(e);
    this.keys[code] = true;
    if (!G.running) return;

    const ctrl = e.ctrlKey || e.metaKey;

    // control groups
    if (/^Digit[0-9]$/.test(code)) {
      const n = code.slice(5);
      if (ctrl) {
        G.controlGroups[n] = G.selection.filter(x => x.alive && x.owner === G.humanId).slice();
        G.toast(`Group ${n} set (${G.controlGroups[n].length})`);
      } else {
        const grp = (G.controlGroups[n] || []).filter(x => x.alive);
        if (grp.length) {
          G.select(grp, false);
          if (this._lastGroupKey === n && performance.now() - (this._lastGroupTime || 0) < 350) {
            const c = grp[0];
            G.cam.centerOn(c.x, c.y);
          }
          this._lastGroupKey = n; this._lastGroupTime = performance.now();
        }
      }
      e.preventDefault();
      return;
    }

    switch (code) {
      case 'Escape':
        if (G.placing) { G.placing = null; UI.refreshSelection(); }
        else if (this.attackMoveMode) { this.attackMoveMode = false; document.body.classList.remove('cursor-attack'); }
        else if (UI.buildMenuOpen) UI.closeBuildMenu();
        else G.clearSelection(), UI.refreshSelection();
        break;

      case 'KeyB':
        if (G.selectedUnits.some(u => u.isWorker)) UI.toggleBuildMenu();
        break;

      case 'KeyA':
        if (G.selectedUnits.length) {
          this.attackMoveMode = true;
          document.body.classList.add('cursor-attack');
          G.toast('Attack-move: click a destination');
        }
        break;

      case 'KeyS':
        for (const u of G.selectedUnits) u.stop();
        break;

      case 'KeyH': {
        const tc = G.buildings.find(b => b.alive && b.owner === G.humanId && b.type === 'towncenter');
        if (tc) { G.selectOne(tc, false); G.cam.centerOn(tc.x, tc.y); }
        break;
      }

      case 'Period': {
        const v = G.findIdleVillager();
        if (v) { G.selectOne(v, false); G.cam.centerOn(v.x, v.y); }
        else G.toast('No idle villagers');
        break;
      }

      case 'KeyF': {
        const list = G.units.filter(u => u.alive && u.owner === G.humanId && u.isMilitary);
        if (list.length) G.select(list.slice(0, 60), false);
        break;
      }

      case 'Space':
        if (G.lastAttackPos) G.cam.centerOn(G.lastAttackPos.x, G.lastAttackPos.y);
        e.preventDefault();
        break;

      case 'Delete':
      case 'Backspace':
        for (const u of G.selection.slice()) {
          if (u.owner === G.humanId && u.alive) u.die();
        }
        G.clearSelection(); UI.refreshSelection();
        break;

      case 'KeyP':
        G.paused = !G.paused;
        G.toast(G.paused ? 'Paused' : 'Resumed');
        break;

      case 'Equal': case 'NumpadAdd':
        G.cam.zoom = clamp(G.cam.zoom * 1.15, 0.5, 2.6); break;
      case 'Minus': case 'NumpadSubtract':
        G.cam.zoom = clamp(G.cam.zoom / 1.15, 0.5, 2.6); break;

      case 'F2':
        G.speed = G.speed === 1 ? 2 : 1;
        G.toast(`Game speed ${G.speed}×`);
        e.preventDefault();
        break;
    }

    // quick-train hotkeys from the command card
    if (!ctrl && /^Key[QWERTY]$/.test(code)) UI.hotkey(code);
  },

  /* --------------------------------------------------------------- camera */

  updateCamera(dt) {
    if (!G.running || G.gameOver) return;
    // Arrow keys scroll; A/S/D stay free for unit commands (standard RTS layout).
    const k = this.keys;
    let dx = 0, dy = 0;
    if (k.ArrowUp) dy -= 1;
    if (k.ArrowDown) dy += 1;
    if (k.ArrowLeft) dx -= 1;
    if (k.ArrowRight) dx += 1;

    // edge scrolling
    if (this.mouse.onCanvas && this.mouse.moved && !this.panning) {
      const r = this.canvas.getBoundingClientRect();
      const m = CFG.EDGE_SCROLL_PX;
      if (this.mouse.x < m) dx -= 1;
      if (this.mouse.x > r.width - m) dx += 1;
      if (this.mouse.y < m) dy -= 1;
      if (this.mouse.y > r.height - m) dy += 1;
    }

    if (dx || dy) {
      const len = Math.hypot(dx, dy) || 1;
      const sp = CFG.SCROLL_SPEED / G.cam.zoom * dt;
      G.cam.x += (dx / len) * sp;
      G.cam.y += (dy / len) * sp;
      G.cam.clampToWorld();
    }
  },
};
