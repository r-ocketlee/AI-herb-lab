// 3. 씨앗 심기 — plays the appliance-specific seed video full-bleed, then
// advances to BloomState when 'ended' fires (or if the asset is missing,
// after a short fallback timeout so the kiosk never sticks).

import { BaseState } from './BaseState.js';
import { RevealText } from '../ui/RevealText.js';

const GUIDE_TEXT = 'AI Herb를 가전에 심는 중입니다';

export class SeedPlantState extends BaseState {
  constructor() {
    super('seedPlant');
  }

  async enter(ctx) {
    await super.enter(ctx);
    this.pauseTrackers(); // passive seed-planting video — no hand/presence input needed
    const appliance = ctx.config.getAppliance(ctx.session.applianceId);
    // Black, not white — AnalyzingState ends on pure black, and this state
    // opens with a video on a black backdrop. Keeping every layer black
    // makes the analyzing → seedPlant hand-off read as one continuous
    // dark beat instead of flashing bright in between.
    Object.assign(this.root.style, { background: '#000000' });

    // Seed-planting cue — plays from the top the moment this part begins.
    ctx.audio?.play('seed');

    const video = document.createElement('video');
    Object.assign(video.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      background: '#000',
    });
    video.muted = true; // autoplay policy
    video.playsInline = true;
    video.preload = 'auto';
    video.src = appliance?.seedVideo ?? '';
    this.root.appendChild(video);
    this.video = video;

    // Top guide morphs in while the seed-planting video plays underneath.
    // Same .guide-top / RevealText pattern as SeedSelect / Bloom / Card
    // for a consistent voice.
    const guideEl = document.createElement('p');
    guideEl.className = 'guide-top';
    guideEl.style.zIndex = '20'; // sit above the video
    // White text over the dark video — invert .guide-top's defaults.
    guideEl.style.color = '#ffffff';
    guideEl.style.textShadow = '0 2px 24px rgba(0, 0, 0, 0.55), 0 0 36px rgba(0, 0, 0, 0.35)';
    this.root.appendChild(guideEl);
    this.guideMorph = new RevealText({ mode: 'fade' });
    guideEl.appendChild(this.guideMorph.root);
    this.guideMorph.setInitial('');
    requestAnimationFrame(() => this.guideMorph.morphTo(GUIDE_TEXT));
    this._disposers.push(() => this.guideMorph?.stop());

    let advanced = false;
    const advance = () => {
      if (advanced) return;
      advanced = true;
      console.log('[SeedPlant] advancing → bloom');
      this.advanceOrIdle(ctx, 'bloom'); // [1] release to Idle if nobody's here
    };

    // Let the video play to its natural end — no forced cutoff. A long
    // safety net (60s) only catches a fully-stalled asset; the normal exit
    // path is the 'ended' event.
    console.log('[SeedPlant] waiting for video ended (60s safety net)');
    this.after(60000, () => {
      console.warn('[SeedPlant] safety net fired (video never ended)');
      advance();
    });

    video.addEventListener('ended', advance, { once: true });
    // Duration-based fallback — some HEVC clips never fire 'ended'; advance
    // shortly after the clip's own length so we never hang on the 60s net.
    video.addEventListener('loadedmetadata', () => {
      const d = video.duration;
      if (isFinite(d) && d > 0) this.after(d * 1000 + 1500, advance);
    }, { once: true });
    video.addEventListener('error', () => {
      console.warn('[SeedPlant] video error — advancing in 3s');
      this.after(3000, advance);
    });

    // Fire-and-forget — don't let a slow/stalled play() block enter().
    video.play().catch((err) => {
      console.warn('[SeedPlant] play() rejected', err);
    });
  }

  async exit() {
    // Restore the stage background AnalyzingState painted black for the
    // dark hand-off — Bloom and everything after run on light roots again.
    const stage = document.getElementById('stage');
    if (stage) stage.style.background = '';

    // Cut the seed cue so it doesn't bleed into Bloom (which starts its own).
    this.ctx?.audio?.stop('seed');

    // Grow cue — fires the instant the "…심는 중입니다" guide starts clearing,
    // bridging the seed→bloom transition. Stopped again in BloomState.exit so
    // it doesn't carry into the ending.
    this.ctx?.audio?.play('grow');

    this.video?.pause();
    await this.morphOutGuide();
    await super.exit();
  }
}
