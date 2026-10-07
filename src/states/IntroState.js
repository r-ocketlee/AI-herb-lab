// IntroState — narrative onboarding between IdleState (welcome) and
// SeedSelectState (the actual interaction).
//
// Layout:
//   ┌────────────────────────────────────────────────────────┐
//   │                                                        │
//   │   2050년의 가전은 설정하는       ┌───────────────────┐    │
//   │   기기가 아닌, 사용자와         │                   │    │
//   │   함께 자라나는 돌봄형          │   카드 이미지      │    │
//   │   미래 가전입니다              │   (vertical card) │    │
//   │                              │                   │    │
//   │                              └───────────────────┘    │
//   └────────────────────────────────────────────────────────┘
//
// Behavior:
//   • Plays slides from config.intro.slides in order.
//   • Each slide lasts config.intro.slideMs (default 5000 ms).
//   • Card images slide vertically (current exits downward, next enters
//     from top) for the "세로 아래로 내려가는" feel.
//   • Text fades cross-fades between slides.
//   • <em> tags inside slide.html become the lavender highlight color.
//   • After the last slide, automatically transitions to SeedSelect.
//   • Pressing Enter at any point skips straight to SeedSelect.

import { BaseState } from './BaseState.js';
import { RevealText } from '../ui/RevealText.js';

export class IntroState extends BaseState {
  constructor() {
    super('intro');
  }

  async enter(ctx) {
    await super.enter(ctx);
    this.pauseTrackers(); // passive narration — no hand/presence input needed


    const intro = ctx.config.data.intro ?? { slideMs: 5000, slides: [] };
    const slides = intro.slides ?? [];
    const slideMs = intro.slideMs ?? 5000;

    Object.assign(this.root.style, { background: '#ffffff' });

    // Intro is read-only — hide the hand cursor / webcam so it stays calm.
    ctx.cursor.hide();

    // DOM scaffold — text panel on the left, card carousel on the right.
    this.root.innerHTML = `
      <div class="intro-stage">
        <div class="intro-text"></div>
        <div class="intro-cards"></div>
      </div>
    `;
    const textEl = this.root.querySelector('.intro-text');
    const cardsEl = this.root.querySelector('.intro-cards');

    // Morphing text inside the .intro-text container. The container keeps
    // all sizing/positioning rules (font, max-width, left-align). The
    // RevealText instance just owns the inner spans that animate.
    this.morph = new RevealText({ morphMs: 1800 });
    textEl.appendChild(this.morph.root);
    this.morph.setInitial(''); // start blank — first slide morphs in
    this._disposers.push(() => this.morph.stop());

    // Pre-build all card elements stacked inside the cards container.
    // We toggle .is-current / .is-prev / .is-next classes to drive the
    // vertical slide animation entirely from CSS.
    slides.forEach((slide, i) => {
      const card = document.createElement('div');
      card.className = 'intro-card';
      card.style.backgroundImage = slide.image ? `url(${slide.image})` : '';
      card.dataset.index = String(i);
      cardsEl.appendChild(card);
    });

    let index = 0;
    let fired = false;

    const showSlide = (i) => {
      const slide = slides[i];
      if (!slide) return;
      // Text and card now resolve on the same beat (1800 ms): the text
      // reveals via RevealText, and the card crossfades in via CSS
      // opacity. No vertical motion anymore — cards stay pinned and
      // simply fade from one to the next.
      this.morph.morphTo(slide.html ?? '');

      // Card opacity-only state machine (see .intro-card CSS):
      //   • is-current  → opacity 1 (visible)
      //   • is-prev     → opacity 0 (already shown, fading out)
      //   • is-next     → opacity 0 (not yet shown)
      const cards = cardsEl.querySelectorAll('.intro-card');
      cards.forEach((c, ci) => {
        c.classList.remove('is-prev', 'is-current', 'is-next');
        if (ci < i) c.classList.add('is-prev');
        else if (ci === i) c.classList.add('is-current');
        else c.classList.add('is-next');
      });
    };

    // Small pause after a slide's narration finishes before the next slide.
    const NARRATION_TAIL_MS = 800;

    // Show slide i (text + card) and play its narration in sync; advance when
    // the voice finishes (+ tail). Falls back to the fixed slideMs if the cue
    // has no audio / isn't loaded yet.
    const playSlide = (i) => {
      if (this._narrationId) ctx.audio?.stop(this._narrationId); // no overlap
      showSlide(i);
      const slide = slides[i] ?? {};
      let ms = slideMs;
      if (slide.audio) {
        ctx.audio?.play(slide.audio, { volume: 1 });
        this._narrationId = slide.audio;
        const dur = ctx.audio?.getDuration?.(slide.audio);
        if (dur) ms = dur * 1000 + NARRATION_TAIL_MS;
      }
      this.after(ms, advance);
    };

    const advance = () => {
      if (fired) return;
      if (index >= slides.length - 1) {
        fired = true;
        console.log('[Intro] last slide done → introFinale');
        this.advanceOrIdle(ctx, 'introFinale'); // [1] release to Idle if nobody's here
        return;
      }
      index += 1;
      playSlide(index);
    };

    // Kick off with the first slide (text + narration start together).
    if (slides.length > 0) {
      playSlide(0);
    } else {
      // No slides configured — just move on.
      this.after(50, () => this.advanceOrIdle(ctx, 'introFinale'));
    }

    // Skip via Enter (staff / QA).
    const onKeyDown = (e) => {
      if (e.key === 'Enter' && !fired) {
        fired = true;
        console.log('[Intro] Enter → skip to seedSelect');
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
