#include "BallTracker.h"
#include <cmath>
#include <algorithm>

namespace picklejudge {

BallTracker::BallTracker(size_t historySize, int maxCoastFrames)
    : m_kf(6, 4, 0)  // 6 state vars, 4 measurement vars, 0 control vars
    , m_tracking(false)
    , m_initialized(false)
    , m_coastCount(0)
    , m_maxCoastFrames(maxCoastFrames)
    , m_historySize(historySize)
    , m_lastTimestamp(0.0)
{
}

void BallTracker::initializeKalman(const Detection& det, double timestamp) {
    // State vector: [x, y, vx, vy, ax, ay]
    // Measurement: [x, y, radius, confidence]

    // Measurement matrix H: maps state to measurement
    // We observe x, y directly; radius and confidence are auxiliary
    m_kf.measurementMatrix = cv::Mat::zeros(4, 6, CV_32F);
    m_kf.measurementMatrix.at<float>(0, 0) = 1.0f; // x
    m_kf.measurementMatrix.at<float>(1, 1) = 1.0f; // y
    // radius and confidence don't map to state directly
    // but we include them in measurement for record keeping

    // Initial state
    m_kf.statePost = cv::Mat::zeros(6, 1, CV_32F);
    m_kf.statePost.at<float>(0) = det.x;   // x
    m_kf.statePost.at<float>(1) = det.y;   // y
    m_kf.statePost.at<float>(2) = 0.0f;    // vx (unknown initially)
    m_kf.statePost.at<float>(3) = 0.0f;    // vy (unknown initially)
    m_kf.statePost.at<float>(4) = 0.0f;    // ax
    m_kf.statePost.at<float>(5) = 0.0f;    // ay

    // Error covariance — high initial uncertainty for velocity/acceleration
    m_kf.errorCovPost = cv::Mat::eye(6, 6, CV_32F);
    m_kf.errorCovPost.at<float>(0, 0) = 1.0f;    // x position: low uncertainty
    m_kf.errorCovPost.at<float>(1, 1) = 1.0f;    // y position: low uncertainty
    m_kf.errorCovPost.at<float>(2, 2) = 100.0f;  // vx: high uncertainty
    m_kf.errorCovPost.at<float>(3, 3) = 100.0f;  // vy: high uncertainty
    m_kf.errorCovPost.at<float>(4, 4) = 500.0f;  // ax: very high uncertainty
    m_kf.errorCovPost.at<float>(5, 5) = 500.0f;  // ay: very high uncertainty

    // Measurement noise — depends on detection confidence
    m_kf.measurementNoiseCov = cv::Mat::eye(4, 4, CV_32F);
    float noise = std::max(1.0f, 5.0f * (1.0f - det.confidence));
    m_kf.measurementNoiseCov.at<float>(0, 0) = noise; // x noise
    m_kf.measurementNoiseCov.at<float>(1, 1) = noise; // y noise
    m_kf.measurementNoiseCov.at<float>(2, 2) = 10.0f; // radius noise
    m_kf.measurementNoiseCov.at<float>(3, 3) = 1.0f;  // confidence noise

    m_lastTimestamp = timestamp;
    m_initialized = true;
    m_tracking = true;
    m_coastCount = 0;
}

void BallTracker::updateTransitionMatrix(double dt) {
    // Constant acceleration model:
    // x_new  = x + vx*dt + 0.5*ax*dt²
    // vx_new = vx + ax*dt
    // ax_new = ax (constant within frame)
    //
    // Transition matrix F:
    // [1  0  dt  0  0.5dt²  0     ]
    // [0  1  0   dt 0       0.5dt²]
    // [0  0  1   0  dt      0     ]
    // [0  0  0   1  0       dt    ]
    // [0  0  0   0  1       0     ]
    // [0  0  0   0  0       1     ]

    float dtf = static_cast<float>(dt);
    float dt2 = 0.5f * dtf * dtf;

    m_kf.transitionMatrix = cv::Mat::eye(6, 6, CV_32F);
    m_kf.transitionMatrix.at<float>(0, 2) = dtf;  // x += vx*dt
    m_kf.transitionMatrix.at<float>(1, 3) = dtf;  // y += vy*dt
    m_kf.transitionMatrix.at<float>(0, 4) = dt2;  // x += 0.5*ax*dt²
    m_kf.transitionMatrix.at<float>(1, 5) = dt2;  // y += 0.5*ay*dt²
    m_kf.transitionMatrix.at<float>(2, 4) = dtf;  // vx += ax*dt
    m_kf.transitionMatrix.at<float>(3, 5) = dtf;  // vy += ay*dt
}

void BallTracker::updateProcessNoise(double dt) {
    // Process noise Q — models uncertainty in the motion model.
    // Higher noise allows the filter to react faster to sudden changes
    // (like a bounce), but increases jitter during smooth flight.
    float dtf = static_cast<float>(dt);
    float q_pos  = 0.5f * dtf * dtf;
    float q_vel  = dtf;
    float q_acc  = 1.0f;

    // Scale noise — a pickleball can change direction rapidly on bounce
    float accelNoise = 50.0f; // Tunable: higher = more responsive to bounces

    m_kf.processNoiseCov = cv::Mat::zeros(6, 6, CV_32F);
    m_kf.processNoiseCov.at<float>(0, 0) = q_pos * q_pos * accelNoise;
    m_kf.processNoiseCov.at<float>(1, 1) = q_pos * q_pos * accelNoise;
    m_kf.processNoiseCov.at<float>(2, 2) = q_vel * q_vel * accelNoise;
    m_kf.processNoiseCov.at<float>(3, 3) = q_vel * q_vel * accelNoise;
    m_kf.processNoiseCov.at<float>(4, 4) = q_acc * q_acc * accelNoise;
    m_kf.processNoiseCov.at<float>(5, 5) = q_acc * q_acc * accelNoise;
}

std::optional<TrackPoint> BallTracker::update(
    const std::optional<Detection>& detection,
    double timestamp)
{
    // First detection: initialize the filter
    if (!m_initialized) {
        if (!detection.has_value()) {
            return std::nullopt; // Nothing to track yet
        }
        initializeKalman(detection.value(), timestamp);

        TrackPoint tp;
        tp.pixelX     = detection->x;
        tp.pixelY     = detection->y;
        tp.courtX     = 0.0; // Will be set by pipeline after homography
        tp.courtY     = 0.0;
        tp.vx         = 0.0;
        tp.vy         = 0.0;
        tp.ax         = 0.0;
        tp.ay         = 0.0;
        tp.radius     = detection->radius;
        tp.timestamp  = timestamp;
        tp.confidence = detection->confidence;
        tp.predicted  = false;
        addToHistory(tp);
        return tp;
    }

    // Compute time delta
    double dt = timestamp - m_lastTimestamp;
    if (dt <= 0.0) dt = 1.0; // Fallback: assume 1ms
    m_lastTimestamp = timestamp;

    // Update transition matrix for this time step
    updateTransitionMatrix(dt);
    updateProcessNoise(dt);

    // PREDICT step
    cv::Mat prediction = m_kf.predict();

    TrackPoint tp;
    tp.timestamp = timestamp;

    if (detection.has_value()) {
        // CORRECT step: fuse detection with prediction
        cv::Mat measurement = cv::Mat::zeros(4, 1, CV_32F);
        measurement.at<float>(0) = detection->x;
        measurement.at<float>(1) = detection->y;
        measurement.at<float>(2) = detection->radius;
        measurement.at<float>(3) = detection->confidence;

        // Adaptive measurement noise: lower confidence = higher noise
        float noise = std::max(1.0f, 8.0f * (1.0f - detection->confidence));
        m_kf.measurementNoiseCov.at<float>(0, 0) = noise;
        m_kf.measurementNoiseCov.at<float>(1, 1) = noise;

        cv::Mat corrected = m_kf.correct(measurement);

        tp.pixelX     = corrected.at<float>(0);
        tp.pixelY     = corrected.at<float>(1);
        tp.vx         = corrected.at<float>(2);
        tp.vy         = corrected.at<float>(3);
        tp.ax         = corrected.at<float>(4);
        tp.ay         = corrected.at<float>(5);
        tp.radius     = detection->radius;
        tp.confidence = detection->confidence;
        tp.predicted  = false;

        m_coastCount = 0;
        m_tracking = true;
    } else {
        // No detection: coast on prediction
        m_coastCount++;

        if (m_coastCount > m_maxCoastFrames) {
            // Lost track
            m_tracking = false;
            m_initialized = false;
            m_history.clear();
            return std::nullopt;
        }

        tp.pixelX     = prediction.at<float>(0);
        tp.pixelY     = prediction.at<float>(1);
        tp.vx         = prediction.at<float>(2);
        tp.vy         = prediction.at<float>(3);
        tp.ax         = prediction.at<float>(4);
        tp.ay         = prediction.at<float>(5);
        tp.radius     = m_history.empty() ? 10.0 : m_history.back().radius;
        tp.confidence = 0.0;
        tp.predicted  = true;

        m_tracking = true;
    }

    // Court coordinates are set externally by the pipeline
    // after homography transform
    tp.courtX = 0.0;
    tp.courtY = 0.0;

    m_lastState = m_kf.statePost.clone();
    addToHistory(tp);
    return tp;
}

std::optional<cv::Point2f> BallTracker::predictNextPosition(
    double futureTimestamp) const
{
    if (!m_tracking || m_history.empty()) {
        return std::nullopt;
    }

    const auto& last = m_history.back();
    double dt = futureTimestamp - last.timestamp;
    if (dt <= 0) dt = 8.33; // Default ~120fps interval

    // Simple kinematic prediction
    float px = static_cast<float>(
        last.pixelX + last.vx * dt + 0.5 * last.ax * dt * dt);
    float py = static_cast<float>(
        last.pixelY + last.vy * dt + 0.5 * last.ay * dt * dt);

    return cv::Point2f(px, py);
}

cv::Rect BallTracker::getPredictedROI(
    int frameWidth, int frameHeight, int margin) const
{
    auto pred = predictNextPosition(m_lastTimestamp + 8.33); // ~120fps
    if (!pred.has_value()) {
        // No prediction: return full frame
        return cv::Rect(0, 0, frameWidth, frameHeight);
    }

    // ROI centered on predicted position
    float r = m_history.empty() ? 30.0f :
              static_cast<float>(m_history.back().radius) + margin;

    int x = std::max(0, static_cast<int>(pred->x - r));
    int y = std::max(0, static_cast<int>(pred->y - r));
    int w = std::min(static_cast<int>(2 * r), frameWidth - x);
    int h = std::min(static_cast<int>(2 * r), frameHeight - y);

    return cv::Rect(x, y, w, h);
}

void BallTracker::addToHistory(const TrackPoint& point) {
    m_history.push_back(point);
    if (m_history.size() > m_historySize) {
        m_history.pop_front();
    }
}

void BallTracker::reset() {
    m_tracking = false;
    m_initialized = false;
    m_coastCount = 0;
    m_lastTimestamp = 0.0;
    m_history.clear();
    m_kf = cv::KalmanFilter(6, 4, 0);
}

} // namespace picklejudge
