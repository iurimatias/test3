/* =========================================================================
   Opening cinematic.

   Plays the clips back to back on a fresh page load, then hands over to the
   start screen. Skipping is deliberate: only the Skip button does it.

   It opens on a black click-to-start plate. That is not decoration: browsers
   refuse to begin audio until the visitor has interacted with the origin, so
   without a gesture the first visit is always muted. Starting playback from
   inside the click handler makes that gesture the one that starts the video, so
   sound is guaranteed from the first frame for everyone.

   The muted fallback below is kept as a belt-and-braces path in case a browser
   still refuses; it should not normally be reached.
   ========================================================================= */
'use strict';

const Intro = {
  CLIPS: ['videos/cinematic.mp4', 'videos/cinematic_2.mp4'],

  /** @param onDone called exactly once, whether it played, was skipped or failed */
  play(onDone) {
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      if (root._disarm) root._disarm();
      root.classList.add('fading');
      setTimeout(() => root.remove(), 420);
      onDone();
    };

    const root = document.createElement('div');
    root.id = 'intro';
    root.innerHTML = `
      <video id="intro-video" playsinline preload="auto"></video>
      <div id="intro-gate"><span>Click to start game</span></div>
      <div id="intro-controls">
        <button id="intro-sound" title="Mute">🔊</button>
        <button id="intro-skip">Skip&nbsp;›</button>
      </div>`;
    document.body.appendChild(root);

    const video = root.querySelector('#intro-video');
    const soundBtn = root.querySelector('#intro-sound');
    const skipBtn = root.querySelector('#intro-skip');
    video.volume = 1;
    video.muted = false;

    const syncSound = () => {
      soundBtn.textContent = video.muted ? '🔇' : '🔊';
      soundBtn.title = video.muted ? 'Sound on' : 'Mute';
      soundBtn.classList.toggle('nudge', video.muted);
    };

    /**
     * Browsers only allow unmuted autoplay once the visitor has interacted with
     * the origin, so a first visit gets blocked no matter what we ask for. When
     * that happens, arm the whole window silently: the very next click or
     * keypress counts as the gesture and the sound comes on mid-clip, with no
     * prompt. Clicking the picture no longer skips, so it is free to do this.
     */
    const armUnmute = () => {
      const on = (e) => {
        if (e.target === skipBtn) return;         // skipping is not a request for sound
        video.muted = false;
        video.play().catch(() => {});
        syncSound();
        off();
      };
      const off = () => {
        for (const ev of ['pointerdown', 'keydown', 'touchstart'])
          window.removeEventListener(ev, on, true);
      };
      for (const ev of ['pointerdown', 'keydown', 'touchstart'])
        window.addEventListener(ev, on, true);
      root._disarm = off;
    };

    let index = 0;
    const playAt = (i) => {
      if (i >= this.CLIPS.length) { done(); return; }
      video.src = this.CLIPS[i];
      video.muted = false;                        // always ask for sound first
      video.play().then(syncSound).catch(() => {
        video.muted = true;
        syncSound();
        armUnmute();
        video.play().catch(() => {
          console.info('[intro] playback unavailable — skipping');
          done();
        });
      });
    };

    video.addEventListener('ended', () => playAt(++index));
    video.addEventListener('error', () => {
      console.warn('[intro] could not load', this.CLIPS[index]);
      playAt(++index);
    });

    soundBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      video.muted = !video.muted;
      syncSound();
      if (!video.muted) video.play().catch(() => {});
    });

    // Only the Skip button skips. Clicking the picture or tapping a key must
    // not cut the cinematic short — too easy to trigger by accident.
    skipBtn.addEventListener('click', (e) => { e.stopPropagation(); done(); });

    // Start from inside the gesture handler so the browser counts it as user
    // activation and lets the audio through.
    const gate = root.querySelector('#intro-gate');
    const start = (e) => {
      if (e) e.preventDefault();
      gate.removeEventListener('click', start);
      window.removeEventListener('keydown', onGateKey, true);
      gate.classList.add('gone');
      setTimeout(() => gate.remove(), 300);
      root.classList.add('started');
      playAt(0);
    };
    const onGateKey = (e) => {
      const code = keyCodeOf(e);
      if (code === 'Enter' || code === 'Space') { e.stopPropagation(); start(e); }
    };
    gate.addEventListener('click', start);
    window.addEventListener('keydown', onGateKey, true);
  },
};
