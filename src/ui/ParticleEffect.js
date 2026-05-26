// ParticleEffect — luminous lavender particle field used during AnalyzingState.
//
// Visual recipe:
//   • Each particle is rendered as a pre-baked radial glow stamp (white core
//     fading into transparent lavender). Stamping a single canvas texture
//     for every particle is ~50× faster than building a fresh radial
//     gradient each frame.
//   • The overall composite uses 'lighter' (additive) blending so overlapping
//     particles brighten — like fireflies converging. Pops against the
//     webcam feed (a person's face/body is naturally darker than pure white).
//   • A global "gather" coefficient pulses with a slow sine wave: particles
//     collapse toward the center, then disperse to their orbital radius.
//     gives the "분석 중" loop a clear breath/heartbeat.

const GLOW_STAMP_PX = 96;

export class ParticleEffect {
  constructor({ count = 240 } = {}) {
    this.root = document.createElement('canvas');
    Object.assign(this.root.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      mixBlendMode: 'lighter', // additive — overlaps brighten
    });
    this.ctx = this.root.getContext('2d');
    this.count = count;
    this.particles = [];
    this.running = false;
    this._rafId = 0;
    this._resize = () => this._fit();
    this._stamp = this._buildStamp();
  }

  // Pre-render a soft glow stamp once. Used as a drawImage source for every
  // particle every frame — avoids per-particle gradient construction cost.
  _buildStamp() {
    const c = document.createElement('canvas');
    c.width = GLOW_STAMP_PX;
    c.height = GLOW_STAMP_PX;
    const g = c.getContext('2d');
    const r = GLOW_STAMP_PX / 2;
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.25, 'rgba(248, 230, 255, 0.85)');
    grad.addColorStop(0.55, 'rgba(234, 160, 255, 0.45)');
    grad.addColorStop(1.0, 'rgba(234, 160, 255, 0.0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, GLOW_STAMP_PX, GLOW_STAMP_PX);
    return c;
  }

  _fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.root.width = window.innerWidth * dpr;
    this.root.height = window.innerHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _seed() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const maxOrbit = Math.min(w, h) * 0.42;
    this.particles = Array.from({ length: this.count }, () => ({
      angle: Math.random() * Math.PI * 2,
      // Base orbit radius — each particle lives at a different "shell"
      radius: 40 + Math.random() * maxOrbit,
      // Angular velocity — slow drift, both directions.
      speed: (Math.random() - 0.5) * 0.004,
      // Glow stamp size at full disperse (px).
      size: 14 + Math.random() * 28,
      // Per-particle phase so they don't all gather/disperse in lockstep.
      phase: Math.random() * Math.PI * 2,
      // Slight brightness variance.
      bright: 0.55 + Math.random() * 0.45,
    }));
  }

  start() {
    if (this.running) return;
    this._fit();
    this._seed();
    window.addEventListener('resize', this._resize);
    this.running = true;
    const loop = (t) => {
      if (!this.running) return;
      this._draw(t);
      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._rafId);
    window.removeEventListener('resize', this._resize);
  }

  _draw(t) {
    const { ctx } = this;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const cx = w / 2;
    const cy = h / 2;
    ctx.clearRect(0, 0, w, h);

    // Global gather coefficient: 0 = particles at full disperse on their
    // orbital radius, 1 = particles collapsed near the center.
    // Period ~3.5 s with a smooth ease so the inhale/exhale is organic.
    const phase = t * 0.0009;
    const gather = (1 - Math.cos(phase)) * 0.5; // 0..1 smooth
    const collapse = 0.25 + 0.65 * gather; // particles at 25%..90% inward at peak

    for (const p of this.particles) {
      p.angle += p.speed;
      // Per-particle modulation — varies size with breath so they pulse
      // individually as well, not just in unison.
      const localBreath = 0.7 + 0.3 * Math.sin(t * 0.0014 + p.phase);
      const effectiveR = p.radius * (1 - collapse * 0.8);
      const x = cx + Math.cos(p.angle) * effectiveR;
      const y = cy + Math.sin(p.angle) * effectiveR;
      // Stamp larger as particles collapse → looks like they're brightening
      // as they converge, calming as they spread.
      const size = p.size * localBreath * (1 + gather * 0.4);
      ctx.globalAlpha = p.bright * (0.5 + 0.5 * gather);
      ctx.drawImage(this._stamp, x - size, y - size, size * 2, size * 2);
    }
    ctx.globalAlpha = 1;
  }
}
