#pragma once

/**
 * BounceDetector.h
 * 
 * Detects when a pickleball bounces on the court by analyzing the trajectory
 * history from BallTracker. A bounce manifests as a sharp "V"-shaped inversion
 * in the ball's vertical velocity vector (vy changes sign from positive/downward
 * to negative/upward).
 * 
 * The detector performs sub-frame interpolation to compute the exact millisecond
 * timestamp and court coordinate of the lowest point of the trajectory inversion.
 */

#include "BallTracker.h"
#include <deque>
#include <optional>

namespace picklejudge {

struct BounceResult {
    bool detected;              // Was a bounce detected?
    double courtX;              // Court-space X of bounce point (inches)
    double courtY;              // Court-space Y of bounce point (inches)
    double timestamp;           // Interpolated sync timestamp (ms)
    double velocityChange;      // Magnitude of vy inversion (confidence indicator)
    double confidence;          // Overall bounce confidence (0.0 - 1.0)
    int    frameIndex;          // Index in history where bounce was detected
};

class BounceDetector {
public:
    /**
     * @param vyThreshold      Minimum absolute vy to consider as directional motion
     * @param minBounceDeltaVy Minimum vy change magnitude to qualify as a bounce
     * @param minHeightRatio   Minimum apparent size ratio suggesting ball is near ground
     * @param cooldownMs       Minimum time between consecutive bounce detections
     */
    BounceDetector(
        double vyThreshold = 0.5,
        double minBounceDeltaVy = 1.5,
        double minHeightRatio = 0.3,
        double cooldownMs = 200.0
    );

    ~BounceDetector() = default;

    /**
     * Analyze the track history for a bounce event.
     * 
     * This should be called after each BallTracker update. It examines
     * the recent trajectory for the characteristic V-shaped velocity
     * inversion pattern.
     * 
     * @param history  The ball's track history from BallTracker
     * @return         BounceResult with detected=true if a bounce was found
     */
    BounceResult detect(const std::deque<TrackPoint>& history);

    /**
     * Reset detector state (e.g., after a point ends).
     */
    void reset();

    /**
     * Get the last detected bounce result.
     */
    const BounceResult& getLastBounce() const { return m_lastBounce; }

    // Tuning parameters (adjustable at runtime)
    void setVyThreshold(double val) { m_vyThreshold = val; }
    void setMinBounceDeltaVy(double val) { m_minBounceDeltaVy = val; }
    void setCooldownMs(double val) { m_cooldownMs = val; }

private:
    double m_vyThreshold;
    double m_minBounceDeltaVy;
    double m_minHeightRatio;
    double m_cooldownMs;
    double m_lastBounceTimestamp;
    BounceResult m_lastBounce;

    /**
     * Perform sub-frame interpolation to find the exact bounce point.
     * Uses linear interpolation between the two frames straddling the
     * velocity sign change.
     */
    BounceResult interpolateBouncePoint(
        const TrackPoint& before,  // Last frame with vy > 0 (falling)
        const TrackPoint& after    // First frame with vy < 0 (rising)
    ) const;

    /**
     * Validate that the bounce is physically plausible.
     * Checks:
     *  - Ball appears to be near ground level (small apparent radius)
     *  - Velocity magnitudes are consistent with a real bounce
     *  - No excessive jitter (multiple sign changes)
     */
    bool validateBounce(
        const std::deque<TrackPoint>& history,
        size_t bounceIndex
    ) const;
};

} // namespace picklejudge
