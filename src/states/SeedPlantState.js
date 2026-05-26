// 3. 씨앗 심기 — plays the appliance-specific seed video full-bleed, then
// advances to BloomState when 'ended' fires (or if the asset is missing,
// after a short fallback timeout so the kiosk never sticks).

import { BaseState } from './BaseState.js';

export class SeedPlantState extends BaseState {
  constructor() {
    super('seedPlant');
  }

  async enter(ctx) {
    await super.enter(ctx);
    const appliance = ctx.config.getAppliance(ctx.session.applianceId);
    Object.assign(this.root.style, { background: '#ffffff' });

    // Append video FIRST (sits at the bottom of the stack). Placeholder goes
    // on top — opaque white, so the empty black <video> doesn't leak through
    // while no real asset is loaded. It fades out once playback truly starts.
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

    const placeholder = document.createElement('div');
    Object.assign(placeholder.style, {
      position: 'absolute',
      inset: '0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      gap: '24px',
      background: '#ffffff',
      color: '#2a1f3a',
      textAlign: 'center',
      pointerEvents: 'none',
      transition: 'opacity 400ms ease',
      zIndex: '5',
      opacity: '1',
      boxShadow: 'inset 0 0 0 6px #EAA0FF',
    });
    placeholder.innerHTML = `
      <div style="font-size:13px;letter-spacing:0.4em;color:#EAA0FF;font-weight:600">— PLACEHOLDER —</div>
      <div style="font-size:48px;font-weight:600;letter-spacing:-0.02em;color:#2a1f3a">씨앗 심기 영상</div>
      <div style="font-size:18px;color:#6b5e80;font-weight:400">${appliance?.name ?? '가전'}</div>
      <div style="font-size:14px;color:#6b5e80;font-weight:400;opacity:0.75">${appliance?.model ?? ''}</div>
    `;
    this.root.appendChild(placeholder);
    this.placeholder = placeholder;

    let advanced = false;
    const advance = () => {
      if (advanced) return;
      advanced = true;
      console.log('[SeedPlant] advancing → bloom');
      this.machine.transition('bloom');
    };

    // Let the video play to its natural end — no forced cutoff. A long
    // safety net (60s) only catches a fully-stalled asset; the normal exit
    // path is the 'ended' event.
    console.log('[SeedPlant] waiting for video ended (60s safety net)');
    this.after(60000, () => {
      console.warn('[SeedPlant] safety net fired (video never ended)');
      advance();
    });

    video.addEventListener('playing', () => {
      placeholder.style.opacity = '0';
    }, { once: true });
    video.addEventListener('ended', advance, { once: true });
    video.addEventListener('error', () => {
      console.warn('[SeedPlant] video error — advancing in 3s');
      this.after(3000, advance);
    });

    // Fire-and-forget — don't let a slow/stalled play() block enter().
    video.play().catch((err) => {
      console.warn('[SeedPlant] play() rejected, keeping placeholder', err);
    });
  }

  async exit() {
    this.video?.pause();
    await super.exit();
  }
}
