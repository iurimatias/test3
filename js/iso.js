/* =========================================================================
   Isometric projection.

   The simulation stays in plain Cartesian world pixels — grid, pathfinding,
   collision and placement never know about the camera. Only the renderer and
   mouse picking go through here.

       screenX = (wx - wy) * 0.5
       screenY = (wx + wy) * 0.25 - height

   which is the classic 2:1 diamond: a square tile projects to a diamond twice
   as wide as it is tall, and +z lifts a point straight up the screen.
   ========================================================================= */
'use strict';

const ISO_A = 0.5;    // world x/y  -> iso x
const ISO_B = 0.25;   // world x/y  -> iso y

/** Flat ground point: world (x,y) -> iso (x,y). */
function worldToIso(wx, wy) {
  return [(wx - wy) * ISO_A, (wx + wy) * ISO_B];
}

/** Inverse of worldToIso, for mouse picking. */
function isoToWorld(ix, iy) {
  return [ix + iy * 2, iy * 2 - ix];
}

/** Point with elevation: world (x,y,z) -> iso (x,y). z is "up". */
function p3(wx, wy, wz) {
  return [(wx - wy) * ISO_A, (wx + wy) * ISO_B - wz];
}

/** The canvas matrix that maps a flat world-space image onto the ground plane. */
function isoMatrix(ctx) {
  ctx.transform(ISO_A, ISO_B, -ISO_A, ISO_B, 0, 0);
}

// Extent of the whole map once projected. The map is a diamond, so x runs
// negative (the west corner) through positive (the east corner).
const ISO_MIN_X = -WORLD_H * ISO_A;
const ISO_MAX_X = WORLD_W * ISO_A;
const ISO_MIN_Y = 0;
const ISO_MAX_Y = (WORLD_W + WORLD_H) * ISO_B;
const ISO_W = ISO_MAX_X - ISO_MIN_X;
const ISO_H = ISO_MAX_Y - ISO_MIN_Y;

/* ------------------------------------------------------------------ shapes */

/** Trace the diamond a rectangular world footprint makes on the ground. */
function isoDiamondPath(ctx, cx, cy, hw, hh, lift) {
  const z = lift || 0;
  const n = p3(cx - hw, cy - hh, z);
  const e = p3(cx + hw, cy - hh, z);
  const s = p3(cx + hw, cy + hh, z);
  const w = p3(cx - hw, cy + hh, z);
  ctx.moveTo(n[0], n[1]);
  ctx.lineTo(e[0], e[1]);
  ctx.lineTo(s[0], s[1]);
  ctx.lineTo(w[0], w[1]);
  ctx.closePath();
}

/** Fill a polygon given as an array of [x,y,z] triples in local world space. */
function poly3(ctx, pts, fill, stroke, lw) {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const p = p3(pts[i][0], pts[i][1], pts[i][2]);
    if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
  }
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
}

function line3(ctx, a, b, stroke, lw) {
  const p = p3(a[0], a[1], a[2]), q = p3(b[0], b[1], b[2]);
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]);
  ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1;
  ctx.stroke();
}

/**
 * An axis-aligned box from (x0,y0,z0) to (x1,y1,z1).
 * Only the top and the two camera-facing walls are ever visible.
 */
function box3(ctx, x0, y0, z0, x1, y1, z1, top, left, right, edge) {
  // +y wall — faces down-left on screen
  poly3(ctx, [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], left, edge, 1);
  // +x wall — faces down-right on screen
  poly3(ctx, [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], right, edge, 1);
  // lid
  poly3(ctx, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], top, edge, 1);
}

/** Darken / lighten a hex colour by `amt` (-1..1). Used for face shading. */
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (amt >= 0) {
    r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt;
  } else {
    r *= 1 + amt; g *= 1 + amt; b *= 1 + amt;
  }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

// Face lighting: sun sits off the upper left, so the +y wall catches it and
// the +x wall falls away into shadow.
const FACE_TOP = 0.10, FACE_LEFT = -0.06, FACE_RIGHT = -0.32;
