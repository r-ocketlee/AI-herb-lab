// MeshGradient — soft flowing mesh-gradient WebGL background for IdleState.
//
// Uses the framework-agnostic `@paper-design/shaders` package (the same
// shader code the @paper-design/shaders-react MeshGradient component wraps
// — see 21st.dev/r/reuno-ui/background-paper-shaders). That gives the
// exact "Paper Shaders" mesh-gradient look without pulling in React.
//
// What it does (per the package's docs):
//   • Up to 10 color spots float along organic trajectories.
//   • `distortion` warps the field non-linearly for fluid bends.
//   • `swirl` rotates around the canvas center proportional to radius.
//   • `grainMixer` / `grainOverlay` add grain (left off by default for a
//     clean pastel look).
//
// Palette default → matched to the reference screenshot (soft lavender +
// white + a peachy hint). Override via `colors:` in the options.

import {
  ShaderMount,
  meshGradientFragmentShader,
  meshGradientMeta,
  getShaderColorFromString,
  ShaderFitOptions,
} from '@paper-design/shaders';

const DEFAULT_COLORS = [
  '#F1E8F6', // very light lavender base
  '#877AD1', // medium purple — the deep central mass
  '#BEAEE0', // soft lavender ring
  '#FFFFFF', // white highlight
  '#F5DEE8', // peachy-pink touch
];

export class MeshGradient {
  constructor(opts = {}) {
    // ShaderMount needs a parent DOM element it can create its canvas
    // inside. We expose that element as `root` so callers can append it
    // anywhere just like the previous (hand-rolled) MeshGradient.
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
    });

    const colors = opts.colors ?? DEFAULT_COLORS;

    // Color strings → vec4 (RGBA, 0..1). The shader array is fixed length
    // (meshGradientMeta.maxColorCount = 10), so pad with zero-alpha
    // entries for the unused slots and tell the shader how many are real
    // via u_colorsCount.
    const colorVecs = colors.map(getShaderColorFromString);
    while (colorVecs.length < meshGradientMeta.maxColorCount) {
      colorVecs.push([0, 0, 0, 0]);
    }

    this._uniforms = {
      // Sizing — `cover` fills the parent in both dimensions; matches
      // the React component's default `<MeshGradient className="w-full h-full">`.
      u_fit: ShaderFitOptions.cover,
      u_scale: opts.scale ?? 1,
      u_rotation: opts.rotation ?? 0,
      u_originX: opts.originX ?? 0.5,
      u_originY: opts.originY ?? 0.5,
      u_offsetX: opts.offsetX ?? 0,
      u_offsetY: opts.offsetY ?? 0,
      u_worldWidth: opts.worldWidth ?? 0,
      u_worldHeight: opts.worldHeight ?? 0,

      // Mesh-gradient specific
      u_colors: colorVecs,
      u_colorsCount: colors.length,
      u_distortion: opts.distortion ?? 0.8,
      u_swirl: opts.swirl ?? 0.1,
      u_grainMixer: opts.grainMixer ?? 0,
      u_grainOverlay: opts.grainOverlay ?? 0,
    };

    this._speed = opts.speed ?? 0.4; // slower than 1.0 — IdleState should feel calm
    this._mount = null;
  }

  start() {
    if (this._mount) return;
    this._mount = new ShaderMount(
      this.root,
      meshGradientFragmentShader,
      this._uniforms,
      undefined,        // webGlContextAttributes — use defaults
      this._speed,
    );
  }

  setColors(colors) {
    const vecs = colors.map(getShaderColorFromString);
    while (vecs.length < meshGradientMeta.maxColorCount) {
      vecs.push([0, 0, 0, 0]);
    }
    this._mount?.setUniforms({
      u_colors: vecs,
      u_colorsCount: colors.length,
    });
  }

  setSpeed(speed) {
    this._speed = speed;
    this._mount?.setSpeed(speed);
  }

  dispose() {
    // ShaderMount.dispose() frees the program/buffers but NOT the WebGL context.
    // IdleState recreates MeshGradient every visitor cycle, so without this each
    // cycle leaks a live GL context → the browser hits its ~16-context cap and
    // the idle background goes black. Force the loss (like Token3D does).
    const canvas = this.root && this.root.querySelector('canvas');
    this._mount?.dispose();
    this._mount = null;
    if (canvas) {
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      const ext = gl && gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    }
  }
}
