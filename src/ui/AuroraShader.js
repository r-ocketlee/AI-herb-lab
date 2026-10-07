// AuroraShader — WebGL aurora-style background for the analyzing screen.
//
// Two color uniforms (uColorA, uColorB) are blended by a smooth flowing
// pattern built from layered sine/cosine waves. NO random/noise functions —
// the visual is intentionally calm: a slow, jelly-like color flow rather
// than the high-frequency volumetric noise of the reference component.
//
// Usage:
//   const aurora = new AuroraShader();
//   aurora.setColorA([0.79, 0.63, 0.86]);
//   aurora.setColorB([0.91, 0.84, 0.95]);
//   root.appendChild(aurora.root);
//   aurora.start();
//   ...
//   aurora.dispose();

const VERTEX_SHADER = `
  attribute vec2 aPosition;
  void main() {
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform vec3 uColorA;
  uniform vec3 uColorB;

  // Smooth, noise-free flow: three slow sine layers at different angles
  // combine into a soft "scarf-of-light" pattern.
  void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    vec2 p = uv * 2.0 - 1.0;
    p.x *= iResolution.x / iResolution.y;

    float t = iTime * 0.18;

    float w1 = sin(p.x * 1.4 + t)           * cos(p.y * 1.1 - t * 0.7);
    float w2 = sin((p.x * 0.8 + p.y * 1.2) + t * 1.1);
    float w3 = cos(p.y * 1.8 + sin(p.x * 0.6 + t * 0.5) * 0.9 - t * 0.4);

    // Combine, remap to [0,1], soften with smoothstep so transitions
    // are wide and gentle rather than crisp bands.
    float m = (w1 + w2 + w3) / 3.0;
    m = m * 0.5 + 0.5;
    m = smoothstep(0.15, 0.85, m);

    // Soft radial falloff — light pools toward the center.
    float dist = length(p) * 0.85;
    float halo = 1.0 - smoothstep(0.0, 1.4, dist);

    vec3 col = mix(uColorA, uColorB, m);
    col = mix(col * 0.82, col, halo);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class AuroraShader {
  constructor() {
    this.canvas = document.createElement('canvas');
    Object.assign(this.canvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      display: 'block',
    });

    // Tuck behind the centered label without needing zIndex on every sibling.
    this.canvas.style.zIndex = '0';

    this.gl = this.canvas.getContext('webgl', {
      antialias: true,
      premultipliedAlpha: false,
    });
    if (!this.gl) {
      console.error('[AuroraShader] WebGL not supported');
      return;
    }

    // Initial colors — light lavender per spec.
    this.colorA = [0.788, 0.627, 0.863]; // #C9A0DC
    this.colorB = [0.910, 0.835, 0.949]; // #E8D5F2

    this.running = false;
    this._startTime = 0;
    this._rafId = 0;

    this._initProgram();
    this._observeSize();
  }

  get root() {
    return this.canvas;
  }

  _initProgram() {
    const gl = this.gl;

    const vs = this._compile(VERTEX_SHADER, gl.VERTEX_SHADER);
    const fs = this._compile(FRAGMENT_SHADER, gl.FRAGMENT_SHADER);
    if (!vs || !fs) return;

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[AuroraShader] link error:', gl.getProgramInfoLog(program));
      return;
    }
    this.program = program;
    gl.useProgram(program);

    // Fullscreen quad.
    const verts = new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1,
    ]);
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    this.uResolution = gl.getUniformLocation(program, 'iResolution');
    this.uTime = gl.getUniformLocation(program, 'iTime');
    this.uColorA = gl.getUniformLocation(program, 'uColorA');
    this.uColorB = gl.getUniformLocation(program, 'uColorB');
  }

  _compile(src, type) {
    const gl = this.gl;
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('[AuroraShader] compile error:', gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  // ResizeObserver fires once on attach (and again on any viewport change),
  // so the initial fit is automatic — no need to call _fit manually after
  // appending to the DOM.
  _observeSize() {
    this._resizeObserver = new ResizeObserver(() => this._fit());
    this._resizeObserver.observe(this.canvas);
  }

  _fit() {
    if (!this.gl) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.gl.viewport(0, 0, w, h);
  }

  setColorA(rgb) {
    if (rgb && rgb.length === 3) this.colorA = [rgb[0], rgb[1], rgb[2]];
  }

  setColorB(rgb) {
    if (rgb && rgb.length === 3) this.colorB = [rgb[0], rgb[1], rgb[2]];
  }

  start() {
    if (this.running || !this.gl || !this.program) return;
    this.running = true;
    this._startTime = performance.now();
    const loop = () => {
      if (!this.running) return;
      this._draw();
      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._rafId);
  }

  _draw() {
    const gl = this.gl;
    if (!gl || gl.isContextLost() || !this.program) return;
    const t = (performance.now() - this._startTime) / 1000;
    gl.uniform2f(this.uResolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uTime, t);
    gl.uniform3f(this.uColorA, this.colorA[0], this.colorA[1], this.colorA[2]);
    gl.uniform3f(this.uColorB, this.colorB[0], this.colorB[1], this.colorB[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose() {
    this.stop();
    this._resizeObserver?.disconnect();
    const gl = this.gl;
    if (gl && !gl.isContextLost()) {
      if (this.program) gl.deleteProgram(this.program);
      if (this.vbo) gl.deleteBuffer(this.vbo);
    }
    this.program = null;
    this.vbo = null;
    this.gl = null;
  }
}
