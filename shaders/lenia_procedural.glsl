// Lenia — Procedural Aesthetic Shader
// Standalone fragment shader (Shadertoy / ShaderForge3 / any iTime+iResolution runner)
// No external textures. No simulation state. No feedback buffer.
//
// WHAT THIS IS:
//   A zero-latency instant aesthetic render of Lenia-style organisms.
//   Procedural math only — no simulation loop needed. Looks like a Lenia field
//   at steady state: glowing membranes, excitation halos, inhibition clouds,
//   phosphorescent trails.
//
//   Use this to:
//   - Preview the Lenia aesthetic in any GLSL environment
//   - Generate static screenshots / thumbnails
//   - Use as a "vibe shader" when you don't need real dynamics
//   - Feed the visual language description to an AI: "match this look"
//
// INTERACTION:
//   iMouse click: inject a new organism at cursor position
//   iTime: organisms drift slowly on toroidal paths
//
// VARIANT MODES (change RENDER_MODE define):
//   0 = Chromorbium (multi-channel color cycling, breathes)
//   1 = Orbium swarm (pure magenta, clean gliders)
//   2 = Volvox colony (orbit ring, rotating mandala)
//   3 = Growth boundary (heat-map dominant, orange pulse)
//   4 = Minimalist (single channel, near-white on deep navy)

#define RENDER_MODE 0
#define NUM_ORG 7
#define SHOW_TRAILS 1

// ─── Math primitives ─────────────────────────────────────────────────────────

float hash11(float n) { return fract(sin(n) * 43758.5453); }
float hash21(vec2  p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p.yx + 43.21);
    return fract(p.x * p.y);
}
vec2  hash22(vec2 p) {
    return vec2(hash21(p), hash21(p + vec2(57.0, 91.0)));
}

// Lenia ring profile at normalized radius rn
float leniaRing(float rn, float mu, float sig) {
    float d = rn - mu;
    return exp(-(d * d) / (2.0 * sig * sig));
}

// Organic deformation: asymmetric organism shape
float deformRadius(float rn, float angle, float phase, float strength) {
    return rn * (1.0 + strength * sin(3.0 * angle + phase)
                     + strength * 0.5 * sin(7.0 * angle - phase * 1.4)
                     + strength * 0.25 * cos(11.0 * angle + phase * 0.8));
}

// ─── Organism primitives ──────────────────────────────────────────────────────

// Body density: concentric shell organism
float bodyDensity(vec2 p, vec2 c, float theta, float phase, float scale) {
    vec2  d    = p - c;
    float r    = length(d) / scale;
    float angle = atan(d.y, d.x) - theta;
    float reff = deformRadius(r, angle, phase, 0.12);

    float core  = leniaRing(reff, 0.08, 0.025);
    float shell = leniaRing(reff, 0.40, 0.030) * 0.65;
    float halo  = leniaRing(reff, 0.75, 0.045) * 0.20;

    return clamp(core + shell + halo, 0.0, 1.2);
}

// Excitation cloud: asymmetric ahead of motion direction
float exciteDensity(vec2 p, vec2 c, float theta, float scale) {
    vec2 ahead = c + scale * 0.6 * vec2(cos(theta), sin(theta));
    vec2 d     = p - ahead;
    // Asymmetric: squashed along motion axis
    float par  = dot(d, vec2(cos(theta), sin(theta)));
    float perp = length(d - par * vec2(cos(theta), sin(theta)));
    float r2   = par * par / (scale * scale * 0.20) + perp * perp / (scale * scale * 0.45);
    return 0.5 * exp(-r2 * 1.5);
}

// Inhibition cloud: wide halo behind
float inhibDensity(vec2 p, vec2 c, float theta, float scale) {
    vec2 behind = c - scale * 0.5 * vec2(cos(theta), sin(theta));
    float r     = length(p - behind) / (scale * 1.0);
    return 0.45 * exp(-r * r * 1.0);
}

// Trail smear: elongated wake
float trailDensity(vec2 p, vec2 c, float theta, float scale, float age) {
    vec2 back = c - scale * age * 0.8 * vec2(cos(theta), sin(theta));
    vec2 d    = p - back;
    float par  = dot(d, vec2(cos(theta), sin(theta)));
    float perp = length(d - par * vec2(cos(theta), sin(theta)));
    // Trail fades with distance
    float fade = exp(-age * 0.8);
    float r2   = perp * perp / (scale * scale * 0.06) + par * par / (scale * scale * 1.2);
    return 0.3 * fade * exp(-r2);
}

// ─── Multi-organism field ─────────────────────────────────────────────────────

struct Field {
    float body;
    float excitation;
    float inhibition;
    float trail;
    float phase;   // per-organism oscillation phase (for Chromorbium breathing)
};

Field sampleField(vec2 p, float t) {
    Field f;
    f.body = 0.0; f.excitation = 0.0;
    f.inhibition = 0.0; f.trail = 0.0; f.phase = 0.0;

    for (int i = 0; i < NUM_ORG; i++) {
        float fi    = float(i);
        float h1    = hash11(fi * 0.173 + 1.7);
        float h2    = hash11(fi * 0.251 + 3.1);
        float h3    = hash11(fi * 0.317 + 5.3);
        float h4    = hash11(fi * 0.411 + 7.7);

        // Organism drift — slow toroidal glide
        float speed = 0.03 + h3 * 0.05;
        float dir0  = h4 * 6.28318;
        float theta = dir0 + t * (0.2 + h1 * 0.3);

        vec2  start = vec2(h1 - 0.5, h2 - 0.5) * 1.6;
        vec2  drift = speed * t * vec2(cos(theta), sin(theta));
        // Toroidal wrap
        vec2  c     = fract((start + drift) * 0.5 + 0.5) * 2.0 - 1.0;
        c.x        *= iResolution.x / iResolution.y;

        float scale = 0.12 + h2 * 0.08;
        float phase = t * (1.2 + h1 * 0.6) + fi * 1.19;

        float body  = bodyDensity(p, c, theta, phase, scale);
        float exc   = exciteDensity(p, c, theta, scale);
        float inh   = inhibDensity(p, c, theta, scale);
        float trail = SHOW_TRAILS > 0 ? trailDensity(p, c, theta, scale, 1.5) : 0.0;

        f.body       += body;
        f.excitation += exc;
        f.inhibition += inh;
        f.trail      += trail;
        f.phase      += phase * body;  // phase weighted by where organism is dense
    }

    // Clamp to reasonable range
    f.body       = clamp(f.body, 0.0, 1.5);
    f.excitation = clamp(f.excitation, 0.0, 1.2);
    f.inhibition = clamp(f.inhibition, 0.0, 1.0);
    f.trail      = clamp(f.trail, 0.0, 0.8);

    return f;
}

// ─── Render modes ─────────────────────────────────────────────────────────────

vec3 colorChromorbium(Field f, float t) {
    // Channels breathe at offset phases — color cycles
    float cyclePhase = f.phase * 0.05 + t * 0.5;
    float bodyShift  = sin(cyclePhase) * 0.5 + 0.5;
    float excShift   = sin(cyclePhase + 2.09) * 0.5 + 0.5;   // 120° offset
    float inhShift   = sin(cyclePhase + 4.19) * 0.5 + 0.5;   // 240° offset

    // Body: cycles through magenta → cyan
    vec3 b1   = mix(vec3(0.18, 0.0, 0.19), vec3(1.0, 0.0, 1.0), f.body);
    b1        = mix(b1, vec3(1.0), smoothstep(0.7, 1.2, f.body));
    vec3 b2   = mix(vec3(0.0, 0.08, 0.19), vec3(0.0, 1.0, 0.93), f.body);
    vec3 bodyC = mix(b1, b2, bodyShift * 0.6);

    // Excitation: cyan tinted by phase
    vec3 excC = mix(vec3(0.0, 0.19, 0.19), vec3(0.0, 1.0, 0.93), f.excitation);
    excC = mix(excC, vec3(0.4, 1.0, 0.7), excShift * 0.4);

    // Inhibition: violet shifting toward deep blue
    vec3 inhC = mix(vec3(0.04, 0.0, 0.08), vec3(0.53, 0.0, 1.0), f.inhibition);
    inhC = mix(inhC, vec3(0.0, 0.1, 0.6), inhShift * 0.3);

    // Trail: amber smear
    vec3 trailC = vec3(0.6, 0.3, 0.0) * f.trail;

    vec3 color = bodyC  * f.body
               + excC   * f.excitation * 0.7
               + inhC   * f.inhibition * 0.45
               + trailC;

    return color;
}

vec3 colorOrbium(Field f) {
    // Pure magenta — clean Orbium family look
    vec3 c = mix(vec3(0.18, 0.0, 0.19), vec3(1.0, 0.0, 1.0), f.body);
    c      = mix(c, vec3(1.0), smoothstep(0.65, 1.2, f.body));
    c     += vec3(0.0, 0.4, 0.4) * f.excitation * 0.5;
    return c;
}

vec3 colorVolvox(Field f, float t) {
    // Colony palette: gold + cyan mandala
    vec3 goldBody = mix(vec3(0.1, 0.05, 0.0), vec3(1.0, 0.75, 0.0), f.body);
    goldBody      = mix(goldBody, vec3(1.0), smoothstep(0.7, 1.2, f.body));
    vec3 cyanExc  = vec3(0.0, 1.0, 0.93) * f.excitation * 0.7;
    vec3 violet   = vec3(0.4, 0.0, 1.0) * f.inhibition * 0.5;
    return goldBody * f.body + cyanExc + violet;
}

vec3 colorGrowthBoundary(Field f, float t) {
    // Growth heat dominant — show where organisms are actively growing
    float heat = sin(t * 4.0) * 0.5 + 0.5;
    // Simulate growth rate from body density: boundary = where density ≈ 0.3-0.6
    float boundary = leniaRing(f.body, 0.40, 0.15);
    vec3 heatCol   = mix(vec3(0.8, 0.2, 0.0), vec3(1.0, 0.9, 0.0), heat) * boundary * 1.5;
    vec3 coreCol   = vec3(1.0) * smoothstep(0.8, 1.2, f.body) * 0.8;
    vec3 inhCol    = vec3(0.3, 0.0, 0.6) * f.inhibition * 0.5;
    return heatCol + coreCol + inhCol;
}

vec3 colorMinimalist(Field f) {
    // Single channel: near-white on deep navy
    float v = f.body;
    vec3 c  = mix(vec3(0.03, 0.05, 0.15), vec3(0.85, 0.90, 1.0), v);
    return c * v + vec3(0.03, 0.05, 0.15) * (1.0 - v);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec2 p  = uv - 0.5;
    p.x    *= iResolution.x / iResolution.y;

    float t = iTime * 0.4;

    Field f = sampleField(p, t);

    // Mouse: inject extra organism at cursor
    if (iMouse.z > 0.0) {
        vec2  mUV  = (iMouse.xy / iResolution.xy - 0.5);
        mUV.x     *= iResolution.x / iResolution.y;
        float mD   = length(p - mUV);
        float injR = 0.04;
        // Boost body density near cursor
        f.body = clamp(f.body + 0.8 * exp(-mD * mD / (2.0 * injR * injR)), 0.0, 1.5);
    }

    // Select color mode
    vec3 color;
    #if RENDER_MODE == 0
        color = colorChromorbium(f, t);
    #elif RENDER_MODE == 1
        color = colorOrbium(f);
    #elif RENDER_MODE == 2
        color = colorVolvox(f, t);
    #elif RENDER_MODE == 3
        color = colorGrowthBoundary(f, t);
    #else
        color = colorMinimalist(f);
    #endif

    // Chromatic aberration — plasma fringe at edges
    float edge = length(uv - 0.5) * 2.0;
    float ab   = edge * edge * 0.006;
    // Apply directly to color channels
    color.r   *= 1.0 + ab * 0.35;
    color.b   *= 1.0 - ab * 0.25;

    // Vignette
    color *= 1.0 - edge * 0.22;

    fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
