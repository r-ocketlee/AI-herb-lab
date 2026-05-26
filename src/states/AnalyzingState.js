// 2. 사용자 분석 — full-bleed webcam with overlaid particle field and a
// status label. Holds for `analyzingMs` then advances to SeedPlantState.

import { BaseState } from './BaseState.js';
import { WebcamFeed } from '../ui/WebcamFeed.js';
import { ParticleEffect } from '../ui/ParticleEffect.js';

export class AnalyzingState extends BaseState {
  constructor() {
    super('analyzing');
  }

  async enter(ctx) {
    await super.enter(ctx);
    Object.assign(this.root.style, { background: '#ffffff' });

    // CRITICAL: arm the advance timer BEFORE any other await.
    // Previously `await webcamFeed.attach()` could hang on video.play() when
    // the cloned MediaStream stalled, which left the timer never armed and
    // the state stuck (is-active class also never added → invisible white).
    const ms = ctx.config.timings.analyzingMs;
    console.log(`[Analyzing] armed advance in ${ms}ms`);
    this.after(ms, () => {
      console.log('[Analyzing] timer fired → seedPlant');
      this.machine.transition('seedPlant');
    });

    this.webcamFeed = new WebcamFeed(ctx.webcam, { mode: 'fullscreen' });
    this.root.appendChild(this.webcamFeed.root);
    // Fire-and-forget; attach() handles its own errors and updates the
    // placeholder via the 'playing' event when frames flow.
    this.webcamFeed.attach();

    this.particles = new ParticleEffect({ count: 280 });
    this.root.appendChild(this.particles.root);
    this.particles.start();

    // Plain white text — no background. Heavy shadow keeps it readable on
    // both a bright placeholder and a real camera feed of varying brightness.
    const label = document.createElement('div');
    Object.assign(label.style, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
      color: '#ffffff',
      fontSize: '24px',
      fontWeight: '600',
      letterSpacing: '-0.02em',
      textShadow: '0 2px 16px rgba(0,0,0,0.55), 0 0 36px rgba(0,0,0,0.35)',
      zIndex: '20',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
    });
    label.textContent = '사용자를 분석중입니다';
    this.root.appendChild(label);
  }

  async exit() {
    this.particles?.stop();
    this.webcamFeed?.detach();
    await super.exit();
  }
}
