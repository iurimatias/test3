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

  function start() {
    if (G.running) return;
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

  function drawStartArt() {
    const cv = document.getElementById('start-art');
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);

    // ground line
    ctx.strokeStyle = 'rgba(80,74,58,0.5)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let x = 10; x < cv.width - 10; x += 24) skLine(ctx, x, 112, x + 24, 112, x, 1.2);
    ctx.stroke();

    const mk = (type, x, facing) => ({
      def: UNIT_DEFS[type], type, x, y: 112, facing: facing || 0,
      hitFlash: 0, swing: 0, path: null, walkPhase: 0, anim: 0,
      state: 'idle', carry: { type: null, amount: 0 }, radius: 8,
    });

    // a small blue line-up facing a red one
    const blues = [['villager', 62], ['militia', 108], ['archer', 152], ['spearman', 196], ['knight', 248]];
    for (const [t, x] of blues) drawUnit(ctx, mk(t, x, 0), PLAYER_COLORS[0]);
    const reds = [['champion', 330], ['crossbowman', 380], ['paladin', 442]];
    for (const [t, x] of reds) drawUnit(ctx, mk(t, x, Math.PI), PLAYER_COLORS[1]);

    // a tree and a house for flavour
    drawResource(ctx, { x: 22, y: 110, seed: 7, type: 'tree', amount: 1, maxAmount: 1 }, 0);
    drawResource(ctx, { x: 292, y: 112, seed: 3, type: 'bush', amount: 1, maxAmount: 1 }, 0);
    drawResource(ctx, { x: 494, y: 110, seed: 11, type: 'gold', amount: 1, maxAmount: 1 }, 0);
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
  drawStartArt();
  requestAnimationFrame(frame);
})();
