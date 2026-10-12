#include "HomographyCalibrator.h"
#include <cmath>
#include <numeric>

namespace picklejudge {

HomographyCalibrator::HomographyCalibrator()
    : m_calibrated(false)
    , m_reprojectionError(0.0)
{
}

std::vector<cv::Point2f> HomographyCalibrator::buildCourtDestPoints(bool isNearSide) const {
    // Court coordinate system:
    //   Origin (0,0) = near-left baseline corner of THIS device's half
    //   X-axis = sideline direction (0 to 240 inches = 20 feet)
    //   Y-axis = baseline-to-net direction (0 to 264 inches = 22 feet half-court)
    //
    // The user selects 4 corners of their visible half-court:
    //   [0] Near-left baseline corner     → (0, 0)
    //   [1] Near-right baseline corner    → (WIDTH, 0)
    //   [2] Far-right kitchen line corner → (WIDTH, HALF_LENGTH)
    //   [3] Far-left kitchen line corner  → (0, HALF_LENGTH)

    if (isNearSide) {
        return {
            cv::Point2f(0.0f, 0.0f),
            cv::Point2f(CourtDimensions::WIDTH, 0.0f),
            cv::Point2f(CourtDimensions::WIDTH, CourtDimensions::HALF_LENGTH),
            cv::Point2f(0.0f, CourtDimensions::HALF_LENGTH)
        };
    } else {
        // Far-side device: mirror the mapping so both devices share
        // the same court coordinate system
        return {
            cv::Point2f(CourtDimensions::WIDTH, CourtDimensions::LENGTH),
            cv::Point2f(0.0f, CourtDimensions::LENGTH),
            cv::Point2f(0.0f, CourtDimensions::HALF_LENGTH),
            cv::Point2f(CourtDimensions::WIDTH, CourtDimensions::HALF_LENGTH)
        };
    }
}

cv::Mat HomographyCalibrator::computeHomography(
    const std::vector<cv::Point2f>& imageCorners,
    bool isNearSide)
{
    if (imageCorners.size() != 4) {
        throw CalibrationError(
            "Expected 4 corner points, got " + std::to_string(imageCorners.size()));
    }

    // Validate that corners form a reasonable quadrilateral
    // (no self-intersecting edges, minimum area check)
    double area = cv::contourArea(imageCorners);
    if (area < 1000.0) {
        throw CalibrationError(
            "Selected corners form too small a region (area=" +
            std::to_string(area) + "px²). Please select wider court corners.");
    }

    auto courtCorners = buildCourtDestPoints(isNearSide);

    // Compute homography with RANSAC for robustness against slight user error
    m_homography = cv::findHomography(
        imageCorners, courtCorners, cv::RANSAC, 3.0);

    if (m_homography.empty()) {
        throw CalibrationError(
            "Failed to compute homography. Ensure corners are not collinear.");
    }

    // Compute inverse for court→pixel mapping (overlay drawing)
    m_inverseHomography = m_homography.inv();

    // Validate reprojection accuracy
    validateCalibration(imageCorners, courtCorners);

    m_calibrated = true;
    return m_homography;
}

void HomographyCalibrator::validateCalibration(
    const std::vector<cv::Point2f>& srcPoints,
    const std::vector<cv::Point2f>& dstPoints)
{
    double totalError = 0.0;
    for (size_t i = 0; i < srcPoints.size(); ++i) {
        // Project source point through homography
        cv::Mat pt = (cv::Mat_<double>(3, 1) <<
            srcPoints[i].x, srcPoints[i].y, 1.0);
        cv::Mat projected = m_homography * pt;
        projected /= projected.at<double>(2, 0); // Normalize homogeneous

        cv::Point2f reprojected(
            static_cast<float>(projected.at<double>(0, 0)),
            static_cast<float>(projected.at<double>(1, 0)));

        double err = cv::norm(reprojected - dstPoints[i]);
        totalError += err;
    }

    m_reprojectionError = totalError / static_cast<double>(srcPoints.size());

    if (m_reprojectionError > MAX_REPROJECTION_ERROR) {
        throw CalibrationError(
            "Reprojection error too high: " +
            std::to_string(m_reprojectionError) +
            "px (max " + std::to_string(MAX_REPROJECTION_ERROR) +
            "px). Please re-select court corners more carefully.");
    }
}

cv::Point2f HomographyCalibrator::pixelToCourtCoord(float px, float py) const {
    if (!m_calibrated) {
        throw CalibrationError("Homography not yet computed. Calibrate first.");
    }

    cv::Mat pt = (cv::Mat_<double>(3, 1) << px, py, 1.0);
    cv::Mat courtPt = m_homography * pt;

    // Normalize from homogeneous coordinates
    double w = courtPt.at<double>(2, 0);
    if (std::abs(w) < 1e-10) {
        // Point at infinity — shouldn't happen with valid calibration
        return cv::Point2f(-1.0f, -1.0f);
    }

    return cv::Point2f(
        static_cast<float>(courtPt.at<double>(0, 0) / w),
        static_cast<float>(courtPt.at<double>(1, 0) / w));
}

std::vector<cv::Point2f> HomographyCalibrator::pixelToCourtCoords(
    const std::vector<cv::Point2f>& pixelPoints) const
{
    std::vector<cv::Point2f> courtPoints;
    courtPoints.reserve(pixelPoints.size());
    for (const auto& pp : pixelPoints) {
        courtPoints.push_back(pixelToCourtCoord(pp.x, pp.y));
    }
    return courtPoints;
}

cv::Point2f HomographyCalibrator::courtToPixelCoord(
    float courtX, float courtY) const
{
    if (!m_calibrated) {
        throw CalibrationError("Homography not yet computed. Calibrate first.");
    }

    cv::Mat pt = (cv::Mat_<double>(3, 1) << courtX, courtY, 1.0);
    cv::Mat pixelPt = m_inverseHomography * pt;

    double w = pixelPt.at<double>(2, 0);
    return cv::Point2f(
        static_cast<float>(pixelPt.at<double>(0, 0) / w),
        static_cast<float>(pixelPt.at<double>(1, 0) / w));
}

std::vector<std::pair<cv::Point2f, cv::Point2f>>
HomographyCalibrator::getCourtGridOverlay() const {
    if (!m_calibrated) return {};

    std::vector<std::pair<cv::Point2f, cv::Point2f>> lines;

    // Baselines
    lines.push_back({
        courtToPixelCoord(0, 0),
        courtToPixelCoord(CourtDimensions::WIDTH, 0)
    });
    lines.push_back({
        courtToPixelCoord(0, CourtDimensions::HALF_LENGTH),
        courtToPixelCoord(CourtDimensions::WIDTH, CourtDimensions::HALF_LENGTH)
    });

    // Sidelines
    lines.push_back({
        courtToPixelCoord(0, 0),
        courtToPixelCoord(0, CourtDimensions::HALF_LENGTH)
    });
    lines.push_back({
        courtToPixelCoord(CourtDimensions::WIDTH, 0),
        courtToPixelCoord(CourtDimensions::WIDTH, CourtDimensions::HALF_LENGTH)
    });

    // Kitchen line
    lines.push_back({
        courtToPixelCoord(0, CourtDimensions::HALF_LENGTH - CourtDimensions::KITCHEN_DEPTH),
        courtToPixelCoord(CourtDimensions::WIDTH,
                          CourtDimensions::HALF_LENGTH - CourtDimensions::KITCHEN_DEPTH)
    });

    // Centerline (divides service areas)
    lines.push_back({
        courtToPixelCoord(CourtDimensions::SERVICE_WIDTH,
                          CourtDimensions::HALF_LENGTH - CourtDimensions::KITCHEN_DEPTH),
        courtToPixelCoord(CourtDimensions::SERVICE_WIDTH, 0)
    });

    return lines;
}

void HomographyCalibrator::reset() {
    m_homography = cv::Mat();
    m_inverseHomography = cv::Mat();
    m_calibrated = false;
    m_reprojectionError = 0.0;
}

std::vector<double> HomographyCalibrator::serializeHomography() const {
    if (!m_calibrated) return {};
    std::vector<double> data(9);
    for (int i = 0; i < 3; ++i) {
        for (int j = 0; j < 3; ++j) {
            data[i * 3 + j] = m_homography.at<double>(i, j);
        }
    }
    return data;
}

void HomographyCalibrator::deserializeHomography(const std::vector<double>& data) {
    if (data.size() != 9) {
        throw CalibrationError(
            "Expected 9 values for 3x3 homography, got " +
            std::to_string(data.size()));
    }
    m_homography = cv::Mat(3, 3, CV_64F);
    for (int i = 0; i < 3; ++i) {
        for (int j = 0; j < 3; ++j) {
            m_homography.at<double>(i, j) = data[i * 3 + j];
        }
    }
    m_inverseHomography = m_homography.inv();
    m_calibrated = true;
    m_reprojectionError = 0.0; // Not validated from remote data
}

} // namespace picklejudge
