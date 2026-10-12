// pbj/court.hpp — the single source of truth for court geometry and rules.
//
// COORDINATE FRAME (used by every module downstream — never redefined):
//   * SI metres. Exact conversions from the USA Pickleball rulebook (imperial
//     is definitional; metric values are exact, not rounded).
//   * Origin: centre of the net, on the ground plane.
//   * +Y: toward Side B's baseline.  −Y: toward Side A's baseline.
//   * +X: toward the right sideline as seen standing on Side A facing Side B.
//   * +Z: up.
//
// Why net-centred instead of a corner: (1) both cameras calibrate against the
// same frame with symmetric numbers, (2) side/serve semantics reduce to sign
// tests, (3) no camera "owns" the origin, so swapping primary/secondary roles
// changes nothing geometric.
//
// LINE SEMANTICS (rulebook, 2025):
//   * Lines are 2 in wide and are measured to the OUTSIDE edge; the playing
//     surface bounds below already include the lines (Rule 2.A).
//   * Rally: a ball contacting any line of the correct court is IN (6.C).
//   * Serve: contacting baseline, sideline, or centerline is IN; contacting
//     the NVZ line is a FAULT — short serve (4.M.5). The NVZ includes its
//     lines (2.B.3), so the serve-legal region begins at the OUTER (baseline-
//     side) edge of the NVZ line, exclusively.
//   * "Contacting" means the ball's ground contact patch overlaps the line —
//     NOT the ball's full silhouette. A pickleball compresses only slightly;
//     the patch radius is ~10–14 mm, far less than the 36.5 mm ball radius.
//     Using ball radius (as the legacy TS code did) systematically overcalls
//     IN by ~25 mm of court distance.

#pragma once
#include "math.hpp"
#include <cstdint>

namespace pbj {

// ---------------------------------------------------------------------------
// Dimensions (metres, exact)
// ---------------------------------------------------------------------------
namespace court {
constexpr double kInch          = 0.0254;
constexpr double kWidth         = 240.0 * kInch;   // 6.0960  (20 ft, doubles+singles court is same for pickleball)
constexpr double kLength        = 528.0 * kInch;   // 13.4112 (44 ft)
constexpr double kHalfWidth     = kWidth  * 0.5;   // 3.0480
constexpr double kHalfLength    = kLength * 0.5;   // 6.7056
constexpr double kNvzDepth      = 84.0  * kInch;   // 2.1336  (7 ft, to OUTER edge of NVZ line)
constexpr double kLineWidth     = 2.0   * kInch;   // 0.0508
constexpr double kHalfLine      = kLineWidth * 0.5;
constexpr double kNetHeightSide = 36.0  * kInch;   // 0.9144
constexpr double kNetHeightMid  = 34.0  * kInch;   // 0.8636
constexpr double kBallDiameter  = 2.874 * kInch;   // 0.0730 (outdoor)
constexpr double kBallRadius    = kBallDiameter * 0.5; // 0.0365

// Ground contact patch radius of an outdoor ball at typical bounce speeds.
// Tunable; 12 mm is a deliberately middle-of-road default. Set to 0 for a
// strict point-contact model, or larger to be generous.
constexpr double kContactPatchRadius = 0.012;
} // namespace court

// ---------------------------------------------------------------------------
// Sides and call context
// ---------------------------------------------------------------------------
enum class Side : uint8_t { A = 0 /* Y < 0 */, B = 1 /* Y > 0 */ };
inline double sideSign(Side s) { return s == Side::B ? 1.0 : -1.0; }
inline Side opposite(Side s) { return s == Side::A ? Side::B : Side::A; }

struct CallContext {
    enum class Type : uint8_t { Rally = 0, Serve = 1 };
    Type type       = Type::Rally;
    Side targetSide = Side::B;  // half the ball must land in
    int  boxSignX   = +1;       // serve only: +1 = X>0 service box, −1 = X<0
};

// ---------------------------------------------------------------------------
// Legal region — axis-aligned rectangle with per-edge line semantics.
// edgePatchSign: +1 → inclusive edge (line touch is IN: region grows by the
// contact-patch radius); −1 → exclusive edge (line touch is FAULT: region
// shrinks by the patch radius).
// ---------------------------------------------------------------------------
struct LegalRegion {
    double xMin = 0, xMax = 0, yMin = 0, yMax = 0;
    double edgePatchSign[4] = {+1, +1, +1, +1}; // xMin, xMax, yMin, yMax
    const char* edgeName[4] = {"", "", "", ""};
    bool faultInsideNvz = false; // true only in serve context (nearest-edge is NVZ line)
};

struct MarginResult {
    double margin = 0;         // metres; >0 ⇒ contact patch is legal, <0 ⇒ not
    Vec2   grad{0, 0};         // ∂margin/∂(x,y) — unit inward normal of binding edge
    const char* nearestLine = "";
    bool nvzFault = false;     // binding constraint is the serve NVZ line
};

LegalRegion  regionFor(const CallContext& ctx, double patchRadius);
MarginResult marginTo(const LegalRegion& r, const Vec2& contact);

// ---------------------------------------------------------------------------
// Calibration landmark catalogue.
// Users tap these painted-line intersections during calibration; both the TS
// UI and the engine reference the same ids. All points are OUTER-edge corners
// (the physically unambiguous feature a person can align a crosshair to).
// Ids 0..5 are Side B, 6..11 the mirrored Side A points.
// ---------------------------------------------------------------------------
enum CalibrationPointId : int {
    B_BASELINE_LEFT = 0,  // (−halfWidth, +halfLength)
    B_BASELINE_CENTER,    // (0,          +halfLength)
    B_BASELINE_RIGHT,     // (+halfWidth, +halfLength)
    B_NVZ_LEFT,           // (−halfWidth, +nvzDepth)
    B_NVZ_CENTER,         // (0,          +nvzDepth)
    B_NVZ_RIGHT,          // (+halfWidth, +nvzDepth)
    A_BASELINE_LEFT,      // (−halfWidth, −halfLength)
    A_BASELINE_CENTER,
    A_BASELINE_RIGHT,
    A_NVZ_LEFT,
    A_NVZ_CENTER,
    A_NVZ_RIGHT,
    CALIB_POINT_COUNT
};

Vec2 calibrationPoint(int id);
const char* calibrationPointName(int id);

} // namespace pbj
