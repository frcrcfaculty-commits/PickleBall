#pragma once

/**
 * HomographyCalibrator.h
 * 
 * Computes and manages the perspective transform (homography matrix) that maps
 * pixel coordinates from the camera's skewed 3D view to a standardized 2D
 * flat court coordinate system.
 * 
 * The user selects 4 court corners in the camera image. These are mapped to
 * the official pickleball court dimensions (20ft x 44ft) to produce a 3x3
 * homography matrix H such that:
 *   courtPoint = H * pixelPoint  (in homogeneous coordinates)
 */

#include <opencv2/opencv.hpp>
#include <vector>
#include <string>
#include <stdexcept>

namespace picklejudge {

// Official pickleball court dimensions in inches
struct CourtDimensions {
    static constexpr float WIDTH          = 240.0f;   // 20 feet
    static constexpr float LENGTH         = 528.0f;   // 44 feet
    static constexpr float HALF_LENGTH    = 264.0f;   // 22 feet (net to baseline)
    static constexpr float KITCHEN_DEPTH  = 84.0f;    // 7 feet from net
    static constexpr float SERVICE_WIDTH  = 120.0f;   // 10 feet (half court width)
    static constexpr float SERVICE_DEPTH  = 180.0f;   // 15 feet
    static constexpr float LINE_WIDTH     = 2.0f;     // 2 inches
    static constexpr float BALL_DIAMETER  = 2.874f;   // Outdoor ball
    static constexpr float BALL_RADIUS    = 1.437f;   // Half diameter
};

class CalibrationError : public std::runtime_error {
public:
    explicit CalibrationError(const std::string& msg)
        : std::runtime_error(msg) {}
};

class HomographyCalibrator {
public:
    HomographyCalibrator();
    ~HomographyCalibrator() = default;

    /**
     * Compute the homography matrix from 4 user-selected image corners.
     * 
     * @param imageCorners  4 pixel coordinates, ordered:
     *                      [0] Near-left baseline corner
     *                      [1] Near-right baseline corner
     *                      [2] Far-right kitchen line corner
     *                      [3] Far-left kitchen line corner
     * @param isNearSide    true if this device covers the near half-court
     *                      (baseline to net); affects destination mapping
     * @return              3x3 homography matrix (double)
     * @throws CalibrationError if reprojection error exceeds threshold
     */
    cv::Mat computeHomography(
        const std::vector<cv::Point2f>& imageCorners,
        bool isNearSide = true
    );

    /**
     * Transform a pixel coordinate to court-space using the stored homography.
     * 
     * @param px  Pixel X coordinate
     * @param py  Pixel Y coordinate
     * @return    Court coordinate in inches from near-left baseline origin
     */
    cv::Point2f pixelToCourtCoord(float px, float py) const;

    /**
     * Batch transform multiple pixel points to court-space.
     */
    std::vector<cv::Point2f> pixelToCourtCoords(
        const std::vector<cv::Point2f>& pixelPoints
    ) const;

    /**
     * Transform a court coordinate back to pixel space (for overlay drawing).
     */
    cv::Point2f courtToPixelCoord(float courtX, float courtY) const;

    /**
     * Check if the homography has been computed and is valid.
     */
    bool isCalibrated() const { return m_calibrated; }

    /**
     * Get the computed homography matrix.
     */
    const cv::Mat& getHomography() const { return m_homography; }

    /**
     * Get the inverse homography matrix (court → pixel).
     */
    const cv::Mat& getInverseHomography() const { return m_inverseHomography; }

    /**
     * Get reprojection error in pixels from last calibration.
     */
    double getReprojectionError() const { return m_reprojectionError; }

    /**
     * Generate a grid of court lines in pixel-space for overlay visualization.
     * Returns pairs of points (line segments) to draw on the camera preview.
     */
    std::vector<std::pair<cv::Point2f, cv::Point2f>> getCourtGridOverlay() const;

    /**
     * Reset calibration state.
     */
    void reset();

    /**
     * Serialize homography to a flat array (for sending over DataChannel).
     */
    std::vector<double> serializeHomography() const;

    /**
     * Deserialize homography from a flat array.
     */
    void deserializeHomography(const std::vector<double>& data);

private:
    static constexpr double MAX_REPROJECTION_ERROR = 3.0; // pixels

    cv::Mat m_homography;         // 3x3 pixel → court transform
    cv::Mat m_inverseHomography;  // 3x3 court → pixel transform
    bool    m_calibrated;
    double  m_reprojectionError;

    /**
     * Build destination court points based on which half-court this device covers.
     */
    std::vector<cv::Point2f> buildCourtDestPoints(bool isNearSide) const;

    /**
     * Validate reprojection accuracy.
     */
    void validateCalibration(
        const std::vector<cv::Point2f>& srcPoints,
        const std::vector<cv::Point2f>& dstPoints
    );
};

} // namespace picklejudge
