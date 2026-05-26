// Shared webcam — both HandTracker and PoseTracker pull frames from this one
// MediaStream so we don't open the device twice. The hidden <video id="webcam">
// in index.html receives the stream; UI bubbles render copies via canvas.

export class Webcam {
  constructor() {
    this.video = document.getElementById('webcam');
    this.stream = null;
    this.ready = false;
  }

  async start({ width = 1280, height = 720 } = {}) {
    if (this.ready) return this.video;
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: width },
        height: { ideal: height },
        facingMode: 'user',
      },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();
    await new Promise((resolve) => {
      if (this.video.readyState >= 2) resolve();
      else this.video.onloadeddata = () => resolve();
    });
    this.ready = true;
    return this.video;
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.ready = false;
  }
}
