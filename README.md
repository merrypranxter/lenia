# 🧫 Lenia

> *"Life is not a thing. It is a process — a pattern that refuses to dissolve."*

A multi-kernel continuous cellular automata engine for RepoScripter2 and ShaderForge. Alien lifeforms self-assembling from pure mathematics — layered chemical channels, inter-channel kernel convolutions, GPU-accelerated emergence, and standalone GLSL shaders for any pipeline. Designed as a deep context source for AI-generated generative art.

---

## The Lenia Model

Lenia is a **continuous generalization of Conway's Game of Life**. Where Game of Life has binary cells and discrete time, Lenia has:

- **Continuous state**: every cell holds a value in [0, 1], not just alive/dead
- **Continuous space**: smooth convolution kernels, not 3×3 neighbor counts
- **Continuous time**: fractional timesteps, not tick/tock
- **Multi-channel**: multiple interacting chemical layers, not one grid

The result: **organisms**. Self-organizing, self-repairing, gliding patterns that behave like alien microbes. Some rotate. Some pulse. Some undergo binary fission.

---

## The Channel Architecture

Multi-kernel Lenia runs **C independent channels** (typically 3–5), each representing a distinct "chemical substance." Channels interact via a **kernel connection matrix** — channel A can drive growth in channel B, which suppresses channel C, which feeds back into A. Complex organisms emerge from these loops.

| Channel | Role | Visual Character |
|---------|------|-----------------|
| **Ch. 0** | Primary organism body | Dense magenta core, hard membrane edge |
| **Ch. 1** | Excitation signal | Cyan pulse-halo spreading ahead of the body |
| **Ch. 2** | Inhibition field | Violet suppression cloud trailing behind |
| **Ch. 3** | Trace / memory | Phosphorescent ghost trail, decays in 200+ frames |
| **Ch. 4** | Structural scaffold | Dimly lit geometric skeleton guiding locomotion |

Each channel has its own **kernel** and **growth function**. Channels that share similar kernel radii lock into stable organisms. Channels with mismatched radii produce turbulent, asymmetric creatures that skitter and spiral.

---

## The Math

### State Update (per channel, per frame)

```
U_c(x) = Σ_k  w_{c,k} · (K_k * A_{src(k)})(x)

A_c(t+Δt) = clip( A_c(t) + Δt · G_c(U_c(x)), 0, 1 )
```

- `A_c` — state of channel c (2D scalar field, values ∈ [0,1])
- `K_k` — kernel k (2D convolution kernel, unit-normalized)
- `*` — spatial convolution (GPU direct sampling or FFT)
- `w_{c,k}` — weight of kernel k's influence on channel c
- `G_c` — growth function for channel c
- `Δt` — timestep (typically 0.1–0.5; increase → speed up → chaos → noise)

### The Kernel K (ring-shaped convolution mask)

```
K(r) = β · exp( -( (r/R - μ_k)² ) / (2σ_k²) )

r   = distance from center pixel
R   = kernel radius in pixels (organism spatial scale; typically 10–25)
μ_k = ring center as fraction of R (0.4–0.6; 0.5 = ring at half-radius)
σ_k = ring width (0.10–0.25; narrow = sharp ring; wide = diffuse halo)
β   = peak amplitude, normalized so ∫∫ K(r) dA = 1
```

Multi-ring kernel (for richer organism structure — concentric shell organisms):

```
K(r) = Σ_i  β_i · exp( -( (r/R - μ_i)² ) / (2σ_i²) )

β = [1.0, 0.5, 0.2]  → three concentric rings, outer rings dimmer
```

### The Growth Function G (what makes cells grow or die)

```
G(u) = 2 · exp( -(u - μ_g)² / (2σ_g²) ) - 1

u   = neighborhood concentration (output of K * A convolution)
μ_g = "sweet spot" density that causes maximum growth
σ_g = tolerance width of the growth window
output ∈ [-1, +1]:  positive → cell grows toward 1
                     negative → cell shrinks toward 0
```

**Parameter regimes:**
- `μ_g = 0.10–0.18` → sparse organisms — grow in low-density halos, clean gliders
- `μ_g = 0.25–0.35` → dense organisms — grow in packed cores, slower, more massive
- `σ_g < 0.015` → brittle crystal — prone to shattering at boundaries
- `σ_g = 0.015–0.04` → robust membrane — sweet spot for locomoting organisms
- `σ_g > 0.06` → amorphous fog — no coherent structure, poor locomotion

### The Connection Matrix (organism personality)

```
W = [w_{c,k}]  (C × K matrix)

3-channel Orbium family:
        K0      K1      K2
Ch0:  [ 1.0,   0.2,  -0.5 ]   ← K0 grows body, K2 inhibits it
Ch1:  [ 0.5,   1.0,   0.0 ]   ← Ch0 drives excitation forward
Ch2:  [ 0.0,   0.8,   1.0 ]   ← Ch1 drives inhibition field

5-channel Volvox colony:
        K0      K1      K2      K3      K4
Ch0:  [ 1.0,   0.0,  -0.4,   0.1,   0.0 ]
Ch1:  [ 0.3,   1.0,   0.0,  -0.2,   0.0 ]
Ch2:  [ 0.0,   0.5,   1.0,   0.0,  -0.3 ]
Ch3:  [ 0.2,   0.0,   0.3,   1.0,   0.0 ]
Ch4:  [ 0.0,   0.1,   0.0,   0.6,   1.0 ]
```

Sparse W → simple gliders. Dense cross-channel connections → multi-body organisms with visible internal differentiation. All-positive W → explosive growth, full saturation (aesthetic failure mode: beautiful).

---

## GPU Architecture

```
Seed Texture (C channels × 256×256 RGBA32F)
         ↓
  ┌─────────────────────────────────────────┐
  │  Per-Channel Convolution Pass           │
  │  (ring-kernel K via texture loop)       │  ← ping-pong FBOs
  │  → U_c(x) = Σ_k w_{c,k} · (K_k*A_k)   │
  └─────────────────────────────────────────┘
         ↓
  ┌─────────────────────────────────────────┐
  │  Growth + Update Pass                   │
  │  G(U) = 2·exp(-(U-μ_g)²/2σ²) - 1      │
  │  A_c += Δt · G(U_c), clip to [0,1]     │
  └─────────────────────────────────────────┘
         ↓
  Channel Composite Pass
  (RGBA → visual: Ch0=magenta, Ch1=cyan, Ch2=violet)
         ↓
  Post-Process Pass
  (bloom, chromatic aberration, temporal smear 0.93×)
         ↓
  Screen Output
```

**State storage**: each channel is a 256×256 RGBA32F texture. `.r` = current state A_c; `.g` = previous state (temporal delta for trails); `.b` = growth rate G(U) (used for heat-map overlay).

**Convolution strategy**: for R ≤ 20px — direct ring-sample loop (6 radii × 12 angles = 72 samples/pixel). For R > 20px — precomputed kernel texture lookup or two-pass separable approximation.

---

## Organism Zoo

Known stable organisms with actual parameter values for direct use:

| Organism | Channels | R | μ_g | σ_g | β | Δt | Visual |
|----------|----------|---|-----|-----|---|----|--------|
| **Orbium** | 1 | 13 | 0.150 | 0.015 | [1] | 0.10 | Smooth magenta sphere, clean wake, speed 0.5px |
| **Scutium** | 1 | 13 | 0.180 | 0.020 | [1] | 0.12 | Shield-shape, brighter front, faster (0.8px/step) |
| **Gyrorbium** | 1 | 13 | 0.150 | 0.015 | [1,0.5] | 0.10 | Rotates while translating, helical wake |
| **Aquarium** | 1 | 13 | 0.280 | 0.030 | [1] | 0.15 | Dense pulsing blob, membrane shimmers, no locomotion |
| **Hydrogeminium** | 2 | 13 | 0.160 | 0.040 | [1] | 0.12 | Unstable start → stable swimmer → binary fission |
| **Chromorbium** | 3 | 13/9/21 | 0.15/0.14/0.13 | 0.015 | [1] | 0.12 | Breathes — channels pulse at offset phases, RGB cycles |
| **Volvox** | 4 | 13/9/21/15 | 0.15/0.14/0.13/0.16 | 0.02 | [1] | 0.10 | 4 sub-organisms orbit a shared mass center, rotating colony |
| **Pentarbium** | 5 | 13/9/21/15/11 | varies | 0.02–0.04 | [1] | 0.10 | Complex internal structure, organs visible in channel overlay |

See `organisms.json` for machine-readable parameter configs ready to feed into generators.

---

## GLSL Implementations

This repo provides multiple GLSL entry points depending on your pipeline:

| Shader | Format | Use Case |
|--------|--------|----------|
| `lenia.glsl` | Shadertoy Buffer A + Image | Paste into Shadertoy; full simulation with feedback |
| `lenia_raymarch.glsl` | Standalone fragment shader | 3D volumetric visualization; no texture state needed |
| `shaders/kernel_vis.glsl` | Standalone fragment shader | Debug kernel shapes; tune K(r) parameters visually |
| `shaders/lenia_procedural.glsl` | Standalone fragment shader | Instant Lenia aesthetic; no simulation, pure procedural |

**Shadertoy usage** (`lenia.glsl`): create a new shader, set Buffer A to loop back to itself on iChannel0, paste the Buffer A section. Paste the Image section in the Image tab pointing iChannel0 at Buffer A. Single-channel Orbium at R=13 runs immediately.

**Standalone usage** (`lenia_raymarch.glsl`, `shaders/`): paste directly into ShaderForge3 or any iTime/iResolution/iMouse GLSL environment. No external textures required.

---

## CPU Reference Implementation

`lenia_cpu.js` — pure JavaScript, no WebGL, Canvas 2D only. Runs the actual Lenia simulation in Float32Arrays. Single-channel Orbium at 128×128 (~15fps in browser). Use this to:
- Understand the math without GPU abstraction
- Prototype new organisms before porting to GPU
- Generate parameter sweeps / screenshots without a GL context

---

## Aesthetic Post-Processing

- **Channel-to-RGB** — Ch0 → deep magenta `#2d0030 → #ff00ff → #ffffff` · Ch1 → cyan `#003030 → #00ffee → #ffffff` · Ch2 → ultraviolet `#0a0015 → #8800ff`. Additive blend: dense overlap burns white-hot
- **Temporal smear** — previous frame × 0.93–0.94 decay builds phosphorescent organism trails
- **Bloom** — high-pass (threshold 0.7) → 3-tap Gaussian at 2/4/8px → add back. Membranes glow
- **Chromatic aberration** — RGB channel split ±1.5px at screen edges, scaled by edge distance squared. Plasma fringe at high-density boundaries
- **Growth heat map** — `abs(G(U)) > 0.3` rendered as `#ff6600` → `#ffcc00`. Orange glow marks where organisms are actively growing or dying

---

## Files

| File | What it is |
|------|-----------|
| `lenia.js` | Three.js JS5 sim — 3-channel GPGPU, runs in RepoScripter2 |
| `lenia_5ch.js` | 5-channel JS5 sim — Volvox/Pentarbium configuration |
| `lenia_cpu.js` | Pure JS Canvas 2D simulation — no WebGL, reference implementation |
| `lenia.glsl` | Shadertoy-format shader — Buffer A (sim) + Image (display) |
| `lenia_raymarch.glsl` | Standalone 3D raymarched volumetric visualizer |
| `organisms.json` | Machine-readable organism parameter catalog |
| `repo_seed.txt` | Mathematical deep-dive: equations, organisms, aesthetic guide |
| `context.manifest.json` | RepoScripter2 / ShaderForge file manifest |
| `shaders/kernel_vis.glsl` | Kernel shape visualizer — tune K(r) parameters visually |
| `shaders/lenia_procedural.glsl` | Procedural Lenia aesthetic — no simulation, instant organisms |

---

## Used By

This repo is a context source for [RepoScripter2](https://github.com/merrypranxter/reposcripter2) — select it as input and generate new organism-based art with AI.

Also part of [ShaderForge](https://github.com/merrypranxter/shaderforge3) ecosystem.

---

*continuous space. continuous time. discrete nothing. creatures anyway.*
