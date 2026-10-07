// 0. 대기 — attract loop + start gate. A soft mesh gradient plays while empty.
// When a visitor is detected, the mirror feed + start guidance fade in and the
// hand cursor begins following. Once a hand is recognized and held steadily,
// we advance to the Welcome Gate (the first real hand interaction).
//
// Single-subject: HandLandmarker/PoseLandmarker both run with a count of 1, so
// only one person's hand drives the cursor even in a crowd.

import { BaseState } from './BaseState.js';
import { RevealText } from '../ui/RevealText.js';
import { MeshGradient } from '../ui/MeshGradient.js';
import { WebcamFeed } from '../ui/WebcamFeed.js';
import { InstrumentRing } from '../ui/InstrumentRing.js';

const GUIDE_HTML =
  '바닥의 표시 위에 한 분만 서주세요<br>한 손을 펴서 화면을 향해 들면 인터랙션이 시작됩니다';

const HAND_HOLD_MS = 3000; // hand held this long (gauge fills) → advance to the gate
const ENTRY_GRACE_MS = 700; // ignore hand input briefly after the screen opens, so a
                            // hand still in frame from before / a slow first frame can't fire instantly
const IDLE_REFRESH_MS = 300000; // 5 min of empty attract → reload to clear memory

export class IdleState extends BaseState {
  constructor() {
    super('idle');
  }

  async enter(ctx) {
    await super.enter(ctx);
    ctx.resetSession();

    const stage = document.getElementById('stage');
    if (stage) stage.style.background = '';

    this.root.innerHTML = `
      <div class="idle-greeting">
        <h1 class="headline"></h1>
      </div>
    `;
    Object.assign(this.root.style, { flexDirection: 'column', background: '#F1E8F6' });

    this.background = new MeshGradient();
    this.root.prepend(this.background.root);
    this.background.start();
    this._disposers.push(() => this.background?.dispose());

    const greetingEl = this.root.querySelector('.idle-greeting');
    this.morph = new RevealText({ morphMs: 1800 });
    this.root.querySelector('.headline').appendChild(this.morph.root);
    this.morph.setInitial('');
    this._disposers.push(() => this.morph.stop());

    // Mirror webcam bubble — hidden during the attract loop (gradient only),
    // fades in together with the guidance when a visitor is detected.
    this.webcamFeed = new WebcamFeed(ctx.webcam, { mode: 'bubble', poseTracker: ctx.poseTracker });
    this.webcamFeed.root.style.zIndex = '6'; // above the white greeting plate (z 2)
    this.webcamFeed.root.style.opacity = '0';
    this.webcamFeed.root.style.transition = 'opacity 500ms ease';
    this.root.appendChild(this.webcamFeed.root);
    this.webcamFeed.attach();

    // Entry gauge — rides the hand cursor and fills over HAND_HOLD_MS while the
    // hand is held; resets if the hand leaves frame.
    this.entryGauge = new InstrumentRing({ variant: 'gatecursor', rings: true, tickRing: false, brackets: true, progress: true });
    this.root.appendChild(this.entryGauge.root);

    const { detection } = ctx.config;

    let shown = false;
    let handPresent = false;
    let handSince = null; // timestamp the current continuous hand-presence began; null = no hand
    let manualPresence = false;
    const enterTs = performance.now();
    let lastTs = enterTs;
    let advancing = false;
    let idleMs = 0;

    const reveal = (on) => {
      if (on === shown) return;
      shown = on;
      greetingEl?.classList.toggle('show', on);
      this.webcamFeed.root.style.opacity = on ? '1' : '0';
      if (on) { this.morph.morphTo(GUIDE_HTML); ctx.cursor.show(); }
      else { this.morph.setInitial(''); ctx.cursor.hide(); handSince = null; }
    };

    this.observeTracker(ctx.poseTracker, (s) => {
      const personHere = (s.present && s.shoulderWidth >= detection.shoulderWidthEnterThreshold) || manualPresence;
      // Show UI when a person is detected OR a hand is in frame.
      reveal(personHere || handPresent);
    });

    this.observeTracker(ctx.handTracker, (s) => {
      handPresent = s.present;
      if (s.present) {
        reveal(true);
        const px = s.x * window.innerWidth;
        const py = s.y * window.innerHeight;
        ctx.cursor.moveTo(px, py);
        this.entryGauge.root.style.left = `${px}px`;
        this.entryGauge.root.style.top = `${py}px`;
        this.webcamFeed.setHandIndicator(s.x, s.y, true);
      } else {
        this.webcamFeed.setHandIndicator(0, 0, false);
      }
    });

    this.loop(() => {
      const now = performance.now();
      // Clamp dt so a janky/long first frame (kiosk init, dropped frames) can't
      // inject a multi-second jump into any time accumulator below.
      const dt = Math.min(now - lastTs, 250);
      lastTs = now;
      if (advancing) return;

      // Hold the hand steadily for HAND_HOLD_MS → Welcome Gate.
      // Measured from the timestamp the hand FIRST appeared (real wall-clock),
      // not by accumulating per-frame dt — so frame stutter can't fill the
      // gauge early, and the gauge tracks true elapsed time exactly. A short
      // entry grace ignores any hand already in frame as the screen opens.
      const settled = now - enterTs >= ENTRY_GRACE_MS;
      if (shown && handPresent && settled) {
        if (handSince === null) handSince = now; // hand just (re)appeared → start the clock fresh
        const heldMs = now - handSince;
        this.entryGauge.setProgress(Math.min(1, heldMs / HAND_HOLD_MS));
        this.entryGauge.root.classList.add('is-on');
        if (heldMs >= HAND_HOLD_MS) {
          advancing = true;
          this.machine.transition('welcomeGate');
        }
      } else {
        handSince = null; // hand gone (or still in grace) → reset, gauge empties
        this.entryGauge.setProgress(0);
        this.entryGauge.root.classList.remove('is-on');
      }

      // [6] Long-run stability — after 5 min of empty attract (nobody present),
      // reload to clear memory. Only ever fires in Idle with no one around, so
      // it can never interrupt an experience.
      if (!shown && !handPresent && !manualPresence) {
        idleMs += dt;
        if (idleMs >= IDLE_REFRESH_MS) { console.log('[Idle] idle timeout → reload'); location.reload(); return; }
      } else {
        idleMs = 0;
      }

      // Manual (Enter) path keeps the greeting alive even with no pose ticks.
      if (manualPresence) reveal(true);
    });

    // Enter — simulate a present visitor and advance (staff / QA / fallback).
    const onKeyDown = (e) => {
      if (e.key === 'Enter' && !advancing) {
        manualPresence = true;
        advancing = true;
        this.machine.transition('welcomeGate');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    this._disposers.push(() => window.removeEventListener('keydown', onKeyDown));
  }

  async exit() {
    this.webcamFeed?.detach();
    await this.morphOutGuide();
    await super.exit();
  }
}
