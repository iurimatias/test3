/* =========================================================================
   Utilities — math, rng, small helpers
   ========================================================================= */
'use strict';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));
const TAU = Math.PI * 2;

/* Mulberry32 — small deterministic PRNG */
function makeRng(seed) {
  let a = seed >>> 0;
  const fn = function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  fn.range = (lo, hi) => lo + fn() * (hi - lo);
  fn.int = (lo, hi) => Math.floor(lo + fn() * (hi - lo + 1));
  fn.pick = (arr) => arr[Math.floor(fn() * arr.length)];
  fn.chance = (p) => fn() < p;
  return fn;
}

/** Deterministic hash-noise in [0,1) from integer coords — used for terrain doodads. */
function hashNoise(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const tileOf = (px) => Math.floor(px / CFG.TILE);
const tileCenter = (t) => t * CFG.TILE + CFG.TILE / 2;

function fmtRes(n) {
  n = Math.floor(n);
  return n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(n);
}

/** Can `have` pay `cost`? */
function canAfford(have, cost) {
  if (!cost) return true;
  for (const k in cost) if ((have[k] || 0) < cost[k]) return false;
  return true;
}
function payCost(have, cost) {
  if (!cost) return;
  for (const k in cost) have[k] -= cost[k];
}
function refundCost(have, cost) {
  if (!cost) return;
  for (const k in cost) have[k] += cost[k];
}
function costString(cost) {
  if (!cost) return '';
  const icons = { food: '🍖', wood: '🪵', gold: '🪙', stone: '🪨' };
  return Object.keys(cost).map(k => `${icons[k]}${cost[k]}`).join('  ');
}

/** Shortest angular difference a→b. */
function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Rotate a point about the origin. */
function rot(x, y, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
}
