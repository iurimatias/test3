/* =========================================================================
   Grid + A* pathfinding
   ========================================================================= */
'use strict';

class BinaryHeap {
  constructor() { this.items = []; this.scores = []; }
  get size() { return this.items.length; }
  clear() { this.items.length = 0; this.scores.length = 0; }
  push(item, score) {
    this.items.push(item); this.scores.push(score);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.scores[p] <= this.scores[i]) break;
      this._swap(i, p); i = p;
    }
  }
  pop() {
    const top = this.items[0];
    const lastItem = this.items.pop(), lastScore = this.scores.pop();
    if (this.items.length) {
      this.items[0] = lastItem; this.scores[0] = lastScore;
      let i = 0;
      const n = this.items.length;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < n && this.scores[l] < this.scores[m]) m = l;
        if (r < n && this.scores[r] < this.scores[m]) m = r;
        if (m === i) break;
        this._swap(i, m); i = m;
      }
    }
    return top;
  }
  _swap(a, b) {
    const ti = this.items[a]; this.items[a] = this.items[b]; this.items[b] = ti;
    const ts = this.scores[a]; this.scores[a] = this.scores[b]; this.scores[b] = ts;
  }
}

/**
 * Walkability grid. 0 = free, >0 = blocked (buildings, resources, water).
 * Kept as a single Uint8Array indexed y*W+x.
 */
class Grid {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.blocked = new Uint8Array(w * h);

    // A* scratch buffers (reused across searches; `stamp` avoids clearing)
    this.gScore = new Float32Array(w * h);
    this.cameFrom = new Int32Array(w * h);
    this.state = new Uint8Array(w * h);   // 0 unseen, 1 open, 2 closed
    this.stamp = new Int32Array(w * h);
    this.currentStamp = 0;
    this.heap = new BinaryHeap();
  }

  idx(x, y) { return y * this.w + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  isBlocked(x, y) { return !this.inBounds(x, y) || this.blocked[y * this.w + x] > 0; }
  isFree(x, y) { return this.inBounds(x, y) && this.blocked[y * this.w + x] === 0; }

  setRect(tx, ty, w, h, val) {
    for (let y = ty; y < ty + h; y++) {
      if (y < 0 || y >= this.h) continue;
      for (let x = tx; x < tx + w; x++) {
        if (x < 0 || x >= this.w) continue;
        if (val) this.blocked[y * this.w + x]++;
        else if (this.blocked[y * this.w + x] > 0) this.blocked[y * this.w + x]--;
      }
    }
  }

  rectFree(tx, ty, w, h) {
    for (let y = ty; y < ty + h; y++)
      for (let x = tx; x < tx + w; x++)
        if (!this.isFree(x, y)) return false;
    return true;
  }

  /** Nearest free tile to (tx,ty) within `maxR` rings. Returns [x,y] or null. */
  nearestFree(tx, ty, maxR = 12) {
    if (this.isFree(tx, ty)) return [tx, ty];
    for (let r = 1; r <= maxR; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = tx + dx, y = ty + dy;
          if (this.isFree(x, y)) return [x, y];
        }
      }
    }
    return null;
  }

  /**
   * A* from tile (sx,sy) to (gx,gy).
   * Returns array of [tx,ty] waypoints (excluding start), or null.
   * If the goal is unreachable, returns the best partial path toward it.
   */
  findPath(sx, sy, gx, gy, maxNodes = 9000) {
    const W = this.w, H = this.h;
    if (!this.inBounds(sx, sy) || !this.inBounds(gx, gy)) return null;
    if (sx === gx && sy === gy) return [];

    // If goal blocked, retarget to the closest free tile beside it.
    if (this.isBlocked(gx, gy)) {
      const nf = this.nearestFree(gx, gy, 6);
      if (!nf) return null;
      gx = nf[0]; gy = nf[1];
      if (sx === gx && sy === gy) return [];
    }

    const stamp = ++this.currentStamp;
    const { gScore, cameFrom, state, heap } = this;
    heap.clear();

    const h = (x, y) => {
      const dx = Math.abs(x - gx), dy = Math.abs(y - gy);
      // octile distance
      return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
    };

    const startI = sy * W + sx;
    this.stamp[startI] = stamp;
    gScore[startI] = 0;
    cameFrom[startI] = -1;
    state[startI] = 1;
    heap.push(startI, h(sx, sy));

    let nodes = 0;
    let bestI = startI, bestH = h(sx, sy);
    const goalI = gy * W + gx;
    let found = false;

    while (heap.size > 0) {
      const cur = heap.pop();
      if (this.stamp[cur] === stamp && state[cur] === 2) continue;
      state[cur] = 2;

      if (cur === goalI) { found = true; break; }
      if (++nodes > maxNodes) break;

      const cx = cur % W, cy = (cur / W) | 0;
      const cg = gScore[cur];

      for (let dy = -1; dy <= 1; dy++) {
        const ny = cy + dy;
        if (ny < 0 || ny >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cx + dx;
          if (nx < 0 || nx >= W) continue;
          const ni = ny * W + nx;
          if (this.blocked[ni] > 0) continue;

          // no cutting corners diagonally
          if (dx !== 0 && dy !== 0) {
            if (this.blocked[cy * W + nx] > 0 || this.blocked[ny * W + cx] > 0) continue;
          }

          const step = (dx !== 0 && dy !== 0) ? Math.SQRT2 : 1;
          const ng = cg + step;

          if (this.stamp[ni] !== stamp) {
            this.stamp[ni] = stamp;
            state[ni] = 0;
            gScore[ni] = Infinity;
            cameFrom[ni] = -1;
          }
          if (state[ni] === 2) continue;
          if (ng < gScore[ni]) {
            gScore[ni] = ng;
            cameFrom[ni] = cur;
            state[ni] = 1;
            const hh = h(nx, ny);
            if (hh < bestH) { bestH = hh; bestI = ni; }
            heap.push(ni, ng + hh * 1.02);
          }
        }
      }
    }

    let endI = found ? goalI : bestI;
    if (endI === startI) return found ? [] : null;

    // reconstruct
    const path = [];
    let i = endI, guard = 0;
    while (i !== -1 && i !== startI && guard++ < 100000) {
      path.push([i % W, (i / W) | 0]);
      i = cameFrom[i];
    }
    path.reverse();
    return path.length ? path : null;
  }
}

/**
 * Throttled path request queue so a mass-move never stalls a frame.
 */
class PathService {
  constructor(grid) {
    this.grid = grid;
    this.queue = [];
    this.budget = 14;   // paths computed per frame
  }
  request(unit, gx, gy, onDone) {
    unit._pathPending = true;
    this.queue.push({ unit, gx, gy, onDone });
  }
  cancel(unit) {
    for (let i = this.queue.length - 1; i >= 0; i--)
      if (this.queue[i].unit === unit) this.queue.splice(i, 1);
    unit._pathPending = false;
  }
  process() {
    let n = 0;
    while (this.queue.length && n < this.budget) {
      const req = this.queue.shift();
      const u = req.unit;
      u._pathPending = false;
      if (!u.alive) { n++; continue; }
      const sx = tileOf(u.x), sy = tileOf(u.y);
      const path = this.grid.findPath(sx, sy, req.gx, req.gy);
      req.onDone(path);
      n++;
    }
  }
}
