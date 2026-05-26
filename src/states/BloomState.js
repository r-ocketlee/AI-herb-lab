// 4. 꽃 개화 — hand-as-joystick bloom interaction.
//
// Hand UP    (wristY < UP_ZONE)    → video plays forward at native 1×
// Hand DOWN  (wristY > DOWN_ZONE)  → video rewinds at 1× (currentTime decrement)
// Hand MID   (between zones)       → pause on current frame
//
// HTML5 <video> doesn't support negative playbackRate, so reverse is done
// manually by stepping currentTime backward each frame. This isn't as smooth
// as forward playback (each seek decodes from the nearest keyframe), but it
// matches the spec and gives the visitor the feeling of "undoing" the bloom.
//
// Bottom gauge mirrors actual video progress — goes up when forward, down
// when reverse. Once progress reaches ≥ 99.5%, lock; hand input stops
// mattering, the video plays its tail at native speed, transition on `ended`.

import { BaseState } from './BaseState.js';
import { WebcamFeed } from '../ui/WebcamFeed.js';
import { Gauge } from '../ui/Gauge.js';

// wristY: 0 = top of frame, 1 = bottom of frame.
const UP_ZONE = 0.4;     // wrist higher than this → forward
const DOWN_ZONE = 0.6;   // wrist lower  than this → reverse
// Between 0.4 and 0.6 → dead zone, video holds still.

const IDLE_SAFETY_MS = 90000;

export class BloomState extends BaseState {
  constructor() {
    super('bloom');
  }

  async enter(ctx) {
    await super.enter(ctx);
    const appliance = ctx.config.getAppliance(ctx.session.applianceId);
    const flower = ctx.config.resolveFlower(ctx.session.applianceId, ctx.session.flowerKey);
    Object.assign(this.root.style, { background: '#ffffff' });

    this.root.innerHTML = `
      <p class="guide-top">손을 하단에서 상단으로 천천히 올려보세요</p>
    `;

    this.video = document.createElement('video');
    Object.assign(this.video.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      background: '#ffffff',
    });
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.preload = 'auto';
    this.video.src = flower?.bloomVideo ?? '';
    this.root.appendChild(this.video);

    // No more white placeholder — the user should see the video's first frame
    // while the gauge/webcam sit on top. We force a tiny seek as soon as
    // metadata loads so the browser actually decodes and paints frame 0;
    // otherwise <video> can stay black until play() is called.
    this.video.addEventListener('loadedmetadata', () => {
      try { this.video.currentTime = 0.001; } catch (e) { /* ignore */ }
    }, { once: true });

    // Asset-missing fallback — only shows if the source actually errors.
    // Far less intrusive than the previous always-on placeholder.
    const errorOverlay = document.createElement('div');
    Object.assign(errorOverlay.style, {
      position: 'absolute',
      inset: '0',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      gap: '12px',
      background: '#ffffff',
      color: '#6b5e80',
      textAlign: 'center',
      pointerEvents: 'none',
      zIndex: '5',
    });
    errorOverlay.innerHTML = `
      <div style="font-size:13px;letter-spacing:0.4em;color:#EAA0FF;font-weight:600">— PLACEHOLDER —</div>
      <div style="font-size:36px;font-weight:600;color:#2a1f3a">개화 영상 없음</div>
      <div style="font-size:16px">${appliance?.name ?? '가전'} · 꽃 ${ctx.session.flowerKey ?? '?'}</div>
      <div style="font-size:13px;opacity:0.75">${appliance?.model ?? ''}</div>
    `;
    this.video.addEventListener('error', () => {
      errorOverlay.style.display = 'flex';
    });
    this.root.appendChild(errorOverlay);

    this.webcamFeed = new WebcamFeed(ctx.webcam, { mode: 'bubble' });
    this.root.appendChild(this.webcamFeed.root);
    this.webcamFeed.attach();

    this.gauge = new Gauge();
    this.root.appendChild(this.gauge.root);

    let advanced = false;
    const advance = () => {
      if (advanced) return;
      advanced = true;
      console.log('[Bloom] advancing → card');
      this.machine.transition('card');
    };

    // Wait for metadata (need duration). Hard cap at 4s.
    await new Promise((resolve) => {
      let done = false;
      const ok = () => { if (!done) { done = true; resolve(); } };
      this.video.addEventListener('loadedmetadata', ok, { once: true });
      this.video.addEventListener('error', ok, { once: true });
      setTimeout(ok, 4000);
    });
    const duration = Number.isFinite(this.video.duration) ? this.video.duration : 5;

    // Direction commanded by hand position. -1 reverse, 0 pause, 1 forward.
    let direction = 0;
    let locked = false;
    let lastFrameTs = performance.now();

    this.observeTracker(ctx.poseTracker, (s) => {
      if (locked || !s.present) {
        direction = 0;
        return;
      }
      if (s.wristY < UP_ZONE) direction = 1;
      else if (s.wristY > DOWN_ZONE) direction = -1;
      else direction = 0;
    });

    this.loop(() => {
      if (locked) return;

      const now = performance.now();
      const dt = Math.min(0.1, (now - lastFrameTs) / 1000);
      lastFrameTs = now;

      if (direction === 1) {
        if (this.video.paused) this.video.play().catch(() => {});
      } else {
        if (!this.video.paused) this.video.pause();
        if (direction === -1) {
          // Manual reverse at ~1× rate via currentTime decrement.
          this.video.currentTime = Math.max(0, this.video.currentTime - dt);
        }
      }

      const progress = this.video.currentTime / duration;
      this.gauge.setValue(Math.max(0, Math.min(1, progress)));

      if (progress >= 0.995) {
        locked = true;
        console.log('[Bloom] locked → playing to end');
        if (this.video.paused) this.video.play().catch(() => {});
        this.video.addEventListener('ended', advance, { once: true });
        this.after(3500, advance);
      }
    });

    // Idle safety — kiosk never sticks even if no one interacts.
    this.after(IDLE_SAFETY_MS, () => {
      console.warn('[Bloom] idle safety net fired');
      advance();
    });
  }

  async exit() {
    this.webcamFeed?.detach();
    await super.exit();
  }
}
