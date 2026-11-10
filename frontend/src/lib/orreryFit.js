// Geometry for the home orrery's free area. The 3D canvas is full-bleed, but the
// orbit must fit between the HUD: the gauge band, the intro, the left column,
// the right panel and the bottom controls. Pure functions; no DOM, no three.

/** Outermost orbit ring in the scene (Ketu's radius, PlanetarySystem.jsx). */
export const ORBIT_OUTER_RADIUS = 3.42;
/** Ring plus the largest body's disc (Saturn and its ring), for the camera fit. */
const FIT_RADIUS = 3.82;
/** Minimum air between the orbit and the free area's edge. */
export const STAGE_MARGIN = 12;
/** The free area is never allowed to collapse. */
const MIN_FREE = 36;

/** Camera directions per framing key (normalised below; the distance is fitted). */
export const CAMERA_DIRECTIONS = {
  portrait: { orbital: [0, 16, 12], zenith: [0, 28, 0] },
  standard: { orbital: [0, 8, 14], zenith: [0, 22, 0] },
  wide: { orbital: [0, 5, 10], zenith: [0, 22, 0] },
};

export function framingKey(width, height) {
  const aspect = width / Math.max(height, 1);
  if (aspect < 0.8) return "portrait";
  if (width >= 1200) return "wide";
  return "standard";
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalise = (a) => {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};

/** The orbit's screen extents around the origin, for a camera at `position`. */
function extents(position, width, height, fovDeg) {
  const forward = normalise([-position[0], -position[1], -position[2]]);
  const worldUp = [0, 1, 0];
  let right = cross(forward, worldUp);
  if (Math.hypot(right[0], right[1], right[2]) < 1e-6) right = [1, 0, 0];
  right = normalise(right);
  const up = normalise(cross(right, forward));
  const tanHalf = Math.tan((fovDeg * Math.PI) / 360);
  const aspect = width / Math.max(height, 1);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let index = 0; index < 120; index += 1) {
    const angle = (index / 120) * Math.PI * 2;
    const point = [
      Math.cos(angle) * FIT_RADIUS,
      0,
      Math.sin(angle) * FIT_RADIUS,
    ];
    const rel = [
      point[0] - position[0],
      point[1] - position[1],
      point[2] - position[2],
    ];
    const depth = dot(rel, forward);
    if (depth <= 0.001) return { halfW: Infinity, halfH: Infinity };
    const nx = dot(rel, right) / (depth * tanHalf * aspect);
    const ny = dot(rel, up) / (depth * tanHalf);
    const x = (nx * 0.5 + 0.5) * width;
    const y = (0.5 - ny * 0.5) * height;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  // The origin is placed at the stage centre by the view offset, so the fit
  // only needs the extents on either side of it.
  return {
    halfW: Math.max(width / 2 - minX, maxX - width / 2),
    halfH: Math.max(height / 2 - minY, maxY - height / 2),
  };
}

/**
 * The distance at which the projected orbit fits the free area, and the view
 * offset that centres the scene in it.
 *
 * The orbit is a flat ring in perspective, so its near edge is magnified; a
 * closed-form circle would be optimistic. Extents shrink monotonically with
 * distance, so a short binary search finds the largest orbit that fits.
 */
export function fitOrrery(stage, width, height, fovDeg, direction) {
  const left = clamp(stage?.left ?? 0, 0, width);
  const right = clamp(stage?.right ?? width, left, width);
  const top = clamp(stage?.top ?? 0, 0, height);
  const bottom = clamp(stage?.bottom ?? height, top, height);
  const freeW = Math.max(MIN_FREE, right - left);
  const freeH = Math.max(MIN_FREE, bottom - top);
  const limitW = Math.max(8, freeW / 2 - STAGE_MARGIN);
  const limitH = Math.max(8, freeH / 2 - STAGE_MARGIN);

  const unit = normalise(direction);
  let near = 4;
  let far = 240;
  for (let step = 0; step < 26; step += 1) {
    const middle = (near + far) / 2;
    const probe = [unit[0] * middle, unit[1] * middle, unit[2] * middle];
    const size = extents(probe, width, height, fovDeg);
    if (size.halfW <= limitW && size.halfH <= limitH) far = middle;
    else near = middle;
  }
  return {
    distance: clamp(far, 6, 240),
    offsetX: width / 2 - (left + right) / 2,
    offsetY: height / 2 - (top + bottom) / 2,
    freeW,
    freeH,
    left,
    right,
    top,
    bottom,
  };
}

/** A camera position on the framing direction, at the fitted distance. */
export function framedPosition(direction, distance) {
  const unit = normalise(direction);
  return {
    x: unit[0] * distance,
    y: unit[1] * distance,
    z: unit[2] * distance,
  };
}

/** The stage the scene gets when the HUD has not been measured yet. */
export function defaultStage(width, height) {
  return { left: 12, top: 12, right: width - 12, bottom: height - 12 };
}
