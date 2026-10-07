// LabFrame — a single global instrumentation overlay that sits on top of every
// state and gives the whole experience a "warm bio-cultivation lab" reading
// without touching any individual state.
//
// It is purely decorative (pointer-events: none) and lives above state content
// but below the hand cursor, so it layers a faint measurement texture over
// whatever screen is active:
//   - a whisper-faint blueprint grid + film grain   ("measurement plane")
//   - four L-shaped corner marks with monospace labels (viewfinder / readout)
//   - vertical calibration ticks on both edges       (precision instrument)
//   - a session timer + a phase label that the state machine drives
//
// Mounted once from main.js; the state machine calls setPhase(name) on each
// transition (parallel to dev.setState).

// Per-state readout: a friendly phase number (out of the 6 canonical steps the
// visitor walks through) plus a short lab-flavoured label. Intro/introFinale
// are onboarding, grouped as BRIEFING; idle is STANDBY (phase 0).
const PHASES = {
  idle:        { n: 0, label: 'STANDBY' },
  welcomeGate: { n: 0, label: 'WELCOME' },
  intro:       { n: 1, label: 'BRIEFING' },
  introFinale: { n: 1, label: 'BRIEFING' },
  seedSelect:  { n: 2, label: 'SELECT' },
  analyzing:   { n: 3, label: 'ANALYSIS' },
  seedPlant:   { n: 4, label: 'CULTIVATE' },
  bloom:       { n: 5, label: 'BLOOM' },
  card:        { n: 6, label: 'SPECIMEN' },
};

// Inline SVG film grain — low-alpha turbulence tiled over the whole frame so
// the white background reads as paper/sensor surface rather than flat #fff.
const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`;

export class LabFrame {
  constructor() {
    this.root = null;
    this.timerEl = null;
    this.phaseEl = null;
    this.sessionStart = this._now();
    this._timerId = null;
  }

  // Date.now is fine in the browser runtime (the no-Date rule only applies to
  // workflow scripts). Wrapped so the source of truth is in one place.
  _now() {
    return Date.now();
  }

  mount() {
    const el = document.createElement('div');
    el.className = 'lab-frame';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = `
      <div class="lab-grain"></div>

      <div class="lab-ticks lab-ticks--left">${this._ticks()}</div>
      <div class="lab-ticks lab-ticks--right">${this._ticks()}</div>

      <div class="lab-corner lab-corner--tl">
        <span class="lab-corner__mark"></span>
        <span class="lab-corner__label">AI HERB LAB · 01</span>
      </div>
      <div class="lab-corner lab-corner--tr">
        <span class="lab-corner__label"><span class="lab-pulse"></span>SESSION&nbsp;&nbsp;ACTIVE</span>
        <span class="lab-corner__mark"></span>
      </div>
      <div class="lab-corner lab-corner--bl">
        <span class="lab-corner__mark"></span>
        <span class="lab-corner__label lab-timer">T+ 00:00</span>
      </div>
      <div class="lab-corner lab-corner--br">
        <span class="lab-corner__label lab-phase">STANDBY</span>
        <span class="lab-corner__mark"></span>
      </div>
    `;
    el.querySelector('.lab-grain').style.backgroundImage = GRAIN;
    document.body.appendChild(el);

    this.root = el;
    this.timerEl = el.querySelector('.lab-timer');
    this.phaseEl = el.querySelector('.lab-phase');

    this._timerId = setInterval(() => this._tickTimer(), 1000);
  }

  // Ten short tick marks per edge; every fifth one is longer (a major
  // graduation), like a ruler / calibration scale.
  _ticks() {
    let html = '';
    for (let i = 0; i < 11; i++) {
      const major = i % 5 === 0;
      html += `<span class="lab-tick${major ? ' lab-tick--major' : ''}"></span>`;
    }
    return html;
  }

  setPhase(name) {
    const phase = PHASES[name] ?? { n: 0, label: name?.toUpperCase?.() ?? '—' };
    // Returning to idle = a fresh visitor; reset the session timer so it reads
    // as per-person elapsed time.
    if (phase.n === 0) this.sessionStart = this._now();
    if (this.phaseEl) {
      this.phaseEl.textContent =
        phase.n === 0 ? phase.label : `PHASE ${phase.n}/6 · ${phase.label}`;
    }
    this._tickTimer();
  }

  _tickTimer() {
    if (!this.timerEl) return;
    const s = Math.floor((this._now() - this.sessionStart) / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    this.timerEl.textContent = `T+ ${mm}:${ss}`;
  }

  // [7] Visitor screens hide the lab HUD entirely (minimal white gallery); dev
  // mode toggles it back on alongside the dev overlay. Decorative only.
  setVisible(v) {
    if (this.root) this.root.style.display = v ? '' : 'none';
  }

  destroy() {
    if (this._timerId) clearInterval(this._timerId);
    this.root?.remove();
    this.root = null;
  }
}
