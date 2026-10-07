// InstrumentRing — a delicate, lab-instrument frame that wraps a circular UI
// element (the webcam bubble, the seed's dwell gauge) with hairline rings, a
// calibration tick-ring, corner viewfinder brackets, an optional center
// crosshair, and an optional radial progress gauge. Purely decorative
// (pointer-events none).
//
// The progress gauge can be SEGMENTED (segments: N): N thick, round-capped
// arc chunks with gaps between them. Each chunk fills in turn as setProgress
// climbs, so "another chunk filled" reads as a discrete step (e.g. a second).
//
// Usage:
//   const ring = new InstrumentRing({ variant: 'seeddwell', progress: true, segments: 5 });
//   ring.setProgress(0.6);            // fills 3 of 5 chunks
//   ring.setProgressColor('rgb(...)');

// Segmented-gauge geometry (in pathLength=100 units; the circle is normalised
// so one full turn = 100).
// Match the original (continuous) gauge exactly — faint 1px track + 1.4px fill,
// just split into chunks with a very small gap.
const SEG_TRACK_STROKE = 1;
const SEG_FILL_STROKE = 1.4;
const SEG_ON = 18;       // dash on-length per segment (of a 20-unit slot) → tiny gaps

function buildSvg(o) {
  let s =
    '<svg class="instrument-ring__svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">';
  if (o.rings) {
    s += '<circle cx="50" cy="50" r="44" fill="none" stroke="var(--data-faint)" stroke-width="0.4"/>';
  }
  if (o.tickRing) {
    s += '<circle cx="50" cy="50" r="48" fill="none" stroke="var(--data-soft)" stroke-width="0.5" stroke-dasharray="0.7 4.2" opacity="0.6"/>';
    s += '<g stroke="var(--data-soft)" stroke-width="0.7" fill="none"><path d="M50 0 V4"/><path d="M100 50 H96"/><path d="M50 100 V96"/><path d="M0 50 H4"/></g>';
  }
  if (o.progress) {
    if (o.segments > 1) {
      const slot = 100 / o.segments;
      // Faint segmented track — one circle whose repeating dash makes N chunks.
      s += `<circle cx="50" cy="50" r="46" fill="none" stroke="var(--data-faint)" stroke-width="${SEG_TRACK_STROKE}" opacity="0.5" stroke-linecap="round" transform="rotate(-90 50 50)" pathLength="100" stroke-dasharray="${SEG_ON} ${slot - SEG_ON}"/>`;
      // One fill circle per chunk — its dash length is driven by setProgress.
      for (let i = 0; i < o.segments; i++) {
        s += `<circle class="instrument-ring__seg" cx="50" cy="50" r="46" fill="none" stroke="var(--lavender-200)" stroke-width="${SEG_FILL_STROKE}" stroke-linecap="round" transform="rotate(-90 50 50)" pathLength="100" stroke-dasharray="0 100" stroke-dashoffset="${(-(i * slot)).toFixed(2)}" style="opacity:0"/>`;
      }
    } else {
      s += '<circle cx="50" cy="50" r="46" fill="none" stroke="var(--data-faint)" stroke-width="1" opacity="0.5"/>';
      s += '<circle class="instrument-ring__progress" cx="50" cy="50" r="46" fill="none" stroke="var(--lavender-200)" stroke-width="1.4" stroke-linecap="round" transform="rotate(-90 50 50)" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>';
    }
  }
  if (o.crosshair) {
    s += '<g stroke="var(--data-faint)" stroke-width="0.5" fill="none"><path d="M50 7 V19"/><path d="M50 81 V93"/><path d="M7 50 H19"/><path d="M81 50 H93"/></g>';
  }
  if (o.brackets) {
    s += '<g stroke="var(--data-faint)" stroke-width="0.5" fill="none"><path d="M3 13 V3 H13"/><path d="M97 13 V3 H87"/><path d="M3 87 V97 H13"/><path d="M97 87 V97 H87"/></g>';
  }
  s += '</svg>';
  return s;
}

export class InstrumentRing {
  constructor(opts = {}) {
    const o = {
      rings: true,
      tickRing: true,
      brackets: true,
      crosshair: false,
      progress: false,
      segments: 0,
      label: null,
      pulse: false,
      variant: '',
      ...opts,
    };

    this.root = document.createElement('div');
    this.root.className = 'instrument-ring' + (o.variant ? ` instrument-ring--${o.variant}` : '');
    this.root.setAttribute('aria-hidden', 'true');

    const label = o.label
      ? `<span class="instrument-ring__label">${o.pulse ? '<span class="lab-pulse"></span>' : ''}${o.label}</span>`
      : '';
    this.root.innerHTML = buildSvg(o) + label;

    this._arc = this.root.querySelector('.instrument-ring__progress');
    this._fillSegs = Array.from(this.root.querySelectorAll('.instrument-ring__seg'));
  }

  // Drive the radial gauge (only present when constructed with progress:true).
  // Segmented: fills chunk-by-chunk. Continuous: sweeps a single arc.
  setProgress(p) {
    p = Math.max(0, Math.min(1, p));
    if (this._fillSegs.length) {
      const n = this._fillSegs.length;
      for (let i = 0; i < n; i++) {
        const frac = Math.max(0, Math.min(1, p * n - i));
        const len = SEG_ON * frac;
        const el = this._fillSegs[i];
        if (len <= 0.03) {
          el.style.opacity = '0';
        } else {
          el.style.opacity = '1';
          el.style.strokeDasharray = `${len.toFixed(2)} 100`;
        }
      }
      return;
    }
    if (this._arc) this._arc.style.strokeDashoffset = String(100 * (1 - p));
  }

  // Tint the gauge fill (e.g. to match the engaged appliance's color).
  setProgressColor(color) {
    if (this._arc) this._arc.style.stroke = color;
    for (const el of this._fillSegs) el.style.stroke = color;
  }
}
