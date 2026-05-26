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

    this.running = false;
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
      // Lighter follow — 0.2 lerp tracks the hand closer to real-time so the
      // coin feels responsive rather than slowly sloshing into place.
      this.rotX += (this.targetRotX - this.rotX) * 0.2;
      this.rotY += (this.targetRotY - this.rotY) * 0.2;
      this.tokenGroup.rotation.x = this.rotX;
      this.tokenGroup.rotation.y = this.rotY;
      this.renderer.render(this.scene, this.camera);
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

  dispose() {
    this.stop();
    this.renderer.dispose();
    this.scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose?.();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.());
        else obj.material.dispose?.();
      }
    });
  }
}
