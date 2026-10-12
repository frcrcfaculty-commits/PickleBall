// pbj/engine.hpp — the facade the app talks to (via JSI).
//
// One instance per device. The device runs the full local pipeline on its own
// camera and exchanges only tiny CONTACT ESTIMATES with its peer — never
// frames, never tracks. That keeps the network payload to ~100 bytes per
// bounce and makes single-device operation the natural degenerate case.
//
// TIMEBASE: every timestamp inside this engine is LOCAL monotonic seconds.
// Remote contacts are converted on ingest using the ClockSync mapping; the
// sync uncertainty is folded into the remote event's tSigma at that moment,
// so downstream code never needs to know which clock a number came from.
//
// THREADING: feedDetection() is called from the camera/worklet thread at
// frame rate; everything else from the JS thread. A single mutex guards
// state — the per-call work is microseconds, far below contention concern.
//
// FLOW per bounce:
//   camera thread: feedDetection → track → bounce fit → contact estimate
//     → queued (a) outbound for the peer, (b) pending for fusion
//   JS thread: poll(now) → pairs pending local/remote contacts inside the
//     association gate; on match → fuse → decide → LineCall queued.
//     Unmatched contacts older than fusionWaitS decide single-camera.

#pragma once
#include "camera.hpp"
#include "track.hpp"
#include "bounce.hpp"
#include "clocksync.hpp"
#include "fuse.hpp"
#include "decision.hpp"
#if defined(PBJ_SINGLE_THREAD)
// WASM/browser build: the engine is driven from one JS thread (or one worker),
// so locking is a no-op. Keeps libc++ thread support out of the wasm binary.
namespace pbj { struct NullMutex { void lock() {} void unlock() {} }; }
#define PBJ_MUTEX pbj::NullMutex
#define PBJ_LOCK(m) std::lock_guard<PBJ_MUTEX> lk(m)
#include <mutex>
#else
#include <mutex>
#define PBJ_MUTEX std::mutex
#define PBJ_LOCK(m) std::lock_guard<std::mutex> lk(m)
#endif
#include <vector>

namespace pbj {

// Wire payload for the peer link (serialized by the TS layer as JSON or a
// packed struct — field order here is the protocol).
struct OutboundContact {
    double tContactLocal = 0; // SENDER's clock — receiver converts
    double tSigma = 0;
    double x = 0, y = 0;
    double covXX = 0, covXY = 0, covYY = 0;
    double evidenceZ = 0;
    bool parallaxCorrected = true;
};

struct EngineStatus {
    bool calibrated = false;
    bool poseValid = false;
    double reprojRmsPx = 0;
    double cameraHeightM = 0;
    double focalPx = 0;
    bool clockLocked = false;
    double clockUncertaintyMs = 0;
    double clockDriftPpm = 0;
    size_t trackLength = 0;
    bool peerConnected = false;
};

class Engine {
public:
    struct Config {
        double ballRadiusM = court::kBallRadius;
        double fusionWaitS = 0.30;  // hold a contact this long for its twin
        // Browser cameras expose presentation-time, not sensor-time, stamps:
        // each device adds an unknown, roughly CONSTANT capture->callback
        // latency (20-80 ms). Clock sync cannot see it, so it shows up as a
        // fixed offset between the two devices' bounce times and would make
        // the association gate reject true pairs. We learn it from the data:
        // contacts that agree SPATIALLY (chi2 gate) within a wide time window
        // are treated as the same bounce, their dt is recorded, and the
        // median of the last N is applied to every remote contact.
        double latencyLearnWindowS = 0.25;
        int    latencyMinSamples   = 3;
        int    latencyMaxSamples   = 25;
        BallTrack::Config track;
        BounceDetector::Config bounce;
        ClockSync::Config clock;
        Fuser::Config fuser;
        DecisionEngine::Config decision;
    };

    Engine();
    explicit Engine(const Config& cfg);

    // ---- calibration (local camera) ------------------------------------
    void setKnownIntrinsics(double f, double cx, double cy);
    Camera::Result calibrate(double imageW, double imageH,
                             const std::vector<Correspondence>& pairs);

    // ---- runtime configuration -----------------------------------------
    void setContext(const CallContext& ctx);
    void setPeerConnected(bool connected);
    void setRollingShutter(double readoutS, double imageH);

    // ---- data ingest ----------------------------------------------------
    // Camera thread. tSeconds = frame monotonic timestamp.
    void feedDetection(double tSeconds, double u, double v,
                       double radiusPx, double score);
    // JS thread: NTP exchange this device initiated.
    void feedSyncSample(double t1, double t2, double t3, double t4);
    // JS thread: peer's contact estimate off the wire.
    void feedRemoteContact(const OutboundContact& rc);

    // ---- polling (JS thread, e.g. per animation frame) -------------------
    // Advances the fusion window and drains queues.
    void poll(double nowLocalSeconds,
              std::vector<OutboundContact>& outbound,
              std::vector<LineCall>& calls);

    EngineStatus status() const;
    double learnedLatencyOffsetS() const;
    // Overlay / detector support: court ground point -> image pixel, and the
    // raw ground homography (court metres -> pixels), row-major.
    bool groundToImage(double x, double y, double& u, double& v) const;
    bool groundHomography(double out9[9]) const;   // remote - local, applied on ingest
    int latencySamples() const;
    void resetPlay(); // clears tracks/pending between rallies

private:
    void emitLocalContact(const ContactEvent& ev);
    void resolvePending(double now, std::vector<LineCall>& calls);

    mutable PBJ_MUTEX m_mu;
    Config m_cfg;

    Camera m_camera;
    BallTrack m_track;
    BounceDetector m_bounce;
    ClockSync m_clock;
    Fuser m_fuser;
    DecisionEngine m_decider;

    CallContext m_ctx;
    bool m_peerConnected = false;

    struct Pending { ContactEstimate est; double bornLocalT; };
    std::vector<Pending> m_pendingLocal, m_pendingRemote;
    std::vector<OutboundContact> m_outbound;

    std::vector<double> m_latencyObs;  // ring of (remote - local) dt samples
    double m_latencyOffset = 0.0;
    bool m_latencyLocked = false;
    void learnLatency(double dt);
};

const char* verdictName(Verdict v);

} // namespace pbj
