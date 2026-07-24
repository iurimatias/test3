/* =========================================================================
   Renderer — camera, world drawing, fog of war, minimap
   ========================================================================= */
'use strict';

class Camera {
  constructor() { this.x = 0; this.y = 0; this.zoom = 1; }
  get vw() { return G.canvas.width / (this.zoom * G.dpr); }
  get vh() { return G.canvas.height / (this.zoom * G.dpr); }
  clampToWorld() {
    this.x = clamp(this.x, -200, WORLD_W - this.vw + 200);
    this.y = clamp(this.y, -200, WORLD_H - this.vh + 200);
  }
  centerOn(wx, wy) {
    this.x = wx - this.vw / 2;
    this.y = wy - this.vh / 2;
    this.clampToWorld();
  }
  toScreen(wx, wy) { return [(wx - this.x) * this.zoom, (wy - this.y) * this.zoom]; }
  toWorld(sx, sy) { return [sx / this.zoom + this.x, sy / this.zoom + this.y]; }
}

/**
 * Visibility grid stored at `RES` samples per tile, so the soft upscaled edge
 * is a fraction of a tile wide instead of a whole one.
 */
class FogOfWar {
  constructor(tilesW, tilesH) {
    this.res = 2;
    this.w = tilesW * this.res;
    this.h = tilesH * this.res;
    this.tilesW = tilesW; this.tilesH = tilesH;
    this.explored = new Uint8Array(this.w * this.h);
    this.visible = new Uint8Array(this.w * this.h);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.w; this.canvas.height = this.h;
    this.ctx = this.canvas.getContext('2d');
    this.img = this.ctx.createImageData(this.w, this.h);
    this.dirty = true;
    this.timer = 0;
  }

  _sample(arr, tx, ty) {
    const x = tx * this.res + (this.res >> 1);
    const y = ty * this.res + (this.res >> 1);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    return arr[y * this.w + x] === 1;
  }
  isExplored(tx, ty) { return this._sample(this.explored, tx, ty); }
  isVisible(tx, ty) { return this._sample(this.visible, tx, ty); }
  isVisiblePx(px, py) {
    const x = Math.floor(px / CFG.TILE * this.res);
    const y = Math.floor(py / CFG.TILE * this.res);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    return this.visible[y * this.w + x] === 1;
  }

  revealAll() {
    this.explored.fill(1); this.visible.fill(1); this.dirty = true;
  }

  _stamp(cx, cy, r) {
    const r2 = r * r;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(this.w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(this.h - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        if (dx * dx + dy * dy <= r2) {
          const i = y * this.w + x;
          this.visible[i] = 1;
          this.explored[i] = 1;
        }
      }
    }
  }

  update(entities, playerId) {
    this.visible.fill(0);
    const r = this.res;
    for (const e of entities) {
      if (e.owner !== playerId || !e.alive) continue;
      const los = e.def.los || 5;
      this._stamp(e.x / CFG.TILE * r, e.y / CFG.TILE * r, los * r);
    }
    this.dirty = true;
  }

  _rebuild() {
    const d = this.img.data;
    const n = this.w * this.h;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      d[o] = 32; d[o + 1] = 29; d[o + 2] = 23;
      d[o + 3] = this.visible[i] ? 0 : (this.explored[i] ? 118 : 255);
    }
    this.ctx.putImageData(this.img, 0, 0);
    this.dirty = false;
  }

  draw(ctx) {
    if (this.dirty) this._rebuild();
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.canvas, 0, 0, this.w, this.h, 0, 0, WORLD_W, WORLD_H);
    ctx.restore();
  }
}

/* ------------------------------------------------------------------------ */

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.terrainCanvas = null;
    this.minimapTerrain = null;
  }

  buildTerrain(map) {
    this.terrainCanvas = renderTerrain(map);
    // minimap base
    const mm = document.createElement('canvas');
    mm.width = map.w; mm.height = map.h;
    const c = mm.getContext('2d');
    const img = c.createImageData(map.w, map.h);
    const cols = {
      [TERRAIN.GRASS]: [206, 197, 160],
      [TERRAIN.DIRT]: [198, 176, 130],
      [TERRAIN.SAND]: [216, 197, 150],
      [TERRAIN.WATER]: [150, 185, 205],
    };
    for (let i = 0; i < map.w * map.h; i++) {
      const c3 = cols[map.terrain[i]] || cols[0];
      img.data[i * 4] = c3[0]; img.data[i * 4 + 1] = c3[1]; img.data[i * 4 + 2] = c3[2]; img.data[i * 4 + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    this.minimapTerrain = mm;
  }

  /* ------------------------------------------------------------ main draw */

  draw(g) {
    const ctx = this.ctx;
    const cam = g.cam;
    const W = this.canvas.width / g.dpr, H = this.canvas.height / g.dpr;

    ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
    ctx.fillStyle = '#d9cfb6';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);

    const vx0 = cam.x, vy0 = cam.y, vx1 = cam.x + cam.vw, vy1 = cam.y + cam.vh;
    const inView = (x, y, pad) => x > vx0 - pad && x < vx1 + pad && y > vy0 - pad && y < vy1 + pad;

    // --- terrain ---
    const sx = clamp(vx0, 0, WORLD_W), sy = clamp(vy0, 0, WORLD_H);
    const sw = clamp(vx1, 0, WORLD_W) - sx, sh = clamp(vy1, 0, WORLD_H) - sy;
    if (sw > 0 && sh > 0) ctx.drawImage(this.terrainCanvas, sx, sy, sw, sh, sx, sy, sw, sh);

    // world border
    ctx.strokeStyle = 'rgba(70,60,45,0.5)';
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, WORLD_W, WORLD_H);

    const fog = g.fog;
    const seen = (e) => !CFG.FOG || fog.isVisiblePx(e.x, e.y) || e.owner === g.humanId;

    // --- decor (stumps, rubble, bones) ---
    for (const d of g.decor) {
      if (!inView(d.x, d.y, 40)) continue;
      if (CFG.FOG && !fog.isExplored(Math.floor(d.x / CFG.TILE), Math.floor(d.y / CFG.TILE))) continue;
      drawDecor(ctx, d);
    }

    // --- flat things first (farms) ---
    for (const b of g.buildings) {
      if (b.def.art !== 'farm' || !inView(b.x, b.y, 80)) continue;
      if (CFG.FOG && !fog.isExplored(b.tileX, b.tileY)) continue;
      drawBuilding(ctx, b, PLAYER_COLORS[b.owner], g.time);
    }

    // --- depth-sorted pass ---
    const drawList = [];
    for (const b of g.buildings) {
      if (b.def.art === 'farm') continue;
      if (!inView(b.x, b.y, 140)) continue;
      if (CFG.FOG && !fog.isExplored(b.tileX, b.tileY)) continue;
      // buildings remain visible once explored (remembered), units do not
      drawList.push(b);
    }
    for (const r of g.resources) {
      if (!r.alive || !inView(r.x, r.y, 60)) continue;
      if (CFG.FOG && !fog.isExplored(r.tileX, r.tileY)) continue;
      drawList.push(r);
    }
    for (const u of g.units) {
      if (!u.alive || !inView(u.x, u.y, 60)) continue;
      if (CFG.FOG && !seen(u)) continue;
      drawList.push(u);
    }
    for (const c of g.corpses) {
      if (!inView(c.x, c.y, 60)) continue;
      drawList.push(c);
    }
    drawList.sort((a, b) => (a.kind === 'building' ? a.bottom : a.y) - (b.kind === 'building' ? b.bottom : b.y));

    // selection rings under everything selected
    for (const e of g.selection) {
      if (!e.alive || !inView(e.x, e.y, 120)) continue;
      this._selectionRing(ctx, e);
    }
    if (g.hoverEntity && !g.hoverEntity.selected && g.hoverEntity.alive) {
      this._hoverRing(ctx, g.hoverEntity);
    }

    for (const e of drawList) {
      if (e.kind === 'building') drawBuilding(ctx, e, PLAYER_COLORS[e.owner], g.time);
      else if (e.kind === 'resource') drawResource(ctx, e, g.time);
      else drawUnit(ctx, e, PLAYER_COLORS[e.owner] || PLAYER_COLORS[0]);
    }

    // --- projectiles ---
    for (const p of g.projectiles) {
      if (!inView(p.x, p.y, 40)) continue;
      drawProjectile(ctx, p);
    }

    // --- health bars ---
    for (const e of drawList) {
      if (e.kind === 'resource' || e.deathT !== undefined) continue;
      const dmg = e.hp < e.maxHp;
      if (!dmg && !e.selected) continue;
      this._healthBar(ctx, e);
    }

    // resource amount bar on selected/hovered nodes
    for (const e of g.selection) {
      if (e.kind === 'resource') this._resourceBar(ctx, e);
      else if (e.kind === 'building' && e.def.farmFood && e.built) this._resourceBar(ctx, e);
    }

    // --- rally points of selected buildings ---
    for (const e of g.selection) {
      if (e.kind === 'building' && e.rally) this._rallyFlag(ctx, e);
    }

    // --- build ghost ---
    if (g.placing) {
      const t = g.placeTile;
      if (t) drawGhost(ctx, g.placing, t.x, t.y, g.placeValid);
    }

    // --- command feedback pings ---
    for (const fx of g.pings) {
      const a = 1 - fx.t / fx.life;
      ctx.strokeStyle = fx.color;
      ctx.globalAlpha = a;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, 4 + (1 - a) * 16, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // --- fog ---
    if (CFG.FOG) fog.draw(ctx);

    ctx.restore();

    // --- floating text (screen space, above fog) ---
    ctx.save();
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);
    ctx.textAlign = 'center';
    for (const f of g.floats) {
      const a = 1 - f.t / f.life;
      ctx.globalAlpha = a;
      ctx.font = 'bold 13px ui-monospace, monospace';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(250,246,236,0.9)';
      ctx.fillStyle = RES_ICON_COLORS[f.kind] || '#2b2b2b';
      ctx.strokeText(f.text, f.x, f.y - f.t * 22);
      ctx.fillText(f.text, f.x, f.y - f.t * 22);
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // --- selection marquee ---
    if (g.dragSelect) {
      const d = g.dragSelect;
      const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1);
      const w = Math.abs(d.x1 - d.x0), h = Math.abs(d.y1 - d.y0);
      ctx.save();
      ctx.strokeStyle = '#2f7a2f';
      ctx.fillStyle = 'rgba(90,170,90,0.14)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x + 0.5, y + 0.5, w, h);
      ctx.restore();
    }
  }

  _selectionRing(ctx, e) {
    const isB = e.kind === 'building';
    ctx.save();
    ctx.strokeStyle = e.owner === G.humanId ? '#2f7a2f' : (e.owner < 0 ? '#8a6a3a' : '#a52a1f');
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    if (isB) {
      ctx.strokeRect(e.left + 1, e.top + 1, e.pxW - 2, e.pxH - 2);
    } else {
      const r = (e.radius || 9) + 4;
      ctx.beginPath();
      ctx.ellipse(e.x, e.y + 1, r, r * 0.45, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  _hoverRing(ctx, e) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = e.owner === G.humanId ? '#2f7a2f' : (e.owner < 0 ? '#8a6a3a' : '#a52a1f');
    ctx.lineWidth = 1.5;
    if (e.kind === 'building') ctx.strokeRect(e.left + 1, e.top + 1, e.pxW - 2, e.pxH - 2);
    else {
      const r = (e.radius || 9) + 4;
      ctx.beginPath(); ctx.ellipse(e.x, e.y + 1, r, r * 0.45, 0, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }

  _healthBar(ctx, e) {
    const isB = e.kind === 'building';
    const w = isB ? Math.min(e.pxW - 8, 72) : 22;
    const x = e.x - w / 2;
    const y = isB ? e.top - 7 : e.y - (e.def.art === 'horse' ? 42 : 40);
    const frac = clamp(e.hp / e.maxHp, 0, 1);
    ctx.fillStyle = 'rgba(35,32,25,0.55)';
    ctx.fillRect(x - 1, y - 1, w + 2, 5);
    ctx.fillStyle = frac > 0.6 ? '#4a9b4a' : frac > 0.3 ? '#d9a021' : '#c0392b';
    ctx.fillRect(x, y, w * frac, 3);
  }

  _resourceBar(ctx, e) {
    const w = 26, x = e.x - w / 2;
    const y = e.kind === 'building' ? e.top - 14 : e.y - 30;
    const frac = clamp(e.amount / e.maxAmount, 0, 1);
    ctx.fillStyle = 'rgba(35,32,25,0.55)';
    ctx.fillRect(x - 1, y - 1, w + 2, 5);
    ctx.fillStyle = RES_ICON_COLORS[e.resType] || '#888';
    ctx.fillRect(x, y, w * frac, 3);
    ctx.fillStyle = '#3a3428';
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(Math.ceil(e.amount), e.x, y - 3);
  }

  _rallyFlag(ctx, b) {
    const r = b.rally;
    const tx = r.entity && r.entity.alive ? r.entity.x : r.x;
    const ty = r.entity && r.entity.alive ? r.entity.y : r.y;
    ctx.save();
    ctx.strokeStyle = 'rgba(47,122,47,0.65)';
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(b.x, b.bottom - 4);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = INK; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx, ty - 20); ctx.stroke();
    ctx.fillStyle = PLAYER_COLORS[b.owner].fill;
    ctx.beginPath();
    ctx.moveTo(tx, ty - 20); ctx.lineTo(tx + 12, ty - 16); ctx.lineTo(tx, ty - 12);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  /* -------------------------------------------------------------- minimap */

  drawMinimap(g, canvas) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const sx = W / CFG.MAP_W, sy = H / CFG.MAP_H;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(this.minimapTerrain, 0, 0, W, H);

    // resources
    for (const r of g.resources) {
      if (!r.alive) continue;
      if (CFG.FOG && !g.fog.isExplored(r.tileX, r.tileY)) continue;
      ctx.fillStyle = r.type === 'tree' ? 'rgba(90,130,70,0.95)'
        : r.type === 'gold' ? '#d4af37'
        : r.type === 'stone' ? '#9a9a9a' : '#c0392b';
      ctx.fillRect(r.tileX * sx, r.tileY * sy, Math.max(1.5, sx), Math.max(1.5, sy));
    }
    // buildings
    for (const b of g.buildings) {
      if (!b.alive) continue;
      if (CFG.FOG && !g.fog.isExplored(b.tileX, b.tileY)) continue;
      ctx.fillStyle = PLAYER_COLORS[b.owner].fill;
      ctx.fillRect(b.tileX * sx, b.tileY * sy, b.w * sx, b.h * sy);
      ctx.strokeStyle = PLAYER_COLORS[b.owner].ink;
      ctx.lineWidth = 1;
      ctx.strokeRect(b.tileX * sx, b.tileY * sy, b.w * sx, b.h * sy);
    }
    // units
    for (const u of g.units) {
      if (!u.alive) continue;
      if (CFG.FOG && u.owner !== g.humanId && !g.fog.isVisiblePx(u.x, u.y)) continue;
      ctx.fillStyle = PLAYER_COLORS[u.owner].fill;
      const s = u.isMilitary ? 3.4 : 2.6;
      ctx.fillRect(u.x / CFG.TILE * sx - s / 2, u.y / CFG.TILE * sy - s / 2, s, s);
    }

    // fog
    if (CFG.FOG) {
      if (g.fog.dirty) g.fog._rebuild();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(g.fog.canvas, 0, 0, W, H);
    }

    // attack pings
    for (const p of g.minimapPings) {
      const a = 1 - p.t / p.life;
      ctx.strokeStyle = `rgba(220,60,45,${a})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x / CFG.TILE * sx, p.y / CFG.TILE * sy, 3 + (1 - a) * 12, 0, TAU);
      ctx.stroke();
    }

    // viewport rect
    const cam = g.cam;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.6;
    ctx.strokeRect(
      cam.x / CFG.TILE * sx, cam.y / CFG.TILE * sy,
      cam.vw / CFG.TILE * sx, cam.vh / CFG.TILE * sy);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 0.8;
    ctx.strokeRect(
      cam.x / CFG.TILE * sx, cam.y / CFG.TILE * sy,
      cam.vw / CFG.TILE * sx, cam.vh / CFG.TILE * sy);
  }
}
