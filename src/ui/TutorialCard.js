// TutorialCard — gesture cues over the real interaction screen. Only the cues
// fade away at handoff; the underlying scene keeps its position and scale.
//
// Usage:
//   const card = new TutorialCard();
//   card.mount(stateRoot);
//   // append ghost elements to card.stage (positioned in % of the window)
//   card.setCaption('손을 좌우로 움직이면 …');   // step explanation
//   card.setPct(0.6);                            // 0→100 readout while a gauge fills
//   await card.expand();                         // fade cues into live interaction
//   card.destroy();

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export class TutorialCard {
  constructor({ label = '동작을 확인해보세요' } = {}) {
    const el = document.createElement('div');
    el.className = 'tutorial-card';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = `
      <div class="tcard-window">
        <div class="tcard-chrome">
          <div class="tcard-label">${label}</div>
          <div class="tcard-caption"></div>
        </div>
        <div class="tcard-stage"></div>
      </div>
    `;
    this.root = el;
    this.window = el.querySelector('.tcard-window');
    this.stage = el.querySelector('.tcard-stage');
    this._pct = el.querySelector('.tcard-pct');
    this._caption = el.querySelector('.tcard-caption');
    this.active = true;
    this._timers = new Set();
  }

  // Demo callbacks belong to the cue, not the whole screen. An early
  // handoff must cancel them so they cannot steer the live carousel.
  after(ms, fn) {
    const id = setTimeout(() => {
      this._timers.delete(id);
      if (this.active) fn();
    }, ms);
    this._timers.add(id);
  }

  mount(parent) {
    parent.appendChild(this.root);
    this.root.getBoundingClientRect();
    requestAnimationFrame(() => { if (this.active) this.root.classList.add('is-in'); });
  }

  setPct(p) {
    if (this._pct) this._pct.textContent = `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
  }

  // Step explanation — fades out, swaps, fades back in.
  setCaption(text) {
    if (!this._caption) return;
    this._caption.style.opacity = '0';
    this.after(150, () => {
      this._caption.textContent = text;
      this._caption.style.opacity = '1';
    });
  }

  async expand() {
    this.root.classList.add('is-expanding');
    await wait(300);
  }

  destroy() {
    this.active = false;
    for (const id of this._timers) clearTimeout(id);
    this._timers.clear();
    this.root.remove();
  }

  // Faint dashed trail between two points (in % of the window) suggesting the
  // ghost cursor's recorded path.
  addTrail(x1, y1, x2, y2) {
    const t = document.createElement('div');
    t.className = 'tcard-trail';
    const dx = x2 - x1, dy = y2 - y1;
    t.style.left = `${x1}%`;
    t.style.top = `${y1}%`;
    t.style.width = `${Math.hypot(dx, dy)}%`;
    t.style.transform = `rotate(${(Math.atan2(dy, dx) * 180) / Math.PI}deg)`;
    this.stage.appendChild(t);
    return t;
  }
}
