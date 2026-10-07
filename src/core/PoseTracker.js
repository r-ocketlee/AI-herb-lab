// PoseTracker — MediaPipe PoseLandmarker wrapper. Exposes a normalized state
// used by:
//   • IdleState — shoulderWidth threshold for "person approached"
//   • BloomState — wristY for the hand-raise-to-bloom interaction
//
// Falls back to a keyboard-driven mock so the flow is debuggable without a
// physical camera. ArrowUp/ArrowDown nudge wristY; KeyP toggles presence.

import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

// `full` (vs the previous `lite`) — noticeably better at detecting people
// who are farther from the camera / smaller in frame, which matters in the
// wide exhibition space. Heavier per-frame, but fine on the kiosk GPU.
// Served locally so hand/pose detection keeps working even with NO internet at
// the venue (the kiosk must not depend on a CDN). Files live in
// assets/mediapipe/ and are copied into dist/ by scripts/copy-static.mjs.
// Still `full` (not `lite`) — deliberately chosen for detecting people farther
// from the camera in the wide exhibition space.
const MODEL_URL = '/assets/mediapipe/models/pose_landmarker_full.task';

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
    if (this.fedExternally) return; // worker (TrackerHub) owns inference
    if (this.landmarker) return;
    try {
      const fileset = await FilesetResolver.forVisionTasks('/assets/mediapipe/wasm');
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
      const generation = this._loopGeneration = (this._loopGeneration || 0) + 1;
      // Worker mode: TrackerHub feeds results via _process(); no own RAF loop.
      if (this.fedExternally) return;
      const minInterval = 1000 / 15;   // 15fps로 추론 제한 (숫자만 바꾸면 fps 조절)
      let last = 0;
      const loop = (now) => {
        if (!this.running || this._loopGeneration !== generation) return;
        try {
          if (now - last >= minInterval) { last = now; this._step(); }
        } catch (err) {
          // A bad camera/GPU frame must not permanently end tracking.
          console.warn('[PoseTracker] inference frame failed; retrying', err);
        }
        if (this.running && this._loopGeneration === generation) {
          this._rafId = requestAnimationFrame(loop);
        }
      };
      this._rafId = requestAnimationFrame(loop);
    }

  stop() {
    this.running = false;
    this._loopGeneration = (this._loopGeneration || 0) + 1;
    cancelAnimationFrame(this._rafId);
  }

  observe(fn) {
    this.observers.add(fn);
    return () => this.observers.delete(fn);
  }

  _step() {
    if (!this.landmarker || !this.webcam?.ready) return;
    const ts = performance.now();
    const result = this.landmarker.detectForVideo(this.webcam.video, ts);
    this._process(result.landmarks ?? []);
  }

  // Process raw pose landmarks (array of poses) into the normalized state.
  // Called by _step (main-thread fallback) or by TrackerHub (worker mode).
  _process(landmarks) {
    const pose = landmarks?.[0];
    if (!pose || pose.length < 17) {
      // Debounce loss so brief detection drops don't flicker presence (which
      // would falsely trigger the absence guard).
      this._lost = (this._lost || 0) + 1;
      if (this._lost > 5 && this.state.present) {
        this.state.present = false;
        this.state.shoulderWidth = 0;
        this._notify();
      }
      return;
    }
    this._lost = 0;
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
