/* =========================================================================
   Sprite atlas.

   Art ships as one or more sheet images plus `assets/atlas.json`, which maps a
   sprite name to a rect on the sheet and an anchor point. Anything present in
   the atlas is blitted; anything missing falls back to the procedural drawing
   in art.js, so the game stays playable while art arrives piecemeal.

   Enemy colours are generated at load time by hue-shifting the blue livery,
   so a second sheet is not needed just to recolour a team.
   ========================================================================= */
'use strict';

/**
 * The sheets arrive as JPEG with their transparency flattened onto a light
 * checkerboard, so it has to be keyed back out at load time.
 *
 * A plain luminance threshold would punch holes in the art — windmill sails and
 * the archery target are near-white too. Instead this floods inward from the
 * border: the surrounding background is reachable, interior whites are fenced
 * off by the artwork's dark outlines and survive untouched.
 *
 * Soft drop shadows sit between the two cases. They are unlit background rather
 * than paint, so where the flood meets a desaturated pixel darker than the sheet
 * it recovers the alpha it must have had (`1 - luma/background`), paints it
 * black, and keeps going — which restores the shadows as real soft alpha
 * instead of leaving grey blobs stamped on the grass.
 */
function keyBackground(canvas, opts) {
  opts = opts || {};
  const bgLuma = opts.bgLuma || 250;     // brightest checker tone
  const bgMin = opts.bgMin || 231;       // at or above this is plain background
  const shadowFloor = opts.shadowFloor || 150;
  const maxShadow = opts.maxShadow === undefined ? 0.5 : opts.maxShadow;

  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;

  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  const push = (i) => { if (!seen[i]) { seen[i] = 1; stack[sp++] = i; } };

  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }

  while (sp > 0) {
    const i = stack[--sp];
    const o = i * 4;
    const r = d[o], g = d[o + 1], b = d[o + 2];
    const luma = r * 0.299 + g * 0.587 + b * 0.114;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;

    if (luma >= bgMin && sat < 0.10) {
      d[o + 3] = 0;                                   // plain background
    } else if (luma >= shadowFloor && sat < 0.13) {
      const a = clamp((bgLuma - luma) / bgLuma * 1.15, 0, maxShadow);
      d[o] = 0; d[o + 1] = 0; d[o + 2] = 0;
      d[o + 3] = Math.round(a * 255);                 // recovered soft shadow
    } else {
      continue;                                       // artwork — stop here
    }

    const x = i % w, y = (i / w) | 0;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }

  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Punch out the enclosed middle of a frame. The border fences the outer flood
 * out, so a hollow centre needs its own seed from the inside.
 */
function hollowCentre(canvas, r) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  const seen = new Uint8Array(w * h), stack = new Int32Array(w * h);
  let sp = 0;
  const push = (i) => { if (!seen[i]) { seen[i] = 1; stack[sp++] = i; } };
  push((r.y + (r.h >> 1)) * w + (r.x + (r.w >> 1)));

  while (sp > 0) {
    const i = stack[--sp], o = i * 4;
    const rr = d[o], g = d[o + 1], b = d[o + 2];
    const luma = rr * 0.299 + g * 0.587 + b * 0.114;
    const mx = Math.max(rr, g, b), mn = Math.min(rr, g, b);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    if (luma >= 205 && sat < 0.12) d[o + 3] = 0;
    else if (luma >= 150 && sat < 0.14) {
      d[o] = 0; d[o + 1] = 0; d[o + 2] = 0;
      d[o + 3] = Math.round(clamp((250 - luma) / 250 * 1.1, 0, 0.45) * 255);
    } else continue;
    const x = i % w, y = (i / w) | 0;
    if (x > r.x) push(i - 1);
    if (x < r.x + r.w - 1) push(i + 1);
    if (y > r.y) push(i - w);
    if (y < r.y + r.h - 1) push(i + w);
  }
  ctx.putImageData(img, 0, 0);
}

const Sprites = {
  ready: false,
  atlas: null,          // name -> {x,y,w,h,ax,ay,worldW}
  sheets: {},           // sheet id -> { [playerIdx]: canvas }
  missing: new Set(),

  /**
   * @param manifestUrl JSON of the form
   *   { sheets: { main: "assets/sheet-01.png" },
   *     sprites: { towncenter: {sheet:"main", x,y,w,h, ax,ay, worldW} } }
   */
  async load(manifestUrl) {
    let manifest;
    try {
      const res = await fetch(manifestUrl, { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
      manifest = await res.json();
    } catch (e) {
      console.info('[sprites] no atlas (' + e.message + ') — using drawn art');
      this.ready = false;
      return false;
    }

    this.atlas = manifest.sprites || {};
    const ids = Object.keys(manifest.sheets || {});
    await Promise.all(ids.map(id => {
      const s = manifest.sheets[id];
      return this._loadSheet(id, s.url || s, s.key || {}, s.hollow || []);
    }));
    this.ready = ids.length > 0;
    if (this.ready) {
      console.info(`[sprites] atlas ready: ${Object.keys(this.atlas).length} sprites`);
    }
    return this.ready;
  },

  _loadSheet(id, url, keyOpts, hollow) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const base = document.createElement('canvas');
        base.width = img.width; base.height = img.height;
        base.getContext('2d').drawImage(img, 0, 0);
        keyBackground(base, keyOpts);
        for (const name of hollow || []) {
          const r = this.atlas[name];
          if (r) hollowCentre(base, r);
        }
        this.sheets[id] = { 0: base };
        // one recoloured copy per additional player livery
        for (let p = 1; p < PLAYER_COLORS.length; p++) {
          this.sheets[id][p] = this._recolour(base, PLAYER_COLORS[p]);
        }
        resolve(true);
      };
      img.onerror = () => {
        console.warn('[sprites] could not load sheet', url);
        resolve(false);
      };
      img.src = url;
    });
  },

  /**
   * Repaint the blue livery in a sheet to another team colour. Only clearly
   * blue-dominant pixels are touched, so ink outlines, timber and stone are
   * left exactly as the artist drew them.
   */
  _recolour(src, playerColor) {
    const cv = document.createElement('canvas');
    cv.width = src.width; cv.height = src.height;
    const ctx = cv.getContext('2d');
    ctx.drawImage(src, 0, 0);
    const img = ctx.getImageData(0, 0, cv.width, cv.height);
    const d = img.data;

    const tint = hexToRgb(playerColor.fill);
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 8) continue;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      // blue livery: blue clearly ahead of the other two channels
      if (b - r < 34 || b - g < 22) continue;
      // preserve the pixel's own light/dark shading, swap only the hue
      const lum = (0.25 * r + 0.32 * g + 0.43 * b) / 255;
      const k = clamp(lum * 1.32, 0, 1);
      d[i]     = clamp(tint.r * k + 255 * Math.max(0, k - 0.78) * 0.9, 0, 255);
      d[i + 1] = clamp(tint.g * k + 255 * Math.max(0, k - 0.78) * 0.9, 0, 255);
      d[i + 2] = clamp(tint.b * k + 255 * Math.max(0, k - 0.78) * 0.9, 0, 255);
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  },

  has(name) { return !!(this.ready && this.atlas && this.atlas[name]); },

  /**
   * A single sprite as its own data URL, for use in CSS.
   * `maxSize` caps the exported edge — HUD icons display around 20px, so
   * exporting them at their full sheet resolution would inline megabytes of
   * base64 for pixels nobody sees.
   */
  extract(name, playerIdx, maxSize) {
    const s = this.atlas[name];
    if (!s) return null;
    const sheet = this.sheets[s.sheet];
    if (!sheet) return null;
    const k = maxSize ? Math.min(1, maxSize / Math.max(s.w, s.h)) : 1;
    const w = Math.max(1, Math.round(s.w * k)), h = Math.max(1, Math.round(s.h * k));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const c = cv.getContext('2d');
    c.imageSmoothingQuality = 'high';
    c.drawImage(sheet[playerIdx || 0], s.x, s.y, s.w, s.h, 0, 0, w, h);
    return cv.toDataURL();
  },

  /**
   * Blit `name` so its anchor lands on (ix, iy) in iso space.
   * `flip` mirrors horizontally for units walking the other way.
   */
  draw(ctx, name, ix, iy, playerIdx, flip, scaleMul) {
    const s = this.atlas[name];
    if (!s) return false;
    const sheet = this.sheets[s.sheet || 'main'];
    if (!sheet) return false;
    const canvas = sheet[playerIdx] || sheet[0];

    const k = (s.worldW / s.w) * (scaleMul || 1);
    const w = s.w * k, h = s.h * k;
    const x = ix - s.ax * k, y = iy - s.ay * k;

    if (flip) {
      ctx.save();
      ctx.translate(ix, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(canvas, s.x, s.y, s.w, s.h, -(ix - x) - w, y, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(canvas, s.x, s.y, s.w, s.h, x, y, w, h);
    }
    return true;
  },

  /**
   * Which of the eight poses on a unit strip to show:
   *   0 idle · 1-4 walk cycle · 5-6 action · 7 fallen
   */
  unitFrame(u) {
    if (u.deathT !== undefined) return 7;
    if (u.swing > 0.15) return u.swing > 0.55 ? 6 : 5;
    if (u.path && u.path.length) {
      const t = ((u.walkPhase % TAU) + TAU) % TAU;
      return 1 + Math.min(3, Math.floor(t / (TAU / 4)));
    }
    // workers keep swinging their tool while gathering or building
    if (u.state === 'gather' || u.state === 'build') {
      return (Math.floor(u.anim * 4) % 2) ? 6 : 5;
    }
    return 0;
  },

  /** Note a name we wanted but do not have, so gaps can be reported. */
  want(name) {
    if (!this.has(name)) this.missing.add(name);
    return this.has(name);
  },

  report() { return Array.from(this.missing).sort(); },
};

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
