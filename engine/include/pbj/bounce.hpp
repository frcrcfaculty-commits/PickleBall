// pbj/bounce.hpp — sub-frame bounce detection by piecewise-parabolic fitting.
//
// PHYSICS, IN IMAGE COORDINATES
// -----------------------------
// Between contacts, the ball is ballistic: constant acceleration in 3D. Under
// a projective camera that is NOT exactly a parabola in pixels, but over the
// ±0.3 s window around a bounce the depth change is small and a quadratic
// v(t) fits real trajectories to sub-pixel residuals — verified in the test
// suite against exact projective projection of a simulated ball.
//
// A bounce is a velocity discontinuity: v(t) is continuous, v̇(t) jumps from
// downward (+v̇ in image coords, v grows downward) to upward (−v̇). So:
//
//   1. Slide a candidate knot k through the track window.
//   2. Fit quadratic v(t) independently to the points before and after k.
//   3. The contact instant τ is the INTERSECTION of the two parabolas near
//      the knot — a closed-form sub-frame estimate (at 60 fps, frame quanta
//      are 16.7 ms ≈ 10–15 cm of ball travel; interpolating between two
//      frames, as the legacy code did, forfeits most of that).
//   4. Accept iff both fits are tight, the slope discontinuity is large
//      relative to its own standard error (a z-test, not a magic threshold),
//      and τ lies inside the knot bracket.
//
// The output is an IMAGE-space contact point with covariance and a contact
// time with σ — the only quantities the geometry layer ever maps to court
// coordinates. No homography is touched in this file.

#pragma once
#include "math.hpp"
#include "track.hpp"

namespace pbj {

struct ContactEvent {
    bool detected = false;
    double tContact = 0;   // local monotonic seconds (sub-frame)
    double tSigma = 0;     // 1σ of tContact
    Vec2 imagePt{0, 0};    // ball CENTRE pixel at contact
    Cov2 imageCov;         // px²
    double deltaVz = 0;    // slope-discontinuity z-score (evidence strength)
    double downSpeedPxS = 0, upSpeedPxS = 0;
    double fitRmsPx = 0;   // pooled residual RMS of the two branches
};

class BounceDetector {
public:
    struct Config {
        int    minPtsPerSide   = 4;
        int    maxFitPtsPerSide = 8;    // quadratic-in-image is a LOCAL model;
                                        // long windows let perspective curvature
                                        // masquerade as slope at the knot edge
        double maxWindowS      = 0.60;  // fit horizon around the knot
        double minSpeedPxS     = 40.0;  // each branch must actually move
        double minBranchSlopeZ  = 4.0;   // …and significantly so (see .cpp)
        double minDeltaVpxS    = 120.0; // absolute floor on the slope jump
        double minDeltaVzScore = 6.0;   // jump must be ≥ this many σ
        double maxFitRmsPx     = 3.0;   // per-branch residual ceiling
        double maxTimeSigmaS   = 0.020; // reject mushy intersections
        double cooldownS       = 0.35;  // one bounce per contact
    };

    BounceDetector() = default;
    explicit BounceDetector(const Config& cfg) : m_cfg(cfg) {}
    void configure(const Config& cfg) { m_cfg = cfg; }
    void reset() { m_lastContactT = -1e9; }

    // Call after each accepted detection. Returns a detected==true event at
    // most once per physical bounce (cooldown-guarded).
    ContactEvent update(const BallTrack& track);

private:
    Config m_cfg;
    double m_lastContactT = -1e9;
};

} // namespace pbj
