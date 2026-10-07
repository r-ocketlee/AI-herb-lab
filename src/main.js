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
import { TrackerHub } from './core/TrackerHub.js';
import { AudioManager } from './core/AudioManager.js';
import { Cursor } from './ui/Cursor.js';
import { LabFrame } from './ui/LabFrame.js';

import { IdleState } from './states/IdleState.js';
import { WelcomeGateState } from './states/WelcomeGateState.js';
import { IntroState } from './states/IntroState.js';
import { IntroFinaleState } from './states/IntroFinaleState.js';
import { SeedSelectState } from './states/SeedSelectState.js';
import { AnalyzingState } from './states/AnalyzingState.js';
import { SeedPlantState } from './states/SeedPlantState.js';
import { BloomState } from './states/BloomState.js';
import { CardState } from './states/CardState.js';

const ORDER = ['idle', 'welcomeGate', 'intro', 'introFinale', 'seedSelect', 'analyzing', 'seedPlant', 'bloom', 'card'];

// On-screen error log — the kiosk runs fullscreen (--kiosk) with no DevTools
// access, so surface uncaught errors / promise rejections visibly. The box is
// created only when something actually throws; it stays invisible during
// healthy operation, so it doubles as a 24/7 fault indicator.
function installErrorOverlay() {
  let box = null;
  const show = (label, err) => {
    try {
      if (!box) {
        box = document.createElement('div');
        Object.assign(box.style, {
          position: 'fixed', left: '0', right: '0', bottom: '0', zIndex: '100000',
          maxHeight: '42vh', overflow: 'auto', background: 'rgba(58,0,0,0.92)',
          color: '#ffd9d9', font: "13px ui-monospace, Menlo, monospace",
          whiteSpace: 'pre-wrap', padding: '10px 14px 12px', borderTop: '2px solid #ff6b6b',
        });
        (document.body || document.documentElement).appendChild(box);
      }
      const msg = (err && (err.stack || err.message)) || String(err);
      const line = document.createElement('div');
      line.style.cssText = 'margin:0 0 8px;border-bottom:1px solid rgba(255,255,255,0.15);padding-bottom:6px';
      line.textContent = '[' + label + '] ' + msg;
      box.appendChild(line);
      while (box.childNodes.length > 8) box.removeChild(box.firstChild);
    } catch (e) { /* never let the logger itself throw */ }
  };
  window.addEventListener('error', (e) => show('error', e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => show('promise', e.reason));
}
installErrorOverlay();

async function main() {
  warmFonts();
  const config = await AssetConfig.load();

  const webcam = new Webcam();
  const handTracker = new HandTracker(webcam);
  const poseTracker = new PoseTracker(webcam);
  const audio = new AudioManager();
  const dev = createDevOverlay();
  const cursor = new Cursor();
  cursor.mount();

  // Global lab-instrumentation overlay — mounted once, sits above every state
  // and below the cursor. The state machine drives its phase readout.
  const labFrame = new LabFrame();
  labFrame.mount();
  labFrame.setVisible(false); // [7] hidden for visitors; the dev toggle reveals it

  const ctx = new AppContext({ config, handTracker, poseTracker, audio, dev });
  ctx.webcam = webcam;
  ctx.cursor = cursor;
  ctx.labFrame = labFrame;

  const fsm = new StateMachine(ctx);
  fsm.register('idle', new IdleState());
  fsm.register('welcomeGate', new WelcomeGateState());
  fsm.register('intro', new IntroState());
  fsm.register('introFinale', new IntroFinaleState());
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
  let cameraLive = false;
  try {
    await webcam.start();
    cameraLive = true;
    // Off-main-thread inference: run MediaPipe in a worker so it can't stutter
    // the video/text/cursor. Falls back to main-thread trackers if the worker
    // can't initialize, so the kiosk always tracks.
    const hub = new TrackerHub(webcam, handTracker, poseTracker);
    const workerOk = await hub.init();
    if (workerOk) {
      handTracker.fedExternally = true;
      poseTracker.fedExternally = true;
      handTracker.start(); // worker mode: just marks running
      poseTracker.start();
      hub.start();         // single frame loop feeds both trackers
      ctx.trackerHub = hub;
      console.log('[main] trackers running in worker (off-main-thread)');
    } else {
      await Promise.all([handTracker.init(), poseTracker.init()]);
      handTracker.start();
      poseTracker.start();
      console.log('[main] trackers running on main thread (worker fallback)');
    }
  } catch (err) {
    console.warn('[main] webcam/tracker init failed', err);
  }

  poseTracker.enableMockFromKeyboard(true);

  wireDevKeys(fsm, ctx, audio);

  // [7] Webcam-drop recovery — only armed when the camera actually started, so
  // dev/no-camera mock mode is never blocked by the recovery screen.
  if (cameraLive) setupWebcamWatchdog(webcam, handTracker, poseTracker);

  // Kiosk path: Chrome runs with --autoplay-policy=no-user-gesture-required,
  // so the AudioContext starts running without a keypress. Fire-and-forget
  // (don't block boot); the first-keypress path in wireDevKeys is the dev
  // fallback when that flag isn't set.
  audio.unlock().then(() => preloadSounds(ctx, audio)).catch(() => {});

  await fsm.start('idle');
}

// Force-decode every local font face up front so text renders without a
// first-use flash and works offline (all fonts are local — no CDN).
function warmFonts() {
  if (!document.fonts?.load) return;
  const faces = ['400 32px "LGEIHeadline"', '600 32px "LGEIHeadline"', '500 32px "Pretendard"'];
  const load = () => faces.forEach((f) => document.fonts.load(f).catch(() => {}));
  load();
  // Retry once the font registry is ready, in case the stylesheet hadn't been
  // parsed when the first call ran (module scripts can run before CSS loads).
  document.fonts.ready.then(load);
}

// [7] Poll webcam health; on a dropped stream show a recovery screen and keep
// retrying the connection. On success, (re)start the trackers and hide it.
function setupWebcamWatchdog(webcam, handTracker, poseTracker) {
  const overlay = createRecoveryOverlay();
  let failing = false;
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    if (webcam.isHealthy()) {
      if (failing) { failing = false; overlay.hide(); }
      return;
    }
    failing = true;
    overlay.show();
    busy = true;
    try {
      const ok = await webcam.reconnect();
      if (ok) {
        try { await Promise.all([handTracker.init(), poseTracker.init()]); } catch (e) { /* ignore */ }
        handTracker.start();
        poseTracker.start();
        failing = false;
        overlay.hide();
      }
    } finally {
      busy = false;
    }
  }, 4000);
}

function createRecoveryOverlay() {
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'fixed', inset: '0', display: 'none',
    alignItems: 'center', justifyContent: 'center',
    background: '#F1E8F6', color: '#2a1f3a', zIndex: '99990',
    fontFamily: "'LGEIHeadline', 'Pretendard', system-ui, sans-serif",
    fontSize: '32px', letterSpacing: '-0.02em',
  });
  el.textContent = '카메라를 확인해주세요';
  document.body.appendChild(el);
  return {
    show() { el.style.display = 'flex'; },
    hide() { el.style.display = 'none'; },
  };
}

function createDevOverlay() {
  const overlay = document.getElementById('dev-overlay');
  const banner = document.getElementById('state-banner');
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
    // Both QA surfaces (corner banner + detail overlay) flip together.
    toggle() {
      overlay.hidden = !overlay.hidden;
      if (banner) banner.hidden = overlay.hidden;
      return !overlay.hidden; // [7] true when the dev surfaces are now visible
    },
  };
}

// Lazily load every cue declared in config.sounds once audio is unlocked.
// decodeAudioData needs the context, so this can only run after unlock().
// Guarded so the boot-time attempt (kiosk) and the first-keypress attempt
// (dev fallback) don't double-load.
let _soundsPreloaded = false;
async function preloadSounds(ctx, audio) {
  if (_soundsPreloaded) return;
  _soundsPreloaded = true;
  const sounds = ctx.config.data.sounds ?? {};
  await Promise.all(
    Object.entries(sounds).map(([id, url]) =>
      audio.load(id, url).catch((err) =>
        console.warn(`[audio] failed to load "${id}" (${url})`, err),
      ),
    ),
  );
}

function wireDevKeys(fsm, ctx, audio) {
  let firstKey = true;
  window.addEventListener('keydown', (e) => {
    if (firstKey) {
      audio.unlock().then(() => preloadSounds(ctx, audio)).catch(() => {});
      firstKey = false;
    }
    if (e.key === '`') {
      const devVisible = ctx.dev.toggle();
      ctx.labFrame?.setVisible(devVisible); // [7] lab HUD shows/hides with dev mode
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
