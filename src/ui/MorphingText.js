// MorphingText — gooey "blob" cross-morph between two strings.
//
// Visual: two overlapping <span>s. To morph from text A → B:
//   • A blurs out + fades out.
//   • B blurs in + fades in.
//   • An SVG threshold filter on the container clips the soft blurred
//     alpha into a hard binary mask. Where A and B overlap mid-morph,
//     their blurred halos fuse and re-split — the letters appear to
//     stretch, drip, and pull apart rather than crossfade.
//   • A tiny extra 0.5 px blur softens the threshold edge so the result
//     reads as "puffy text" rather than bitmappy.
//
// Layout: spans are placed in the same CSS-Grid cell, so the parent
// auto-sizes to whichever text is taller / wider. No external height
// constraint needed. Inherits font/color/alignment from its parent — drop
// it into an existing styled container and visual position is preserved.
//
// Usage:
//   const morph = new MorphingText({ morphMs: 1400 });
//   parentEl.appendChild(morph.root);
//   morph.setInitial('');            // start empty
//   morph.morphTo('2050년의 가전은…'); // animate in
//   morph.morphTo('두 번째 슬라이드'); // animate to next
//   morph.stop();                     // cancel in-flight RAF on dispose

const FILTER_ID = 'morphTextThreshold';
const FILTER_SVG_HTML = `
  <svg xmlns="http://www.w3.org/2000/svg" id="${FILTER_ID}-svg"
       style="position:fixed;width:0;height:0;pointer-events:none">
    <defs>
      <filter id="${FILTER_ID}">
        <feColorMatrix in="SourceGraphic" type="matrix"
          values="1 0 0 0 0
                  0 1 0 0 0
                  0 0 1 0 0
                  0 0 0 200 -100" />
      </filter>
    </defs>
  </svg>
`;

// Inject the threshold filter <svg> once per page. Multiple MorphingText
// instances all reference the same filter id.
function ensureFilterMounted() {
  if (document.getElementById(`${FILTER_ID}-svg`)) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = FILTER_SVG_HTML.trim();
  document.body.appendChild(tmp.firstElementChild);
}

const DEFAULT_MORPH_MS = 1400;

export class MorphingText {
  constructor({ morphMs = DEFAULT_MORPH_MS } = {}) {
    ensureFilterMounted();
    this.morphMs = morphMs;

    this.root = document.createElement('div');
    this.root.className = 'morph-text';
    Object.assign(this.root.style, {
      display: 'grid',
      // Grid auto-sizes to whichever overlapping span is largest, so the
      // morph container has no height collapse when both spans empty out
      // mid-transition.
      filter: `url(#${FILTER_ID}) blur(0.5px)`,
    });

    this.span1 = document.createElement('span');
    this.span2 = document.createElement('span');
    for (const s of [this.span1, this.span2]) {
      // Both occupy the same grid cell → perfect overlap.
      s.style.gridArea = '1 / 1';
      s.style.minWidth = '0';
      s.style.willChange = 'opacity, filter';
    }
    this.root.appendChild(this.span1);
    this.root.appendChild(this.span2);

    // span1 is the active slot at construction; span2 holds the next text
    // during morphTo, then becomes active. Swaps each morph.
    this.activeIdx = 0;
    this.span2.style.opacity = '0';

    this._rafId = 0;
  }

  setInitial(html) {
    this.span1.innerHTML = html;
    this.span1.style.opacity = '1';
    this.span1.style.filter = 'none';
    this.span2.innerHTML = '';
    this.span2.style.opacity = '0';
    this.span2.style.filter = 'none';
    this.activeIdx = 0;
  }

  // Pass durationMs to override this instance's default morphMs for this
  // one call — used by states' exit() handlers that want a snappier
  // morph-out than the 1800 ms morph-in.
  morphTo(html, durationMs) {
    cancelAnimationFrame(this._rafId);

    const fromSpan = this.activeIdx === 0 ? this.span1 : this.span2;
    const toSpan = this.activeIdx === 0 ? this.span2 : this.span1;

    toSpan.innerHTML = html;
    toSpan.style.opacity = '0';
    toSpan.style.filter = 'blur(80px)';

    const morphDuration = durationMs ?? this.morphMs;
    const startTime = performance.now();
    const tick = () => {
      const elapsed = performance.now() - startTime;
      const frac = Math.min(1, elapsed / morphDuration);
      const inv = 1 - frac;

      // Blur curve `8 / x - 8` blows up near x=0 (sharp blur on the
      // outgoing end-state) and falls to 0 near x=1 (crisp on settle).
      // Clamp avoids the Infinity at exactly 0.
      const toBlur = Math.min(8 / Math.max(frac, 0.001) - 8, 100);
      const fromBlur = Math.min(8 / Math.max(inv, 0.001) - 8, 100);

      // Power 0.4 — opacity rises fast at first, eases near full. Mirrors
      // the reference implementation's perceptual curve.
      toSpan.style.filter = `blur(${toBlur}px)`;
      toSpan.style.opacity = String(Math.pow(frac, 0.4));
      fromSpan.style.filter = `blur(${fromBlur}px)`;
      fromSpan.style.opacity = String(Math.pow(inv, 0.4));

      if (frac < 1) {
        this._rafId = requestAnimationFrame(tick);
      } else {
        // Settle — kill the filter on both so the resting text isn't
        // rendered through an aggressive threshold every frame.
        toSpan.style.filter = 'none';
        toSpan.style.opacity = '1';
        fromSpan.style.filter = 'none';
        fromSpan.style.opacity = '0';
        this.activeIdx = 1 - this.activeIdx;
      }
    };
    this._rafId = requestAnimationFrame(tick);
  }

  stop() {
    cancelAnimationFrame(this._rafId);
    this._rafId = 0;
  }
}
