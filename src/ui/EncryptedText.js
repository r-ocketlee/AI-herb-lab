// EncryptedText — "decrypting" reveal effect for a single string.
//
// Visual: every glyph starts as a random scrambled character. A reveal
// pointer marches left-to-right; characters behind the pointer settle to
// their real value, characters in front keep cycling through random glyphs
// until the pointer reaches them.
//
// • Korean syllables scramble through other Hangul syllables for visual
//   consistency — mixing in ASCII would create awkward width jumps.
// • Latin letters / digits scramble through their respective alphabets.
// • Whitespace + punctuation pass through unchanged so word shape is
//   preserved during the animation.
//
// Usage:
//   const enc = new EncryptedText('AI Herb Lab에 오신 것을 환영합니다');
//   parentEl.appendChild(enc.root);
//   enc.start();    // begin the reveal animation
//   enc.stop();     // cancel mid-reveal (also clears RAF/intervals)
//   enc.replay();   // re-scramble and reveal again
//
// The root <span> inherits whatever font / size / color its parent applies
// — there are no internal style overrides, so dropping this into an
// existing styled headline preserves layout exactly.

const LATIN_UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LATIN_LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%&*+=?<>/\\';
// Hangul syllable block U+AC00–U+D7A3 (11,172 glyphs). Sampling from this
// keeps each scramble step a visually plausible Korean character.
const HANGUL_START = 0xac00;
const HANGUL_RANGE = 0xd7a3 - 0xac00 + 1;

function isHangulSyllable(ch) {
  const code = ch.codePointAt(0);
  return code >= HANGUL_START && code <= 0xd7a3;
}

function randomScrambleFor(ch) {
  if (isHangulSyllable(ch)) {
    return String.fromCodePoint(HANGUL_START + Math.floor(Math.random() * HANGUL_RANGE));
  }
  if (/[A-Z]/.test(ch)) return LATIN_UPPER[Math.floor(Math.random() * LATIN_UPPER.length)];
  if (/[a-z]/.test(ch)) return LATIN_LOWER[Math.floor(Math.random() * LATIN_LOWER.length)];
  if (/[0-9]/.test(ch)) return DIGITS[Math.floor(Math.random() * DIGITS.length)];
  // Whitespace, punctuation, emoji — pass through. Avoids width jitter and
  // keeps word boundaries readable through the whole animation.
  return ch;
}

export class EncryptedText {
  constructor(text, opts = {}) {
    this.text = text;
    this.charsPerSecond = opts.charsPerSecond ?? 12;
    this.scrambleFps = opts.scrambleFps ?? 30;
    this.startDelayMs = opts.startDelayMs ?? 0;

    this.root = document.createElement('span');
    this.root.className = 'encrypted-text';
    // Scrambled-by-default — render immediately so there's no "flash of
    // real text" before start() is called.
    this._renderAtPointer(0);

    this._rafId = 0;
    this._scrambleTimer = 0;
    this._revealTimer = 0;
    this._startTimer = 0;
    this._running = false;
  }

  setText(text) {
    this.text = text;
    this._renderAtPointer(0);
  }

  start() {
    this.stop();
    this._running = true;
    const begin = () => {
      const startedAt = performance.now();
      const totalDurationMs = (this.text.length / this.charsPerSecond) * 1000;

      // Reveal pointer: advances over time from 0 → text.length.
      const tickReveal = () => {
        if (!this._running) return;
        const elapsed = performance.now() - startedAt;
        const pointer = Math.min(
          this.text.length,
          Math.floor((elapsed / totalDurationMs) * this.text.length),
        );
        this._renderAtPointer(pointer);
        if (pointer >= this.text.length) {
          // Done — stop scrambling, hold the real text.
          this._running = false;
          clearInterval(this._scrambleTimer);
          this._scrambleTimer = 0;
          return;
        }
        this._rafId = requestAnimationFrame(tickReveal);
      };

      // Scramble refresh runs on a slower interval (e.g. 30fps) so the
      // unrevealed glyphs visibly cycle without burning a full RAF.
      this._scrambleTimer = setInterval(() => {
        if (!this._running) return;
        // Re-render at current pointer — read it back from the DOM-ish
        // model via the next RAF instead; here just trigger a refresh by
        // re-rendering with the current settled portion.
        const settledChars = this._lastSettled ?? 0;
        this._renderAtPointer(settledChars);
      }, 1000 / this.scrambleFps);

      this._rafId = requestAnimationFrame(tickReveal);
    };

    if (this.startDelayMs > 0) {
      this._startTimer = setTimeout(begin, this.startDelayMs);
    } else {
      begin();
    }
  }

  stop() {
    this._running = false;
    cancelAnimationFrame(this._rafId);
    if (this._scrambleTimer) clearInterval(this._scrambleTimer);
    if (this._startTimer) clearTimeout(this._startTimer);
    this._rafId = 0;
    this._scrambleTimer = 0;
    this._startTimer = 0;
  }

  replay() {
    this.stop();
    this._renderAtPointer(0);
    this.start();
  }

  _renderAtPointer(pointer) {
    this._lastSettled = pointer;
    const chars = Array.from(this.text);
    let out = '';
    for (let i = 0; i < chars.length; i++) {
      out += i < pointer ? chars[i] : randomScrambleFor(chars[i]);
    }
    this.root.textContent = out;
  }
}
