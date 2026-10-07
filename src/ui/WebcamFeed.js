// WebcamFeed — renders the shared <video id="webcam"> into a state's DOM.
// Used in two modes:
//   • 'bubble'     — small circular feed on the right edge (SeedSelect, Bloom)
//   • 'fullscreen' — fills the viewport (Analyzing)
//
// If no stream is connected the <video> element is just black — no
// dev-style placeholder UI is shown.
//
// Bubble mode wraps the circular feed in an InstrumentRing (calibration ring +
// brackets + "CAM · LIVE" label) so the camera reads as a lab instrument. The
// ring lives in an un-clipped wrapper alongside the clipped circle, so it can
// draw in the band just outside the feed.

import { InstrumentRing } from './InstrumentRing.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));

export class WebcamFeed {
  constructor(webcam, { mode = 'bubble', handIcon = null, poseTracker = null } = {}) {
    this.webcam = webcam;
    this.mode = mode;
    this.poseTracker = poseTracker;
    this._unobserve = null;
    this._trackHideTimer = null;

    this.video = document.createElement('video');
    this.video.autoplay = true;
    this.video.muted = true;
    this.video.playsInline = true;
    Object.assign(this.video.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      transform: 'scaleX(-1)',
      background: '#000',
    });

    if (mode === 'fullscreen') {
      this.root = document.createElement('div');
      this.root.className = 'webcam-fullscreen';
      Object.assign(this.root.style, {
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: '#000000',
      });
      this.root.appendChild(this.video);
      this._enableTracking(this.root);
      return;
    }

    // Bubble mode: un-clipped wrapper > [ clipped circle (video), ring ].
    this.root = document.createElement('div');
    this.root.className = 'webcam-bubble-wrap';

    const circle = document.createElement('div');
    circle.className = 'webcam-bubble';
    circle.appendChild(this.video);

    // Hand indicator — the seed icon drawn over the visitor's hand in the
    // mirror feed (position set each frame via setHandIndicator).
    this.handDot = document.createElement('div');
    this.handDot.className = handIcon ? 'webcam-hand-dot is-seed' : 'webcam-hand-dot';
    if (handIcon) this.handDot.style.backgroundImage = `url("${handIcon}")`;
    circle.appendChild(this.handDot);

    // Tracking overlay lives inside the clipped circle so it stays within the feed.
    this._enableTracking(circle);

    this.root.appendChild(circle);

    // Webcam bubble ring + "CAM · LIVE" label removed — clean circular feed.
  }

  async attach() {
    if (!this.webcam?.stream) {
      console.log('[WebcamFeed] no stream');
      return;
    }
    this.video.srcObject = this.webcam.stream;
    try {
      await this.video.play();
    } catch (err) {
      console.warn('[WebcamFeed] play() rejected', err);
    }
  }

  detach() {
    this.video.srcObject = null;
    if (this._unobserve) { this._unobserve(); this._unobserve = null; }
    if (this._trackHideTimer) { clearTimeout(this._trackHideTimer); this._trackHideTimer = null; }
  }

  // [1] "누가 조작 중인지" 표시 — precision-instrument tone: viewfinder corner
  // brackets + a faint pose skeleton + a small mono label, all white/translucent
  // over the mirror feed (matches the LabFrame crop-mark/HUD language). The box
  // itself is an invisible positioning frame; only the corners/skeleton/label
  // render. No-op unless a poseTracker was passed. CSS transitions glide the
  // frame (and the skeleton scales with it); a 0.5s hold-after-loss damps flicker.
  _enableTracking(container) {
    if (!this.poseTracker || !container) return;
    const box = document.createElement('div');
    box.className = 'webcam-track-box';
    box.style.opacity = '0';
    box.innerHTML =
      '<span class="wt-corner wt-corner--tl"></span>' +
      '<span class="wt-corner wt-corner--tr"></span>' +
      '<span class="wt-corner wt-corner--bl"></span>' +
      '<span class="wt-corner wt-corner--br"></span>' +
      '<span class="webcam-track-tag">SUBJECT</span>' +
      '<svg class="wt-skel" viewBox="0 0 100 100" preserveAspectRatio="none">' +
      '<line data-s="sh"></line><line data-s="neck"></line>' +
      '<line data-s="lua"></line><line data-s="rua"></line>' +
      '</svg>';
    container.appendChild(box);
    this._trackBox = box;
    const seg = {
      sh: box.querySelector('[data-s="sh"]'),
      neck: box.querySelector('[data-s="neck"]'),
      lua: box.querySelector('[data-s="lua"]'),
      rua: box.querySelector('[data-s="rua"]'),
    };

    this._unobserve = this.poseTracker.observe((s) => {
      const raw = s.present ? s.raw : null;
      const rect = raw ? this._poseBox(raw) : null;
      if (rect) {
        if (this._trackHideTimer) { clearTimeout(this._trackHideTimer); this._trackHideTimer = null; }
        box.style.left = `${(rect.left * 100).toFixed(1)}%`;
        box.style.top = `${(rect.top * 100).toFixed(1)}%`;
        box.style.width = `${(rect.w * 100).toFixed(1)}%`;
        box.style.height = `${(rect.h * 100).toFixed(1)}%`;
        box.style.opacity = '1';
        this._drawSkeleton(seg, raw, rect);
      } else if (!this._trackHideTimer) {
        // Hold briefly so a 1–2 frame detection drop doesn't blink it off.
        this._trackHideTimer = setTimeout(() => { box.style.opacity = '0'; this._trackHideTimer = null; }, 500);
      }
    });
  }

  // Faint skeleton (shoulders + neck + upper arms) drawn in box-relative % so it
  // rides the corner-bracket frame's CSS transition. Lines hide if an endpoint
  // isn't confidently detected.
  _drawSkeleton(seg, raw, rect) {
    const sp = (i) => { const p = raw[i]; if (!p || (p.visibility != null && p.visibility < 0.3)) return null; return { x: 1 - p.x, y: p.y }; };
    const mid = (a, b) => (a && b) ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
    const rel = (pt) => ({ x: ((pt.x - rect.left) / rect.w) * 100, y: ((pt.y - rect.top) / rect.h) * 100 });
    const line = (el, a, b) => {
      if (!el) return;
      if (!a || !b) { el.style.display = 'none'; return; }
      el.style.display = '';
      const A = rel(a), B = rel(b);
      el.setAttribute('x1', A.x.toFixed(1)); el.setAttribute('y1', A.y.toFixed(1));
      el.setAttribute('x2', B.x.toFixed(1)); el.setAttribute('y2', B.y.toFixed(1));
    };
    const ls = sp(11), rs = sp(12);
    line(seg.sh, ls, rs);              // shoulder line
    line(seg.neck, sp(0), mid(ls, rs)); // nose → shoulder midpoint
    line(seg.lua, ls, sp(13));          // left upper arm
    line(seg.rua, rs, sp(14));          // right upper arm
  }

  // Upper-body bounding box (normalized, mirrored to match the flipped feed)
  // from pose landmarks: nose/eyes/ears/shoulders — the points reliably in frame.
  _poseBox(raw) {
    if (!raw) return null;
    const xs = [], ys = [];
    for (const i of [0, 2, 5, 7, 8, 11, 12]) {
      const p = raw[i];
      if (!p) continue;
      if (p.visibility != null && p.visibility < 0.3) continue;
      xs.push(1 - p.x); // mirror X to match the feed's scaleX(-1)
      ys.push(p.y);
    }
    if (xs.length < 2) return null;
    const minX = clamp01(Math.min(...xs) - 0.06);
    const maxX = clamp01(Math.max(...xs) + 0.06);
    const minY = clamp01(Math.min(...ys) - 0.12); // a little above the head
    const maxY = clamp01(Math.max(...ys) + 0.18); // down past the shoulders
    return { left: minX, top: minY, w: maxX - minX, h: maxY - minY };
  }

  // Position the seed indicator over the hand in the mirror feed. nx/ny are
  // normalised (0..1) hand coords; the feed is mirrored the same way the seed
  // cursor is, so they map directly to the bubble's box.
  setHandIndicator(nx, ny, visible) {
    if (!this.handDot) return;
    if (!visible) {
      this.handDot.style.opacity = '0';
      return;
    }
    this.handDot.style.left = `${nx * 100}%`;
    this.handDot.style.top = `${ny * 100}%`;
    this.handDot.style.opacity = '1';
  }
}
