// 0. 대기 — welcome screen. Waits for PoseTracker to report a shoulder width
// over the entry threshold, holds it for `idleEntryDwellMs` to avoid spurious
// triggers, then advances to SeedSelect.

import { BaseState } from './BaseState.js';

export class IdleState extends BaseState {
  constructor() {
    super('idle');
  }

  async enter(ctx) {
    await super.enter(ctx);
    ctx.resetSession();

    this.root.innerHTML = `
      <div class="idle-inner" style="display:flex;flex-direction:column;align-items:center;gap:64px;">
        <h1 class="headline">Smart Herb AI Lab에 오신 것을 환영합니다</h1>
        <p class="subhead">가까이 다가오시면 시작됩니다</p>
      </div>
    `;
    Object.assign(this.root.style, {
      flexDirection: 'column',
      background: '#ffffff',
    });

    const { detection, timings } = ctx.config;
    let presentSince = 0;

    this.observeTracker(ctx.poseTracker, (s) => {
      const overThreshold = s.present && s.shoulderWidth >= detection.shoulderWidthEnterThreshold;
      if (overThreshold) {
        if (presentSince === 0) presentSince = performance.now();
        const held = performance.now() - presentSince;
        if (held >= timings.idleEntryDwellMs) {
          presentSince = 0;
          this.machine.transition('seedSelect');
        }
      } else {
        presentSince = 0;
      }
    });
  }
}
