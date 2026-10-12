#include "pbj/engine.hpp"
#include <algorithm>
#include <cmath>

namespace pbj {

const char* verdictName(Verdict v) {
    switch (v) {
        case Verdict::In:     return "IN";
        case Verdict::Out:    return "OUT";
        case Verdict::Fault:  return "FAULT";
        default:              return "NO_CALL";
    }
}

Engine::Engine() : Engine(Config()) {}

Engine::Engine(const Config& cfg)
    : m_cfg(cfg),
      m_track(cfg.track),
      m_bounce(cfg.bounce),
      m_clock(cfg.clock),
      m_fuser(cfg.fuser),
      m_decider(cfg.decision) {}

void Engine::setKnownIntrinsics(double f, double cx, double cy) {
    PBJ_LOCK(m_mu);
    m_camera.setKnownIntrinsics(f, cx, cy);
}

Camera::Result Engine::calibrate(double imageW, double imageH,
                                 const std::vector<Correspondence>& pairs) {
    PBJ_LOCK(m_mu);
    auto r = m_camera.calibrate(imageW, imageH, pairs, m_cfg.ballRadiusM);
    m_track.reset();
    m_bounce.reset();
    return r;
}

void Engine::setContext(const CallContext& ctx) {
    PBJ_LOCK(m_mu);
    m_ctx = ctx;
}

void Engine::setPeerConnected(bool connected) {
    PBJ_LOCK(m_mu);
    m_peerConnected = connected;
}

void Engine::setRollingShutter(double readoutS, double imageH) {
    PBJ_LOCK(m_mu);
    auto tc = m_cfg.track;
    tc.rollingShutterReadoutS = readoutS;
    tc.imageH = imageH;
    m_cfg.track = tc;
    m_track.configure(tc);
}

void Engine::feedDetection(double t, double u, double v,
                           double radiusPx, double score) {
    PBJ_LOCK(m_mu);
    if (!m_camera.hasHomography()) return;
    if (!m_track.feed({t, u, v, radiusPx, score})) return;

    ContactEvent ev = m_bounce.update(m_track);
    if (ev.detected) emitLocalContact(ev);
}

void Engine::emitLocalContact(const ContactEvent& ev) {
    // The ONLY place image space becomes court space: the fitted contact
    // pixel through the z = ballRadius plane.
    Vec2 court;
    if (!m_camera.imageToPlane(ev.imagePt, m_cfg.ballRadiusM, court)) return;
    Cov2 cov = m_camera.courtCovariance(ev.imagePt, ev.imageCov,
                                        m_cfg.ballRadiusM);

    ContactEstimate est;
    est.valid = true;
    est.cameraId = 0;
    est.tContact = ev.tContact;
    est.tSigma = ev.tSigma;
    est.xy = court;
    est.cov = cov;
    est.evidenceZ = ev.deltaVz;
    est.parallaxCorrected = m_camera.parallaxCorrected();
    m_pendingLocal.push_back({est, ev.tContact});

    OutboundContact oc;
    oc.tContactLocal = ev.tContact;
    oc.tSigma = ev.tSigma;
    oc.x = court.x; oc.y = court.y;
    oc.covXX = cov.xx; oc.covXY = cov.xy; oc.covYY = cov.yy;
    oc.evidenceZ = ev.deltaVz;
    oc.parallaxCorrected = est.parallaxCorrected;
    m_outbound.push_back(oc);
}

void Engine::feedSyncSample(double t1, double t2, double t3, double t4) {
    PBJ_LOCK(m_mu);
    m_clock.addSample({t1, t2, t3, t4});
}

void Engine::feedRemoteContact(const OutboundContact& rc) {
    PBJ_LOCK(m_mu);
    // Cannot place a remote event on the local timeline without a usable
    // clock mapping — drop it (the local pipeline still calls the bounce).
    if (m_clock.sampleCount() == 0) return;

    ContactEstimate est;
    est.valid = true;
    est.cameraId = 1;
    est.tContact = m_clock.remoteToLocal(rc.tContactLocal) - m_latencyOffset;
    // Fold the clock mapping's own uncertainty into the event timing here —
    // downstream never needs to know two clocks existed.
    est.tSigma = std::sqrt(rc.tSigma * rc.tSigma +
                           m_clock.uncertaintyS() * m_clock.uncertaintyS());
    est.xy = {rc.x, rc.y};
    est.cov = {rc.covXX, rc.covXY, rc.covYY};
    est.evidenceZ = rc.evidenceZ;
    est.parallaxCorrected = rc.parallaxCorrected;
    m_pendingRemote.push_back({est, est.tContact});
}

void Engine::resolvePending(double now, std::vector<LineCall>& calls) {
    const double clockSigma = m_clock.uncertaintyS();

    // Pair local↔remote inside the association gate.
    for (auto& L : m_pendingLocal) {
        if (!L.est.valid) continue;
        for (auto& R : m_pendingRemote) {
            if (!R.est.valid) continue;
            if (m_fuser.sameEvent(L.est, R.est, clockSigma)) {
                FusedContact f = m_fuser.fuse(L.est, R.est);
                calls.push_back(m_decider.decide(f, m_ctx));
                L.est.valid = R.est.valid = false;
                break;
            }
        }
    }

    // Latency learning: unpaired local/remote contacts that agree in SPACE
    // inside a wide time window are the same bounce seen through two
    // different capture latencies. Record dt, then fuse them anyway (the
    // spatial agreement is the stronger evidence).
    for (auto& L : m_pendingLocal) {
        if (!L.est.valid) continue;
        for (auto& R : m_pendingRemote) {
            if (!R.est.valid) continue;
            const double dt = R.est.tContact - L.est.tContact;
            if (std::fabs(dt) > m_cfg.latencyLearnWindowS) continue;
            FusedContact probe = m_fuser.fuse(L.est, R.est);
            if (!probe.consistent) continue;
            learnLatency(dt);
            calls.push_back(m_decider.decide(probe, m_ctx));
            L.est.valid = R.est.valid = false;
            break;
        }
    }

    // Expire unpaired contacts into single-camera calls. Without a peer,
    // decide immediately — no reason to sit on the verdict.
    const double wait = m_peerConnected ? m_cfg.fusionWaitS : 0.0;
    auto expire = [&](std::vector<Pending>& pend) {
        for (auto& p : pend) {
            if (!p.est.valid) continue;
            if (now - p.bornLocalT >= wait) {
                calls.push_back(m_decider.decide(m_fuser.single(p.est), m_ctx));
                p.est.valid = false;
            }
        }
        pend.erase(std::remove_if(pend.begin(), pend.end(),
                                  [](const Pending& p) { return !p.est.valid; }),
                   pend.end());
    };
    expire(m_pendingLocal);
    expire(m_pendingRemote);
}

void Engine::poll(double now,
                  std::vector<OutboundContact>& outbound,
                  std::vector<LineCall>& calls) {
    PBJ_LOCK(m_mu);
    outbound.swap(m_outbound);
    m_outbound.clear();
    resolvePending(now, calls);
}

void Engine::learnLatency(double dt) {
    // dt is measured on already-offset-corrected remote times, so it is a
    // RESIDUAL; accumulate the absolute offset.
    m_latencyObs.push_back(m_latencyOffset + dt);
    if (static_cast<int>(m_latencyObs.size()) > m_cfg.latencyMaxSamples)
        m_latencyObs.erase(m_latencyObs.begin());
    if (static_cast<int>(m_latencyObs.size()) >= m_cfg.latencyMinSamples) {
        m_latencyOffset = median(m_latencyObs);
        m_latencyLocked = true;
    }
}

bool Engine::groundToImage(double x, double y, double& u, double& v) const {
    PBJ_LOCK(m_mu);
    Vec2 px;
    if (!m_camera.groundToImage({x, y}, px)) return false;
    u = px.x; v = px.y;
    return true;
}

bool Engine::groundHomography(double out9[9]) const {
    PBJ_LOCK(m_mu);
    if (!m_camera.hasHomography()) return false;
    Mat3 H = m_camera.H();
    for (int i = 0; i < 3; ++i)
        for (int j = 0; j < 3; ++j) out9[i * 3 + j] = H.m[i][j];
    return true;
}

double Engine::learnedLatencyOffsetS() const {
    PBJ_LOCK(m_mu);
    return m_latencyOffset;
}

int Engine::latencySamples() const {
    PBJ_LOCK(m_mu);
    return static_cast<int>(m_latencyObs.size());
}

EngineStatus Engine::status() const {
    PBJ_LOCK(m_mu);
    EngineStatus s;
    s.calibrated = m_camera.hasHomography();
    s.poseValid = m_camera.hasPose();
    s.reprojRmsPx = m_camera.reprojRmsPx();
    s.cameraHeightM = m_camera.hasPose() ? m_camera.cameraCenter().z : 0;
    s.focalPx = m_camera.focalPx();
    s.clockLocked = m_clock.locked();
    s.clockUncertaintyMs = m_clock.uncertaintyS() * 1000.0;
    s.clockDriftPpm = m_clock.driftPpm();
    s.trackLength = m_track.size();
    s.peerConnected = m_peerConnected;
    return s;
}

void Engine::resetPlay() {
    PBJ_LOCK(m_mu);
    m_track.reset();
    m_bounce.reset();
    m_pendingLocal.clear();
    m_pendingRemote.clear();
    m_outbound.clear();
    // Latency offset is a device property, not a rally property: keep it.
}

} // namespace pbj
