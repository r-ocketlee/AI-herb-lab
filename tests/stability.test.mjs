import test from 'node:test';
import assert from 'node:assert/strict';
import { BaseState } from '../src/states/BaseState.js';
import { StateMachine } from '../src/core/StateMachine.js';
import { HandTracker } from '../src/core/HandTracker.js';
import { PoseTracker } from '../src/core/PoseTracker.js';

function environment(t) {
  let nextId = 0;
  const raf = new Map();
  const makeElement = () => ({
    className: '', isConnected: false,
    classList: { add() {}, remove() {} },
    getBoundingClientRect() {}, remove() { this.isConnected = false; },
  });
  const stage = { appendChild(el) { el.isConnected = true; } };
  const keys = ['document', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const originals = keys.map(k => Object.getOwnPropertyDescriptor(globalThis, k));
  globalThis.document = { createElement: makeElement, getElementById: () => stage };
  globalThis.requestAnimationFrame = fn => { raf.set(++nextId, fn); return nextId; };
  globalThis.cancelAnimationFrame = id => raf.delete(id);
  t.after(() => keys.forEach((key, i) => {
    if (originals[i]) Object.defineProperty(globalThis, key, originals[i]);
    else delete globalThis[key];
  }));
  return {
    raf,
    frame(now) {
      const queued = [...raf.entries()];
      raf.clear();
      for (const [, fn] of queued) fn(now);
    },
  };
}
const originalTimeout = globalThis.setTimeout;

test('a reused state enables tutorial completion on all 100 entries', async t => {
  environment(t);
  const state = new BaseState('seedSelect');
  let enabled = 0;
  for (let i = 0; i < 100; i++) {
    await state.enter({});
    // SeedSelect/Bloom finishDemo share this exit guard.
    const finishDemo = () => { if (state._exited) return; enabled++; };
    finishDemo();
    assert.equal(state.paused, false);
    state.paused = true;
    await state.exit();
    assert.equal(state._exited, true);
  }
  assert.equal(enabled, 100);
});

test('leaving a screen silences timers and input before its fade completes', async t => {
  const env = environment(t);
  const state = new BaseState('seedSelect');
  await state.enter({});
  let calls = 0, observer;
  state.observeTracker({ observe(fn) { observer = fn; return () => {}; } }, () => calls++);
  state.after(0, () => calls++);
  state.loop(() => calls++);
  state.beginExit();
  observer({ present: true });
  env.frame(100);
  await new Promise(resolve => originalTimeout(resolve, 10));
  assert.equal(calls, 0);
  await state.exit();
});

test('old queued frames and tracker notifications cannot act on a later entry', async t => {
  const env = environment(t);
  const state = new BaseState('bloom');
  await state.enter({});
  let calls = 0, observer;
  state.loop(() => calls++);
  const oldFrame = [...env.raf.values()][0];
  state.observeTracker({ observe(fn) { observer = fn; return () => {}; } }, () => calls++);
  await state.exit();
  await state.enter({});
  state.loop(() => calls++);
  oldFrame(100);
  observer({ present: true });
  assert.equal(calls, 0);
  assert.equal(env.raf.size, 1);
  await state.exit();
});

test('state machine marks an outgoing screen exited before awaiting its exit', async t => {
  environment(t);
  const state = new BaseState('outgoing');
  const next = new BaseState('next');
  let release;
  const fading = new Promise(resolve => { release = resolve; });
  let observedExitFlag = false;
  state.exit = async () => { observedExitFlag = state._exited; await fading; };
  const machine = new StateMachine({});
  machine.register('outgoing', state);
  machine.register('next', next);
  await machine.start('outgoing');
  let screenFadeStarted = false;
  state.root.classList.remove = name => { if (name === 'is-active') screenFadeStarted = true; };
  const transition = machine.transition('next');
  assert.equal(observedExitFlag, true);
  assert.equal(screenFadeStarted, true, 'screen fade starts while text exit is still pending');
  assert.equal(machine.currentName, 'outgoing', 'next scene waits for exit cleanup');
  release();
  await transition;
  assert.equal(machine.currentName, 'next');
});

for (const Tracker of [HandTracker, PoseTracker]) {
  test(`${Tracker.name}: a transient inference error does not stop later frames`, t => {
    const env = environment(t);
    t.mock.method(console, 'warn', () => {});
    const tracker = new Tracker({});
    let attempts = 0;
    tracker._step = () => { attempts++; if (attempts === 1) throw Error('GPU/frame interruption'); };
    tracker.start();
    env.frame(100);
    assert.equal(env.raf.size, 1);
    env.frame(200);
    assert.equal(attempts, 2);
    tracker.stop();
    assert.equal(env.raf.size, 0);
  });

  test(`${Tracker.name}: 100 stop/start cycles keep exactly one inference loop`, t => {
    const env = environment(t);
    const tracker = new Tracker({});
    let attempts = 0;
    tracker._step = () => { attempts++; };
    tracker.start();
    const oldFrame = [...env.raf.values()][0];
    for (let i = 0; i < 100; i++) { tracker.stop(); tracker.start(); }
    assert.equal(env.raf.size, 1);
    oldFrame(100);
    assert.equal(attempts, 0);
    assert.equal(env.raf.size, 1);
    env.frame(100);
    assert.equal(attempts, 1);
    tracker.stop();
  });

  test(`${Tracker.name}: worker-fed mode never starts a main-thread loop`, t => {
    const env = environment(t);
    const tracker = new Tracker({});
    tracker.fedExternally = true;
    tracker.start();
    assert.equal(tracker.running, true);
    assert.equal(env.raf.size, 0);
    tracker.stop();
  });
}
