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

  // Pick one of A/B/C variants uniformly at random.
  pickRandomFlowerKey() {
    const keys = ['A', 'B', 'C'];
    return keys[Math.floor(Math.random() * keys.length)];
  }

  resolveFlower(applianceId, flowerKey) {
    const appliance = this.getAppliance(applianceId);
    if (!appliance) return null;
    return appliance.flowers?.[flowerKey] ?? null;
  }
}
