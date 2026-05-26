// Entry — bootstraps singletons, registers states, kicks off Idle.
//
// Dev keybinds (always wired; the overlay can be hidden but the hotkeys help
// QA jump around the flow):
//   `   — toggle dev overlay
//   0-5 — jump to a state by index
//   n   — advance to the next state in the canonical order
//   r   — reset session and return to Idle

import { AssetConfig } from './core/AssetConfig.js';
import { AppContext } from './core/AppContext.js';
import { StateMachine } from './core/StateMachine.js';
import { Webcam } from './core/Webcam.js';
import { HandTracker } from './core/HandTracker.js';
import { PoseTracker } from './core/PoseTracker.js';
import { AudioManager } from './core/AudioManager.js';
import { Cursor } from './ui/Cursor.js';

import { IdleState } from './states/IdleState.js';
import { SeedSelectState } from './states/SeedSelectState.js';
import { AnalyzingState } from './states/AnalyzingState.js';
import { SeedPlantState } from './states/SeedPlantState.js';
import { BloomState } from './states/BloomState.js';
import { CardState } from './states/CardState.js';

const ORDER = ['idle', 'seedSelect', 'analyzing', 'seedPlant', 'bloom', 'card'];

async function main() {
  const config = await AssetConfig.load();

  const webcam = new Webcam();
  const handTracker = new HandTracker(webcam);
  const poseTracker = new PoseTracker(webcam);
  const audio = new AudioManager();
  const dev = createDevOverlay();
  const cursor = new Cursor();
  cursor.mount();

  const ctx = new AppContext({ config, handTracker, poseTracker, audio, dev });
  ctx.webcam = webcam;
  ctx.cursor = cursor;

  const fsm = new StateMachine(ctx);
  fsm.register('idle', new IdleState());
  fsm.register('seedSelect', new SeedSelectState());
  fsm.register('analyzing', new AnalyzingState());
  fsm.register('seedPlant', new SeedPlantState());
  fsm.register('bloom', new BloomState());
  fsm.register('card', new CardState());

  // The kiosk is a webcam-only experience — no mouse-driven mock for hand
  // input. If the camera fails to start we just log it; the on-screen cursor
  // will stay hidden until real hand frames flow.
  //
  // Pose keyboard mock (P toggle, arrow keys) is kept for QA: it doesn't
  // intrude on normal kiosk operation but lets staff verify state transitions
  // without standing in front of the camera.
  try {
    await webcam.start();
    await Promise.all([handTracker.init(), poseTracker.init()]);
    handTracker.start();
    poseTracker.start();
  } catch (err) {
    console.warn('[main] webcam/tracker init failed', err);
  }

  poseTracker.enableMockFromKeyboard(true);

  wireDevKeys(fsm, ctx, audio);

  await fsm.start('idle');
}

function createDevOverlay() {
  const overlay = document.getElementById('dev-overlay');
  const stateEl = document.getElementById('dev-state');
  const applianceEl = document.getElementById('dev-appliance');
  const flowerEl = document.getElementById('dev-flower');
  const bannerEl = document.getElementById('state-banner-name');
  return {
    setState(name) {
      stateEl.textContent = name;
      if (bannerEl) bannerEl.textContent = name;
    },
    setAppliance(id) { applianceEl.textContent = id ?? '-'; },
    setFlower(key) { flowerEl.textContent = key ?? '-'; },
    toggle() { overlay.hidden = !overlay.hidden; },
  };
}

function wireDevKeys(fsm, ctx, audio) {
  let firstKey = true;
  window.addEventListener('keydown', (e) => {
    if (firstKey) {
      audio.unlock().catch(() => {});
      firstKey = false;
    }
    if (e.key === '`') {
      ctx.dev.toggle();
      return;
    }
    if (e.key === 'r' || e.key === 'R') {
      ctx.resetSession();
      fsm.transition('idle');
      return;
    }
    if (e.key === 'n' || e.key === 'N') {
      const i = ORDER.indexOf(fsm.currentName);
      const next = ORDER[(i + 1) % ORDER.length];
      // Random appliance/flower if jumping past selection.
      if (next === 'analyzing' && !ctx.session.applianceId) {
        const a = ctx.config.appliances[Math.floor(Math.random() * ctx.config.appliances.length)];
        ctx.setAppliance(a.id);
        ctx.setFlower(ctx.config.pickRandomFlowerKey());
      }
      fsm.transition(next);
      return;
    }
    if (/^[0-5]$/.test(e.key)) {
      const target = ORDER[Number(e.key)];
      if (target === 'analyzing' || target === 'seedPlant' || target === 'bloom' || target === 'card') {
        if (!ctx.session.applianceId) {
          const a = ctx.config.appliances[Math.floor(Math.random() * ctx.config.appliances.length)];
          ctx.setAppliance(a.id);
          ctx.setFlower(ctx.config.pickRandomFlowerKey());
        }
      }
      fsm.transition(target);
    }
  });
}

main().catch((err) => {
  console.error('[main] boot failed', err);
  document.body.innerHTML = `<pre style="padding:40px;color:#a00;white-space:pre-wrap">${err?.stack ?? err}</pre>`;
});
