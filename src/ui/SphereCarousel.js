// SphereCarousel — star-field carousel, deliberately simple.
//
// Motion model:
//   1) Hand input adds to `targetRotX/Y`.
//   2) Each frame, actual rotation eases toward target via a single lerp.
//      No spring, no velocity, no magnetic snap force, no hysteresis loops.
//      → No oscillation. The carousel only moves when the user's hand
//        moves, and it stops when the hand stops.
//   3) The item closest to dead-center (front hemisphere) is the "centered"
//      item. We use light hysteresis (must be CLEARLY closer than the current
//      one) so the label doesn't flicker between near-equidistant nodes.
//   4) Dwell + selection is handled by SeedSelectState, not here.

const REPEATS = 22;             // 5 appliances × 22 = 110 nodes
const RADIUS = 1500;
const CAM_DISTANCE = 1150;
const BASE_ITEM_SIZE = 280;
const CENTER_SCALE = 1.55;

const SMOOTHING = 0.18;         // lerp factor for rotation toward target (snappier follow)
const ROTATE_GAIN_X = 0.0024;   // hand-pixel → target Y rotation (lowered)
const ROTATE_GAIN_Y = 0.0017;   // hand-pixel → target X rotation (lowered)
const ROTATE_DEADZONE = 1.5;    // ignore sub-pixel hand jitter
const PITCH_CLAMP = 0.65;
const HYSTERESIS_PX = 120;      // wider — keep the same center even if a rival creeps closer
const MAGNET_PULL = 0.06;       // stronger pull toward exact centering

export class SphereCarousel {
  constructor(appliances, { onCenterChange, autoMagnet = true } = {}) {
    this.appliances = appliances;
    this.onCenterChange = onCenterChange;
    this.autoMagnet = autoMagnet;

    this.root = document.createElement('canvas');
    Object.assign(this.root.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
    });
    this.ctx = this.root.getContext('2d');

    this.rotX = 0;
    this.rotY = 0;
    this.targetRotX = 0;
    this.targetRotY = 0;
    this.running = false;
    this.centerKey = null;
    this.locked = false; // when true, rotate() is ignored

    // Continuous angular velocity (radians/frame). Set by setAngularVel()
    // each frame; integrated into targetRot below. Used by SeedSelectState's
    // proximity model where rotation is driven by the seed's offset rather
    // than by per-frame hand deltas.
    this._angVelX = 0;
    this._angVelY = 0;

    // Recent user-input magnitude (EMA of pixels per call) and a timestamp
    // of the last rotate() call. The soft center magnet (in start()'s loop)
    // is gated on BOTH: it only runs once the visitor has actually started
    // moving their hand AND autoMagnet was enabled in the constructor.
    this._inputMag = 0;
    this._lastInputAt = 0;

    // Highlight state — set externally by setHighlight(slotId, progress).
    // The matching item gets a glow, scale bump, and a progress ring
    // around it that fills as `progress` rises from 0 → 1.
    this._highlightSlotId = null;
    this._highlightProgress = 0;

    // Projection of every node in screen space, refreshed each draw and
    // exposed via getProjectedItems() for proximity checks.
    this._projected = [];

    this._images = new Map();
    this._buildField();
  }

  _buildField() {
    const n = REPEATS * this.appliances.length;

    // Step 1 — generate Fibonacci-spiral positions on the unit sphere.
    // Tiny per-point angular jitter breaks visual gridding without disturbing
    // the even-coverage property of the spiral.
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const positions = [];
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / Math.max(n - 1, 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const phi = goldenAngle * i + (Math.random() - 0.5) * 0.18;
      positions.push([Math.cos(phi) * r, y, Math.sin(phi) * r]);
    }

    // Step 2 — greedy appliance assignment. For each position, look at
    // already-assigned neighbors within MIN_ANGULAR_DIST on the unit sphere,
    // and pick an appliance that's NOT one of theirs. Among the legal
    // candidates, prefer the least-used so far (keeps counts balanced).
    //
    // This prevents the visual clutter of two/three of the same appliance
    // bunching up next to each other after a random shuffle.
    const MIN_ANGULAR_DIST = 0.48;
    const minDistSq = MIN_ANGULAR_DIST * MIN_ANGULAR_DIST;

    const assignments = new Array(n);
    const useCounts = new Map();
    this.appliances.forEach((a) => useCounts.set(a.id, 0));

    // Visit in a shuffled order so the first-placed appliances aren't always
    // the same ones (otherwise position 0 always gets the first appliance).
    const order = Array.from({ length: n }, (_, i) => i);
    shuffle(order);

    for (const i of order) {
      const [xi, yi, zi] = positions[i];
      const forbidden = new Set();
      for (const j of order) {
        if (j === i || assignments[j] === undefined) continue;
        const [xj, yj, zj] = positions[j];
        const dSq = (xi - xj) ** 2 + (yi - yj) ** 2 + (zi - zj) ** 2;
        if (dSq < minDistSq) forbidden.add(assignments[j]);
      }
      const candidates = this.appliances
        .filter((a) => !forbidden.has(a.id))
        .sort((a, b) => useCounts.get(a.id) - useCounts.get(b.id));
      let pick;
      if (candidates.length > 0) {
        pick = candidates[0].id;
      } else {
        // Edge case — every appliance is nearby. Fall back to least-used.
        pick = [...useCounts.entries()].sort((a, b) => a[1] - b[1])[0][0];
      }
      assignments[i] = pick;
      useCounts.set(pick, useCounts.get(pick) + 1);
    }

    // Step 3 — materialize nodes with their assigned appliance.
    this.nodes = positions.map((pos, i) => {
      const appliance = this.appliances.find((a) => a.id === assignments[i]);
      return {
        appliance,
        slotId: i,
        base: [pos[0] * RADIUS, pos[1] * RADIUS, pos[2] * RADIUS],
        scaleJitter: 0.85 + Math.random() * 0.3,
      };
    });
  }

  async preload() {
    const unique = new Set();
    await Promise.all(
      this.appliances.map(async (a) => {
        if (!a.image || unique.has(a.image)) return;
        unique.add(a.image);
        const img = new Image();
        img.src = a.image;
        await img.decode().catch(() => {});
        this._images.set(a.id, img);
      }),
    );
  }

  _fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.root.width = window.innerWidth * dpr;
    this.root.height = window.innerHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  start() {
    if (this.running) return;
    this._fit();
    this._resize = () => this._fit();
    window.addEventListener('resize', this._resize);
    this.running = true;
    const loop = () => {
      if (!this.running) return;

      // Continuous angular-velocity integration (seed-driven mode).
      if (!this.locked) {
        this.targetRotX += this._angVelX;
        this.targetRotY += this._angVelY;
        this.targetRotX = Math.max(-PITCH_CLAMP, Math.min(PITCH_CLAMP, this.targetRotX));
      }

      this._inputMag *= 0.86;

      // Auto-magnet — only when explicitly enabled AND visitor has moved at
      // least once. In seed-driven mode (autoMagnet: false) this is dormant.
      const now = performance.now();
      const sinceInput = now - this._lastInputAt;
      const ever = this._lastInputAt > 0;
      const calm = this._inputMag < 0.6;
      const recent = sinceInput < 4000;
      if (this.autoMagnet && ever && recent && calm && !this.locked && this.centerKey != null) {
        const snap = this._computeSnapAngles();
        if (snap) {
          this.targetRotX += (snap.rotX - this.targetRotX) * MAGNET_PULL;
          this.targetRotY += (snap.rotY - this.targetRotY) * MAGNET_PULL;
        }
      }

      this.rotX += (this.targetRotX - this.rotX) * SMOOTHING;
      this.rotY += (this.targetRotY - this.rotY) * SMOOTHING;
      this._draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // Continuous rotation (radians per frame).
  setAngularVel(vx, vy) {
    this._angVelX = vx;
    this._angVelY = vy;
  }

  // External readers (e.g. SeedSelectState's proximity loop) use this to
  // know where each item currently is on screen.
  getProjectedItems() {
    return this._projected;
  }

  // slotId | null, progress 0..1. Drives the highlight visual in _draw.
  setHighlight(slotId, progress = 0) {
    this._highlightSlotId = slotId;
    this._highlightProgress = Math.max(0, Math.min(1, progress));
  }

  // Compute (rotX, rotY) that would place the currently-centered node at
  // (0, 0, +RADIUS). Returns null if there's no current center.
  _computeSnapAngles() {
    if (this.centerKey == null) return null;
    const node = this.nodes.find((n) => n.slotId === this.centerKey);
    if (!node) return null;
    const [bx, by, bz] = node.base;
    const tY = Math.atan2(-bx, bz);
    const sinTY = Math.sin(tY);
    const cosTY = Math.cos(tY);
    const b1z = -bx * sinTY + bz * cosTY;
    const tX = Math.atan2(by, b1z);
    return { rotX: tX, rotY: tY };
  }

  stop() {
    this.running = false;
    if (this._resize) window.removeEventListener('resize', this._resize);
  }

  rotate(dx, dy) {
    if (this.locked) return;
    const mag = Math.hypot(dx, dy);
    // Deadzone — discard the noise floor of MediaPipe + camera so a "still"
    // hand actually keeps the disc still.
    if (mag < ROTATE_DEADZONE) return;
    this.targetRotY += dx * ROTATE_GAIN_X;
    this.targetRotX += dy * ROTATE_GAIN_Y;
    this.targetRotX = Math.max(-PITCH_CLAMP, Math.min(PITCH_CLAMP, this.targetRotX));
    this._inputMag = this._inputMag * 0.7 + mag * 0.3;
    this._lastInputAt = performance.now();
  }

  getCenter() {
    if (this.centerKey == null) return null;
    const node = this.nodes.find((n) => n.slotId === this.centerKey);
    return node?.appliance ?? null;
  }

  // Lock rotation onto the currently-centered slot. Used by SeedSelectState
  // when a confirmed pinch begins — the disc snaps that item to true center
  // and stops responding to rotate() calls until unlock() is called.
  snapToCenter() {
    const snap = this._computeSnapAngles();
    if (!snap) return;
    this.targetRotX = snap.rotX;
    this.targetRotY = snap.rotY;
    this.locked = true;
  }

  unlock() {
    this.locked = false;
  }

  _draw() {
    const { ctx } = this;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const cx = w / 2;
    const cy = h / 2;
    ctx.clearRect(0, 0, w, h);

    const cosY = Math.cos(this.rotY);
    const sinY = Math.sin(this.rotY);
    const cosX = Math.cos(this.rotX);
    const sinX = Math.sin(this.rotX);

    const projected = this.nodes.map((node) => {
      const [x0, y0, z0] = node.base;
      const x1 = x0 * cosY + z0 * sinY;
      const z1 = -x0 * sinY + z0 * cosY;
      const y2 = y0 * cosX - z1 * sinX;
      const z2 = y0 * sinX + z1 * cosX;
      const scale = CAM_DISTANCE / (CAM_DISTANCE + z2 + RADIUS);
      return {
        node,
        sx: cx + x1 * scale,
        sy: cy + y2 * scale,
        scale,
        depth: z2,
      };
    });

    projected.sort((a, b) => b.depth - a.depth);
    this._projected = projected; // expose for external proximity checks

    // Center detection (only meaningful when autoMagnet mode is on; harmless
    // to compute anyway since SeedSelect doesn't read it in proximity mode).
    const maxScreenDist = Math.min(w, h) * 0.55;
    let candidate = null;
    let candidateDist = Infinity;
    if (this.autoMagnet) {
      for (const p of projected) {
        if (p.depth > 0.25 * RADIUS) continue;
        const d = Math.hypot(p.sx - cx, p.sy - cy);
        if (d < candidateDist) {
          candidateDist = d;
          candidate = p;
        }
      }
    }
    let centerEntry = candidate;
    if (this.autoMagnet && this.centerKey != null && candidate && candidate.node.slotId !== this.centerKey) {
      const current = projected.find(
        (p) => p.node.slotId === this.centerKey && p.depth <= 0.25 * RADIUS,
      );
      if (current) {
        const currentDist = Math.hypot(current.sx - cx, current.sy - cy);
        if (currentDist < candidateDist + HYSTERESIS_PX) centerEntry = current;
      }
    }

    // Body — back to front.
    for (const p of projected) {
      const isCenter = centerEntry && p.node.slotId === centerEntry.node.slotId;
      const isHighlight = this._highlightSlotId != null && p.node.slotId === this._highlightSlotId;

      const depthFactor = 1 - (p.depth + RADIUS) / (2 * RADIUS);
      const screenDist = Math.hypot(p.sx - cx, p.sy - cy);
      const edgeFactor = Math.max(0, 1 - screenDist / maxScreenDist);

      const edgeScaleFactor = 0.35 + 0.65 * edgeFactor;
      const depthScaleFactor = 0.5 + 0.5 * depthFactor;

      let alpha = (0.12 + 0.78 * depthFactor) * (0.5 + 0.5 * edgeFactor);
      if (isCenter || isHighlight) alpha = 1;
      alpha = Math.max(0, Math.min(1, alpha));

      let bonus = 1;
      if (isHighlight) bonus = 1.18 + 0.08 * this._highlightProgress; // 1.18 → 1.26 as gauge fills
      else if (isCenter) bonus = CENTER_SCALE;

      const sizeMul = p.scale * p.node.scaleJitter * edgeScaleFactor * depthScaleFactor;
      const size = BASE_ITEM_SIZE * sizeMul * bonus;

      // Soft warm glow behind a proximity-highlighted item.
      if (isHighlight) {
        const glowR = size * 0.95;
        const grad = ctx.createRadialGradient(p.sx, p.sy, size * 0.3, p.sx, p.sy, glowR);
        const intensity = 0.45 + 0.35 * this._highlightProgress;
        grad.addColorStop(0, `rgba(255, 235, 200, ${intensity})`);
        grad.addColorStop(0.7, 'rgba(255, 235, 200, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(p.sx - glowR, p.sy - glowR, glowR * 2, glowR * 2);
      }

      const img = this._images.get(p.node.appliance.id);
      ctx.globalAlpha = alpha;
      if (img && img.naturalWidth) {
        ctx.drawImage(img, p.sx - size / 2, p.sy - size / 2, size, size);
      } else {
        ctx.fillStyle = isCenter || isHighlight ? '#EAA0FF' : '#f3e6ff';
        roundRect(ctx, p.sx - size / 2, p.sy - size / 2, size, size, 24);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Progress ring around a proximity-highlighted item.
      if (isHighlight && this._highlightProgress > 0) {
        const ringR = size * 0.62;
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(234, 160, 255, 0.25)';
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, ringR, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = '#EAA0FF';
        ctx.beginPath();
        ctx.arc(
          p.sx,
          p.sy,
          ringR,
          -Math.PI / 2,
          -Math.PI / 2 + this._highlightProgress * Math.PI * 2,
        );
        ctx.stroke();
      }
    }

    const newKey = centerEntry?.node.slotId ?? null;
    if (newKey !== this.centerKey) {
      this.centerKey = newKey;
      this.onCenterChange?.(centerEntry?.node.appliance ?? null);
    }
  }
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
