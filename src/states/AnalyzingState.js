// 2. 사용자 분석 — starts as a full-bleed live webcam view, then dissolves
// into a circular pixel grid (PixelGridDissolve). The grid materializes
// from the outer rim inward, holds (photo opportunity), then each cell
// migrates one-by-one to the center; the background blackens; the screen
// ends on pure black just as we advance to SeedPlantState.
//
// Phases (mirrored from PixelGridDissolve internals; total = analyzingMs):
//   • IDLE   — webcam is clean. Centered label morphs in.
//   • IRIS   — circular pixel grid fills in from the edge.
//   • HOLD   — photo window; visitor moves, dots react.
//   • DRAIN  — pixels gather to center. Label morphs OUT here, and the
//              background overlay accelerates toward fully black.
//   • BLACK  — final pure black.
//
// Centered label (visible IDLE → HOLD, morphs out at DRAIN start):
//   "AI Herb가 당신의 생활패턴과 취향을 학습하고 있습니다"

import { BaseState } from './BaseState.js';
import { WebcamFeed } from '../ui/WebcamFeed.js';
import { PixelGridDissolve } from '../ui/PixelGridDissolve.js';
import { RevealText } from '../ui/RevealText.js';
import { captureAndUpload } from '../core/photo.js';

const LABEL_TEXT = 'AI Herb가 당신의 생활패턴과 취향을 학습하고 있습니다';
const CAPTURE_TEXT = '씨앗이 당신의 모습을 기록합니다<br>잠시 정면을 바라봐 주세요';

// Must match PixelGridDissolve's T_DRAIN_START. Once progress crosses
// this, pixels begin migrating to the center — and the label morphs out
// in sync.
const DRAIN_AT = 0.65;

export class AnalyzingState extends BaseState {
  constructor() {
    super('analyzing');
  }

  async enter(ctx) {
    await super.enter(ctx);
    this.pauseTrackers(); // passive scan animation — no hand/presence input needed
    Object.assign(this.root.style, { background: '#000000' });

    // Scan cue — plays from the top the moment the analysis screen opens.
    // Preloaded at boot via config.sounds; restart:true (default) guarantees
    // it starts from the beginning each time this state is entered.
    ctx.audio?.play('scan');

    // CRITICAL (preserved from earlier revisions): arm the advance timer
    // BEFORE anything that could await. Keeps the kiosk unstuck even if
    // a downstream init fails.
    const totalMs = ctx.config.timings.analyzingMs;
    console.log(`[Analyzing] armed advance in ${totalMs}ms`);
    this.after(totalMs, () => {
      console.log('[Analyzing] timer fired → seedPlant');
      this.advanceOrIdle(ctx, 'seedPlant'); // [1] release to Idle if nobody's here
    });

    // [8] Preload the next stages' videos (seed-planting + both bloom clips for
    // this appliance) during the 18s analysis, so SeedPlant/Bloom start without
    // a buffering hitch. Hidden 1px <video> elements warm the browser cache.
    const appliance = ctx.config.getAppliance(ctx.session.applianceId);
    const flower = ctx.config.resolveFlower(ctx.session.applianceId, ctx.session.flowerKey);
    const preloadSrcs = [appliance?.seedVideo, flower?.bloomVideo].filter(Boolean);
    for (const src of preloadSrcs) {
      const v = document.createElement('video');
      v.src = src;
      v.muted = true;
      v.preload = 'auto';
      Object.assign(v.style, { position: 'absolute', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none' });
      this.root.appendChild(v);
      try { v.load(); } catch (e) { /* ignore */ }
    }

    // ---- Layer 1 — fullscreen live webcam (bottom) ---------------------
    this.webcamFeed = new WebcamFeed(ctx.webcam, { mode: 'fullscreen' });
    this.root.appendChild(this.webcamFeed.root);
    this.webcamFeed.attach();

    // ---- Layer 2 — pixel grid dissolve --------------------------------
    this.dissolve = new PixelGridDissolve(ctx.webcam.video, {
      gridCols: 72,        // perf: 72×72 (~5.2k dots) vs old 100×100 (10k) — about half the
      gridRows: 72,        // per-frame draw cost; with batched glow this is what kills the stutter
      gapRatio: 0.5,       // bumped from 0.32 so dots stay ~the same size despite the larger cells
      mirror: true,        // match WebcamFeed's CSS scaleX(-1) AND objectFit: cover
      borderOpacity: 0,
    });
    this.dissolve.root.style.zIndex = '10';
    this.root.appendChild(this.dissolve.root);
    this.dissolve.start();

    // ---- Centered status label (morphing) -----------------------------
    const labelContainer = document.createElement('div');
    Object.assign(labelContainer.style, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
      color: '#ffffff',
      fontSize: 'var(--type-title-size)',
      fontWeight: 'var(--type-title-weight)',
      letterSpacing: 'var(--type-title-ls)',
      lineHeight: 'var(--type-title-lh)',
      textShadow:
        '0 2px 24px rgba(0, 0, 0, 0.55), 0 0 48px rgba(0, 0, 0, 0.4)',
      zIndex: '20',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
      textAlign: 'center',
    });
    this.root.appendChild(labelContainer);

    this.labelMorph = new RevealText({ morphMs: 1800 });
    labelContainer.appendChild(this.labelMorph.root);
    this.labelMorph.setInitial('');
    requestAnimationFrame(() => this.labelMorph.morphTo(LABEL_TEXT));
    this._disposers.push(() => this.labelMorph?.stop());

    // ---- Portrait capture (photo window) ------------------------------
    // During HOLD: a brief notice + 3·2·1 count, then one clean webcam frame is
    // grabbed and uploaded to the cert backend (best-effort). The returned id
    // rides the QR (CardState appends &id=…). Any failure → no photo, and the
    // certificate just shows an empty portrait slot — never blocks the flow.
    const captureUrl = ctx.config.data.photoUpload && ctx.config.data.photoUpload.url;
    const cap = document.createElement('div');
    cap.className = 'analyze-capture';
    cap.innerHTML = '<div class="analyze-capture__num"></div><p class="analyze-capture__text">' + CAPTURE_TEXT + '</p>';
    this.root.appendChild(cap);
    const capNum = cap.querySelector('.analyze-capture__num');
    const flash = document.createElement('div');
    flash.className = 'analyze-flash';
    this.root.appendChild(flash);

    this.after(Math.round(totalMs * 0.28), () => {
      cap.classList.add('is-on');
      let n = 3;
      capNum.textContent = String(n);
      const step = () => {
        n -= 1;
        if (n >= 1) { capNum.textContent = String(n); this.after(1000, step); return; }
        capNum.textContent = '';
        flash.classList.add('is-on');               // brief shutter flash
        this.after(420, () => flash.classList.remove('is-on'));
        this._capturePortrait(ctx, captureUrl);
        this.after(1300, () => cap.classList.remove('is-on'));
      };
      this.after(1000, step);
    });

    // ---- Single RAF loop that drives both the dissolve progress and
    //      the label morph-out ------------------------------------------
    const startTime = performance.now();
    let labelMorphedOut = false;
    this.loop(() => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(1, elapsed / totalMs);
      this.dissolve.setProgress(t);

      // The moment the pixels start gathering to the center, the label
      // morphs away (blob dissolve, ~1200 ms). After this point the
      // composition is purely visual — pixels heading inward, background
      // darkening — until the final black beat.
      if (!labelMorphedOut && t >= DRAIN_AT) {
        this.labelMorph.morphTo('', 1200);
        labelMorphedOut = true;
      }
    });
  }

  // Grab + upload one webcam frame; on success stash the id in the session so
  // CardState's QR carries it. Fully best-effort (no url / failure → no photo).
  _capturePortrait(ctx, url) {
    if (!url) { console.log('[Analyzing] no photoUpload.url → portrait skipped'); return; }
    const sess = ctx.session; // bind to THIS visitor's session
    captureAndUpload(ctx.webcam && ctx.webcam.video, url)
      .then((id) => {
        // Only assign if the same session is still active — a slow upload must
        // never write one visitor's photo onto the next visitor's QR.
        if (id && ctx.session === sess) { sess.photoId = id; console.log('[Analyzing] portrait uploaded id=' + id); }
        else if (!id) console.log('[Analyzing] portrait upload failed → no photo (fallback)');
      })
      .catch(() => {});
  }

  async exit() {
    // The state machine cross-fades through the bare #stage between
    // states. This state ends on pure black and SeedPlant opens on black,
    // so paint the stage black for the hand-off — SeedPlantState restores
    // it on its own exit.
    const stage = document.getElementById('stage');
    if (stage) stage.style.background = '#000000';

    // Cut the scan cue so it doesn't bleed into SeedPlant.
    this.ctx?.audio?.stop('scan');

    this.dissolve?.dispose();
    this.dissolve = null;
    this.webcamFeed?.detach();
    await super.exit();
  }
}
