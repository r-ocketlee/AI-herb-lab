// PoseTracker — MediaPipe PoseLandmarker wrapper. Exposes a normalized state
// used by:
//   • IdleState — shoulderWidth threshold for "person approached"
//   • BloomState — wristY for the hand-raise-to-bloom interaction
//
// Falls back to a keyboard-driven mock so the flow is debuggable without a
// physical camera. ArrowUp/ArrowDown nudge wristY; KeyP toggles presence.

import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

export class PoseTracker {
  constructor(webcam) {
    this.webcam = webcam;
    this.landmarker = null;
    this.running = false;
    this.observers = new Set();

    this.state = {
      present: false,
      shoulderWidth: 0,
      // Normalized (0..1) wrist Y position, 0 = top of frame.
      // We track the higher of the two wrists so either hand can drive Bloom.
      wristY: 1,
      raw: null,
    };

    this._mockEnabled = false;
    this._onKey = (e) => {
      if (e.key === 'p' || e.key === 'P') {
        this.state.present = !this.state.present;
        this.state.shoulderWidth = this.state.present ? 0.3 : 0;
        this._notify();
      } else if (e.key === 'ArrowUp') {
        this.state.present = true;
        this.state.wristY = Math.max(0, this.state.wristY - 0.05);
        this._notify();
      } else if (e.key === 'ArrowDown') {
        this.state.present = true;
        this.state.wristY = Math.min(1, this.state.wristY + 0.05);
        this._notify();
      }
    };
  }

  enableMockFromKeyboard(enabled) {
    if (enabled && !this._mockEnabled) {
      window.addEventListener('keydown', this._onKey);
      this._mockEnabled = true;
    } else if (!enabled && this._mockEnabled) {
      window.removeEventListener('keydown', this._onKey);
      this._mockEnabled = false;
    }
  }

  async init() {
    if (this.landmarker) return;
    try {
      const fileset = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
      );
      this.landmarker = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        numPoses: 1,
        runningMode: 'VIDEO',
      });
    } catch (err) {
      console.warn('[PoseTracker] init failed; staying in mock mode', err);
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
    const pose = result.landmarks?.[0];
    if (!pose || pose.length < 17) {
      if (this.state.present) {
        this.state.present = false;
        this.state.shoulderWidth = 0;
        this._notify();
      }
      return;
    }
    // 11 = left shoulder, 12 = right shoulder (MediaPipe indices).
    // 15 = left wrist, 16 = right wrist.
    const ls = pose[11];
    const rs = pose[12];
    const lw = pose[15];
    const rw = pose[16];
    const shoulderWidth = Math.hypot(ls.x - rs.x, ls.y - rs.y);
    const wristY = Math.min(lw?.y ?? 1, rw?.y ?? 1);

    this.state.present = true;
    this.state.shoulderWidth = shoulderWidth;
    this.state.wristY = wristY;
    this.state.raw = pose;
    this._notify();
  }

  _notify() {
    this.observers.forEach((fn) => fn(this.state));
  }
}
