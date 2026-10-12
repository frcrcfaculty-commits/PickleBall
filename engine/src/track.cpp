#include "pbj/track.hpp"

namespace pbj {

bool BallTrack::feed(Detection d) {
    // Rolling-shutter timestamp correction (see header).
    if (m_cfg.rollingShutterReadoutS > 0 && m_cfg.imageH > 1) {
        d.t += (d.v / m_cfg.imageH - 0.5) * m_cfg.rollingShutterReadoutS;
    }

    // Reject out-of-order / duplicate timestamps outright — they poison the
    // least-squares design matrices.
    if (!m_pts.empty() && d.t <= m_pts.back().t + 1e-6) return false;

    bool accept = true;
    if (m_pts.size() >= 2) {
        // Constant-velocity prediction from the last two accepted points.
        const Detection& p1 = m_pts[m_pts.size() - 2];
        const Detection& p2 = m_pts.back();
        double dt12 = p2.t - p1.t;
        double dt = d.t - p2.t;
        if (dt12 > 1e-6 && dt < 0.5) {
            double pu = p2.u + (p2.u - p1.u) / dt12 * dt;
            double pv = p2.v + (p2.v - p1.v) / dt12 * dt;
            double speed = std::sqrt((p2.u - p1.u) * (p2.u - p1.u) +
                                     (p2.v - p1.v) * (p2.v - p1.v)) / dt12;
            double gate = m_cfg.gateBasePx + m_cfg.gateVelK * speed * dt;
            double du = d.u - pu, dv = d.v - pv;
            accept = (du * du + dv * dv) <= gate * gate;
        } else if (dt >= 0.5) {
            // Long gap: the old track is stale — restart on this detection.
            m_pts.clear();
            m_misses = 0;
        }
    }

    if (!accept) {
        if (++m_misses > m_cfg.maxConsecutiveMisses) {
            // The "outliers" were actually the new trajectory — reseed.
            m_pts.clear();
            m_misses = 0;
            m_pts.push_back(d);
            return true;
        }
        return false;
    }

    m_misses = 0;
    m_pts.push_back(d);
    while (m_pts.size() > m_cfg.maxPoints ||
           (!m_pts.empty() && d.t - m_pts.front().t > m_cfg.maxSpanS)) {
        m_pts.pop_front();
    }
    return true;
}

} // namespace pbj
