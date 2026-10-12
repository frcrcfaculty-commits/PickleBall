/**
 * courtDimensionsSI.ts — SI court model mirroring engine/include/pbj/court.hpp.
 * Frame: origin at net centre on the ground; +Y toward Side B baseline;
 * +X toward the right sideline seen from Side A; metres.
 * Keep the legacy inch-based COURT object for old UI code; convert at the UI
 * boundary only.
 */
const IN = 0.0254;
export const COURT_SI = {
  WIDTH: 240 * IN,            // 6.0960
  LENGTH: 528 * IN,           // 13.4112
  HALF_WIDTH: 120 * IN,       // 3.0480
  HALF_LENGTH: 264 * IN,      // 6.7056
  NVZ_DEPTH: 84 * IN,         // 2.1336 (outer edge of NVZ line)
  LINE_WIDTH: 2 * IN,         // 0.0508
  BALL_RADIUS: (2.874 / 2) * IN,
  CONTACT_PATCH_RADIUS: 0.012,
} as const;

/** Calibration landmark catalogue — ids MUST match pbj::CalibrationPointId. */
export const CALIBRATION_POINTS: { id: number; name: string; x: number; y: number }[] = [
  { id: 0,  name: 'B baseline x left sideline',  x: -COURT_SI.HALF_WIDTH, y:  COURT_SI.HALF_LENGTH },
  { id: 1,  name: 'B baseline x centerline',     x: 0,                    y:  COURT_SI.HALF_LENGTH },
  { id: 2,  name: 'B baseline x right sideline', x:  COURT_SI.HALF_WIDTH, y:  COURT_SI.HALF_LENGTH },
  { id: 3,  name: 'B NVZ line x left sideline',  x: -COURT_SI.HALF_WIDTH, y:  COURT_SI.NVZ_DEPTH },
  { id: 4,  name: 'B NVZ line x centerline',     x: 0,                    y:  COURT_SI.NVZ_DEPTH },
  { id: 5,  name: 'B NVZ line x right sideline', x:  COURT_SI.HALF_WIDTH, y:  COURT_SI.NVZ_DEPTH },
  { id: 6,  name: 'A baseline x left sideline',  x: -COURT_SI.HALF_WIDTH, y: -COURT_SI.HALF_LENGTH },
  { id: 7,  name: 'A baseline x centerline',     x: 0,                    y: -COURT_SI.HALF_LENGTH },
  { id: 8,  name: 'A baseline x right sideline', x:  COURT_SI.HALF_WIDTH, y: -COURT_SI.HALF_LENGTH },
  { id: 9,  name: 'A NVZ line x left sideline',  x: -COURT_SI.HALF_WIDTH, y: -COURT_SI.NVZ_DEPTH },
  { id: 10, name: 'A NVZ line x centerline',     x: 0,                    y: -COURT_SI.NVZ_DEPTH },
  { id: 11, name: 'A NVZ line x right sideline', x:  COURT_SI.HALF_WIDTH, y: -COURT_SI.NVZ_DEPTH },
];

/** Build the flat array Engine.calibrate() expects from tapped points. */
export function toFlatPairs(
  taps: { pointId: number; u: number; v: number }[],
): number[] {
  const flat: number[] = [];
  for (const t of taps) {
    const p = CALIBRATION_POINTS.find(c => c.id === t.pointId);
    if (p) flat.push(p.x, p.y, t.u, t.v);
  }
  return flat;
}
