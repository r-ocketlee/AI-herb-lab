// Gauge — bottom-of-screen progress bar used by BloomState. A thin lavender
// rail with an externally-driven fill (setValue 0..1), dressed as a lab
// instrument: a calibration tick scale over the rail, end-cap registration
// marks, and a "GROWTH / %" readout above it.

export class Gauge {
  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'gauge-bottom';

    const meta = document.createElement('div');
    meta.className = 'gauge-meta';
    this.label = document.createElement('span');
    this.label.className = 'gauge-label';
    this.label.textContent = 'GROWTH';
    this.readout = document.createElement('span');
    this.readout.className = 'gauge-readout';
    this.readout.textContent = '0%';
    meta.appendChild(this.label);
    meta.appendChild(this.readout);

    this.rail = document.createElement('div');
    this.rail.className = 'gauge-rail';
    this.fill = document.createElement('div');
    this.fill.className = 'fill';
    this.rail.appendChild(this.fill);

    // Calibration ticks drawn over the rail (sibling so the rail's overflow
    // clip only affects the fill).
    const ticks = document.createElement('div');
    ticks.className = 'gauge-ticks';

    this.root.appendChild(meta);
    this.root.appendChild(this.rail);
    this.root.appendChild(ticks);

    this.value = 0;
  }

  setValue(v) {
    v = Math.max(0, Math.min(1, v));
    this.value = v;
    this.fill.style.width = `${v * 100}%`;
    this.readout.textContent = `${Math.round(v * 100)}%`;
  }
}
