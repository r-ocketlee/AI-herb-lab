// 5. 카드 제작 및 아카이빙 — 3D coin-token showcase (three.js).
//
// Layout:
//   ┌──────────────────────────────────────────┐
//   │                                          │
//   │   [QR]      ┌──────────┐                 │
//   │  "QR을      │ 3D TOKEN │      ●webcam    │
//   │  찍어..."    │ (ellipsoid)│                 │
//   │             └──────────┘                 │
//   │                                          │
//   └──────────────────────────────────────────┘
//
//   • Token is a three.js ExtrudeGeometry lens with front-face orb image and
//     back-face card composite. Hand drives free rotation (see Token3D).
//   • Back-face texture is built at runtime via canvas — circular crop of the
//     card image with date (top) and appliance name (bottom) burned in.
//   • QR + caption pinned to the left; webcam bubble pinned right.
//   • After cardResetMs (30s) we return to Idle.

import QRCode from 'qrcode';
import { BaseState } from './BaseState.js';
import { WebcamFeed } from '../ui/WebcamFeed.js';
import { Token3D } from '../ui/Token3D.js';
import { buildBackCanvas } from '../ui/cardBack.js';
import { RevealText } from '../ui/RevealText.js';

const TOKEN_REM = 54;
// Ending copy in three tiers (size + position set the hierarchy so the screen
// doesn't read as a wall of text):
//   1) MAIN  — top-center, large (.guide-top)
//   2) hint  — below the token, small (rotation hint)
//   3) system — below the main text, small (reset countdown, .card-countdown)
const MAIN_HTML =
  '당신만의 씨앗이 완성되었습니다<br>QR을 스캔해 분양 증서를 받아 집에서 심어보세요';
const ROTATE_HINT = '손을 움직여 돌려보세요';

export class CardState extends BaseState {
  constructor() {
    super('card');
  }

  async enter(ctx) {
    await super.enter(ctx);
    this.pauseTrackers({ hand: false }); // token spin needs the hand; pose (presence) not used here
    const appliance = ctx.config.getAppliance(ctx.session.applianceId);
    const flower = ctx.config.resolveFlower(ctx.session.applianceId, ctx.session.flowerKey);
    // Public species codename (e.g. "AIR-07") — first revealed on this screen.
    // The A/B variant behind `flowerKey` is never shown.
    const codename = ctx.config.getCodename(ctx.session.applianceId, ctx.session.codenameNum);
    const dateStr = new Date().toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    Object.assign(this.root.style, { background: '#ffffff' });

    // The rest of the kiosk scales through the root rem size. Match that same
    // system here so the token keeps its composition at 1080p and 4K instead
    // of becoming half-sized on the exhibition display.
    const rootRemPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
    const tokenSize = Math.round(TOKEN_REM * rootRemPx);

    // ---- Build back-face texture canvas ----
    // Circular crop of card image with date/name overlay.
    const backCanvas = await buildBackCanvas({
      cardImage: flower?.card,
      dateStr,
      applianceName: appliance?.name ?? '',
      applianceModel: appliance?.model ?? '',
      size: 720,
    });

    // ---- 3D token stage ----
    const stage = document.createElement('div');
    Object.assign(stage.style, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
      width: `${TOKEN_REM}rem`,
      height: `${TOKEN_REM}rem`,
    });
    this.token3D = new Token3D({
      width: tokenSize,
      height: tokenSize,
      frontImageSrc: ctx.config.data.tokenFront ?? '/assets/images/token-front.png',
      backCanvas,
    });
    this.token3D.root.classList.add('card-token-canvas');
    stage.appendChild(this.token3D.root);
    this.root.appendChild(stage);
    this.token3D.start();

    // ---- Tier 1: MAIN message — top-center, large (.guide-top) ---------
    const guideEl = document.createElement('p');
    guideEl.className = 'guide-top';
    this.root.appendChild(guideEl);
    this.guideMorph = new RevealText({ morphMs: 1800 });
    guideEl.appendChild(this.guideMorph.root);
    this.guideMorph.setInitial('');
    requestAnimationFrame(() => this.guideMorph.morphTo(MAIN_HTML));
    this._disposers.push(() => this.guideMorph?.stop());

    // ---- Tier 2: rotation hint — below the token, small ----------------
    const rotateHintEl = document.createElement('div');
    rotateHintEl.className = 'card-rotate-hint';
    rotateHintEl.textContent = ROTATE_HINT;
    this.root.appendChild(rotateHintEl);

    // ---- Reset countdown (small HUD line under the guide) --------------
    const resetSec = Math.round(ctx.config.timings.cardResetMs / 1000);
    const countdownEl = document.createElement('div');
    countdownEl.className = 'card-countdown';
    countdownEl.innerHTML = `처음 화면으로 돌아갑니다 <span class="card-countdown__num">${resetSec}</span>`;
    this.root.appendChild(countdownEl);
    const numEl = countdownEl.querySelector('.card-countdown__num');
    let remain = resetSec;
    const cdId = setInterval(() => {
      remain -= 1;
      if (numEl) numEl.textContent = String(Math.max(0, remain));
      if (remain <= 0) clearInterval(cdId);
    }, 1000);
    this._disposers.push(() => clearInterval(cdId));

    // ---- QR (left side, vertically centered) — caption removed --------
    const qrGroup = document.createElement('div');
    Object.assign(qrGroup.style, {
      position: 'absolute',
      left: '14%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '2rem',
      maxWidth: '26rem',
      textAlign: 'center',
    });

    const qrImg = document.createElement('img');
    qrImg.className = 'card-qr';
    // QR points at the standalone token viewer page. Visitor scans → opens
    // the same disc on their phone, can rotate it and save the image.
    const base = ctx.config.data.tokenViewerBase
      ?? `${window.location.origin}/token.html`;
    // Query params for the certificate page:
    //   a = appliance id (→ species + assets)   c = codename number (→ "AIR-07")
    //   f = A/B variant (internal; never displayed)   d = date
    //   id = uploaded portrait id (omitted if capture/upload failed)
    let url = `${base}?a=${encodeURIComponent(appliance?.id ?? '')}`
      + `&c=${encodeURIComponent(ctx.session.codenameNum ?? '')}`
      + `&f=${encodeURIComponent(ctx.session.flowerKey ?? '')}`
      + `&d=${encodeURIComponent(new Date().toISOString().slice(0, 10))}`;
    if (ctx.session.photoId) {
      url += `&id=${encodeURIComponent(ctx.session.photoId)}`;
    }
    try {
      qrImg.src = await QRCode.toDataURL(url, {
        // margin 4 = standard QR quiet zone (white border). Without this the
        // scanner can't lock onto the QR's edges. width 600 keeps the modules
        // sharp on a 95" OLED when shrunk to ~180 CSS pixels.
        margin: 4,
        width: 600,
        errorCorrectionLevel: 'M',
      });
      qrGroup.appendChild(qrImg);
    } catch (err) {
      // A QR failure must NOT throw out of enter(): that skips exit() and leaks
      // the already-started Token3D (WebGL context + RAF). Show the card without
      // the QR rather than tearing the whole state (and recovery) down.
      console.warn('[CardState] QR generation failed; showing card without QR', err);
    }

    this.root.appendChild(qrGroup);

    // ---- Webcam bubble (right) ----
    this.webcamFeed = new WebcamFeed(ctx.webcam, { mode: 'bubble' });
    this.root.appendChild(this.webcamFeed.root);
    this.webcamFeed.attach();

    // [6] Neutral dot cursor follows the hand here too, for consistency with
    // the other stages; token spin is still driven by the observer below.
    ctx.cursor.setProgress(0);
    ctx.cursor.show();

    // ---- Hand-driven rotation ----
    // Flick model: horizontal hand velocity → angular impulse. The coin
    // carries momentum and decays naturally (Token3D handles damping), so
    // a small wave produces visible spin and a sharp swipe sends it
    // whirling. Vertical hand position still maps to a gentle ±13° tilt.
    const SPIN_GAIN = 3.5;        // [3] dx/sec -> rad/sec — raised so hand/finger motion reliably spins the coin (inertia/smoothing in Token3D unchanged)
    const MIN_IMPULSE_DX = 0.0006; // [3] lower threshold so gentle/slow moves still register, while ignoring sub-px jitter
    const TILT_GAIN = Math.PI / 7;

    let lastHandX = null;
    let lastTime = 0;

    this.observeTracker(ctx.handTracker, (s) => {
      if (!s.present) {
        lastHandX = null;
        this.webcamFeed.setHandIndicator(0, 0, false);
        return;
      }
      ctx.cursor.moveTo(s.x * window.innerWidth, s.y * window.innerHeight);
      this.webcamFeed.setHandIndicator(s.x, s.y, true);
      const now = performance.now();

      if (lastHandX !== null && lastTime !== 0) {
        const dx = s.x - lastHandX;
        const dt = (now - lastTime) / 1000;
        // dt window: drop stale samples (>150ms gap) and zero-divides.
        if (dt > 0 && dt < 0.15 && Math.abs(dx) >= MIN_IMPULSE_DX) {
          // Impulse in radians per frame — `dx/dt` is normalized hand
          // velocity (per second), scaled by SPIN_GAIN and divided by 60
          // to match the per-frame integration in Token3D.
          const impulse = (dx / dt) * SPIN_GAIN / 60;
          this.token3D.applySpinImpulse(impulse);
        }
      }

      lastHandX = s.x;
      lastTime = now;

      // Tilt — small parallax, lerped smoothly inside Token3D.
      this.token3D.setTargetTilt((0.5 - s.y) * TILT_GAIN);
    });

    // ---- Auto-reset to Idle ----
    this.after(ctx.config.timings.cardResetMs, () => {
      console.log('[Card] reset window elapsed → idle');
      // The hand-down cue has been playing since BloomState; this reset is the
      // only place it ends — fade it out gracefully as we return to the start.
      ctx.audio?.fadeOut('handdown', 1500);
      this.machine.transition('idle');
    });
  }

  async exit() {
    this.ctx?.cursor.hide();
    await this.morphOutGuide();
    this.token3D?.dispose();
    this.webcamFeed?.detach();
    await super.exit();
  }
}
