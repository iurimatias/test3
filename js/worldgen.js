/* =========================================================================
   World generation — terrain, forests, mines, starting positions
   ========================================================================= */
'use strict';

class GameMap {
  constructor(w, h, seed) {
    this.w = w; this.h = h;
    this.rng = makeRng(seed);
    this.terrain = new Uint8Array(w * h);   // TERRAIN.*
    this.grid = new Grid(w, h);
    this.starts = [];
    this.roads = [];        // painted-on dirt tracks, purely decorative
  }

  t(x, y) { return this.terrain[y * this.w + x]; }
  setT(x, y, v) { this.terrain[y * this.w + x] = v; }

  generate(numPlayers) {
    const rng = this.rng;
    const W = this.w, H = this.h;

    // --- base terrain: grass with soft dirt patches -----------------------
    this.terrain.fill(TERRAIN.GRASS);
    const patches = 26;
    for (let i = 0; i < patches; i++) {
      const cx = rng.int(0, W - 1), cy = rng.int(0, H - 1);
      const r = rng.range(3, 9);
      for (let y = Math.max(0, cy - r | 0); y < Math.min(H, cy + r); y++)
        for (let x = Math.max(0, cx - r | 0); x < Math.min(W, cx + r); x++) {
          const d = dist(x, y, cx, cy);
          if (d < r * (0.6 + hashNoise(x, y) * 0.5)) this.setT(x, y, TERRAIN.DIRT);
        }
    }

    // --- ponds -----------------------------------------------------------
    const ponds = 4;
    for (let i = 0; i < ponds; i++) {
      const cx = rng.int(12, W - 12), cy = rng.int(12, H - 12);
      const rx = rng.range(3.5, 7), ry = rng.range(3, 6);
      for (let y = Math.max(0, cy - 9); y < Math.min(H, cy + 9); y++)
        for (let x = Math.max(0, cx - 10); x < Math.min(W, cx + 10); x++) {
          const nx = (x - cx) / rx, ny = (y - cy) / ry;
          const d = nx * nx + ny * ny;
          const wobble = 0.75 + hashNoise(x * 3, y * 3) * 0.5;
          if (d < wobble) this.setT(x, y, TERRAIN.WATER);
          else if (d < wobble + 0.55) { if (this.t(x, y) !== TERRAIN.WATER) this.setT(x, y, TERRAIN.SAND); }
        }
    }

    // --- start positions (opposite corners) ------------------------------
    const margin = 13;
    const candidates = [
      [margin, margin],
      [W - margin, H - margin],
      [W - margin, margin],
      [margin, H - margin],
    ];
    this.starts = [];
    for (let i = 0; i < numPlayers; i++) {
      let [sx, sy] = candidates[i % candidates.length];
      // push start off water
      for (let tries = 0; tries < 60; tries++) {
        if (this._areaClearOfWater(sx, sy, 6)) break;
        sx = clamp(sx + rng.int(-3, 3), 8, W - 9);
        sy = clamp(sy + rng.int(-3, 3), 8, H - 9);
      }
      // flatten the immediate base area
      for (let y = sy - 6; y <= sy + 6; y++)
        for (let x = sx - 6; x <= sx + 6; x++)
          if (this.inB(x, y) && this.t(x, y) === TERRAIN.WATER) this.setT(x, y, TERRAIN.SAND);
      this.starts.push({ x: sx, y: sy });
    }

    // --- water blocks movement -------------------------------------------
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (this.t(x, y) === TERRAIN.WATER) this.grid.blocked[y * W + x] = 1;

    this._makeRoads();
    return this;
  }

  /**
   * Wandering dirt tracks, drawn under everything else. Cosmetic only — they
   * don't affect movement — but they do most of the work of making the map
   * look inhabited rather than procedurally scattered.
   */
  _makeRoads() {
    const rng = this.rng;
    const T = CFG.TILE;
    const jitter = (x, y, amt) => [x + rng.range(-amt, amt), y + rng.range(-amt, amt)];

    const track = (x0, y0, x1, y1, width, wob) => {
      const pts = [];
      const steps = Math.max(4, Math.round(dist(x0, y0, x1, y1) / (T * 4)));
      for (let i = 0; i <= steps; i++) {
        const f = i / steps;
        // sine bow plus noise, so tracks bend instead of running straight
        const bend = Math.sin(f * Math.PI) * wob;
        const nx = -(y1 - y0), ny = (x1 - x0);
        const nl = Math.hypot(nx, ny) || 1;
        let px = lerp(x0, x1, f) + (nx / nl) * bend;
        let py = lerp(y0, y1, f) + (ny / nl) * bend;
        [px, py] = jitter(px, py, T * 0.7);
        pts.push([clamp(px, 0, WORLD_W), clamp(py, 0, WORLD_H)]);
      }
      this.roads.push({ pts, w: width });
    };

    // the long road linking the two settlements
    if (this.starts.length > 1) {
      const a = this.starts[0], b = this.starts[1];
      track(a.x * T, a.y * T, b.x * T, b.y * T, 20, rng.range(-T * 12, T * 12));
    }

    // spokes radiating out of each base toward the surrounding countryside
    for (const s of this.starts) {
      const base = rng.range(0, TAU);
      const spokes = 5;
      for (let i = 0; i < spokes; i++) {
        const a = base + (i / spokes) * TAU + rng.range(-0.25, 0.25);
        const len = rng.range(14, 30) * T;
        track(s.x * T, s.y * T,
          clamp(s.x * T + Math.cos(a) * len, 0, WORLD_W),
          clamp(s.y * T + Math.sin(a) * len, 0, WORLD_H),
          rng.range(11, 16), rng.range(-T * 5, T * 5));
      }
    }

    // a couple of unrelated country lanes for texture
    for (let i = 0; i < 3; i++) {
      track(rng.range(0, WORLD_W), rng.range(0, WORLD_H),
        rng.range(0, WORLD_W), rng.range(0, WORLD_H),
        rng.range(9, 13), rng.range(-T * 10, T * 10));
    }
  }

  inB(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }

  _areaClearOfWater(cx, cy, r) {
    let water = 0, total = 0;
    for (let y = cy - r; y <= cy + r; y++)
      for (let x = cx - r; x <= cx + r; x++) {
        if (!this.inB(x, y)) return false;
        total++;
        if (this.t(x, y) === TERRAIN.WATER) water++;
      }
    return water / total < 0.06;
  }

  /**
   * Populate resources. `spawn(type, tx, ty)` is a callback into the game
   * so nodes get registered as real entities.
   */
  populate(spawn) {
    const rng = this.rng;
    const W = this.w, H = this.h;
    const taken = new Uint8Array(W * H);

    const free = (x, y, pad = 0) => {
      for (let j = -pad; j <= pad; j++)
        for (let i = -pad; i <= pad; i++) {
          const xx = x + i, yy = y + j;
          if (!this.inB(xx, yy)) return false;
          if (taken[yy * W + xx]) return false;
          if (this.t(xx, yy) === TERRAIN.WATER) return false;
        }
      return true;
    };
    const mark = (x, y) => { taken[y * W + x] = 1; };

    // reserve build space around each start
    for (const s of this.starts)
      for (let y = s.y - 7; y <= s.y + 7; y++)
        for (let x = s.x - 7; x <= s.x + 7; x++)
          if (this.inB(x, y)) taken[y * W + x] = 1;

    const place = (type, x, y) => {
      if (!this.inB(x, y) || this.t(x, y) === TERRAIN.WATER) return false;
      if (taken[y * W + x]) return false;
      mark(x, y);
      spawn(type, x, y);
      return true;
    };

    /* ---- starting resources for each player ---------------------------- */
    for (const s of this.starts) {
      // berry bushes: a cluster ~7 tiles away
      const bAng = rng.range(0, TAU);
      const bx = clamp(Math.round(s.x + Math.cos(bAng) * 8), 2, W - 3);
      const by = clamp(Math.round(s.y + Math.sin(bAng) * 8), 2, H - 3);
      let placedB = 0;
      for (let y = by - 2; y <= by + 2 && placedB < 7; y++)
        for (let x = bx - 2; x <= bx + 2 && placedB < 7; x++)
          if (dist(x, y, bx, by) < 2.3) { taken[y * W + x] = 0; if (place('bush', x, y)) placedB++; }

      // gold: two clusters
      for (let g = 0; g < 2; g++) {
        const ang = bAng + Math.PI * (0.7 + g * 0.6) + rng.range(-0.3, 0.3);
        const gx = clamp(Math.round(s.x + Math.cos(ang) * (9 + g * 3)), 2, W - 3);
        const gy = clamp(Math.round(s.y + Math.sin(ang) * (9 + g * 3)), 2, H - 3);
        let n = 0;
        for (let y = gy - 2; y <= gy + 2 && n < 5; y++)
          for (let x = gx - 2; x <= gx + 2 && n < 5; x++)
            if (dist(x, y, gx, gy) < 1.9) { taken[y * W + x] = 0; if (place('gold', x, y)) n++; }
      }

      // stone
      {
        const ang = bAng + Math.PI * 1.35 + rng.range(-0.25, 0.25);
        const gx = clamp(Math.round(s.x + Math.cos(ang) * 10), 2, W - 3);
        const gy = clamp(Math.round(s.y + Math.sin(ang) * 10), 2, H - 3);
        let n = 0;
        for (let y = gy - 2; y <= gy + 2 && n < 4; y++)
          for (let x = gx - 2; x <= gx + 2 && n < 4; x++)
            if (dist(x, y, gx, gy) < 1.7) { taken[y * W + x] = 0; if (place('stone', x, y)) n++; }
      }

      // starting woodline: an arc of forest at ~9 tiles
      const wAng = bAng + Math.PI * 0.5;
      for (let k = -8; k <= 8; k++) {
        const a = wAng + k * 0.075;
        for (let ring = 0; ring < 3; ring++) {
          const rr = 9 + ring;
          const x = Math.round(s.x + Math.cos(a) * rr);
          const y = Math.round(s.y + Math.sin(a) * rr);
          if (this.inB(x, y)) { taken[y * W + x] = 0; place('tree', x, y); }
        }
      }
    }

    /* ---- scattered forests --------------------------------------------- */
    const forests = 46;
    for (let i = 0; i < forests; i++) {
      const cx = rng.int(3, W - 4), cy = rng.int(3, H - 4);
      const r = rng.range(2.5, 6.5);
      for (let y = Math.floor(cy - r); y <= cy + r; y++)
        for (let x = Math.floor(cx - r); x <= cx + r; x++) {
          const d = dist(x, y, cx, cy);
          const edge = r * (0.72 + hashNoise(x * 5, y * 5) * 0.42);
          if (d < edge && free(x, y)) place('tree', x, y);
        }
    }

    /* ---- neutral gold / stone / berries -------------------------------- */
    const scatter = (type, clusters, size, spread) => {
      for (let i = 0; i < clusters; i++) {
        const cx = rng.int(4, W - 5), cy = rng.int(4, H - 5);
        let n = 0;
        for (let tries = 0; tries < 40 && n < size; tries++) {
          const x = cx + rng.int(-spread, spread), y = cy + rng.int(-spread, spread);
          if (free(x, y) && place(type, x, y)) n++;
        }
      }
    };
    scatter('gold', 12, 5, 2);
    scatter('stone', 10, 4, 2);
    scatter('bush', 9, 6, 2);
  }

  /**
   * Purely decorative dressing — boulder outcrops on open ground and reeds
   * along the shoreline. No gameplay effect, but it is most of what makes the
   * map look like a place rather than a scatter plot of resources.
   */
  decorate(add) {
    const rng = this.rng;
    const T = CFG.TILE;
    for (let i = 0; i < 70; i++) {
      const x = rng.int(2, this.w - 3), y = rng.int(2, this.h - 3);
      if (this.t(x, y) === TERRAIN.WATER) continue;
      if (!this.grid.isFree(x, y)) continue;
      // keep the build area around each start clear of clutter
      if (this.starts.some(st => Math.abs(st.x - x) < 9 && Math.abs(st.y - y) < 9)) continue;
      const big = rng.chance(0.35);
      add({ kind: 'rocks', x: (x + rng()) * T, y: (y + rng()) * T,
            seed: (x * 7919 + y * 104729) >>> 0, r: big ? 9 : 5.5, big });
    }
    for (let y = 1; y < this.h - 1; y++) {
      for (let x = 1; x < this.w - 1; x++) {
        if (this.t(x, y) === TERRAIN.WATER) continue;
        let touchesWater = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
          if (this.t(x + dx, y + dy) === TERRAIN.WATER) { touchesWater = true; break; }
        if (!touchesWater || !rng.chance(0.3)) continue;
        add({ kind: 'reeds', x: (x + rng()) * T, y: (y + rng()) * T,
              seed: (x * 31 + y * 17) >>> 0 });
      }
    }
  }
}
