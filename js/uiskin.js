/* =========================================================================
   UI skin — dresses the HUD in the artwork from the UI sheet.

   The sheet is keyed at load, so each icon is pulled out as its own data URL
   and pushed into a stylesheet. That keeps the CSS declarative (classes still
   just say `.ico-wood`) while the pixels come from the artist's sheet, and it
   avoids shipping twenty separate icon files.

   Everything here is optional: without an atlas the stylesheet's own fallback
   colours and glyphs stand in, so the HUD is never blank.
   ========================================================================= */
'use strict';

const UISkin = {
  applied: false,

  /** icon sprite -> the CSS class that should wear it */
  ICONS: {
    'ico.wood': '.ico-wood', 'ico.food': '.ico-food', 'ico.gold': '.ico-gold',
    'ico.stone': '.ico-stone', 'ico.pop': '.ico-pop', 'ico.clock': '.ico-clock',
    'ico.idle': '.ico-idle', 'ico.army': '.ico-army', 'ico.trophy': '.ico-trophy',
    'ico.gear': '.ico-gear', 'ico.globe': '.ico-globe', 'ico.crown': '.ico-crown',
    'ico.map': '.ico-map', 'ico.help': '.ico-help',
    'ico.hp': '.si-hp', 'ico.armor': '.si-armor', 'ico.attack': '.si-atk',
    'ico.pop2': '.si-pop',
    'ico.build': '.cmd-build', 'ico.stop': '.cmd-stop',
    'ico.cancel': '.cmd-cancel', 'ico.attack2': '.cmd-attack',
  },

  apply() {
    if (this.applied || !Sprites.ready) return false;

    const rules = [];
    const url = (name, max) => Sprites.extract(name, 0, max);

    for (const [sprite, sel] of Object.entries(this.ICONS)) {
      // a couple of classes reuse one drawing under a second name.
      // 64px is ~3x the largest on-screen size, so it stays sharp on hidpi.
      const src = url(sprite.replace(/2$/, ''), 64);
      if (src) rules.push(`${sel}{background-image:url(${src});background-size:contain;` +
        `background-repeat:no-repeat;background-position:center}`);
    }

    // Ornate panel border as a 9-slice. The centre of the artwork is punched
    // out, so each panel's own background still shows through the middle.
    const frame = url('ui.frame', 172);
    if (frame) {
      rules.push(`.frame{border:17px solid transparent;border-image-source:url(${frame});` +
        `border-image-slice:34;border-image-repeat:stretch;border-radius:0;box-shadow:none}`);
      rules.push('.frame::before,.frame::after{display:none}');
    }

    // Age banner: hollow wooden nameplate stretched over a dark bar.
    const plaque = url('ui.plaque', 236);
    if (plaque) {
      rules.push(`#age-banner{background-image:url(${plaque});background-size:100% 100%;` +
        `background-repeat:no-repeat;background-color:transparent;border:none;box-shadow:none;` +
        `padding:0 46px 14px;min-width:330px}`);
      rules.push('#age-banner .crest{display:none}');   // the plaque carries its own
    }

    // Recessed stone slot behind every command button and queue tile.
    const slot = url('ui.slot', 125);
    if (slot) {
      rules.push(`.cmd,.qitem,#sel-icon img,.chip{border:9px solid transparent;` +
        `border-image-source:url(${slot});border-image-slice:30 fill;` +
        `border-image-repeat:stretch;background:none;border-radius:0}`);
      rules.push(`.round{border:8px solid transparent;border-image-source:url(${slot});` +
        `border-image-slice:30 fill;border-image-repeat:stretch;background:none;border-radius:0}`);
    }

    const style = document.createElement('style');
    style.id = 'ui-skin';
    style.textContent = rules.join('\n');
    document.head.appendChild(style);
    document.body.classList.add('skinned');
    this.applied = true;
    return true;
  },
};
