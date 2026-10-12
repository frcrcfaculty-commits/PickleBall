#include "pbj/clocksync.hpp"

namespace pbj {

void ClockSync::reset() {
    m_samples.clear();
    m_offset0 = 0; m_drift = 0; m_tRef = 0;
    m_uncertainty = 1e9;
    m_locked = false;
    m_lastLocalT = -1e9;
}

void ClockSync::addSample(const SyncSample& s) {
    const double rtt = (s.t4 - s.t1) - (s.t3 - s.t2);
    if (rtt < 0 || rtt > 1.0) return; // corrupt exchange
    const double theta = ((s.t2 - s.t1) + (s.t3 - s.t4)) * 0.5;
    const double tMid = 0.5 * (s.t1 + s.t4);
    m_lastLocalT = tMid;

    m_samples.push_back({tMid, theta, rtt});
    while (m_samples.size() > m_cfg.maxSamples ||
           (!m_samples.empty() &&
            tMid - m_samples.front().tMid > m_cfg.windowS)) {
        m_samples.pop_front();
    }
    reestimate();
}

void ClockSync::reestimate() {
    if (m_samples.empty()) return;

    double minRtt = 1e9;
    for (const auto& o : m_samples) minRtt = std::min(minRtt, o.rtt);
    const double gate = minRtt * m_cfg.rttAcceptFactor + m_cfg.rttFloorS;

    std::vector<double> ts, th;
    ts.reserve(m_samples.size());
    for (const auto& o : m_samples) {
        if (o.rtt <= gate) { ts.push_back(o.tMid); th.push_back(o.theta); }
    }

    m_tRef = ts.front();
    if (ts.size() < 3) {
        // Not enough clean samples for a drift line — use the min-RTT sample.
        double bestTheta = 0, bestRtt = 1e9;
        for (const auto& o : m_samples)
            if (o.rtt < bestRtt) { bestRtt = o.rtt; bestTheta = o.theta; }
        m_offset0 = bestTheta;
        m_drift = 0;
        m_uncertainty = bestRtt * 0.5; // Cristian's bound for one sample
        m_locked = false;
        return;
    }

    // Centre times for conditioning, then Theil–Sen slope + median intercept.
    std::vector<double> tc(ts.size());
    for (size_t i = 0; i < ts.size(); ++i) tc[i] = ts[i] - m_tRef;

    // Drift needs baseline: with <10 s of span the slope is noise — pin to 0.
    const double span = tc.back() - tc.front();
    double slope = 0;
    if (span > 10.0) slope = theilSenSlope(tc, th);
    if (std::fabs(slope) > 200e-6) slope = 0; // >200 ppm is not clock drift

    std::vector<double> resid(ts.size());
    for (size_t i = 0; i < ts.size(); ++i) resid[i] = th[i] - slope * tc[i];
    const double intercept = median(resid);
    for (double& r : resid) r -= intercept;
    const double sigma = mad(resid, 0.0);

    m_drift = slope;
    m_offset0 = intercept;
    // Uncertainty: the larger of the residual scatter and the irreducible
    // asymmetric-path bound (half the best RTT, discounted for the cluster).
    m_uncertainty = std::max(sigma, minRtt * 0.25);
    m_locked = ts.size() >= m_cfg.minSamplesForLock &&
               m_uncertainty <= m_cfg.lockUncertaintyS;
}

} // namespace pbj
