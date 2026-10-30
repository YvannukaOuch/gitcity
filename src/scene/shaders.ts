import * as THREE from 'three'

/**
 * Shaders for the Kurzgesagt look, as an alien city: flat colours, a lit side and a cool purple
 * shadow side, a soft rim of light, glowing portholes and energy rings, and buildings that are beamed
 * down and printed as holograms. One set of uniforms drives them all.
 */

export const uniforms = {
  uLightDir: { value: new THREE.Vector3(-0.55, 0.85, 0.42).normalize() },
  uNight: { value: 1 },
  uTime: { value: 0 },
  /** The time-lapse: buildings exist once this passes the day their repo was made. */
  uTimeline: { value: 1e9 },
  uGrowWindow: { value: 30 },
  uHover: { value: -1 },
  uSelected: { value: -1 },
  uSkyLow: { value: new THREE.Color('#120f38') },
  uPixelRatio: { value: 1 },
}

/**
 * Additive light that leaves the canvas alpha alone. The canvas is transparent over a CSS sky, and
 * plain additive blending would also add alpha, turning faint glow pixels into opaque dark specks.
 * Shaders using it output premultiplied colour.
 */
const ADD_LIGHT = {
  transparent: true,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.ZeroFactor,
  blendDstAlpha: THREE.OneFactor,
} as const

const common = /* glsl */ `
uniform vec3 uLightDir;
uniform float uNight;
uniform float uTime;
uniform float uTimeline;
uniform float uGrowWindow;

// 0 → 1 as the timeline passes the day something was born, with a little bounce at the end.
float growth(float born) {
  float g = clamp((uTimeline - born) / uGrowWindow, 0.0, 1.0);
  if (g <= 0.0) return 0.0;
  float k = g - 1.0;
  return 1.0 + 2.5 * k * k * k + 1.5 * k * k;
}

// 0 → 1 linearly over the same window (no bounce): drives the construction effects.
float growRaw(float born) {
  return clamp((uTimeline - born) / uGrowWindow, 0.0, 1.0);
}

vec3 kurzShade(vec3 base, vec3 N, vec3 V) {
  // Night: everything a little cooler and darker, so the windows glow.
  base = mix(base, base * vec3(0.6, 0.66, 1.0), uNight * 0.55);
  float d = dot(N, uLightDir);
  float lit = smoothstep(-0.06, 0.3, d);
  vec3 shadow = base * mix(vec3(0.68, 0.64, 0.9), vec3(0.45, 0.44, 0.78), uNight);
  vec3 c = mix(shadow, base, lit);
  float top = smoothstep(0.55, 0.92, N.y);
  c = mix(c, base * 1.1 + 0.02, top * 0.55);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  c += rim * lit * 0.14 * mix(vec3(1.0, 0.95, 0.85), vec3(0.6, 0.7, 1.0), uNight);
  return c;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`

// ------------------------------------------------------------------ buildings (merged, with windows)

const buildingVertex = /* glsl */ `
${common}
attribute vec3 aBase;
attribute vec3 aAccent;
attribute vec3 aLocal;
attribute vec3 aSize;
attribute vec3 aInfo;   // lit share, born day, random seed
attribute float aId;
#ifdef HOUSE
attribute float aRoof;
varying float vRoof;
#endif
uniform float uHover;
uniform float uSelected;
varying vec3 vNormalW;
varying vec3 vWorld;
varying vec3 vLocal;
varying vec3 vSize;
varying vec3 vBase;
varying vec3 vAccent;
varying vec2 vLitSeed;
varying float vHighlight;
varying float vRaw;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  float raw = growRaw(aInfo.y);
  // Grown, not built: it sprouts thin, swells past its size like something alive, then settles.
  vec2 centre = world.xz - aLocal.xz;
  float swell = mix(0.3, 1.0, smoothstep(0.0, 0.75, raw)) + 0.16 * sin(3.14159 * raw);
  world.xz = centre + aLocal.xz * swell;
  world.y *= growth(aInfo.y);
  vRaw = raw;
  vAccent = aAccent;
  vWorld = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vLocal = aLocal;
  vSize = aSize;
  vBase = aBase;
  vLitSeed = aInfo.xz;
  vHighlight = abs(aId - uSelected) < 0.5 ? 1.0 : (abs(aId - uHover) < 0.5 ? 0.6 : 0.0);
  #ifdef HOUSE
  vRoof = aRoof;
  #endif
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

const buildingFragment = /* glsl */ `
${common}
varying vec3 vNormalW;
varying vec3 vWorld;
varying vec3 vLocal;
varying vec3 vSize;
varying vec3 vBase;
varying vec3 vAccent;
varying vec2 vLitSeed;
varying float vHighlight;
varying float vRaw;
#ifdef HOUSE
varying float vRoof;
#endif

void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 base = vBase;
  #ifdef HOUSE
  base = mix(base, vAccent * 0.92, vRoof);
  #endif
  vec3 col = kurzShade(base, N, V);
  // A touch darker near the ground.
  col *= mix(0.8, 1.0, smoothstep(0.0, 1.2, vLocal.y));

  // Round portholes in rows round the walls (the buildings are turned on a lathe, so the grid
  // runs by angle round the axis and height up it).
  float wall = 1.0 - smoothstep(0.35, 0.6, abs(N.y));
  #ifdef HOUSE
  wall *= 1.0 - vRoof;
  #endif
  if (wall > 0.0) {
    float a01 = atan(vLocal.z, vLocal.x) / 6.28318 + 0.5;
    float radius = 0.46 * min(vSize.x, vSize.z);
    #ifdef HOUSE
    float cw = 0.7; float fh = 0.5; float y0 = 0.16;
    float floors = 1.0;
    #else
    float cw = 0.58; float fh = 0.62; float y0 = 0.4;
    float floors = max(0.0, floor((vSize.y - y0 - 0.35) / fh));
    #endif
    float cols = max(3.0, floor(6.28318 * radius * 0.85 / cw));
    float gu = a01 * cols;
    // The angle wraps at the back; take the derivative from a copy that wraps elsewhere.
    float gu2 = fract(a01 + 0.5) * cols;
    float gv = (vLocal.y - y0) / fh;
    vec2 cell = vec2(mod(floor(gu), cols), floor(gv));
    float inside = step(0.0, gv) * step(gv, floors);
    vec2 f = fract(vec2(gu, gv));
    vec2 w = max(vec2(min(fwidth(gu), fwidth(gu2)), fwidth(gv)), vec2(1e-4));
    float aa = max(w.x, w.y);
    float mask = 1.0 - smoothstep(0.26 - aa, 0.26 + aa, length((f - 0.5) * vec2(1.0, 1.1)));
    // Far away the portholes are only a pixel or two: blend to their average so they don't shimmer.
    float far = smoothstep(0.22, 0.55, aa);
    float litOne = step(hash12(cell + vec2(17.0, vLitSeed.y * 113.0)), vLitSeed.x);
    float lit = mix(litOne, vLitSeed.x, far);
    float cover = mix(mask, 0.2, far) * inside * wall;
    float warmth = 0.85 + 0.3 * hash12(cell + 7.0);
    // Alien light: the building's own glow colour, a little warmer in some rooms.
    vec3 nightLit = mix(vAccent, vec3(1.0, 0.86, 0.55), 0.25 * step(0.7, hash12(cell + 3.0))) * warmth * 1.15;
    vec3 nightDark = col * 0.5 + vec3(0.02, 0.03, 0.09);
    vec3 dayLit = mix(col, mix(vec3(0.88, 0.97, 1.0), vAccent, 0.35), 0.65);
    vec3 dayDark = mix(col, vec3(0.42, 0.5, 0.86), 0.5);
    vec3 win = mix(mix(dayDark, dayLit, lit), mix(nightDark, nightLit, lit), uNight);
    col = mix(col, win, cover);
  }

  #ifndef HOUSE
  // Energy rings round the waist of taller towers, brighter at night.
  if (vSize.y > 2.2) {
    float fw = max(fwidth(vLocal.y), 1e-4);
    float band = 0.045 + fw;
    float ring = max(1.0 - smoothstep(band - fw, band + fw, abs(vLocal.y - vSize.y * 0.3)),
                     1.0 - smoothstep(band - fw, band + fw, abs(vLocal.y - vSize.y * 0.31 - 0.14)));
    ring *= 1.0 - smoothstep(0.6, 0.85, abs(N.y));
    float pulse = 0.85 + 0.15 * sin(uTime * 2.0 + vLitSeed.y * 40.0);
    col = mix(col, vAccent * mix(1.0, 1.4, uNight) * pulse, ring * 0.9);
  }
  #endif

  // Being built: a scan line climbs the building. Below it is solid; above it is still a glowing
  // hologram with drifting stripes.
  if (vRaw < 1.0) {
    float scan = vRaw * vSize.y * 1.04;
    float above = smoothstep(scan - 0.02, scan + 0.02, vLocal.y);
    float stripes = step(0.5, fract(vLocal.y * 4.0 - uTime * 2.2));
    vec3 holo = vAccent * (0.7 + 0.45 * stripes) + 0.08;
    col = mix(col, holo, above * 0.92);
    float line = 1.0 - smoothstep(0.0, 0.14, abs(vLocal.y - scan));
    col += vAccent * line * 1.3;
  }

  // Hovered or picked: brighter, with a glowing edge.
  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.0);
  col = mix(col, col * 1.18 + 0.06, vHighlight * 0.7);
  col += vHighlight * rim * mix(vec3(1.0, 0.95, 0.7), vAccent, 0.5) * 0.55;
  gl_FragColor = vec4(col, 1.0);
}
`

export function buildingMaterial(house = false) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: buildingVertex,
    fragmentShader: buildingFragment,
    defines: house ? { HOUSE: '' } : {},
  })
}

// ------------------------------------------------------------------ everything else

const toonVertex = /* glsl */ `
${common}
uniform vec3 uColor;
#ifdef GROW
attribute float aBorn;
#endif
#ifdef EMISSIVE
attribute float aGlow;
varying float vGlow;
#endif
varying vec3 vNormalW;
varying vec3 vWorld;
varying vec3 vColor;
void main() {
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
  m = modelMatrix * instanceMatrix;
  #endif
  vec4 world = m * vec4(position, 1.0);
  #ifdef GROW
  world.y *= growth(aBorn);
  #endif
  vWorld = world.xyz;
  vNormalW = normalize(mat3(m) * normal);
  vColor = uColor;
  #ifdef USE_COLOR
  vColor *= color.rgb;
  #endif
  #ifdef USE_INSTANCING_COLOR
  vColor *= instanceColor;
  #endif
  #ifdef EMISSIVE
  vGlow = aGlow;
  #endif
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

const toonFragment = /* glsl */ `
${common}
uniform vec3 uSkyLow;
uniform float uOpacity;
uniform float uDepth;
varying vec3 vNormalW;
varying vec3 vWorld;
varying vec3 vColor;
#ifdef EMISSIVE
varying float vGlow;
#endif
void main() {
  #ifdef FLAT
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  #else
  vec3 N = normalize(vNormalW);
  if (!gl_FrontFacing) N = -N;
  #endif
  vec3 V = normalize(cameraPosition - vWorld);
  #ifdef UNLIT
  vec3 col = mix(vColor, vColor * vec3(0.7, 0.75, 1.0), uNight * 0.4);
  #else
  vec3 col = kurzShade(vColor, N, V);
  #endif
  #ifdef EMISSIVE
  col = mix(col, vColor * (1.15 + 0.2 * sin(uTime * 3.0 + vWorld.x)), vGlow);
  #endif
  #ifdef UNDERSIDE
  // The underside of the island melts into the sky.
  col = mix(col, uSkyLow, smoothstep(-0.4, -uDepth, vWorld.y) * 0.8);
  #endif
  gl_FragColor = vec4(col, uOpacity);
}
`

export function toonMaterial(opts: { color?: string; flat?: boolean; instanced?: boolean; vertexColors?: boolean; grow?: boolean; emissive?: boolean; unlit?: boolean; underside?: number; opacity?: number; side?: THREE.Side } = {}) {
  const defines: Record<string, string> = {}
  if (opts.flat) defines.FLAT = ''
  if (opts.grow) defines.GROW = ''
  if (opts.emissive) defines.EMISSIVE = ''
  if (opts.unlit) defines.UNLIT = ''
  if (opts.underside) defines.UNDERSIDE = ''
  return new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uColor: { value: new THREE.Color(opts.color ?? '#ffffff') }, uOpacity: { value: opts.opacity ?? 1 }, uDepth: { value: opts.underside ?? 10 } },
    vertexShader: toonVertex,
    fragmentShader: toonFragment,
    defines,
    vertexColors: !!opts.vertexColors,
    transparent: (opts.opacity ?? 1) < 1,
    depthWrite: (opts.opacity ?? 1) >= 1,
    side: opts.side ?? THREE.FrontSide,
  })
}

// ------------------------------------------------------------------ soft glows (beacons, lamps)

const glowVertex = /* glsl */ `
${common}
uniform float uPixelRatio;
attribute float aSize;
attribute float aBorn;
attribute float aPhase;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  float g = growth(aBorn);
  world.y *= g;
  vec4 mv = viewMatrix * world;
  float pulse = 0.82 + 0.18 * sin(uTime * 2.2 + aPhase);
  gl_PointSize = aSize * pulse * uPixelRatio * 300.0 / -mv.z;
  vColor = color.rgb;
  vAlpha = step(0.02, g) * mix(0.45, 1.0, uNight);
  gl_Position = projectionMatrix * mv;
}
`

const glowFragment = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = 1.0 - smoothstep(0.0, 1.0, d);
  a = a * a * 0.8 + (1.0 - smoothstep(0.0, 0.18, d)) * 0.6;
  gl_FragColor = vec4(vColor * a * vAlpha, 1.0);
}
`

export function glowMaterial() {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: glowVertex,
    fragmentShader: glowFragment,
    vertexColors: true,
    ...ADD_LIGHT,
  })
}

// ------------------------------------------------------------------ stars

const starVertex = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
uniform float uNight;
attribute float aSize;
attribute float aPhase;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float tw = 0.55 + 0.45 * sin(uTime * (0.6 + fract(aPhase) * 1.6) + aPhase * 6.28);
  gl_PointSize = aSize * uPixelRatio;
  vAlpha = tw * uNight;
  gl_Position = projectionMatrix * mv;
}
`

const starFragment = /* glsl */ `
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.2, 1.0, d)) * vAlpha;
  gl_FragColor = vec4(vec3(1.0, 0.97, 0.9) * a, 1.0);
}
`

export function starMaterial() {
  return new THREE.ShaderMaterial({ uniforms, vertexShader: starVertex, fragmentShader: starFragment, ...ADD_LIGHT })
}

// ------------------------------------------------------------------ water

const waterfallVertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

const waterfallFragment = /* glsl */ `
uniform float uTime;
uniform float uNight;
varying vec2 vUv;
void main() {
  // Streaks running down, fading out as the water falls away.
  float x = vUv.x;
  float edge = smoothstep(0.0, 0.12, x) * smoothstep(1.0, 0.88, x);
  float lane = floor(x * 7.0);
  float speed = 0.55 + fract(sin(lane * 12.9898) * 43758.5453) * 0.35;
  float s = fract((1.0 - vUv.y) * 3.0 - uTime * speed + lane * 0.37);
  float streak = smoothstep(0.0, 0.08, s) * (1.0 - smoothstep(0.35, 0.6, s));
  vec3 deep = mix(vec3(0.3, 0.68, 0.95), vec3(0.22, 0.4, 0.82), uNight);
  vec3 foam = mix(vec3(0.85, 0.96, 1.0), vec3(0.62, 0.78, 1.0), uNight);
  vec3 col = mix(deep, foam, streak * 0.75);
  float fade = smoothstep(0.0, 0.55, vUv.y);
  gl_FragColor = vec4(col, edge * fade * 0.92);
}
`

export function waterfallMaterial() {
  return new THREE.ShaderMaterial({ uniforms, vertexShader: waterfallVertex, fragmentShader: waterfallFragment, transparent: true, depthWrite: false, side: THREE.DoubleSide })
}

// ------------------------------------------------------------------ construction beams

const beamVertex = /* glsl */ `
${common}
attribute float aBorn;
varying vec2 vUv;
varying float vRaw;
void main() {
  vUv = uv;
  vRaw = growRaw(aBorn);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`

const beamFragment = /* glsl */ `
uniform float uTime;
uniform float uNight;
varying vec2 vUv;
varying float vRaw;
void main() {
  // (Thresholds a hair inside 0..1: an interpolated 1.0 can arrive as 0.99999.)
  if (vRaw <= 0.001 || vRaw >= 0.999) discard;
  // Bright as construction starts, fading as the building finishes.
  float life = smoothstep(0.0, 0.08, vRaw) * (1.0 - smoothstep(0.55, 1.0, vRaw));
  float fade = pow(1.0 - vUv.y, 1.4);
  float streaks = 0.55 + 0.45 * sin(vUv.x * 6.28318 * 9.0 + vUv.y * 14.0 - uTime * 7.0);
  float rings = 0.6 + 0.4 * step(0.82, fract(vUv.y * 10.0 - uTime * 1.6));
  vec3 col = mix(vec3(0.45, 0.95, 1.0), vec3(0.8, 1.0, 1.0), streaks);
  float a = life * fade * streaks * rings * mix(0.5, 0.85, uNight);
  gl_FragColor = vec4(col * a, 1.0);
}
`

export function beamMaterial() {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: beamVertex,
    fragmentShader: beamFragment,
    ...ADD_LIGHT,
    side: THREE.DoubleSide,
  })
}

// ------------------------------------------------------------------ soft shadows under buildings

const shadowVertex = /* glsl */ `
${common}
attribute float aBorn;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vUv = uv;
  vAlpha = growth(aBorn);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`

const shadowFragment = /* glsl */ `
uniform float uNight;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float a = 1.0 - smoothstep(0.35, 1.0, length(p));
  gl_FragColor = vec4(vec3(0.12, 0.08, 0.3), a * clamp(vAlpha, 0.0, 1.0) * mix(0.22, 0.32, uNight));
}
`

export function shadowMaterial() {
  return new THREE.ShaderMaterial({ uniforms, vertexShader: shadowVertex, fragmentShader: shadowFragment, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
}
