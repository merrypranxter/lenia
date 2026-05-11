// Lenia — JS5 sketch for RepoScripter2
// Three-channel continuous cellular automata with activator-inhibitor dynamics.
// 256×256 GPGPU simulation on ping-pong FBOs. Organisms emerge from pure math.

(function () {
  'use strict';

  // ─── Simulation parameters ───────────────────────────────────────────────
  const SIM   = 256;          // simulation grid resolution (pixels per side)
  const DT    = 0.12;         // timestep (reduce for stability, increase for speed)
  const R_CH  = [13.0, 9.0, 21.0]; // kernel radii: ch0 body, ch1 excitation, ch2 inhibition
  const MU_K  = 0.5;          // kernel ring center (fraction of R)
  const SIG_K = 0.15;         // kernel ring width
  const MU_G  = [0.15, 0.14, 0.13]; // growth center per channel (Orbium family)
  const SIG_G = [0.015, 0.018, 0.016]; // growth width per channel

  // ─── Vertex shader (shared) ──────────────────────────────────────────────
  const VERT = /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  // ─── Seed shader: scatter Orbium-like concentration blobs ────────────────
  const SEED_FRAG = /* glsl */`
    precision highp float;
    varying vec2 vUv;
    uniform float u_channel;
    uniform float u_seed;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      float val = 0.0;
      float R0  = 0.05;  // blob radius in UV space

      // Six scattered Orbium seeds
      for (int i = 0; i < 6; i++) {
        float fi = float(i);
        float cx = hash(vec2(fi * 0.137 + u_channel * 0.371 + u_seed, 0.317));
        float cy = hash(vec2(fi * 0.137 + u_channel * 0.371 + u_seed, 0.741));
        float r  = length(uv - vec2(cx, cy));
        val += exp(-(r * r) / (2.0 * R0 * R0 * 0.35));
      }

      // Ch1 and Ch2 start with faint traces (activator-inhibitor bootstrap)
      if (u_channel > 0.5) val *= 0.12;
      val = clamp(val, 0.0, 1.0);

      gl_FragColor = vec4(val, val, 0.0, 1.0);
    }
  `;

  // ─── Lenia update shader ─────────────────────────────────────────────────
  // One pass per channel. Reads all 3 channels, writes new state for u_channel.
  // Connection matrix W (rows = channels, cols = kernels):
  //       K0    K1    K2
  // Ch0: [1.0,  0.2, -0.5]  ← K0 grows body, K2 suppresses it
  // Ch1: [0.5,  1.0,  0.0]  ← Ch0 drives excitation
  // Ch2: [0.0,  0.8,  1.0]  ← Ch1 drives inhibition
  const SIM_FRAG = /* glsl */`
    precision highp float;
    varying vec2 vUv;

    uniform sampler2D u_ch0;
    uniform sampler2D u_ch1;
    uniform sampler2D u_ch2;
    uniform vec2  u_res;
    uniform float u_dt;
    uniform float u_channel;
    uniform vec3  u_radii;    // kernel radii for ch0, ch1, ch2
    uniform float u_mu_k;
    uniform float u_sig_k;
    uniform vec3  u_mu_g;
    uniform vec3  u_sig_g;
    uniform vec2  u_mouse;
    uniform float u_inject;

    float kWeight(float r, float R) {
      float kr = r / R - u_mu_k;
      return exp(-(kr * kr) / (2.0 * u_sig_k * u_sig_k));
    }

    // Discrete ring-stack convolution: 6 radii × 12 angles = 72 samples
    float conv(sampler2D tex, vec2 uv, float R) {
      const int NR = 6;
      const int NA = 12;
      float sum  = 0.0;
      float wsum = 0.0;
      float pi2  = 6.28318530718;

      for (int ri = 1; ri <= NR; ri++) {
        float r  = R * float(ri) / float(NR);
        float kw = kWeight(r, R) * r;  // r = polar area element
        for (int ai = 0; ai < NA; ai++) {
          float a  = float(ai) / float(NA) * pi2;
          vec2  s  = fract(uv + vec2(cos(a), sin(a)) * r / u_res);
          sum  += texture2D(tex, s).r * kw;
          wsum += kw;
        }
      }
      return wsum > 0.0 ? sum / wsum : 0.0;
    }

    float grow(float u, float mu, float sig) {
      float d = u - mu;
      return 2.0 * exp(-(d * d) / (2.0 * sig * sig)) - 1.0;
    }

    void main() {
      vec2 uv = vUv;
      int  c  = int(u_channel + 0.5);

      // Current states
      float a0 = texture2D(u_ch0, uv).r;
      float a1 = texture2D(u_ch1, uv).r;
      float a2 = texture2D(u_ch2, uv).r;

      // Convolutions (one per channel, using its own kernel radius)
      float u0 = conv(u_ch0, uv, u_radii.x);
      float u1 = conv(u_ch1, uv, u_radii.y);
      float u2 = conv(u_ch2, uv, u_radii.z);

      // Connection matrix: weighted sum for each channel
      float uc0 = 1.0*u0 + 0.2*u1 - 0.5*u2;
      float uc1 = 0.5*u0 + 1.0*u1 + 0.0*u2;
      float uc2 = 0.0*u0 + 0.8*u1 + 1.0*u2;

      float a, uc, mu_g, sig_g;
      if      (c == 0) { a = a0; uc = uc0; mu_g = u_mu_g.x; sig_g = u_sig_g.x; }
      else if (c == 1) { a = a1; uc = uc1; mu_g = u_mu_g.y; sig_g = u_sig_g.y; }
      else             { a = a2; uc = uc2; mu_g = u_mu_g.z; sig_g = u_sig_g.z; }

      // Growth + clip
      float g     = grow(uc, mu_g, sig_g);
      float new_a = clamp(a + u_dt * g, 0.0, 1.0);

      // Mouse injection: pour concentration at cursor
      float dist  = length(uv - u_mouse);
      float inj   = u_inject * smoothstep(0.05, 0.0, dist);
      new_a = clamp(new_a + inj * 0.6, 0.0, 1.0);

      // Pack: .r = new state, .g = prev state, .b = growth rate
      gl_FragColor = vec4(new_a, a, g, 1.0);
    }
  `;

  // ─── Composite display shader ─────────────────────────────────────────────
  // Ch0 → magenta/white (body), Ch1 → cyan (excitation), Ch2 → violet (inhibition)
  // Additive blending, temporal decay, chromatic aberration at edges.
  const DISPLAY_FRAG = /* glsl */`
    precision highp float;
    varying vec2 vUv;

    uniform sampler2D u_ch0;
    uniform sampler2D u_ch1;
    uniform sampler2D u_ch2;
    uniform sampler2D u_prev;
    uniform float     u_time;

    void main() {
      vec2 uv = vUv;

      float a0 = texture2D(u_ch0, uv).r;
      float a1 = texture2D(u_ch1, uv).r;
      float a2 = texture2D(u_ch2, uv).r;
      float g0 = texture2D(u_ch0, uv).b;  // growth rate for heat map

      // Ch0 body: deep magenta → hot magenta → white
      vec3 c0 = mix(vec3(0.18, 0.0, 0.19), vec3(1.0, 0.0, 1.0), a0);
      c0 = mix(c0, vec3(1.0), smoothstep(0.7, 1.0, a0));

      // Ch1 excitation: deep teal → cyan → white
      vec3 c1 = mix(vec3(0.0, 0.19, 0.19), vec3(0.0, 1.0, 0.93), a1);
      c1 = mix(c1, vec3(1.0), smoothstep(0.75, 1.0, a1));

      // Ch2 inhibition: deep void-violet → ultraviolet
      vec3 c2 = mix(vec3(0.04, 0.0, 0.08), vec3(0.53, 0.0, 1.0), a2);

      // Growth heat map: orange glow at active growth boundaries
      vec3 heat = vec3(1.0, 0.4, 0.0) * clamp(g0 * 1.5, 0.0, 1.0) * 0.35;

      // Additive channel composite (dense overlap → white-hot cores)
      vec3 color = c0 * a0 + c1 * a1 * 0.65 + c2 * a2 * 0.4 + heat;

      // Temporal decay — organism light trails
      vec3 prev = texture2D(u_prev, uv).rgb;
      color = max(color, prev * 0.93);

      // Chromatic aberration: RGB split at canvas edges
      float edge = length(uv - 0.5) * 2.0;
      float ab   = edge * edge * 0.004;
      float rr   = texture2D(u_ch0, uv + vec2(ab,  0.0)).r;
      float bb   = texture2D(u_ch0, uv - vec2(ab,  0.0)).r;
      color.r   += rr * 0.25;
      color.b   += bb * 0.18;

      // Vignette
      color *= 1.0 - edge * 0.18;

      gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }
  `;

  // ─── Renderer + render targets ───────────────────────────────────────────
  // canvas/width/height are JS5 sandbox globals; fall back gracefully if absent
  const _canvas = (typeof canvas !== 'undefined' && canvas) ? canvas : document.createElement('canvas');
  const _width  = (typeof width  !== 'undefined' && width)  ? width  : _canvas.width  || 800;
  const _height = (typeof height !== 'undefined' && height) ? height : _canvas.height || 600;

  const renderer = new THREE.WebGLRenderer({
    canvas: _canvas,
    antialias: false,
    powerPreference: 'high-performance',
  });
  renderer.setSize(_width, _height);
  renderer.setPixelRatio(1);
  renderer.autoClear = false;

  const simOpts = {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
    type: THREE.FloatType,
    depthBuffer: false,
    stencilBuffer: false,
  };

  function makeSimRT() {
    return new THREE.WebGLRenderTarget(SIM, SIM, simOpts);
  }

  // Ping-pong buffers: bufs[channel][0 or 1]
  const bufs = [
    [makeSimRT(), makeSimRT()],
    [makeSimRT(), makeSimRT()],
    [makeSimRT(), makeSimRT()],
  ];

  // Display ping-pong targets at screen resolution (for temporal decay)
  const dispOpts = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    depthBuffer: false,
    stencilBuffer: false,
  };
  const dispRT = [
    new THREE.WebGLRenderTarget(_width, _height, dispOpts),
    new THREE.WebGLRenderTarget(_width, _height, dispOpts),
  ];

  // Read pointer per channel (0 or 1 — which buffer holds current state)
  const ridx  = [0, 0, 0];
  let dispIdx = 0;

  // Shared orthographic camera + quad geometry
  const cam  = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.PlaneGeometry(2, 2);

  // ─── Seed pass ────────────────────────────────────────────────────────────
  const seedUni = {
    u_channel: { value: 0.0 },
    u_seed:    { value: Math.random() * 100.0 },
  };
  const seedMat   = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: SEED_FRAG, uniforms: seedUni });
  const seedScene = new THREE.Scene();
  seedScene.add(new THREE.Mesh(quad, seedMat));

  for (let c = 0; c < 3; c++) {
    seedUni.u_channel.value = c;
    renderer.setRenderTarget(bufs[c][0]); renderer.render(seedScene, cam);
    renderer.setRenderTarget(bufs[c][1]); renderer.render(seedScene, cam);
  }

  // ─── Simulation material ──────────────────────────────────────────────────
  const simUni = {
    u_ch0:     { value: null },
    u_ch1:     { value: null },
    u_ch2:     { value: null },
    u_res:     { value: new THREE.Vector2(SIM, SIM) },
    u_dt:      { value: DT },
    u_channel: { value: 0.0 },
    u_radii:   { value: new THREE.Vector3(R_CH[0], R_CH[1], R_CH[2]) },
    u_mu_k:    { value: MU_K },
    u_sig_k:   { value: SIG_K },
    u_mu_g:    { value: new THREE.Vector3(MU_G[0], MU_G[1], MU_G[2]) },
    u_sig_g:   { value: new THREE.Vector3(SIG_G[0], SIG_G[1], SIG_G[2]) },
    u_mouse:   { value: new THREE.Vector2(0.5, 0.5) },
    u_inject:  { value: 0.0 },
  };
  const simMat   = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: SIM_FRAG, uniforms: simUni });
  const simScene = new THREE.Scene();
  simScene.add(new THREE.Mesh(quad, simMat));

  // ─── Display material ─────────────────────────────────────────────────────
  const dispUni = {
    u_ch0:  { value: null },
    u_ch1:  { value: null },
    u_ch2:  { value: null },
    u_prev: { value: null },
    u_time: { value: 0.0 },
  };
  const dispMat   = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: DISPLAY_FRAG, uniforms: dispUni });
  const dispScene = new THREE.Scene();
  dispScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), dispMat));

  // ─── Screen blit ──────────────────────────────────────────────────────────
  const blitMat   = new THREE.MeshBasicMaterial({ map: null });
  const blitScene = new THREE.Scene();
  blitScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blitMat));

  // ─── Mouse / scroll / key interactions ───────────────────────────────────
  let isMouseDown = false;
  canvas.addEventListener('mousedown',  () => { isMouseDown = true; });
  canvas.addEventListener('mouseup',    () => { isMouseDown = false; });
  canvas.addEventListener('touchstart', () => { isMouseDown = true; },  { passive: true });
  canvas.addEventListener('touchend',   () => { isMouseDown = false; }, { passive: true });

  // Scroll: adjust timestep — fast scroll → chaotic explosion
  canvas.addEventListener('wheel', (e) => {
    simUni.u_dt.value = Math.max(0.04, Math.min(0.55, simUni.u_dt.value + e.deltaY * 0.0002));
  }, { passive: true });

  // Key 'm': mutate connection matrix weights (personality shift)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'm' || e.key === 'M') {
      // Slightly perturb W entries — keeps organisms alive but changes behavior
      simUni.u_mu_g.value.x = 0.10 + Math.random() * 0.10;
      simUni.u_mu_g.value.y = 0.10 + Math.random() * 0.10;
      simUni.u_mu_g.value.z = 0.10 + Math.random() * 0.08;
    }
    // Key 'r': re-seed the simulation
    if (e.key === 'r' || e.key === 'R') {
      seedUni.u_seed.value = Math.random() * 100.0;
      for (let c = 0; c < 3; c++) {
        seedUni.u_channel.value = c;
        renderer.setRenderTarget(bufs[c][ridx[c]]); renderer.render(seedScene, cam);
        renderer.setRenderTarget(bufs[c][1 - ridx[c]]); renderer.render(seedScene, cam);
      }
    }
  });

  // ─── Render loop ──────────────────────────────────────────────────────────
  function frame(t) {
    // Mouse UV coordinates (Y-flipped for WebGL convention)
    const _mouse = (typeof mouse !== 'undefined') ? mouse : null;
    const mx = (_mouse && _mouse.x != null) ? _mouse.x / _width        : 0.5;
    const my = (_mouse && _mouse.y != null) ? 1.0 - _mouse.y / _height : 0.5;

    const injecting = isMouseDown || (_mouse && _mouse.buttons > 0) ? 1.0 : 0.0;

    // Simulation step — one shader pass per channel
    for (let c = 0; c < 3; c++) {
      simUni.u_ch0.value     = bufs[0][ridx[0]].texture;
      simUni.u_ch1.value     = bufs[1][ridx[1]].texture;
      simUni.u_ch2.value     = bufs[2][ridx[2]].texture;
      simUni.u_channel.value = c;
      simUni.u_mouse.value.set(mx, my);
      simUni.u_inject.value  = injecting;

      renderer.setRenderTarget(bufs[c][1 - ridx[c]]);
      renderer.render(simScene, cam);
    }

    // Swap read pointers
    for (let c = 0; c < 3; c++) ridx[c] = 1 - ridx[c];

    // Composite display (channel blend + temporal decay + chromatic aberration)
    dispUni.u_ch0.value  = bufs[0][ridx[0]].texture;
    dispUni.u_ch1.value  = bufs[1][ridx[1]].texture;
    dispUni.u_ch2.value  = bufs[2][ridx[2]].texture;
    dispUni.u_prev.value = dispRT[1 - dispIdx].texture;
    dispUni.u_time.value = t * 0.001;

    renderer.setRenderTarget(dispRT[dispIdx]);
    renderer.render(dispScene, cam);

    // Blit composite to screen
    blitMat.map = dispRT[dispIdx].texture;
    renderer.setRenderTarget(null);
    renderer.render(blitScene, cam);

    dispIdx = 1 - dispIdx;
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
