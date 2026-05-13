// Lenia — Kernel Shape Visualizer
// Standalone GLSL fragment shader (Shadertoy / ShaderForge3)
// No external textures needed.
//
// WHAT THIS RENDERS:
//   A 2×2 grid of panels, each showing a different Lenia kernel K(r):
//
//   [0] Single-ring (Orbium family)      [1] Double-ring (Gyrorbium)
//   [2] Triple-ring (complex organisms)  [3] Asymmetric sum (experimental)
//
//   Each panel shows:
//   - The radial kernel profile K(r) as a colored line plot (top half)
//   - The full 2D kernel rendered as a brightness heatmap (bottom half)
//   - The growth function G(u) curve at the bottom edge
//
// USE CASE:
//   - Paste into ShaderForge3 or Shadertoy (no iChannel needed)
//   - Tune parameters in the #define block to preview kernel changes
//   - Feed output descriptions to AI: "use a kernel that looks like..."
//
// Globals: iTime, iResolution, iMouse

// ─── Kernel parameters ────────────────────────────────────────────────────────

// Panel 0: Orbium single-ring
#define P0_R     13.0
#define P0_MU_K  0.50
#define P0_SIG_K 0.15
#define P0_BETA0 1.00

// Panel 1: Gyrorbium double-ring
#define P1_R     13.0
#define P1_MU_K0 0.35
#define P1_MU_K1 0.65
#define P1_SIG_K 0.12
#define P1_BETA0 1.00
#define P1_BETA1 0.50

// Panel 2: Triple-ring (concentric shells)
#define P2_R     13.0
#define P2_SIG_K 0.10
#define P2_BETA0 1.00
#define P2_BETA1 0.50
#define P2_BETA2 0.25

// Panel 3: Wide asymmetric — inhibition-range kernel
#define P3_R     21.0
#define P3_MU_K  0.55
#define P3_SIG_K 0.20
#define P3_BETA0 1.00

// Growth function (shared, Orbium family)
#define MU_G   0.150
#define SIG_G  0.015

// ─── Kernel functions ─────────────────────────────────────────────────────────

float gaussRing(float rn, float mu, float sig) {
    float d = rn - mu;
    return exp(-(d * d) / (2.0 * sig * sig));
}

float kernel0(float rn) {
    return P0_BETA0 * gaussRing(rn, P0_MU_K, P0_SIG_K);
}

float kernel1(float rn) {
    return P1_BETA0 * gaussRing(rn, P1_MU_K0, P1_SIG_K)
         + P1_BETA1 * gaussRing(rn, P1_MU_K1, P1_SIG_K);
}

float kernel2(float rn) {
    return P2_BETA0 * gaussRing(rn, 0.25, P2_SIG_K)
         + P2_BETA1 * gaussRing(rn, 0.50, P2_SIG_K)
         + P2_BETA2 * gaussRing(rn, 0.75, P2_SIG_K);
}

float kernel3(float rn) {
    return P3_BETA0 * gaussRing(rn, P3_MU_K, P3_SIG_K);
}

float evalKernel(int panel, float rn) {
    if (panel == 0) return kernel0(rn);
    if (panel == 1) return kernel1(rn);
    if (panel == 2) return kernel2(rn);
    return kernel3(rn);
}

float growthFn(float u) {
    float d = u - MU_G;
    return 2.0 * exp(-(d * d) / (2.0 * SIG_G * SIG_G)) - 1.0;
}

// ─── Drawing helpers ─────────────────────────────────────────────────────────

// Draw a line at y=value in a [0,1]^2 plot space with given thickness
float plotLine(vec2 uv, float value, float thickness) {
    return smoothstep(thickness, 0.0, abs(uv.y - value));
}

// Draw axis grid
float grid(vec2 uv, float spacing) {
    vec2 g = abs(fract(uv / spacing + 0.5) - 0.5) / fwidth(uv / spacing);
    return 1.0 - min(min(g.x, g.y), 1.0);
}

// ─── Panel renderer ───────────────────────────────────────────────────────────

vec3 renderPanel(vec2 uv, int panel) {
    // uv in [0,1]^2 within this panel

    vec3 bg  = vec3(0.03, 0.02, 0.06);  // deep void-purple background
    vec3 col = bg;

    // Subtle grid lines
    float g = grid(uv, 0.25) * 0.05;
    col += vec3(g * 0.3, g * 0.2, g * 0.5);

    // Axis lines
    float ax = smoothstep(0.003, 0.0, abs(uv.x - 0.0)) * 0.3;
    float ay = smoothstep(0.003, 0.0, abs(uv.y - 0.5)) * 0.3;
    col += vec3(ax + ay) * 0.4;

    // --- TOP HALF (y > 0.5): Radial profile K(rn) curve ---
    if (uv.y > 0.5) {
        vec2  plotUV = vec2(uv.x, (uv.y - 0.5) * 2.0);  // remap to [0,1]^2
        float rn     = plotUV.x;                           // normalized radius [0,1]
        float kval   = evalKernel(panel, rn);

        // Plot curve: y = kval, plotted in plotUV space
        float curveY = kval * 0.85 + 0.05;  // padding
        float curve  = plotLine(plotUV, curveY, 0.015);

        // Cyan curve color, brighter at peaks
        vec3 curveCol = mix(vec3(0.0, 0.6, 0.8), vec3(0.0, 1.0, 0.93), kval);
        col = mix(col, curveCol * 1.5, curve);

        // Fill under curve: teal glow
        float fill = smoothstep(0.01, 0.0, plotUV.y - curveY) * kval * 0.3;
        col += vec3(0.0, fill, fill * 0.8);

        // Zero line
        float zeroLine = plotLine(plotUV, 0.05, 0.004);
        col += vec3(0.2, 0.2, 0.3) * zeroLine;
    }

    // --- BOTTOM HALF (y < 0.5): 2D kernel heatmap ---
    if (uv.y < 0.5) {
        vec2  kUV    = uv * 2.0 - vec2(1.0, 0.0);  // center at (0,0)
        kUV.y       *= 2.0;                           // remap y to [-1, 1]
        float r      = length(kUV);
        float rn     = r;                             // 2D kernel: r in [0,1] = entire panel half
        float kval   = rn <= 1.0 ? evalKernel(panel, rn) : 0.0;

        // Color: black → deep violet → hot magenta → white
        vec3 kCol = mix(vec3(0.04, 0.0, 0.08), vec3(1.0, 0.0, 1.0), kval);
        kCol = mix(kCol, vec3(1.0), smoothstep(0.7, 1.0, kval));

        col = mix(col, kCol, smoothstep(0.0, 0.05, kval));

        // Ring highlight at ring center (mu_k)
        float mu0 = (panel == 0) ? P0_MU_K :
                    (panel == 1) ? P1_MU_K0 :
                    (panel == 2) ? 0.50 : P3_MU_K;
        float ringEdge = smoothstep(0.008, 0.0, abs(rn - mu0));
        col += vec3(0.0, 0.3, 0.4) * ringEdge * 0.4;
    }

    // --- GROWTH FUNCTION STRIP (bottom 8%): G(u) from u=0 to u=1 ---
    if (uv.y < 0.08) {
        vec2  gUV  = vec2(uv.x, uv.y / 0.08);     // remap strip to [0,1]^2
        float u    = gUV.x;                          // concentration u ∈ [0,1]
        float gval = growthFn(u);                    // G(u) ∈ [-1, +1]
        float gy   = gval * 0.4 + 0.5;              // remap to [0.1, 0.9]
        float gLine = plotLine(gUV, gy, 0.08);

        // Green = positive growth, red = death
        vec3 gCol = gval > 0.0 ? vec3(0.1, 1.0, 0.2) : vec3(1.0, 0.1, 0.1);
        col = mix(col, gCol, gLine * 0.8);
    }

    return col;
}

// ─── Panel labels ─────────────────────────────────────────────────────────────

float textBit(vec2 p, int charCode) {
    // Minimal 5×7 pixel font for panel IDs (no external texture)
    // Just draws the panel number as a bright dot cluster
    return 0.0;  // placeholder — labels provided via comments below
}

// ─── Main ────────────────────────────────────────────────────────────────────

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;

    // 2×2 panel layout
    float pw = 0.5, ph = 0.5;
    int   px = uv.x < 0.5 ? 0 : 1;
    int   py = uv.y < 0.5 ? 0 : 1;
    int   panel = py * 2 + px;

    // Panel-local UV [0,1]^2
    vec2 pUV = vec2(
        (uv.x - float(px) * pw) / pw,
        (uv.y - float(py) * ph) / ph
    );

    vec3 col = renderPanel(pUV, panel);

    // Panel border
    float border = max(
        smoothstep(0.006, 0.0, min(pUV.x, 1.0 - pUV.x)),
        smoothstep(0.006, 0.0, min(pUV.y, 1.0 - pUV.y))
    );
    col = mix(col, vec3(0.2, 0.15, 0.4), border * 0.7);

    // Animated time cursor: vertical line sweeping across panel [0]
    // Shows which rn value is currently "active"
    if (panel == 0) {
        float cursor = fract(iTime * 0.1);
        float cl     = smoothstep(0.008, 0.0, abs(pUV.x - cursor));
        col += vec3(0.2, 0.5, 0.0) * cl * 0.4;
    }

    fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}

// ─── Panel legend (comments, not rendered) ───────────────────────────────────
// Panel 0 (top-left):  Single ring — Orbium. R=13, mu_k=0.5, sig_k=0.15
//                      K(r) has one clean peak. The simplest stable organism kernel.
//
// Panel 1 (top-right): Double ring — Gyrorbium. Two peaks at rn=0.35 and rn=0.65.
//                      Inner ring drives core, outer ring induces rotation.
//
// Panel 2 (bot-left):  Triple ring — concentric shells. Peaks at rn=0.25/0.50/0.75.
//                      Organisms have 3-layer structure: core, mantle, cortex.
//
// Panel 3 (bot-right): Wide inhibition-range kernel. R=21, broader sigma.
//                      Long-range suppression. Used as K2 in activator-inhibitor configs.
