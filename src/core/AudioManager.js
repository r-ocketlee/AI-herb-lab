// AudioManager — thin wrapper around Web Audio. Real cues will load lazily
// later; for the skeleton we expose a no-op-friendly API so states can call
// audio.play('select') without worrying about whether the bus is ready.

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    // Currently-playing source per id — lets a re-trigger cut off the
    // previous instance so the same cue never overlaps itself.
    this.active = new Map();
    this.unlocked = false;
  }

  // Must be called from a user gesture before audio works in Chrome kiosk.
  // The dev keybinds in main.js call this on the first keypress.
  async unlock() {
    if (this.unlocked) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    // Match the asset sample rate (every cue is 44.1 kHz). Without this the
    // context defaults to the device rate (often 48 kHz) and decodeAudioData
    // resamples 44.1→48 with Chrome's internal resampler, which can dull/muffle
    // the highs. Pinning 44.1 removes that resample (the OS still handles final
    // output, like a media player does). Falls back to default if unsupported.
    try {
      this.ctx = new AC({ sampleRate: 44100 });
    } catch (e) {
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    console.log('[audio] AudioContext sampleRate =', this.ctx.sampleRate);
    this.unlocked = true;
  }

  async load(id, url) {
    if (!this.ctx) await this.unlock();
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    const decoded = await this.ctx.decodeAudioData(buf);
    this.buffers.set(id, decoded);
  }

  // `restart: true` (default) cuts off any still-playing instance of the
  // same id before starting the new one — no overlap when re-triggered
  // rapidly (e.g. moving the seed from one appliance to the next).
  play(id, { volume = 1, loop = false, restart = true } = {}) {
    if (!this.ctx) return null;
    const buf = this.buffers.get(id);
    if (!buf) {
      // Skeleton phase: silently no-op so missing cues don't break the flow.
      return null;
    }

    if (restart) this.stop(id);

    const src = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    src.buffer = buf;
    src.loop = loop;
    src.connect(gain).connect(this.ctx.destination);
    // Track the source AND its gain node for the id — the gain reference lets
    // fadeOut() ramp the level later. Clear on natural end so we don't try to
    // stop an already-finished node.
    this.active.set(id, { src, gain });
    src.addEventListener('ended', () => {
      if (this.active.get(id)?.src === src) this.active.delete(id);
    });
    src.start();
    return src;
  }

  // Decoded length in seconds (for syncing visuals to a cue), or null if the
  // buffer isn't loaded.
  getDuration(id) {
    return this.buffers.get(id)?.duration ?? null;
  }

  // Immediately stop the currently-playing instance of `id`, if any.
  stop(id) {
    const entry = this.active.get(id);
    if (entry) {
      try { entry.src.stop(); } catch (e) { /* already stopped */ }
      this.active.delete(id);
    }
  }

  // Ramp the currently-playing instance of `id` to silence over durationMs,
  // then stop it. Used for the graceful tail-out when the experience resets.
  fadeOut(id, durationMs = 1500) {
    const entry = this.active.get(id);
    if (!entry || !this.ctx) return;
    const { src, gain } = entry;
    const now = this.ctx.currentTime;
    const end = now + durationMs / 1000;
    try {
      gain.gain.cancelScheduledValues(now);
      // setValueAtTime anchors the current level so the ramp starts from here.
      gain.gain.setValueAtTime(gain.gain.value, now);
      // linearRamp to ~0 (not exactly 0 — exponential-safe and inaudible).
      gain.gain.linearRampToValueAtTime(0.0001, end);
    } catch (e) { /* ignore scheduling errors */ }
    try { src.stop(end); } catch (e) { /* already stopped */ }
    // Drop the reference now so a later stop()/fadeOut() is a no-op; the
    // scheduled src.stop still fires at `end`.
    this.active.delete(id);
  }
}
