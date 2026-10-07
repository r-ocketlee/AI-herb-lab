// ColorExtractor — pulls the visitor's dominant clothing color from the
// live webcam frame, using MediaPipe Pose landmarks to scope the sampling
// to the torso (shoulders 11/12 + hips 23/24).
//
// • Samples every 100 ms via a small offscreen canvas (no full-res cost).
// • Skips pixels too dark (< 30) or too bright (> 230) — those are usually
//   shadow or specular hits, not the cloth itself.
// • Maintains a running EMA so the color signal stays stable when the
//   visitor moves slightly between frames.
//
// Subscribers receive [r, g, b] in 0..1 range (matching the shader uniforms).

const SAMPLE_INTERVAL_MS = 100;
const MIN_BRIGHTNESS = 30;
const MAX_BRIGHTNESS = 230;
const MIN_VALID_PIXELS = 80; // require at least this many in-range samples

export class ColorExtractor {
  constructor(video, poseTracker) {
    this.video = video;
    this.poseTracker = poseTracker;

    // Small canvas — we don't need full resolution to average a clothing color.
    this.canvas = document.createElement('canvas');
    this.canvas.width = 320;
    this.canvas.height = 240;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

    this.currentColor = null; // [r, g, b] in 0..1
    this.observers = new Set();
    this.running = false;
    this._timer = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._tick();
  }

  stop() {
    this.running = false;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  observe(fn) {
    this.observers.add(fn);
    return () => this.observers.delete(fn);
  }

  _tick() {
    if (!this.running) return;
    this._sample();
    this._timer = setTimeout(() => this._tick(), SAMPLE_INTERVAL_MS);
  }

  _sample() {
    const pose = this.poseTracker?.state?.raw;
    if (!pose || pose.length < 25) return;
    if (!this.video?.videoWidth || !this.video?.videoHeight) return;

    // Torso bounding box from shoulder + hip landmarks. All values are
    // normalized [0..1] in MediaPipe space, which maps 1:1 to the video
    // frame (NOT to the mirrored CSS display).
    const ls = pose[11], rs = pose[12], lh = pose[23], rh = pose[24];
    if (!ls || !rs || !lh || !rh) return;

    const minX = Math.max(0, Math.min(ls.x, rs.x, lh.x, rh.x));
    const maxX = Math.min(1, Math.max(ls.x, rs.x, lh.x, rh.x));
    const minY = Math.max(0, Math.min(ls.y, rs.y, lh.y, rh.y));
    const maxY = Math.min(1, Math.max(ls.y, rs.y, lh.y, rh.y));
    if (maxX - minX < 0.05 || maxY - minY < 0.05) return;

    try {
      this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
    } catch (e) {
      return;
    }

    const x0 = Math.floor(minX * this.canvas.width);
    const y0 = Math.floor(minY * this.canvas.height);
    const x1 = Math.ceil(maxX * this.canvas.width);
    const y1 = Math.ceil(maxY * this.canvas.height);
    const w = Math.max(1, x1 - x0);
    const h = Math.max(1, y1 - y0);

    let data;
    try {
      data = this.ctx.getImageData(x0, y0, w, h).data;
    } catch (e) {
      return;
    }

    // Average the in-range pixels. Stride 8 (every other pixel in 1D) for
    // ~half the work without losing color fidelity.
    let r = 0, g = 0, b = 0, count = 0;
    for (let i = 0; i < data.length; i += 8) {
      const pr = data[i];
      const pg = data[i + 1];
      const pb = data[i + 2];
      const brightness = (pr + pg + pb) / 3;
      if (brightness < MIN_BRIGHTNESS) continue;
      if (brightness > MAX_BRIGHTNESS) continue;
      r += pr;
      g += pg;
      b += pb;
      count++;
    }

    if (count < MIN_VALID_PIXELS) return;

    const avg = [
      (r / count) / 255,
      (g / count) / 255,
      (b / count) / 255,
    ];

    // EMA — newer samples have a small weight so jitter doesn't yank
    // the shader target around.
    if (!this.currentColor) {
      this.currentColor = avg;
    } else {
      this.currentColor = [
        this.currentColor[0] * 0.75 + avg[0] * 0.25,
        this.currentColor[1] * 0.75 + avg[1] * 0.25,
        this.currentColor[2] * 0.75 + avg[2] * 0.25,
      ];
    }

    this.observers.forEach((fn) => {
      try { fn(this.currentColor); } catch (e) { /* ignore subscriber errors */ }
    });
  }
}
