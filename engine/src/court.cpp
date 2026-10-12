#include "pbj/court.hpp"

namespace pbj {
using namespace court;

LegalRegion regionFor(const CallContext& ctx, double patchRadius) {
    LegalRegion r;
    const double s = sideSign(ctx.targetSide);

    if (ctx.type == CallContext::Type::Rally) {
        // Whole target half, all perimeter lines inclusive. The net edge has
        // no painted line; a ball landing at Y≈0 that got there legally is in
        // play, so treat the net edge as inclusive too (patch may straddle it
        // only in the geometric sense — crossing legality is not this
        // module's job).
        r.xMin = -kHalfWidth;  r.edgeName[0] = "sideline_left";
        r.xMax = +kHalfWidth;  r.edgeName[1] = "sideline_right";
        if (s > 0) { r.yMin = 0;            r.yMax = +kHalfLength;
                     r.edgeName[2] = "net"; r.edgeName[3] = "baseline"; }
        else       { r.yMin = -kHalfLength; r.yMax = 0;
                     r.edgeName[2] = "baseline"; r.edgeName[3] = "net"; }
        // all edges inclusive (default +1)
    } else {
        // Serve: the correct service box. Baseline / sideline / centerline
        // touches are IN (inclusive). NVZ-line touch is a FAULT (exclusive):
        // legal Y starts at the OUTER edge of the NVZ line and the contact
        // patch must clear it entirely.
        //
        // Centerline: the painted line is centred on X=0; a serve touching it
        // is good for either box, so the box extends across to the far edge
        // of the centerline (|X| ≥ −halfLine on the box side).
        if (ctx.boxSignX > 0) {
            r.xMin = -kHalfLine;   r.edgeName[0] = "centerline";
            r.xMax = +kHalfWidth;  r.edgeName[1] = "sideline_right";
        } else {
            r.xMin = -kHalfWidth;  r.edgeName[0] = "sideline_left";
            r.xMax = +kHalfLine;   r.edgeName[1] = "centerline";
        }
        if (s > 0) {
            r.yMin = +kNvzDepth;   r.edgeName[2] = "nvz_line";
            r.yMax = +kHalfLength; r.edgeName[3] = "baseline";
            r.edgePatchSign[2] = -1;                 // exclusive
        } else {
            r.yMin = -kHalfLength; r.edgeName[2] = "baseline";
            r.yMax = -kNvzDepth;   r.edgeName[3] = "nvz_line";
            r.edgePatchSign[3] = -1;                 // exclusive
        }
        r.faultInsideNvz = true;
    }

    // Apply patch-radius semantics per edge:
    //   inclusive  (+1): region grows  — patch overlapping the line counts IN
    //   exclusive  (−1): region shrinks — patch touching the line is a fault
    r.xMin -= r.edgePatchSign[0] * patchRadius;
    r.xMax += r.edgePatchSign[1] * patchRadius;
    r.yMin -= r.edgePatchSign[2] * patchRadius;
    r.yMax += r.edgePatchSign[3] * patchRadius;
    return r;
}

MarginResult marginTo(const LegalRegion& r, const Vec2& c) {
    // Signed margin = min over the four edge half-plane margins.
    //   >0 : inside by that much   <0 : outside by that much
    // The min-of-edges form slightly under-reports |distance| when the point
    // is outside past a corner (true distance is the hypotenuse). That biases
    // corner cases toward lower confidence rather than a wrong verdict, and
    // court corners with sub-3σ margins on BOTH axes are vanishingly rare.
    const double m[4] = { c.x - r.xMin, r.xMax - c.x,
                          c.y - r.yMin, r.yMax - c.y };
    const Vec2 g[4] = { {+1, 0}, {-1, 0}, {0, +1}, {0, -1} };

    int best = 0;
    for (int i = 1; i < 4; ++i) if (m[i] < m[best]) best = i;

    MarginResult out;
    out.margin = m[best];
    out.grad = g[best];
    out.nearestLine = r.edgeName[best];
    // A negative margin whose binding edge is the exclusive NVZ boundary means
    // the serve landed short of / on the kitchen line ⇒ fault, not merely out.
    out.nvzFault = r.faultInsideNvz && out.margin < 0 &&
                   (best == 2 || best == 3) &&
                   r.edgePatchSign[best] < 0;
    return out;
}

Vec2 calibrationPoint(int id) {
    const double W = kHalfWidth, L = kHalfLength, N = kNvzDepth;
    switch (id) {
        case B_BASELINE_LEFT:   return {-W, +L};
        case B_BASELINE_CENTER: return { 0, +L};
        case B_BASELINE_RIGHT:  return {+W, +L};
        case B_NVZ_LEFT:        return {-W, +N};
        case B_NVZ_CENTER:      return { 0, +N};
        case B_NVZ_RIGHT:       return {+W, +N};
        case A_BASELINE_LEFT:   return {-W, -L};
        case A_BASELINE_CENTER: return { 0, -L};
        case A_BASELINE_RIGHT:  return {+W, -L};
        case A_NVZ_LEFT:        return {-W, -N};
        case A_NVZ_CENTER:      return { 0, -N};
        case A_NVZ_RIGHT:       return {+W, -N};
        default:                return {0, 0};
    }
}

const char* calibrationPointName(int id) {
    static const char* names[CALIB_POINT_COUNT] = {
        "B baseline × left sideline",  "B baseline × centerline",
        "B baseline × right sideline", "B NVZ line × left sideline",
        "B NVZ line × centerline",     "B NVZ line × right sideline",
        "A baseline × left sideline",  "A baseline × centerline",
        "A baseline × right sideline", "A NVZ line × left sideline",
        "A NVZ line × centerline",     "A NVZ line × right sideline",
    };
    return (id >= 0 && id < CALIB_POINT_COUNT) ? names[id] : "unknown";
}

} // namespace pbj
