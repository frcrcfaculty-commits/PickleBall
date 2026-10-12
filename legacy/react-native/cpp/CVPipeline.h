#pragma once

/**
 * CVPipeline.h
 * 
 * Main computer vision pipeline for pickleball detection. Processes each
 * camera frame through a multi-stage detection pipeline:
 * 
 * 1. Color filtering (HSV threshold for neon yellow/green ball)
 * 2. Morphological cleanup (remove noise)
 * 3. Contour detection (find circular objects)
 * 4. Candidate ranking (select best ball candidate)
 * 
 * If the OpenCV pipeline fails to find a high-confidence detection,
 * it flags the frame for TFLite fallback inference.
 * 
 * Optimized for mobile: operates on YUV420 input, crops to ROI when
 * a prediction is available, uses NEON-optimized OpenCV operations.
 */

#include <opencv2/opencv.hpp>
#include "BallTracker.h"
#include <optional>
#include <vector>

namespace picklejudge {

// HSV color range for neon yellow/green pickleball
struct ColorProfile {
    cv::Scalar lowerHSV;
    cv::Scalar upperHSV;
    std::string name;
};

// Pre-defined color profiles
namespace ColorProfiles {
    // Outdoor: neon yellow/green (most common)
    static const ColorProfile OUTDOOR_NEON = {
        cv::Scalar(25, 100, 100),    // H: 25, S: 100, V: 100
        cv::Scalar(65, 255, 255),    // H: 65, S: 255, V: 255
        "Outdoor Neon Yellow"
    };

    // Indoor: bright orange
    static const ColorProfile INDOOR_ORANGE = {
        cv::Scalar(5, 150, 150),
        cv::Scalar(25, 255, 255),
        "Indoor Orange"
    };

    // Indoor: white (challenging — high V, low S)
    static const ColorProfile INDOOR_WHITE = {
        cv::Scalar(0, 0, 200),
        cv::Scalar(180, 40, 255),
        "Indoor White"
    };
}

struct PipelineConfig {
    ColorProfile colorProfile = ColorProfiles::OUTDOOR_NEON;
    float minContourArea       = 50.0f;    // Min area in pixels² 
    float maxContourArea       = 5000.0f;  // Max area in pixels²
    float minCircularity       = 0.6f;     // 1.0 = perfect circle
    float cvConfidenceThreshold = 0.7f;    // Below this → fall back to TFLite
    int   morphKernelSize      = 5;        // Morphological operation kernel
    bool  useROI               = true;     // Enable ROI cropping optimization
};

struct CVDetectionResult {
    bool found;                 // Was a ball candidate found?
    float x;                   // Centroid X in full-frame pixel coordinates
    float y;                   // Centroid Y in full-frame pixel coordinates
    float radius;              // Estimated radius in pixels
    float confidence;          // Detection confidence (0.0 - 1.0)
    bool needsTFLiteFallback;  // Should TFLite model be invoked?
    cv::Rect roi;              // The ROI that was actually processed
};

class CVPipeline {
public:
    explicit CVPipeline(const PipelineConfig& config = PipelineConfig());
    ~CVPipeline() = default;

    /**
     * Process a single frame from the camera.
     * 
     * @param yuvFrame     Raw YUV420 frame data from camera
     * @param width        Frame width in pixels
     * @param height       Frame height in pixels
     * @param roi          Region of interest to process (empty = full frame)
     * @param timestamp    Synchronized timestamp for this frame
     * @return             Detection result
     */
    CVDetectionResult processFrame(
        const uint8_t* yuvFrame,
        int width,
        int height,
        const cv::Rect& roi = cv::Rect(),
        double timestamp = 0.0
    );

    /**
     * Process an already-converted BGR/RGB cv::Mat frame.
     * Used when VisionCamera provides a Mat directly.
     */
    CVDetectionResult processMatFrame(
        const cv::Mat& frame,
        const cv::Rect& roi = cv::Rect(),
        double timestamp = 0.0
    );

    /**
     * Update the color profile (e.g., switching from outdoor to indoor ball).
     */
    void setColorProfile(const ColorProfile& profile);

    /**
     * Update pipeline configuration.
     */
    void setConfig(const PipelineConfig& config);

    /**
     * Get current configuration.
     */
    const PipelineConfig& getConfig() const { return m_config; }

    /**
     * Get the last processed frame's debug visualization (for dev overlay).
     * Returns the HSV mask with detected contours drawn.
     */
    const cv::Mat& getDebugMask() const { return m_debugMask; }

private:
    PipelineConfig m_config;

    // Pre-allocated matrices to avoid per-frame heap allocation
    cv::Mat m_hsvFrame;
    cv::Mat m_mask;
    cv::Mat m_morphKernel;
    cv::Mat m_debugMask;
    cv::Mat m_bgrFrame;     // Converted from YUV
    cv::Mat m_roiFrame;     // Cropped ROI

    /**
     * Convert YUV420 (NV21/NV12) raw buffer to BGR cv::Mat.
     */
    cv::Mat convertYUVtoBGR(const uint8_t* yuvData, int width, int height);

    /**
     * Apply HSV color filtering to isolate ball pixels.
     */
    cv::Mat applyColorFilter(const cv::Mat& frame);

    /**
     * Apply morphological operations to clean up the binary mask.
     */
    void applyMorphology(cv::Mat& mask);

    /**
     * Find and rank ball candidates from the filtered mask.
     * Returns the best candidate, or nullopt if none qualify.
     */
    std::optional<CVDetectionResult> findBallCandidate(
        const cv::Mat& mask,
        const cv::Rect& roi
    );

    /**
     * Compute circularity of a contour (4π × area / perimeter²).
     */
    static float computeCircularity(const std::vector<cv::Point>& contour);
};

} // namespace picklejudge
