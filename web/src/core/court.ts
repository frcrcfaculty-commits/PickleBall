/**
 * court.ts — SI court model mirroring engine/include/pbj/court.hpp.
 * Calibration ids MUST match pbj::CalibrationPointId.
 */
const IN = 0.0254;

export const COURT = {
  WIDTH: 240 * IN,
  LENGTH: 528 * IN,
  HALF_WIDTH: 120 * IN,          // 3.0480
  HALF_LENGTH: 264 * IN,         // 6.7056
  NVZ_DEPTH: 84 * IN,            // 2.1336 (outer edge of NVZ line)
  LINE_WIDTH: 2 * IN,
  BALL_DIAMETER: 2.874 * IN,     // 0.0730
  BALL_RADIUS: 1.437 * IN,
  CONTACT_PATCH_RADIUS: 0.012,
} as const;

export interface CalibrationPointDef { id: number; name: string; x: number; y: number }

const W = COURT.HALF_WIDTH, L = COURT.HALF_LENGTH, N = COURT.NVZ_DEPTH;

export const CALIBRATION_POINTS: CalibrationPointDef[] = [
  { id: 0, name: 'Far baseline × left sideline', x: -W, y: L },
  { id: 1, name: 'Far baseline × centerline', x: 0, y: L },
  { id: 2, name: 'Far baseline × right sideline', x: W, y: L },
  { id: 3, name: 'Far kitchen line × left sideline', x: -W, y: N },
  { id: 4, name: 'Far kitchen line × centerline', x: 0, y: N },
  { id: 5, name: 'Far kitchen line × right sideline', x: W, y: N },
  { id: 6, name: 'Near baseline × left sideline', x: -W, y: -L },
  { id: 7, name: 'Near baseline × centerline', x: 0, y: -L },
  { id: 8, name: 'Near baseline × right sideline', x: W, y: -L },
  { id: 9, name: 'Near kitchen line × left sideline', x: -W, y: -N },
  { id: 10, name: 'Near kitchen line × centerline', x: 0, y: -N },
  { id: 11, name: 'Near kitchen line × right sideline', x: W, y: -N },
];

/** The six landmarks a camera judging Side B taps (ids 0–5). */
export const SIDE_B_POINT_IDS = [0, 1, 2, 3, 4, 5];

export function calibrationPoint(id: number): { x: number; y: number } {
  const p = CALIBRATION_POINTS[id];
  if (!p) throw new Error(`unknown calibration point ${id}`);
  return { x: p.x, y: p.y };
}

/** Painted line segments (outer-edge centrelines are close enough for overlay). */
export function courtLineSegments(): Array<[number, number, number, number]> {
  return [
    [-W, -L, W, -L], [-W, L, W, L],          // baselines
    [-W, -L, -W, L], [W, -L, W, L],          // sidelines
    [-W, -N, W, -N], [-W, N, W, N],          // kitchen lines
    [0, N, 0, L], [0, -L, 0, -N],            // centerlines
    [-W, 0, W, 0],                           // net (for reference)
  ];
}
