/* =========================================================================
   Art — hand-drawn stick figures, buildings, resources, terrain
   Everything is line art on "paper".
   ========================================================================= */
'use strict';

const INK = '#232019';
const INK_SOFT = 'rgba(35,32,25,0.55)';

/* ---------------------------------------------------- sketchy primitives */

/** Wobbly line segment (deterministic wobble from `seed`). */
function skLine(ctx, x1, y1, x2, y2, seed, amp) {
  amp = amp === undefined ? 1.1 : amp;
  const mx = (x1 + x2) / 2 + (hashNoise(seed, 11) - 0.5) * amp * 2;
  const my = (y1 + y2) / 2 + (hashNoise(seed, 27) - 0.5) * amp * 2;
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(mx, my, x2, y2);
}

/**
 * Wobbly closed polygon from a flat [x,y,...] list, as ONE continuous
 * subpath so the shape can be filled as well as stroked.
 */
function skPoly(ctx, pts, seed, amp) {
  amp = amp === undefined ? 1.1 : amp;
  const n = pts.length / 2;
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x1 = pts[i * 2], y1 = pts[i * 2 + 1];
    const x2 = pts[j * 2], y2 = pts[j * 2 + 1];
    const mx = (x1 + x2) / 2 + (hashNoise(seed + i, 11) - 0.5) * amp * 2;
    const my = (y1 + y2) / 2 + (hashNoise(seed + i, 27) - 0.5) * amp * 2;
    ctx.quadraticCurveTo(mx, my, x2, y2);
  }
  ctx.closePath();
}

/** Wobbly rectangle — fillable, same continuous-path rule as skPoly. */
function skRect(ctx, x, y, w, h, seed, amp) {
  skPoly(ctx, [x, y, x + w, y, x + w, y + h, x, y + h], seed, amp);
}

/** Slightly irregular circle. */
function skCircle(ctx, cx, cy, r, seed, amp) {
  amp = amp === undefined ? 0.8 : amp;
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * TAU;
    const rr = r + (hashNoise(seed, i) - 0.5) * amp;
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
}

/* ================================================================ TERRAIN */

const TERRAIN_COLORS = {
  [TERRAIN.GRASS]: '#eee4cd',
  [TERRAIN.DIRT]: '#e3d3b0',
  [TERRAIN.SAND]: '#efe0b8',
  [TERRAIN.WATER]: '#bcd7e2',
};

/**
 * Pre-render the whole map to an offscreen canvas. Called once at game start.
 */
function renderTerrain(map) {
  const cv = document.createElement('canvas');
  cv.width = WORLD_W; cv.height = WORLD_H;
  const ctx = cv.getContext('2d');
  const T = CFG.TILE;

  ctx.fillStyle = '#f2e9d4';
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);

  // Dirt and sand are painted as overlapping blobs rather than tile squares,
  // so patches read as organic ground instead of a grid.
  for (let pass = 0; pass < 2; pass++) {
    ctx.globalAlpha = pass === 0 ? 0.75 : 0.5;
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        const t = map.t(x, y);
        if (t !== TERRAIN.DIRT && t !== TERRAIN.SAND) continue;
        ctx.fillStyle = TERRAIN_COLORS[t];
        const n = hashNoise(x * (pass + 1), y * (pass + 3));
        const ox = (hashNoise(x + pass, y) - 0.5) * T * 0.5;
        const oy = (hashNoise(x, y + pass) - 0.5) * T * 0.5;
        ctx.beginPath();
        ctx.ellipse(x * T + T / 2 + ox, y * T + T / 2 + oy,
          T * (0.62 + n * 0.55), T * (0.58 + n * 0.5), n * 3, 0, TAU);
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;

  // grass tufts
  ctx.strokeStyle = 'rgba(110,130,80,0.55)';
  ctx.lineWidth = 1.1;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      if (map.t(x, y) !== TERRAIN.GRASS) continue;
      const n = hashNoise(x * 7, y * 13);
      if (n > 0.62) continue;
      const count = 1 + ((n * 100) | 0) % 3;
      for (let i = 0; i < count; i++) {
        const px = x * T + hashNoise(x * 3 + i, y * 5) * T;
        const py = y * T + hashNoise(x * 11, y * 17 + i) * T;
        const hgt = 3 + hashNoise(x + i, y) * 3.5;
        ctx.moveTo(px, py);
        ctx.quadraticCurveTo(px - 1.5, py - hgt * 0.6, px - 2.4, py - hgt);
        ctx.moveTo(px, py);
        ctx.quadraticCurveTo(px + 1.5, py - hgt * 0.6, px + 2.2, py - hgt * 0.85);
      }
    }
  }
  ctx.stroke();

  // dirt speckle
  ctx.fillStyle = 'rgba(140,115,70,0.30)';
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      const t = map.t(x, y);
      if (t !== TERRAIN.DIRT && t !== TERRAIN.SAND) continue;
      for (let i = 0; i < 4; i++) {
        const n1 = hashNoise(x * 13 + i, y * 29);
        const n2 = hashNoise(x * 31, y * 7 + i);
        ctx.fillRect(x * T + n1 * T, y * T + n2 * T, 1.4, 1.4);
      }
    }
  }

  // water: fill + ripples + shoreline
  ctx.save();
  ctx.beginPath();
  for (let y = 0; y < map.h; y++)
    for (let x = 0; x < map.w; x++)
      if (map.t(x, y) === TERRAIN.WATER) ctx.rect(x * T, y * T, T, T);
  ctx.clip();
  ctx.fillStyle = '#b9d6e4';
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  ctx.strokeStyle = 'rgba(70,120,150,0.45)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let y = 0; y < WORLD_H; y += 11) {
    for (let x = 0; x < WORLD_W; x += 26) {
      const n = hashNoise(x, y);
      if (n > 0.45) continue;
      const px = x + n * 20, py = y + hashNoise(y, x) * 8;
      ctx.moveTo(px, py);
      ctx.quadraticCurveTo(px + 5, py - 2.5, px + 10, py);
      ctx.quadraticCurveTo(px + 15, py + 2.5, px + 20, py);
    }
  }
  ctx.stroke();
  ctx.restore();

  // shoreline outline
  ctx.strokeStyle = 'rgba(60,105,135,0.75)';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      if (map.t(x, y) !== TERRAIN.WATER) continue;
      const s = (x * 31 + y * 17);
      if (y > 0 && map.t(x, y - 1) !== TERRAIN.WATER) skLine(ctx, x * T, y * T, x * T + T, y * T, s, 1.4);
      if (y < map.h - 1 && map.t(x, y + 1) !== TERRAIN.WATER) skLine(ctx, x * T, y * T + T, x * T + T, y * T + T, s + 1, 1.4);
      if (x > 0 && map.t(x - 1, y) !== TERRAIN.WATER) skLine(ctx, x * T, y * T, x * T, y * T + T, s + 2, 1.4);
      if (x < map.w - 1 && map.t(x + 1, y) !== TERRAIN.WATER) skLine(ctx, x * T + T, y * T, x * T + T, y * T + T, s + 3, 1.4);
    }
  }
  ctx.stroke();

  return cv;
}

/* =============================================================== RESOURCES */

function drawResource(ctx, n, t) {
  const x = n.x, y = n.y;
  const s = n.seed;
  const depleted = n.amount / n.maxAmount;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';

  switch (n.type) {
    case 'tree': {
      const sway = Math.sin(t * 0.9 + s % 10) * 1.2;
      const h = 15 + (s % 7);
      const bulk = 0.82 + hashNoise(s, 41) * 0.42;
      // shadow
      ctx.fillStyle = 'rgba(60,55,40,0.10)';
      ctx.beginPath(); ctx.ellipse(x, y + 6, 11, 4, 0, 0, TAU); ctx.fill();
      // trunk
      ctx.strokeStyle = '#5d4526';
      ctx.beginPath();
      skLine(ctx, x - 2, y + 5, x - 1 + sway * 0.3, y - h * 0.5, s, 0.8);
      skLine(ctx, x + 2, y + 5, x + 1 + sway * 0.3, y - h * 0.5, s + 5, 0.8);
      ctx.stroke();
      // canopy
      const cy = y - h - 3 + sway * 0.2;
      ctx.fillStyle = ((s % 3) === 0) ? '#8fae6a' : ((s % 3) === 1 ? '#7ea05c' : '#9bb877');
      ctx.strokeStyle = '#4c6b33';
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      const lobes = 3;
      for (let i = 0; i < lobes; i++) {
        const a = (i / lobes) * TAU + (s % 10) * 0.3;
        const lx = x + Math.cos(a) * 5.5 * bulk + sway, ly = cy + Math.sin(a) * 4 * bulk;
        skCircle(ctx, lx, ly, (8.5 + hashNoise(s, i) * 2) * bulk, s + i * 3, 1.6);
      }
      ctx.fill(); ctx.stroke();
      break;
    }
    case 'bush': {
      ctx.fillStyle = 'rgba(60,55,40,0.10)';
      ctx.beginPath(); ctx.ellipse(x, y + 6, 10, 3.5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#93b171';
      ctx.strokeStyle = '#4f6d38';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      skCircle(ctx, x - 4, y - 1, 7, s, 1.4);
      skCircle(ctx, x + 4, y - 2, 7.5, s + 3, 1.4);
      skCircle(ctx, x, y - 7, 7, s + 6, 1.4);
      ctx.fill(); ctx.stroke();
      // berries
      ctx.fillStyle = '#c0392b';
      const berries = Math.max(1, Math.round(6 * depleted));
      for (let i = 0; i < berries; i++) {
        const bx = x + (hashNoise(s + i, 3) - 0.5) * 16;
        const by = y - 4 + (hashNoise(s, i + 9) - 0.5) * 12;
        ctx.beginPath(); ctx.arc(bx, by, 1.9, 0, TAU); ctx.fill();
      }
      break;
    }
    case 'gold':
    case 'stone': {
      const gold = n.type === 'gold';
      ctx.fillStyle = 'rgba(60,55,40,0.10)';
      ctx.beginPath(); ctx.ellipse(x, y + 6, 11, 4, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = gold ? '#e2c05a' : '#b9b3a6';
      ctx.strokeStyle = gold ? '#8a6a12' : '#5f5b52';
      ctx.lineWidth = 1.7;
      const sz = 0.7 + 0.3 * depleted;
      ctx.beginPath();
      skPoly(ctx, [
        x - 10 * sz, y + 5,
        x - 7 * sz, y - 6 * sz,
        x + 1 * sz, y - 9 * sz,
        x + 9 * sz, y - 4 * sz,
        x + 10 * sz, y + 5,
      ], s, 1.2);
      ctx.fill(); ctx.stroke();
      // facets
      ctx.lineWidth = 1.1;
      ctx.strokeStyle = gold ? 'rgba(120,90,10,0.6)' : 'rgba(80,76,68,0.6)';
      ctx.beginPath();
      skLine(ctx, x - 4 * sz, y + 4, x - 1 * sz, y - 5 * sz, s + 9, 0.7);
      skLine(ctx, x + 4 * sz, y + 4, x + 2 * sz, y - 6 * sz, s + 12, 0.7);
      ctx.stroke();
      if (gold) {
        ctx.strokeStyle = '#fff3b0'; ctx.lineWidth = 1.4;
        ctx.beginPath();
        const gx = x + 2, gy = y - 4;
        ctx.moveTo(gx - 3, gy); ctx.lineTo(gx + 3, gy);
        ctx.moveTo(gx, gy - 3); ctx.lineTo(gx, gy + 3);
        ctx.stroke();
      }
      break;
    }
  }
}

function drawDecor(ctx, d) {
  if (d.kind === 'stump') {
    ctx.strokeStyle = 'rgba(93,69,38,0.75)';
    ctx.fillStyle = 'rgba(160,130,90,0.55)';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); skCircle(ctx, d.x, d.y, 4.5, d.seed, 0.8); ctx.fill(); ctx.stroke();
  } else if (d.kind === 'rubble') {
    ctx.strokeStyle = 'rgba(90,84,70,0.6)';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (let i = 0; i < 7; i++) {
      const a = hashNoise(d.seed, i) * TAU;
      const r = hashNoise(d.seed + 5, i) * d.r;
      skCircle(ctx, d.x + Math.cos(a) * r, d.y + Math.sin(a) * r * 0.6, 3 + hashNoise(d.seed, i + 2) * 3, d.seed + i, 0.9);
    }
    ctx.stroke();
  } else if (d.kind === 'bones') {
    ctx.strokeStyle = 'rgba(80,74,60,0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(d.x - 5, d.y - 2); ctx.lineTo(d.x + 5, d.y + 2);
    ctx.moveTo(d.x - 4, d.y + 3); ctx.lineTo(d.x + 4, d.y - 3);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(d.x + 6, d.y - 3, 2.4, 0, TAU); ctx.stroke();
  }
}

/* =================================================================== UNITS */

/**
 * Stick figure. Local space: feet at (0,0), up is -y.
 * `dir` = +1 facing right, -1 facing left.
 */
function drawUnit(ctx, u, col) {
  const dying = u.deathT !== undefined;
  ctx.save();
  ctx.translate(u.x, u.y);

  // ground shadow
  ctx.fillStyle = 'rgba(60,55,40,0.13)';
  ctx.beginPath();
  ctx.ellipse(0, 2, u.def.art === 'horse' ? 15 : 8, u.def.art === 'horse' ? 5 : 3.4, 0, 0, TAU);
  ctx.fill();

  if (dying) {
    const p = Math.min(1, u.deathT / 0.7);
    ctx.globalAlpha = 1 - p * 0.85;
    ctx.rotate(p * 1.45 * (u.dieDir || 1));
    ctx.translate(0, p * 4);
  }

  const dir = Math.cos(u.facing) >= 0 ? 1 : -1;
  ctx.scale(dir, 1);

  const moving = !!(u.path && u.path.length);
  const ph = moving ? u.walkPhase : (u.state === 'gather' || u.state === 'build' ? u.anim * 6 : 0);
  const legSw = moving ? Math.sin(ph) * 0.62 : 0;
  const bob = moving ? Math.abs(Math.sin(ph)) * 1.2 : (Math.sin(u.anim * 1.7) * 0.35);

  ctx.strokeStyle = u.hitFlash > 0 ? '#e03b2f' : col.ink;
  ctx.lineWidth = 2.0;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const art = u.def.art;
  if (art === 'horse') drawHorseman(ctx, u, col, ph, moving);
  else drawFootman(ctx, u, col, legSw, bob);

  ctx.restore();

  // carried resource icon
  if (u.carry && u.carry.amount > 0.5) {
    drawCarryIcon(ctx, u.x + 9, u.y - 30, u.carry.type);
  }
}

function drawFootman(ctx, u, col, legSw, bob) {
  const HIP = -15 - bob, SHO = -25 - bob, HEAD = -31 - bob, HR = 4.6;
  const art = u.def.art;

  // legs
  ctx.beginPath();
  ctx.moveTo(0, HIP);
  ctx.lineTo(Math.sin(legSw) * 7, HIP + Math.cos(legSw) * 15);
  ctx.moveTo(0, HIP);
  ctx.lineTo(Math.sin(-legSw) * 7, HIP + Math.cos(legSw) * 15);
  // spine
  ctx.moveTo(0, HIP);
  ctx.lineTo(0, SHO);
  ctx.stroke();

  // head
  ctx.beginPath();
  ctx.arc(0, HEAD, HR, 0, TAU);
  ctx.fillStyle = col.light;
  ctx.fill();
  ctx.stroke();

  // eyes — a friendly touch
  ctx.fillStyle = col.ink;
  ctx.beginPath();
  ctx.arc(1.8, HEAD - 0.6, 0.85, 0, TAU);
  ctx.arc(3.6, HEAD - 0.6, 0.85, 0, TAU);
  ctx.fill();

  const tier = unitTier(u.type);

  // helmet for higher tiers
  if (art !== 'villager' && tier >= 1) {
    ctx.strokeStyle = col.ink;
    ctx.lineWidth = 1.9;
    ctx.beginPath();
    ctx.arc(0, HEAD - 0.5, HR + 1.3, Math.PI * 1.05, Math.PI * 2.05);
    ctx.stroke();
    if (tier >= 2) { // crest
      ctx.strokeStyle = col.fill;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(-1.5, HEAD - HR - 1.5);
      ctx.quadraticCurveTo(-4.5, HEAD - HR - 5, -6.5, HEAD - HR - 2);
      ctx.stroke();
    }
    ctx.strokeStyle = u.hitFlash > 0 ? '#e03b2f' : col.ink;
    ctx.lineWidth = 2.0;
  }

  switch (art) {
    case 'villager': {
      const work = (u.state === 'gather' || u.state === 'build') ? Math.sin(u.anim * 7) : 0;
      const armA = -0.5 + work * 0.8;
      ctx.beginPath();
      ctx.moveTo(0, SHO);
      const hx = Math.cos(armA) * 11, hy = SHO + Math.sin(armA) * 11;
      ctx.lineTo(hx, hy);
      ctx.moveTo(0, SHO);
      ctx.lineTo(-7, SHO + 8);
      ctx.stroke();
      // tool: axe when chopping wood, pick for gold/stone, hammer when building
      const carryT = u.carry && u.carry.type;
      const tool = u.state === 'build' ? 'hammer'
        : carryT === 'wood' ? 'axe'
        : (carryT === 'gold' || carryT === 'stone') ? 'pick'
        : (u.state === 'gather' ? 'basket' : null);
      if (tool) drawTool(ctx, hx, hy, armA, tool, col);
      // sack on back once they're properly loaded up
      if (u.carry && u.carry.amount > 3) {
        ctx.fillStyle = '#c9b184'; ctx.strokeStyle = col.ink; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(-6, SHO + 2.5, 3.6, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.lineWidth = 2.0;
      }
      break;
    }
    case 'sword': {
      // shield arm
      ctx.beginPath(); ctx.moveTo(0, SHO); ctx.lineTo(-8, SHO + 5); ctx.stroke();
      ctx.fillStyle = col.fill; ctx.strokeStyle = col.ink; ctx.lineWidth = 1.7;
      ctx.beginPath(); ctx.ellipse(-9.5, SHO + 6, 4.6, 5.6, -0.25, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 2.0;
      ctx.strokeStyle = u.hitFlash > 0 ? '#e03b2f' : col.ink;
      // sword arm — swings on attack
      const a = -0.35 - u.swing * 1.5;
      const hx = Math.cos(a) * 10, hy = SHO + Math.sin(a) * 10;
      ctx.beginPath(); ctx.moveTo(0, SHO); ctx.lineTo(hx, hy); ctx.stroke();
      // blade
      ctx.strokeStyle = '#6b6b70'; ctx.lineWidth = 2.6;
      ctx.beginPath();
      const ba = a - 0.5 + u.swing * 1.3;
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx + Math.cos(ba) * 15, hy + Math.sin(ba) * 15);
      ctx.stroke();
      ctx.strokeStyle = col.ink; ctx.lineWidth = 1.6;
      ctx.beginPath(); // crossguard
      ctx.moveTo(hx + Math.cos(ba + 1.57) * 3, hy + Math.sin(ba + 1.57) * 3);
      ctx.lineTo(hx - Math.cos(ba + 1.57) * 3, hy - Math.sin(ba + 1.57) * 3);
      ctx.stroke();
      ctx.lineWidth = 2.0;
      break;
    }
    case 'spear': {
      ctx.beginPath(); ctx.moveTo(0, SHO); ctx.lineTo(9, SHO + 3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, SHO); ctx.lineTo(4, SHO + 9); ctx.stroke();
      const thrust = u.swing * 7;
      ctx.strokeStyle = '#6b5233'; ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(-6 + thrust, SHO + 12);
      ctx.lineTo(20 + thrust, SHO - 6);
      ctx.stroke();
      ctx.fillStyle = '#7d7d84'; ctx.strokeStyle = col.ink; ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(20 + thrust, SHO - 6);
      ctx.lineTo(26 + thrust, SHO - 11);
      ctx.lineTo(22.5 + thrust, SHO - 4.5);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 2.0;
      break;
    }
    case 'bow': {
      const draw = u.swing;
      // quiver
      ctx.strokeStyle = '#8a6a3a'; ctx.lineWidth = 3.2;
      ctx.beginPath(); ctx.moveTo(-5, SHO - 2); ctx.lineTo(-8, SHO + 8); ctx.stroke();
      ctx.strokeStyle = u.hitFlash > 0 ? '#e03b2f' : col.ink; ctx.lineWidth = 2.0;
      // arms
      ctx.beginPath();
      ctx.moveTo(0, SHO); ctx.lineTo(11, SHO - 1);
      ctx.moveTo(0, SHO); ctx.lineTo(3 - draw * 4, SHO + 3);
      ctx.stroke();
      // bow
      ctx.strokeStyle = '#7a5a2e'; ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.arc(12, SHO - 1, 9, -1.25, 1.25);
      ctx.stroke();
      // string
      ctx.strokeStyle = '#4a4a4a'; ctx.lineWidth = 1.0;
      const pull = 3 + draw * 5;
      ctx.beginPath();
      ctx.moveTo(12 + Math.cos(-1.25) * 9, SHO - 1 + Math.sin(-1.25) * 9);
      ctx.lineTo(12 - pull, SHO - 1);
      ctx.lineTo(12 + Math.cos(1.25) * 9, SHO - 1 + Math.sin(1.25) * 9);
      ctx.stroke();
      if (draw > 0.15) { // nocked arrow
        ctx.strokeStyle = '#5a4321'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(12 - pull, SHO - 1); ctx.lineTo(24, SHO - 1); ctx.stroke();
      }
      ctx.lineWidth = 2.0;
      break;
    }
  }
}

function drawTool(ctx, hx, hy, a, tool, col) {
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(a);
  ctx.lineCap = 'round';
  if (tool === 'axe') {
    ctx.strokeStyle = '#7a5a2e'; ctx.lineWidth = 2.0;
    ctx.beginPath(); ctx.moveTo(-2, 0); ctx.lineTo(11, 0); ctx.stroke();
    ctx.fillStyle = '#9a9aa2'; ctx.strokeStyle = col.ink; ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(9, -1); ctx.lineTo(14, -5); ctx.lineTo(15, 2); ctx.lineTo(10, 2);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  } else if (tool === 'pick') {
    ctx.strokeStyle = '#7a5a2e'; ctx.lineWidth = 2.0;
    ctx.beginPath(); ctx.moveTo(-2, 0); ctx.lineTo(11, 0); ctx.stroke();
    ctx.strokeStyle = '#8a8a92'; ctx.lineWidth = 2.0;
    ctx.beginPath(); ctx.moveTo(6, -5); ctx.quadraticCurveTo(12, -3, 14, 3); ctx.stroke();
  } else if (tool === 'hammer') {
    ctx.strokeStyle = '#7a5a2e'; ctx.lineWidth = 2.0;
    ctx.beginPath(); ctx.moveTo(-2, 0); ctx.lineTo(9, 0); ctx.stroke();
    ctx.fillStyle = '#8a8a92'; ctx.strokeStyle = col.ink; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.rect(8, -3.5, 6, 7); ctx.fill(); ctx.stroke();
  } else if (tool === 'basket') {
    ctx.fillStyle = '#c9a96a'; ctx.strokeStyle = col.ink; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(7, 2.5, 3.4, 2.6, 0, 0, TAU); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

function drawHorseman(ctx, u, col, ph, moving) {
  const gait = moving ? Math.sin(ph * 0.9) : 0;
  const bodyY = -17 - Math.abs(gait) * 1.5;

  ctx.strokeStyle = u.hitFlash > 0 ? '#e03b2f' : col.ink;
  ctx.lineWidth = 2.1;
  ctx.lineCap = 'round';

  // --- horse ---
  ctx.beginPath();
  // back
  ctx.moveTo(-12, bodyY);
  ctx.quadraticCurveTo(0, bodyY - 3.5, 11, bodyY - 1);
  // belly
  ctx.moveTo(-10, bodyY + 8);
  ctx.quadraticCurveTo(0, bodyY + 10, 10, bodyY + 7);
  // chest & rear
  ctx.moveTo(-12, bodyY); ctx.lineTo(-10, bodyY + 8);
  ctx.moveTo(11, bodyY - 1); ctx.lineTo(10, bodyY + 7);
  // neck + head
  ctx.moveTo(11, bodyY - 1);
  ctx.lineTo(18, bodyY - 9);
  ctx.lineTo(24, bodyY - 8);
  ctx.lineTo(23, bodyY - 4.5);
  ctx.lineTo(17.5, bodyY - 5);
  // legs
  const l1 = gait * 0.5, l2 = -gait * 0.5;
  ctx.moveTo(-9, bodyY + 8); ctx.lineTo(-9 + Math.sin(l1) * 8, bodyY + 8 + Math.cos(l1) * 15);
  ctx.moveTo(-6, bodyY + 8); ctx.lineTo(-6 + Math.sin(l2) * 8, bodyY + 8 + Math.cos(l2) * 15);
  ctx.moveTo(7, bodyY + 7); ctx.lineTo(7 + Math.sin(l2) * 8, bodyY + 7 + Math.cos(l2) * 15);
  ctx.moveTo(10, bodyY + 7); ctx.lineTo(10 + Math.sin(l1) * 8, bodyY + 7 + Math.cos(l1) * 15);
  ctx.stroke();
  // tail
  ctx.beginPath();
  ctx.moveTo(-12, bodyY + 1);
  ctx.quadraticCurveTo(-19, bodyY + 3 + gait * 2, -17, bodyY + 12);
  ctx.stroke();
  // mane
  ctx.strokeStyle = col.fill; ctx.lineWidth = 1.7;
  ctx.beginPath();
  ctx.moveTo(11, bodyY - 2);
  ctx.quadraticCurveTo(15, bodyY - 8, 18, bodyY - 9);
  ctx.stroke();
  ctx.strokeStyle = u.hitFlash > 0 ? '#e03b2f' : col.ink; ctx.lineWidth = 2.1;

  // --- rider ---
  const rHip = bodyY - 3, rSho = rHip - 10, rHead = rSho - 6.5;
  ctx.beginPath();
  ctx.moveTo(0, rHip); ctx.lineTo(0, rSho);            // spine
  ctx.moveTo(0, rHip); ctx.lineTo(6, rHip + 6);        // near leg
  ctx.lineTo(5, rHip + 11);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, rHead, 4.4, 0, TAU);
  ctx.fillStyle = col.light; ctx.fill(); ctx.stroke();
  ctx.fillStyle = col.ink;
  ctx.beginPath(); ctx.arc(1.7, rHead - 0.6, 0.8, 0, TAU); ctx.arc(3.4, rHead - 0.6, 0.8, 0, TAU); ctx.fill();

  const tier = unitTier(u.type);
  if (tier >= 1) {
    ctx.strokeStyle = col.ink; ctx.lineWidth = 1.9;
    ctx.beginPath(); ctx.arc(0, rHead - 0.5, 5.6, Math.PI * 1.05, Math.PI * 2.05); ctx.stroke();
    if (tier >= 2) {
      ctx.strokeStyle = col.fill; ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(-1.5, rHead - 6); ctx.quadraticCurveTo(-4.5, rHead - 10, -6.5, rHead - 7);
      ctx.stroke();
    }
    ctx.strokeStyle = u.hitFlash > 0 ? '#e03b2f' : col.ink; ctx.lineWidth = 2.1;
  }

  // reins arm + weapon arm
  ctx.beginPath();
  ctx.moveTo(0, rSho); ctx.lineTo(9, rSho + 4);
  ctx.stroke();
  const a = -0.5 - u.swing * 1.4;
  const hx = Math.cos(a) * 9, hy = rSho + Math.sin(a) * 9;
  ctx.beginPath(); ctx.moveTo(0, rSho); ctx.lineTo(hx, hy); ctx.stroke();
  // lance / sword
  ctx.strokeStyle = '#6b6b70'; ctx.lineWidth = 2.6;
  const ba = a - 0.35 + u.swing * 1.2;
  ctx.beginPath();
  ctx.moveTo(hx - Math.cos(ba) * 5, hy - Math.sin(ba) * 5);
  ctx.lineTo(hx + Math.cos(ba) * 16, hy + Math.sin(ba) * 16);
  ctx.stroke();
}

function unitTier(type) {
  for (const k in UNIT_LINES) {
    const i = UNIT_LINES[k].lastIndexOf(type);
    if (i >= 0) return i;
  }
  return 0;
}

const RES_ICON_COLORS = { food: '#c0392b', wood: '#8a6a3a', gold: '#d4af37', stone: '#9a9a9a' };

function drawCarryIcon(ctx, x, y, type) {
  ctx.fillStyle = RES_ICON_COLORS[type] || '#888';
  ctx.strokeStyle = 'rgba(35,32,25,0.7)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (type === 'wood') { ctx.rect(x - 3, y - 2, 6, 4); }
  else if (type === 'stone') { ctx.moveTo(x - 3, y + 2); ctx.lineTo(x, y - 3); ctx.lineTo(x + 3, y + 2); ctx.closePath(); }
  else { ctx.arc(x, y, 3, 0, TAU); }
  ctx.fill(); ctx.stroke();
}

/* =============================================================== BUILDINGS */

function drawBuilding(ctx, b, col, time) {
  const x = b.left, y = b.top, w = b.pxW, h = b.pxH;
  const s = b.seed;

  // shadow
  ctx.fillStyle = 'rgba(60,55,40,0.12)';
  ctx.beginPath();
  ctx.ellipse(b.x, b.bottom - 4, w * 0.46, h * 0.16, 0, 0, TAU);
  ctx.fill();

  if (!b.built) { drawConstruction(ctx, b, col); return; }

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = b.hitFlash > 0 ? '#e03b2f' : INK;
  ctx.lineWidth = 2.0;

  switch (b.def.art) {
    case 'house': drawHouse(ctx, b, col, x, y, w, h, s); break;
    case 'towncenter': drawTownCenter(ctx, b, col, x, y, w, h, s, time); break;
    case 'mill': drawMill(ctx, b, col, x, y, w, h, s, time); break;
    case 'lumbercamp': drawLumberCamp(ctx, b, col, x, y, w, h, s); break;
    case 'miningcamp': drawMiningCamp(ctx, b, col, x, y, w, h, s); break;
    case 'farm': drawFarm(ctx, b, col, x, y, w, h, s); break;
    case 'barracks': drawTrainer(ctx, b, col, x, y, w, h, s, 'swords'); break;
    case 'archeryrange': drawTrainer(ctx, b, col, x, y, w, h, s, 'target'); break;
    case 'stable': drawTrainer(ctx, b, col, x, y, w, h, s, 'horse'); break;
    case 'blacksmith': drawBlacksmith(ctx, b, col, x, y, w, h, s, time); break;
    case 'tower': drawTower(ctx, b, col, x, y, w, h, s); break;
    case 'castle': drawCastle(ctx, b, col, x, y, w, h, s); break;
  }
}

function wallFill(ctx) { ctx.fillStyle = '#f7f1e2'; }

function drawHouse(ctx, b, col, x, y, w, h, s) {
  const bodyTop = y + h * 0.42;
  wallFill(ctx);
  ctx.beginPath(); skRect(ctx, x + 6, bodyTop, w - 12, h - (bodyTop - y) - 5, s, 1.3);
  ctx.fill(); ctx.stroke();
  // roof
  ctx.fillStyle = col.fill;
  ctx.beginPath();
  skPoly(ctx, [x + 2, bodyTop + 1, b.x, y + 5, x + w - 2, bodyTop + 1], s + 7, 1.4);
  ctx.fill(); ctx.stroke();
  // door
  ctx.fillStyle = '#8a6a3a';
  ctx.beginPath(); skRect(ctx, b.x - 5, b.bottom - 17, 10, 12, s + 11, 0.7);
  ctx.fill(); ctx.stroke();
  // window
  ctx.fillStyle = '#cfe2ea';
  ctx.beginPath(); skRect(ctx, x + 11, bodyTop + 5, 8, 7, s + 13, 0.6);
  ctx.fill(); ctx.stroke();
}

function drawTownCenter(ctx, b, col, x, y, w, h, s, time) {
  const bodyTop = y + h * 0.34;
  // stilts / pillars
  wallFill(ctx);
  ctx.beginPath(); skRect(ctx, x + 8, bodyTop, w - 16, h - (bodyTop - y) - 8, s, 1.5);
  ctx.fill(); ctx.stroke();
  // pillars
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const px = x + 12 + i * ((w - 24) / 3);
    skLine(ctx, px, bodyTop + 4, px, b.bottom - 9, s + i, 0.8);
  }
  ctx.stroke();
  // roof
  ctx.fillStyle = col.fill;
  ctx.beginPath();
  skPoly(ctx, [x + 1, bodyTop + 2, x + w * 0.5, y + 6, x + w - 1, bodyTop + 2], s + 21, 1.6);
  ctx.fill(); ctx.stroke();
  // roof ridge
  ctx.beginPath(); skLine(ctx, x + 6, bodyTop - 4, x + w - 6, bodyTop - 4, s + 31, 1.0); ctx.stroke();
  // flag
  const fx = b.x, fy = y + 6;
  ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx, fy - 18); ctx.stroke();
  ctx.fillStyle = col.fill;
  const wave = Math.sin(time * 3) * 2;
  ctx.beginPath();
  ctx.moveTo(fx, fy - 18);
  ctx.quadraticCurveTo(fx + 8, fy - 17 + wave, fx + 14, fy - 14);
  ctx.lineTo(fx, fy - 10);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // door
  ctx.fillStyle = '#8a6a3a';
  ctx.beginPath();
  skRect(ctx, b.x - 8, b.bottom - 24, 16, 16, s + 41, 0.8);
  ctx.fill(); ctx.stroke();
}

function drawMill(ctx, b, col, x, y, w, h, s, time) {
  wallFill(ctx);
  ctx.beginPath();
  skPoly(ctx, [x + 10, b.bottom - 5, x + 7, y + h * 0.4, x + w - 7, y + h * 0.4, x + w - 10, b.bottom - 5], s, 1.3);
  ctx.fill(); ctx.stroke();
  // cap
  ctx.fillStyle = col.fill;
  ctx.beginPath();
  skPoly(ctx, [x + 5, y + h * 0.42, b.x, y + 6, x + w - 5, y + h * 0.42], s + 5, 1.2);
  ctx.fill(); ctx.stroke();
  // rotating sails
  const a = time * 0.7;
  ctx.save();
  ctx.translate(b.x + 1, y + h * 0.42);
  ctx.strokeStyle = INK; ctx.lineWidth = 1.8;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const aa = a + i * (TAU / 4);
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(aa) * 20, Math.sin(aa) * 20);
    const [px, py] = rot(20, 4, aa);
    ctx.lineTo(px, py);
    ctx.closePath();
  }
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#8a6a3a';
  ctx.beginPath(); skRect(ctx, b.x - 4, b.bottom - 14, 8, 9, s + 9, 0.6); ctx.fill(); ctx.stroke();
}

function drawLumberCamp(ctx, b, col, x, y, w, h, s) {
  // lean-to roof on posts
  wallFill(ctx);
  ctx.beginPath();
  skPoly(ctx, [x + 5, y + h * 0.55, x + w * 0.5, y + h * 0.28, x + w - 5, y + h * 0.55], s, 1.2);
  ctx.fillStyle = col.fill; ctx.fill(); ctx.stroke();
  ctx.beginPath();
  skLine(ctx, x + 8, y + h * 0.55, x + 8, b.bottom - 6, s + 1, 0.8);
  skLine(ctx, x + w - 8, y + h * 0.55, x + w - 8, b.bottom - 6, s + 2, 0.8);
  ctx.stroke();
  // log pile
  ctx.fillStyle = '#c9a06a'; ctx.strokeStyle = INK; ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.ellipse(b.x - 7, b.bottom - 11, 5, 4, 0, 0, TAU);
  ctx.ellipse(b.x + 3, b.bottom - 11, 5, 4, 0, 0, TAU);
  ctx.ellipse(b.x - 2, b.bottom - 18, 5, 4, 0, 0, TAU);
  ctx.fill(); ctx.stroke();
  // axe in a stump
  ctx.strokeStyle = '#7a5a2e'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x + w - 12, b.bottom - 8); ctx.lineTo(x + w - 7, b.bottom - 20); ctx.stroke();
  ctx.fillStyle = '#9a9aa2'; ctx.strokeStyle = INK; ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x + w - 8, b.bottom - 19); ctx.lineTo(x + w - 3, b.bottom - 23);
  ctx.lineTo(x + w - 2, b.bottom - 17); ctx.closePath();
  ctx.fill(); ctx.stroke();
}

function drawMiningCamp(ctx, b, col, x, y, w, h, s) {
  wallFill(ctx);
  ctx.beginPath();
  skPoly(ctx, [x + 5, y + h * 0.55, x + w * 0.5, y + h * 0.28, x + w - 5, y + h * 0.55], s, 1.2);
  ctx.fillStyle = col.fill; ctx.fill(); ctx.stroke();
  ctx.beginPath();
  skLine(ctx, x + 8, y + h * 0.55, x + 8, b.bottom - 6, s + 1, 0.8);
  skLine(ctx, x + w - 8, y + h * 0.55, x + w - 8, b.bottom - 6, s + 2, 0.8);
  ctx.stroke();
  // ore cart
  ctx.fillStyle = '#b0aca2'; ctx.strokeStyle = INK; ctx.lineWidth = 1.6;
  ctx.beginPath(); skRect(ctx, b.x - 10, b.bottom - 18, 18, 10, s + 5, 0.8); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(b.x - 6, b.bottom - 7, 3, 0, TAU); ctx.arc(b.x + 4, b.bottom - 7, 3, 0, TAU); ctx.stroke();
  ctx.fillStyle = '#d4af37';
  ctx.beginPath(); ctx.arc(b.x - 4, b.bottom - 19, 2.4, 0, TAU); ctx.arc(b.x + 2, b.bottom - 20, 2.4, 0, TAU); ctx.fill();
}

function drawFarm(ctx, b, col, x, y, w, h, s) {
  const frac = b.amount / b.maxAmount;
  ctx.fillStyle = '#e8d9ad';
  ctx.beginPath(); skRect(ctx, x + 2, y + 2, w - 4, h - 4, s, 1.4);
  ctx.fill();
  ctx.strokeStyle = col.ink; ctx.lineWidth = 1.8;
  ctx.stroke();
  // furrows — thin out as the farm is eaten
  ctx.strokeStyle = 'rgba(150,125,60,0.85)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const rows = 5;
  for (let i = 1; i < rows; i++) {
    if ((i / rows) > frac + 0.18) continue;
    const yy = y + 3 + (h - 6) * (i / rows);
    skLine(ctx, x + 5, yy, x + w - 5, yy, s + i * 3, 1.0);
  }
  ctx.stroke();
  // crop dots
  ctx.fillStyle = 'rgba(120,150,70,0.9)';
  for (let i = 0; i < 14; i++) {
    if (hashNoise(s, i) > frac) continue;
    const px = x + 5 + hashNoise(s + i, 1) * (w - 10);
    const py = y + 5 + hashNoise(s, i + 30) * (h - 10);
    ctx.fillRect(px, py, 2, 2.6);
  }
}

function drawTrainer(ctx, b, col, x, y, w, h, s, sign) {
  const bodyTop = y + h * 0.36;
  wallFill(ctx);
  ctx.beginPath(); skRect(ctx, x + 6, bodyTop, w - 12, h - (bodyTop - y) - 6, s, 1.5);
  ctx.fill(); ctx.stroke();
  // roof
  ctx.fillStyle = col.fill;
  ctx.beginPath();
  skPoly(ctx, [x + 2, bodyTop + 2, b.x, y + 6, x + w - 2, bodyTop + 2], s + 7, 1.5);
  ctx.fill(); ctx.stroke();
  // door
  ctx.fillStyle = '#8a6a3a';
  ctx.beginPath(); skRect(ctx, b.x - 7, b.bottom - 22, 14, 16, s + 11, 0.8);
  ctx.fill(); ctx.stroke();
  // hanging sign
  const sx = x + w - 18, sy = bodyTop + 12;
  ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
  ctx.fillStyle = '#f7f1e2';
  ctx.beginPath(); skRect(ctx, sx - 9, sy - 8, 18, 16, s + 17, 0.6); ctx.fill(); ctx.stroke();
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  if (sign === 'swords') {
    ctx.moveTo(sx - 5, sy + 5); ctx.lineTo(sx + 5, sy - 5);
    ctx.moveTo(sx + 5, sy + 5); ctx.lineTo(sx - 5, sy - 5);
    ctx.stroke();
  } else if (sign === 'target') {
    ctx.arc(sx, sy, 6, 0, TAU); ctx.moveTo(sx + 3, sy); ctx.arc(sx, sy, 3, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.arc(sx, sy, 1.6, 0, TAU); ctx.fill();
  } else if (sign === 'horse') {
    ctx.moveTo(sx - 5, sy + 5);
    ctx.quadraticCurveTo(sx - 6, sy - 4, sx, sy - 5);
    ctx.quadraticCurveTo(sx + 6, sy - 4, sx + 5, sy + 5);
    ctx.stroke();
  }
}

function drawBlacksmith(ctx, b, col, x, y, w, h, s, time) {
  const bodyTop = y + h * 0.4;
  wallFill(ctx);
  ctx.beginPath(); skRect(ctx, x + 5, bodyTop, w - 10, h - (bodyTop - y) - 5, s, 1.3);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = col.fill;
  ctx.beginPath(); skPoly(ctx, [x + 2, bodyTop + 1, b.x, y + 7, x + w - 2, bodyTop + 1], s + 5, 1.3);
  ctx.fill(); ctx.stroke();
  // chimney + smoke
  ctx.fillStyle = '#c4b79a';
  ctx.beginPath(); skRect(ctx, x + w - 18, y + 6, 8, 12, s + 9, 0.6); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = 'rgba(90,85,75,0.4)'; ctx.lineWidth = 2.2;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const t = (time * 0.6 + i * 0.33) % 1;
    const px = x + w - 14 + Math.sin(t * 6 + i) * 5;
    const py = y + 6 - t * 20;
    ctx.moveTo(px, py); ctx.lineTo(px + 1, py - 3);
  }
  ctx.stroke();
  // anvil
  ctx.strokeStyle = INK; ctx.lineWidth = 1.6; ctx.fillStyle = '#7d7d84';
  ctx.beginPath();
  ctx.moveTo(b.x - 8, b.bottom - 14); ctx.lineTo(b.x + 6, b.bottom - 14);
  ctx.lineTo(b.x + 3, b.bottom - 10); ctx.lineTo(b.x + 4, b.bottom - 6);
  ctx.lineTo(b.x - 5, b.bottom - 6); ctx.lineTo(b.x - 4, b.bottom - 10);
  ctx.closePath(); ctx.fill(); ctx.stroke();
}

function drawTower(ctx, b, col, _x, _y, _w, _h, s) {
  const cx = b.x;
  const topY = b.bottom - 40;
  wallFill(ctx);
  ctx.beginPath(); skRect(ctx, cx - 10, topY, 20, 36, s, 1.2); ctx.fill(); ctx.stroke();
  // battlements
  ctx.fillStyle = '#f7f1e2';
  ctx.beginPath();
  for (let i = 0; i < 3; i++) skRect(ctx, cx - 11 + i * 8, topY - 6, 6, 7, s + i, 0.6);
  ctx.fill(); ctx.stroke();
  // arrow slit
  ctx.fillStyle = INK;
  ctx.fillRect(cx - 1.5, topY + 9, 3, 9);
  // banner
  ctx.fillStyle = col.fill;
  ctx.beginPath();
  ctx.moveTo(cx + 11, topY + 2); ctx.lineTo(cx + 20, topY + 5); ctx.lineTo(cx + 11, topY + 10);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // stone courses
  ctx.strokeStyle = 'rgba(35,32,25,0.35)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < 4; i++) skLine(ctx, cx - 10, topY + i * 9, cx + 10, topY + i * 9, s + i * 5, 0.7);
  ctx.stroke();
}

function drawCastle(ctx, b, col, x, y, w, h, s) {
  const keepTop = y + h * 0.3;
  wallFill(ctx);
  ctx.beginPath(); skRect(ctx, x + 14, keepTop, w - 28, b.bottom - keepTop - 6, s, 1.6);
  ctx.fill(); ctx.stroke();
  // corner turrets
  for (const tx of [x + 8, x + w - 20]) {
    ctx.fillStyle = '#f7f1e2';
    ctx.beginPath(); skRect(ctx, tx, y + h * 0.18, 14, b.bottom - (y + h * 0.18) - 6, s + tx, 1.2);
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < 2; i++) skRect(ctx, tx + i * 7, y + h * 0.18 - 6, 5, 7, s + i + tx, 0.5);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = INK;
    ctx.fillRect(tx + 5.5, y + h * 0.18 + 12, 3, 10);
  }
  // keep battlements
  ctx.fillStyle = '#f7f1e2';
  ctx.beginPath();
  const bw = w - 28;
  for (let i = 0; i < 4; i++) skRect(ctx, x + 14 + i * (bw / 4), keepTop - 7, bw / 4 - 4, 8, s + i * 3, 0.6);
  ctx.fill(); ctx.stroke();
  // gate
  ctx.fillStyle = '#6b5233';
  ctx.beginPath();
  ctx.moveTo(b.x - 11, b.bottom - 6);
  ctx.lineTo(b.x - 11, b.bottom - 22);
  ctx.quadraticCurveTo(b.x, b.bottom - 34, b.x + 11, b.bottom - 22);
  ctx.lineTo(b.x + 11, b.bottom - 6);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = 'rgba(247,241,226,0.5)'; ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 1; i < 4; i++) { ctx.moveTo(b.x - 11 + i * 5.5, b.bottom - 6); ctx.lineTo(b.x - 11 + i * 5.5, b.bottom - 26); }
  ctx.stroke();
  // flags
  ctx.strokeStyle = INK; ctx.lineWidth = 1.6;
  ctx.fillStyle = col.fill;
  for (const fx of [x + 15, x + w - 13]) {
    ctx.beginPath(); ctx.moveTo(fx, y + h * 0.18 - 6); ctx.lineTo(fx, y - 4); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(fx, y - 4); ctx.lineTo(fx + 11, y); ctx.lineTo(fx, y + 4);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
}

function drawConstruction(ctx, b, col) {
  const x = b.left, y = b.top, w = b.pxW, h = b.pxH, s = b.seed;
  const p = b.buildProgress;
  // foundation outline
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = 'rgba(35,32,25,0.5)';
  ctx.lineWidth = 1.6;
  ctx.fillStyle = 'rgba(214,199,166,0.45)';
  ctx.beginPath(); skRect(ctx, x + 3, y + 3, w - 6, h - 6, s, 1.2);
  ctx.fill(); ctx.stroke();
  ctx.setLineDash([]);

  // scaffolding poles
  ctx.strokeStyle = '#a9793f';
  ctx.lineWidth = 2.0;
  ctx.beginPath();
  const poles = Math.max(2, Math.round(w / 22));
  for (let i = 0; i < poles; i++) {
    const px = x + 6 + i * ((w - 12) / (poles - 1 || 1));
    skLine(ctx, px, b.bottom - 5, px, y + h * 0.25, s + i, 1.0);
  }
  skLine(ctx, x + 5, y + h * 0.45, x + w - 5, y + h * 0.45, s + 30, 1.0);
  skLine(ctx, x + 5, y + h * 0.72, x + w - 5, y + h * 0.72, s + 31, 1.0);
  ctx.stroke();

  // rising structure
  const bh = (h - 10) * p;
  if (bh > 2) {
    ctx.fillStyle = 'rgba(247,241,226,0.92)';
    ctx.strokeStyle = INK; ctx.lineWidth = 1.8;
    ctx.beginPath(); skRect(ctx, x + 7, b.bottom - 5 - bh, w - 14, bh, s + 41, 1.0);
    ctx.fill(); ctx.stroke();
  }
  // progress bar
  const bw = w - 12;
  ctx.fillStyle = 'rgba(35,32,25,0.25)';
  ctx.fillRect(x + 6, y - 8, bw, 4);
  ctx.fillStyle = col.fill;
  ctx.fillRect(x + 6, y - 8, bw * p, 4);
  ctx.strokeStyle = 'rgba(35,32,25,0.6)'; ctx.lineWidth = 1;
  ctx.strokeRect(x + 6, y - 8, bw, 4);
}

/* --------------------------------------------------------- building ghost */

function drawGhost(ctx, type, tx, ty, ok) {
  const def = BUILDING_DEFS[type];
  const x = tx * CFG.TILE, y = ty * CFG.TILE;
  const w = def.w * CFG.TILE, h = def.h * CFG.TILE;
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = ok ? 'rgba(110,180,110,0.35)' : 'rgba(200,70,60,0.35)';
  ctx.fillRect(x, y, w, h);
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = ok ? '#2f7a2f' : '#a52a1f';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  ctx.setLineDash([]);
  ctx.globalAlpha = 0.85;
  // tile grid inside
  ctx.strokeStyle = ok ? 'rgba(47,122,47,0.4)' : 'rgba(165,42,31,0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < def.w; i++) { ctx.moveTo(x + i * CFG.TILE, y); ctx.lineTo(x + i * CFG.TILE, y + h); }
  for (let i = 1; i < def.h; i++) { ctx.moveTo(x, y + i * CFG.TILE); ctx.lineTo(x + w, y + i * CFG.TILE); }
  ctx.stroke();
  ctx.restore();
}

/* ------------------------------------------------------------- projectile */

function drawProjectile(ctx, p) {
  if (p.delay > 0) return;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle);
  ctx.strokeStyle = '#4a3a20';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-9, 0); ctx.lineTo(5, 0);
  ctx.moveTo(5, 0); ctx.lineTo(1.5, -2);
  ctx.moveTo(5, 0); ctx.lineTo(1.5, 2);
  ctx.moveTo(-9, 0); ctx.lineTo(-6.5, -2);
  ctx.moveTo(-9, 0); ctx.lineTo(-6.5, 2);
  ctx.stroke();
  ctx.restore();
}
