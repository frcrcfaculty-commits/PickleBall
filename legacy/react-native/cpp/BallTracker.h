#pragma once

/**
 * BallTracker.h
 * 
 * Multi-frame Kalman filter tracker for a pickleball moving across the court.
 * State vector: [x, y, vx, vy, ax, ay] — position, velocity, acceleration.
 * Uses a constant-acceleration motion model with adaptive noise based on
 * detection confidence.
 * 
 * The tracker maintains a circular buffer of recent positions with synchronized
 * timestamps for downstream bounce detection analysis.
 */

#include <opencv2/opencv.hpp>
#include <opencv2/video/tracking.hpp>
#include <deque>
#include <optional>

namespace picklejudge {

struct Detection {
    float x;            // Pixel-space centroid X
    float y;            // Pixel-space centroid Y
    float radius;       // Apparent radius in pixels
    float confidence;   // 0.0 - 1.0 detection confidence
    double timestamp;   // Synchronized millisecond timestamp
};

struct TrackPoint {
    double courtX;      // Court-space X coordinate (inches)
    double courtY;      // Court-space Y coordinate (inches)
    double pixelX;      // Original pixel X
    double pixelY;      // Original pixel Y
    double vx;          // Court-space velocity X (inches/ms)
    double vy;          // Court-space velocity Y (inches/ms)
    double ax;          // Court-space acceleration X
    double ay;          // Court-space acceleration Y
    double radius;      // Apparent radius in pixels
    double timestamp;   // Synchronized millisecond timestamp
    double confidence;  // Detection confidence
    bool predicted;     // true if this point is from prediction (no detection)
};

class BallTracker {
public:
    /**
     * @param historySize  Number of recent track points to retain
     * @param maxCoastFrames  Max frames to predict without detection before losing track
     */
    explicit BallTracker(size_t historySize = 30, int maxCoastFrames = 5);
    ~BallTracker() = default;

    /**
     * Update the tracker with a new detection (or lack thereof).
     * 
     * @param detection  Ball detection for this frame, or nullopt if not detected
     * @param timestamp  Synchronized timestamp for this frame
     * @return           Updated track point (may be predicted if no detection)
     */
    std::optional<TrackPoint> update(
        const std::optional<Detection>& detection,
        double timestamp
    );

    /**
     * Get the full track history (circular buffer, oldest first).
     */
    const std::deque<TrackPoint>& getHistory() const { return m_history; }

    /**
     * Check if the tracker is actively tracking a ball.
     */
    bool isTracking() const { return m_tracking; }

    /**
     * Get the predicted position for the next frame (for ROI cropping).
     * 
     * @param futureTimestamp  Timestamp of the expected next frame
     * @return  Predicted pixel position, or nullopt if not tracking
     */
    std::optional<cv::Point2f> predictNextPosition(double futureTimestamp) const;

    /**
     * Get the estimated ROI for the next frame (for efficient processing).
     * Returns a rectangle centered on the predicted position with margin.
     * 
     * @param frameWidth   Full frame width
     * @param frameHeight  Full frame height
     * @param margin       Extra margin around predicted position (pixels)
     */
    cv::Rect getPredictedROI(
        int frameWidth, int frameHeight, int margin = 80) const;

    /**
     * Reset the tracker state.
     */
    void reset();

    /**
     * Get number of consecutive frames without detection.
     */
    int getCoastCount() const { return m_coastCount; }

private:
    // Kalman filter (6-state: x, y, vx, vy, ax, ay)
    cv::KalmanFilter m_kf;
    bool             m_tracking;
    bool             m_initialized;
    int              m_coastCount;
    int              m_maxCoastFrames;
    size_t           m_historySize;
    double           m_lastTimestamp;

    // Track history (circular buffer)
    std::deque<TrackPoint> m_history;

    // Last known state for prediction
    cv::Mat m_lastState;

    /**
     * Initialize the Kalman filter with the first detection.
     */
    void initializeKalman(const Detection& det, double timestamp);

    /**
     * Update the Kalman transition matrix based on the time delta.
     */
    void updateTransitionMatrix(double dt);

    /**
     * Compute adaptive process noise based on ball dynamics.
     */
    void updateProcessNoise(double dt);

    /**
     * Add a track point to the history buffer.
     */
    void addToHistory(const TrackPoint& point);
};

} // namespace picklejudge
