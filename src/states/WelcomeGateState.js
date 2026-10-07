// 0.5 웰컴 게이트 — the first hand interaction. Teaches "your hand controls
// this" and the dwell-to-confirm mechanic (the same one SeedSelect uses later),
// by waking a seed at the centre of the screen.
//
// Flow:
//   • Scene A — welcome + lab description (auto, ~5s).
//   • Scene B — hold the hand cursor over the seed to enter the introduction.
//     Gesture cues run once over the same scene before live input.

import { BaseState } from './BaseState.js';
import { RevealText } from '../ui/RevealText.js';
import { WebcamFeed } from '../ui/WebcamFeed.js';
import { InstrumentRing } from '../ui/InstrumentRing.js';
import { TutorialCard } from '../ui/TutorialCard.js';

// Welcome + lab intro (moved here from Intro slide 1, with its narration). The
// intro narrative now starts at the next beat, so this isn't said twice.
const GATE_WELCOME =
  'AI Herb Lab에 오신 것을 환영합니다<br>이곳은 나와 함께 자라나는 미래 가전을 직접 키워보는 연구소입니다';
const GATE_QUESTION = '당신의 AI Herb를 깨워보세요';
const GATE_HELPER = '한 손을 펴서 화면을 향해 들면, 화면 속 점이 손을 따라 움직여요';
// After the ghost demo, hand control over to the visitor explicitly — this is
// the "이제 따라 해보세요" step that makes the gate an active tutorial, not a
// passive demo. They must actually dwell on the button to proceed.
const GATE_TRYIT = '씨앗 위에서 손을 잠시 멈춰주세요';
// [B] Pre-capture notice — small, calm, lab tone (the actual capture happens in Analyzing).
const GATE_PRIVACY = '체험 중 사진이 촬영되며, 촬영된 데이터는 24시간 후 자동 삭제됩니다';

const SCENE_A_MS = 5200;   // welcome+desc read time before the question
const GATE_DWELL_MS = 2500;   // hold over the central seed

export class WelcomeGateState extends BaseState {
  constructor() {
    super('welcomeGate');
  }

  async enter(ctx) {
    await super.enter(ctx);
    Object.assign(this.root.style, { background: '#ffffff' });

    this.root.innerHTML = `
      <div class="gate-scene gate-scene--a is-on">
        <div class="gate-text headline"></div>
      </div>
      <div class="gate-scene gate-scene--b">
        <div class="gate-question guide-top"></div>
        <div class="gate-seed" data-v="yes" role="img" aria-label="손을 머물러 깨우는 AI Herb 씨앗">
          <div class="gate-seed-halo"></div>
          <img class="gate-seed-image" alt="AI Herb 씨앗" draggable="false">
        </div>
        <p class="gate-helper subhead"></p>
        <p class="gate-privacy"></p>
      </div>
    `;
    const sceneA = this.root.querySelector('.gate-scene--a');
    const sceneB = this.root.querySelector('.gate-scene--b');
    const btnEls = Array.from(this.root.querySelectorAll('.gate-seed'));
    this.root.querySelector('.gate-seed-image').src = ctx.config.data.seedHero ?? ctx.config.data.tokenFront;

    // Welcome (scene A) text.
    const welcomeMorph = new RevealText({ morphMs: 1600 });
    this.root.querySelector('.gate-text').appendChild(welcomeMorph.root);
    welcomeMorph.setInitial('');
    // Welcome narration (intro1) starts together with the text.
    requestAnimationFrame(() => {
      welcomeMorph.morphTo(GATE_WELCOME);
      ctx.audio?.play('intro1', { volume: 1 });
      this._narrationId = 'intro1';
    });

    // Question (scene B) text + helper.
    const questionMorph = new RevealText({ mode: 'fade' });
    this.root.querySelector('.gate-question').appendChild(questionMorph.root);
    questionMorph.setInitial('');
    this.root.querySelector('.gate-helper').textContent = GATE_HELPER;
    const privacyEl = this.root.querySelector('.gate-privacy');
    if (privacyEl) privacyEl.textContent = GATE_PRIVACY;
    this._disposers.push(() => { welcomeMorph.stop(); questionMorph.stop(); });

    // Dwell gauge that rides the cursor — same design language as the
    // SeedSelect dwell gauge (thin ring + brackets + continuous arc; NO
    // segmentation). The cursor's lavender disc stays as the centre.
    this.dwellGauge = new InstrumentRing({ variant: 'gatecursor', rings: true, tickRing: false, brackets: true, progress: true });
    this.dwellGauge.root.classList.add('gate-seed-gauge');
    sceneB.appendChild(this.dwellGauge.root);

    // Mirror webcam bubble — visitor sees themselves with the seed over their hand.
    this.webcamFeed = new WebcamFeed(ctx.webcam, { mode: 'bubble', poseTracker: ctx.poseTracker });
    this.root.appendChild(this.webcamFeed.root);
    this.webcamFeed.attach();

    // [1] Real cursor stays hidden through Scene A + the ghost demo so it never
    // overlaps the tutorial's demo cursor; shown only when control hands off.
    ctx.cursor.hide();
    ctx.cursor.setProgress(0);

    // ---- State -------------------------------------------------------
    let handPresent = false;
    let handX = window.innerWidth / 2;
    let handY = window.innerHeight / 2;
    let hovered = null;
    let dwellMs = 0;
    let gateActive = false; // enabled after the ghost demo
    let decided = false;
    let lastTs = performance.now();
    let phase = 'A';

    this.observeTracker(ctx.handTracker, (s) => {
      handPresent = s.present;
      if (s.present) {
        handX = s.x * window.innerWidth;
        handY = s.y * window.innerHeight;
        this.webcamFeed.setHandIndicator(s.x, s.y, true);
      } else {
        this.webcamFeed.setHandIndicator(0, 0, false);
      }
    });

    const select = () => {
      if (decided) return;
      decided = true;
      ctx.audio?.play('select', { volume: 0.9 });
      ctx.cursor.setProgress(0);
      this.machine.transition('intro');
    };

    const hitTest = (px, py) => {
      for (const b of btnEls) {
        const r = b.getBoundingClientRect();
        if (Math.hypot(px - (r.left + r.width / 2), py - (r.top + r.height / 2)) <= r.width * 0.56) {
          return b.dataset.v;
        }
      }
      return null;
    };

    // Go live: real cursor on, demo overlay cleared, "now you try" prompt.
    // Reached when the ghost demo finishes (onDone) OR early — the instant the
    // visitor raises a hand during Scene B — so an eager visitor never faces a
    // button with no cursor. Runs once.
    const activateGate = () => {
      if (gateActive) return;
      gateActive = true;
      this._tutorialCard?.destroy(); // clear the demo overlay if still showing
      this._tutorialCard = null;
      ctx.cursor.show();
      ctx.cursor.moveTo(handX, handY); // appear at the hand immediately
      lastTs = performance.now();
      const helperEl = this.root.querySelector('.gate-helper');
      if (helperEl) helperEl.textContent = GATE_TRYIT;
      sceneB.classList.add('awaiting-input');
    };

    this.loop(() => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastTs) / 1000);
      lastTs = now;
      if (this.paused) { ctx.audio?.fadeOut('gauge', 300); return; } // absence guard froze the gate

      // Eager-visitor fast path — a raised hand during Scene B activates the
      // live gate right away (ends the demo early) so the cursor is always
      // there when they reach for the button.
      if (phase === 'B' && !gateActive && handPresent) activateGate();

      if (handPresent && gateActive) ctx.cursor.moveTo(handX, handY);

      if (phase !== 'B' || !gateActive || decided) return;

      // The seed is the target. Keep confirmation feedback anchored to it.
      this.dwellGauge.root.style.left = '50%';
      this.dwellGauge.root.style.top = '50%';

      const target = handPresent ? hitTest(handX, handY) : null;
      if (target !== hovered) {
        hovered = target;
        dwellMs = 0;
        // Gauge-fill sound — starts when a button is engaged, fades on leave
        // (and on completion below).
        if (hovered) ctx.audio?.play('gauge', { volume: 0.9 });
        else ctx.audio?.fadeOut('gauge', 300);
      }
      for (const b of btnEls) b.classList.toggle('is-hover', b.dataset.v === hovered);

      if (hovered) {
        dwellMs += dt * 1000;
        const dur = GATE_DWELL_MS;
        const f = Math.min(1, dwellMs / dur);
        this.dwellGauge.setProgress(f);
        this.dwellGauge.root.classList.add('is-on');
        if (f >= 1) { ctx.audio?.fadeOut('gauge', 1500); select(hovered); return; } // gauge full → fade tail
      } else {
        this.dwellGauge.setProgress(0);
        this.dwellGauge.root.classList.remove('is-on');
      }
    });

    // Scene A → B handoff — hold for the welcome narration (+tail) so the voice
    // finishes before the question appears; fall back to SCENE_A_MS if no cue.
    const welcomeDur = ctx.audio?.getDuration?.('intro1');
    const sceneAMs = welcomeDur ? welcomeDur * 1000 + 800 : SCENE_A_MS;
    this.after(sceneAMs, () => {
      phase = 'B';
      sceneA.classList.remove('is-on');
      sceneB.classList.add('is-on');
      requestAnimationFrame(() => questionMorph.morphTo(GATE_QUESTION));
      this._startGhostDemo(ctx, activateGate);
      // Safety net: if the demo handoff hiccups (and no hand triggers the eager
      // path), still enable the gate so the visitor can start.
      this.after(9000, activateGate);
    });

    // [1] Absence guard — pause/reset if the visitor walks away.
    this.armAbsenceGuard(ctx);

    // Enter skips to intro (staff/QA).
    const onKey = (e) => { if (e.key === 'Enter') select('yes'); };
    window.addEventListener('keydown', onKey);
    this._disposers.push(() => window.removeEventListener('keydown', onKey));
  }

  // Tutorial-card demo: inside a lab observation window, a ghost cursor glides
  // up onto the button and its gauge fills slowly — teaching move-then-hold.
  // The card then expands to fullscreen into the real interaction.
  _startGhostDemo(ctx, onDone) {
    const card = new TutorialCard();
    const entryRoot = this.root;
    this._tutorialCard = card;
    card.mount(this.root);
    this._disposers.push(() => card.destroy());

    const ghost = document.createElement('div');
    ghost.className = 'gate-ghost-circle';
    card.stage.appendChild(ghost);
    const gg = new InstrumentRing({ variant: 'gatecursor', rings: true, tickRing: false, brackets: true, progress: true });
    gg.root.classList.add('gate-seed-gauge');
    gg.root.style.transition = 'left 1000ms ease, top 1000ms ease, opacity 220ms ease';
    card.stage.appendChild(gg.root);
    const place = (x, y) => { ghost.style.left = x; ghost.style.top = y; gg.root.style.left = x; gg.root.style.top = y; };
    place('30%', '72%');
    card.addTrail(30, 72, 50, 50);

    card.after(700, () => { ghost.style.opacity = '0.6'; card.setCaption('한 손바닥을 화면을 향하게 펴서 움직여요'); });
    card.after(1800, () => place('50%', '50%'));
    card.after(3400, () => {                               // dwell — gauge fills slowly
      card.setCaption('씨앗 위에서 손을 멈추면 체험이 시작돼요');
      gg.root.classList.add('is-on');
      const t0 = performance.now();
      const tick = () => {
        if (!card.active || this._exited || this.root !== entryRoot) return;
        const t = Math.min(1, (performance.now() - t0) / 2600);
        gg.setProgress(t); card.setPct(t);
        if (t < 1) this._ghostRaf = requestAnimationFrame(tick);
      };
      this._ghostRaf = requestAnimationFrame(tick);
      this._disposers.push(() => cancelAnimationFrame(this._ghostRaf));
    });
    card.after(6400, () => { ghost.style.opacity = '0'; gg.root.classList.remove('is-on'); });
    card.after(7000, async () => {
      try { await card.expand(); card.destroy(); }
      catch (e) { console.warn('[WelcomeGate] demo handoff failed', e); }
      if (this._exited || this.root !== entryRoot) return;
      if (this._tutorialCard === card) this._tutorialCard = null;
      onDone();
    });
  }

  async exit() {
    if (this._narrationId) this.ctx?.audio?.stop(this._narrationId);
    this.ctx?.audio?.stop('gauge');
    this.ctx?.cursor.hide();
    this.ctx?.cursor.setProgress(0);
    this.webcamFeed?.detach();
    await super.exit();
  }
}
