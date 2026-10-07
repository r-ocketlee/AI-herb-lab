// RevealText — per-character "type-on" reveal for a single string.
//
// Drop-in replacement for MorphingText: same API (setInitial / morphTo / stop,
// and a `.root` element that inherits font/color/alignment from its parent), so
// states swap one import line and keep their existing logic.
//
// Visual: each glyph fades in one after another, left to right, on a steady
// cadence — like text being printed to a lab readout. No motion, just discrete
// per-character pops, so it reads crisp and instrument-like rather than the
// soft gooey morph it replaces. Markup in the string (<em>, <br>) is preserved:
// only the visible characters inside text nodes are split and staggered.
//
// Layout mirrors MorphingText: two spans share one CSS-Grid cell so the
// container auto-sizes to whichever string is larger and there's no height
// collapse mid-transition.

const DEFAULT_REVEAL_MS = 1400;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Walk every text node under `el` and replace each character with an
// individually-addressable <span> starting at opacity 0. Returns the char
// spans in document (left→right) order. Tags like <em>/<br> are left intact.
function splitChars(el) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  const spans = [];
  for (const node of textNodes) {
    const frag = document.createDocumentFragment();
    // [4] Group each whitespace-delimited word into an inline-block wrapper so
    // the browser treats it as one atomic unit: the line can break ONLY between
    // words (at the spaces), never between the per-character spans. Without this
    // every glyph is its own inline box and the line wraps mid-word, defeating
    // word-break: keep-all and breaking Korean eojeol awkwardly.
    let word = null;
    // Array.from splits by code point — keeps Hangul syllables / surrogate
    // pairs as single units.
    for (const ch of Array.from(node.nodeValue)) {
      const s = document.createElement('span');
      s.className = 'rt-ch';
      s.textContent = ch;
      s.style.opacity = '0';
      if (ch === ' ') {
        // Space stays outside any word wrapper and remains a real wrap
        // opportunity (pre-wrap preserves the space yet still allows a break).
        word = null;
        s.style.whiteSpace = 'pre-wrap';
        frag.appendChild(s);
      } else {
        if (!word) {
          word = document.createElement('span');
          word.style.display = 'inline-block';
          word.style.whiteSpace = 'nowrap';
          frag.appendChild(word);
        }
        word.appendChild(s);
      }
      spans.push(s);
    }
    node.parentNode.replaceChild(frag, node);
  }
  return spans;
}

export class RevealText {
  // Accepts `revealMs`; `morphMs` is kept as an alias so existing call sites
  // (new RevealText({ morphMs: 1800 })) work unchanged.
  constructor({ revealMs, morphMs, mode = 'type' } = {}) {
    this.mode = mode;
    this.revealMs = revealMs ?? morphMs ?? (mode === 'fade' ? 300 : DEFAULT_REVEAL_MS);

    this.root = document.createElement('div');
    this.root.className = 'reveal-text';
    this.root.style.display = 'grid';

    this.span1 = document.createElement('span');
    this.span2 = document.createElement('span');
    for (const s of [this.span1, this.span2]) {
      s.style.gridArea = '1 / 1';
      s.style.minWidth = '0';
      s.style.willChange = 'opacity';
    }
    this.root.appendChild(this.span1);
    this.root.appendChild(this.span2);

    this.activeIdx = 0;
    this.span2.style.opacity = '0';

    this._rafId = 0;
  }

  setInitial(html) {
    this.span1.innerHTML = html;
    this.span1.style.opacity = '1';
    this.span2.innerHTML = '';
    this.span2.style.opacity = '0';
    this.activeIdx = 0;
  }

  // Pass durationMs to override this instance's default for one call (e.g. a
  // snappier reveal-out from a state's exit()).
  morphTo(html, durationMs) {
    cancelAnimationFrame(this._rafId);

    const fromSpan = this.activeIdx === 0 ? this.span1 : this.span2;
    const toSpan = this.activeIdx === 0 ? this.span2 : this.span1;

    toSpan.style.opacity = '1';
    toSpan.innerHTML = html;
    if (this.mode === 'fade') {
      const duration = durationMs ?? this.revealMs;
      const start = performance.now();
      toSpan.style.opacity = '0';
      const tick = () => {
        const p = clamp((performance.now() - start) / duration, 0, 1);
        // Clear the old instruction before the new one becomes readable.
        fromSpan.style.opacity = String(Math.max(0, 1 - p * 2));
        toSpan.style.opacity = String(Math.max(0, p * 2 - 1));
        if (p < 1) this._rafId = requestAnimationFrame(tick);
        else this.activeIdx = 1 - this.activeIdx;
      };
      this._rafId = requestAnimationFrame(tick);
      return;
    }
    const chars = splitChars(toSpan);

    const duration = durationMs ?? this.revealMs;
    const startTime = performance.now();

    // Empty / whitespace-only target (e.g. reveal-out on exit) — nothing to
    // type in, so just fade the current text away over the window.
    if (chars.length === 0) {
      const tick = () => {
        const frac = Math.min(1, (performance.now() - startTime) / duration);
        fromSpan.style.opacity = String(1 - frac);
        if (frac < 1) {
          this._rafId = requestAnimationFrame(tick);
        } else {
          fromSpan.style.opacity = '0';
          this.activeIdx = 1 - this.activeIdx;
        }
      };
      this._rafId = requestAnimationFrame(tick);
      return;
    }

    // Per-char cadence derived from the configured duration: `step` is the
    // delay between successive characters, `fade` is how long each one takes
    // to pop in. Clamped so short strings don't fire instantly and long ones
    // don't crawl.
    const step = clamp(duration / chars.length, 22, 55);
    const fade = clamp(step * 2.2, 70, 150);
    const total = (chars.length - 1) * step + fade;

    let firstActive = 0; // chars before this index are fully revealed (opacity 1)
    const tick = () => {
      const elapsed = performance.now() - startTime;
      // Advance the settled frontier: chars whose fade window has fully passed
      // are pinned to opacity 1 once, then never written again.
      while (firstActive < chars.length && elapsed - firstActive * step >= fade) {
        chars[firstActive].style.opacity = '1';
        firstActive++;
      }
      // Update only the chars currently mid-fade (a small moving window).
      // Writing opacity to EVERY glyph every frame caused a per-glyph repaint
      // storm that stuttered the reveal.
      const lastActive = Math.min(chars.length - 1, Math.floor(elapsed / step));
      for (let i = firstActive; i <= lastActive; i++) {
        const op = clamp((elapsed - i * step) / fade, 0, 1);
        chars[i].style.opacity = String(op);
      }
      // Old text clears out quickly up front so the two strings don't read at
      // once while the new one types in.
      fromSpan.style.opacity = String(Math.max(0, 1 - elapsed / (fade * 2)));

      if (elapsed < total) {
        this._rafId = requestAnimationFrame(tick);
      } else {
        for (const c of chars) c.style.opacity = '1';
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
