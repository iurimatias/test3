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

  wall:       '#d8b483',
  wallDark:   '#b38f61',
  beam:       '#8a6740',
  roof:       '#a96b3d',
  roofDark:   '#7d4c2b',
  stone:      '#b9b3a6',
  stoneDark:  '#948d80',
  door:       '#75482a',

  pine:       '#3c7f43',
  pineDark:   '#2c6234',
  pineLight:  '#4f9a52',
  trunk:      '#6b4a2a',

  gold:       '#f2c318',
  goldDark:   '#c99a0e',
  goldLight:  '#ffe98a',

  rock:       '#bdb8ac',
  rockDark:   '#948f83',
  rockLight:  '#d8d4ca',

  berry:      '#cc3b30',
  crop:       '#8fb552',
  soil:       '#9c7448',
  soilDark:   '#7d5c37',
};

/* --------------------------------------------------------------- helpers */

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

/* =============================================================== RESOURCES */

function drawResource(ctx, n, t) {
  const [ix, iy] = worldToIso(n.x, n.y);
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

function drawPine(ctx, n, t) {
  const s = n.seed;
  const scale = 0.85 + hashNoise(s, 3) * 0.45;
  const h = 46 * scale;
  const r = 15 * scale;
  const sway = Math.sin(t * 0.7 + (s % 10)) * 0.9;

  groundShadow(ctx, r * 1.05, r * 0.5, 0.24);

  // Short trunk, fully tucked under the lowest skirt. A longer one pokes out
  // beneath the tree in front of it and reads as a bare post in dense forest.
  ctx.fillStyle = PAL.trunk;
  ctx.fillRect(-2.5 * scale, -7 * scale, 5 * scale, 9 * scale);

  // three stacked skirts of needles
  const tiers = 3;
  for (let i = 0; i < tiers; i++) {
    const f = i / tiers;
    const cz = 3.5 * scale + f * h * 0.8;
    const rr = r * (1 - f * 0.6);
    const tipZ = cz + h * 0.42;
    ctx.fillStyle = i === 0 ? PAL.pineDark : (i === 1 ? PAL.pine : PAL.pineLight);
    ctx.beginPath();
    // a squat cone: elliptical skirt plus an apex
    const cy = -cz;
    ctx.ellipse(sway * f, cy, rr, rr * 0.5, 0, 0, Math.PI, true);
    ctx.lineTo(sway * (f + 0.5), -tipZ);
    ctx.closePath();
    ctx.fill();
    // lit left edge
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath();
    ctx.moveTo(sway * (f + 0.5), -tipZ);
    ctx.lineTo(-rr, cy);
    ctx.lineTo(-rr * 0.35, cy - rr * 0.16);
    ctx.closePath();
    ctx.fill();
  }
}

function drawBerryBush(ctx, n) {
  const s = n.seed;
  const frac = n.amount / n.maxAmount;
  groundShadow(ctx, 15, 7, 0.2);

  ctx.fillStyle = PAL.pineDark;
  ctx.beginPath();
  ctx.ellipse(-6, -8, 9, 8, 0, 0, TAU);
  ctx.ellipse(6, -7, 9, 8, 0, 0, TAU);
  ctx.ellipse(0, -14, 9.5, 8.5, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = PAL.pine;
  ctx.beginPath();
  ctx.ellipse(-5, -10, 7, 6, 0, 0, TAU);
  ctx.ellipse(5, -9, 7, 6, 0, 0, TAU);
  ctx.ellipse(0, -15, 7.5, 6.5, 0, 0, TAU);
  ctx.fill();

  ctx.fillStyle = PAL.berry;
  const count = Math.max(1, Math.round(8 * frac));
  for (let i = 0; i < count; i++) {
    const bx = (hashNoise(s + i, 3) - 0.5) * 22;
    const by = -8 - hashNoise(s, i + 9) * 12;
    ctx.beginPath();
    ctx.arc(bx, by, 2.2, 0, TAU);
    ctx.fill();
  }
}

function drawGoldPile(ctx, n) {
  const s = n.seed;
  const frac = 0.55 + 0.45 * (n.amount / n.maxAmount);
  groundShadow(ctx, 17 * frac, 8 * frac, 0.22);

  // a scatter of little iso ingots
  const count = Math.round(7 * frac) + 2;
  const bars = [];
  for (let i = 0; i < count; i++) {
    bars.push({
      x: (hashNoise(s + i, 11) - 0.5) * 26 * frac,
      y: (hashNoise(s, i + 5) - 0.5) * 26 * frac,
      z: hashNoise(s + i * 3, 2) * 7 * frac,
      w: 5 + hashNoise(s, i) * 3,
    });
  }
  bars.sort((a, b) => (a.x + a.y) - (b.x + b.y));
  for (const b of bars) {
    box3(ctx, b.x - b.w, b.y - b.w * 0.6, b.z, b.x + b.w, b.y + b.w * 0.6, b.z + 4.5,
      PAL.goldLight, PAL.gold, PAL.goldDark);
  }
  // a couple of rocky lumps for context
  ctx.fillStyle = PAL.rockDark;
  ctx.beginPath();
  ctx.ellipse(-13, 4, 6, 3.4, 0, 0, TAU);
  ctx.ellipse(12, -3, 5, 3, 0, 0, TAU);
  ctx.fill();
}

function drawStonePile(ctx, n) {
  const s = n.seed;
  const frac = 0.55 + 0.45 * (n.amount / n.maxAmount);
  groundShadow(ctx, 18 * frac, 9 * frac, 0.22);

  const count = Math.round(5 * frac) + 2;
  const rocks = [];
  for (let i = 0; i < count; i++) {
    rocks.push({
      x: (hashNoise(s + i, 17) - 0.5) * 28 * frac,
      y: (hashNoise(s, i + 23) - 0.5) * 28 * frac,
      r: (4.5 + hashNoise(s + i, 7) * 4.5) * frac,
    });
  }
  rocks.sort((a, b) => (a.x + a.y) - (b.x + b.y));
  for (const r of rocks) {
    const [px, py] = worldToIso(r.x, r.y);
    // boulder: dark base + lit cap
    ctx.fillStyle = PAL.rockDark;
    ctx.beginPath();
    ctx.ellipse(px, py - r.r * 0.5, r.r * 1.15, r.r * 0.95, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = PAL.rock;
    ctx.beginPath();
    ctx.ellipse(px, py - r.r * 0.75, r.r, r.r * 0.8, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = PAL.rockLight;
    ctx.beginPath();
    ctx.ellipse(px - r.r * 0.25, py - r.r * 1.05, r.r * 0.55, r.r * 0.4, 0, 0, TAU);
    ctx.fill();
  }
}

function drawDecor(ctx, d) {
  const [ix, iy] = worldToIso(d.x, d.y);
  ctx.save();
  ctx.translate(ix, iy);
  if (d.kind === 'stump') {
    ctx.fillStyle = PAL.trunk;
    ctx.beginPath(); ctx.ellipse(0, -2, 6, 3.4, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = shade(PAL.trunk, 0.25);
    ctx.beginPath(); ctx.ellipse(0, -4, 5, 2.8, 0, 0, TAU); ctx.fill();
  } else if (d.kind === 'rubble') {
    ctx.fillStyle = 'rgba(120,110,95,0.75)';
    for (let i = 0; i < 8; i++) {
      const a = hashNoise(d.seed, i) * TAU;
      const rr = hashNoise(d.seed + 5, i) * d.r;
      const [px, py] = worldToIso(Math.cos(a) * rr, Math.sin(a) * rr);
      ctx.beginPath();
      ctx.ellipse(px, py, 4 + hashNoise(d.seed, i + 2) * 4, 3, 0, 0, TAU);
      ctx.fill();
    }
  } else if (d.kind === 'bones') {
    ctx.fillStyle = 'rgba(40,40,40,0.35)';
    ctx.beginPath();
    ctx.ellipse(0, -1, 7, 3.2, 0.4, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/* =================================================================== UNITS */

/**
 * Solid black silhouette, standing upright on the ground plane. The player's
 * colour rides on the gear — shield, bow, tabard — the way the reference art
 * does, so the figures stay unmistakably stick-people.
 */
function drawUnit(ctx, u, col) {
  const [ix, iy] = worldToIso(u.x, u.y);
  ctx.save();
  ctx.translate(ix, iy);

  const horse = u.def.art === 'horse';
  groundShadow(ctx, horse ? 15 : 8, horse ? 6.5 : 3.6, 0.26);

  if (u.deathT !== undefined) {
    const p = Math.min(1, u.deathT / 0.7);
    ctx.globalAlpha = 1 - p * 0.85;
    ctx.rotate(p * 1.4 * (u.dieDir || 1));
    ctx.translate(0, p * 3);
  }

  // Face left or right depending on travel direction in screen space.
  const sdx = Math.cos(u.facing) - Math.sin(u.facing);
  const dir = sdx >= 0 ? 1 : -1;
  ctx.scale(dir, 1);

  const moving = !!(u.path && u.path.length);
  const ph = moving ? u.walkPhase
    : (u.state === 'gather' || u.state === 'build' ? u.anim * 6 : 0);
  const swing = moving ? Math.sin(ph) * 0.55 : 0;
  const bob = moving ? Math.abs(Math.sin(ph)) * 1.1 : Math.sin(u.anim * 1.6) * 0.3;

  ctx.strokeStyle = u.hitFlash > 0 ? '#d63a2a' : INK;
  ctx.fillStyle = u.hitFlash > 0 ? '#d63a2a' : INK;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (horse) drawRider(ctx, u, col, ph, moving);
  else drawWalker(ctx, u, col, swing, bob);

  ctx.restore();

  if (u.carry && u.carry.amount > 0.5) {
    drawCarryIcon(ctx, ix + 9, iy - 32, u.carry.type);
  }
}

function drawWalker(ctx, u, col, swing, bob) {
  const FOOT = 0, HIP = -14 - bob, SHO = -25 - bob, HEAD = -31.5 - bob;
  const art = u.def.art;

  // legs
  ctx.lineWidth = 3.1;
  ctx.beginPath();
  ctx.moveTo(0, HIP); ctx.lineTo(Math.sin(swing) * 6.5, FOOT);
  ctx.moveTo(0, HIP); ctx.lineTo(Math.sin(-swing) * 6.5, FOOT);
  ctx.stroke();

  // torso — slightly tapered so it reads as a body, not a stick
  ctx.beginPath();
  ctx.moveTo(-2.6, SHO); ctx.lineTo(2.6, SHO);
  ctx.lineTo(1.9, HIP); ctx.lineTo(-1.9, HIP);
  ctx.closePath();
  ctx.fill();

  // head
  ctx.beginPath();
  ctx.arc(0, HEAD, 4.6, 0, TAU);
  ctx.fill();

  const c = col.fill, cDark = col.ink;

  switch (art) {
    case 'villager': {
      // tabard patch keeps the two sides apart at a glance
      ctx.fillStyle = c;
      ctx.fillRect(-2.2, SHO + 3, 4.4, 5.5);
      ctx.fillStyle = u.hitFlash > 0 ? '#d63a2a' : INK;

      const work = (u.state === 'gather' || u.state === 'build') ? Math.sin(u.anim * 7) : 0;
      const a = -0.45 + work * 0.85;
      const hx = Math.cos(a) * 11, hy = SHO + 2 + Math.sin(a) * 11;
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.moveTo(0, SHO + 2); ctx.lineTo(hx, hy);
      ctx.moveTo(0, SHO + 2); ctx.lineTo(-6.5, SHO + 10);
      ctx.stroke();

      const ct = u.carry && u.carry.type;
      if (u.state === 'build') drawTool(ctx, hx, hy, a, 'hammer');
      else if (ct === 'wood') drawTool(ctx, hx, hy, a, 'axe');
      else if (ct === 'gold' || ct === 'stone') drawTool(ctx, hx, hy, a, 'pick');
      else if (u.state === 'gather') drawTool(ctx, hx, hy, a, 'basket');

      if (u.carry && u.carry.amount > 3) {
        ctx.fillStyle = '#6a5537';
        ctx.beginPath(); ctx.arc(-6.5, SHO + 3, 4, 0, TAU); ctx.fill();
        ctx.fillStyle = u.hitFlash > 0 ? '#d63a2a' : INK;
      }
      break;
    }

    case 'sword': {
      // shield arm
      ctx.lineWidth = 2.8;
      ctx.beginPath(); ctx.moveTo(0, SHO + 2); ctx.lineTo(-7, SHO + 7); ctx.stroke();
      kiteShield(ctx, -9, SHO + 8, 1.0, c, cDark);
      // sword arm
      const a = -0.3 - u.swing * 1.5;
      const hx = Math.cos(a) * 10, hy = SHO + 2 + Math.sin(a) * 10;
      ctx.strokeStyle = u.hitFlash > 0 ? '#d63a2a' : INK;
      ctx.beginPath(); ctx.moveTo(0, SHO + 2); ctx.lineTo(hx, hy); ctx.stroke();
      const ba = a - 0.5 + u.swing * 1.3;
      ctx.strokeStyle = '#c9ccd2'; ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx + Math.cos(ba) * 16, hy + Math.sin(ba) * 16);
      ctx.stroke();
      ctx.strokeStyle = INK; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(hx + Math.cos(ba + 1.57) * 3.5, hy + Math.sin(ba + 1.57) * 3.5);
      ctx.lineTo(hx - Math.cos(ba + 1.57) * 3.5, hy - Math.sin(ba + 1.57) * 3.5);
      ctx.stroke();
      break;
    }

    case 'spear': {
      ctx.lineWidth = 2.8;
      ctx.beginPath(); ctx.moveTo(0, SHO + 2); ctx.lineTo(-7, SHO + 7); ctx.stroke();
      kiteShield(ctx, -9.5, SHO + 8, 1.05, c, cDark);
      ctx.beginPath();
      ctx.moveTo(0, SHO + 2); ctx.lineTo(7, SHO + 5);
      ctx.stroke();
      // upright spear with a little forward thrust on attack
      const th = u.swing * 6;
      ctx.strokeStyle = '#6b5233'; ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(7 + th, SHO + 14); ctx.lineTo(7 + th * 1.6, SHO - 24);
      ctx.stroke();
      ctx.fillStyle = '#c9ccd2';
      ctx.beginPath();
      ctx.moveTo(7 + th * 1.6, SHO - 31);
      ctx.lineTo(4.4 + th * 1.6, SHO - 23);
      ctx.lineTo(9.6 + th * 1.6, SHO - 23);
      ctx.closePath(); ctx.fill();
      break;
    }

    case 'bow': {
      const draw = u.swing;
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.moveTo(0, SHO + 2); ctx.lineTo(10, SHO + 1);
      ctx.moveTo(0, SHO + 2); ctx.lineTo(3 - draw * 4, SHO + 6);
      ctx.stroke();
      // quiver
      ctx.strokeStyle = c; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(-5, SHO); ctx.lineTo(-8, SHO + 9); ctx.stroke();
      // bow limbs in player colour
      ctx.strokeStyle = c; ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.arc(11, SHO + 1, 10, -1.3, 1.3); ctx.stroke();
      ctx.strokeStyle = cDark; ctx.lineWidth = 1.1;
      const pull = 3 + draw * 5;
      ctx.beginPath();
      ctx.moveTo(11 + Math.cos(-1.3) * 10, SHO + 1 + Math.sin(-1.3) * 10);
      ctx.lineTo(11 - pull, SHO + 1);
      ctx.lineTo(11 + Math.cos(1.3) * 10, SHO + 1 + Math.sin(1.3) * 10);
      ctx.stroke();
      if (draw > 0.15) {
        ctx.strokeStyle = '#4a3a20'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(11 - pull, SHO + 1); ctx.lineTo(24, SHO + 1); ctx.stroke();
      }
      break;
    }
  }
}

function kiteShield(ctx, x, y, s, c, cDark) {
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.moveTo(x, y - 7 * s);
  ctx.quadraticCurveTo(x + 6 * s, y - 6 * s, x + 5.5 * s, y + 1 * s);
  ctx.quadraticCurveTo(x + 4.5 * s, y + 8 * s, x, y + 10 * s);
  ctx.quadraticCurveTo(x - 4.5 * s, y + 8 * s, x - 5.5 * s, y + 1 * s);
  ctx.quadraticCurveTo(x - 6 * s, y - 6 * s, x, y - 7 * s);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = cDark; ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.beginPath();
  ctx.ellipse(x - 1.5 * s, y - 2 * s, 1.8 * s, 3 * s, 0, 0, TAU);
  ctx.fill();
}

function drawTool(ctx, hx, hy, a, tool) {
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(a);
  ctx.lineCap = 'round';
  if (tool === 'axe' || tool === 'pick' || tool === 'hammer') {
    ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(-2, 0); ctx.lineTo(11, 0); ctx.stroke();
    ctx.fillStyle = '#b9bcc2';
    if (tool === 'axe') {
      ctx.beginPath();
      ctx.moveTo(9, -1.5); ctx.lineTo(15, -6); ctx.lineTo(16, 2); ctx.lineTo(10, 2.5);
      ctx.closePath(); ctx.fill();
    } else if (tool === 'pick') {
      ctx.strokeStyle = '#b9bcc2'; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(6, -5.5); ctx.quadraticCurveTo(13, -3, 15, 3.5); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.rect(8, -3.8, 6.5, 7.6); ctx.fill();
    }
  } else if (tool === 'basket') {
    ctx.fillStyle = '#8a6a3a';
    ctx.beginPath(); ctx.ellipse(8, 2, 4.2, 3.2, 0, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

function drawRider(ctx, u, col, ph, moving) {
  const gait = moving ? Math.sin(ph * 0.85) : 0;
  const back = -19 - Math.abs(gait) * 1.2;
  const c = col.fill, cDark = col.ink;

  // --- horse, solid black ---
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  const l1 = gait * 0.5, l2 = -gait * 0.5;
  ctx.moveTo(-9, back + 8); ctx.lineTo(-9 + Math.sin(l1) * 7, 0);
  ctx.moveTo(-5, back + 8); ctx.lineTo(-5 + Math.sin(l2) * 7, 0);
  ctx.moveTo(8, back + 7); ctx.lineTo(8 + Math.sin(l2) * 7, 0);
  ctx.moveTo(12, back + 7); ctx.lineTo(12 + Math.sin(l1) * 7, 0);
  ctx.stroke();

  // barrel
  ctx.beginPath();
  ctx.moveTo(-13, back + 2);
  ctx.quadraticCurveTo(0, back - 4, 13, back);
  ctx.lineTo(13, back + 8);
  ctx.quadraticCurveTo(0, back + 12, -12, back + 9);
  ctx.closePath();
  ctx.fill();

  // neck and head
  ctx.beginPath();
  ctx.moveTo(11, back - 1);
  ctx.lineTo(19, back - 11);
  ctx.lineTo(25, back - 10);
  ctx.lineTo(24, back - 5.5);
  ctx.lineTo(16, back - 3);
  ctx.closePath();
  ctx.fill();
  // tail
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(-13, back + 2);
  ctx.quadraticCurveTo(-20, back + 5 + gait * 2, -18, back + 14);
  ctx.stroke();

  // caparison in player colour
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.moveTo(-6, back + 4); ctx.lineTo(6, back + 3);
  ctx.lineTo(5, back + 12); ctx.lineTo(-5, back + 13);
  ctx.closePath(); ctx.fill();

  // --- rider ---
  ctx.fillStyle = ctx.strokeStyle;
  const HIP = back - 3, SHO = HIP - 11, HEAD = SHO - 6.5;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, HIP); ctx.lineTo(6, HIP + 7); ctx.lineTo(5, HIP + 12);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-2.4, SHO); ctx.lineTo(2.4, SHO);
  ctx.lineTo(1.8, HIP); ctx.lineTo(-1.8, HIP);
  ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.arc(0, HEAD, 4.3, 0, TAU); ctx.fill();

  kiteShield(ctx, -8, SHO + 5, 0.95, c, cDark);

  const a = -0.45 - u.swing * 1.3;
  const hx = Math.cos(a) * 9, hy = SHO + 1 + Math.sin(a) * 9;
  ctx.lineWidth = 2.8;
  ctx.beginPath(); ctx.moveTo(0, SHO + 1); ctx.lineTo(hx, hy); ctx.stroke();
  ctx.strokeStyle = '#c9ccd2'; ctx.lineWidth = 2.8;
  const ba = a - 0.3 + u.swing * 1.1;
  ctx.beginPath();
  ctx.moveTo(hx - Math.cos(ba) * 5, hy - Math.sin(ba) * 5);
  ctx.lineTo(hx + Math.cos(ba) * 17, hy + Math.sin(ba) * 17);
  ctx.stroke();
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
function timberBox(ctx, x0, y0, z0, x1, y1, z1, base) {
  base = base || PAL.wall;
  box3(ctx, x0, y0, z0, x1, y1, z1,
    shade(base, FACE_TOP), shade(base, FACE_LEFT), shade(base, FACE_RIGHT));
  // plank seams on the two visible walls
  const rows = Math.max(1, Math.round((z1 - z0) / 9));
  for (let i = 1; i < rows; i++) {
    const z = z0 + (z1 - z0) * (i / rows);
    line3(ctx, [x0, y1, z], [x1, y1, z], 'rgba(90,65,38,0.30)', 1);
    line3(ctx, [x1, y0, z], [x1, y1, z], 'rgba(90,65,38,0.34)', 1);
  }
}

/**
 * Gabled roof: ridge runs along world x, slopes fall toward ±y, and it
 * overhangs the walls by `oh`.
 */
function gableRoof(ctx, x0, y0, x1, y1, z, rise, oh, colA, colB, trim) {
  const ax0 = x0 - oh, ax1 = x1 + oh, ay0 = y0 - oh, ay1 = y1 + oh;
  const my = (y0 + y1) / 2, top = z + rise;

  // far slope (-y) — mostly hidden but keeps the silhouette solid
  poly3(ctx, [[ax0, ay0, z], [ax1, ay0, z], [ax1, my, top], [ax0, my, top]], colB);
  // gable ends
  poly3(ctx, [[ax1, ay0, z], [ax1, ay1, z], [ax1, my, top]], shade(PAL.wall, -0.22));
  poly3(ctx, [[ax0, ay0, z], [ax0, ay1, z], [ax0, my, top]], shade(PAL.wall, -0.05));
  // near slope (+y) — the one the eye actually reads
  poly3(ctx, [[ax0, ay1, z], [ax1, ay1, z], [ax1, my, top], [ax0, my, top]], colA);

  // shingle courses down the near slope
  const rows = 5;
  for (let i = 1; i < rows; i++) {
    const f = i / rows;
    const yy = ay1 + (my - ay1) * f;
    const zz = z + rise * f;
    line3(ctx, [ax0, yy, zz], [ax1, yy, zz], 'rgba(60,35,18,0.28)', 1.2);
  }
  // ridge beam
  line3(ctx, [ax0, my, top], [ax1, my, top], shade(colA, -0.35), 2);

  // painted fascia along the eaves — the strongest colour cue on a building
  if (trim) {
    poly3(ctx, [[ax0, ay1, z], [ax1, ay1, z], [ax1, ay1, z - 3], [ax0, ay1, z - 3]], trim);
    poly3(ctx, [[ax1, ay0, z], [ax1, ay1, z], [ax1, ay1, z - 3], [ax1, ay0, z - 3]],
      shade(trim, -0.25));
  }
}

function doorAndWindows(ctx, x0, x1, y, z, col) {
  const cx = (x0 + x1) / 2;
  // door on the +y wall, with a painted frame in the player's colour
  poly3(ctx, [[cx - 6, y, z], [cx + 6, y, z], [cx + 6, y, z + 18], [cx - 6, y, z + 18]],
    PAL.door, col.fill, 2.2);
  // shuttered windows either side
  for (const wx of [x0 + 8, x1 - 8]) {
    if (Math.abs(wx - cx) < 11) continue;
    poly3(ctx, [[wx - 4, y, z + 10], [wx + 4, y, z + 10], [wx + 4, y, z + 19], [wx - 4, y, z + 19]],
      '#3f5d76', col.fill, 2.2);
  }
  // one on the +x wall too, so the shaded side isn't a blank slab
  const wy = -y * 0.25;
  poly3(ctx, [[x1, wy - 4, z + 10], [x1, wy + 4, z + 10],
              [x1, wy + 4, z + 19], [x1, wy - 4, z + 19]],
    '#33506a', shade(col.fill, -0.25), 2);
}

function buildHouse(ctx, hw, hh, col) {
  const w = hw - 5, h = hh - 5;
  // stone footing
  timberBox(ctx, -w, -h, 0, w, h, 5, PAL.stone);
  // walls
  timberBox(ctx, -w, -h, 5, w, h, 32);
  doorAndWindows(ctx, -w, w, h, 5, col);
  // roof
  gableRoof(ctx, -w, -h, w, h, 32, 15, 4, PAL.roof, shade(PAL.roof, -0.2), col.fill);
}

function buildTownCenter(ctx, hw, hh, col, time) {
  const w = hw - 10, h = hh - 10;

  // palisade around the plot
  palisade(ctx, hw - 2, hh - 2, col);

  // ground floor with corner posts
  timberBox(ctx, -w, -h, 0, w, h, 6, PAL.stone);
  timberBox(ctx, -w, -h, 6, w, h, 30);
  doorAndWindows(ctx, -w, w, h, 6, col);
  // player-colour band
  poly3(ctx, [[-w, h, 30], [w, h, 30], [w, h, 33.5], [-w, h, 33.5]], col.fill);
  poly3(ctx, [[w, -h, 30], [w, h, 30], [w, h, 33.5], [w, -h, 33.5]], shade(col.fill, -0.25));

  // upper storey, inset
  const w2 = w * 0.74, h2 = h * 0.74;
  gableRoof(ctx, -w, -h, w, h, 34, 9, 9, PAL.roof, shade(PAL.roof, -0.2), col.fill);
  timberBox(ctx, -w2, -h2, 42, w2, h2, 62);
  poly3(ctx, [[-w2, h2, 55], [w2, h2, 55], [w2, h2, 58.5], [-w2, h2, 58.5]], col.fill);
  gableRoof(ctx, -w2, -h2, w2, h2, 62, 9, 8, PAL.roof, shade(PAL.roof, -0.2), col.fill);

  // lookout
  const w3 = w2 * 0.6, h3 = h2 * 0.6;
  timberBox(ctx, -w3, -h3, 70, w3, h3, 86);
  gableRoof(ctx, -w3, -h3, w3, h3, 86, 11, 7, PAL.roof, shade(PAL.roof, -0.2), col.fill);

  // flag
  const [fx, fy] = p3(0, 0, 96);
  ctx.strokeStyle = '#5a4128'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(fx, fy + 10); ctx.lineTo(fx, fy - 20); ctx.stroke();
  const wave = Math.sin(time * 3) * 2.5;
  ctx.fillStyle = col.fill;
  ctx.beginPath();
  ctx.moveTo(fx, fy - 20);
  ctx.quadraticCurveTo(fx + 10, fy - 19 + wave, fx + 17, fy - 15);
  ctx.lineTo(fx, fy - 9);
  ctx.closePath(); ctx.fill();
}

function palisade(ctx, hw, hh, col) {
  const step = 11;
  const posts = [];
  for (let x = -hw; x <= hw; x += step) { posts.push([x, hh]); posts.push([x, -hh]); }
  for (let y = -hh; y <= hh; y += step) { posts.push([hw, y]); posts.push([-hw, y]); }
  posts.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));
  for (const [x, y] of posts) {
    box3(ctx, x - 2.5, y - 2.5, 0, x + 2.5, y + 2.5, 13,
      shade(PAL.beam, 0.18), shade(PAL.beam, -0.02), shade(PAL.beam, -0.28));
  }
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
    // stacked timber
    for (let i = 0; i < 3; i++) {
      const z = i * 6;
      const off = i * 2;
      box3(ctx, -w + 4 + off, -3, z, w - 4 - off, 5, z + 6,
        shade('#c9a06a', 0.15), shade('#c9a06a', -0.05), shade('#c9a06a', -0.3));
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
  ctx.strokeStyle = shade(col.fill, -0.15);
  ctx.lineWidth = 2;
  ctx.stroke();

  // furrows running along world x
  const rows = 6;
  for (let i = 1; i < rows; i++) {
    const y = -hh + (2 * hh) * (i / rows);
    line3(ctx, [-hw + 3, y, 0], [hw - 3, y, 0], PAL.soilDark, 3);
    if (i / rows <= frac + 0.12) {
      line3(ctx, [-hw + 3, y - 1.5, 0], [hw - 3, y - 1.5, 0], PAL.crop, 2.4);
    }
  }
  // sprouts
  ctx.fillStyle = shade(PAL.crop, 0.1);
  for (let i = 0; i < 22; i++) {
    if (hashNoise(b.seed, i) > frac) continue;
    const wx = (hashNoise(b.seed + i, 5) - 0.5) * (hw * 1.7);
    const wy = (hashNoise(b.seed, i + 40) - 0.5) * (hh * 1.7);
    const [px, py] = p3(wx, wy, 0);
    ctx.fillRect(px, py - 4, 1.8, 4);
  }
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
