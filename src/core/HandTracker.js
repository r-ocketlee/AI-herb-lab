// HandTracker — wraps MediaPipe Tasks Vision HandLandmarker. Skeleton-level:
// initializes lazily, runs detect-for-video each animation frame when started,
// and emits a normalized state (palm center, isPinching) via observers.
//
// Dev / no-webcam fallback: a mouse-driven mock can be enabled with
// enableMockFromMouse(true). main.js wires this on startup until a real camera
// stream connects.

import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export class HandTracker {
  constructor(webcam) {
    this.webcam = webcam;
    this.landmarker = null;
    this.running = false;
    this.observers = new Set();

    this.state = {
      present: false,
      // Normalized (0..1) palm position, origin top-left, x-flipped to match
      // the mirrored on-screen webcam feed. EMA-smoothed (see _step) so raw
      // MediaPipe jitter doesn't propagate into the carousel's rotation /
      // dwell logic.
      x: 0.5,
      y: 0.5,
      isPinching: false,
      raw: null,
    };
    // EMA factor — 0.4 means new sample weighs 40%, previous filtered value 60%.
    // Filters out ~5–10 px/frame of detection noise while staying responsive
    // (settles within ~3 frames).
    this._smoothAlpha = 0.4;

    this._mockEnabled = false;
    this._onMouseMove = (e) => {
      this.state.present = true;
      this.state.x = 1 - e.clientX / window.innerWidth;
      this.state.y = e.clientY / window.innerHeight;
      this.state.isPinching = e.buttons === 1;
      this._notify();
    };
  }

  enableMockFromMouse(enabled) {
    if (enabled && !this._mockEnabled) {
      window.addEventListener('mousemove', this._onMouseMove);
      window.addEventListener('mousedown', this._onMouseMove);
      window.addEventListener('mouseup', this._onMouseMove);
      this._mockEnabled = true;
    } else if (!enabled && this._mockEnabled) {
      window.removeEventListener('mousemove', this._onMouseMove);
      window.removeEventListener('mousedown', this._onMouseMove);
      window.removeEventListener('mouseup', this._onMouseMove);
      this._mockEnabled = false;
    }
  }

  async init() {
    if (this.landmarker) return;
    try {
      const fileset = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
      );
      this.landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        numHands: 1,
        runningMode: 'VIDEO',
      });
    } catch (err) {
      console.warn('[HandTracker] init failed; staying in mock mode', err);
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this._step();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
  }

  observe(fn) {
    this.observers.add(fn);
    return () => this.observers.delete(fn);
  }

  _step() {
    if (!this.landmarker || !this.webcam?.ready) return;
    const ts = performance.now();
    const result = this.landmarker.detectForVideo(this.webcam.video, ts);
    const hand = result.landmarks?.[0];
    if (!hand || hand.length < 21) {
      if (this.state.present) {
        this.state.present = false;
        this.state.isPinching = false;
        this._notify();
      }
      return;
    }
    // Index 9 = middle-finger MCP, a stable proxy for palm center.
    const palm = hand[9];
    const thumbTip = hand[4];
    const indexTip = hand[8];
    const pinchDist = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);

    // Pinch hysteresis — require a TIGHT pinch to enter, but accept a looser
    // grip to stay engaged. Without this, fingers naturally drifting near the
    // threshold flicker isPinching on/off during normal hand motion.
    const PINCH_ENTER = 0.035;
    const PINCH_EXIT = 0.075;
    let isPinching = this.state.isPinching;
    if (isPinching) {
      if (pinchDist > PINCH_EXIT) isPinching = false;
    } else {
      if (pinchDist < PINCH_ENTER) isPinching = true;
    }

    const rawX = 1 - palm.x; // mirror
    const rawY = palm.y;
    // EMA smoothing — but if hand just (re)appeared, snap to raw position
    // instead of easing in from the previous stale state.
    const a = this._smoothAlpha;
    if (this.state.present) {
      this.state.x = a * rawX + (1 - a) * this.state.x;
      this.state.y = a * rawY + (1 - a) * this.state.y;
    } else {
      this.state.x = rawX;
      this.state.y = rawY;
    }
    this.state.present = true;
    this.state.isPinching = isPinching;
    this.state.raw = hand;
    this._notify();
  }

  _notify() {
    this.observers.forEach((fn) => fn(this.state));
  }
}
