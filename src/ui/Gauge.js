// Gauge — bottom-of-screen progress bar used by BloomState. Thin lavender
// rail with a fill that's driven externally via setValue(0..1).

export class Gauge {
  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'gauge-bottom';
    this.fill = document.createElement('div');
    this.fill.className = 'fill';
    this.root.appendChild(this.fill);
    this.value = 0;
  }

  setValue(v) {
    v = Math.max(0, Math.min(1, v));
    this.value = v;
    this.fill.style.width = `${v * 100}%`;
  }
}
