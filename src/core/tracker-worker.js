// tracker-worker.js — runs MediaPipe hand + pose inference OFF the main thread.
//
// The main thread grabs a webcam frame as an ImageBitmap and transfers it here;
// this worker runs detectForVideo for both models and posts the raw landmarks
// back. Keeping the (heavy) inference off the main thread means video, text and
// the cursor stay smooth even while tracking is active.
//
// Falls back automatically: if init() throws, main.js reverts to the original
// main-thread trackers (see TrackerHub.init / main.js).

import { HandLandmarker, PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const WASM_PATH = '/assets/mediapipe/wasm';
const HAND_MODEL = '/assets/mediapipe/models/hand_landmarker.task';
const POSE_MODEL = '/assets/mediapipe/models/pose_landmarker_full.task';

let hand = null;
let pose = null;
let ready = false;

async function init() {
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
  hand = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'GPU' },
    numHands: 2,
    runningMode: 'VIDEO',
  });
  pose = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: POSE_MODEL, delegate: 'GPU' },
    numPoses: 1,
    runningMode: 'VIDEO',
  });
  ready = true;
  self.postMessage({ type: 'ready' });
}

self.onmessage = async (e) => {
  const msg = e.data;

  if (msg.type === 'init') {
    try {
      await init();
    } catch (err) {
      self.postMessage({ type: 'error', error: String(err && err.message ? err.message : err) });
    }
    return;
  }

  if (msg.type === 'frame') {
    const { bitmap, ts } = msg;
    if (!ready) {
      bitmap.close && bitmap.close();
      return;
    }
    let handLandmarks = [];
    let poseLandmarks = [];
    try {
      const hr = hand.detectForVideo(bitmap, ts);
      handLandmarks = hr.landmarks ?? [];
      const pr = pose.detectForVideo(bitmap, ts);
      poseLandmarks = pr.landmarks ?? [];
    } catch (err) {
      // Per-frame inference hiccup — drop this frame, keep running.
    } finally {
      bitmap.close && bitmap.close();
    }
    self.postMessage({ type: 'result', handLandmarks, poseLandmarks });
  }
};
