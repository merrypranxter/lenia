// Lenia — Pure CPU Canvas 2D reference implementation
// No WebGL. No Three.js. Single-channel Orbium simulation in pure JavaScript.
// Uses Float32Arrays and Canvas 2D ImageData. Runs ~10-20fps at 128×128.
//
// PURPOSE: understand the math without GPU abstraction.
//          prototype new organisms. sweep parameters. screenshot sequences.
//
// USAGE (browser):
//   <canvas id="c" width="512" height="512"></canvas>
//   <script src="lenia_cpu.js"></script>
//
// USAGE (RepoScripter2 / JS5 sandbox):
//   Drop this file in. canvas/width/height are available as globals.

(function () {
  'use strict';

  // ─── Configuration ────────────────────────────────────────────────────────
  const CONFIG = {
    N:     128,       // grid size (NxN). 128 is fast; 256 is richer but ~4× slower.
    dt:    0.10,      // timestep. 0.10 = Orbium stable. > 0.40 = chaos.
    R:     13,        // kernel radius in grid cells
    mu_k:  0.5,       // kernel ring center (fraction of R)
    sig_k: 0.15,      // kernel ring width
    mu_g:  0.150,     // growth sweet spot (Orbium family)
    sig_g: 0.015,     // growth tolerance (narrow = brittle, wide = amorphous)
    // Aesthetic
    decay: 0.92,      // trail decay per frame (0.90 = long trails, 0.99 = short)
    scale: 4,         // canvas pixels per simulation cell (canvas = N*scale)
  };

  // ─── Canvas setup ─────────────────────────────────────────────────────────
  const cvs = (typeof canvas !== 'undefined' && canvas)
    ? canvas
    : (document.getElementById('c') || document.createElement('canvas'));

  const W = CONFIG.N * CONFIG.scale;
  const H = CONFIG.N * CONFIG.scale;
  cvs.width  = W;
  cvs.height = H;

  const ctx = cvs.getContext('2d');

  // ─── Simulation state ─────────────────────────────────────────────────────
  const N = CONFIG.N;

  // Two Float32 grids for ping-pong
  let A = new Float32Array(N * N);  // current state
  let B = new Float32Array(N * N);  // next state
  // Display buffer with phosphorescent trails (display space: W×H×4)
  const displayBuf = new Float32Array(W * H * 4);
  const imgData    = ctx.createImageData(W, H);

  // ─── Kernel precompute ────────────────────────────────────────────────────
  // Precompute the ring kernel as a 2D weight array for direct convolution.
  // This avoids recomputing K(r) per pixel per frame.
  const kSize  = 2 * CONFIG.R + 1;
  const kMid   = CONFIG.R;
  const kernel = new Float32Array(kSize * kSize);
  let   kSum   = 0.0;

  for (let ky = 0; ky < kSize; ky++) {
    for (let kx = 0; kx < kSize; kx++) {
      const dx = kx - kMid;
      const dy = ky - kMid;
      const r  = Math.sqrt(dx * dx + dy * dy);
      const rn = r / CONFIG.R;
      const kr = rn - CONFIG.mu_k;
      const w  = Math.exp(-(kr * kr) / (2.0 * CONFIG.sig_k * CONFIG.sig_k));
      kernel[ky * kSize + kx] = w;
      kSum += w;
    }
  }
  // Normalize so kernel sums to 1
  for (let i = 0; i < kernel.length; i++) kernel[i] /= kSum;

  // ─── Seed: scatter Orbium-like blobs ──────────────────────────────────────
  function seed(state) {
    state.fill(0);
    const nBlobs = 6;
    const blobR  = Math.floor(N * 0.045);  // blob radius in grid cells
    for (let b = 0; b < nBlobs; b++) {
      const cx = Math.floor(Math.random() * N);
      const cy = Math.floor(Math.random() * N);
      for (let dy = -blobR * 3; dy <= blobR * 3; dy++) {
        for (let dx = -blobR * 3; dx <= blobR * 3; dx++) {
          const r2   = (dx * dx + dy * dy) / (blobR * blobR);
          const val  = Math.exp(-r2 * 2.5);
          const px   = ((cx + dx) % N + N) % N;
          const py   = ((cy + dy) % N + N) % N;
          state[py * N + px] = Math.min(1.0, state[py * N + px] + val);
        }
      }
    }
  }

  seed(A);

  // ─── Lenia math ───────────────────────────────────────────────────────────
  function growthFn(u) {
    const d = u - CONFIG.mu_g;
    return 2.0 * Math.exp(-(d * d) / (2.0 * CONFIG.sig_g * CONFIG.sig_g)) - 1.0;
  }

  // Convolve A with the precomputed kernel → store result in convOut
  const convOut = new Float32Array(N * N);

  function convolve(src, dst) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let sum = 0.0;
        for (let ky = 0; ky < kSize; ky++) {
          const sy = ((y + ky - kMid) % N + N) % N;
          for (let kx = 0; kx < kSize; kx++) {
            const sx = ((x + kx - kMid) % N + N) % N;
            sum += src[sy * N + sx] * kernel[ky * kSize + kx];
          }
        }
        dst[y * N + x] = sum;
      }
    }
  }

  function step(src, dst) {
    convolve(src, convOut);
    for (let i = 0; i < N * N; i++) {
      const g  = growthFn(convOut[i]);
      const a  = src[i] + CONFIG.dt * g;
      dst[i]   = Math.min(1.0, Math.max(0.0, a));
    }
  }

  // ─── Mouse injection ──────────────────────────────────────────────────────
  let mouseX = -1, mouseY = -1, mouseDown = false;

  cvs.addEventListener('mousemove', (e) => {
    const rect = cvs.getBoundingClientRect();
    mouseX = (e.clientX - rect.left) / CONFIG.scale;
    mouseY = (e.clientY - rect.top)  / CONFIG.scale;
  });
  cvs.addEventListener('mousedown',  () => { mouseDown = true; });
  cvs.addEventListener('mouseup',    () => { mouseDown = false; });
  cvs.addEventListener('touchstart', (e) => {
    mouseDown = true;
    const t = e.touches[0];
    const r = cvs.getBoundingClientRect();
    mouseX = (t.clientX - r.left) / CONFIG.scale;
    mouseY = (t.clientY - r.top)  / CONFIG.scale;
  }, { passive: true });
  cvs.addEventListener('touchend', () => { mouseDown = false; }, { passive: true });

  // Scroll: adjust timestep
  cvs.addEventListener('wheel', (e) => {
    CONFIG.dt = Math.min(0.50, Math.max(0.04, CONFIG.dt + e.deltaY * 0.0002));
  }, { passive: true });

  // Keys: 'r' reseed, 'm' mutate growth params
  window.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') seed(A);
    if (e.key === 'm' || e.key === 'M') {
      CONFIG.mu_g  = 0.10 + Math.random() * 0.12;
      CONFIG.sig_g = 0.01 + Math.random() * 0.03;
      // Recompute kernel is not needed (kernel shape unchanged by growth params)
    }
    if (e.key === 'ArrowUp')   CONFIG.dt = Math.min(0.50, CONFIG.dt + 0.01);
    if (e.key === 'ArrowDown') CONFIG.dt = Math.max(0.02, CONFIG.dt - 0.01);
  });

  function injectMouse(state) {
    if (!mouseDown || mouseX < 0) return;
    const cx = Math.floor(mouseX);
    const cy = Math.floor(mouseY);
    const br = 4;
    for (let dy = -br; dy <= br; dy++) {
      for (let dx = -br; dx <= br; dx++) {
        const r2  = (dx * dx + dy * dy) / (br * br);
        const val = 0.6 * Math.exp(-r2 * 2.0);
        const px  = ((cx + dx) % N + N) % N;
        const py  = ((cy + dy) % N + N) % N;
        state[py * N + px] = Math.min(1.0, state[py * N + px] + val);
      }
    }
  }

  // ─── Rendering ────────────────────────────────────────────────────────────
  // Map Lenia state value → magenta/cyan/white color (Orbium palette)
  function stateToRGB(v) {
    // 0→black, 0.3→deep magenta, 0.6→hot magenta, 0.85→white
    const r = v < 0.3  ? v / 0.3 * 0.18  : v < 0.85 ? 0.18 + (v - 0.3) / 0.55 * 0.82 : 1.0;
    const g = v < 0.6  ? 0.0              : (v - 0.6) / 0.4;
    const b = v < 0.3  ? v / 0.3 * 0.19  : v < 0.85 ? 0.19 + (v - 0.3) / 0.55 * 0.81 : 1.0;
    return [r, g, b];
  }

  function render(state) {
    // Upscale N×N → W×H and blend with phosphorescent trail buffer
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const v    = state[y * N + x];
        const col  = stateToRGB(v);
        // Paint scale×scale block into displayBuf
        for (let sy = 0; sy < CONFIG.scale; sy++) {
          for (let sx = 0; sx < CONFIG.scale; sx++) {
            const px = (y * CONFIG.scale + sy) * W + (x * CONFIG.scale + sx);
            const i  = px * 4;
            // Additive with trail decay: new = max(sim, trail * decay)
            displayBuf[i + 0] = Math.max(col[0], displayBuf[i + 0] * CONFIG.decay);
            displayBuf[i + 1] = Math.max(col[1], displayBuf[i + 1] * CONFIG.decay);
            displayBuf[i + 2] = Math.max(col[2], displayBuf[i + 2] * CONFIG.decay);
            displayBuf[i + 3] = 1.0;
          }
        }
      }
    }
    // Write Float32 to Uint8 ImageData
    for (let i = 0; i < W * H * 4; i += 4) {
      imgData.data[i + 0] = Math.min(255, (displayBuf[i + 0] * 255) | 0);
      imgData.data[i + 1] = Math.min(255, (displayBuf[i + 1] * 255) | 0);
      imgData.data[i + 2] = Math.min(255, (displayBuf[i + 2] * 255) | 0);
      imgData.data[i + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
  }

  // ─── Main loop ────────────────────────────────────────────────────────────
  function frame() {
    injectMouse(A);
    step(A, B);
    render(B);
    // Swap buffers
    const tmp = A; A = B; B = tmp;
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
