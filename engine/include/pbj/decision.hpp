// pbj/decision.hpp — the verdict layer.
//
// Everything upstream conspires to deliver one thing: a contact point with an
// honest covariance. The verdict is then not a threshold on distance but a
// PROBABILITY: project the covariance onto the binding line's normal,
//
//     σ_d = √(gᵀ Σ g),      P(IN) = Φ( margin / σ_d ),
//
// and call only when the probability clears the bar in either direction.
// A system that must choose between "confidently wrong" and "honestly
// abstaining" should abstain — a NO-CALL with "68 % in" displayed is a
// feature (players replay the point, exactly like a human line judge saying
// "too close, couldn't see it"), while a wrong OUT call at 3 cm is how the
// product dies in a review.
//
// Verdict taxonomy:
//   IN         ball legally in the target region (line touches included per
//              context — see court.hpp)
//   OUT        outside the target region
//   FAULT      serve context only: contact on/short of the NVZ line
//   NO_CALL    |margin| too small relative to σ, or σ itself too large
//              (e.g. parallax-uncorrected fallback, stale calibration)

#pragma once
#include "court.hpp"
#include "fuse.hpp"

namespace pbj {

enum class Verdict : uint8_t { In = 0, Out = 1, Fault = 2, NoCall = 3 };

struct LineCall {
    Verdict verdict = Verdict::NoCall;
    double pIn = 0.5;          // P(legal) given the measurement
    double marginM = 0;        // signed margin, metres (patch-adjusted)
    double sigmaM = 0;         // 1σ of the margin
    const char* nearestLine = "";
    Vec2 contact{0, 0};        // court frame, metres
    Cov2 cov;
    double tContact = 0;       // local timebase
    int camerasUsed = 0;
    bool fusedConsistent = true;
    bool parallaxCorrected = true;
};

class DecisionEngine {
public:
    struct Config {
        double patchRadiusM = court::kContactPatchRadius;
        double minCallProb = 0.98;  // call IN if p≥this, OUT/FAULT if p≤1−this
        double maxSigmaM = 0.080;   // abstain if the measurement is this weak
    };

    DecisionEngine() = default;
    explicit DecisionEngine(const Config& cfg) : m_cfg(cfg) {}
    void configure(const Config& cfg) { m_cfg = cfg; }

    LineCall decide(const FusedContact& c, const CallContext& ctx) const;

private:
    Config m_cfg;
};

} // namespace pbj
