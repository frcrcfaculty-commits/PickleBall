#include "pbj/bounce.hpp"
#include <vector>
#include <algorithm>
#ifdef PBJ_DEBUG
#include <cstdio>
#endif

namespace pbj {

namespace {
struct Branch {
    PolyFit vFit;   // quadratic v(t)
    PolyFit uFit;   // linear u(t) — horizontal image motion is ~linear per
                    // branch; spin can kink u at contact, so we NEVER fit u
                    // across the knot.
    double t0 = 0, t1 = 0;
    bool ok = false;
};

Branch fitBranch(const std::deque<Detection>& pts, size_t i0, size_t i1,
                 double tRef) {
    Branch b;
    const int n = static_cast<int>(i1 - i0 + 1);
    if (n < 3) return b;
    std::vector<double> t(n), v(n), u(n), w(n);
    for (int k = 0; k < n; ++k) {
        const Detection& d = pts[i0 + k];
        t[k] = d.t - tRef; // shift for conditioning — never fit raw epochs
        v[k] = d.v;
        u[k] = d.u;
        w[k] = std::max(1e-3, d.score);
    }
    b.vFit = fitPolyWeighted(t.data(), v.data(), w.data(), n, 2);
    b.uFit = fitPolyWeighted(t.data(), u.data(), w.data(), n, 1);
    b.t0 = t.front(); b.t1 = t.back();
    b.ok = b.vFit.valid() && b.uFit.valid();
    return b;
}

// Intersection of the two branch parabolas nearest the knot bracket
// [lo, hi] (times relative to tRef). Returns false if no root lands within
// the widened bracket.
bool intersectBranches(const Branch& A, const Branch& B,
                       double lo, double hi, double& tau) {
    const double da = A.vFit.c[2] - B.vFit.c[2];
    const double db = A.vFit.c[1] - B.vFit.c[1];
    const double dc = A.vFit.c[0] - B.vFit.c[0];
    const double span = hi - lo;
    const double wlo = lo - 0.75 * span, whi = hi + 0.75 * span;

    auto inBracket = [&](double x) { return x >= wlo && x <= whi; };

    if (std::fabs(da) < 1e-9) {
        if (std::fabs(db) < 1e-12) return false;
        tau = -dc / db;
        return inBracket(tau);
    }
    const double disc = db * db - 4 * da * dc;
    if (disc < 0) return false;
    const double sq = std::sqrt(disc);
    const double r1 = (-db + sq) / (2 * da);
    const double r2 = (-db - sq) / (2 * da);
    const double mid = 0.5 * (lo + hi);
    const bool ok1 = inBracket(r1), ok2 = inBracket(r2);
    if (ok1 && ok2) tau = (std::fabs(r1 - mid) < std::fabs(r2 - mid)) ? r1 : r2;
    else if (ok1)   tau = r1;
    else if (ok2)   tau = r2;
    else return false;
    return true;
}
} // namespace

ContactEvent BounceDetector::update(const BallTrack& track) {
    ContactEvent best;
    const auto& pts = track.points();
    const int n = static_cast<int>(pts.size());
    const int m = m_cfg.minPtsPerSide;
    if (n < 2 * m) return best;

    const double tEnd = pts.back().t;
    // First index inside the fit horizon.
    int start = 0;
    while (start < n && tEnd - pts[start].t > m_cfg.maxWindowS) ++start;
    if (n - start < 2 * m) return best;

    double bestScore = 0;

    // Knot between index k and k+1. Require m points on each side, and skip
    // knots at the extreme tip — the detector confirms a bounce only after m
    // post-contact samples exist (latency = m frames; at 60 fps with m=4
    // that is ~67 ms, well under the human "instant call" threshold).
    for (int k = start + m - 1; k <= n - m - 1; ++k) {
        const double tRef = 0.5 * (pts[k].t + pts[k + 1].t);
        if (tRef - m_lastContactT < m_cfg.cooldownS) continue;

        const int mf = std::max(m_cfg.maxFitPtsPerSide, m);
        const size_t a0 = static_cast<size_t>(std::max(start, k - mf + 1));
        const size_t b1 = static_cast<size_t>(std::min(n - 1, k + mf));
        Branch A = fitBranch(pts, a0, k, tRef);
        Branch B = fitBranch(pts, k + 1, b1, tRef);
        if (!A.ok || !B.ok) continue;
        if (A.vFit.rms > m_cfg.maxFitRmsPx || B.vFit.rms > m_cfg.maxFitRmsPx)
            continue;

        // Direction test at the knot: descending (image v grows downward)
        // before, ascending after.
        const double vA = A.vFit.deriv(0.0);
        const double vB = B.vFit.deriv(0.0);
        if (!(vA > m_cfg.minSpeedPxS && vB < -m_cfg.minSpeedPxS)) continue;
        // Each branch must be SIGNIFICANTLY moving in its required direction.
        // A slope that only clears the magnitude floor thanks to noise has a
        // huge standard error; a real descent/ascent does not. This is the
        // gate that keeps flight apexes (a valley in image v, but with
        // near-zero slopes around the turn) from ever faking a bounce peak.
        const double sA = std::sqrt(std::max(A.vFit.derivVar(0.0), 1e-12));
        const double sB = std::sqrt(std::max(B.vFit.derivVar(0.0), 1e-12));
        if (vA / sA < m_cfg.minBranchSlopeZ) continue;
        if (-vB / sB < m_cfg.minBranchSlopeZ) continue;

        const double lo = pts[k].t - tRef, hi = pts[k + 1].t - tRef;
        double tau;
        if (!intersectBranches(A, B, lo, hi, tau)) continue;

        // Slope discontinuity and its significance (z-test). Slope variances
        // come straight from the branch LS covariances — the threshold adapts
        // itself to noisy detectors instead of pretending pixels are exact.
        const double dV = A.vFit.deriv(tau) - B.vFit.deriv(tau);
        if (dV < m_cfg.minDeltaVpxS) continue;
        const double varDv = A.vFit.derivVar(tau) + B.vFit.derivVar(tau);
        const double z = dV / std::sqrt(std::max(varDv, 1e-12));
#ifdef PBJ_DEBUG
        std::printf("DBG PASS-DIR k=%d tRef=%.3f vA=%.0f(sA=%.0f) vB=%.0f(sB=%.0f) dV=%.0f z=%.1f tau=%.4f\n",
                    k, tRef, vA, std::sqrt(A.vFit.derivVar(0.0)), vB,
                    std::sqrt(B.vFit.derivVar(0.0)), dV, z, tau);
#endif
        if (z < m_cfg.minDeltaVzScore) continue;

        // Contact-time uncertainty via the implicit-function theorem on
        // g(τ) = p_A(τ) − p_B(τ) = 0:  σ_τ² ≈ (Var_A + Var_B) / (Δv)².
        const double varTau =
            (A.vFit.predVar(tau) + B.vFit.predVar(tau)) / (dV * dV);
        const double sTau = std::sqrt(std::max(varTau, 0.0));
        if (sTau > m_cfg.maxTimeSigmaS) continue;

        if (z <= bestScore) continue;
        bestScore = z;

        // --- Assemble the event -----------------------------------------
        // v(τ): the branches meet at τ; combine the two evaluations by
        // inverse variance, then add the τ-uncertainty leakage through the
        // mean local slope.
        const double vVarA = std::max(A.vFit.predVar(tau), 1e-9);
        const double vVarB = std::max(B.vFit.predVar(tau), 1e-9);
        const double wA = 1.0 / vVarA, wB = 1.0 / vVarB;
        const double vHat = (wA * A.vFit.eval(tau) + wB * B.vFit.eval(tau)) / (wA + wB);
        const double meanSlopeV = 0.5 * (std::fabs(A.vFit.deriv(tau)) +
                                         std::fabs(B.vFit.deriv(tau)));
        const double varV = 1.0 / (wA + wB) + meanSlopeV * meanSlopeV * varTau;

        // u(τ): per-branch linear fits, inverse-variance combined, plus the
        // same τ leakage through the mean |u̇|.
        const double uVarA = std::max(A.uFit.predVar(tau), 1e-9);
        const double uVarB = std::max(B.uFit.predVar(tau), 1e-9);
        const double wuA = 1.0 / uVarA, wuB = 1.0 / uVarB;
        const double uHat = (wuA * A.uFit.eval(tau) + wuB * B.uFit.eval(tau)) / (wuA + wuB);
        const double meanSlopeU = 0.5 * (std::fabs(A.uFit.deriv(tau)) +
                                         std::fabs(B.uFit.deriv(tau)));
        const double varU = 1.0 / (wuA + wuB) + meanSlopeU * meanSlopeU * varTau;

        best.detected = true;
        best.tContact = tRef + tau;
        best.tSigma = sTau;
        best.imagePt = {uHat, vHat};
        best.imageCov = {varU, 0.0, varV};
        best.deltaVz = z;
        best.downSpeedPxS = vA;
        best.upSpeedPxS = vB;
        best.fitRmsPx = 0.5 * (A.vFit.rms + B.vFit.rms);
    }

    if (best.detected) m_lastContactT = best.tContact;
    return best;
}

} // namespace pbj
