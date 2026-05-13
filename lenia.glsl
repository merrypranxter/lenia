// =============================================================================
// LENIA — Shadertoy-format GLSL simulation + display
// =============================================================================
// Single-channel Orbium simulation in Shadertoy's Buffer A / Image pattern.
//
// HOW TO USE IN SHADERTOY:
//   1. Create a new Shadertoy shader.
//   2. Add a "Buffer A" tab. Set its iChannel0 to "Buffer A" (self-feedback).
//   3. Paste everything between BUFFER A START and BUFFER A END into Buffer A.
//   4. In the Image tab, set iChannel0 to "Buffer A".
//   5. Paste everything between IMAGE START and IMAGE END into Image.
//   6. Hit play. Orbium appears within ~30 frames.
//
// HOW TO USE IN SHADERFORGE3 / OTHER GLSL RUNNERS:
//   These are standard fragment shaders using iTime, iResolution, iMouse,
//   iChannel0 (for Buffer A) and the usual Shadertoy globals.
//   Adapt to your runner's uniform names as needed.
//
// PARAMETERS — tune these to change organism type:
//   R     = 13.0  → kernel radius (organism spatial scale)
//   MU_K  = 0.5   → ring center fraction (0.5 = ring at half-radius)
//   SIG_K = 0.15  → ring width
//   MU_G  = 0.15  → growth sweet spot (Orbium; try 0.18 for Scutium)
//   SIG_G = 0.015 → growth tolerance (increase → larger, softer organisms)
//   DT    = 0.12  → timestep (decrease → stable, increase → chaotic)
// =============================================================================


// =============================================================================
// BUFFER A — SIMULATION PASS
// Paste this into Shadertoy's "Buffer A" tab.
// iChannel0 = Buffer A (self-feedback loop)
// =============================================================================

/*
// Lenia — Buffer A (simulation step)
// Reads previous state from iChannel0 (itself), writes new state.

#define R     13.0
#define MU_K  0.50
#define SIG_K 0.15
#define MU_G  0.150
#define SIG_G 0.015
#define DT    0.12

// Ring kernel weight at normalized radius rn = r/R
float kWeight(float rn) {
    float kr = rn - MU_K;
    return exp(-(kr * kr) / (2.0 * SIG_K * SIG_K));
}

// 2D convolution with Lenia ring kernel using polar sampling
// 6 radius rings × 12 angular samples = 72 samples per pixel
float convolve(sampler2D state, vec2 uv, vec2 res) {
    float sum  = 0.0;
    float wsum = 0.0;
    const int NR = 6;
    const int NA = 12;
    for (int ri = 1; ri <= NR; ri++) {
        float r  = R * float(ri) / float(NR);
        float kw = kWeight(r / R) * r;   // r = polar area element
        for (int ai = 0; ai < NA; ai++) {
            float a  = float(ai) / float(NA) * 6.28318530718;
            vec2  s  = fract(uv + vec2(cos(a), sin(a)) * r / res);
            sum  += texture(state, s).r * kw;
            wsum += kw;
        }
    }
    return wsum > 0.0 ? sum / wsum : 0.0;
}

// Growth function: Gaussian bump centered at MU_G, output in [-1, +1]
float grow(float u) {
    float d = u - MU_G;
    return 2.0 * exp(-(d * d) / (2.0 * SIG_G * SIG_G)) - 1.0;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;

    // INITIALIZATION: if frame 0, scatter Orbium seeds
    if (iFrame == 0) {
        // Six Gaussian blobs scattered across the field
        float val = 0.0;
        float R0  = 0.045;
        for (int i = 0; i < 6; i++) {
            float fi = float(i);
            // Pseudo-random centers using different frequency hashes
            vec2 c = vec2(
                fract(sin(fi * 0.173 + 1.7) * 43758.5),
                fract(sin(fi * 0.251 + 3.1) * 43758.5)
            );
            float r = length(uv - c);
            val += exp(-(r * r) / (2.0 * R0 * R0));
        }
        fragColor = vec4(clamp(val, 0.0, 1.0), 0.0, 0.0, 1.0);
        return;
    }

    // SIMULATION STEP
    float u    = convolve(iChannel0, uv, iResolution.xy);
    float a    = texture(iChannel0, uv).r;
    float g    = grow(u);
    float newA = clamp(a + DT * g, 0.0, 1.0);

    // Mouse: inject concentration at cursor (click + drag)
    if (iMouse.z > 0.0) {
        vec2  mouseUV = iMouse.xy / iResolution.xy;
        float dist    = length(uv - mouseUV);
        newA = clamp(newA + 0.5 * smoothstep(0.05, 0.0, dist), 0.0, 1.0);
    }

    // Pack: .r = new state, .g = growth rate (for heat-map display)
    fragColor = vec4(newA, g, 0.0, 1.0);
}
*/


// =============================================================================
// IMAGE — DISPLAY PASS
// Paste this into Shadertoy's Image tab.
// iChannel0 = Buffer A
// =============================================================================

/*
// Lenia — Image (display pass)
// Reads simulation state from iChannel0 (Buffer A).
// Magenta/cyan color mapping + growth heat map + chromatic aberration.

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;

    float a = texture(iChannel0, uv).r;
    float g = texture(iChannel0, uv).g;  // growth rate from Buffer A

    // Magenta color ramp: black → deep magenta → hot magenta → white
    vec3 col = mix(vec3(0.176, 0.0, 0.188), vec3(1.0, 0.0, 1.0), a);
    col = mix(col, vec3(1.0), smoothstep(0.70, 1.0, a));

    // Growth heat overlay: orange where organism is actively growing/dying
    vec3 heat = vec3(1.0, 0.40, 0.0) * clamp(abs(g) * 2.0, 0.0, 1.0) * 0.35;
    col += heat;

    // Chromatic aberration at canvas edges
    float edge = length(uv - 0.5) * 2.0;
    float ab   = edge * edge * 0.004;
    float ar   = texture(iChannel0, uv + vec2(ab,  0.0)).r;
    float ab2  = texture(iChannel0, uv - vec2(ab,  0.0)).r;
    col.r += ar  * 0.20;
    col.b += ab2 * 0.15;

    // Vignette
    col *= 1.0 - edge * 0.20;

    fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
*/


// =============================================================================
// STANDALONE VERSION — single-file aesthetic preview
// Use this when you only have one shader tab and no feedback buffer.
// Generates a STATIC procedural Lenia-like organism field.
// Not a real simulation — looks like Lenia but runs without state textures.
// =============================================================================

// Lenia — standalone aesthetic preview (no simulation, pure procedural)
// Globals expected: iTime (float), iResolution (vec2), iMouse (vec4)

float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 43.21);
    return fract(p.x * p.y);
}

// Gaussian ring at radius r, centered at mu with width sig
float ring(float r, float mu, float sig) {
    float d = r - mu;
    return exp(-(d * d) / (2.0 * sig * sig));
}

// Procedural "organism" at world-space center c with rotation angle theta
float organism(vec2 p, vec2 c, float theta, float phase) {
    vec2 d = p - c;
    // Rotate to organism's local frame
    float cs = cos(theta), sn = sin(theta);
    vec2  ld = vec2(cs * d.x + sn * d.y, -sn * d.x + cs * d.y);
    float r  = length(d);
    float a  = atan(ld.y, ld.x);

    // Organic deformation: 3rd-order angular modulation
    float deform = 1.0 + 0.15 * sin(3.0 * a + phase) + 0.08 * sin(7.0 * a - phase * 0.7);
    float reff   = r * deform;

    // Core: dense inner mass
    float core  = ring(reff, 0.03, 0.015);
    // Membrane: bright ring at organism radius
    float shell = ring(reff, 0.07, 0.018) * 0.7;
    // Halo: diffuse outer glow
    float halo  = ring(reff, 0.13, 0.03) * 0.25;

    return clamp(core + shell + halo, 0.0, 1.0);
}

// Excitation cloud ahead of organism direction
float excitation(vec2 p, vec2 c, float theta) {
    vec2 ahead = c + 0.1 * vec2(cos(theta), sin(theta));
    float r    = length(p - ahead);
    return 0.4 * exp(-r * r / (0.012));
}

// Inhibition field behind organism
float inhibition(vec2 p, vec2 c, float theta) {
    vec2 behind = c - 0.12 * vec2(cos(theta), sin(theta));
    float r     = length(p - behind);
    return 0.5 * exp(-r * r / (0.025));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    // Maintain aspect ratio
    vec2 p  = uv - 0.5;
    p.x    *= iResolution.x / iResolution.y;

    float t = iTime * 0.3;

    // Seed 5 organisms with quasi-random trajectories
    vec3 bodyColor = vec3(0.0);
    vec3 cyanColor = vec3(0.0);
    vec3 viotColor = vec3(0.0);

    const int N_ORG = 5;
    for (int i = 0; i < N_ORG; i++) {
        float fi = float(i);
        // Each organism has a pseudo-random starting position + drift direction
        float h1 = hash21(vec2(fi * 0.173, 1.731));
        float h2 = hash21(vec2(fi * 0.251, 2.511));
        float h3 = hash21(vec2(fi * 0.317, 3.317));
        float spd = 0.04 + h3 * 0.06;

        vec2  startPos = vec2(h1 - 0.5, h2 - 0.5) * 0.8;
        float dir      = h3 * 6.28318 + t * 0.1 * (1.0 + fi * 0.3);
        vec2  vel      = spd * vec2(cos(dir), sin(dir));
        // Wrap around torus topology
        vec2  pos = fract(startPos + vel * t + 0.5) - 0.5;
        pos.x    *= iResolution.x / iResolution.y;

        // Gentle rotation over time
        float theta = dir + t * 0.5 * (0.5 - h1);
        float phase = t * 1.5 + fi * 1.2;

        float body  = organism(p, pos, theta, phase);
        float exc   = excitation(p, pos, theta);
        float inh   = inhibition(p, pos, theta);

        // Body → magenta ramp
        vec3  bc = mix(vec3(0.18, 0.0, 0.19), vec3(1.0, 0.0, 1.0), body);
        bc = mix(bc, vec3(1.0), smoothstep(0.6, 1.0, body));

        bodyColor += bc * body;
        cyanColor += vec3(0.0, exc, exc * 0.93) * exc;
        viotColor += vec3(inh * 0.53, 0.0, inh) * inh;
    }

    // Additive composite
    vec3 color = bodyColor + cyanColor * 0.7 + viotColor * 0.4;

    // Growth heat: animate orange pulse at organism boundaries
    float heat = sin(t * 4.0) * 0.5 + 0.5;
    color += vec3(1.0, 0.4, 0.0) * clamp(length(bodyColor) * heat * 0.3, 0.0, 0.3);

    // Chromatic aberration
    float edge = length(uv - 0.5) * 2.0;
    float ab   = edge * edge * 0.006;
    // Can't sample iChannel0 here (no texture) — simulate with slight color split
    color.r   *= 1.0 + ab * 0.3;
    color.b   *= 1.0 - ab * 0.2;

    // Vignette
    color *= 1.0 - edge * 0.25;

    fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
