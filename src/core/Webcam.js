// Shared webcam — both HandTracker and PoseTracker pull frames from this one
// MediaStream so we don't open the device twice. The hidden <video id="webcam">
// in index.html receives the stream; UI bubbles render copies via canvas.

export class Webcam {
  constructor() {
    this.video = document.getElementById('webcam');
    this.stream = null;
    this.ready = false;
  }

  async start({ width = 640, height = 480 } = {}) {
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
      if (this.video.readyState >= 2) { resolve(); return; }
      // Timeout fallback — a flaky USB camera can stall without ever firing
      // loadeddata; don't hang boot/reconnect forever. We proceed and let
      // isHealthy() gate readiness (the watchdog retries if still not live).
      const to = setTimeout(resolve, 5000);
      this.video.onloadeddata = () => { clearTimeout(to); resolve(); };
    });
    this.ready = true;
    return this.video;
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.ready = false;
  }

  // [7] Stream-health check — true only while a live video track is feeding the
  // element. A dropped/ended track (camera unplugged, USB glitch) → false.
  isHealthy() {
    if (!this.stream || !this.video) return false;
    const tracks = this.stream.getVideoTracks();
    return tracks.length > 0 && tracks.some((t) => t.readyState === 'live') && this.video.readyState >= 2;
  }

  // Tear down and re-acquire the stream onto the same <video> element (trackers
  // keep their reference, so they resume automatically once frames flow again).
  async reconnect() {
    if (this._reconnecting) return false;
    this._reconnecting = true;
    try {
      this.stop();
      await this.start();
      return this.isHealthy();
    } catch (e) {
      return false;
    } finally {
      this._reconnecting = false;
    }
  }
}
