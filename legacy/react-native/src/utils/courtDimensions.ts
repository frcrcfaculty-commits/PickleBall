/**
 * courtDimensions.ts
 *
 * Official USAPA pickleball court constants.
 * All measurements in inches for precision.
 * Reference: USA Pickleball Official Rulebook 2025
 *
 * Coordinate system:
 *   Origin (0, 0) = near-left baseline corner (from camera perspective)
 *   X-axis: left sideline (0) → right sideline (240in = 20ft)
 *   Y-axis: near baseline (0) → far baseline (528in = 44ft)
 *   Net is at Y = 264in (22ft, center of court)
 */

export const COURT = {
  // Court overall dimensions
  WIDTH: 240, // 20 feet = 240 inches
  LENGTH: 528, // 44 feet = 528 inches
  HALF_LENGTH: 264, // 22 feet = 264 inches (one side of net)

  // Net
  NET_Y: 264, // Center of court
  NET_HEIGHT_SIDE: 36, // 36 inches at sidelines
  NET_HEIGHT_CENTER: 34, // 34 inches at center

  // Non-Volley Zone (Kitchen)
  KITCHEN_DEPTH: 84, // 7 feet = 84 inches from net
  KITCHEN_NEAR_Y: 180, // 264 - 84 = 180 (kitchen line on near side)
  KITCHEN_FAR_Y: 348, // 264 + 84 = 348 (kitchen line on far side)

  // Service areas
  SERVICE_WIDTH: 120, // 10 feet = 120 inches (half court width)
  SERVICE_DEPTH: 180, // 15 feet = 180 inches (baseline to kitchen)
  CENTERLINE_X: 120, // Center of court width

  // Lines
  LINE_WIDTH: 2, // 2 inches wide

  // Ball specs (official outdoor)
  BALL_DIAMETER: 2.874, // Official outdoor pickleball diameter (inches)
  BALL_RADIUS: 1.437, // Half diameter

  // Tolerance for "on the line" calls
  // A ball is IN if any part contacts the line
  // Effective boundary = line outer edge + ball radius
  IN_TOLERANCE: 2.437, // LINE_WIDTH/2 + BALL_RADIUS = 1 + 1.437

  // Doubles vs Singles court widths
  DOUBLES_WIDTH: 240, // Full 20 feet
  SINGLES_WIDTH: 204, // 17 feet = 204 inches
  SINGLES_MARGIN: 18, // 1.5 feet = 18 inches inset from each sideline

  // Diagonal measurement for validation
  DIAGONAL: 580, // 48 feet 4 inches ≈ 580 inches
} as const;

/**
 * Boundary polygon for a doubles half-court (near side: baseline to net).
 * Used by DecisionEngine for IN/OUT checks.
 */
export const DOUBLES_HALF_COURT_BOUNDARY = [
  { x: 0, y: 0 }, // Near-left baseline
  { x: COURT.WIDTH, y: 0 }, // Near-right baseline
  { x: COURT.WIDTH, y: COURT.HALF_LENGTH }, // Far-right (at net)
  { x: 0, y: COURT.HALF_LENGTH }, // Far-left (at net)
];

/**
 * Boundary polygon for a singles half-court.
 */
export const SINGLES_HALF_COURT_BOUNDARY = [
  { x: COURT.SINGLES_MARGIN, y: 0 },
  { x: COURT.WIDTH - COURT.SINGLES_MARGIN, y: 0 },
  { x: COURT.WIDTH - COURT.SINGLES_MARGIN, y: COURT.HALF_LENGTH },
  { x: COURT.SINGLES_MARGIN, y: COURT.HALF_LENGTH },
];

/**
 * Kitchen (NVZ) boundary for the near side.
 */
export const KITCHEN_NEAR_BOUNDARY = [
  { x: 0, y: COURT.KITCHEN_NEAR_Y },
  { x: COURT.WIDTH, y: COURT.KITCHEN_NEAR_Y },
  { x: COURT.WIDTH, y: COURT.HALF_LENGTH },
  { x: 0, y: COURT.HALF_LENGTH },
];

/**
 * Convert feet to inches.
 */
export function feetToInches(feet: number): number {
  return feet * 12;
}

/**
 * Convert inches to feet for display.
 */
export function inchesToFeet(inches: number): string {
  const feet = Math.floor(inches / 12);
  const remainingInches = Math.round(inches % 12);
  return remainingInches > 0 ? `${feet}ft ${remainingInches}in` : `${feet}ft`;
}

/**
 * Check if a point is inside a boundary polygon.
 * Uses the ray-casting algorithm.
 */
export function isPointInBoundary(
  x: number,
  y: number,
  boundary: Array<{ x: number; y: number }>,
): boolean {
  let inside = false;
  const n = boundary.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = boundary[i].x;
    const yi = boundary[i].y;
    const xj = boundary[j].x;
    const yj = boundary[j].y;

    if (
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }

  return inside;
}
