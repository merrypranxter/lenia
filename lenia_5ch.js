// Lenia — JS5 sketch for RepoScripter2
// Five-channel multi-kernel simulation: Volvox + Pentarbium configuration.
// 256×256 GPGPU on ping-pong FBOs. Four sub-organisms orbit a shared mass center.
// Channels: body (magenta) · excitation (cyan) · inhibition (violet) · trace (gold) · scaffold (white)

(function () {
  'use strict';

  // ─── Simulation parameters ───────────────────────────────────────────────
  const SIM = 256;          // simulation grid resolution
  const DT  = 0.10;         // timestep — increase toward 0.4 for chaos

  // Kernel radius per channel
  const R_CH = [13.0, 9.0, 21.0, 15.0, 11.0];

  // Kernel shape (shared μ_k / σ_k across channels; Volvox lives in [0.5, 0.15])
  const MU_K  = 0.5;
  const SIG_K = 0.15;

  // Growth function centers / widths per channel
  const MU_G  = [0.150, 0.140, 0.130, 0.160, 0.145];
  const SIG_G = [0.020, 0.020, 0.020, 0.020, 0.025];

  // Connection matrix W (5×5): w[dst_channel][src_kernel]
  // Rows = which channel gets updated; columns = which kernel drives it
  //         K0     K1     K2     K3     K4
  const W = [
    [ 1.0,  0.0, -0.4,  0.1,  0.0],  // Ch0: body
    [ 0.3,  1.0,  0.0, -0.2,  0.0],  // Ch1: excitation
    [ 0.0,  0.5,  1.0,  0.0, -0.3],  // Ch2: inhibition
    [ 0.2,  0.0,  0.3,  1.0,  0.0],  // Ch3: trace / memory
    [ 0.0,  0.1,  0.0,  0.6,  1.0],  // Ch4: scaffold
  ];

  // ─── Shared vertex shader ─────────────────────────────────────────────────
  const VERT = /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  // ─── Seed shader ──────────────────────────────────────────────────────────
  // Scatter Volvox-seed blobs: 4 clusters per channel, offset radially
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
      float R0  = 0.045;

      // Four colony seeds arranged in a ring (Volvox bootstrap geometry)
      float pi2 = 6.28318530718;
      for (int i = 0; i < 4; i++) {
        float fi   = float(i);
        float angle = fi / 4.0 * pi2 + u_seed * 0.01 + u_channel * 0.7;
        vec2 center = vec2(0.5) + 0.22 * vec2(cos(angle), sin(angle));
        float r     = length(uv - center);
        val += exp(-(r * r) / (2.0 * R0 * R0));
      }

      // Channels 1–4 start faint — body (Ch0) is the primary seed
      if (u_channel > 0.5) val *= 0.08;
      val = clamp(val, 0.0, 1.0);

      gl_FragColor = vec4(val, val, 0.0, 1.0);
    }
  `;

  // ─── Simulation update shader ─────────────────────────────────────────────
  // One pass per channel. Reads all 5 channels, applies ring convolution,
  // weights by W matrix row, advances by growth function G.
  const SIM_FRAG = /* glsl */`
    precision highp float;
    varying vec2 vUv;

    uniform sampler2D u_ch0;
    uniform sampler2D u_ch1;
    uniform sampler2D u_ch2;
    uniform sampler2D u_ch3;
    uniform sampler2D u_ch4;
    uniform vec2  u_res;
    uniform float u_dt;
    uniform float u_channel;

    // Per-channel kernel radii (packed into two uniforms)
    uniform vec3  u_radii_a;   // ch0, ch1, ch2
    uniform vec2  u_radii_b;   // ch3, ch4
    uniform float u_mu_k;
    uniform float u_sig_k;

    // Growth parameters
    uniform vec3  u_mu_g_a;    // ch0, ch1, ch2
    uniform vec2  u_mu_g_b;    // ch3, ch4
    uniform vec3  u_sig_g_a;
    uniform vec2  u_sig_g_b;

    // Connection matrix rows (5 channels × 5 kernels = 25 floats — packed as 5 vec4+float)
    // w_row[c] = [w_{c,0}, w_{c,1}, w_{c,2}, w_{c,3}, w_{c,4}]
    uniform vec4  u_w0a; uniform float u_w0b;  // row 0 (ch0)
    uniform vec4  u_w1a; uniform float u_w1b;  // row 1 (ch1)
    uniform vec4  u_w2a; uniform float u_w2b;  // row 2 (ch2)
    uniform vec4  u_w3a; uniform float u_w3b;  // row 3 (ch3)
    uniform vec4  u_w4a; uniform float u_w4b;  // row 4 (ch4)

    uniform vec2  u_mouse;
    uniform float u_inject;

    float kWeight(float r, float R) {
      float kr = r / R - u_mu_k;
      return exp(-(kr * kr) / (2.0 * u_sig_k * u_sig_k));
    }

    // Ring convolution: 8 radii × 16 angles = 128 samples
    float conv(sampler2D tex, vec2 uv, float R) {
      const int NR = 8;
      const int NA = 16;
      float sum = 0.0, wsum = 0.0;
      float pi2 = 6.28318530718;
      for (int ri = 1; ri <= NR; ri++) {
        float r  = R * float(ri) / float(NR);
        float kw = kWeight(r, R) * r;
        for (int ai = 0; ai < NA; ai++) {
          float a = float(ai) / float(NA) * pi2;
          vec2  s = fract(uv + vec2(cos(a), sin(a)) * r / u_res);
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
      vec2  uv = vUv;
      int   c  = int(u_channel + 0.5);

      // Current channel states at this pixel
      float a0 = texture2D(u_ch0, uv).r;
      float a1 = texture2D(u_ch1, uv).r;
      float a2 = texture2D(u_ch2, uv).r;
      float a3 = texture2D(u_ch3, uv).r;
      float a4 = texture2D(u_ch4, uv).r;

      // Convolutions per kernel (each kernel reads from its "own" channel)
      float k0 = conv(u_ch0, uv, u_radii_a.x);
      float k1 = conv(u_ch1, uv, u_radii_a.y);
      float k2 = conv(u_ch2, uv, u_radii_a.z);
      float k3 = conv(u_ch3, uv, u_radii_b.x);
      float k4 = conv(u_ch4, uv, u_radii_b.y);

      // Apply connection matrix row for target channel c
      float uc = 0.0;
      float a  = 0.0;
      float mu_g = 0.0, sig_g = 0.0;

      if (c == 0) {
        uc   = u_w0a.x*k0 + u_w0a.y*k1 + u_w0a.z*k2 + u_w0a.w*k3 + u_w0b*k4;
        a    = a0; mu_g = u_mu_g_a.x; sig_g = u_sig_g_a.x;
      } else if (c == 1) {
        uc   = u_w1a.x*k0 + u_w1a.y*k1 + u_w1a.z*k2 + u_w1a.w*k3 + u_w1b*k4;
        a    = a1; mu_g = u_mu_g_a.y; sig_g = u_sig_g_a.y;
      } else if (c == 2) {
        uc   = u_w2a.x*k0 + u_w2a.y*k1 + u_w2a.z*k2 + u_w2a.w*k3 + u_w2b*k4;
        a    = a2; mu_g = u_mu_g_a.z; sig_g = u_sig_g_a.z;
      } else if (c == 3) {
        uc   = u_w3a.x*k0 + u_w3a.y*k1 + u_w3a.z*k2 + u_w3a.w*k3 + u_w3b*k4;
        a    = a3; mu_g = u_mu_g_b.x; sig_g = u_sig_g_b.x;
      } else {
        uc   = u_w4a.x*k0 + u_w4a.y*k1 + u_w4a.z*k2 + u_w4a.w*k3 + u_w4b*k4;
        a    = a4; mu_g = u_mu_g_b.y; sig_g = u_sig_g_b.y;
      }

      float g     = grow(uc, mu_g, sig_g);
      float new_a = clamp(a + u_dt * g, 0.0, 1.0);

      // Mouse: pour concentration at cursor position
      float dist  = length(uv - u_mouse);
      float inj   = u_inject * smoothstep(0.06, 0.0, dist);
      new_a = clamp(new_a + inj * 0.5, 0.0, 1.0);

      // .r = new state · .g = prev state · .b = growth rate
      gl_FragColor = vec4(new_a, a, g, 1.0);
    }
  `;

  // ─── Composite display shader ─────────────────────────────────────────────
  // 5-channel Volvox color mapping:
  //   Ch0 → deep magenta → electric white   (body)
  //   Ch1 → teal → electric cyan            (excitation)
  //   Ch2 → void-violet → ultraviolet       (inhibition)
  //   Ch3 → dark amber → gold               (trace/memory)
  //   Ch4 → navy → cold white               (scaffold)
  const DISPLAY_FRAG = /* glsl */`
    precision highp float;
    varying vec2 vUv;

    uniform sampler2D u_ch0;
    uniform sampler2D u_ch1;
    uniform sampler2D u_ch2;
    uniform sampler2D u_ch3;
    uniform sampler2D u_ch4;
    uniform sampler2D u_prev;
    uniform float     u_time;

    void main() {
      vec2 uv = vUv;

      float a0 = texture2D(u_ch0, uv).r;
      float a1 = texture2D(u_ch1, uv).r;
      float a2 = texture2D(u_ch2, uv).r;
      float a3 = texture2D(u_ch3, uv).r;
      float a4 = texture2D(u_ch4, uv).r;
      float g0 = texture2D(u_ch0, uv).b;  // growth rate heat

      // Ch0: deep magenta → hot magenta → white
      vec3 c0 = mix(vec3(0.176, 0.0, 0.188), vec3(1.0, 0.0, 1.0), a0);
      c0 = mix(c0, vec3(1.0), smoothstep(0.70, 1.0, a0));

      // Ch1: deep teal → electric cyan → white
      vec3 c1 = mix(vec3(0.0, 0.188, 0.188), vec3(0.0, 1.0, 0.933), a1);
      c1 = mix(c1, vec3(1.0), smoothstep(0.75, 1.0, a1));

      // Ch2: void-violet → ultraviolet
      vec3 c2 = mix(vec3(0.039, 0.0, 0.082), vec3(0.533, 0.0, 1.0), a2);

      // Ch3: amber trace
      vec3 c3 = mix(vec3(0.08, 0.04, 0.0), vec3(1.0, 0.7, 0.0), a3);

      // Ch4: cold scaffold — near-white, low opacity
      vec3 c4 = mix(vec3(0.0, 0.02, 0.06), vec3(0.6, 0.8, 1.0), a4);

      // Growth heat map: orange-white at active growth boundaries
      vec3 heat = vec3(1.0, 0.4, 0.0) * clamp(abs(g0) * 2.0, 0.0, 1.0) * 0.30;

      // Additive composite: dense multi-channel overlap → white-hot cores
      vec3 color  = c0 * a0
                  + c1 * a1 * 0.70
                  + c2 * a2 * 0.40
                  + c3 * a3 * 0.50
                  + c4 * a4 * 0.25
                  + heat;

      // Temporal decay — phosphorescent trails
      vec3 prev = texture2D(u_prev, uv).rgb;
      color = max(color, prev * 0.92);

      // Chromatic aberration — plasma fringe at canvas edges
      float edge = length(uv - 0.5) * 2.0;
      float ab   = edge * edge * 0.005;
      float rr   = texture2D(u_ch0, uv + vec2(ab,  0.0)).r;
      float bb   = texture2D(u_ch0, uv - vec2(ab,  0.0)).r;
      color.r   += rr * 0.20;
      color.b   += bb * 0.15;

      // Vignette
      color *= 1.0 - edge * 0.20;

      gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }
  `;

  // ─── Setup renderer + render targets ─────────────────────────────────────
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

  function makeRT() { return new THREE.WebGLRenderTarget(SIM, SIM, simOpts); }

  // Ping-pong buffers: bufs[channel][0 or 1]
  const NC   = 5;
  const bufs = Array.from({ length: NC }, () => [makeRT(), makeRT()]);
  const ridx = new Array(NC).fill(0);

  const dispOpts = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    depthBuffer: false,
    stencilBuffer: false,
  };
  const dispRT  = [
    new THREE.WebGLRenderTarget(_width, _height, dispOpts),
    new THREE.WebGLRenderTarget(_width, _height, dispOpts),
  ];
  let dispIdx = 0;

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

  for (let c = 0; c < NC; c++) {
    seedUni.u_channel.value = c;
    renderer.setRenderTarget(bufs[c][0]); renderer.render(seedScene, cam);
    renderer.setRenderTarget(bufs[c][1]); renderer.render(seedScene, cam);
  }

  // ─── Simulation material ──────────────────────────────────────────────────
  const simUni = {
    u_ch0:      { value: null },
    u_ch1:      { value: null },
    u_ch2:      { value: null },
    u_ch3:      { value: null },
    u_ch4:      { value: null },
    u_res:      { value: new THREE.Vector2(SIM, SIM) },
    u_dt:       { value: DT },
    u_channel:  { value: 0.0 },
    u_radii_a:  { value: new THREE.Vector3(R_CH[0], R_CH[1], R_CH[2]) },
    u_radii_b:  { value: new THREE.Vector2(R_CH[3], R_CH[4]) },
    u_mu_k:     { value: MU_K },
    u_sig_k:    { value: SIG_K },
    u_mu_g_a:   { value: new THREE.Vector3(MU_G[0], MU_G[1], MU_G[2]) },
    u_mu_g_b:   { value: new THREE.Vector2(MU_G[3], MU_G[4]) },
    u_sig_g_a:  { value: new THREE.Vector3(SIG_G[0], SIG_G[1], SIG_G[2]) },
    u_sig_g_b:  { value: new THREE.Vector2(SIG_G[3], SIG_G[4]) },
    // Connection matrix rows
    u_w0a: { value: new THREE.Vector4(W[0][0], W[0][1], W[0][2], W[0][3]) },
    u_w0b: { value: W[0][4] },
    u_w1a: { value: new THREE.Vector4(W[1][0], W[1][1], W[1][2], W[1][3]) },
    u_w1b: { value: W[1][4] },
    u_w2a: { value: new THREE.Vector4(W[2][0], W[2][1], W[2][2], W[2][3]) },
    u_w2b: { value: W[2][4] },
    u_w3a: { value: new THREE.Vector4(W[3][0], W[3][1], W[3][2], W[3][3]) },
    u_w3b: { value: W[3][4] },
    u_w4a: { value: new THREE.Vector4(W[4][0], W[4][1], W[4][2], W[4][3]) },
    u_w4b: { value: W[4][4] },
    u_mouse:  { value: new THREE.Vector2(0.5, 0.5) },
    u_inject: { value: 0.0 },
  };
  const simMat   = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: SIM_FRAG, uniforms: simUni });
  const simScene = new THREE.Scene();
  simScene.add(new THREE.Mesh(quad, simMat));

  // ─── Display material ─────────────────────────────────────────────────────
  const dispUni = {
    u_ch0:  { value: null },
    u_ch1:  { value: null },
    u_ch2:  { value: null },
    u_ch3:  { value: null },
    u_ch4:  { value: null },
    u_prev: { value: null },
    u_time: { value: 0.0 },
  };
  const dispMat   = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: DISPLAY_FRAG, uniforms: dispUni });
  const dispScene = new THREE.Scene();
  dispScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), dispMat));

  const blitMat   = new THREE.MeshBasicMaterial({ map: null });
  const blitScene = new THREE.Scene();
  blitScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blitMat));

  // ─── Interactions ─────────────────────────────────────────────────────────
  let isMouseDown = false;
  _canvas.addEventListener('mousedown',  () => { isMouseDown = true; });
  _canvas.addEventListener('mouseup',    () => { isMouseDown = false; });
  _canvas.addEventListener('touchstart', () => { isMouseDown = true; },  { passive: true });
  _canvas.addEventListener('touchend',   () => { isMouseDown = false; }, { passive: true });

  // Scroll: tune timestep
  _canvas.addEventListener('wheel', (e) => {
    simUni.u_dt.value = Math.max(0.04, Math.min(0.50, simUni.u_dt.value + e.deltaY * 0.0002));
  }, { passive: true });

  window.addEventListener('keydown', (e) => {
    // 'm': mutate growth parameters → personality shift
    if (e.key === 'm' || e.key === 'M') {
      simUni.u_mu_g_a.value.set(
        0.10 + Math.random() * 0.10,
        0.09 + Math.random() * 0.10,
        0.08 + Math.random() * 0.08
      );
    }
    // 'r': full reseed
    if (e.key === 'r' || e.key === 'R') {
      seedUni.u_seed.value = Math.random() * 100.0;
      for (let c = 0; c < NC; c++) {
        seedUni.u_channel.value = c;
        renderer.setRenderTarget(bufs[c][ridx[c]]);     renderer.render(seedScene, cam);
        renderer.setRenderTarget(bufs[c][1 - ridx[c]]); renderer.render(seedScene, cam);
      }
    }
    // 'v': switch to Volvox colony seed (tighter ring cluster)
    if (e.key === 'v' || e.key === 'V') {
      seedUni.u_seed.value = Math.floor(Math.random() * 10) * 7.3;
      for (let c = 0; c < NC; c++) {
        seedUni.u_channel.value = c;
        renderer.setRenderTarget(bufs[c][ridx[c]]);     renderer.render(seedScene, cam);
        renderer.setRenderTarget(bufs[c][1 - ridx[c]]); renderer.render(seedScene, cam);
      }
    }
  });

  // ─── Render loop ──────────────────────────────────────────────────────────
  function frame(t) {
    const _mouse = (typeof mouse !== 'undefined') ? mouse : null;
    const mx = (_mouse && _mouse.x != null) ? _mouse.x / _width        : 0.5;
    const my = (_mouse && _mouse.y != null) ? 1.0 - _mouse.y / _height : 0.5;
    const injecting = (isMouseDown || (_mouse && _mouse.buttons > 0)) ? 1.0 : 0.0;

    // Update all 5 channels
    for (let c = 0; c < NC; c++) {
      simUni.u_ch0.value     = bufs[0][ridx[0]].texture;
      simUni.u_ch1.value     = bufs[1][ridx[1]].texture;
      simUni.u_ch2.value     = bufs[2][ridx[2]].texture;
      simUni.u_ch3.value     = bufs[3][ridx[3]].texture;
      simUni.u_ch4.value     = bufs[4][ridx[4]].texture;
      simUni.u_channel.value = c;
      simUni.u_mouse.value.set(mx, my);
      simUni.u_inject.value  = injecting;

      renderer.setRenderTarget(bufs[c][1 - ridx[c]]);
      renderer.render(simScene, cam);
    }

    for (let c = 0; c < NC; c++) ridx[c] = 1 - ridx[c];

    // Composite display
    dispUni.u_ch0.value  = bufs[0][ridx[0]].texture;
    dispUni.u_ch1.value  = bufs[1][ridx[1]].texture;
    dispUni.u_ch2.value  = bufs[2][ridx[2]].texture;
    dispUni.u_ch3.value  = bufs[3][ridx[3]].texture;
    dispUni.u_ch4.value  = bufs[4][ridx[4]].texture;
    dispUni.u_prev.value = dispRT[1 - dispIdx].texture;
    dispUni.u_time.value = t * 0.001;

    renderer.setRenderTarget(dispRT[dispIdx]);
    renderer.render(dispScene, cam);

    blitMat.map = dispRT[dispIdx].texture;
    renderer.setRenderTarget(null);
    renderer.render(blitScene, cam);

    dispIdx = 1 - dispIdx;
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
