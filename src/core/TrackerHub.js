// TrackerHub — drives the off-main-thread tracker worker.
//
// Owns one RAF loop (~20fps) that grabs a webcam frame as a transferable
// ImageBitmap, hands it to tracker-worker.js for inference, and feeds the raw
// landmarks back into the existing HandTracker / PoseTracker processing
// (_process) on the main thread. That processing is cheap; the heavy
// detectForVideo runs in the worker, so the main thread stays free.
//
// Backpressure: only one frame is in flight at a time (_busy), so a slow
// inference can't queue up frames. Passive screens (both trackers stopped via
// per-state pauseTrackers) skip the grab entirely — zero cost.
//
// 24/7 resilience: a stall watchdog releases a stuck in-flight frame, and if a
// ready worker goes silent (GPU loss / crash / OOM after days) or errors at
// runtime, the worker is TERMINATED and RECREATED automatically — the RAF loop
// keeps running and resumes once the fresh worker is ready. Boot is gated so a
// worker still loading WASM/models isn't killed prematurely.

const FPS = 20;
// In-flight stall timeout: a posted frame whose `result` never returns. Far
// above the normal round-trip (~tens of ms), so it never fires when healthy.
const STALL_MS = 2000;
// Consecutive stalls (≈ STALL_MS each) from a READY worker → recreate it.
const RESTART_AFTER_STALLS = 3;
// Max time for a (re)spawned worker to reach 'ready' before we give up / retry.
const BOOT_TIMEOUT_MS = 20000;

export class TrackerHub {
  constructor(webcam, handTracker, poseTracker) {
    this.webcam = webcam;
    this.handTracker = handTracker;
    this.poseTracker = poseTracker;
    this.worker = null;
    this.ready = false;
    this.running = false;
    this._busy = false;
    this._inflightSince = 0;
    this._stalls = 0;
    this._booting = false;     // worker spawned but not yet 'ready'
    this._restarting = false;  // re-entrancy guard for _restart()
    this._initDone = null;     // resolve fn for init()'s promise (first boot only)
    this._bootTimer = null;
  }

  _onMessage = (e) => {
    const msg = e.data;
    if (msg.type === 'ready') {
      this.ready = true;
      this._booting = false;
      this._restarting = false;
      this._stalls = 0;
      this._busy = false;
      if (this._bootTimer) { clearTimeout(this._bootTimer); this._bootTimer = null; }
      if (this._initDone) { const fn = this._initDone; this._initDone = null; fn(true); }
    } else if (msg.type === 'result') {
      this._busy = false;
      this._stalls = 0;
      // A throw here (malformed landmarks) must not kill the handler — drop the
      // frame and keep the pipeline alive.
      try {
        if (this.handTracker.running) this.handTracker._process(msg.handLandmarks);
        if (this.poseTracker.running) this.poseTracker._process(msg.poseLandmarks);
      } catch (err) {
        console.warn('[TrackerHub] landmark processing error (dropped frame)', err);
      }
    } else if (msg.type === 'error') {
      console.warn('[TrackerHub] worker init error', msg.error);
      if (this._initDone) { const fn = this._initDone; this._initDone = null; if (this._bootTimer) { clearTimeout(this._bootTimer); this._bootTimer = null; } fn(false); }
      // (post-boot worker-side errors: the boot timeout / stall watchdog retry)
    }
  };

  _onError = (err) => {
    console.warn('[TrackerHub] worker error', (err && err.message) || err);
    if (this._initDone) { const fn = this._initDone; this._initDone = null; if (this._bootTimer) { clearTimeout(this._bootTimer); this._bootTimer = null; } fn(false); return; }
    // Runtime crash after boot → recreate the worker so tracking recovers.
    this._restart();
  };

  _spawn() {
    this._booting = true;
    if (this._bootTimer) clearTimeout(this._bootTimer);
    this._bootTimer = setTimeout(() => this._onBootTimeout(), BOOT_TIMEOUT_MS);
    // Classic worker (NOT { type: 'module' }): MediaPipe loads its wasm glue via
    // importScripts(), which only exists in classic workers.
    const w = new Worker(new URL('./tracker-worker.js', import.meta.url));
    w.onmessage = this._onMessage;
    w.onerror = this._onError;
    this.worker = w;
    w.postMessage({ type: 'init' });
  }

  _onBootTimeout() {
    this._bootTimer = null;
    if (this._initDone) {
      console.warn('[TrackerHub] worker init timeout; falling back to main thread');
      const fn = this._initDone; this._initDone = null; fn(false);
      return;
    }
    console.warn('[TrackerHub] worker boot timeout — recreating');
    this._restart();
  }

  // Recreate a dead/unresponsive worker (post-boot). The RAF loop keeps running;
  // posting is gated on !_booting so the fresh worker isn't fed (or re-killed)
  // until it's ready, then results resume automatically.
  _restart() {
    if (this._restarting || !this.running) return;
    this._restarting = true;
    this.ready = false;
    this._busy = false;
    this._stalls = 0;
    console.warn('[TrackerHub] worker unresponsive — recreating');
    try { if (this.worker) this.worker.terminate(); } catch (e) { /* ignore */ }
    try { this._spawn(); } catch (e) { console.warn('[TrackerHub] recreate failed', e); }
    this._restarting = false;
  }

  // First-boot init: resolves true if the worker reaches 'ready', else false so
  // main.js falls back to the original main-thread trackers.
  async init() {
    return new Promise((resolve) => {
      this._initDone = resolve;
      try {
        this._spawn();
      } catch (err) {
        console.warn('[TrackerHub] worker create failed; falling back', err);
        const fn = this._initDone; this._initDone = null;
        if (this._bootTimer) { clearTimeout(this._bootTimer); this._bootTimer = null; }
        fn(false);
      }
    });
  }

  start() {
    if (this.running || !this.ready) return;
    this.running = true;
    const minInterval = 1000 / FPS;
    let last = 0;
    const loop = (now) => {
      if (!this.running) return;
      // Stall watchdog — release a frame whose `result` never came back; after a
      // few consecutive stalls assume the worker is dead and recreate it.
      if (this._busy && now - this._inflightSince > STALL_MS) {
        this._busy = false;
        this._stalls += 1;
        console.warn('[TrackerHub] inference stalled; releasing frame (stall ' + this._stalls + ')');
        if (this._stalls >= RESTART_AFTER_STALLS) this._restart();
      }
      const due = now - last >= minInterval;
      const needed = this.handTracker.running || this.poseTracker.running;
      if (due && needed && !this._busy && !this._booting && this.worker && this.webcam?.ready && this.webcam.video) {
        last = now;
        this._busy = true;
        this._inflightSince = now;
        createImageBitmap(this.webcam.video).then((bitmap) => {
          if (!this.running || !this.worker) { bitmap.close && bitmap.close(); this._busy = false; return; }
          // performance.now() is monotonic — satisfies detectForVideo's
          // strictly-increasing timestamp requirement.
          this.worker.postMessage({ type: 'frame', bitmap, ts: now }, [bitmap]);
        }).catch(() => { this._busy = false; });
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this._bootTimer) { clearTimeout(this._bootTimer); this._bootTimer = null; }
  }
}
