// PauseOverlay — shown by the absence guard when a visitor leaves mid-interaction.
// Dims the screen and explains the actual resume condition: returning to the
// camera view. The current state is preserved underneath and resumes as soon
// as a person or hand is detected again.

export class PauseOverlay {
  constructor() {
    const el = document.createElement('div');
    el.className = 'pause-overlay';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = `
      <div class="pause-card">
        <div class="pause-title">체험을 이어가려면 화면 앞에 서주세요</div>
        <div class="pause-sub"><span class="pause-count">20</span>초 후에 시작 화면으로 돌아갑니다</div>
        <div class="pause-resume-hint">한 손을 화면을 향해 보여주세요</div>
      </div>
    `;
    this.root = el;
    this._count = el.querySelector('.pause-count');
  }

  mount(parent) {
    parent.appendChild(this.root);
    this.root.getBoundingClientRect();
    requestAnimationFrame(() => this.root.classList.add('is-in'));
  }

  setRemain(sec) {
    if (this._count) this._count.textContent = String(Math.max(0, sec));
  }

  destroy() {
    this.root.remove();
  }
}
