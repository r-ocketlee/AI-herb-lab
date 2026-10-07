// AppContext — shared singletons + the rolling per-visitor session payload.
// Passed to every state's enter()/exit() so states never reach for globals.

export class AppContext {
  constructor({ config, handTracker, poseTracker, audio, dev }) {
    this.config = config;
    this.handTracker = handTracker;
    this.poseTracker = poseTracker;
    this.audio = audio;
    this.dev = dev;
    this.session = makeEmptySession();
  }

  resetSession() {
    this.session = makeEmptySession();
    this.dev?.setAppliance(null);
    this.dev?.setFlower(null);
  }

  setAppliance(id) {
    this.session.applianceId = id;
    this.dev?.setAppliance(id);
  }

  setFlower(key) {
    this.session.flowerKey = key;
    this.dev?.setFlower(key);
  }
}

function makeEmptySession() {
  return {
    applianceId: null,
    flowerKey: null,
    // Codename suffix — a fresh random 2-digit number per visitor, so the
    // species reads as e.g. "AIR-07". Generated up front so every screen
    // (Card, certificate, QR) shows the same value for one session.
    codenameNum: randomTwoDigits(),
    // Filled by AnalyzingState once the portrait is captured: `photo` is the
    // local dataURL for on-kiosk display, `photoId` is the short id returned
    // by the upload function (goes into the QR). Either may stay null on a
    // failed capture/upload — every consumer must fall back gracefully.
    photo: null,
    photoId: null,
    startedAt: Date.now(),
  };
}

// "01"–"99" (never "00" — reads cleaner as a specimen number).
function randomTwoDigits() {
  return String(Math.floor(Math.random() * 99) + 1).padStart(2, '0');
}
