/* =========================================================================
   Opening cinematic.

   Plays the clips back to back on a fresh page load, then hands over to the
   start screen. Skipping is deliberate: only the Skip button does it.

   Sound is on by default. Browsers may refuse to autoplay audio without a user
   gesture, so a rejected play() is retried muted — with the unmute control left
   showing — rather than dropping the cinematic. If even muted autoplay is
   blocked, the sequence is skipped rather than leaving the player staring at a
   frozen frame.
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
      root.classList.add('fading');
      setTimeout(() => root.remove(), 420);
      onDone();
    };

    const root = document.createElement('div');
    root.id = 'intro';
    root.innerHTML = `
      <video id="intro-video" playsinline preload="auto"></video>
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

    let index = 0;
    const playAt = (i) => {
      if (i >= this.CLIPS.length) { done(); return; }
      video.src = this.CLIPS[i];
      video.play().catch(() => {
        // Autoplay with sound is commonly blocked without a user gesture.
        // Fall back to muted rather than losing the cinematic, and leave the
        // unmute button highlighted so it is one click away.
        video.muted = true;
        syncSound();
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

    playAt(0);
  },
};
