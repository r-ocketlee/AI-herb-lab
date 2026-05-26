// AudioManager — thin wrapper around Web Audio. Real cues will load lazily
// later; for the skeleton we expose a no-op-friendly API so states can call
// audio.play('select') without worrying about whether the bus is ready.

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this.unlocked = false;
  }

  // Must be called from a user gesture before audio works in Chrome kiosk.
  // The dev keybinds in main.js call this on the first keypress.
  async unlock() {
    if (this.unlocked) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.unlocked = true;
  }

  async load(id, url) {
    if (!this.ctx) await this.unlock();
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    const decoded = await this.ctx.decodeAudioData(buf);
    this.buffers.set(id, decoded);
  }

  play(id, { volume = 1, loop = false } = {}) {
    if (!this.ctx) return null;
    const buf = this.buffers.get(id);
    if (!buf) {
      // Skeleton phase: silently no-op so missing cues don't break the flow.
      return null;
    }
    const src = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    src.buffer = buf;
    src.loop = loop;
    src.connect(gain).connect(this.ctx.destination);
    src.start();
    return src;
  }
}
