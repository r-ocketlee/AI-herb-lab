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

const TOKEN_SIZE = 540;

export class CardState extends BaseState {
  constructor() {
    super('card');
  }

  async enter(ctx) {
    await super.enter(ctx);
    const appliance = ctx.config.getAppliance(ctx.session.applianceId);
    const flower = ctx.config.resolveFlower(ctx.session.applianceId, ctx.session.flowerKey);
    const dateStr = new Date().toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    Object.assign(this.root.style, { background: '#ffffff' });

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
      width: `${TOKEN_SIZE}px`,
      height: `${TOKEN_SIZE}px`,
    });
    this.token3D = new Token3D({
      width: TOKEN_SIZE,
      height: TOKEN_SIZE,
      frontImageSrc: ctx.config.data.tokenFront ?? '/assets/images/token-front.png',
      backCanvas,
    });
    stage.appendChild(this.token3D.root);
    this.root.appendChild(stage);
    this.token3D.start();

    // ---- QR + caption (left side, vertically centered) ----
    const qrGroup = document.createElement('div');
    Object.assign(qrGroup.style, {
      position: 'absolute',
      left: '14%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '20px',
      maxWidth: '260px',
      textAlign: 'center',
    });

    const qrImg = document.createElement('img');
    qrImg.className = 'card-qr';
    // QR points at the standalone token viewer page. Visitor scans → opens
    // the same disc on their phone, can rotate it and save the image.
    const base = ctx.config.data.tokenViewerBase
      ?? `${window.location.origin}/token.html`;
    const url = `${base}?a=${encodeURIComponent(appliance?.id ?? '')}`
      + `&f=${encodeURIComponent(ctx.session.flowerKey ?? '')}`
      + `&d=${encodeURIComponent(new Date().toISOString().slice(0, 10))}`;
    qrImg.src = await QRCode.toDataURL(url, {
      // margin 4 = standard QR quiet zone (white border). Without this the
      // scanner can't lock onto the QR's edges. width 600 keeps the modules
      // sharp on a 95" OLED when shrunk to ~180 CSS pixels.
      margin: 4,
      width: 600,
      errorCorrectionLevel: 'M',
    });
    qrGroup.appendChild(qrImg);

    const caption = document.createElement('div');
    caption.className = 'card-caption';
    caption.textContent = 'QR을 찍어 당신의 꽃을 소장해 보세요';
    qrGroup.appendChild(caption);

    this.root.appendChild(qrGroup);

    // ---- Webcam bubble (right) ----
    this.webcamFeed = new WebcamFeed(ctx.webcam, { mode: 'bubble' });
    this.root.appendChild(this.webcamFeed.root);
    this.webcamFeed.attach();

    // ---- Hand-driven rotation ----
    // Hand x (0..1) → rotateY across one full sweep (back → front → back).
    // Hand y (0..1) → ±25° tilt on X axis for look-around parallax.
    this.observeTracker(ctx.handTracker, (s) => {
      if (!s.present) return;
      const rotY = Math.PI + (s.x - 0.5) * Math.PI * 2;
      const rotX = (0.5 - s.y) * (Math.PI / 7);
      this.token3D.setTargetRotation(rotX, rotY);
    });

    // ---- Auto-reset to Idle ----
    this.after(ctx.config.timings.cardResetMs, () => {
      console.log('[Card] reset window elapsed → idle');
      this.machine.transition('idle');
    });
  }

  async exit() {
    this.token3D?.dispose();
    this.webcamFeed?.detach();
    await super.exit();
  }
}
