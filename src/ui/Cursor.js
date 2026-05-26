// Cursor — translucent lavender disc that follows the hand. The ring around
// it is a canvas that fills clockwise as dwell progress accrues (0..1).
//
// Owned globally (mounted once by main.js) so it survives state transitions —
// each state just calls show()/hide() and updates progress as needed.

export class Cursor {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'cursor';
    this.el.hidden = true;

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
  }

  hide() {
    this.el.hidden = true;
  }

  // x, y in pixel space (window coords)
  moveTo(x, y) {
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
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

    // background ring
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(234, 160, 255, 0.25)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    if (progress > 0) {
      ctx.strokeStyle = '#EAA0FF';
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.stroke();
    }
  }
}
