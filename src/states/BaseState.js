// BaseState — superclass for every state. Owns its own root <div>, exposes
// an RAF helper that auto-cancels on exit, and gives subclasses a simple
// place to push timers/observer-disposers via this._disposers.

export class BaseState {
  constructor(name) {
    this.name = name;
    this.root = null;
    this._rafId = 0;
    this._loopRunning = false;
    this._disposers = [];
  }

  // Subclasses override and call super.enter(ctx).
  async enter(ctx) {
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
    this._loopRunning = false;
    cancelAnimationFrame(this._rafId);
    this._disposers.forEach((d) => {
      try {
        d();
      } catch (e) {
        console.warn('[state] disposer failed', e);
      }
    });
    this._disposers = [];
  }

  // Helper: schedule a callback every animation frame; auto-cancels on exit.
  loop(fn) {
    this._loopRunning = true;
    const tick = (t) => {
      if (!this._loopRunning) return;
      fn(t);
      // Re-check after fn — exit() may have flipped the flag synchronously
      // (super.exit runs sync code before its first await), and we must NOT
      // schedule another frame in that case.
      if (!this._loopRunning) return;
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  // Helper: setTimeout that registers a disposer so a mid-flight transition
  // doesn't fire stale callbacks.
  after(ms, fn) {
    const id = setTimeout(fn, ms);
    this._disposers.push(() => clearTimeout(id));
    return id;
  }

  observeTracker(tracker, fn) {
    const off = tracker.observe(fn);
    this._disposers.push(off);
  }
}
