// WebcamFeed — renders the shared <video id="webcam"> into a state's DOM.
// Used in two modes:
//   • 'bubble'     — small circular feed on the right edge (SeedSelect, Bloom)
//   • 'fullscreen' — fills the viewport (Analyzing)
//
// Structure:
//   .root
//     ├── <video>      sized to fill, may be black if no stream
//     └── .placeholder opaque overlay; fades out once 'playing' fires

export class WebcamFeed {
  constructor(webcam, { mode = 'bubble' } = {}) {
    this.webcam = webcam;
    this.mode = mode;

    this.root = document.createElement('div');
    this.root.className = mode === 'bubble' ? 'webcam-bubble' : 'webcam-fullscreen';
    if (mode === 'fullscreen') {
      Object.assign(this.root.style, {
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: '#ffffff',
      });
    }

    this.video = document.createElement('video');
    this.video.autoplay = true;
    this.video.muted = true;
    this.video.playsInline = true;
    Object.assign(this.video.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      transform: 'scaleX(-1)',
      background: '#000',
    });
    this.root.appendChild(this.video);

    this.placeholder = document.createElement('div');
    this._stylePlaceholder();
    this.root.appendChild(this.placeholder);
  }

  _stylePlaceholder() {
    Object.assign(this.placeholder.style, {
      position: 'absolute',
      inset: '0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      gap: this.mode === 'bubble' ? '4px' : '24px',
      background: '#ffffff',
      color: '#2a1f3a',
      textAlign: 'center',
      padding: '12px',
      transition: 'opacity 400ms ease',
      pointerEvents: 'none',
      zIndex: '5',
      opacity: '1',
    });
    if (this.mode === 'fullscreen') {
      Object.assign(this.placeholder.style, {
        boxShadow: 'inset 0 0 0 6px #EAA0FF',
      });
    }
    this.placeholder.innerHTML =
      this.mode === 'bubble'
        ? `
          <div style="font-size:9px;letter-spacing:0.2em;opacity:0.55;color:#2a1f3a;font-weight:400">WEBCAM</div>
          <div style="font-size:11px;font-weight:600;color:#2a1f3a">미연결</div>
        `
        : `
          <div style="font-size:13px;letter-spacing:0.4em;color:#EAA0FF;font-weight:600">— PLACEHOLDER —</div>
          <div style="font-size:48px;font-weight:600;letter-spacing:-0.02em;color:#2a1f3a">[ WEBCAM FULLSCREEN ]</div>
          <div style="font-size:16px;color:#6b5e80;font-weight:400">카메라가 연결되면 사용자 영상이 풀스크린으로 표시됩니다</div>
        `;
  }

  async attach() {
    if (!this.webcam?.stream) {
      console.log('[WebcamFeed] no stream — placeholder remains visible');
      return;
    }
    this.video.srcObject = this.webcam.stream;
    this.video.addEventListener(
      'playing',
      () => {
        console.log('[WebcamFeed] playing — hiding placeholder');
        this.placeholder.style.opacity = '0';
      },
      { once: true },
    );
    try {
      await this.video.play();
    } catch (err) {
      console.warn('[WebcamFeed] play() rejected, keeping placeholder', err);
    }
  }

  detach() {
    this.video.srcObject = null;
  }
}
