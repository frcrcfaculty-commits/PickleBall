#include "pbj/decision.hpp"

namespace pbj {

LineCall DecisionEngine::decide(const FusedContact& c,
                                const CallContext& ctx) const {
    LineCall call;
    if (!c.valid) return call;

    call.contact = c.xy;
    call.cov = c.cov;
    call.tContact = c.tContact;
    call.camerasUsed = c.nCameras;
    call.fusedConsistent = c.consistent;
    call.parallaxCorrected = c.parallaxCorrected;

    const LegalRegion region = regionFor(ctx, m_cfg.patchRadiusM);
    const MarginResult m = marginTo(region, c.xy);

    call.marginM = m.margin;
    call.nearestLine = m.nearestLine;

    // Project the 2D covariance onto the binding edge's inward normal.
    double var = c.cov.quad(m.grad);
    call.sigmaM = std::sqrt(std::max(var, 1e-10));

    call.pIn = normCdf(m.margin / call.sigmaM);

    if (call.sigmaM > m_cfg.maxSigmaM) {
        call.verdict = Verdict::NoCall;      // measurement too weak to trust
        return call;
    }
    if (call.pIn >= m_cfg.minCallProb) {
        call.verdict = Verdict::In;
    } else if (call.pIn <= 1.0 - m_cfg.minCallProb) {
        call.verdict = m.nvzFault ? Verdict::Fault : Verdict::Out;
    } else {
        call.verdict = Verdict::NoCall;      // genuinely too close
    }
    return call;
}

} // namespace pbj
