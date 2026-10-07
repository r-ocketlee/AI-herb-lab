// IntroFinaleState — the closing beat of the narrative onboarding before
// SeedSelect. After the 4-card intro, this screen presents the SEED as the
// hero: a large centered seed visual (image or video, set via config.seedHero)
// rises in softly, with the call-to-action "자, 이 씨앗을 심어보세요" sitting at
// the top-center in the same size/position as the app's other guide texts
// (.guide-top). Holds briefly, then advances to SeedSelect.
//
// The seed asset is supplied later — until config.seedHero resolves to a real
// file, a soft glowing placeholder disc stands in (so it never looks broken).

import { BaseState } from './BaseState.js';
import { RevealText } from '../ui/RevealText.js';

const HOLD_MS = 5500;
const FINALE_TEXT = '자, 이제 직접 AI Herb를 심어보세요';

export class IntroFinaleState extends BaseState {
  constructor() {
    super('introFinale');
  }

  async enter(ctx) {
    await super.enter(ctx);
    this.pauseTrackers(); // passive narration — no hand/presence input needed


    Object.assign(this.root.style, { background: '#ffffff' });

    // Top-center guide text (.guide-top) — same size/position as the other
    // interaction guides; + a large centered seed hero below it.
    this.root.innerHTML = `
      <p class="guide-top"></p>
      <div class="intro-finale-seed">
        <div class="intro-finale-seed__placeholder"></div>
      </div>
    `;
    const guideEl = this.root.querySelector('.guide-top');
    const seedWrap = this.root.querySelector('.intro-finale-seed');
    const placeholder = seedWrap.querySelector('.intro-finale-seed__placeholder');

    // Seed hero visual (image or video). Hidden gracefully if the asset isn't
    // present yet — the placeholder disc behind it stays visible.
    const heroSrc = ctx.config?.data?.seedHero;
    if (heroSrc) {
      const isVideo = /\.(mp4|webm|mov)$/i.test(heroSrc);
      const media = document.createElement(isVideo ? 'video' : 'img');
      media.className = 'intro-finale-seed__media';
      // This disc is only a missing-asset fallback. A transparent seed image
      // must not reveal a second purple disc behind its centre.
      media.addEventListener(isVideo ? 'loadeddata' : 'load', () => {
        placeholder.hidden = true;
      }, { once: true });
      media.addEventListener('error', () => {
        media.style.display = 'none';
        placeholder.hidden = false;
      }, { once: true });
      if (isVideo) {
        media.muted = true; media.autoplay = true; media.loop = true; media.playsInline = true;
        media.src = heroSrc;
      } else {
        media.src = heroSrc; media.alt = ''; media.draggable = false;
      }
      seedWrap.appendChild(media);
    }

    // Guide text — same reveal animation as elsewhere.
    this.morph = new RevealText({ morphMs: 1600 });
    guideEl.appendChild(this.morph.root);
    this.morph.setInitial('');
    this._disposers.push(() => this.morph.stop());

    // Kick off after one frame so the state's fade-in and the morph/entrance
    // don't fight for paint priority in the same tick. The seed scales+fades in
    // softly (CSS), the text reveals in sync.
    const finaleAudio = ctx.config?.data?.intro?.finaleAudio ?? null;
    requestAnimationFrame(() => {
      this.morph.morphTo(FINALE_TEXT);
      seedWrap.classList.add('is-in');
      if (finaleAudio) { ctx.audio?.play(finaleAudio, { volume: 1 }); this._narrationId = finaleAudio; }
    });

    // Hold for the narration length (+ tail); fall back to HOLD_MS if no cue.
    const durF = finaleAudio ? ctx.audio?.getDuration?.(finaleAudio) : null;
    const holdMs = durF ? durF * 1000 + 800 : HOLD_MS;
    this.after(holdMs, () => {
      this.advanceOrIdle(ctx, 'seedSelect'); // [1] release to Idle if nobody's here
    });

    // Enter skips straight to SeedSelect (also covered in IdleState/IntroState).
    const onKeyDown = (e) => {
      if (e.key === 'Enter') {
        console.log('[IntroFinale] Enter → seedSelect');
        this.machine.transition('seedSelect');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    this._disposers.push(() => window.removeEventListener('keydown', onKeyDown));
  }

  async exit() {
    if (this._narrationId) this.ctx?.audio?.stop(this._narrationId); // [4] stop voice on leave
    await this.morphOutGuide();
    await super.exit();
  }
}
