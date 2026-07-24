/* =========================================================================
   Renderer — isometric camera, painter's-order world draw, fog, minimap
   ========================================================================= */
'use strict';

/** Camera lives in isometric space; the world is a diamond within it. */
class Camera {
  constructor() { this.x = 0; this.y = 0; this.zoom = 1; }
  get vw() { return G.canvas.width / (this.zoom * G.dpr); }
  get vh() { return G.canvas.height / (this.zoom * G.dpr); }

  clampToWorld() {
    const padX = Math.max(220, this.vw * 0.35);
    const padY = Math.max(220, this.vh * 0.35);
    this.x = clamp(this.x, ISO_MIN_X - padX, ISO_MAX_X - this.vw + padX);
    this.y = clamp(this.y, ISO_MIN_Y - padY, ISO_MAX_Y - this.vh + padY);
  }
  /** Centre on a point given in WORLD coordinates. */
  centerOn(wx, wy) {
    const [ix, iy] = worldToIso(wx, wy);
    this.x = ix - this.vw / 2;
    this.y = iy - this.vh / 2;
    this.clampToWorld();
  }
  /** World -> screen pixels. */
  toScreen(wx, wy) {
    const [ix, iy] = worldToIso(wx, wy);
    return [(ix - this.x) * this.zoom, (iy - this.y) * this.zoom];
  }
  /** Screen pixels -> world ground point. */
  toWorld(sx, sy) {
    return isoToWorld(sx / this.zoom + this.x, sy / this.zoom + this.y);
  }
  /** Screen pixels -> iso space (what the renderer draws in). */
  toIso(sx, sy) {
    return [sx / this.zoom + this.x, sy / this.zoom + this.y];
  }
}

/**
 * Visibility grid at `res` samples per tile. Stored in world-tile space and
 * sheared onto the ground plane at draw time.
 */
class FogOfWar {
  constructor(tilesW, tilesH) {
    this.res = 2;
    this.w = tilesW * this.res;
    this.h = tilesH * this.res;
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

  revealAll() { this.explored.fill(1); this.visible.fill(1); this.dirty = true; }

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
      d[o] = 27; d[o + 1] = 36; d[o + 2] = 19;
      d[o + 3] = this.visible[i] ? 0 : (this.explored[i] ? 108 : 252);
    }
    this.ctx.putImageData(this.img, 0, 0);
    this.dirty = false;
  }

  /** Draw sheared onto the ground plane; caller is already in iso space. */
  draw(ctx) {
    if (this.dirty) this._rebuild();
    ctx.save();
    isoMatrix(ctx);
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
    this._drawList = [];
  }

  buildTerrain(map) {
    this.terrainCanvas = renderTerrain(map);
    this.terrainOX = -ISO_MIN_X + 2;   // iso x of terrain canvas origin
    this.terrainOY = 2;

    // Minimap base, also isometric so it matches the world it represents.
    const MM = 256;
    const mm = document.createElement('canvas');
    mm.width = MM; mm.height = MM;
    const c = mm.getContext('2d');

    const flat = document.createElement('canvas');
    flat.width = map.w; flat.height = map.h;
    const fc = flat.getContext('2d');
    const img = fc.createImageData(map.w, map.h);
    const cols = {
      [TERRAIN.GRASS]: [118, 158, 62],
      [TERRAIN.DIRT]: [176, 150, 100],
      [TERRAIN.SAND]: [206, 186, 134],
      [TERRAIN.WATER]: [64, 118, 158],
    };
    for (let i = 0; i < map.w * map.h; i++) {
      const c3 = cols[map.terrain[i]] || cols[0];
      img.data[i * 4] = c3[0]; img.data[i * 4 + 1] = c3[1]; img.data[i * 4 + 2] = c3[2];
      img.data[i * 4 + 3] = 255;
    }
    fc.putImageData(img, 0, 0);

    // Shear the square map into a diamond and centre it: the projected map is
    // twice as wide as it is tall, so it has to be offset to sit in the middle
    // of a square minimap rather than hugging the top edge.
    const sc = MM / (map.w + map.h);
    const oy = (MM - (map.w + map.h) * sc * 0.5) / 2;
    c.save();
    c.translate(MM / 2, oy);
    c.scale(sc * 2, sc * 2);
    c.transform(ISO_A, ISO_B, -ISO_A, ISO_B, 0, 0);
    c.imageSmoothingEnabled = true;
    c.drawImage(flat, 0, 0);
    c.restore();
    this.minimapTerrain = mm;
    this.mmScale = sc;
    this.mmOY = oy;
    this.mmSize = MM;
  }

  /** World point -> minimap canvas pixel. */
  minimapPoint(wx, wy) {
    const tx = wx / CFG.TILE, ty = wy / CFG.TILE;
    const s = this.mmScale;
    return [this.mmSize / 2 + (tx - ty) * s, this.mmOY + (tx + ty) * s * 0.5];
  }

  /* ------------------------------------------------------------ main draw */

  draw(g) {
    const ctx = this.ctx;
    const cam = g.cam;
    const W = this.canvas.width / g.dpr, H = this.canvas.height / g.dpr;

    ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
    ctx.fillStyle = '#1b2413';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);

    // viewport in iso space, with slack for tall buildings poking in from below
    const vx0 = cam.x - 120, vy0 = cam.y - 220;
    const vx1 = cam.x + cam.vw + 120, vy1 = cam.y + cam.vh + 120;
    const inView = (ix, iy) => ix > vx0 && ix < vx1 && iy > vy0 && iy < vy1;

    // --- ground ---
    const sx = clamp(vx0 + this.terrainOX, 0, this.terrainCanvas.width);
    const sy = clamp(vy0 + this.terrainOY, 0, this.terrainCanvas.height);
    const sw = clamp(vx1 + this.terrainOX, 0, this.terrainCanvas.width) - sx;
    const sh = clamp(vy1 + this.terrainOY, 0, this.terrainCanvas.height) - sy;
    if (sw > 0 && sh > 0) {
      ctx.drawImage(this.terrainCanvas, sx, sy, sw, sh,
        sx - this.terrainOX, sy - this.terrainOY, sw, sh);
    }

    // map rim
    ctx.strokeStyle = 'rgba(24,34,15,0.7)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    const c0 = worldToIso(0, 0), c1 = worldToIso(WORLD_W, 0);
    const c2 = worldToIso(WORLD_W, WORLD_H), c3 = worldToIso(0, WORLD_H);
    ctx.moveTo(c0[0], c0[1]); ctx.lineTo(c1[0], c1[1]);
    ctx.lineTo(c2[0], c2[1]); ctx.lineTo(c3[0], c3[1]);
    ctx.closePath();
    ctx.stroke();

    const fog = g.fog;
    const seen = (e) => !CFG.FOG || fog.isVisiblePx(e.x, e.y) || e.owner === g.humanId;

    // --- flat things painted straight onto the ground ---
    for (const d of g.decor) {
      const [ix, iy] = worldToIso(d.x, d.y);
      if (!inView(ix, iy)) continue;
      if (CFG.FOG && !fog.isExplored(Math.floor(d.x / CFG.TILE), Math.floor(d.y / CFG.TILE))) continue;
      drawDecor(ctx, d);
    }
    for (const b of g.buildings) {
      if (b.def.art !== 'farm') continue;
      const [ix, iy] = worldToIso(b.x, b.y);
      if (!inView(ix, iy)) continue;
      if (CFG.FOG && !fog.isExplored(b.tileX, b.tileY)) continue;
      drawBuilding(ctx, b, PLAYER_COLORS[b.owner], g.time);
    }

    // selection markers sit under the figures they belong to
    for (const e of g.selection) {
      if (!e.alive) continue;
      const [ix, iy] = worldToIso(e.x, e.y);
      if (!inView(ix, iy)) continue;
      this._selectionMark(ctx, e, false);
    }
    if (g.hoverEntity && !g.hoverEntity.selected && g.hoverEntity.alive) {
      this._selectionMark(ctx, g.hoverEntity, true);
    }

    // --- painter's order: back to front along the world diagonal ---
    const list = this._drawList;
    list.length = 0;
    for (const b of g.buildings) {
      if (b.def.art === 'farm') continue;
      const [ix, iy] = worldToIso(b.x, b.y);
      if (!inView(ix, iy)) continue;
      if (CFG.FOG && !fog.isExplored(b.tileX, b.tileY)) continue;
      list.push(b);
    }
    for (const r of g.resources) {
      if (!r.alive) continue;
      const [ix, iy] = worldToIso(r.x, r.y);
      if (!inView(ix, iy)) continue;
      if (CFG.FOG && !fog.isExplored(r.tileX, r.tileY)) continue;
      list.push(r);
    }
    for (const u of g.units) {
      if (!u.alive) continue;
      const [ix, iy] = worldToIso(u.x, u.y);
      if (!inView(ix, iy)) continue;
      if (CFG.FOG && !seen(u)) continue;
      list.push(u);
    }
    for (const c of g.corpses) {
      const [ix, iy] = worldToIso(c.x, c.y);
      if (!inView(ix, iy)) continue;
      list.push(c);
    }
    // depth key: distance along the screen-down diagonal. Buildings use their
    // far-south corner so units standing in front of them sort correctly.
    const depth = (e) => e.kind === 'building'
      ? (e.right + e.bottom) - CFG.TILE
      : e.x + e.y;
    list.sort((a, b) => depth(a) - depth(b));

    for (const e of list) {
      if (e.kind === 'building') drawBuilding(ctx, e, PLAYER_COLORS[e.owner], g.time);
      else if (e.kind === 'resource') drawResource(ctx, e, g.time);
      else drawUnit(ctx, e, PLAYER_COLORS[e.owner] || PLAYER_COLORS[0]);
    }

    for (const p of g.projectiles) {
      const [ix, iy] = worldToIso(p.x, p.y);
      if (!inView(ix, iy)) continue;
      drawProjectile(ctx, p);
    }

    // --- bars and overlays ---
    for (const e of list) {
      if (e.kind === 'resource' || e.deathT !== undefined) continue;
      if (e.hp < e.maxHp || e.selected) this._healthBar(ctx, e);
    }
    for (const e of g.selection) {
      if (e.kind === 'resource') this._resourceBar(ctx, e);
      else if (e.kind === 'building' && e.def.farmFood && e.built) this._resourceBar(ctx, e);
      if (e.kind === 'building' && e.rally) this._rallyFlag(ctx, e);
    }

    if (g.placing && g.placeTile) {
      drawGhost(ctx, g.placing, g.placeTile.x, g.placeTile.y, g.placeValid);
    }

    for (const fx of g.pings) {
      const a = 1 - fx.t / fx.life;
      const [ix, iy] = worldToIso(fx.x, fx.y);
      ctx.strokeStyle = fx.color;
      ctx.globalAlpha = a;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(ix, iy, 6 + (1 - a) * 22, (6 + (1 - a) * 22) * 0.5, 0, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    if (CFG.FOG) fog.draw(ctx);

    // floating text rides above the fog
    ctx.textAlign = 'center';
    for (const f of g.floats) {
      const a = 1 - f.t / f.life;
      const [ix, iy] = worldToIso(f.x, f.y);
      ctx.globalAlpha = a;
      ctx.font = 'bold 13px ui-monospace, monospace';
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(20,24,14,0.85)';
      ctx.fillStyle = RES_ICON_COLORS[f.kind] || '#fff';
      ctx.strokeText(f.text, ix, iy - 34 - f.t * 24);
      ctx.fillText(f.text, ix, iy - 34 - f.t * 24);
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    if (g.dragSelect) {
      const d = g.dragSelect;
      const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1);
      const w = Math.abs(d.x1 - d.x0), h = Math.abs(d.y1 - d.y0);
      ctx.save();
      ctx.strokeStyle = '#cfe8a0';
      ctx.fillStyle = 'rgba(180,225,120,0.16)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x + 0.5, y + 0.5, w, h);
      ctx.restore();
    }
  }

  /** Diamond under buildings, ellipse under units — matching the ground plane. */
  _selectionMark(ctx, e, hover) {
    const [ix, iy] = worldToIso(e.x, e.y);
    ctx.save();
    ctx.translate(ix, iy);
    const own = e.owner === G.humanId;
    ctx.strokeStyle = own ? '#63b0ff' : (e.owner < 0 ? '#e0c477' : '#ff6a55');
    ctx.lineWidth = hover ? 1.6 : 2.4;
    ctx.globalAlpha = hover ? 0.5 : 1;
    if (e.kind === 'building') {
      ctx.beginPath();
      isoDiamondPath(ctx, 0, 0, e.pxW / 2, e.pxH / 2, 0);
      ctx.stroke();
      if (!hover) {
        ctx.fillStyle = own ? 'rgba(99,176,255,0.13)' : 'rgba(255,106,85,0.13)';
        ctx.fill();
      }
    } else {
      const r = (e.radius || 9) + 4;
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * 0.5, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  _healthBar(ctx, e) {
    const [ix, iy] = worldToIso(e.x, e.y);
    const isB = e.kind === 'building';
    const w = isB ? clamp(e.pxW * 0.9, 34, 84) : 24;
    const top = isB ? iy - (e.pxW + e.pxH) * 0.25 - this._buildingTop(e) : iy - 42;
    const x = ix - w / 2;
    const frac = clamp(e.hp / e.maxHp, 0, 1);
    ctx.fillStyle = 'rgba(15,18,10,0.72)';
    ctx.fillRect(x - 1.5, top - 1.5, w + 3, 6);
    ctx.fillStyle = frac > 0.6 ? '#6fc04a' : frac > 0.3 ? '#e0a92c' : '#d1452f';
    ctx.fillRect(x, top, w * frac, 3);
  }

  _buildingTop(b) {
    switch (b.def.art) {
      case 'towncenter': return 108;
      case 'castle': return 92;
      case 'tower': return 74;
      case 'farm': return 6;
      default: return 56;
    }
  }

  _resourceBar(ctx, e) {
    const [ix, iy] = worldToIso(e.x, e.y);
    const w = 28, x = ix - w / 2;
    const y = iy - (e.kind === 'building' ? 26 : 50);
    const frac = clamp(e.amount / e.maxAmount, 0, 1);
    ctx.fillStyle = 'rgba(15,18,10,0.72)';
    ctx.fillRect(x - 1.5, y - 1.5, w + 3, 6);
    ctx.fillStyle = RES_ICON_COLORS[e.resType] || '#888';
    ctx.fillRect(x, y, w * frac, 3);
    ctx.fillStyle = '#f0ead6';
    ctx.font = 'bold 10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(Math.ceil(e.amount), ix, y - 4);
  }

  _rallyFlag(ctx, b) {
    const r = b.rally;
    const wx = r.entity && r.entity.alive ? r.entity.x : r.x;
    const wy = r.entity && r.entity.alive ? r.entity.y : r.y;
    const [bx, by] = worldToIso(b.x, b.y);
    const [tx, ty] = worldToIso(wx, wy);
    ctx.save();
    ctx.strokeStyle = 'rgba(99,176,255,0.6)';
    ctx.setLineDash([7, 6]);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(bx, by); ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(20,30,12,0.25)';
    ctx.beginPath(); ctx.ellipse(tx, ty, 7, 3.2, 0, 0, TAU); ctx.fill();
    ctx.save();
    ctx.translate(tx, ty);
    bannerPole(ctx, 0, 0, 0, 30, PLAYER_COLORS[b.owner], G.time);
    ctx.restore();
    ctx.restore();
  }

  /* -------------------------------------------------------------- minimap */

  drawMinimap(g, canvas) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const k = W / this.mmSize;

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.scale(k, k);
    ctx.drawImage(this.minimapTerrain, 0, 0);

    const dot = (wx, wy, size, color) => {
      const [px, py] = this.minimapPoint(wx, wy);
      ctx.fillStyle = color;
      ctx.fillRect(px - size / 2, py - size / 2, size, size);
    };

    for (const r of g.resources) {
      if (!r.alive) continue;
      if (CFG.FOG && !g.fog.isExplored(r.tileX, r.tileY)) continue;
      dot(r.x, r.y, r.type === 'tree' ? 2.6 : 3,
        r.type === 'tree' ? '#3d7f45' : r.type === 'gold' ? '#f2c318'
          : r.type === 'stone' ? '#bdb8ac' : '#cc3b30');
    }
    for (const b of g.buildings) {
      if (!b.alive) continue;
      if (CFG.FOG && !g.fog.isExplored(b.tileX, b.tileY)) continue;
      const [px, py] = this.minimapPoint(b.x, b.y);
      const s = this.mmScale;
      ctx.fillStyle = PLAYER_COLORS[b.owner].fill;
      ctx.beginPath();
      ctx.moveTo(px, py - b.h * s);
      ctx.lineTo(px + b.w * s, py);
      ctx.lineTo(px, py + b.h * s);
      ctx.lineTo(px - b.w * s, py);
      ctx.closePath();
      ctx.fill();
    }
    for (const u of g.units) {
      if (!u.alive) continue;
      if (CFG.FOG && u.owner !== g.humanId && !g.fog.isVisiblePx(u.x, u.y)) continue;
      dot(u.x, u.y, u.isMilitary ? 3.4 : 2.6, PLAYER_COLORS[u.owner].fill);
    }

    if (CFG.FOG) {
      if (g.fog.dirty) g.fog._rebuild();
      ctx.save();
      ctx.translate(this.mmSize / 2, this.mmOY);
      ctx.scale(this.mmScale * 2, this.mmScale * 2);
      ctx.transform(ISO_A, ISO_B, -ISO_A, ISO_B, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(g.fog.canvas, 0, 0, g.fog.w, g.fog.h, 0, 0, CFG.MAP_W, CFG.MAP_H);
      ctx.restore();
    }

    for (const p of g.minimapPings) {
      const a = 1 - p.t / p.life;
      const [px, py] = this.minimapPoint(p.x, p.y);
      ctx.strokeStyle = `rgba(235,70,50,${a})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(px, py, 4 + (1 - a) * 14, (4 + (1 - a) * 14) * 0.5, 0, 0, TAU);
      ctx.stroke();
    }

    // viewport outline — the camera rect maps to a parallelogram here
    const cam = g.cam;
    const corners = [
      cam.toWorld(0, 0),
      cam.toWorld(cam.vw * cam.zoom, 0),
      cam.toWorld(cam.vw * cam.zoom, cam.vh * cam.zoom),
      cam.toWorld(0, cam.vh * cam.zoom),
    ];
    ctx.beginPath();
    corners.forEach((c, i) => {
      const [px, py] = this.minimapPoint(c[0], c[1]);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.restore();
  }
}
