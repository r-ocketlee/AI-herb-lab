// AssetConfig — single source of truth for appliance/flower asset paths.
// Loads /config/assets.json at runtime so the file can be replaced by SFTP
// without rebuilding the bundle.

export class AssetConfig {
  constructor(data) {
    this.data = data;
  }

  static async load(url = '/config/assets.json') {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`assets.json fetch failed: ${res.status}`);
    return new AssetConfig(await res.json());
  }

  get appliances() {
    return this.data.appliances;
  }

  get timings() {
    return this.data.timings;
  }

  get detection() {
    return this.data.detection;
  }

  getAppliance(id) {
    return this.data.appliances.find((a) => a.id === id) ?? null;
  }

  // Pick one of the appliance's flower variants at random (each variant pairs a
  // bloom video with its matching token card, so the ending stays consistent).
  // Falls back to A/B if no appliance id is given.
  pickRandomFlowerKey(applianceId) {
    const ap = applianceId ? this.getAppliance(applianceId) : null;
    const keys = ap?.flowers ? Object.keys(ap.flowers) : ['A', 'B'];
    return keys[Math.floor(Math.random() * keys.length)];
  }

  // Compose the public species codename, e.g. ("air_purifier", "07") → "AIR-07".
  // Falls back to "HERB" if an appliance has no species defined. Never exposes
  // the A/B variant — that stays internal.
  getCodename(applianceId, num) {
    const appliance = this.getAppliance(applianceId);
    const species = appliance?.species ?? 'HERB';
    return num ? `${species}-${num}` : species;
  }

  resolveFlower(applianceId, flowerKey) {
    const appliance = this.getAppliance(applianceId);
    if (!appliance) return null;
    return appliance.flowers?.[flowerKey] ?? null;
  }
}
