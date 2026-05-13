// Lenia — 3D Raymarched Volumetric Visualizer
// Standalone fragment shader (Shadertoy / ShaderForge3 / any iTime+iResolution runner)
// No external textures. No simulation state. Pure procedural math.
//
// What this renders:
//   A 3D volumetric Lenia-like density field, built by summing radial basis functions
//   that mimic Lenia organisms at various scales and phases. Raymarched with:
//   - Transmittance-based volume rendering (soft glow, not hard surfaces)
//   - Per-channel color: magenta body · cyan excitation · violet inhibition
//   - Additive emission for dense regions (white-hot cores)
//   - Slow organism drift + rotation for animation
//
// CONTROLS (iMouse):
//   Click + drag X: rotate scene horizontally
//   Click + drag Y: rotate scene vertically
//   Click Z component: orbit lock (hold click)
//
// PARAMETERS (tune these):
//   MARCH_STEPS — raymarching quality (64 = fast, 128 = full quality)
//   STEP_SIZE   — raymarching step length (smaller = sharper, slower)
//   DENSITY     — organism density multiplier
//   NUM_ORG     — number of organism RBFs in the volume
//   DECAY_R     — temporal trail decay in the procedural field

// Globals: iTime (float), iResolution (vec2), iMouse (vec4)

#define MARCH_STEPS 80
#define STEP_SIZE   0.025
#define NEAR        0.1
#define FAR         4.0
#define DENSITY     3.5
#define NUM_ORG     6

// ─── Utility ─────────────────────────────────────────────────────────────────

float hash(float n) { return fract(sin(n) * 43758.5453); }

vec3 hash3(float n) {
    return vec3(hash(n), hash(n + 57.3), hash(n + 113.7));
}

// Lenia ring kernel in 3D: a spherical shell at radius mu*R with Gaussian falloff
float lenia3D(vec3 p, vec3 center, float R, float mu_k, float sig_k) {
    float r = length(p - center) / R;
    float kr = r - mu_k;
    return exp(-(kr * kr) / (2.0 * sig_k * sig_k));
}

// Organism at position c, oriented along axis dir, with rotation phase
float organism3D(vec3 p, vec3 c, vec3 dir, float phase, float scale) {
    vec3  d = p - c;

    // Build a local frame (dir, perp1, perp2)
    vec3 up    = abs(dir.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 right = normalize(cross(dir, up));
    vec3 fwd   = cross(right, dir);

    // Transform to organism-local coordinates
    vec3 ld    = vec3(dot(d, right), dot(d, fwd), dot(d, dir));
    float r    = length(d) / scale;

    // Lenia-like density: shell at r ≈ 0.5, with slight angular deformation
    float angle = atan(ld.y, ld.x);
    float deform = 1.0 + 0.12 * sin(3.0 * angle + phase)
                       + 0.06 * sin(7.0 * angle - phase * 1.4);
    float reff = r * deform;

    float core  = exp(-(reff - 0.15) * (reff - 0.15) / 0.004) * 1.0;
    float shell = exp(-(reff - 0.42) * (reff - 0.42) / 0.006) * 0.7;
    float halo  = exp(-(reff - 0.72) * (reff - 0.72) / 0.015) * 0.25;

    return clamp(core + shell + halo, 0.0, 1.2);
}

// Excitation cloud: teardrop ahead of organism
float excite3D(vec3 p, vec3 c, vec3 dir, float scale) {
    vec3 ahead = c + dir * scale * 0.55;
    float r    = length(p - ahead) / (scale * 0.4);
    return 0.6 * exp(-r * r * 1.8);
}

// Inhibition: elongated cloud trailing behind
float inhibit3D(vec3 p, vec3 c, vec3 dir, float scale) {
    vec3 behind = c - dir * scale * 0.6;
    // Asymmetric: wider perpendicular to direction
    vec3  d   = p - behind;
    float par = dot(d, dir);
    float perp = length(d - par * dir);
    float r    = (par * par / (scale * scale * 0.25) + perp * perp / (scale * scale * 0.60));
    return 0.5 * exp(-r * 1.2);
}

// ─── Main density / emission field ───────────────────────────────────────────

struct LeniaField {
    float body;       // Ch0 body density
    float excitation; // Ch1 excitation
    float inhibition; // Ch2 inhibition
};

LeniaField sampleField(vec3 p, float t) {
    LeniaField f;
    f.body = 0.0; f.excitation = 0.0; f.inhibition = 0.0;

    for (int i = 0; i < NUM_ORG; i++) {
        float fi    = float(i);
        vec3  seed  = hash3(fi * 7.3 + 1.1) * 2.0 - 1.0;  // [-1,1]^3
        seed       *= 0.7;  // keep organisms near center

        // Organism drift: slow helicoidal path
        float speed = 0.04 + hash(fi * 3.7) * 0.06;
        float dphase = hash(fi * 5.1) * 6.28318;
        float dfreq  = 0.8 + hash(fi * 2.3) * 0.6;
        vec3 drift   = speed * t * vec3(
            cos(dfreq * t + dphase),
            sin(dfreq * t * 0.7 + dphase + 1.1),
            sin(dfreq * t * 0.5 + dphase + 2.3)
        );
        // Wrap: fract into [-0.8, 0.8]
        vec3 center = seed + drift;
        center = clamp(fract(center * 0.5 + 0.5) * 2.0 - 1.0, -0.8, 0.8);

        // Organism direction rotates over time
        float rotphase = t * (0.3 + hash(fi * 4.2) * 0.4) + fi * 1.1;
        vec3 dir = normalize(vec3(cos(rotphase), sin(rotphase * 0.7), sin(rotphase * 0.5)));

        float phase = t * 1.5 + fi * 1.2;
        float scale = 0.18 + hash(fi * 6.1) * 0.10;

        f.body       += organism3D(p, center, dir, phase, scale);
        f.excitation += excite3D(p, center, dir, scale);
        f.inhibition += inhibit3D(p, center, dir, scale);
    }

    f.body       = clamp(f.body       * DENSITY * 0.4, 0.0, 1.5);
    f.excitation = clamp(f.excitation * DENSITY * 0.3, 0.0, 1.2);
    f.inhibition = clamp(f.inhibition * DENSITY * 0.25,0.0, 1.0);

    return f;
}

// ─── Camera ──────────────────────────────────────────────────────────────────

mat3 rotY(float a) {
    float c = cos(a), s = sin(a);
    return mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
}

mat3 rotX(float a) {
    float c = cos(a), s = sin(a);
    return mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c);
}

// ─── Volume rendering ────────────────────────────────────────────────────────

// Emission + absorption model:
//   Each step contributes emission E, attenuates by absorption sigma_a * step
//   Transmittance T = exp(-integral(sigma_a * ds))
//   Color += T * E * ds
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv  = (fragCoord - 0.5 * iResolution.xy) / min(iResolution.x, iResolution.y);

    // Camera orbit via mouse
    float yaw   =  iMouse.z > 0.0 ? (iMouse.x / iResolution.x - 0.5) * 6.28 : iTime * 0.15;
    float pitch = -iMouse.z > 0.0 ? (iMouse.y / iResolution.y - 0.5) * 3.14 : 0.25;
    mat3  cam   = rotY(yaw) * rotX(pitch);

    // Ray setup
    vec3 ro  = cam * vec3(0.0, 0.0, 2.8);
    vec3 rd  = normalize(cam * vec3(uv, -1.6));

    // Accumulate color + transmittance along ray
    vec3  color        = vec3(0.0);
    float transmittance = 1.0;

    float t = NEAR;
    for (int i = 0; i < MARCH_STEPS; i++) {
        if (t > FAR || transmittance < 0.01) break;

        vec3 p = ro + rd * t;

        // Skip points outside [-1,1]^3 bounding box
        if (all(lessThan(abs(p), vec3(1.1)))) {
            LeniaField f = sampleField(p, iTime);

            // Absorption (how opaque this region is)
            float sigma_a = (f.body * 1.8 + f.excitation * 0.6 + f.inhibition * 0.4);
            float att     = exp(-sigma_a * STEP_SIZE * 1.5);

            // Emission colors
            // Body: deep magenta → white at high density
            vec3 bodyC = mix(vec3(0.18, 0.0, 0.19), vec3(1.0, 0.0, 1.0), f.body);
            bodyC = mix(bodyC, vec3(1.0, 0.9, 1.0), smoothstep(0.7, 1.2, f.body));

            // Excitation: teal → electric cyan
            vec3 excC  = mix(vec3(0.0, 0.19, 0.19), vec3(0.0, 1.0, 0.93), f.excitation);

            // Inhibition: void-violet
            vec3 inhC  = mix(vec3(0.04, 0.0, 0.08), vec3(0.53, 0.0, 1.0), f.inhibition);

            vec3 emission = bodyC * f.body * 1.5
                          + excC  * f.excitation * 0.8
                          + inhC  * f.inhibition * 0.5;

            color        += transmittance * emission * STEP_SIZE;
            transmittance *= att;
        }

        t += STEP_SIZE;
    }

    // Background: deep void with faint star dust
    float bgLuma = hash(dot(uv, vec2(43.7, 71.3))) * 0.015;
    vec3  bg     = vec3(bgLuma * 0.4, bgLuma * 0.2, bgLuma * 0.6);

    color += transmittance * bg;

    // Chromatic aberration — mild fringe at edges
    float edge = length(uv) * 0.7;
    color.r   *= 1.0 + edge * 0.04;
    color.b   *= 1.0 - edge * 0.03;

    // Tone map (Reinhard)
    color = color / (color + 0.8);

    // Slight warm vignette
    color *= 1.0 - length(uv) * 0.25;

    fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
