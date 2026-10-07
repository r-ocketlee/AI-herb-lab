// Cursor — a small neutral luminous point that follows the hand. The ring
// around it is a canvas that fills clockwise as dwell progress accrues (0..1);
// at rest (progress 0) only the point shows, so it reads as a clean pointer.
//
// Owned globally (mounted once by main.js) so it survives state transitions —
// each state just calls show()/hide() and updates progress as needed.

export class Cursor {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'cursor';
    this.el.hidden = true;
    // Position via transform (GPU-composited, no layout reflow) and glide toward
    // the latest hand target each frame, so the cursor stays smooth even though
    // hand tracking only updates ~15fps.
    this.el.style.left = '0';
    this.el.style.top = '0';
    this.el.style.willChange = 'transform';
    this._x = 0; this._y = 0;       // rendered position
    this._tx = 0; this._ty = 0;     // target (latest hand position)
    this._hasTarget = false;
    this._rafId = 0;
    this._animate = this._animate.bind(this);

    this.canvas = document.createElement('canvas');
    this.canvas.width = 128;
    this.canvas.height = 128;
    this.el.appendChild(this.canvas);

    this.ctx = this.canvas.getContext('2d');
    this.progress = 0;
    this._render();
  }

  mount(parent = document.body) {
    parent.appendChild(this.el);
  }

  show() {
    this.el.hidden = false;
    if (!this._rafId) this._rafId = requestAnimationFrame(this._animate);
  }

  hide() {
    this.el.hidden = true;
    cancelAnimationFrame(this._rafId);
    this._rafId = 0;
    this._hasTarget = false; // snap to the first target on next show
  }

  // x, y in pixel space (window coords) — stored as the target; _animate glides
  // the cursor toward it.
  moveTo(x, y) {
    this._tx = x;
    this._ty = y;
    if (!this._hasTarget) { this._x = x; this._y = y; this._hasTarget = true; }
  }

  _animate() {
    // Glide toward the latest target — decouples visual smoothness from the
    // ~15fps tracker rate. translate(-50%,-50%) keeps the disc centred on (x,y).
    // 0.24 ease — matches SeedSelect's seed-cursor (SEED_EASE) for the same
    // natural "rolling" glide. Lower = smoother / more trailing.
    this._x += (this._tx - this._x) * 0.24;
    this._y += (this._ty - this._y) * 0.24;
    this.el.style.transform = `translate3d(${this._x}px, ${this._y}px, 0) translate(-50%, -50%)`;
    this._rafId = requestAnimationFrame(this._animate);
  }

  setProgress(p) {
    p = Math.max(0, Math.min(1, p));
    if (p === this.progress) return;
    this.progress = p;
    this._render();
  }

  _render() {
    const { ctx, canvas, progress } = this;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const r = canvas.width / 2 - 8;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // [6] Selection gauge only — the neutral dot has no ring at rest; the
    // surrounding ring appears only while dwell progress is accruing.
    if (progress <= 0) return;

    // background ring
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(234, 160, 255, 0.25)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#EAA0FF';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
    ctx.stroke();
  }
}
