// 1. 씨앗을 심다 — proximity-based seed planting (Sommerer-style).
//
// Interaction:
//   • The visitor's hand position is shown on screen as the SEED itself
//     (token-front.png) — not as an abstract cursor. It follows the hand
//     with eased smoothing, like they're carrying a small glowing object.
//   • The spherical carousel rotates continuously based on how far the seed
//     is from horizontal center: left → rotates left, right → rotates right,
//     proportional to the offset. A small deadzone in the middle keeps the
//     disc still when the seed is centered.
//   • When the seed approaches an appliance (within PROXIMITY_PX), that
//     appliance reacts: a soft warm glow, a scale-up, and a magnetic pull
//     drawing the seed toward it. While in proximity, the carousel stops
//     rotating — the visitor has "engaged" with that item.
//   • The active appliance accumulates dwell. The progress ring around it
//     fills over DWELL_MS. Leaving its proximity zone resets the dwell.
//   • At 100% — seed is "absorbed". A white burst expands from the appliance,
//     other items fade out, and we transition to AnalyzingState.

import { BaseState } from './BaseState.js';
import { SphereCarousel, applianceGlowRgb } from '../ui/SphereCarousel.js';
import { WebcamFeed } from '../ui/WebcamFeed.js';
import { RevealText } from '../ui/RevealText.js';
import { InstrumentRing } from '../ui/InstrumentRing.js';
import { TutorialCard } from '../ui/TutorialCard.js';

const GUIDE_TEXT = '손을 뻗어 원하는 가전에 씨앗 형태의 AI Herb을 가져가 보세요';
const DEMO_GUIDE = '이렇게 씨앗을 심어 보세요';
const ACTIVE_GUIDE = '원하는 가전 위에서 손을 잠시 멈춰주세요';
const SEED_HINT = '손바닥을 좌우로 움직여 가전을 둘러볼 수 있어요'; // bottom hint during live interaction

const DWELL_MS = 5000;             // hold-to-select duration (5·4·3·2·1 countdown)
const PROXIMITY_PX = 220;          // seed must be within this to engage an item
const SEED_EASE = 0.24;            // lerp factor for seed → hand target (raised: less input lag, snappier rotation)
const ROTATION_DEADZONE = 0.12;    // |normX| under this → no rotation (kept — center stillness preserved)
const MAX_ROT_SPEED = 0.042;       // radians per frame at full extension (raised ~2× for responsiveness; smoothing keeps it from whipping)
const ROT_RESPONSE = 0.75;         // <1 = concave curve so rotation ramps up quickly just outside the deadzone
const SNAP_STRENGTH = 0.06;        // gentle pull that aligns the nearest appliance to center once rotation stops
const MAGNET_STRENGTH = 0.30;      // proximity → seed pull (softer so the seed glides past appliances rather than snapping into each one)
const ABSORB_MS = 900;             // selection animation length
const SEED_ABSORB_MIN_SCALE = 0.4; // seed shrinks 1.0 → 0.4 over the dwell (sucked in)

export class SeedSelectState extends BaseState {
  constructor() {
    super('seedSelect');
  }

  async enter(ctx) {
    await super.enter(ctx);

    const items = shuffle(ctx.config.appliances.slice());

    this.root.innerHTML = `<p class="guide-top"></p><p class="guide-bottom"></p>`;

    // Top guide. The demo morphs DEMO_GUIDE in; after it finishes the active
    // prompt ACTIVE_GUIDE takes over.
    const guideEl = this.root.querySelector('.guide-top');
    this.guideMorph = new RevealText({ mode: 'fade' });
    guideEl.appendChild(this.guideMorph.root);
    this.guideMorph.setInitial('');
    this._disposers.push(() => this.guideMorph?.stop());

    this.carousel = new SphereCarousel(items, { autoMagnet: false });
    await this.carousel.preload();
    this.root.appendChild(this.carousel.root);
    this.carousel.start();

    // Dwell gauge — anchored to the SEED (fills around it) so "hold still here"
    // is learned from the seed itself. Countdown number in the centre, appliance
    // name above. Hidden until the seed engages an appliance.
    this.dwellRing = new InstrumentRing({
      variant: 'seeddwell',
      rings: false,
      tickRing: false,
      brackets: true,
      progress: true,
      segments: 5, // 5 chunks ≈ 5 seconds — each filled chunk reads as a second
    });
    this.focusLabel = document.createElement('div');
    this.focusLabel.className = 'focus-label';
    this.dwellRing.root.appendChild(this.focusLabel);
    this.root.appendChild(this.dwellRing.root);

    // Webcam bubble with a hand indicator — the seed icon is drawn over the
    // visitor's hand in the mirror feed so they connect "that seed = my hand".
    this.webcamFeed = new WebcamFeed(ctx.webcam, {
      mode: 'bubble',
      handIcon: ctx.config.data.tokenFront,
      poseTracker: ctx.poseTracker,
    });
    this.root.appendChild(this.webcamFeed.root);
    this.webcamFeed.attach();

    // Seed visual — the hand position, shown as the token image itself.
    const seed = document.createElement('img');
    seed.className = 'seed-cursor';
    seed.src = ctx.config.data.tokenFront ?? '/assets/images/token-front.png';
    seed.draggable = false;
    seed.style.opacity = '0'; // appears when hand enters frame (after the demo)
    this.root.appendChild(seed);
    this.seed = seed;

    // Cursor (lavender disc) is not used in this state.
    ctx.cursor.hide();

    // Selection flash overlay — created when dwell completes.
    this.flash = null;

    // State variables
    let handPresent = false;
    let seedX = window.innerWidth / 2;
    let seedY = window.innerHeight / 2;
    let seedTargetX = seedX;
    let seedTargetY = seedY;

    let proximitySlot = null;
    let proximityStartMs = 0;
    let fired = false;
    let demoActive = true; // gate real interaction until the onboarding demo ends
    let finishDemo = () => {};

    this.observeTracker(ctx.handTracker, (s) => {
      handPresent = s.present;
      // The welcome gate has already taught the hand interaction. If a visitor
      // is ready and raises a hand, hand control over immediately instead of
      // making them wait through the full demonstration.
      if (s.present && demoActive) finishDemo();
      // Mirror indicator — show the seed over the hand in the webcam bubble
      // (suppressed during the demo so the two don't compete).
      this.webcamFeed.setHandIndicator(s.x, s.y, s.present && !demoActive);
      if (!s.present) {
        seed.style.opacity = '0';
        return;
      }
      if (!demoActive) seed.style.opacity = '1';
      seedTargetX = s.x * window.innerWidth;
      seedTargetY = s.y * window.innerHeight;
    });

    this.loop(() => {
      if (fired) return;
      // During the onboarding demo, real input is ignored; the demo itself
      // drives the carousel (rotation demo step), so we don't force it still.
      if (demoActive) return;
      if (this.paused) { ctx.audio?.fadeOut('gauge', 300); return; } // absence guard froze selection

      // 1. Ease seed toward hand target.
      seedX += (seedTargetX - seedX) * SEED_EASE;
      seedY += (seedTargetY - seedY) * SEED_EASE;

      // 2. Find nearest projected item within PROXIMITY_PX.
      const items = this.carousel.getProjectedItems();
      let nearest = null;
      let nearestDist = Infinity;
      for (const p of items) {
        if (p.depth > 0.25 * 1500 /* RADIUS */) continue;
        const dist = Math.hypot(seedX - p.sx, seedY - p.sy);
        if (dist < PROXIMITY_PX && dist < nearestDist) {
          nearestDist = dist;
          nearest = p;
        }
      }

      // 3. Magnetic pull on the seed toward the active item.
      if (nearest) {
        const pull = (1 - nearestDist / PROXIMITY_PX) * MAGNET_STRENGTH;
        seedX += (nearest.sx - seedX) * pull;
        seedY += (nearest.sy - seedY) * pull;
      }

      // 4. Carousel rotation — driven by seed horizontal offset. Outside the
      //    deadzone, a concave response curve ramps speed up quickly so the
      //    carousel follows the hand readily; SMOOTHING inside the carousel
      //    keeps it gliding rather than snapping. When rotation stops (hand in
      //    the deadzone with nothing engaged, or hand gone), the carousel
      //    gently aligns the nearest appliance to center so it's easy to land on.
      if (nearest && handPresent) {
        // Once an appliance is engaged, keep it still while the dwell gauge
        // fills. The visitor should never have to chase a moving selection.
        this.carousel.setAngularVel(0, 0);
      } else if (handPresent) {
        const normX = (seedX - window.innerWidth / 2) / (window.innerWidth / 2);
        const sign = Math.sign(normX);
        const mag = Math.max(0, Math.abs(normX) - ROTATION_DEADZONE) / (1 - ROTATION_DEADZONE);
        if (mag > 0) {
          this.carousel.setAngularVel(0, sign * Math.pow(mag, ROT_RESPONSE) * MAX_ROT_SPEED);
        } else {
          this.carousel.setAngularVel(0, 0);
          if (!nearest) this.carousel.softSnapToCenter(SNAP_STRENGTH);
        }
      } else {
        this.carousel.setAngularVel(0, 0);
        this.carousel.softSnapToCenter(SNAP_STRENGTH);
      }

      // 5. Dwell — gauge + countdown around the seed; resets the instant the
      //    seed leaves proximity (the arc unwinds via its CSS transition).
      let dwellProgress = 0;
      if (nearest && handPresent) {
        if (nearest.node.slotId !== proximitySlot) {
          proximitySlot = nearest.node.slotId;
          proximityStartMs = performance.now();
          ctx.audio?.play('gauge', { volume: 0.9 }); // gauge-fill sound (fades when full / on leave)
          const a = nearest.node.appliance;
          this.focusLabel.innerHTML = `
            <div class="appliance-label__main">${a.name ?? ''}</div>
            <div class="appliance-label__model">${a.model ?? ''}</div>
          `;
          // Tint the dwell gauge to this appliance's identity color.
          this.dwellRing.setProgressColor(`rgb(${applianceGlowRgb(a.id)})`);
        }
        const elapsed = performance.now() - proximityStartMs;
        dwellProgress = Math.min(1, elapsed / DWELL_MS);
        this.carousel.setHighlight(proximitySlot, dwellProgress);

        // Suck-in — as the gauge fills, pull the seed visibly into the appliance
        // (accelerating near the end) so it reads as being absorbed.
        const suck = dwellProgress * dwellProgress;
        seedX += (nearest.sx - seedX) * 0.5 * suck;
        seedY += (nearest.sy - seedY) * 0.5 * suck;

        this.dwellRing.root.style.left = `${seedX}px`;
        this.dwellRing.root.style.top = `${seedY}px`;
        this.dwellRing.setProgress(dwellProgress);
        this.dwellRing.root.classList.add('is-on');

        if (dwellProgress >= 1) {
          fired = true;
          ctx.audio?.fadeOut('gauge', 1500); // gauge full → fade the remaining tail
          this._triggerAbsorb(ctx, nearest);
          return;
        }
      } else if (proximitySlot !== null) {
        proximitySlot = null;
        proximityStartMs = 0;
        this.carousel.setHighlight(null, 0);
        this.dwellRing.setProgress(0); // arc unwinds — "leaving resets it"
        this.dwellRing.root.classList.remove('is-on');
        this.focusLabel.innerHTML = '';
        ctx.audio?.fadeOut('gauge', 300); // left the appliance → stop the gauge sound
      }

      // 6. Render seed — position, dwell shrink, and fade during dwell so the
      //    countdown number reads clearly in the centre.
      const seedScale = 1 - (1 - SEED_ABSORB_MIN_SCALE) * dwellProgress;
      seed.style.left = `${seedX}px`;
      seed.style.top = `${seedY}px`;
      seed.style.transform = `translate(-50%, -50%) scale(${seedScale})`;
      if (handPresent) seed.style.opacity = String(1 - 0.85 * dwellProgress);
    });

    // [1] Absence guard — pause/reset if the visitor walks away.
    this.armAbsenceGuard(ctx);

    // Onboarding ghost demo — runs once, non-blocking, after the state fades in.
    finishDemo = () => {
      if (this._exited || !demoActive) return; // idempotent — runs once
      demoActive = false;
      proximitySlot = null;
      proximityStartMs = 0;
      try { this._demoCard?.destroy(); } catch (e) { /* ignore */ }
      this._demoCard = null;
      this.guideMorph.morphTo(ACTIVE_GUIDE);
      const gb = this.root.querySelector('.guide-bottom');
      if (gb) { gb.textContent = SEED_HINT; gb.classList.add('is-on'); }
    };
    this._startGhostDemo(ctx, finishDemo);
    // Safety net: never let a demo hiccup (expand/destroy throw, missed timer,
    // dead webcam) strand the visitor on a frozen screen — force the live
    // interaction on shortly after the demo's natural end no matter what.
    this.after(12000, finishDemo);
  }

  // Tutorial-card demo: inside a lab observation window, ① the ghost sweeps
  // left/right and the carousel rotates behind the window ("move = rotate"),
  // then ② it settles on centre and the dwell gauge fills ("hold = select").
  // The cues fade away over the live carousel.
  _startGhostDemo(ctx, onDone) {
    const card = new TutorialCard();
    const entryRoot = this.root;
    card.mount(this.root);
    this._disposers.push(() => card.destroy());
    this._demoCard = card;

    const gseed = document.createElement('img');
    gseed.className = 'ghost-seed';
    gseed.src = ctx.config.data.tokenFront ?? '/assets/images/token-front.png';
    gseed.draggable = false;
    gseed.style.left = '50%';
    gseed.style.top = '50%';
    card.stage.appendChild(gseed);

    const gring = new InstrumentRing({ variant: 'seeddwell', rings: false, tickRing: false, brackets: true, progress: true, segments: 5 });
    gring.root.classList.add('is-ghost');
    gring.root.style.left = '50%';
    gring.root.style.top = '50%';
    card.stage.appendChild(gring.root);
    const trail = card.addTrail(24, 50, 76, 50);

    // ① Rotation demo — sweep left/right; the carousel spins behind the window.
    card.after(700, () => { gseed.style.opacity = '0.5'; card.setCaption('손바닥을 좌우로 움직이면 가전이 돌아가요'); });
    card.after(1600, () => { gseed.style.left = '24%'; this.carousel.setAngularVel(0, -0.013); });
    card.after(3400, () => { gseed.style.left = '76%'; this.carousel.setAngularVel(0, 0.013); });
    card.after(5200, () => { gseed.style.left = '50%'; this.carousel.setAngularVel(0, 0); if (trail) trail.style.opacity = '0'; });

    // ② Select demo — settle on centre, gauge fills around the seed.
    card.after(6000, () => {
      card.setCaption('원하는 가전 위에서 손바닥을 멈추세요');
      gring.root.classList.add('is-on');
      const t0 = performance.now();
      const tick = () => {
        if (!card.active || this._exited || this.root !== entryRoot) return;
        const t = Math.min(1, (performance.now() - t0) / 2600);
        gring.setProgress(t); card.setPct(t);
        if (t < 1) this._ghostRaf = requestAnimationFrame(tick);
      };
      this._ghostRaf = requestAnimationFrame(tick);
      this._disposers.push(() => cancelAnimationFrame(this._ghostRaf));
      gseed.style.transform = 'translate(-50%, -50%) scale(0.7)';
      gseed.style.opacity = '0.28';
    });
    card.after(8900, () => { gseed.style.opacity = '0'; gring.root.classList.remove('is-on'); });
    card.after(9400, async () => {
      try { await card.expand(); card.destroy(); }
      catch (e) { console.warn('[SeedSelect] demo handoff failed', e); }
      if (this._exited || this.root !== entryRoot) return;
      if (this._demoCard === card) this._demoCard = null;
      onDone();
    });
  }

  _triggerAbsorb(ctx, target) {
    const appliance = target.node.appliance;
    console.log('[SeedSelect] absorbed →', appliance.id);

    // White radial burst originating from the target item's screen position.
    const flash = document.createElement('div');
    flash.className = 'seed-select-flash';
    flash.style.left = `${target.sx}px`;
    flash.style.top = `${target.sy}px`;
    this.root.appendChild(flash);
    this.flash = flash;

    // Hide the seed (it's been absorbed) and start fade-out of the rest of
    // the carousel by ramping the canvas opacity.
    this.seed.style.transition = 'opacity 300ms ease, transform 600ms ease';
    this.seed.style.opacity = '0';
    this.seed.style.transform = 'translate(-50%, -50%) scale(0.4)';
    this.carousel.root.style.transition = 'opacity 600ms ease';
    this.carousel.root.style.opacity = '0';

    this.after(ABSORB_MS, () => {
      ctx.setAppliance(appliance.id);
      ctx.setFlower(ctx.config.pickRandomFlowerKey(appliance.id));
      this.machine.transition('analyzing');
    });
  }

  async exit() {
    this.ctx?.audio?.stop('gauge');
    this.carousel?.stop();
    this.webcamFeed?.detach();
    this.flash?.remove();
    await this.morphOutGuide();
    await super.exit();
  }
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
