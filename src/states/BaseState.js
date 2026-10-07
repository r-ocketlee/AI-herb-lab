// BaseState — superclass for every state. Owns its own root <div>, exposes
// an RAF helper that auto-cancels on exit, and gives subclasses a simple
// place to push timers/observer-disposers via this._disposers.

import { PauseOverlay } from '../ui/PauseOverlay.js';

export class BaseState {
  constructor(name) {
    this.name = name;
    this.root = null;
    this._rafId = 0;
    this._loopRunning = false;
    this._disposers = [];
    this._exited = false;
    // Set true by the absence guard while the pause overlay is up; interactive
    // states check it in their loop to freeze input.
    this.paused = false;
  }

  // Subclasses override and call super.enter(ctx).
  async enter(ctx) {
    // State instances are reused for every visitor. Leaving this true blocks
    // tutorial completion (and its fallback) from the second visit onward.
    this._exited = false;
    this.paused = false;
    this.ctx = ctx;
    this.root = document.createElement('section');
    this.root.className = `state state--${this.name}`;
    document.getElementById('stage').appendChild(this.root);
  }

  async exit() {
    // Order matters: flag flip first so any in-flight tick (one that started
    // and called transition() on us before we got here) won't schedule another
    // frame after fn() returns. cancelAnimationFrame alone isn't enough — when
    // exit() is reached via `await transition() → await prev.exit()`, the
    // currently-running tick may schedule a NEW rAF after this cancel call.
    this.beginExit();
    this._disposers.forEach((d) => {
      try {
        d();
      } catch (e) {
        console.warn('[state] disposer failed', e);
      }
    });
    this._disposers = [];
  }

  // Called before a subclass's asynchronous fade-out. Timers/input must stop
  // immediately, not 700ms later when the subclass reaches super.exit().
  beginExit() {
    this._exited = true;
    this._loopRunning = false;
    cancelAnimationFrame(this._rafId);
  }

  // Helper: schedule a callback every animation frame; auto-cancels on exit.
  loop(fn) {
    const root = this.root;
    this._loopRunning = true;
    const tick = (t) => {
      if (!this._loopRunning || this._exited || this.root !== root) return;
      try {
        fn(t);
      } catch (e) {
        // A single bad frame (transient null landmark, mid-transition DOM gap,
        // WebGL/Three hiccup) must NOT kill the loop — skipping the RAF reschedule
        // would freeze the whole screen for the rest of the session. Drop it.
        console.warn('[BaseState] loop frame dropped', e);
      }
      // Re-check after fn — exit() may have flipped the flag synchronously
      // (super.exit runs sync code before its first await), and we must NOT
      // schedule another frame in that case.
      if (!this._loopRunning || this._exited || this.root !== root) return;
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  // Helper: setTimeout that registers a disposer so a mid-flight transition
  // doesn't fire stale callbacks.
  after(ms, fn) {
    if (this._exited) return;
    const root = this.root;
    const id = setTimeout(() => {
      if (!this._exited && this.root === root) return fn();
    }, ms);
    this._disposers.push(() => clearTimeout(id));
    return id;
  }

  observeTracker(tracker, fn) {
    const root = this.root;
    const off = tracker.observe((s) => {
      if (!this._exited && this.root === root) fn(s);
    });
    this._disposers.push(off);
  }

  // Stop the AI trackers this screen doesn't use, and auto-restart them on exit.
  // MediaPipe inference is the main stutter source, so passive narration /
  // cutscene screens pause both; screens that only need the hand pause pose.
  pauseTrackers({ hand = true, pose = true } = {}) {
    if (hand) this.ctx.handTracker.stop();
    if (pose) this.ctx.poseTracker.stop();
    this._disposers.push(() => {
      if (hand) this.ctx.handTracker.start();
      if (pose) this.ctx.poseTracker.start();
    });
  }

  // [1] Absence guard for INTERACTIVE states. After PAUSE_MS with no person,
  // shows the pause overlay (state frozen via this.paused) and counts down;
  // returning resumes, timeout resets to Idle. Auto-cleaned on exit.
  armAbsenceGuard(ctx) {
    const PAUSE_MS = 20000;
    const RESET_MS = 20000;
    let lastSeen = performance.now();
    let pauseStart = 0;
    let overlay = null;
    this.paused = false;

    const seen = () => { lastSeen = performance.now(); };
    this._disposers.push(ctx.poseTracker.observe((s) => { if (s.present) seen(); }));
    this._disposers.push(ctx.handTracker.observe((s) => { if (s.present) seen(); }));

    const resume = () => {
      this.paused = false;
      overlay?.destroy();
      overlay = null;
      lastSeen = performance.now();
    };

    const id = setInterval(() => {
      const now = performance.now();
      const absent = now - lastSeen;
      if (!this.paused) {
        if (absent >= PAUSE_MS) {
          this.paused = true;
          pauseStart = now;
          ctx.cursor?.hide();
          overlay = new PauseOverlay();
          overlay.mount(this.root);
        }
      } else if (absent < 600) {
        resume(); // someone stepped back in
      } else {
        overlay?.setRemain(Math.ceil((RESET_MS - (now - pauseStart)) / 1000));
        if (now - pauseStart >= RESET_MS) {
          clearInterval(id);
          this.machine.transition('idle'); // idle.enter() resets the session
        }
      }
    }, 200);
    this._disposers.push(() => clearInterval(id));
  }

  // [1] For AUTO states — at natural completion, continue only if someone is
  // still here; otherwise release to Idle.
  advanceOrIdle(ctx, next) {
    this.machine.transition(ctx.poseTracker?.state?.present ? next : 'idle');
  }

  // Helper: morphs out any guide / morph text fields the subclass has set
  // (this.guideMorph or this.morph) over `holdMs` and then resolves. Call
  // from a subclass's `exit()` BEFORE `await super.exit()` so the blob
  // dissolve plays before the state's CSS fade tears the DOM down.
  async morphOutGuide(holdMs = 700) {
    const targets = [this.guideMorph, this.morph].filter(Boolean);
    if (targets.length === 0) return;
    targets.forEach((m) => {
      try { m.morphTo('', holdMs); } catch (e) { /* swallow */ }
    });
    await new Promise((r) => setTimeout(r, holdMs));
  }
}
