#include "pbj/fuse.hpp"

namespace pbj {

bool Fuser::sameEvent(const ContactEstimate& a, const ContactEstimate& b,
                      double clockSigmaS) const {
    const double pooled = std::sqrt(a.tSigma * a.tSigma +
                                    b.tSigma * b.tSigma +
                                    clockSigmaS * clockSigmaS);
    const double gate = std::max(m_cfg.assocFloorS, m_cfg.assocSigmas * pooled);
    return std::fabs(a.tContact - b.tContact) <= gate;
}

FusedContact Fuser::single(const ContactEstimate& a) const {
    FusedContact f;
    f.valid = a.valid;
    f.xy = a.xy; f.cov = a.cov;
    f.tContact = a.tContact; f.tSigma = a.tSigma;
    f.nCameras = 1;
    f.parallaxCorrected = a.parallaxCorrected;
    return f;
}

FusedContact Fuser::fuse(const ContactEstimate& a,
                         const ContactEstimate& b) const {
    FusedContact f;
    if (!a.valid) return single(b);
    if (!b.valid) return single(a);

    // Cross-camera consistency: Mahalanobis distance of the disagreement.
    Cov2 S = a.cov + b.cov, Sinv;
    Vec2 d = a.xy - b.xy;
    double mahal2 = 1e9;
    if (S.inverse(Sinv)) mahal2 = Sinv.quad(d);
    f.mahal2 = mahal2;

    if (mahal2 > m_cfg.chi2Gate2dof) {
        // One camera is wrong; averaging would corrupt the good one. Keep the
        // tighter estimate, inflate its covariance by the disagreement, and
        // mark the result so the decision layer lowers confidence.
        const ContactEstimate& keep =
            (a.cov.maxEigen() <= b.cov.maxEigen()) ? a : b;
        f = single(keep);
        f.nCameras = 2;
        f.consistent = false;
        f.mahal2 = mahal2;
        f.cov = f.cov * (1.0 + mahal2 / m_cfg.chi2Gate2dof);
        return f;
    }

    // Inverse-covariance (BLUE) fusion.
    Cov2 Ia, Ib;
    if (!a.cov.inverse(Ia) || !b.cov.inverse(Ib)) return single(a);
    Cov2 Isum = Ia + Ib, cf;
    if (!Isum.inverse(cf)) return single(a);

    const double mx = Ia.xx * a.xy.x + Ia.xy * a.xy.y +
                      Ib.xx * b.xy.x + Ib.xy * b.xy.y;
    const double my = Ia.xy * a.xy.x + Ia.yy * a.xy.y +
                      Ib.xy * b.xy.x + Ib.yy * b.xy.y;

    f.valid = true;
    f.xy = {cf.xx * mx + cf.xy * my, cf.xy * mx + cf.yy * my};
    f.cov = cf;

    const double wa = 1.0 / std::max(a.tSigma * a.tSigma, 1e-10);
    const double wb = 1.0 / std::max(b.tSigma * b.tSigma, 1e-10);
    f.tContact = (wa * a.tContact + wb * b.tContact) / (wa + wb);
    f.tSigma = std::sqrt(1.0 / (wa + wb));
    f.nCameras = 2;
    f.consistent = true;
    f.parallaxCorrected = a.parallaxCorrected && b.parallaxCorrected;
    return f;
}

} // namespace pbj
