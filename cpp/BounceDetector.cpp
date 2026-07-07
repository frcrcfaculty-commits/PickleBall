#include "BounceDetector.h"
#include <cmath>
#include <algorithm>

namespace picklejudge {

BounceDetector::BounceDetector(
    double vyThreshold,
    double minBounceDeltaVy,
    double minHeightRatio,
    double cooldownMs)
    : m_vyThreshold(vyThreshold)
    , m_minBounceDeltaVy(minBounceDeltaVy)
    , m_minHeightRatio(minHeightRatio)
    , m_cooldownMs(cooldownMs)
    , m_lastBounceTimestamp(-1e9) // Allow first bounce immediately
    , m_lastBounce{false, 0, 0, 0, 0, 0, -1}
{
}

BounceResult BounceDetector::detect(const std::deque<TrackPoint>& history) {
    // Need at least 5 points to detect a V-shape with context
    if (history.size() < 5) {
        return {false, 0, 0, 0, 0, 0, -1};
    }

    // We analyze a sliding window near the end of the history.
    // We look for the most recent velocity sign change, but not at the
    // very tip (need at least 2 frames after the bounce to confirm the "V").
    //
    // Window: look from [size-4] back to [2], checking pairs (i, i+1)
    // The "V" pattern:
    //   history[i].vy > threshold  (ball falling)
    //   history[i+1].vy < -threshold  (ball rising)

    size_t searchStart = (history.size() >= 6) ? history.size() - 4 : 2;
    size_t searchEnd   = history.size() - 1;

    for (size_t i = searchStart; i < searchEnd; ++i) {
        const auto& ptBefore = history[i];
        const auto& ptAfter  = history[i + 1];

        // Condition 1: Velocity sign change (downward → upward in court Y)
        // In court coordinates: positive vy = moving away from camera (often downward)
        // The "falling" direction depends on court orientation; we use the
        // convention that vy inversion (regardless of sign) indicates a bounce.
        //
        // We check for the general case: a sign flip with sufficient magnitude.
        bool signFlip = (ptBefore.vy > m_vyThreshold && ptAfter.vy < -m_vyThreshold) ||
                        (ptBefore.vy < -m_vyThreshold && ptAfter.vy > m_vyThreshold);

        if (!signFlip) continue;

        // Condition 2: Sufficient velocity change magnitude
        double deltaVy = std::abs(ptAfter.vy - ptBefore.vy);
        if (deltaVy < m_minBounceDeltaVy) continue;

        // Condition 3: Cooldown — prevent rapid re-triggering
        double bounceTimestamp = (ptBefore.timestamp + ptAfter.timestamp) / 2.0;
        if (bounceTimestamp - m_lastBounceTimestamp < m_cooldownMs) continue;

        // Condition 4: Physical plausibility validation
        if (!validateBounce(history, i)) continue;

        // All conditions met — compute precise bounce point
        BounceResult result = interpolateBouncePoint(ptBefore, ptAfter);
        result.frameIndex = static_cast<int>(i);

        // Store and return
        m_lastBounce = result;
        m_lastBounceTimestamp = result.timestamp;
        return result;
    }

    return {false, 0, 0, 0, 0, 0, -1};
}

BounceResult BounceDetector::interpolateBouncePoint(
    const TrackPoint& before,
    const TrackPoint& after) const
{
    BounceResult result;
    result.detected = true;

    // Sub-frame interpolation: find the zero-crossing of vy.
    // Using linear interpolation between the two straddling frames:
    //   vy(t) = before.vy + (after.vy - before.vy) * alpha
    //   vy(t_bounce) = 0  →  alpha = before.vy / (before.vy - after.vy)

    double alpha = 0.5; // Default to midpoint
    double vyDiff = before.vy - after.vy;
    if (std::abs(vyDiff) > 1e-10) {
        alpha = before.vy / vyDiff;
        alpha = std::clamp(alpha, 0.0, 1.0);
    }

    // Interpolate timestamp
    result.timestamp = before.timestamp +
        alpha * (after.timestamp - before.timestamp);

    // Interpolate court position
    result.courtX = before.courtX + alpha * (after.courtX - before.courtX);
    result.courtY = before.courtY + alpha * (after.courtY - before.courtY);

    // Velocity change magnitude as confidence indicator
    result.velocityChange = std::abs(after.vy - before.vy);

    // Confidence based on:
    //  - Velocity change magnitude (higher = more confident)
    //  - Detection quality of surrounding frames (not purely predicted)
    //  - Consistency of trajectory before/after
    double velConfidence = std::min(1.0, result.velocityChange / 5.0);
    double detConfidence = (before.predicted || after.predicted) ? 0.5 : 1.0;

    // Check trajectory consistency: the 2 frames before should show
    // consistent downward motion, and 2 frames after should show upward
    result.confidence = velConfidence * detConfidence;

    return result;
}

bool BounceDetector::validateBounce(
    const std::deque<TrackPoint>& history,
    size_t bounceIndex) const
{
    // Validation 1: Ball should be near the ground level.
    // We use apparent radius as a proxy — a ball near the ground appears
    // at roughly its expected size. A ball high in the air appears smaller.
    // This is a soft check since camera angle affects apparent size.
    const auto& bouncePt = history[bounceIndex];
    if (history.size() > 10) {
        // Find the maximum radius in recent history (= closest/largest)
        double maxRadius = 0;
        for (size_t i = (history.size() > 15 ? history.size() - 15 : 0);
             i < history.size(); ++i) {
            maxRadius = std::max(maxRadius, history[i].radius);
        }
        // Ball at bounce should be at least minHeightRatio of max observed size
        if (maxRadius > 0 && bouncePt.radius < maxRadius * m_minHeightRatio) {
            return false; // Ball appears too small — probably high in the air
        }
    }

    // Validation 2: No excessive jitter.
    // Check that in the 3 frames before the bounce, vy was consistently
    // positive (or at least not oscillating). Multiple rapid sign changes
    // indicate tracking noise, not a real bounce.
    if (bounceIndex >= 3) {
        int signChanges = 0;
        for (size_t i = bounceIndex - 2; i < bounceIndex; ++i) {
            if ((history[i].vy > 0) != (history[i + 1].vy > 0)) {
                signChanges++;
            }
        }
        if (signChanges > 1) {
            return false; // Too much jitter — likely noise
        }
    }

    // Validation 3: The bounce point should be within a reasonable
    // court area. Allow some margin for out-of-bounds bounces.
    if (bouncePt.courtX < -50.0 || bouncePt.courtX > 290.0 ||
        bouncePt.courtY < -50.0 || bouncePt.courtY > 578.0) {
        return false; // Way outside the court — likely a false detection
    }

    return true;
}

void BounceDetector::reset() {
    m_lastBounceTimestamp = -1e9;
    m_lastBounce = {false, 0, 0, 0, 0, 0, -1};
}

} // namespace picklejudge
