// PixelGridDissolve — circular-pixel "the visitor is being absorbed" effect.
//
// Each grid cell is rendered as a CIRCLE. The dots react to visitor motion
// frame-to-frame: as a cell sees movement, it "lifts" off the surface —
// grows slightly, brightens, casts a soft drop shadow, and nudges up-left
// so the shadow reads as below it.
//
// Layout: cover-fit. The grid fills the screen edge-to-edge (taller axis
// spills off-screen so cells stay square). The webcam visible through the
// gaps between dots gets a flat darkening overlay so the colored dots
// pop more.
//
// Animation phases (driven by external setProgress(t), 0..1):
//   • [0.00 – 0.10]  IDLE    — canvas transparent; webcam shows clean.
//   • [0.10 – 0.30]  IRIS    — circular dots dissolve in radially. As the
//     dots appear, a flat dark overlay also fades in across the whole
//     screen — only as dark as BG_HOLD_ALPHA, just enough to make the
//     dots pop against a dimmed webcam background.
//   • [0.30 – 0.65]  HOLD    — every dot at full alpha; overlay stays at
//     BG_HOLD_ALPHA. This is the "photo window" — visitors can pose,
//     wave, and snap a shot on their phone. Webcam is still visible in
//     the gaps, just muted.
//   • [0.65 – 0.90]  DRAIN   — cells migrate to the center (outer first,
//     staggered). Overlay continues darkening from BG_HOLD_ALPHA → 1.0
//     so the screen smoothly walks toward total black as cells fade at
//     the center.
//   • [0.90 – 1.00]  BLACK   — pure black hold.

const DEFAULT_GRID = 60;

// Phase boundary fractions (0..1) — single source of truth for the
// staged timeline. Caller's `analyzingMs` × these fractions defines the
// real-time length of each beat.
const T_IRIS_START = 0.10;
const T_HOLD_START = 0.30;
const T_DRAIN_START = 0.65;
const T_BLACK_START = 0.90;

// Plateau darkness of the background overlay during HOLD. 0.40 is a
// gentle dim — webcam still readable through the gaps between dots, but
// the colored dots clearly read as the foreground subject.
const BG_HOLD_ALPHA = 0.40;

// Circular wave scan — concentric light rings sweep edge → centre on a loop,
// brightening the dots they touch ("data converging into the seed").
const RING_PERIOD_MS = 5600; // one ring's edge→centre travel time. Raised from 2600 so the
                             // scan repeats far less often (a ring now passes a given point
                             // every ~2.8s vs ~1.3s before — under half the previous frequency).
const RING_COUNT = 2;        // staggered rings on screen at once
const RING_WIDTH = 0.13;     // ring thickness in distNorm units
const RING_GLOW = [220, 205, 255]; // soft lavender light

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

export class PixelGridDissolve {
  constructor(video, opts = {}) {
    this.video = video;
    this.gridCols = opts.gridCols ?? DEFAULT_GRID;
    this.gridRows = opts.gridRows ?? DEFAULT_GRID;
    this.gapRatio = opts.gapRatio ?? 0.20; // gap between dots so each reads as a separate circle
    this.mirror = opts.mirror ?? true;

    // Motion-elevation params (visitor movement → 3D lift on the dots).
    // Lower motionSensitivity ⇒ more sensitive (smaller diff needed).
    this.motionSensitivity = opts.motionSensitivity ?? 0.30;
    this.elevationSmoothing = opts.elevationSmoothing ?? 0.18;
    this.borderOpacity = opts.borderOpacity ?? 0;

    // Display canvas — what the visitor sees.
    this.canvas = document.createElement('canvas');
    Object.assign(this.canvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      display: 'block',
      pointerEvents: 'none',
    });
    this.ctx = this.canvas.getContext('2d');

    // Hidden processing canvas — downsampled webcam frame for color +
    // motion sampling.
    this.procCanvas = document.createElement('canvas');
    this.procCanvas.width = this.gridCols;
    this.procCanvas.height = this.gridRows;
    this.procCtx = this.procCanvas.getContext('2d', { willReadFrequently: true });
    this._prevFrame = null;

    // Build cells. distNorm normalizes radial distance against the
    // inscribed circle of the rectangular grid — used both for IRIS
    // reveal (outer cells first) and for DRAIN stagger.
    this.cells = [];
    const cx = (this.gridCols - 1) / 2;
    const cy = (this.gridRows - 1) / 2;
    const circleRadiusInCells = Math.min(cx, cy);
    for (let r = 0; r < this.gridRows; r++) {
      for (let c = 0; c < this.gridCols; c++) {
        const dx = c - cx;
        const dy = r - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const distNorm = dist / circleRadiusInCells;
        this.cells.push({
          col: c,
          row: r,
          distNorm,
          r: 0,
          g: 0,
          b: 0,
          motion: 0,
          currentElevation: 0,
          originX: 0,
          originY: 0,
        });
      }
    }
    // Inner-first draw order — outer cells in motion render on top of
    // inner cells still at origin so the "vacuum to center" reads cleanly.
    this.cellsByDistAsc = [...this.cells].sort((a, b) => a.distNorm - b.distNorm);

    this._progress = 0;
    this._running = false;
    this._rafId = 0;
    this._needsFit = true;

    this._resizeObserver = new ResizeObserver(() => { this._needsFit = true; });
    this._resizeObserver.observe(this.canvas);
  }

  get root() { return this.canvas; }

  setProgress(t) {
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    this._progress = t;
  }

  start() {
    if (this._running) return;
    this._running = true;
    const loop = () => {
      if (!this._running) return;
      if (this._needsFit) this._fit();
      this._render();
      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  stop() {
    this._running = false;
    cancelAnimationFrame(this._rafId);
  }

  dispose() {
    this.stop();
    this._resizeObserver?.disconnect();
    this._prevFrame = null;
  }

  _fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }

    // COVER fit — grid fills the screen edge-to-edge. The taller axis of
    // the rectangular grid spills off-screen so cells stay perfectly
    // square (and the dots stay round).
    const cellSize = Math.max(w / this.gridCols, h / this.gridRows);
    const gridW = cellSize * this.gridCols;
    const gridH = cellSize * this.gridRows;
    const offsetX = (w - gridW) / 2;
    const offsetY = (h - gridH) / 2;
    this.cellSize = cellSize;
    this.gap = cellSize * this.gapRatio;
    this.baseRadius = (cellSize - this.gap) / 2;
    this.centerX = w / 2;
    this.centerY = h / 2;
    for (const cell of this.cells) {
      cell.originX = offsetX + (cell.col + 0.5) * cellSize;
      cell.originY = offsetY + (cell.row + 0.5) * cellSize;
    }
    this._needsFit = false;
  }

  // Sample the live webcam frame into the procCanvas with the SAME crop +
  // scale as the WebcamFeed underneath (CSS `objectFit: cover` + optional
  // `scaleX(-1)`), so the color a dot shows at screen pixel (x, y) is the
  // same color the webcam shows at (x, y).
  //
  // Without this matching, a stretch-fit downsample would Y-shift dots
  // away from the visible webcam by up to (sourceH - sourceW × canvasH /
  // canvasW) / 2 source pixels — clearly visible misalignment when the
  // source is 4:3 and the display is 16:9.
  _sampleWebcam() {
    const video = this.video;
    if (!video || !video.videoWidth || !video.videoHeight) return null;
    const sourceW = video.videoWidth;
    const sourceH = video.videoHeight;
    const canvasW = this.canvas.width;
    const canvasH = this.canvas.height;
    if (canvasW <= 0 || canvasH <= 0) return null;

    // ---- Cover-fit reverse mapping (matches WebcamFeed CSS) ------------
    const coverScale = Math.max(canvasW / sourceW, canvasH / sourceH);
    const cropSrcX = (sourceW - canvasW / coverScale) / 2;
    const cropSrcY = (sourceH - canvasH / coverScale) / 2;

    // The grid is cover-fit on the canvas — it may extend past the
    // visible canvas in the long-axis direction. Map the FULL grid
    // extent to a source rect; off-source slop gets clipped below.
    const gridW = this.cellSize * this.gridCols;
    const gridH = this.cellSize * this.gridRows;
    const offsetX = this.centerX - gridW / 2;
    const offsetY = this.centerY - gridH / 2;

    let srcX = this.mirror
      ? cropSrcX + (canvasW - (offsetX + gridW)) / coverScale
      : cropSrcX + offsetX / coverScale;
    let srcY = cropSrcY + offsetY / coverScale;
    let srcW = gridW / coverScale;
    let srcH = gridH / coverScale;

    // Pre-flip dest rect (before scale(-1, 1) for mirror).
    let destX = 0;
    let destY = 0;
    let destW = this.gridCols;
    let destH = this.gridRows;

    // ---- Clip source rect to image bounds, shrinking dest to match ----
    // For mirror, source-LEFT maps to dest-RIGHT (and vice versa), so the
    // X-clip side flips. Y is unaffected by the mirror.
    if (this.mirror) {
      if (srcX < 0) {
        const ratio = -srcX / srcW;
        srcW += srcX; srcX = 0;
        destW -= destW * ratio; // shrink dest from the right
      }
      if (srcX + srcW > sourceW) {
        const cut = srcX + srcW - sourceW;
        const ratio = cut / srcW;
        srcW -= cut;
        const dw = destW * ratio;
        destX += dw; // shrink dest from the left
        destW -= dw;
      }
    } else {
      if (srcX < 0) {
        const ratio = -srcX / srcW;
        srcW += srcX; srcX = 0;
        const dw = destW * ratio;
        destX += dw;
        destW -= dw;
      }
      if (srcX + srcW > sourceW) {
        const ratio = (srcX + srcW - sourceW) / srcW;
        srcW = sourceW - srcX;
        destW -= destW * ratio;
      }
    }
    if (srcY < 0) {
      const ratio = -srcY / srcH;
      srcH += srcY; srcY = 0;
      const dh = destH * ratio;
      destY += dh;
      destH -= dh;
    }
    if (srcY + srcH > sourceH) {
      const ratio = (srcY + srcH - sourceH) / srcH;
      srcH = sourceH - srcY;
      destH -= destH * ratio;
    }
    if (srcW <= 0 || srcH <= 0 || destW <= 0 || destH <= 0) return null;

    // Areas of the procCanvas that the clipped source doesn't cover stay
    // transparent — those correspond to off-screen grid cells anyway.
    this.procCtx.clearRect(0, 0, this.gridCols, this.gridRows);

    try {
      this.procCtx.save();
      if (this.mirror) {
        this.procCtx.scale(-1, 1);
        // Pre-flip dest X is -(finalDestX + finalDestW) so that, after
        // scale(-1, 1), the rect lands at procCanvas (destX, destY,
        // destW, destH) with its X content reversed.
        this.procCtx.drawImage(video, srcX, srcY, srcW, srcH,
                               -(destX + destW), destY, destW, destH);
      } else {
        this.procCtx.drawImage(video, srcX, srcY, srcW, srcH,
                               destX, destY, destW, destH);
      }
      this.procCtx.restore();
      return this.procCtx.getImageData(0, 0, this.gridCols, this.gridRows).data;
    } catch (e) {
      return null;
    }
  }

  _updateCells(data) {
    if (!data) return;
    const prev = this._prevFrame;
    const sens = this.motionSensitivity;
    const smoothing = this.elevationSmoothing;

    for (const cell of this.cells) {
      if (cell.distNorm > 1) continue;
      const idx = (cell.row * this.gridCols + cell.col) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      cell.r = r;
      cell.g = g;
      cell.b = b;

      let m = 0;
      if (prev) {
        const dr = Math.abs(r - prev[idx]);
        const dg = Math.abs(g - prev[idx + 1]);
        const db = Math.abs(b - prev[idx + 2]);
        m = Math.min(1, (dr + dg + db) / 255 / sens);
      }
      cell.motion = cell.motion * 0.7 + m * 0.3;
      const target = cell.motion;
      cell.currentElevation += (target - cell.currentElevation) * smoothing;
    }

    this._prevFrame = new Uint8ClampedArray(data);
  }

  _drawDot(cell, x, y, alpha, opts = {}) {
    const elev = opts.elevated ? cell.currentElevation : 0;
    const ctx = this.ctx;
    const r = this.baseRadius * (1 + elev * 0.28);

    ctx.globalAlpha = alpha;

    if (elev > 0.05) {
      const shAlpha = Math.min(0.5, elev * 0.45);
      ctx.fillStyle = `rgba(0, 0, 0, ${shAlpha})`;
      ctx.beginPath();
      ctx.arc(x + elev * 5, y + elev * 8, r, 0, Math.PI * 2);
      ctx.fill();
    }

    const bMul = 1 + elev * 0.18;
    const cr = clamp255(cell.r * bMul);
    const cg = clamp255(cell.g * bMul);
    const cb = clamp255(cell.b * bMul);
    const lx = x - elev * 4;
    const ly = y - elev * 7;
    ctx.fillStyle = `rgb(${cr}, ${cg}, ${cb})`;
    ctx.beginPath();
    ctx.arc(lx, ly, r, 0, Math.PI * 2);
    ctx.fill();

    // NOTE: the circular-wave additive glow used to be drawn here, per dot,
    // which forced a ctx.save()/globalCompositeOperation='lighter'/restore on
    // EVERY cell (10k GPU state flushes/frame → the main cause of the stutter).
    // It is now drawn in a single batched pass — see _drawGlowPass(), called
    // once after the dot loop with the composite mode set a single time.

    if (this.borderOpacity > 0) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${this.borderOpacity + elev * 0.06})`;
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }

  // Maps current progress to the alpha of the flat background overlay.
  // Rises gently through IRIS to BG_HOLD_ALPHA, plateaus during HOLD,
  // then accelerates aggressively through DRAIN → 1.0 by BLACK.
  //
  // The DRAIN ramp uses a sqrt curve (fast at start, slow at end) so the
  // background visibly darkens the moment the pixels start gathering —
  // matching the visual cue the visitor sees as the dots leave their
  // origins.
  _computeBgAlpha(t) {
    if (t < T_IRIS_START) return 0;
    if (t < T_HOLD_START) {
      return ((t - T_IRIS_START) / (T_HOLD_START - T_IRIS_START)) * BG_HOLD_ALPHA;
    }
    if (t < T_DRAIN_START) return BG_HOLD_ALPHA;
    if (t < T_BLACK_START) {
      const k = (t - T_DRAIN_START) / (T_BLACK_START - T_DRAIN_START);
      const eased = Math.sqrt(k); // front-loaded — big jump in the first instant
      return BG_HOLD_ALPHA + eased * (1 - BG_HOLD_ALPHA);
    }
    return 1;
  }

  // Converging-ring glow for a cell at radial position distNorm (0..1).
  // Returns 0..1 peaking when a sweeping ring radius matches the cell.
  _ringGlow(distNorm, now) {
    let g = 0;
    for (let i = 0; i < RING_COUNT; i++) {
      const phase = ((now / RING_PERIOD_MS) + i / RING_COUNT) % 1;
      const ringR = 1 - phase; // travels edge (1) → centre (0)
      const d = (distNorm - ringR) / RING_WIDTH;
      const v = Math.exp(-d * d);
      if (v > g) g = v;
    }
    return g;
  }

  // Batched additive glow for the converging-ring scan. Drawn in ONE pass with
  // globalCompositeOperation set a single time (instead of save/restore per
  // dot), so the GPU compositor isn't flushed 5–10k times every frame.
  // `alphaFn(cell)` returns the dot's base alpha for the current phase.
  // 'lighter' is commutative, so drawing all glows after all dots looks the
  // same as the old interleaved order.
  _drawGlowPass(alphaFn) {
    const ctx = this.ctx;
    const now = performance.now();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgb(${RING_GLOW[0]}, ${RING_GLOW[1]}, ${RING_GLOW[2]})`;
    for (const cell of this.cellsByDistAsc) {
      if (cell.distNorm > 1) continue;
      const glow = this._ringGlow(cell.distNorm, now);
      if (glow <= 0.04) continue;
      const alpha = alphaFn(cell);
      if (alpha <= 0) continue;
      const elev = cell.currentElevation;
      const r = this.baseRadius * (1 + elev * 0.28);
      const lx = cell.originX - elev * 4;
      const ly = cell.originY - elev * 7;
      ctx.globalAlpha = Math.min(0.85, glow * 0.7) * alpha;
      ctx.beginPath();
      ctx.arc(lx, ly, r * (1 + glow * 0.7), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _render() {
    const t = this._progress;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    if (t < T_IRIS_START) return; // Phase IDLE: webcam clean.

    // Flat darkening overlay across the whole canvas — drawn FIRST so
    // dots render on top. The webcam visible through the gaps between
    // dots gets this dim treatment, which makes the colored dots pop.
    const bgAlpha = this._computeBgAlpha(t);
    if (bgAlpha > 0) {
      ctx.fillStyle = `rgba(0, 0, 0, ${bgAlpha})`;
      ctx.fillRect(0, 0, w, h);
    }

    this._updateCells(this._sampleWebcam());

    if (t < T_HOLD_START) {
      // ---- Phase IRIS: radial dissolve outer → inner -------------------
      const tB = (t - T_IRIS_START) / (T_HOLD_START - T_IRIS_START);
      const irisAlpha = (cell) => Math.min(1, Math.max(0, (tB - (1 - cell.distNorm)) * 4));
      for (const cell of this.cellsByDistAsc) {
        if (cell.distNorm > 1) continue;
        const alpha = irisAlpha(cell);
        if (alpha <= 0) continue;
        this._drawDot(cell, cell.originX, cell.originY, alpha, { elevated: true });
      }
      this._drawGlowPass(irisAlpha);
      return;
    }

    if (t < T_DRAIN_START) {
      // ---- Phase HOLD: fully pixelated photo window --------------------
      for (const cell of this.cellsByDistAsc) {
        if (cell.distNorm > 1) continue;
        this._drawDot(cell, cell.originX, cell.originY, 1, { elevated: true });
      }
      this._drawGlowPass(() => 1);
      return;
    }

    if (t < T_BLACK_START) {
      // ---- Phase DRAIN: migrate to center ------------------------------
      const tC = (t - T_DRAIN_START) / (T_BLACK_START - T_DRAIN_START);
      const staggerWindow = 0.5;
      const migDur = 0.35;
      const fadeDur = 0.15;

      for (const cell of this.cellsByDistAsc) {
        if (cell.distNorm > 1) continue;
        const startT = (1 - cell.distNorm) * staggerWindow;
        const localT = tC - startT;

        if (localT <= 0) {
          this._drawDot(cell, cell.originX, cell.originY, 1, { elevated: true });
          continue;
        }

        // No explicit "black hole at origin" needed — the bgAlpha overlay
        // grows throughout DRAIN, naturally darkening the void left
        // behind by departed cells.
        if (localT < migDur) {
          const p = easeInOutCubic(localT / migDur);
          const x = cell.originX + (this.centerX - cell.originX) * p;
          const y = cell.originY + (this.centerY - cell.originY) * p;
          this._drawDot(cell, x, y, 1, { elevated: false });
        } else if (localT < migDur + fadeDur) {
          const fadeP = (localT - migDur) / fadeDur;
          this._drawDot(cell, this.centerX, this.centerY, 1 - fadeP, { elevated: false });
        }
      }
      return;
    }

    // ---- Phase BLACK: pure black hold ----------------------------------
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
  }
}
