// Token3D — plain circular coin with thickness (three.js).
//
// CylinderGeometry's top/bottom cap UVs have a quirk: a square texture's
// "top" maps to the cap's +x direction (i.e. the right side of the disc on
// screen after we tilt the coin so its axis points at the camera). Left
// uncorrected, anything drawn at the top of the canvas appears on the right
// of the rendered face — text comes out sideways. We compensate by rotating
// the textures themselves by +π/2 (CCW) around their center, which brings
// canvas-top → disc-top on both faces.
//
// Material is intentionally simple: matte white side rim, basic image
// materials on the faces. No metalness, no clearcoat — just a clean coin
// that reads cleanly against the white kiosk background.

import * as THREE from 'three';

const RADIUS = 1;
const THICKNESS = 0.06;

export class Token3D {
  constructor({ width = 540, height = 540, frontImageSrc, backCanvas }) {
    this.scene = new THREE.Scene();

    // FOV/distance picked so the coin (radius 1, scale 1.0 → diameter 2)
    // occupies ~70% of the canvas. Leaves room for tilt/spin without the
    // edges clipping against the renderer bounds.
    this.camera = new THREE.PerspectiveCamera(32, width / height, 0.1, 100);
    this.camera.position.set(0, 0, 5);

    // preserveDrawingBuffer lets us call canvas.toDataURL() on demand
    // (mobile token viewer's "save as image" button). Tiny perf hit, OK here.
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height);
    this.renderer.setClearColor(0xffffff, 0);
    this.root = this.renderer.domElement;

    // Soft, neutral lighting — keeps the white material reading as white,
    // with just enough directional contribution to define the rim when the
    // coin tumbles.
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.0));
    const key = new THREE.DirectionalLight(0xffffff, 0.45);
    key.position.set(2, 3, 4);
    this.scene.add(key);

    // Group takes the hand-driven rotation; the coin mesh inside has its own
    // baseline orientation (axis along Z) applied at construction.
    this.tokenGroup = new THREE.Group();
    this.tokenGroup.rotation.y = Math.PI; // start showing back card
    this.scene.add(this.tokenGroup);

    this.rotX = 0;
    this.rotY = Math.PI;
    this.targetRotX = 0;
    this.targetRotY = Math.PI;
    // Angular-velocity model on the Y axis — let the coin carry momentum
    // when the visitor flicks their hand sideways. CardState drives this
    // via applySpinImpulse(); mobile drag still uses setTargetRotation()
    // (the lerp branch below ignores angularVelY when it's zero).
    this.angularVelY = 0;
    this.spinDamping = 0.95;   // raised: the coin carries momentum longer and glides to a smooth stop (more inertia)
    this.maxAngularVel = 0.36; // ~20°/frame cap — lowered so a strong flick decelerates smoothly instead of whipping

    this.running = false;
    this._disposed = false;
    this._build(frontImageSrc, backCanvas);
  }

  async _build(frontImageSrc, backCanvas) {
    const loader = new THREE.TextureLoader();
    let frontTex;
    try {
      frontTex = await loader.loadAsync(frontImageSrc);
      frontTex.colorSpace = THREE.SRGBColorSpace;
    } catch (e) {
      console.warn('[Token3D] front image failed, using gradient fallback', e);
      frontTex = this._fallbackTexture();
    }
    // Rotate the texture so canvas-top → disc-top (see header comment).
    // No crop — the updated PNG already has the orb filling the frame.
    frontTex.center.set(0.5, 0.5);
    frontTex.rotation = Math.PI / 2;

    // If dispose() ran while the texture was loading (visitor left mid-load),
    // don't build a mesh into an already torn-down renderer — that mesh's
    // geometry/materials/textures would never be disposed.
    if (this._disposed) { frontTex.dispose?.(); return; }

    const backTex = new THREE.CanvasTexture(backCanvas);
    backTex.colorSpace = THREE.SRGBColorSpace;
    backTex.center.set(0.5, 0.5);
    backTex.rotation = Math.PI / 2;
    backTex.needsUpdate = true;

    const geometry = new THREE.CylinderGeometry(RADIUS, RADIUS, THICKNESS, 96, 1, false);

    // Pure flat white rim — MeshBasicMaterial ignores lighting so the side
    // never falls into shadow as the coin tumbles. Consistent with the
    // front/back face background (which is also white in the PNG/composite).
    const sideMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const frontMat = new THREE.MeshBasicMaterial({ map: frontTex });
    const backMat = new THREE.MeshBasicMaterial({ map: backTex });

    const coin = new THREE.Mesh(geometry, [sideMat, frontMat, backMat]);
    // Default cylinder axis is +Y. Rotate so the axis aligns with the
    // camera's Z axis — top cap faces the viewer (= front face).
    coin.rotation.x = Math.PI / 2;
    this.tokenGroup.add(coin);
  }

  _fallbackTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(256, 232, 0, 256, 256, 260);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.55, '#f6d4ff');
    g.addColorStop(1, '#d984f5');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      try {
      // X tilt — simple lerp toward the hand-driven target.
      this.rotX += (this.targetRotX - this.rotX) * 0.2;

      // Y rotation = lerp toward absolute target (used by mobile drag)
      // PLUS accumulated angular velocity (used by the kiosk's flick
      // model). The momentum is folded into targetRotY each frame so the
      // lerp doesn't drag the coin back to its pre-impulse target.
      this.rotY += (this.targetRotY - this.rotY) * 0.2;
      if (this.angularVelY !== 0) {
        // Clamp before applying so a runaway impulse can't punch through.
        if (this.angularVelY > this.maxAngularVel) this.angularVelY = this.maxAngularVel;
        if (this.angularVelY < -this.maxAngularVel) this.angularVelY = -this.maxAngularVel;
        this.rotY += this.angularVelY;
        this.targetRotY += this.angularVelY;
        this.angularVelY *= this.spinDamping;
        // Floor — kill jitter once the visitor stops moving.
        if (Math.abs(this.angularVelY) < 0.0005) this.angularVelY = 0;
      }

      this.tokenGroup.rotation.x = this.rotX;
      this.tokenGroup.rotation.y = this.rotY;
      this.renderer.render(this.scene, this.camera);
      } catch (e) {
        console.warn('[Token3D] frame dropped', e);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
  }

  setTargetRotation(x, y) {
    this.targetRotX = x;
    this.targetRotY = y;
  }

  // Light-touch APIs for the kiosk hand-driven spin (CardState):
  //   • setTargetTilt(x) just nudges the X-axis lean
  //   • applySpinImpulse(impulse) adds rotational momentum on Y
  // Keeping the two axes separate means the visitor's vertical hand position
  // never gets in the way of a sideways flick.
  setTargetTilt(rx) {
    this.targetRotX = rx;
  }

  applySpinImpulse(impulse) {
    this.angularVelY += impulse;
  }

  dispose() {
    this._disposed = true;
    this.stop();
    this.renderer.dispose();
    // renderer.dispose() frees GPU resources but NOT the WebGL context itself —
    // without this, each CardState visit leaks a live context (browsers cap at
    // ~16), degrading everything after a few cycles.
    this.renderer.forceContextLoss?.();
    this.scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose?.();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        // material.dispose() does NOT free the bound texture (material.map) —
        // dispose it explicitly, else each token visit leaks a GPU texture.
        mats.forEach((m) => { m.map?.dispose?.(); m.dispose?.(); });
      }
    });
  }
}
