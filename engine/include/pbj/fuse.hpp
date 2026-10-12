// pbj/fuse.hpp — combining two cameras' contact estimates.
//
// Each camera contributes (x, y, Σ, t, σ_t) in the shared court frame and the
// local timebase. Fusion is textbook inverse-covariance weighting — but the
// value is in the two gates around it:
//
//   * ASSOCIATION: two events are the same bounce only if their times agree
//     within the pooled timing uncertainty (fit σ_t of each + clock-sync σ).
//     This is what stops camera A's bounce pairing with camera B's *next*
//     bounce during fast kitchen exchanges.
//
//   * CONSISTENCY: after association, the positions must agree under a
//     χ²(2 dof) test on (x_a − x_b) with covariance Σ_a + Σ_b. Disagreement
//     means one camera is lying (occlusion tail, wrong ball, stale
//     calibration) — in that case fusing would split the difference between
//     a right answer and a wrong one. We instead keep the tighter single
//     estimate, inflate its covariance, and flag the call.

#pragma once
#include "math.hpp"

namespace pbj {

struct ContactEstimate {
    bool valid = false;
    int cameraId = 0;         // 0 = local, 1 = remote
    double tContact = 0;      // LOCAL timebase seconds
    double tSigma = 0.005;
    Vec2 xy{0, 0};            // court frame, metres
    Cov2 cov = Cov2::isotropic(0.01);
    double evidenceZ = 0;     // bounce-detector slope-jump z-score
    bool parallaxCorrected = true;
};

struct FusedContact {
    bool valid = false;
    Vec2 xy{0, 0};
    Cov2 cov;
    double tContact = 0;
    double tSigma = 0;
    int nCameras = 0;
    bool consistent = true;   // false ⇒ cameras disagreed; single est. used
    double mahal2 = 0;        // cross-camera χ² statistic (2 dof)
    bool parallaxCorrected = true;
};

class Fuser {
public:
    struct Config {
        double assocSigmas = 3.0;     // |Δt| gate width in pooled σ
        double assocFloorS = 0.010;   // never gate tighter than 10 ms
        double chi2Gate2dof = 9.21;   // 99 % for χ²(2)
    };

    Fuser() = default;
    explicit Fuser(const Config& cfg) : m_cfg(cfg) {}

    bool sameEvent(const ContactEstimate& a, const ContactEstimate& b,
                   double clockSigmaS) const;
    FusedContact fuse(const ContactEstimate& a, const ContactEstimate& b) const;
    FusedContact single(const ContactEstimate& a) const;

private:
    Config m_cfg;
};

} // namespace pbj
