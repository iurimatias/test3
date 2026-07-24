/* =========================================================================
   Art — isometric world in a painted storybook style.

   Units are solid black silhouettes with a player-coloured accent (shield,
   bow, tabard). Buildings are timber-framed boxes with shingled roofs, built
   from 3D primitives and projected through iso.js.
   ========================================================================= */
'use strict';

const INK = '#1a1a1a';

const PAL = {
  grass:      '#7cae3e',
  grassLight: '#93c352',
  grassDark:  '#67942f',
  grassDeep:  '#578228',

  dirt:       '#cdb079',
  dirtDark:   '#b6975f',
  road:       '#d3b984',
  roadEdge:   '#bda069',

  sand:       '#e4d5a2',
  water:      '#4f93c4',
  waterDeep:  '#3b78aa',
  waterFoam:  '#8dc0e0',

  wall:       '#dcb684',
  wallDark:   '#b8925f',
  beam:       '#8a6740',
  roof:       '#c0904f',
  roofDark:   '#9a6f3a',
  stone:      '#b9b3a6',
  stoneDark:  '#948d80',
  door:       '#75482a',

  pine:       '#4e8f3e',
  pineDark:   '#33612b',
  pineLight:  '#63a64e',
  bush:       '#5d9b46',
  bushDark:   '#3f7333',
  tuft:       '#5f9440',
  reed:       '#6aa34a',
  trunk:      '#8a6239',
  trunkDark:  '#6b4a2a',
  logEnd:     '#d8b184',

  steel:      '#b9bec8',
  steelLight: '#e2e6ec',
  steelDark:  '#8f959f',
  haft:       '#8a5f36',
  bow:        '#7a5027',
  sack:       '#7a6039',

  gold:       '#f2c318',
  goldDark:   '#c99a0e',
  goldLight:  '#ffe98a',

  rock:       '#aeaaa1',
  rockDark:   '#7c7871',
  rockLight:  '#d2cec6',
  rockLine:   '#5d5a54',

  berry:      '#cc3b30',
  crop:       '#8fb552',
  soil:       '#c2a06a',
  soilDark:   '#9d7c4c',
};

/* --------------------------------------------------------------- helpers */

/** Contact shadow at an explicit iso position. */
function groundShadow2(ctx, x, y, rx, ry, alpha) {
  ctx.fillStyle = `rgba(30,45,20,${alpha === undefined ? 0.22 : alpha})`;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fill();
}

/** Soft contact shadow on the ground under an object. */
function groundShadow(ctx, rx, ry, alpha) {
  ctx.fillStyle = `rgba(30,45,20,${alpha === undefined ? 0.22 : alpha})`;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
  ctx.fill();
}

/* ================================================================ TERRAIN */

/**
 * The ground is painted top-down at world scale and then sheared onto the
 * isometric plane in one blit — flat ground shears exactly right, and it keeps
 * road and shoreline authoring in simple Cartesian coordinates.
 */
function renderTerrainFlat(map) {
  const cv = document.createElement('canvas');
  cv.width = WORLD_W; cv.height = WORLD_H;
  const ctx = cv.getContext('2d');
  const T = CFG.TILE;

  ctx.fillStyle = PAL.grass;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);

  // --- rolling colour variation so the field isn't a flat slab -----------
  for (let pass = 0; pass < 2; pass++) {
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = pass ? PAL.grassDark : PAL.grassLight;
    for (let i = 0; i < 150; i++) {
      const n1 = hashNoise(i * 3 + pass * 91, 7);
      const n2 = hashNoise(i * 5 + pass * 13, 21);
      const n3 = hashNoise(i, 33 + pass);
      ctx.beginPath();
      ctx.ellipse(n1 * WORLD_W, n2 * WORLD_H,
        120 + n3 * 320, 90 + n1 * 240, n2 * 3, 0, TAU);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // --- bare-earth patches from the terrain map ---------------------------
  for (let pass = 0; pass < 2; pass++) {
    ctx.globalAlpha = pass ? 0.45 : 0.8;
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        const t = map.t(x, y);
        if (t !== TERRAIN.DIRT && t !== TERRAIN.SAND) continue;
        ctx.fillStyle = t === TERRAIN.SAND ? PAL.sand : PAL.dirt;
        const n = hashNoise(x * (pass + 1), y * (pass + 3));
        const ox = (hashNoise(x + pass, y) - 0.5) * T;
        const oy = (hashNoise(x, y + pass) - 0.5) * T;
        ctx.beginPath();
        ctx.ellipse(x * T + T / 2 + ox, y * T + T / 2 + oy,
          T * (0.7 + n * 0.7), T * (0.65 + n * 0.6), n * 3, 0, TAU);
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;

  // --- roads -------------------------------------------------------------
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const road of map.roads) {
    for (let layer = 0; layer < 2; layer++) {
      ctx.strokeStyle = layer === 0 ? PAL.roadEdge : PAL.road;
      ctx.lineWidth = layer === 0 ? road.w + 9 : road.w;
      ctx.globalAlpha = layer === 0 ? 0.55 : 1;
      ctx.beginPath();
      ctx.moveTo(road.pts[0][0], road.pts[0][1]);
      for (let i = 1; i < road.pts.length - 1; i++) {
        const a = road.pts[i], b = road.pts[i + 1];
        ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      }
      const last = road.pts[road.pts.length - 1];
      ctx.lineTo(last[0], last[1]);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // --- water, painted over roads so crossings read correctly -------------
  const waterMask = document.createElement('canvas');
  waterMask.width = map.w; waterMask.height = map.h;
  const wm = waterMask.getContext('2d');
  const wimg = wm.createImageData(map.w, map.h);
  for (let i = 0; i < map.w * map.h; i++) {
    wimg.data[i * 4 + 3] = map.terrain[i] === TERRAIN.WATER ? 255 : 0;
  }
  wm.putImageData(wimg, 0, 0);

  // Sandy rim: blow the mask up a little, blur it, and tint the result sand.
  const rim = document.createElement('canvas');
  rim.width = WORLD_W; rim.height = WORLD_H;
  const rc = rim.getContext('2d');
  rc.filter = 'blur(10px)';
  rc.drawImage(waterMask, -16, -16, WORLD_W + 32, WORLD_H + 32);
  rc.filter = 'none';
  rc.globalCompositeOperation = 'source-in';
  rc.fillStyle = PAL.sand;
  rc.fillRect(0, 0, WORLD_W, WORLD_H);
  ctx.drawImage(rim, 0, 0);

  const wc = document.createElement('canvas');
  wc.width = WORLD_W; wc.height = WORLD_H;
  const wcx = wc.getContext('2d');
  wcx.filter = 'blur(4px)';
  wcx.drawImage(waterMask, 0, 0, WORLD_W, WORLD_H);
  wcx.filter = 'none';
  wcx.globalCompositeOperation = 'source-in';
  const grad = wcx.createLinearGradient(0, 0, WORLD_W, WORLD_H);
  grad.addColorStop(0, PAL.water);
  grad.addColorStop(0.5, PAL.waterDeep);
  grad.addColorStop(1, PAL.water);
  wcx.fillStyle = grad;
  wcx.fillRect(0, 0, WORLD_W, WORLD_H);
  // ripples
  wcx.globalCompositeOperation = 'source-atop';
  wcx.strokeStyle = 'rgba(180,220,245,0.5)';
  wcx.lineWidth = 3;
  wcx.beginPath();
  for (let y = 0; y < WORLD_H; y += 26) {
    for (let x = 0; x < WORLD_W; x += 60) {
      const n = hashNoise(x, y);
      if (n > 0.4) continue;
      const px = x + n * 40, py = y + hashNoise(y, x) * 18;
      wcx.moveTo(px, py);
      wcx.quadraticCurveTo(px + 10, py - 5, px + 20, py);
      wcx.quadraticCurveTo(px + 30, py + 5, px + 40, py);
    }
  }
  wcx.stroke();
  ctx.drawImage(wc, 0, 0);

  // --- scattered ground detail ------------------------------------------
  ctx.strokeStyle = 'rgba(60,95,35,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      if (map.t(x, y) !== TERRAIN.GRASS) continue;
      const n = hashNoise(x * 7, y * 13);
      if (n > 0.34) continue;
      const px = x * T + hashNoise(x * 3, y * 5) * T;
      const py = y * T + hashNoise(x * 11, y * 17) * T;
      ctx.moveTo(px - 4, py + 2);
      ctx.quadraticCurveTo(px - 2, py - 4, px, py - 6);
      ctx.moveTo(px + 1, py + 2);
      ctx.quadraticCurveTo(px + 3, py - 3, px + 5, py - 5);
    }
  }
  ctx.stroke();

  return cv;
}

/**
 * Shear the flat ground onto the isometric plane once, so the per-frame cost
 * is a plain axis-aligned blit with source-rect culling.
 */
function renderTerrain(map) {
  const flat = renderTerrainFlat(map);
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(ISO_W) + 4;
  cv.height = Math.ceil(ISO_H) + 4;
  const ctx = cv.getContext('2d');
  ctx.translate(-ISO_MIN_X + 2, 2);
  isoMatrix(ctx);
  ctx.drawImage(flat, 0, 0);
  return cv;
}

/* ------------------------------------------------------- sprite dispatch */

/**
 * Which atlas sprite represents an entity. Several game types share one piece
 * of art on purpose: every infantry tier is the same soldier, and a villager's
 * sprite depends on the job it is doing rather than its unit type.
 */
const SPRITE_FOR_LINE = {
  infantry: 'u.soldier', spear: 'u.spearman', archer: 'u.archer', cavalry: 'u.knight',
};

function unitSpriteName(u) {
  if (u.def.role === 'worker') {
    const tool = villagerTool(u);
    if (tool === 'pick') return 'u.miner';
    if (tool === 'axe') return 'u.lumberjack';
    if (tool === 'fork') return 'u.farmer';
    return 'u.villager';
  }
  return SPRITE_FOR_LINE[u.def.line] || ('u.' + u.type);
}

/** World-pixel width a sprite should occupy, so art lines up with footprints. */
function buildingSpriteWidth(def) {
  // the projected footprint diamond, plus a little overhang for eaves
  return (def.w + def.h) * CFG.TILE * 0.5 * 1.12;
}

/* =============================================================== RESOURCES */

/**
 * Silhouette-first drawing: lay the shape down once in the dark outline colour
 * scaled up a touch, then the fill on top. That gives a clean outline around
 * the whole cluster instead of a stroke around every overlapping blob.
 */
function outlined(ctx, draw, fill, outline, grow) {
  ctx.save();
  ctx.fillStyle = outline;
  ctx.beginPath(); draw(grow === undefined ? 1.14 : grow); ctx.fill();
  ctx.restore();
  ctx.fillStyle = fill;
  ctx.beginPath(); draw(1); ctx.fill();
}

function drawResource(ctx, n, t) {
  const [ix, iy] = worldToIso(n.x, n.y);
  const name = 'r.' + n.type;
  if (Sprites.want(name)) {
    // depleting nodes shrink a little so the player can read them at a glance
    const k = n.maxAmount ? 0.72 + 0.28 * (n.amount / n.maxAmount) : 1;
    Sprites.draw(ctx, name, ix, iy, 0, false, n.type === 'tree' ? 1 : k);
    return;
  }
  ctx.save();
  ctx.translate(ix, iy);
  switch (n.type) {
    case 'tree':  drawPine(ctx, n, t); break;
    case 'bush':  drawBerryBush(ctx, n); break;
    case 'gold':  drawGoldPile(ctx, n); break;
    case 'stone': drawStonePile(ctx, n); break;
  }
  ctx.restore();
}

/** A single scalloped conifer, as on the asset sheet. */
function drawPine(ctx, n, t) {
  const s = n.seed;
  const k = 0.88 + hashNoise(s, 3) * 0.4;
  const H = 52 * k, R = 15 * k;
  const sway = Math.sin(t * 0.7 + (s % 10)) * 0.8;

  groundShadow(ctx, R * 1.15, R * 0.52, 0.26);

  // trunk
  ctx.fillStyle = PAL.trunkDark;
  ctx.fillRect(-3.4 * k, -10 * k, 6.8 * k, 11 * k);
  ctx.fillStyle = PAL.trunk;
  ctx.fillRect(-3.4 * k, -10 * k, 4 * k, 11 * k);

  // Scalloped cone: four skirts whose tips step outward toward the base.
  const TIERS = 4;
  const cone = (g) => {
    const h = H * g, r = R * g;
    ctx.moveTo(sway, -h - 3 * k);
    for (let i = 1; i <= TIERS; i++) {          // right side, apex to base
      const f = i / TIERS;
      const y = -h * (1 - f) - 5 * k;
      ctx.lineTo(r * f * 0.58, y - h * 0.1);
      ctx.lineTo(r * f, y);
    }
    ctx.lineTo(r * 0.72, -2 * k);               // base
    ctx.lineTo(-r * 0.72, -2 * k);
    for (let i = TIERS; i >= 1; i--) {          // left side, base to apex
      const f = i / TIERS;
      const y = -h * (1 - f) - 5 * k;
      ctx.lineTo(-r * f, y);
      ctx.lineTo(-r * f * 0.58, y - h * 0.1);
    }
    ctx.closePath();
  };
  outlined(ctx, cone, PAL.pine, PAL.pineDark, 1.09);

  // sunlit left flank
  ctx.fillStyle = 'rgba(255,255,255,0.13)';
  ctx.beginPath();
  ctx.moveTo(sway, -H - 3 * k);
  ctx.lineTo(-R * 0.72, -2 * k);
  ctx.lineTo(-R * 0.24, -2 * k);
  ctx.closePath();
  ctx.fill();
}

/** Rounded blob cluster; berries mark how much food is left. */
function drawBerryBush(ctx, n) {
  const s = n.seed;
  const frac = n.amount / n.maxAmount;
  groundShadow(ctx, 16, 7, 0.24);

  const blobs = [[-7, -7, 8], [7, -6, 8], [0, -13, 8.5], [-2, -4, 7.5]];
  const shape = (g) => {
    for (const [bx, by, br] of blobs) {
      ctx.moveTo(bx * g + br * g, by * g);
      ctx.arc(bx * g, by * g, br * g, 0, TAU);
    }
  };
  outlined(ctx, shape, PAL.bush, PAL.bushDark, 1.16);

  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.beginPath(); ctx.arc(-5, -13, 4.5, 0, TAU); ctx.fill();

  ctx.fillStyle = PAL.berry;
  const count = Math.max(1, Math.round(7 * frac));
  for (let i = 0; i < count; i++) {
    const bx = (hashNoise(s + i, 3) - 0.5) * 20;
    const by = -6 - hashNoise(s, i + 9) * 12;
    ctx.beginPath(); ctx.arc(bx, by, 2.1, 0, TAU); ctx.fill();
  }
}

/** One faceted boulder: outlined silhouette, mid body, lit top plane. */
function boulder(ctx, x, y, r, tint) {
  const base = tint || PAL.rock;
  ctx.fillStyle = PAL.rockDark;
  ctx.strokeStyle = PAL.rockLine;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x - r, y);
  ctx.lineTo(x - r * 0.75, y - r * 0.95);
  ctx.lineTo(x + r * 0.7, y - r * 0.9);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x + r * 0.5, y + r * 0.4);
  ctx.lineTo(x - r * 0.55, y + r * 0.4);
  ctx.closePath(); ctx.fill(); ctx.stroke();

  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.moveTo(x - r * 0.88, y - r * 0.08);
  ctx.lineTo(x - r * 0.6, y - r * 0.88);
  ctx.lineTo(x + r * 0.62, y - r * 0.84);
  ctx.lineTo(x + r * 0.88, y - r * 0.06);
  ctx.lineTo(x + r * 0.42, y + r * 0.3);
  ctx.lineTo(x - r * 0.48, y + r * 0.3);
  ctx.closePath(); ctx.fill();

  ctx.fillStyle = PAL.rockLight;
  ctx.beginPath();
  ctx.moveTo(x - r * 0.55, y - r * 0.82);
  ctx.lineTo(x + r * 0.1, y - r * 1.0);
  ctx.lineTo(x + r * 0.55, y - r * 0.76);
  ctx.lineTo(x - r * 0.05, y - r * 0.6);
  ctx.closePath(); ctx.fill();
}

/** Little grass tufts around the base of rocks, as on the sheet. */
function baseTufts(ctx, seed, spread, count) {
  ctx.strokeStyle = PAL.tuft;
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const tx = (hashNoise(seed + i, 61) - 0.5) * spread;
    const ty = (hashNoise(seed, i + 71) - 0.5) * spread * 0.42 + 2;
    ctx.moveTo(tx, ty); ctx.lineTo(tx - 2.4, ty - 5);
    ctx.moveTo(tx, ty); ctx.lineTo(tx + 0.4, ty - 6);
    ctx.moveTo(tx, ty); ctx.lineTo(tx + 2.8, ty - 4.4);
  }
  ctx.stroke();
}

function rockMound(ctx, seed, frac, spread, gold) {
  const rocks = [];
  const count = Math.round(6 * frac) + 3;
  for (let i = 0; i < count; i++) {
    rocks.push({
      x: (hashNoise(seed + i, 17) - 0.5) * spread * frac,
      y: (hashNoise(seed, i + 23) - 0.5) * spread * 0.5 * frac,
      r: (4.5 + hashNoise(seed + i, 7) * 4) * (0.7 + frac * 0.4),
    });
  }
  rocks.sort((a, b) => a.y - b.y);
  for (const r of rocks) boulder(ctx, r.x, r.y - r.r * 0.35, r.r);

  if (gold) {
    // nuggets bedded into the rock, gold on grey
    const nug = Math.round(11 * frac) + 4;
    for (let i = 0; i < nug; i++) {
      const gx = (hashNoise(seed + i, 91) - 0.5) * spread * 0.85 * frac;
      const gy = (hashNoise(seed, i + 97) - 0.5) * spread * 0.4 * frac - 3;
      const gr = 3.6 + hashNoise(seed + i, 5) * 2.6;
      ctx.fillStyle = PAL.goldDark;
      ctx.beginPath();
      ctx.moveTo(gx - gr, gy); ctx.lineTo(gx, gy + gr * 0.55);
      ctx.lineTo(gx + gr, gy); ctx.lineTo(gx, gy - gr * 0.55);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = PAL.gold;
      ctx.beginPath();
      ctx.moveTo(gx - gr * 0.8, gy - gr * 0.1); ctx.lineTo(gx, gy + gr * 0.32);
      ctx.lineTo(gx + gr * 0.8, gy - gr * 0.1); ctx.lineTo(gx, gy - gr * 0.5);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = PAL.goldLight;
      ctx.beginPath();
      ctx.moveTo(gx - gr * 0.4, gy - gr * 0.25); ctx.lineTo(gx + gr * 0.15, gy - gr * 0.05);
      ctx.lineTo(gx + gr * 0.4, gy - gr * 0.3); ctx.lineTo(gx - gr * 0.1, gy - gr * 0.5);
      ctx.closePath(); ctx.fill();
    }
  }
}

function drawGoldPile(ctx, n) {
  const frac = 0.6 + 0.4 * (n.amount / n.maxAmount);
  groundShadow(ctx, 20 * frac, 9 * frac, 0.24);
  rockMound(ctx, n.seed, frac, 30, true);
  baseTufts(ctx, n.seed, 34, 3);
}

function drawStonePile(ctx, n) {
  const frac = 0.6 + 0.4 * (n.amount / n.maxAmount);
  groundShadow(ctx, 20 * frac, 9 * frac, 0.24);
  rockMound(ctx, n.seed, frac, 30, false);
  baseTufts(ctx, n.seed + 3, 34, 3);
}

/* ------------------------------------------------------------------ decor */

/**
 * Ground dressing never animates, so each piece is rendered once into a small
 * sprite and blitted thereafter. With a couple of hundred rock clusters on a
 * revealed map that is the difference between a few milliseconds and a few
 * tenths of one.
 */
const DECOR_BOX = {
  rocks: (d) => [d.r * 3.2, d.r * 2.6, d.r * 1.4],
  stump: () => [14, 16, 8],
  reeds: () => [24, 24, 4],
  rubble: (d) => [d.r * 1.6, d.r * 1.4, d.r * 0.8],
  bones: () => [12, 10, 6],
};

const DECOR_SPRITE = { stump: 'd.stump', reeds: 'd.reeds' };

function drawDecor(ctx, d) {
  const [ix, iy] = worldToIso(d.x, d.y);

  const name = d.kind === 'rocks' ? (d.big ? 'd.rocks.big' : 'd.rocks.small')
             : DECOR_SPRITE[d.kind];
  if (name && Sprites.want(name)) {
    Sprites.draw(ctx, name, ix, iy, 0, (d.seed & 1) === 1, 1);
    return;
  }

  if (!d._sprite) {
    const SS = 2;                       // supersample so it stays crisp zoomed in
    const box = (DECOR_BOX[d.kind] || DECOR_BOX.bones)(d);
    const w = Math.ceil(box[0] * 2) + 8, h = Math.ceil(box[1] + box[2]) + 12;
    const cv = document.createElement('canvas');
    cv.width = w * SS; cv.height = h * SS;
    const c = cv.getContext('2d');
    c.scale(SS, SS);
    c.translate(w / 2, h - box[2] - 6);
    drawDecorRaw(c, d);
    d._sprite = cv;
    d._sw = w; d._sh = h;
    d._ox = w / 2;
    d._oy = h - box[2] - 6;
  }
  ctx.drawImage(d._sprite, ix - d._ox, iy - d._oy, d._sw, d._sh);
}

function drawDecorRaw(ctx, d) {
  ctx.save();
  switch (d.kind) {
    case 'stump': {
      // cut stump with pale end grain, plus a couple of chips
      ctx.fillStyle = PAL.trunkDark;
      ctx.beginPath(); ctx.ellipse(0, -3, 7, 4.4, 0, 0, TAU); ctx.fill();
      ctx.fillRect(-7, -6, 14, 4);
      ctx.fillStyle = PAL.logEnd;
      ctx.beginPath(); ctx.ellipse(0, -6, 7, 4.2, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = PAL.trunk;
      ctx.beginPath(); ctx.ellipse(0, -6, 3.4, 2, 0, 0, TAU); ctx.fill();
      break;
    }
    case 'rocks': {
      groundShadow(ctx, d.r * 1.2, d.r * 0.55, 0.22);
      const n = d.big ? 5 : 3;
      const rocks = [];
      for (let i = 0; i < n; i++) {
        rocks.push({
          x: (hashNoise(d.seed + i, 13) - 0.5) * d.r * 1.9,
          y: (hashNoise(d.seed, i + 29) - 0.5) * d.r * 0.9,
          r: d.r * (0.42 + hashNoise(d.seed + i, 41) * 0.5),
        });
      }
      rocks.sort((a, b) => a.y - b.y);
      for (const r of rocks) boulder(ctx, r.x, r.y - r.r * 0.4, r.r);
      baseTufts(ctx, d.seed, d.r * 2.4, d.big ? 4 : 2);
      break;
    }
    case 'reeds': {
      ctx.strokeStyle = PAL.reed;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const rx = (hashNoise(d.seed + i, 3) - 0.5) * 16;
        const hgt = 9 + hashNoise(d.seed, i) * 9;
        ctx.moveTo(rx, 1);
        ctx.quadraticCurveTo(rx + 1.5, 1 - hgt * 0.6, rx + 4, 1 - hgt);
      }
      ctx.stroke();
      break;
    }
    case 'rubble': {
      ctx.fillStyle = 'rgba(120,110,95,0.75)';
      for (let i = 0; i < 8; i++) {
        const a = hashNoise(d.seed, i) * TAU;
        const rr = hashNoise(d.seed + 5, i) * d.r;
        const [px, py] = worldToIso(Math.cos(a) * rr, Math.sin(a) * rr);
        ctx.beginPath();
        ctx.ellipse(px, py, 4 + hashNoise(d.seed, i + 2) * 4, 3, 0, 0, TAU);
        ctx.fill();
      }
      break;
    }
    case 'bones': {
      ctx.fillStyle = 'rgba(40,40,40,0.32)';
      ctx.beginPath(); ctx.ellipse(0, -1, 7, 3.2, 0.4, 0, TAU); ctx.fill();
      break;
    }
  }
  ctx.restore();
}

/* =================================================================== UNITS */

/** Round shield: steel rim, coloured field, bright central boss. */
function roundShield(ctx, x, y, r, col) {
  ctx.fillStyle = PAL.steelDark;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.fillStyle = col.fill;
  ctx.beginPath(); ctx.arc(x, y, r * 0.76, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath(); ctx.arc(x - r * 0.22, y - r * 0.24, r * 0.42, 0, TAU); ctx.fill();
  ctx.fillStyle = PAL.steelLight;
  ctx.beginPath(); ctx.arc(x, y, r * 0.2, 0, TAU); ctx.fill();
}

/**
 * A long-handled tool carried across the body, head up and to the left —
 * the pose the villager variants use on the asset sheet.
 */
function carriedTool(ctx, kind, ink) {
  const bx = 7, by = -11, tx = -6, ty = -43;      // butt and head of the haft
  ctx.strokeStyle = PAL.haft;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();

  const ang = Math.atan2(ty - by, tx - bx);
  ctx.save();
  ctx.translate(tx, ty);
  ctx.rotate(ang + Math.PI / 2);

  if (kind === 'pick') {
    ctx.strokeStyle = PAL.steel;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(-6, 2); ctx.quadraticCurveTo(0, -3.5, 6, 1.5);
    ctx.stroke();
  } else if (kind === 'axe') {
    ctx.fillStyle = PAL.steel;
    ctx.beginPath();
    ctx.moveTo(0, 3); ctx.lineTo(-0.5, -1.5);
    ctx.quadraticCurveTo(5, -3.5, 6.5, 2);
    ctx.quadraticCurveTo(3.5, 5, 0, 4);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = PAL.steelLight;
    ctx.beginPath();
    ctx.moveTo(3.6, -2); ctx.quadraticCurveTo(6, -1.6, 6.5, 2);
    ctx.quadraticCurveTo(4.6, 2.4, 3.8, 0.6);
    ctx.closePath(); ctx.fill();
  } else if (kind === 'fork') {
    ctx.strokeStyle = PAL.steel;
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(-3.6, 2.5); ctx.lineTo(-3.6, -4);
    ctx.moveTo(0, 3); ctx.lineTo(0, -4.8);
    ctx.moveTo(3.6, 2.5); ctx.lineTo(3.6, -4);
    ctx.moveTo(-4.2, 2.5); ctx.lineTo(4.2, 2.5);
    ctx.stroke();
  } else if (kind === 'hammer') {
    ctx.fillStyle = PAL.steel;
    ctx.fillRect(-2.6, -2.4, 5.2, 6);
    ctx.fillStyle = PAL.steelLight;
    ctx.fillRect(-2.6, -2.4, 5.2, 2);
  }
  ctx.restore();
  ctx.strokeStyle = ink;
}

function drawUnit(ctx, u, col) {
  const [ix, iy] = worldToIso(u.x, u.y);
  const base = unitSpriteName(u);
  const frame = base + '.f' + Sprites.unitFrame(u);
  if (Sprites.want(frame)) {
    // the sprite carries its own shadow, so none is drawn here
    const sdx = Math.cos(u.facing) - Math.sin(u.facing);
    if (u.deathT !== undefined) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - Math.min(1, u.deathT / 1.6) * 0.9);
    }
    Sprites.draw(ctx, frame, ix, iy, u.owner, sdx < 0, 1);
    if (u.hitFlash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = u.hitFlash * 2.4;
      Sprites.draw(ctx, frame, ix, iy, u.owner, sdx < 0, 1);
      ctx.restore();
    }
    if (u.deathT !== undefined) ctx.restore();
    if (u.carry && u.carry.amount > 0.5) drawCarryIcon(ctx, ix + 10, iy - 34, u.carry.type);
    return;
  }
  ctx.save();
  ctx.translate(ix, iy);

  const horse = u.def.art === 'horse';
  groundShadow(ctx, horse ? 16 : 9, horse ? 7 : 4, 0.3);

  if (u.deathT !== undefined) {
    const p = Math.min(1, u.deathT / 0.7);
    ctx.globalAlpha = 1 - p * 0.85;
    ctx.rotate(p * 1.4 * (u.dieDir || 1));
    ctx.translate(0, p * 3);
  }

  // face left or right by travel direction in screen space
  const sdx = Math.cos(u.facing) - Math.sin(u.facing);
  ctx.scale(sdx >= 0 ? 1 : -1, 1);

  const moving = !!(u.path && u.path.length);
  const ph = moving ? u.walkPhase
    : (u.state === 'gather' || u.state === 'build' ? u.anim * 6 : 0);
  const swing = moving ? Math.sin(ph) * 0.5 : 0;
  const bob = moving ? Math.abs(Math.sin(ph)) * 1.1 : Math.sin(u.anim * 1.6) * 0.3;

  const ink = u.hitFlash > 0 ? '#d63a2a' : INK;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (horse) drawRider(ctx, u, col, ph, moving);
  else drawWalker(ctx, u, col, swing, bob, ink);

  ctx.restore();

  if (u.carry && u.carry.amount > 0.5) drawCarryIcon(ctx, ix + 10, iy - 38, u.carry.type);
}

/** Which tool a villager should be holding, from what it is currently doing. */
function villagerTool(u) {
  if (u.state === 'build') return 'hammer';
  const t = u.target;
  if (t && t.kind === 'building' && t.def && t.def.farmFood) return 'fork';
  const res = (t && t.resType) || (u.carry && u.carry.type);
  if (res === 'wood') return 'axe';
  if (res === 'gold' || res === 'stone') return 'pick';
  if (u.state === 'gather') return 'fork';
  return null;
}

function drawWalker(ctx, u, col, swing, bob, ink) {
  const HIP = -17 - bob, SHO = -30 - bob, HEAD = -37.5 - bob;
  const art = u.def.art;

  // legs
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.moveTo(0, HIP); ctx.lineTo(Math.sin(swing) * 6.5, 0);
  ctx.moveTo(0, HIP); ctx.lineTo(Math.sin(-swing) * 6.5, 0);
  ctx.stroke();

  // tapered torso
  ctx.beginPath();
  ctx.moveTo(-3.4, SHO); ctx.lineTo(3.4, SHO);
  ctx.lineTo(2.2, HIP); ctx.lineTo(-2.2, HIP);
  ctx.closePath();
  ctx.fill();

  // head
  ctx.beginPath();
  ctx.arc(0, HEAD, 5.2, 0, TAU);
  ctx.fill();

  const arm = (x1, y1, x2, y2) => {
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  };

  switch (art) {
    case 'villager': {
      const tool = villagerTool(u);
      if (tool) {
        // both hands on the haft
        arm(0, SHO + 2, 5, SHO + 6);
        arm(0, SHO + 2, -3, SHO - 4);
        carriedTool(ctx, tool, ink);
      } else {
        const work = (u.state === 'gather') ? Math.sin(u.anim * 7) * 0.5 : 0;
        arm(0, SHO + 2, 7, SHO + 11 + work * 4);
        arm(0, SHO + 2, -7, SHO + 11 - work * 4);
      }
      if (u.carry && u.carry.amount > 3) {
        ctx.fillStyle = PAL.sack;
        ctx.beginPath(); ctx.arc(-7, SHO + 4, 4.2, 0, TAU); ctx.fill();
        ctx.fillStyle = ink;
      }
      break;
    }

    case 'sword': {
      arm(0, SHO + 2, -7, SHO + 8);
      roundShield(ctx, -10, SHO + 10, 7.5, col);
      // sword arm, raised and swinging on attack
      const a = -1.15 - u.swing * 0.9;
      const hx = Math.cos(a) * 10, hy = SHO + 2 + Math.sin(a) * 10;
      ctx.strokeStyle = ink;
      arm(0, SHO + 2, hx, hy);
      const ba = a - 0.15 + u.swing * 1.5;
      ctx.strokeStyle = PAL.steel; ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx + Math.cos(ba) * 19, hy + Math.sin(ba) * 19);
      ctx.stroke();
      ctx.strokeStyle = PAL.steelLight; ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(hx + Math.cos(ba) * 4, hy + Math.sin(ba) * 4 - 1);
      ctx.lineTo(hx + Math.cos(ba) * 17, hy + Math.sin(ba) * 17 - 1);
      ctx.stroke();
      ctx.strokeStyle = ink; ctx.lineWidth = 2.4;   // crossguard
      ctx.beginPath();
      ctx.moveTo(hx + Math.cos(ba + 1.57) * 4, hy + Math.sin(ba + 1.57) * 4);
      ctx.lineTo(hx - Math.cos(ba + 1.57) * 4, hy - Math.sin(ba + 1.57) * 4);
      ctx.stroke();
      break;
    }

    case 'spear': {
      arm(0, SHO + 2, -7, SHO + 8);
      roundShield(ctx, -10, SHO + 10, 7.5, col);
      arm(0, SHO + 2, 7, SHO + 4);
      const th = u.swing * 7;
      ctx.strokeStyle = PAL.haft; ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.moveTo(7 + th * 0.4, SHO + 18); ctx.lineTo(7 + th, SHO - 28);
      ctx.stroke();
      ctx.fillStyle = PAL.steel;
      ctx.beginPath();
      ctx.moveTo(7 + th, SHO - 36);
      ctx.quadraticCurveTo(3.4 + th, SHO - 29, 7 + th, SHO - 26);
      ctx.quadraticCurveTo(10.6 + th, SHO - 29, 7 + th, SHO - 36);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = ink;
      break;
    }

    case 'bow': {
      const draw = u.swing;
      // coloured tunic
      ctx.fillStyle = col.fill;
      ctx.beginPath();
      ctx.moveTo(-3.4, SHO + 5); ctx.lineTo(3.4, SHO + 5);
      ctx.lineTo(2.4, HIP + 1); ctx.lineTo(-2.4, HIP + 1);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = ink;
      // quiver
      ctx.strokeStyle = PAL.haft; ctx.lineWidth = 4.5;
      ctx.beginPath(); ctx.moveTo(-6, SHO); ctx.lineTo(-9, SHO + 10); ctx.stroke();
      ctx.strokeStyle = ink;
      arm(0, SHO + 2, 11, SHO + 1);
      arm(0, SHO + 2, 4 - draw * 4, SHO + 6);
      // recurve bow
      ctx.strokeStyle = PAL.bow; ctx.lineWidth = 2.8;
      ctx.beginPath(); ctx.arc(12, SHO + 1, 12, -1.35, 1.35); ctx.stroke();
      ctx.strokeStyle = '#e8e2d0'; ctx.lineWidth = 1.1;
      const pull = 3 + draw * 6;
      const bx = 12 + Math.cos(-1.35) * 12, byTop = SHO + 1 + Math.sin(-1.35) * 12;
      const byBot = SHO + 1 + Math.sin(1.35) * 12;
      ctx.beginPath();
      ctx.moveTo(bx, byTop); ctx.lineTo(12 - pull, SHO + 1); ctx.lineTo(bx, byBot);
      ctx.stroke();
      if (draw > 0.12) {
        ctx.strokeStyle = PAL.haft; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(12 - pull, SHO + 1); ctx.lineTo(26, SHO + 1); ctx.stroke();
      }
      ctx.strokeStyle = ink;
      break;
    }
  }
}

function drawRider(ctx, u, col, ph, moving) {
  const gait = moving ? Math.sin(ph * 0.85) : 0;
  const back = -21 - Math.abs(gait) * 1.2;
  const ink = ctx.fillStyle;

  ctx.lineWidth = 3.4;
  ctx.beginPath();
  const l1 = gait * 0.5, l2 = -gait * 0.5;
  ctx.moveTo(-9, back + 9); ctx.lineTo(-9 + Math.sin(l1) * 7, 0);
  ctx.moveTo(-5, back + 9); ctx.lineTo(-5 + Math.sin(l2) * 7, 0);
  ctx.moveTo(8, back + 8); ctx.lineTo(8 + Math.sin(l2) * 7, 0);
  ctx.moveTo(12, back + 8); ctx.lineTo(12 + Math.sin(l1) * 7, 0);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-13, back + 2);
  ctx.quadraticCurveTo(0, back - 4, 13, back);
  ctx.lineTo(13, back + 9);
  ctx.quadraticCurveTo(0, back + 13, -12, back + 10);
  ctx.closePath(); ctx.fill();

  ctx.beginPath();
  ctx.moveTo(11, back - 1);
  ctx.lineTo(19, back - 12);
  ctx.lineTo(26, back - 11);
  ctx.lineTo(25, back - 6);
  ctx.lineTo(16, back - 3);
  ctx.closePath(); ctx.fill();

  ctx.lineWidth = 2.8;
  ctx.beginPath();
  ctx.moveTo(-13, back + 2);
  ctx.quadraticCurveTo(-21, back + 5 + gait * 2, -19, back + 15);
  ctx.stroke();

  // caparison
  ctx.fillStyle = col.fill;
  ctx.beginPath();
  ctx.moveTo(-6, back + 4); ctx.lineTo(6, back + 3);
  ctx.lineTo(5, back + 13); ctx.lineTo(-5, back + 14);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = ink;

  const HIP = back - 3, SHO = HIP - 12, HEAD = SHO - 7;
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.moveTo(0, HIP); ctx.lineTo(6, HIP + 8); ctx.lineTo(5, HIP + 13);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-3, SHO); ctx.lineTo(3, SHO);
  ctx.lineTo(2, HIP); ctx.lineTo(-2, HIP);
  ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.arc(0, HEAD, 4.8, 0, TAU); ctx.fill();

  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, SHO + 2); ctx.lineTo(-8, SHO + 7); ctx.stroke();
  roundShield(ctx, -11, SHO + 9, 7, col);

  const a = -1.1 - u.swing * 0.8;
  const hx = Math.cos(a) * 9, hy = SHO + 2 + Math.sin(a) * 9;
  ctx.strokeStyle = ink;
  ctx.beginPath(); ctx.moveTo(0, SHO + 2); ctx.lineTo(hx, hy); ctx.stroke();
  ctx.strokeStyle = PAL.steel; ctx.lineWidth = 3.4;
  const ba = a - 0.1 + u.swing * 1.4;
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(hx + Math.cos(ba) * 19, hy + Math.sin(ba) * 19);
  ctx.stroke();
  ctx.strokeStyle = ink;
}

const RES_ICON_COLORS = { food: '#c0392b', wood: '#8a6a3a', gold: '#d4af37', stone: '#9a9a9a' };

function drawCarryIcon(ctx, x, y, type) {
  ctx.save();
  ctx.fillStyle = RES_ICON_COLORS[type] || '#888';
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (type === 'wood') ctx.rect(x - 3, y - 2, 6, 4);
  else if (type === 'stone') { ctx.moveTo(x - 3, y + 2); ctx.lineTo(x, y - 3); ctx.lineTo(x + 3, y + 2); ctx.closePath(); }
  else ctx.arc(x, y, 3, 0, TAU);
  ctx.fill(); ctx.stroke();
  ctx.restore();
}

/* =============================================================== BUILDINGS */

function drawBuilding(ctx, b, col, time) {
  const [ix, iy] = worldToIso(b.x, b.y);
  const name = 'b.' + b.type;
  if (b.built && Sprites.want(name)) {
    Sprites.draw(ctx, name, ix, iy, b.owner, false, 1);
    return;
  }
  ctx.save();
  ctx.translate(ix, iy);

  const hw = b.pxW / 2, hh = b.pxH / 2;

  // footprint shadow
  ctx.save();
  ctx.fillStyle = 'rgba(30,45,20,0.20)';
  ctx.beginPath();
  isoDiamondPath(ctx, 2, 2, hw * 0.94, hh * 0.94, 0);
  ctx.fill();
  ctx.restore();

  if (!b.built) { drawConstruction(ctx, b, col, hw, hh); ctx.restore(); return; }

  const flash = b.hitFlash > 0;
  switch (b.def.art) {
    case 'house':        buildHouse(ctx, hw, hh, col); break;
    case 'towncenter':   buildTownCenter(ctx, hw, hh, col, time); break;
    case 'mill':         buildMill(ctx, hw, hh, col, time); break;
    case 'lumbercamp':   buildCamp(ctx, hw, hh, col, 'logs'); break;
    case 'miningcamp':   buildCamp(ctx, hw, hh, col, 'ore'); break;
    case 'farm':         buildFarm(ctx, b, hw, hh, col); break;
    case 'barracks':     buildHall(ctx, hw, hh, col, 'swords'); break;
    case 'archeryrange': buildHall(ctx, hw, hh, col, 'target'); break;
    case 'stable':       buildHall(ctx, hw, hh, col, 'horse'); break;
    case 'blacksmith':   buildSmithy(ctx, hw, hh, col, time); break;
    case 'tower':        buildTower(ctx, hw, hh, col); break;
    case 'castle':       buildCastle(ctx, hw, hh, col); break;
  }

  if (flash) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = 'rgba(214,58,42,0.45)';
    ctx.fillRect(-hw * 2 - 40, -160, hw * 4 + 80, 240);
    ctx.restore();
  }
  ctx.restore();
}

/** Timber walls with a plank line or two. */
/** Timber walls with log courses on the two visible faces. */
function timberBox(ctx, x0, y0, z0, x1, y1, z1, base) {
  base = base || PAL.wall;
  box3(ctx, x0, y0, z0, x1, y1, z1,
    shade(base, FACE_TOP), shade(base, FACE_LEFT), shade(base, FACE_RIGHT));
  const rows = Math.max(1, Math.round((z1 - z0) / 7));
  for (let i = 1; i < rows; i++) {
    const z = z0 + (z1 - z0) * (i / rows);
    line3(ctx, [x0, y1, z], [x1, y1, z], 'rgba(96,68,38,0.28)', 1);
    line3(ctx, [x1, y0, z], [x1, y1, z], 'rgba(96,68,38,0.32)', 1);
  }
  // corner posts, the log-cabin read
  line3(ctx, [x0, y1, z0], [x0, y1, z1], 'rgba(96,68,38,0.4)', 1.6);
  line3(ctx, [x1, y1, z0], [x1, y1, z1], 'rgba(96,68,38,0.45)', 1.6);
  line3(ctx, [x1, y0, z0], [x1, y0, z1], 'rgba(96,68,38,0.4)', 1.6);
}

/** Boards running down the slope, from eave to ridge. */
function roofPlanks(ctx, eaveA, eaveB, ridgeA, ridgeB, n) {
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const e = [lerp(eaveA[0], eaveB[0], t), lerp(eaveA[1], eaveB[1], t), lerp(eaveA[2], eaveB[2], t)];
    const r = [lerp(ridgeA[0], ridgeB[0], t), lerp(ridgeA[1], ridgeB[1], t), lerp(ridgeA[2], ridgeB[2], t)];
    line3(ctx, e, r, 'rgba(80,50,24,0.26)', 1.1);
  }
}

/** Gabled roof: ridge along world x, slopes falling toward ±y. */
function gableRoof(ctx, x0, y0, x1, y1, z, rise, oh, colA, colB, trim) {
  const ax0 = x0 - oh, ax1 = x1 + oh, ay0 = y0 - oh, ay1 = y1 + oh;
  const my = (y0 + y1) / 2, top = z + rise;

  poly3(ctx, [[ax0, ay0, z], [ax1, ay0, z], [ax1, my, top], [ax0, my, top]], colB);
  poly3(ctx, [[ax1, ay0, z], [ax1, ay1, z], [ax1, my, top]], shade(PAL.wall, -0.26));
  poly3(ctx, [[ax0, ay0, z], [ax0, ay1, z], [ax0, my, top]], shade(PAL.wall, -0.08));
  poly3(ctx, [[ax0, ay1, z], [ax1, ay1, z], [ax1, my, top], [ax0, my, top]], colA);

  roofPlanks(ctx, [ax0, ay1, z], [ax1, ay1, z], [ax0, my, top], [ax1, my, top], 9);
  line3(ctx, [ax0, my, top], [ax1, my, top], shade(colA, -0.4), 2.4);

  if (trim) {
    poly3(ctx, [[ax0, ay1, z], [ax1, ay1, z], [ax1, ay1, z - 3.5], [ax0, ay1, z - 3.5]], trim);
    poly3(ctx, [[ax1, ay0, z], [ax1, ay1, z], [ax1, ay1, z - 3.5], [ax1, ay0, z - 3.5]],
      shade(trim, -0.25));
  }
}

/** Hipped roof: slopes on all four sides meeting at a short ridge. */
function hipRoof(ctx, x0, y0, x1, y1, z, rise, oh, colA, colB, trim) {
  const ax0 = x0 - oh, ax1 = x1 + oh, ay0 = y0 - oh, ay1 = y1 + oh;
  const cy = (y0 + y1) / 2, cx = (x0 + x1) / 2, top = z + rise;
  const rl = (x1 - x0) * 0.18;
  const rx0 = cx - rl, rx1 = cx + rl;

  // far slope, then the two the camera sees
  poly3(ctx, [[ax0, ay0, z], [ax1, ay0, z], [rx1, cy, top], [rx0, cy, top]], colB);
  poly3(ctx, [[ax0, ay0, z], [ax0, ay1, z], [rx0, cy, top]], shade(colA, -0.1));
  poly3(ctx, [[ax1, ay0, z], [ax1, ay1, z], [rx1, cy, top]], shade(colA, -0.3));
  roofPlanks(ctx, [ax1, ay0, z], [ax1, ay1, z], [rx1, cy, top], [rx1, cy, top], 6);
  poly3(ctx, [[ax0, ay1, z], [ax1, ay1, z], [rx1, cy, top], [rx0, cy, top]], colA);
  roofPlanks(ctx, [ax0, ay1, z], [ax1, ay1, z], [rx0, cy, top], [rx1, cy, top], 10);
  line3(ctx, [rx0, cy, top], [rx1, cy, top], shade(colA, -0.4), 2.4);
  // hip ridges
  line3(ctx, [ax0, ay1, z], [rx0, cy, top], shade(colA, -0.35), 1.6);
  line3(ctx, [ax1, ay1, z], [rx1, cy, top], shade(colA, -0.35), 1.6);

  if (trim) {
    poly3(ctx, [[ax0, ay1, z], [ax1, ay1, z], [ax1, ay1, z - 3.5], [ax0, ay1, z - 3.5]], trim);
    poly3(ctx, [[ax1, ay0, z], [ax1, ay1, z], [ax1, ay1, z - 3.5], [ax1, ay0, z - 3.5]],
      shade(trim, -0.25));
  }
}

function doorAndWindows(ctx, x0, x1, y, z, col) {
  const cx = (x0 + x1) / 2;
  poly3(ctx, [[cx - 6, y, z], [cx + 6, y, z], [cx + 6, y, z + 18], [cx - 6, y, z + 18]],
    PAL.door, col.fill, 2.4);
  for (const wx of [x0 + 8, x1 - 8]) {
    if (Math.abs(wx - cx) < 11) continue;
    poly3(ctx, [[wx - 4.5, y, z + 9], [wx + 4.5, y, z + 9], [wx + 4.5, y, z + 19], [wx - 4.5, y, z + 19]],
      '#3f5d76', col.fill, 2.4);
  }
  const wy = -y * 0.25;
  poly3(ctx, [[x1, wy - 4.5, z + 9], [x1, wy + 4.5, z + 9],
              [x1, wy + 4.5, z + 19], [x1, wy - 4.5, z + 19]],
    '#33506a', shade(col.fill, -0.25), 2.2);
}

/** Short flight of steps up to the door, as on the sheet's house. */
function porchSteps(ctx, cx, y, z) {
  for (let i = 0; i < 3; i++) {
    const zz = z - i * 2.6;
    box3(ctx, cx - 7, y + i * 2.6, Math.max(0, zz - 2.6), cx + 7, y + i * 2.6 + 3, zz,
      shade(PAL.wall, 0.06), shade(PAL.wall, -0.12), shade(PAL.wall, -0.34));
  }
}

function buildHouse(ctx, hw, hh, col) {
  const w = hw - 5, h = hh - 5;
  timberBox(ctx, -w, -h, 0, w, h, 5, PAL.stone);
  timberBox(ctx, -w, -h, 5, w, h, 32);
  doorAndWindows(ctx, -w, w, h, 5, col);
  porchSteps(ctx, 0, h, 5);
  gableRoof(ctx, -w, -h, w, h, 32, 15, 4, PAL.roof, shade(PAL.roof, -0.2), col.fill);
}

/**
 * Three timber storeys under hipped roofs, ringed by a palisade, flag on top —
 * the silhouette from the asset sheet.
 */
function buildTownCenter(ctx, hw, hh, col, time) {
  const w = hw - 11, h = hh - 11;

  palisade(ctx, hw - 2, hh - 2, false);   // stakes behind the keep

  // ground storey
  timberBox(ctx, -w, -h, 0, w, h, 6, PAL.stone);
  timberBox(ctx, -w, -h, 6, w, h, 30);
  doorAndWindows(ctx, -w, w, h, 6, col);
  colourBand(ctx, -w, -h, w, h, 30, col.fill);
  hipRoof(ctx, -w, -h, w, h, 34, 11, 9, PAL.roof, shade(PAL.roof, -0.2), col.fill);

  // middle storey, inset, with a railed balcony
  const w2 = w * 0.76, h2 = h * 0.76;
  timberBox(ctx, -w2, -h2, 44, w2, h2, 64);
  railing(ctx, w, h, 44, col.fill);
  for (const wx of [-w2 * 0.5, w2 * 0.5])
    poly3(ctx, [[wx - 4.5, h2, 50], [wx + 4.5, h2, 50], [wx + 4.5, h2, 60], [wx - 4.5, h2, 60]],
      '#3f5d76', col.fill, 2.2);
  colourBand(ctx, -w2, -h2, w2, h2, 64, col.fill);
  hipRoof(ctx, -w2, -h2, w2, h2, 68, 10, 8, PAL.roof, shade(PAL.roof, -0.2), col.fill);

  // lookout
  const w3 = w2 * 0.56, h3 = h2 * 0.56;
  timberBox(ctx, -w3, -h3, 78, w3, h3, 92);
  hipRoof(ctx, -w3, -h3, w3, h3, 92, 11, 7, PAL.roof, shade(PAL.roof, -0.2), col.fill);

  bannerPole(ctx, 0, 0, 103, 26, col, time);

  palisade(ctx, hw - 2, hh - 2, true);    // and the ones in front of it
}

/** A painted band wrapping the two visible walls at height z. */
function colourBand(ctx, x0, y0, x1, y1, z, c) {
  poly3(ctx, [[x0, y1, z - 4], [x1, y1, z - 4], [x1, y1, z], [x0, y1, z]], c);
  poly3(ctx, [[x1, y0, z - 4], [x1, y1, z - 4], [x1, y1, z], [x1, y0, z]], shade(c, -0.25));
}

/** Balcony rail around a storey. */
function railing(ctx, w, h, z, c) {
  poly3(ctx, [[-w, h, z], [w, h, z], [w, h, z + 4], [-w, h, z + 4]], c);
  poly3(ctx, [[w, -h, z], [w, h, z], [w, h, z + 4], [w, -h, z + 4]], shade(c, -0.25));
  for (let x = -w + 4; x < w; x += 9) line3(ctx, [x, h, z], [x, h, z + 4], shade(c, -0.4), 1);
}

/** Wooden stake fence around a plot. */
function palisade(ctx, hw, hh, front) {
  const step = 10;
  let posts = [];
  for (let x = -hw; x <= hw; x += step) { posts.push([x, hh]); posts.push([x, -hh]); }
  for (let y = -hh; y <= hh; y += step) { posts.push([hw, y]); posts.push([-hw, y]); }
  posts.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));
  // The camera looks from +x+y, so stakes with a positive diagonal are nearer
  // than the keep and have to be painted after it.
  posts = posts.filter(([x, y]) => (front ? x + y >= 0 : x + y < 0));
  for (const [x, y] of posts) {
    box3(ctx, x - 2.6, y - 2.6, 0, x + 2.6, y + 2.6, 14,
      shade(PAL.beam, 0.2), shade(PAL.beam, -0.02), shade(PAL.beam, -0.3));
    poly3(ctx, [[x - 2.6, y - 2.6, 14], [x + 2.6, y - 2.6, 14], [x, y, 17.5]],
      shade(PAL.beam, 0.26));
    poly3(ctx, [[x - 2.6, y + 2.6, 14], [x + 2.6, y + 2.6, 14], [x, y, 17.5]],
      shade(PAL.beam, 0.1));
  }
  if (front) {
    line3(ctx, [-hw, hh, 9], [hw, hh, 9], shade(PAL.beam, -0.18), 2);
    line3(ctx, [hw, -hh, 9], [hw, hh, 9], shade(PAL.beam, -0.28), 2);
  }
}

/** Pole with a swallow-tailed banner. */
function bannerPole(ctx, wx, wy, z, len, col, time) {
  const [bx, by] = p3(wx, wy, z);
  ctx.strokeStyle = PAL.trunkDark;
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(bx, by + 6); ctx.lineTo(bx, by - len); ctx.stroke();
  ctx.fillStyle = PAL.steelLight;
  ctx.beginPath(); ctx.arc(bx, by - len - 2.5, 2.4, 0, TAU); ctx.fill();

  const wave = Math.sin(time * 2.6) * 2;
  const top = by - len + 2, bot = top + 15, tip = 20;
  ctx.fillStyle = col.fill;
  ctx.beginPath();
  ctx.moveTo(bx, top);
  ctx.quadraticCurveTo(bx + tip * 0.6, top + wave, bx + tip, top + 2 + wave);
  ctx.lineTo(bx + tip * 0.66, (top + bot) / 2 + wave);
  ctx.lineTo(bx + tip, bot + wave);
  ctx.quadraticCurveTo(bx + tip * 0.6, bot + 2 + wave, bx, bot);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.beginPath();
  ctx.moveTo(bx, top + 10); ctx.lineTo(bx + tip * 0.75, top + 11 + wave);
  ctx.lineTo(bx + tip * 0.7, bot + wave); ctx.lineTo(bx, bot);
  ctx.closePath(); ctx.fill();
}

function buildHall(ctx, hw, hh, col, sign) {
  const w = hw - 6, h = hh - 6;
  timberBox(ctx, -w, -h, 0, w, h, 6, PAL.stone);
  timberBox(ctx, -w, -h, 6, w, h, 38);
  doorAndWindows(ctx, -w, w, h, 6, col);
  gableRoof(ctx, -w, -h, w, h, 38, 17, 5, PAL.roof, shade(PAL.roof, -0.2), col.fill);

  // small painted shield on the front wall, saying what this hall trains
  const S = 6;
  poly3(ctx, [[-w + 5 - S, h, 14], [-w + 5 + S, h, 14],
              [-w + 5 + S, h, 14 + S * 2], [-w + 5 - S, h, 14 + S * 2]],
    '#e8dcc0', '#5a4128', 1.4);
  const [sx, sy] = p3(-w + 5, h, 20);
  ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (sign === 'swords') {
    ctx.moveTo(sx - 3.4, sy + 3.4); ctx.lineTo(sx + 3.4, sy - 3.4);
    ctx.moveTo(sx + 3.4, sy + 3.4); ctx.lineTo(sx - 3.4, sy - 3.4);
    ctx.stroke();
  } else if (sign === 'target') {
    ctx.arc(sx, sy, 4, 0, TAU); ctx.stroke();
    ctx.fillStyle = PAL.berry;
    ctx.beginPath(); ctx.arc(sx, sy, 1.5, 0, TAU); ctx.fill();
  } else {
    ctx.moveTo(sx - 3.5, sy + 3.5);
    ctx.quadraticCurveTo(sx - 4, sy - 3, sx, sy - 3.5);
    ctx.quadraticCurveTo(sx + 4, sy - 3, sx + 3.5, sy + 3.5);
    ctx.stroke();
  }
}

function buildMill(ctx, hw, hh, col, time) {
  const w = hw - 6, h = hh - 6;
  timberBox(ctx, -w, -h, 0, w, h, 5, PAL.stone);
  timberBox(ctx, -w * 0.8, -h * 0.8, 5, w * 0.8, h * 0.8, 32);
  doorAndWindows(ctx, -w * 0.8, w * 0.8, h * 0.8, 5, col);
  gableRoof(ctx, -w * 0.8, -h * 0.8, w * 0.8, h * 0.8, 32, 14, 5, PAL.roof, shade(PAL.roof, -0.2), col.fill);

  // sails on the +y face
  const [cx, cy] = p3(0, h * 0.8, 34);
  ctx.save();
  ctx.translate(cx, cy);
  const a = time * 0.8;
  ctx.strokeStyle = '#5a4128'; ctx.lineWidth = 2.4;
  ctx.fillStyle = 'rgba(240,232,208,0.9)';
  for (let i = 0; i < 4; i++) {
    const aa = a + i * (TAU / 4);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(aa) * 20, Math.sin(aa) * 20);
    const [px, py] = rot(20, 5, aa);
    ctx.lineTo(px, py);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

function buildCamp(ctx, hw, hh, col, kind) {
  const w = hw - 5, h = hh - 5;
  // open lean-to: four posts + roof
  for (const [px, py] of [[-w, -h], [w, -h], [w, h], [-w, h]]) {
    box3(ctx, px - 2.5, py - 2.5, 0, px + 2.5, py + 2.5, 20,
      shade(PAL.beam, 0.18), shade(PAL.beam, -0.02), shade(PAL.beam, -0.28));
  }
  gableRoof(ctx, -w, -h, w, h, 20, 12, 6, PAL.roof, shade(PAL.roof, -0.2), col.fill);

  if (kind === 'logs') {
    // a corded stack: each log a cylinder with a pale end-grain face
    const rows = [[-6, 3], [-6, 3], [-2, 2]];
    for (let r = 0; r < rows.length; r++) {
      const [y0, n] = rows[r];
      for (let i = 0; i < n; i++) {
        const z = r * 7 + 1;
        const yy = y0 + i * 7 - r * 3.5;
        const x0 = -w + 5, x1 = w - 5;
        box3(ctx, x0, yy - 3.2, z, x1, yy + 3.2, z + 6.4,
          shade(PAL.trunk, 0.16), shade(PAL.trunk, -0.04), shade(PAL.trunk, -0.3));
        const [ex, ey] = p3(x1, yy, z + 3.2);
        ctx.fillStyle = PAL.logEnd;
        ctx.beginPath(); ctx.ellipse(ex, ey, 3.4, 3.2, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = shade(PAL.trunk, -0.1);
        ctx.beginPath(); ctx.ellipse(ex, ey, 1.5, 1.4, 0, 0, TAU); ctx.fill();
      }
    }
  } else {
    // ore cart
    box3(ctx, -8, -6, 2, 8, 6, 12,
      shade('#8c8579', 0.12), shade('#8c8579', -0.05), shade('#8c8579', -0.3));
    ctx.fillStyle = PAL.gold;
    const [gx, gy] = p3(0, 0, 13);
    ctx.beginPath(); ctx.ellipse(gx, gy, 7, 3.4, 0, 0, TAU); ctx.fill();
  }
}

function buildSmithy(ctx, hw, hh, col, time) {
  const w = hw - 5, h = hh - 5;
  timberBox(ctx, -w, -h, 0, w, h, 5, PAL.stone);
  timberBox(ctx, -w, -h, 5, w, h, 32);
  doorAndWindows(ctx, -w, w, h, 5, col);
  gableRoof(ctx, -w, -h, w, h, 32, 14, 4, PAL.roof, shade(PAL.roof, -0.2), col.fill);

  // chimney + smoke
  box3(ctx, w - 14, -h + 3, 26, w - 5, -h + 12, 52,
    shade(PAL.stone, 0.12), shade(PAL.stone, -0.05), shade(PAL.stone, -0.3));
  const [sx, sy] = p3(w - 9.5, -h + 7.5, 54);
  ctx.fillStyle = 'rgba(120,115,105,0.35)';
  for (let i = 0; i < 3; i++) {
    const t = (time * 0.5 + i * 0.33) % 1;
    ctx.beginPath();
    ctx.arc(sx + Math.sin(t * 6 + i) * 6, sy - t * 26, 3 + t * 4, 0, TAU);
    ctx.fill();
  }
}

function buildTower(ctx, hw, hh, col) {
  const w = hw - 3, h = hh - 3;
  timberBox(ctx, -w, -h, 0, w, h, 46, PAL.stone);
  // overhanging battlement deck
  const o = 3;
  box3(ctx, -w - o, -h - o, 46, w + o, h + o, 54,
    shade(PAL.stone, 0.14), shade(PAL.stone, -0.03), shade(PAL.stone, -0.3));
  // merlons
  for (let i = -1; i <= 1; i++) {
    box3(ctx, i * 7 - 3, h + o - 3, 54, i * 7 + 3, h + o, 60,
      shade(PAL.stone, 0.16), shade(PAL.stone, -0.02), shade(PAL.stone, -0.28));
    box3(ctx, w + o - 3, i * 7 - 3, 54, w + o, i * 7 + 3, 60,
      shade(PAL.stone, 0.16), shade(PAL.stone, -0.02), shade(PAL.stone, -0.28));
  }
  // arrow slit + banner
  poly3(ctx, [[-3, h, 24], [3, h, 24], [3, h, 36], [-3, h, 36]], '#2c2c2c');
  const [bx, by] = p3(w, 0, 44);
  ctx.fillStyle = col.fill;
  ctx.beginPath();
  ctx.moveTo(bx, by); ctx.lineTo(bx + 13, by + 5); ctx.lineTo(bx, by + 15);
  ctx.closePath(); ctx.fill();
}

function buildCastle(ctx, hw, hh, col) {
  const w = hw - 6, h = hh - 6;
  // curtain wall
  timberBox(ctx, -w, -h, 0, w, h, 38, PAL.stone);
  // keep
  const w2 = w * 0.52, h2 = h * 0.52;
  timberBox(ctx, -w2, -h2, 38, w2, h2, 74, PAL.stone);

  // corner turrets
  for (const [px, py] of [[-w, -h], [w, -h], [w, h], [-w, h]]) {
    timberBox(ctx, px - 9, py - 9, 0, px + 9, py + 9, 62, PAL.stone);
    box3(ctx, px - 12, py - 12, 62, px + 12, py + 12, 70,
      shade(PAL.stone, 0.14), shade(PAL.stone, -0.03), shade(PAL.stone, -0.3));
    const [fx, fy] = p3(px, py, 72);
    ctx.strokeStyle = '#5a4128'; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx, fy - 16); ctx.stroke();
    ctx.fillStyle = col.fill;
    ctx.beginPath();
    ctx.moveTo(fx, fy - 16); ctx.lineTo(fx + 11, fy - 12); ctx.lineTo(fx, fy - 7);
    ctx.closePath(); ctx.fill();
  }

  // gate
  const [gx, gy] = p3(0, h, 0);
  ctx.fillStyle = PAL.door;
  ctx.beginPath();
  ctx.moveTo(gx - 11, gy);
  ctx.lineTo(gx - 11, gy - 18);
  ctx.quadraticCurveTo(gx, gy - 30, gx + 11, gy - 18);
  ctx.lineTo(gx + 11, gy);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = shade(col.fill, -0.1); ctx.lineWidth = 2;
  ctx.stroke();
}

function buildFarm(ctx, b, hw, hh, col) {
  const frac = b.amount / b.maxAmount;

  // tilled soil
  ctx.beginPath();
  isoDiamondPath(ctx, 0, 0, hw - 1, hh - 1, 0);
  ctx.fillStyle = PAL.soil;
  ctx.fill();
  ctx.strokeStyle = PAL.soilDark;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // furrows, with crops standing in the ones still worth harvesting
  const rows = 7;
  for (let i = 1; i < rows; i++) {
    const y = -hh + (2 * hh) * (i / rows);
    line3(ctx, [-hw + 4, y, 0], [hw - 4, y, 0], PAL.soilDark, 3.2);
    if (i / rows > frac + 0.14) continue;
    const n = 9;
    for (let j = 0; j <= n; j++) {
      const x = lerp(-hw + 5, hw - 5, j / n);
      const [px, py] = p3(x, y - 1.5, 0);
      ctx.fillStyle = PAL.crop;
      ctx.beginPath();
      ctx.moveTo(px, py - 5);
      ctx.lineTo(px - 2.2, py);
      ctx.lineTo(px + 2.2, py);
      ctx.closePath();
      ctx.fill();
    }
  }
  // headland edging in the owner's colour
  ctx.strokeStyle = shade(col.fill, -0.1);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  isoDiamondPath(ctx, 0, 0, hw - 1, hh - 1, 0);
  ctx.stroke();
}

function drawConstruction(ctx, b, col, hw, hh) {
  const p = b.buildProgress;

  // marked-out plot
  ctx.beginPath();
  isoDiamondPath(ctx, 0, 0, hw - 2, hh - 2, 0);
  ctx.fillStyle = 'rgba(160,130,88,0.55)';
  ctx.fill();
  ctx.setLineDash([7, 5]);
  ctx.strokeStyle = 'rgba(70,50,28,0.8)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.setLineDash([]);

  // partial walls
  const z = Math.max(1.5, 30 * p);
  if (p > 0.03) {
    timberBox(ctx, -hw + 6, -hh + 6, 0, hw - 6, hh - 6, z);
  }
  // scaffold poles at the corners
  for (const [px, py] of [[-hw + 4, -hh + 4], [hw - 4, -hh + 4], [hw - 4, hh - 4], [-hw + 4, hh - 4]]) {
    box3(ctx, px - 1.6, py - 1.6, 0, px + 1.6, py + 1.6, 34,
      shade('#c08b4a', 0.15), shade('#c08b4a', -0.03), shade('#c08b4a', -0.3));
  }
  line3(ctx, [-hw + 4, hh - 4, 22], [hw - 4, hh - 4, 22], '#c08b4a', 2.4);
  line3(ctx, [hw - 4, -hh + 4, 22], [hw - 4, hh - 4, 22], '#a8783e', 2.4);

  // progress bar floating above
  const bw = Math.max(34, hw * 1.4);
  const top = -(hw + hh) * 0.25 - 46;
  ctx.fillStyle = 'rgba(20,18,14,0.65)';
  ctx.fillRect(-bw / 2 - 1, top - 1, bw + 2, 7);
  ctx.fillStyle = col.fill;
  ctx.fillRect(-bw / 2, top, bw * p, 5);
}

/* ------------------------------------------------------------------ misc */

function drawGhost(ctx, type, tx, ty, ok) {
  const def = BUILDING_DEFS[type];
  const cx = (tx + def.w / 2) * CFG.TILE;
  const cy = (ty + def.h / 2) * CFG.TILE;
  const hw = def.w * CFG.TILE / 2, hh = def.h * CFG.TILE / 2;
  const [ix, iy] = worldToIso(cx, cy);

  ctx.save();
  ctx.translate(ix, iy);
  ctx.beginPath();
  isoDiamondPath(ctx, 0, 0, hw, hh, 0);
  ctx.fillStyle = ok ? 'rgba(120,220,120,0.32)' : 'rgba(220,80,70,0.32)';
  ctx.fill();
  ctx.strokeStyle = ok ? '#5ed15e' : '#e05a4a';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // per-tile grid inside the footprint
  ctx.strokeStyle = ok ? 'rgba(94,209,94,0.45)' : 'rgba(224,90,74,0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < def.w; i++) {
    const a = p3(-hw + i * CFG.TILE, -hh, 0), b = p3(-hw + i * CFG.TILE, hh, 0);
    ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
  }
  for (let i = 1; i < def.h; i++) {
    const a = p3(-hw, -hh + i * CFG.TILE, 0), b = p3(hw, -hh + i * CFG.TILE, 0);
    ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
  }
  ctx.stroke();

  // ghosted outline of the actual structure
  ctx.globalAlpha = 0.4;
  const fake = {
    def, type, kind: 'building', seed: 1, built: true, hitFlash: 0,
    w: def.w, h: def.h, tileX: tx, tileY: ty,
    pxW: def.w * CFG.TILE, pxH: def.h * CFG.TILE,
    x: cx, y: cy, anim: 0, amount: def.farmFood || 0, maxAmount: def.farmFood || 1,
  };
  ctx.translate(-ix, -iy);
  drawBuilding(ctx, fake, PLAYER_COLORS[G.humanId], 0);
  ctx.restore();
}

function drawProjectile(ctx, p) {
  if (p.delay > 0) return;
  const [ix, iy] = worldToIso(p.x, p.y);
  ctx.save();
  ctx.translate(ix, iy - p.arcZ);
  ctx.rotate(p.angle);
  ctx.strokeStyle = '#3a2c18';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(-9, 0); ctx.lineTo(6, 0);
  ctx.moveTo(6, 0); ctx.lineTo(2, -2.2);
  ctx.moveTo(6, 0); ctx.lineTo(2, 2.2);
  ctx.stroke();
  ctx.restore();
}
