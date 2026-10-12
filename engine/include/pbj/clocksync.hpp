// pbj/clocksync.hpp — cross-device time alignment, transport-agnostic.
//
// WHY THIS LIVES IN C++
// ---------------------
// The legacy implementation computed offsets in TypeScript on the JS thread.
// The estimator itself was fine; the problem is structural: every JS-side
// delay (GC pause, bridge hop, event-loop backlog) lands INSIDE t1→t4 and,
// worse, lands asymmetrically — which biases the classic NTP offset, not just
// its variance. Two mitigations, both implemented here:
//
//   1. Timestamps should be captured as close to the socket as the platform
//      allows (the TS bridge notes describe where); the estimator can't fix
//      what the timestamps never saw.
//   2. The estimator keeps only the samples in the minimum-RTT cluster
//      (Cristian filtering) — precisely the exchanges that DIDN'T eat a
//      scheduling stall — and fits offset drift with Theil–Sen, whose ~29 %
//      breakdown point shrugs off the residual asymmetric outliers that
//      wreck ordinary least squares.
//
// Phone crystal oscillators drift 1–20 ppm relative to each other: 60 s of
// play accumulates up to ~1.2 ms — same order as the offset accuracy we need
// (ball at 15 m/s moves 15 mm/ms). Hence drift is estimated, not ignored.
//
// Convention: θ(t) = remoteClock − localClock, evaluated at local time t.

#pragma once
#include "math.hpp"
#include <deque>

namespace pbj {

struct SyncSample {
    // Classic NTP exchange initiated by the LOCAL device:
    //   t1 local send, t2 remote receive, t3 remote send, t4 local receive.
    // All seconds on each device's own monotonic clock.
    double t1 = 0, t2 = 0, t3 = 0, t4 = 0;
};

class ClockSync {
public:
    struct Config {
        size_t maxSamples = 256;
        double windowS = 120.0;          // discard samples older than this
        double rttAcceptFactor = 1.6;    // keep rtt ≤ minRtt·factor + floor
        double rttFloorS = 0.0005;
        size_t minSamplesForLock = 8;
        double lockUncertaintyS = 0.004; // "usable for fusion" bar
    };

    ClockSync() = default;
    explicit ClockSync(const Config& cfg) : m_cfg(cfg) {}

    void addSample(const SyncSample& s);
    void reset();

    bool locked() const { return m_locked; }
    double uncertaintyS() const { return m_uncertainty; }
    double driftPpm() const { return m_drift * 1e6; }
    size_t sampleCount() const { return m_samples.size(); }
    double lastSampleLocalT() const { return m_lastLocalT; }

    // θ(t) and the conversions. Exact algebra for the drift term — at ppm
    // levels the first-order form is fine, but exact costs nothing.
    double offsetAt(double tLocal) const {
        return m_offset0 + m_drift * (tLocal - m_tRef);
    }
    double remoteToLocal(double tRemote) const {
        // tRemote = tLocal + θ(tLocal) ⇒ solve for tLocal.
        return (tRemote - m_offset0 + m_drift * m_tRef) / (1.0 + m_drift);
    }
    double localToRemote(double tLocal) const {
        return tLocal + offsetAt(tLocal);
    }

private:
    void reestimate();

    struct Obs { double tMid, theta, rtt; };
    Config m_cfg;
    std::deque<Obs> m_samples;
    double m_tRef = 0, m_offset0 = 0, m_drift = 0;
    double m_uncertainty = 1e9;
    double m_lastLocalT = -1e9;
    bool m_locked = false;
};

} // namespace pbj
