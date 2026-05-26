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
import { SphereCarousel } from '../ui/SphereCarousel.js';
import { WebcamFeed } from '../ui/WebcamFeed.js';

const DWELL_MS = 5000;
const PROXIMITY_PX = 220;          // seed must be within this to engage an item
const SEED_EASE = 0.18;            // lerp factor for seed → hand target
const ROTATION_DEADZONE = 0.12;    // |normX| under this → no rotation
const MAX_ROT_SPEED = 0.020;       // radians per frame at full extension — full rotation in ~5.2s
const MAGNET_STRENGTH = 0.42;      // proximity → seed pull (max, when adjacent) — strong enough that the seed tracks a moving item
const ABSORB_MS = 900;             // selection animation length
const SEED_ABSORB_MIN_SCALE = 0.7; // seed shrinks from 1.0 → 0.7 over the dwell

export class SeedSelectState extends BaseState {
  constructor() {
    super('seedSelect');
  }

  async enter(ctx) {
    await super.enter(ctx);

    const items = shuffle(ctx.config.appliances.slice());

    this.root.innerHTML = `
      <p class="guide-top">손을 움직여 가전에 씨앗을 심어보세요</p>
      <div class="seed-center-name"></div>
    `;
    this.centerNameEl = this.root.querySelector('.seed-center-name');

    this.carousel = new SphereCarousel(items, { autoMagnet: false });
    await this.carousel.preload();
    this.root.appendChild(this.carousel.root);
    this.carousel.start();

    this.webcamFeed = new WebcamFeed(ctx.webcam, { mode: 'bubble' });
    this.root.appendChild(this.webcamFeed.root);
    this.webcamFeed.attach();

    // Seed visual — the hand position, shown as the token image itself.
    const seed = document.createElement('img');
    seed.className = 'seed-cursor';
    seed.src = ctx.config.data.tokenFront ?? '/assets/images/token-front.png';
    seed.draggable = false;
    seed.style.opacity = '0'; // appears when hand enters frame
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

    this.observeTracker(ctx.handTracker, (s) => {
      handPresent = s.present;
      if (!s.present) {
        seed.style.opacity = '0';
        return;
      }
      seed.style.opacity = '1';
      seedTargetX = s.x * window.innerWidth;
      seedTargetY = s.y * window.innerHeight;
    });

    this.loop(() => {
      if (fired) return;

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

      // 3. Magnetic pull on the seed toward the active item — stronger as
      //    the seed gets closer.
      if (nearest) {
        const pull = (1 - nearestDist / PROXIMITY_PX) * MAGNET_STRENGTH;
        seedX += (nearest.sx - seedX) * pull;
        seedY += (nearest.sy - seedY) * pull;
      }

      // 4. Carousel rotation — driven by seed horizontal offset. Continues
      //    even during proximity engagement so the disc never feels frozen;
      //    the magnetic pull is tuned strong enough that the seed tracks a
      //    moving item.
      if (handPresent) {
        const normX = (seedX - window.innerWidth / 2) / (window.innerWidth / 2);
        const sign = Math.sign(normX);
        const mag = Math.max(0, Math.abs(normX) - ROTATION_DEADZONE) / (1 - ROTATION_DEADZONE);
        this.carousel.setAngularVel(0, sign * mag * MAX_ROT_SPEED);
      } else {
        this.carousel.setAngularVel(0, 0);
      }

      // 5. Highlight + dwell.
      let dwellProgress = 0;
      if (nearest && handPresent) {
        if (nearest.node.slotId !== proximitySlot) {
          proximitySlot = nearest.node.slotId;
          proximityStartMs = performance.now();
          if (this.centerNameEl) {
            const a = nearest.node.appliance;
            this.centerNameEl.innerHTML = `
              <div class="appliance-label__main">${a.name ?? ''}</div>
              <div class="appliance-label__model">${a.model ?? ''}</div>
            `;
          }
        }
        const elapsed = performance.now() - proximityStartMs;
        dwellProgress = Math.min(1, elapsed / DWELL_MS);
        this.carousel.setHighlight(proximitySlot, dwellProgress);

        if (dwellProgress >= 1) {
          fired = true;
          this._triggerAbsorb(ctx, nearest);
          return;
        }
      } else if (proximitySlot !== null) {
        proximitySlot = null;
        proximityStartMs = 0;
        this.carousel.setHighlight(null, 0);
        if (this.centerNameEl) this.centerNameEl.innerHTML = '';
      }

      // 6. Render seed — position + dwell-driven shrink (as if being absorbed).
      const seedScale = 1 - (1 - SEED_ABSORB_MIN_SCALE) * dwellProgress;
      seed.style.left = `${seedX}px`;
      seed.style.top = `${seedY}px`;
      seed.style.transform = `translate(-50%, -50%) scale(${seedScale})`;
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
      const flowerKey = ctx.config.pickRandomFlowerKey();
      ctx.setAppliance(appliance.id);
      ctx.setFlower(flowerKey);
      this.machine.transition('analyzing');
    });
  }

  async exit() {
    this.carousel?.stop();
    this.webcamFeed?.detach();
    this.flash?.remove();
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
