// pbj/track.hpp — per-camera ball track in IMAGE space.
//
// Deliberate design point: tracking, association and bounce fitting all
// happen in raw pixel coordinates. Nothing here touches a homography. Court
// coordinates enter the pipeline exactly once — when the fitted contact
// pixel is mapped through the elevated-plane homography — so geometric bias
// cannot leak into the physics fits.
//
// Rolling shutter: CMOS sensors expose rows sequentially over the readout
// time T_ro (10–30 ms on phones). A frame timestamp describes one reference
// row; a ball imaged at row v was actually sampled at
//     t_true ≈ t_frame + (v / imageH − 0.5) · T_ro
// For a ball dropping at 600 px/s with T_ro = 20 ms that is up to a 6 px
// vertical lie — enough to visibly bend the parabola fits. We correct the
// timestamp per detection at ingest when the caller supplies T_ro.

#pragma once
#include "math.hpp"
#include <deque>

namespace pbj {

struct Detection {
    double t = 0;        // local monotonic seconds (frame timestamp)
    double u = 0, v = 0; // pixel centre of the ball
    double radiusPx = 0;
    double score = 1.0;  // detector confidence in (0, 1]
};

class BallTrack {
public:
    struct Config {
        double maxSpanS = 0.9;          // history horizon
        size_t maxPoints = 128;
        double gateBasePx = 30.0;       // gate = base + gateVelK · |v| · dt
        double gateVelK = 3.0;
        int    maxConsecutiveMisses = 6; // then the track resets
        double rollingShutterReadoutS = 0.0; // 0 = no correction
        double imageH = 0.0;                 // needed if readout > 0
    };

    BallTrack() = default;
    explicit BallTrack(const Config& cfg) : m_cfg(cfg) {}
    void configure(const Config& cfg) { m_cfg = cfg; }

    // Returns true if the detection was accepted into the track.
    bool feed(Detection d);
    void reset() { m_pts.clear(); m_misses = 0; }

    const std::deque<Detection>& points() const { return m_pts; }
    size_t size() const { return m_pts.size(); }
    bool empty() const { return m_pts.empty(); }
    const Detection& back() const { return m_pts.back(); }

private:
    Config m_cfg;
    std::deque<Detection> m_pts;
    int m_misses = 0;
};

} // namespace pbj
