// Minimal async state machine. Each state implements enter(ctx, payload)
// and exit(ctx); transition() awaits exit→enter and tags the active root
// for CSS fade-in/out via the .is-active class.

export class StateMachine {
  constructor(ctx) {
    this.ctx = ctx;
    this.states = new Map();
    this.currentName = null;
    this.current = null;
    this.transitioning = false;
  }

  register(name, state) {
    this.states.set(name, state);
    state.machine = this;
  }

  async start(name, payload) {
    await this.transition(name, payload);
  }

  async transition(name, payload = {}) {
    if (this.transitioning) {
      console.warn(`[fsm] ignored transition to ${name}: already transitioning`);
      return;
    }
    // Backstop: silently drop self-transitions. If a state's update loop
    // re-fires transition('X') after we already settled in X, that's a bug
    // in the caller but no reason to tear down and rebuild the state.
    if (this.currentName === name) {
      console.warn(`[fsm] dropped self-transition to ${name}`);
      return;
    }
    const next = this.states.get(name);
    if (!next) throw new Error(`[fsm] unknown state: ${name}`);

    this.transitioning = true;
    const prev = this.current;
    const prevName = this.currentName;
    console.log(`[fsm] ${prevName ?? '(none)'} → ${name}`);
    try {
      if (prev) {
        await prev.exit?.(this.ctx);
        prev.root?.classList.remove('is-active');
        // Match the .state CSS transition duration so the fade actually
        // completes before we tear the prev root out of the DOM.
        await wait(800);
        prev.root?.remove();
      }
      this.currentName = name;
      this.current = next;
      this.ctx.dev?.setState(name);
      await next.enter?.(this.ctx, payload);
      if (next.root && !next.root.isConnected) {
        document.getElementById('stage').appendChild(next.root);
      }
      next.root?.getBoundingClientRect();
      next.root?.classList.add('is-active');
      console.log(`[fsm] ${name} entered, root in DOM:`, !!next.root?.isConnected);
    } catch (err) {
      console.error(`[fsm] transition ${prevName} → ${name} FAILED`, err);
      // Show the error visibly so kiosk QA doesn't end up staring at a blank
      // screen wondering what broke.
      showFatalError(name, err);
      throw err;
    } finally {
      this.transitioning = false;
    }
  }
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function showFatalError(state, err) {
  const div = document.createElement('div');
  Object.assign(div.style, {
    position: 'fixed',
    inset: '0',
    background: '#fff0f0',
    color: '#7a0000',
    padding: '40px',
    fontFamily: 'ui-monospace, Menlo, monospace',
    fontSize: '18px',
    whiteSpace: 'pre-wrap',
    overflow: 'auto',
    zIndex: '99999',
  });
  div.textContent = `[ERROR entering state: ${state}]\n\n${err?.stack ?? err}`;
  document.body.appendChild(div);
}
