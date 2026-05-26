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
    startedAt: Date.now(),
  };
}
