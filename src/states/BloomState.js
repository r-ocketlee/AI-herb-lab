// 4. 꽃 개화 — hand-height drives the bloom.
//
// The visitor raises a hand; the higher it goes, the further the bloom video
// advances. Three body-relative target lines (waist / chest / above-head) in
// the mirror feed teach the gesture; passing each one locks the growth to that
// stage. Reaching the top line confirms the bloom and auto-plays the finale.
//
// Video control (CRITICAL): these are AI-generated long-GOP clips, so we NEVER
// seek backward or jump currentTime. The hand is a TRIGGER: crossing a body
// line unlocks the next segment, and the video PLAYS FORWARD at its NATIVE 1x
// rate toward that ceiling, then pauses — so the bloom always plays at full
// speed no matter how fast the hand rises. Lowering the hand holds the frame.
//
// Video phases (≈, shared by all 10 clips): 0–2 sprout · 2–5 bud · 5–8 bloom ·
// 8–12.3 finale. Hand drives 0–8s; 8→end is the auto finale.

import { BaseState } from './BaseState.js';
import { WebcamFeed } from '../ui/WebcamFeed.js';
import { RevealText } from '../ui/RevealText.js';
import { TutorialCard } from '../ui/TutorialCard.js';

const GUIDE_GROW = '손을 천천히 올려 AI Herb를 키워보세요';
const GUIDE_DONE = '이제 손을 내려도 괜찮습니다 꽃이 피어납니다';
const BLOOM_HINT = '두 손을 천천히 머리 끝까지 올려요'; // bottom hint during live interaction

const ACTIVE_END = 8;        // seconds of video that hand height drives (0→8)
const T_SPROUT = 2;          // band A (waist→chest) grows the video 0→2s
const HAND_SMOOTH = 0.18;    // wristY easing (anti-jitter)
const LINE_SMOOTH = 0.08;    // body-line easing
const PB_MIN = 0.5;
const PB_MAX = 2.6;          // max catch-up speed when the hand jumps up
const DRIFT_PER_SEC = 0.2;   // slow self-growth (video-sec/sec) when no hand — much slower than hand-driven
const NO_HAND_TIMEOUT_MS = 9000;  // no hand this long → auto-finish
const SHOWCASE_MS = 3500;    // hold on the finished bloom before → card
const IDLE_SAFETY_MS = 90000;
const DEMO_MS = 3200;

// Body-RELATIVE line positions (normalized y, 0 = top of frame). Scaled to the
// person's own size so anyone — child or adult, near or far — reaches the head
// line at full arm extension. The scale unit is the torso length (shoulder→hip)
// when visible, else estimated from shoulder width (∝ body size in frame).
//   chest = shoulders · hip = chest + torso · head = chest − 0.6·torso
// A fully-raised wrist reaches ≈ shoulder − ~1·torso, comfortably past head.
function bodyLines(raw, shoulderWidth) {
  if (!raw || raw.length < 13) return { hip: 0.78, chest: 0.5, head: 0.2 };
  const avg = (a, b, d) => {
    const ya = a?.y, yb = b?.y;
    if (ya == null && yb == null) return d;
    if (ya == null) return yb;
    if (yb == null) return ya;
    return (ya + yb) / 2;
  };
  const chest = avg(raw[11], raw[12], 0.5);            // shoulders
  const hipRaw = avg(raw[23], raw[24], null);          // hips (may be out of frame)
  const torso = (hipRaw != null && hipRaw > chest + 0.05)
    ? hipRaw - chest
    : Math.max(0.12, (shoulderWidth || 0.18) * 1.6);   // fallback scale
  const hip = chest + torso;
  // [3] 동작 범위 완화 — head line lowered (0.6→0.5·torso above shoulders) so a
  // comfortable arm raise reliably reaches "confirm" without over-extending.
  const head = Math.max(0.02, chest - torso * 0.5);
  return { hip, chest, head };
}

// Active (higher) wrist from raw landmarks → {x, y} or null.
function activeWrist(raw) {
  if (!raw) return null;
  const lw = raw[15], rw = raw[16];
  if (!lw && !rw) return null;
  if (!lw) return { x: rw.x, y: rw.y };
  if (!rw) return { x: lw.x, y: lw.y };
  return lw.y <= rw.y ? { x: lw.x, y: lw.y } : { x: rw.x, y: rw.y };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class BloomState extends BaseState {
  constructor() {
    super('bloom');
  }

  async enter(ctx) {
    await super.enter(ctx);
    // Bloom video — the clip for the variant chosen at selection, so the bloom
    // and the token card (same flower) always match.
    const flower = ctx.config.resolveFlower(ctx.session.applianceId, ctx.session.flowerKey);
    const bloomSrc = flower?.bloomVideo ?? '';
    Object.assign(this.root.style, { background: '#ffffff' });

    this.root.innerHTML = `<p class="guide-top"></p><p class="guide-bottom"></p>`;
    const guideEl = this.root.querySelector('.guide-top');
    this.guideMorph = new RevealText({ mode: 'fade' });
    guideEl.appendChild(this.guideMorph.root);
    this.guideMorph.setInitial('');
    this._disposers.push(() => this.guideMorph?.stop());

    // ---- Bloom video (full-bleed) -------------------------------------
    this.video = document.createElement('video');
    Object.assign(this.video.style, {
      position: 'absolute', inset: '0', width: '100%', height: '100%',
      objectFit: 'cover', background: '#ffffff',
    });
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.preload = 'auto';
    this.video.src = bloomSrc;
    this.root.appendChild(this.video);
    this.video.addEventListener('loadedmetadata', () => {
      try { this.video.currentTime = 0.001; } catch (e) { /* ignore */ }
    }, { once: true });

    // ---- Webcam bubble + 3 target lines + hand indicator ---------------
    this.webcamFeed = new WebcamFeed(ctx.webcam, { mode: 'bubble', poseTracker: ctx.poseTracker });
    this.root.appendChild(this.webcamFeed.root);
    this.webcamFeed.attach();
    const circle = this.webcamFeed.root.querySelector('.webcam-bubble');
    const linesLayer = document.createElement('div');
    linesLayer.className = 'bloom-lines';
    linesLayer.innerHTML =
      '<div class="bloom-line" data-k="hip"></div>' +
      '<div class="bloom-line" data-k="chest"></div>' +
      '<div class="bloom-line" data-k="head"></div>';
    circle.appendChild(linesLayer);
    const lineEl = {
      hip: linesLayer.querySelector('[data-k="hip"]'),
      chest: linesLayer.querySelector('[data-k="chest"]'),
      head: linesLayer.querySelector('[data-k="head"]'),
    };

    // ---- [3] Primary guide: vertical hand-height instrument on the LEFT edge.
    // Lab-HUD tone (thin lavender rail + calibration ticks + registration marks
    // + LGEIText labels), matching LabFrame/Gauge. Fill rises with the hand;
    // three target marks flag the growth stages. Center flower stays clear.
    const vbar = document.createElement('div');
    vbar.className = 'bloom-vbar';
    vbar.innerHTML =
      '<div class="bloom-vbar__label">GROWTH</div>' +
      '<div class="bloom-vbar__rail">' +
      '<div class="bloom-vbar__fill"></div>' +
      '<div class="bloom-vbar__ticks"></div>' +
      '<div class="bloom-vbar__mark" data-k="hip"></div>' +
      '<div class="bloom-vbar__mark" data-k="chest"></div>' +
      '<div class="bloom-vbar__mark" data-k="head"></div>' +
      '</div>' +
      '<div class="bloom-vbar__pct">0%</div>';
    this.root.appendChild(vbar);
    const vfill = vbar.querySelector('.bloom-vbar__fill');
    const vpct = vbar.querySelector('.bloom-vbar__pct');
    const vtick = {
      hip: vbar.querySelector('[data-k="hip"]'),
      chest: vbar.querySelector('[data-k="chest"]'),
      head: vbar.querySelector('[data-k="head"]'),
    };

    // Small translucent hand indicator floating over the main video.
    const handMain = document.createElement('div');
    handMain.className = 'bloom-hand-main';
    this.root.appendChild(handMain);

    // ---- Finale flare overlay (hidden until confirm) ------------------
    const flare = document.createElement('div');
    flare.className = 'bloom-flare';
    this.root.appendChild(flare);

    // Wait for the video to be ready before driving playback. Hard cap 4 s.
    await new Promise((resolve) => {
      let done = false;
      const ok = () => { if (!done) { done = true; resolve(); } };
      this.video.addEventListener('loadedmetadata', ok, { once: true });
      this.video.addEventListener('error', ok, { once: true });
      setTimeout(ok, 4000);
    });

    // ---- State ---------------------------------------------------------
    let pose = { present: false, raw: null };
    let smoothWristY = 1;
    let sm = { hip: 0.78, chest: 0.5, head: 0.2 };
    let targetTime = 0;
    let passed = { hip: false, chest: false, head: false };
    let confirmed = false;
    let advanced = false;
    let demoActive = true;
    let noHandMs = 0;
    let lastTs = performance.now();

    const advance = () => {
      if (advanced) return;
      advanced = true;
      this.machine.transition('card');
    };

    const confirm = () => {
      if (confirmed) return;
      confirmed = true;
      passed.head = true;
      lineEl.head.classList.add('passed');
      vtick.head.classList.add('on');
      handMain.style.opacity = '0';
      vbar.style.opacity = '0'; // guide done — clear the way for the finale flare
      this.guideMorph.morphTo(GUIDE_DONE);
      this.root.querySelector('.guide-bottom')?.classList.remove('is-on');
      // Hand-down cue — rides through CardState, faded out only on reset.
      ctx.audio?.play('handdown');
      flare.classList.add('is-on');
      this.webcamFeed.setHandIndicator(0, 0, false);
      // Finale: forward play 8→end at native speed.
      this.video.playbackRate = 1;
      this.video.play().catch(() => {});
      // Bloom is confirmed ("hand down" cue just played) — no more hand/pose
      // input is needed during the ~4s finale. Stop inference so the long-GOP
      // bloom video plays smoothly; trackers auto-restart on this state's exit.
      this.pauseTrackers();
      // Fallback: some HEVC clips never fire 'ended' (currentTime never quite
      // reaches duration), so the bloom freezes on its last frame until the 90s
      // safety net. Advance from the known finale length instead — the ending
      // then follows within ~SHOWCASE_MS even if 'ended' never arrives.
      const dur = (isFinite(this.video.duration) && this.video.duration > 0) ? this.video.duration : (ACTIVE_END + 6);
      const remainMs = Math.max(0, (dur - (this.video.currentTime || ACTIVE_END)) * 1000);
      this.after(remainMs + SHOWCASE_MS + 1200, advance);
    };

    this.video.addEventListener('ended', () => this.after(SHOWCASE_MS, advance), { once: true });
    this.after(IDLE_SAFETY_MS, advance);

    this.observeTracker(ctx.poseTracker, (s) => {
      pose = { present: s.present, raw: s.raw, wristY: s.wristY ?? 1, shoulderWidth: s.shoulderWidth ?? 0 };
    });

    // ---- Main loop -----------------------------------------------------
    this.loop(() => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastTs) / 1000);
      lastTs = now;
      if (demoActive) return;
      if (this.paused) { if (!this.video.paused) this.video.pause(); return; } // absence guard

      // Body lines (smoothed) + mirror overlay. Falls back to fixed fractions
      // and state.wristY when raw landmarks are absent (keyboard-mock QA).
      if (pose.present) {
        const bl = bodyLines(pose.raw, pose.shoulderWidth);
        sm.hip += (bl.hip - sm.hip) * LINE_SMOOTH;
        sm.chest += (bl.chest - sm.chest) * LINE_SMOOTH;
        sm.head += (bl.head - sm.head) * LINE_SMOOTH;
        for (const k of ['hip', 'chest', 'head']) lineEl[k].style.top = `${(sm[k] * 100).toFixed(1)}%`;
        linesLayer.style.opacity = '1';

        const w = activeWrist(pose.raw);
        const wy = w ? w.y : pose.wristY;
        smoothWristY += (wy - smoothWristY) * HAND_SMOOTH;
        // Mirror feed is flipped on X, so flip the indicator's x.
        if (w) this.webcamFeed.setHandIndicator(1 - w.x, w.y, !confirmed);

        // [3] Primary main-screen guide: vertical bar fill + moving chest tick +
        // translucent hand dot over the video. Fill = how far the hand has risen
        // between the hip line (0) and head line (1).
        const span = Math.max(0.02, sm.hip - sm.head);
        const fillF = clamp((sm.hip - smoothWristY) / span, 0, 1);
        vfill.style.height = `${(fillF * 100).toFixed(1)}%`;
        vpct.textContent = `${Math.round(fillF * 100)}%`;
        vtick.chest.style.bottom = `${(clamp((sm.hip - sm.chest) / span, 0, 1) * 100).toFixed(1)}%`;
        if (w && !confirmed) {
          handMain.style.left = `${((1 - w.x) * 100).toFixed(1)}%`;
          handMain.style.top = `${(w.y * 100).toFixed(1)}%`;
          handMain.style.opacity = '1';
        }
        noHandMs = 0;
      } else {
        linesLayer.style.opacity = '0.25';
        this.webcamFeed.setHandIndicator(0, 0, false);
        handMain.style.opacity = '0';
        noHandMs += dt * 1000;
      }

      if (!confirmed) {
        // [2] The hand is a TRIGGER, not a scrubber. Crossing a body line lights
        // its stage indicator AND unlocks the next video segment; the video then
        // plays toward that ceiling at its NATIVE 1x rate (below). Hand speed
        // never fast-forwards the clip, so the climax always plays in full.
        if (!passed.hip && smoothWristY <= sm.hip) { passed.hip = true; lineEl.hip.classList.add('passed'); vtick.hip.classList.add('on'); }
        if (!passed.chest && smoothWristY <= sm.chest) { passed.chest = true; lineEl.chest.classList.add('passed'); vtick.chest.classList.add('on'); }
        if (pose.present && smoothWristY <= sm.head) { confirm(); }

        // Stage-gated playback ceiling (never recedes):
        //   hip passed   -> play 0 .. T_SPROUT, then hold
        //   chest passed -> play T_SPROUT .. ACTIVE_END, then hold
        //   head passed  -> confirm() -> finale (ACTIVE_END..end) auto-plays
        const unlocked = passed.chest ? ACTIVE_END : (passed.hip ? T_SPROUT : 0);
        if (!pose.present) {
          // No-hand fallback (unchanged intent): slow ambient self-growth so a
          // lost-pose visitor still sees the bloom progress.
          targetTime = Math.min(ACTIVE_END, targetTime + DRIFT_PER_SEC * dt);
        }
        targetTime = Math.max(targetTime, unlocked);

        // Forward-only follow toward targetTime at NATIVE speed — never seek/
        // rewind, never speed up (playbackRate pinned to 1).
        const ct = this.video.currentTime || 0;
        const tgt = Math.min(targetTime, ACTIVE_END);
        if (ct < tgt - 0.04) {
          if (this.video.paused) this.video.play().catch(() => {});
          this.video.playbackRate = 1;
        } else if (!this.video.paused) {
          this.video.pause();
        }
      }
    });

    // [1] Absence guard — pause/reset if the visitor walks away.
    this.armAbsenceGuard(ctx);

    // ---- Onboarding ghost demo (once, non-blocking) -------------------
    const finishDemo = () => {
      if (this._exited || !demoActive) return; // idempotent — runs once
      demoActive = false;
      lastTs = performance.now();
      try { this._demoCard?.destroy(); } catch (e) { /* ignore */ }
      this._demoCard = null;
      this.guideMorph.morphTo(GUIDE_GROW);
      const gb = this.root.querySelector('.guide-bottom');
      if (gb) { gb.textContent = BLOOM_HINT; gb.classList.add('is-on'); }
    };
    this._startGhostDemo(ctx, finishDemo);
    // Safety net: a demo hiccup must never strand the visitor before the bloom
    // interaction turns on.
    this.after(9000, finishDemo);
  }

  // Tutorial-card demo: inside a lab observation window, a ghost rises bottom→
  // top through three lines that light in sequence ("raise your hand"), the
  // readout climbing 0→100%. The card then expands to fullscreen into the live
  // bloom. (The real video stays on frame 0 — no rewind — so growth is taught
  // by the gesture + lines.)
  _startGhostDemo(ctx, onDone) {
    const card = new TutorialCard();
    const entryRoot = this.root;
    card.mount(this.root);
    this._disposers.push(() => card.destroy());
    this._demoCard = card;

    const demoLines = document.createElement('div');
    demoLines.className = 'bloom-demo-lines';
    demoLines.innerHTML =
      '<div class="bloom-demo-line" style="top:74%"></div>' +
      '<div class="bloom-demo-line" style="top:50%"></div>' +
      '<div class="bloom-demo-line" style="top:26%"></div>';
    card.stage.appendChild(demoLines);
    const dls = Array.from(demoLines.querySelectorAll('.bloom-demo-line'));

    const ghost = document.createElement('img');
    ghost.className = 'bloom-ghost';
    ghost.src = ctx.config.data.tokenFront ?? '/assets/images/token-front.png';
    ghost.draggable = false;
    ghost.style.left = '50%';
    ghost.style.top = '84%';
    card.stage.appendChild(ghost);
    card.addTrail(50, 84, 50, 16);

    card.after(700, () => { ghost.style.opacity = '0.5'; card.setCaption('두 손을 천천히 위로 올려요'); });
    card.after(1700, () => { ghost.style.top = '50%'; dls[0].classList.add('lit'); card.setPct(0.33); });
    card.after(3400, () => { ghost.style.top = '26%'; dls[1].classList.add('lit'); card.setPct(0.66); });
    card.after(5100, () => { ghost.style.top = '14%'; dls[2].classList.add('lit'); card.setPct(1); card.setCaption('손을 머리 끝까지 올리면 꽃이 피어나요'); });
    card.after(6100, () => { ghost.style.opacity = '0'; });
    card.after(6600, async () => {
      try { await card.expand(); card.destroy(); }
      catch (e) { console.warn('[Bloom] demo handoff failed', e); }
      if (this._exited || this.root !== entryRoot) return;
      if (this._demoCard === card) this._demoCard = null;
      onDone();
    });
  }

  async exit() {
    this.ctx?.audio?.stop('grow');
    this.video?.pause();
    await this.morphOutGuide();
    // Release the heavy long-GOP bloom clip so its decoder/buffers don't linger
    // across thousands of cycles.
    if (this.video) { try { this.video.pause(); this.video.removeAttribute('src'); this.video.load(); } catch (e) { /* ignore */ } }
    this.webcamFeed?.detach();
    await super.exit();
  }
}
