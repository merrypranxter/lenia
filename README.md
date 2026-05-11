# 🧫 Lenia

> *"Life is not a thing. It is a process — a pattern that refuses to dissolve."*

A multi-kernel continuous cellular automata engine for RepoScripter2. Alien lifeforms self-assembling from pure mathematics — layered chemical channels, inter-channel kernel convolutions, and GPU-accelerated emergence. Designed as a context source for AI-generated generative art.

---

## The Lenia Model

Lenia is a **continuous generalization of Conway's Game of Life**. Where Game of Life has binary cells and discrete time, Lenia has:

- **Continuous state**: every cell holds a value in [0, 1], not just alive/dead
- **Continuous space**: smooth convolution kernels, not 3×3 neighbor counts
- **Continuous time**: fractional timesteps, not tick/tock
- **Multi-channel**: multiple interacting chemical layers, not one grid

The result: **organisms**. Self-organizing, self-repairing, gliding patterns that behave like alien microbes. Some rotate. Some pulse. Some hunt each other.

---

## The Channel Architecture

Multi-kernel Lenia runs **C independent channels** (typically 3–5), each representing a distinct "chemical substance." Channels interact via a **kernel connection matrix** — channel A can drive growth in channel B, which suppresses channel C, which feeds back into A. Complex organisms emerge from these loops.

| Channel | Role | Visual Character |
|---------|------|-----------------|
| **Ch. 0** | Primary organism body | Dense core mass, visible membrane |
| **Ch. 1** | Excitation signal | Fast-spreading activation wave |
| **Ch. 2** | Inhibition field | Slow halo that suppresses overgrowth |
| **Ch. 3** | Trace / memory | Faint ghost trail of past positions |
| **Ch. 4** | Structural scaffold | Rigid skeleton that guides locomotion |

Each channel has its own **kernel** and **growth function**. Channels that share similar kernel radii tend to lock into stable organisms. Channels with mismatched radii produce turbulent, asymmetric creatures.

---

## The Math

### State Update (per channel, per frame)

```
U_c(x) = Σ_k  w_{c,k} · (K_k * A_{src(k)})(x)

A_c(t+Δt) = clip( A_c(t) + Δt · G_c(U_c(x)), 0, 1 )
```

Where:
- `A_c` — state of channel c (a 2D field, values in [0,1])
- `K_k` — kernel k (a 2D convolution kernel, unit-normalized)
- `*` — spatial convolution (computed via FFT or direct GPU texture sampling)
- `w_{c,k}` — weight of kernel k's influence on channel c
- `G_c` — growth function for channel c
- `Δt` — timestep (typically 0.1–0.5)

### The Kernel K (ring-shaped convolution mask)

```
K(r) = β · exp( -( (r/R - μ_k)² ) / (2σ_k²) )
```

Normalized so `∫ K(r) dr = 1`. The kernel is a **smooth ring** centered at radius `R·μ_k` with width `σ_k`. Most Lenia creatures live in kernels with μ_k ≈ 0.5 (ring centered at half the kernel radius). Multi-ring kernels use a sum of multiple Gaussians at different radii.

**Multi-ring kernel** (for richer organism structure):

```
K(r) = Σ_i  β_i · exp( -( (r/R - μ_i)² ) / (2σ_i²) )
```

Where β = [β₀, β₁, β₂...] are the per-ring weights (e.g. [1, 0.5, 0.2]).

### The Growth Function G (what makes cells grow or die)

```
G(u) = 2 · exp( -(u - μ_g)² / (2σ_g²) ) - 1
```

A Gaussian **bump centered at μ_g** that maps neighborhood concentration → growth delta. Output in [-1, +1]:
- `G > 0` → cell grows
- `G < 0` → cell shrinks
- `G = 0` → cell stable

**Parameters that matter:**
- `μ_g ≈ 0.15` → sparse organisms (sparse neighborhood triggers growth)
- `μ_g ≈ 0.35` → dense organisms (dense packing triggers growth)
- `σ_g` narrow → brittle, crystalline organisms
- `σ_g` wide → squishy, amorphous blobs

### The Connection Matrix (the secret sauce of multi-kernel Lenia)

```
W = [w_{c,k}]  (C channels × K kernels matrix)

Example for 3-channel Lenia:
        K0      K1      K2
Ch0:  [ 1.0,   0.0,  -0.3 ]   ← K0 grows Ch0, K2 suppresses it
Ch1:  [ 0.4,   1.0,   0.0 ]   ← Ch0 drives Ch1 activation
Ch2:  [ 0.0,   0.6,   1.0 ]   ← Ch1 drives Ch2 inhibition field
```

The connection matrix is where organism "personality" lives. Sparse matrices → simple gliders. Dense cross-channel connections → complex multi-body organisms with internal structure.

---

## GPU Architecture

```
Seed Texture (C channels × W × H RGBA32F)
         ↓
  Per-Channel Convolution Pass
  (kernel K applied via ping-pong FBOs)
         ↓
  Growth + Update Pass
  (G(U) computed per-pixel, state advanced by Δt)
         ↓
  Channel Composite Pass
  (RGBA → visual: Ch0=R, Ch1=G, Ch2=B, Ch3=alpha glow)
         ↓
  Post-Process Pass
  (chromatic aberration, bloom, temporal smear)
         ↓
  Screen Output
```

**Kernel convolution** runs on the GPU as a texture-space operation. For large kernels (R > 32), separable or FFT convolution outperforms direct sampling. For R ≤ 32, direct sampling in a fragment shader is viable and avoids FFT complexity.

**State storage**: each channel is a 512×512 RGBA32F texture. The `.r` component holds the current state; `.gba` can encode velocity, age, or trace data for richer visual output.

**Ping-pong FBOs**: two render target sets, alternating read/write per frame. During the update pass, the shader reads from the previous frame's textures and writes to the new frame's textures.

---

## Organism Zoo

Known stable organisms in multi-kernel Lenia parameter space:

| Organism Type | Parameters | Behavior |
|--------------|-----------|---------|
| **Aquarium** | μ_g=0.28, σ_g=0.03, R=13 | Stable blob, slight membrane oscillation |
| **Orbium** | μ_g=0.15, σ_g=0.015, R=13 | The classic — smooth gliding sphere |
| **Scutium** | μ_g=0.18, σ_g=0.02, R=13 | Shield-shaped, faster glider |
| **Gyrorbium** | multi-ring β=[1,0.5] | Rotates while translating |
| **Chromorbium** | 3-channel coupling | Different channels pulse at different phases |
| **Hydrogeminium** | σ_g=0.04, wide kernel | Splits and re-merges, mitosis-like |

---

## Aesthetic Post-Processing

- **Channel-to-RGB mapping** — Ch0→red mass, Ch1→cyan excitation, Ch2→violet inhibition field. Additive blending builds neon creatures on black void
- **Temporal smear** — previous frame × 0.94 decay = organism trails
- **Bloom** — high-pass filter + Gaussian blur recomposited over base = glowing membranes
- **Chromatic aberration** — RGB channel offset at high-concentration boundaries = plasma edge
- **Reaction heat map** — `abs(G(U))` rendered as orange/white overlay = visualize where growth is actively happening

---

## Files

| File | What it is |
|------|-----------|
| `lenia.js` | Full multi-kernel GPGPU sim — runs inside RepoScripter2's JS5 engine |
| `repo_seed.txt` | Mathematical deep-dive: equations, organisms, aesthetic guide |
| `context.manifest.json` | RepoScripter2 file manifest |

---

## Used By

This repo is a context source for [RepoScripter2](https://github.com/merrypranxter/reposcripter2) — select it as input and generate new organism-based art with AI.

Also part of [ShaderForge](https://github.com/merrypranxter/shaderforge3) ecosystem.

---

*continuous space. continuous time. discrete nothing. creatures anyway.*
