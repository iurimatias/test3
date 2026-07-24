/* =========================================================================
   Bootstrap — canvas sizing, start screen, main loop
   ========================================================================= */
'use strict';

(function () {
  const canvas = document.getElementById('canvas');
  const minimap = document.getElementById('minimap');
  const startOverlay = document.getElementById('start');

  let difficulty = 'normal';

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    if (G.running) { G.dpr = dpr; G.cam.clampToWorld(); }
  }
  window.addEventListener('resize', resize);

  /* --------------------------------------------------------- start screen */

  document.querySelectorAll('#difficulty button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#difficulty button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      difficulty = b.dataset.v;
    });
  });

  document.getElementById('start-btn').addEventListener('click', start);
  window.addEventListener('keydown', (e) => {
    const code = keyCodeOf(e);
    if (!G.running && (code === 'Enter' || code === 'Space')) start();
  });

  async function start() {
    if (G.running) return;
    // Atlas art wins where it exists; anything absent falls back to drawn art.
    await Sprites.load('assets/atlas.json');
    startOverlay.classList.add('hidden');
    resize();
    UI.init();
    G.init(canvas, minimap, { difficulty });
    Input.init(canvas, minimap);
    UI.refreshSelection();
    G.toast('Send your villagers to work — right-click a berry bush or a tree', 5);
    canvas.focus();
  }

  /* ------------------------------------------------------- start-screen art */

  /** A little diorama in the same isometric style as the game itself. */
  function drawStartArt() {
    const cv = document.getElementById('start-art');
    const ctx = cv.getContext('2d');

    ctx.fillStyle = '#7cae3e';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    for (let i = 0; i < 26; i++) {
      ctx.beginPath();
      ctx.ellipse(hashNoise(i, 3) * cv.width, hashNoise(i, 9) * cv.height,
        30 + hashNoise(i, 1) * 70, 18 + hashNoise(i, 5) * 34, 0, 0, TAU);
      ctx.fill();
    }
    // a dirt track running across the diorama
    ctx.strokeStyle = '#cdb079';
    ctx.lineWidth = 22;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-10, 112);
    ctx.quadraticCurveTo(cv.width * 0.4, 96, cv.width + 10, 118);
    ctx.stroke();

    // Draw at the units' own world scale — each entity places itself via iso,
    // so nudge the canvas origin instead of faking positions.
    const mk = (type, facing) => ({
      def: UNIT_DEFS[type], type, x: 0, y: 0, facing: facing || 0,
      hitFlash: 0, swing: 0, path: null, walkPhase: 0, anim: 0,
      state: 'idle', carry: { type: null, amount: 0 }, radius: 8,
    });
    const at = (x, y, fn) => { ctx.save(); ctx.translate(x, y); fn(); ctx.restore(); };

    at(40, 116, () => drawResource(ctx, { x: 0, y: 0, seed: 7, type: 'tree', amount: 1, maxAmount: 1 }, 0));
    at(74, 134, () => drawResource(ctx, { x: 0, y: 0, seed: 21, type: 'tree', amount: 1, maxAmount: 1 }, 0));
    at(520, 120, () => drawResource(ctx, { x: 0, y: 0, seed: 11, type: 'gold', amount: 1, maxAmount: 1 }, 0));
    at(300, 138, () => drawResource(ctx, { x: 0, y: 0, seed: 3, type: 'bush', amount: 1, maxAmount: 1 }, 0));

    const blues = [['villager', 132], ['militia', 176], ['archer', 216], ['spearman', 256]];
    for (const [t, x] of blues) at(x, 126, () => drawUnit(ctx, mk(t, 0), PLAYER_COLORS[0]));
    at(340, 132, () => drawUnit(ctx, mk('knight', 0), PLAYER_COLORS[0]));

    const reds = [['champion', 420], ['crossbowman', 462]];
    for (const [t, x] of reds) at(x, 124, () => drawUnit(ctx, mk(t, Math.PI), PLAYER_COLORS[1]));
    at(490, 138, () => drawUnit(ctx, mk('paladin', Math.PI), PLAYER_COLORS[1]));
  }

  /* ------------------------------------------------------------- main loop */

  let last = performance.now();

  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    if (G.running) {
      Input.updateCamera(dt);
      G.update(dt);
      G.renderer.draw(G);
      G.renderer.drawMinimap(G, minimap);
      UI.update();
    }
    requestAnimationFrame(frame);
  }

  resize();
  // try the atlas early so the start-screen diorama uses it too
  Sprites.load('assets/atlas.json').then(drawStartArt, drawStartArt);
  requestAnimationFrame(frame);
})();
