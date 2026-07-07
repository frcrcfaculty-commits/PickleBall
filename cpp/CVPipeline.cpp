#include "CVPipeline.h"
#include <algorithm>
#include <cmath>

namespace picklejudge {

CVPipeline::CVPipeline(const PipelineConfig& config)
    : m_config(config)
{
    m_morphKernel = cv::getStructuringElement(
        cv::MORPH_ELLIPSE,
        cv::Size(m_config.morphKernelSize, m_config.morphKernelSize)
    );
}

cv::Mat CVPipeline::convertYUVtoBGR(
    const uint8_t* yuvData, int width, int height)
{
    // Create YUV Mat from raw buffer (NV21 format for Android, NV12 for iOS)
    // NV21: Y plane = width*height, UV interleaved = width*height/2
    cv::Mat yuvMat(height + height / 2, width, CV_8UC1, (void*)yuvData);

    // Convert YUV to BGR
    // Use COLOR_YUV2BGR_NV21 for Android, COLOR_YUV2BGR_NV12 for iOS
    // We default to NV21 and provide a compile-time switch
#if defined(__APPLE__)
    cv::cvtColor(yuvMat, m_bgrFrame, cv::COLOR_YUV2BGR_NV12);
#else
    cv::cvtColor(yuvMat, m_bgrFrame, cv::COLOR_YUV2BGR_NV21);
#endif

    return m_bgrFrame;
}

cv::Mat CVPipeline::applyColorFilter(const cv::Mat& frame) {
    // Convert BGR to HSV color space
    cv::cvtColor(frame, m_hsvFrame, cv::COLOR_BGR2HSV);

    // Apply color range threshold to isolate ball pixels
    cv::inRange(
        m_hsvFrame,
        m_config.colorProfile.lowerHSV,
        m_config.colorProfile.upperHSV,
        m_mask
    );

    return m_mask;
}

void CVPipeline::applyMorphology(cv::Mat& mask) {
    // Morphological OPEN: remove small noise particles
    // (erode then dilate)
    cv::morphologyEx(mask, mask, cv::MORPH_OPEN, m_morphKernel);

    // Morphological CLOSE: fill small holes in the ball region
    // (dilate then erode)
    cv::morphologyEx(mask, mask, cv::MORPH_CLOSE, m_morphKernel);

    // Optional: slight dilation to ensure ball edges are captured
    cv::dilate(mask, mask, m_morphKernel, cv::Point(-1, -1), 1);
}

float CVPipeline::computeCircularity(
    const std::vector<cv::Point>& contour)
{
    double area = cv::contourArea(contour);
    double perimeter = cv::arcLength(contour, true);

    if (perimeter < 1e-6) return 0.0f;

    // Circularity: 4π × area / perimeter²
    // Perfect circle = 1.0, square ≈ 0.785, triangle ≈ 0.605
    float circularity = static_cast<float>(
        (4.0 * CV_PI * area) / (perimeter * perimeter));

    return std::min(circularity, 1.0f);
}

std::optional<CVDetectionResult> CVPipeline::findBallCandidate(
    const cv::Mat& mask,
    const cv::Rect& roi)
{
    // Find all contours in the binary mask
    std::vector<std::vector<cv::Point>> contours;
    cv::findContours(mask, contours, cv::RETR_EXTERNAL, cv::CHAIN_APPROX_SIMPLE);

    if (contours.empty()) return std::nullopt;

    // Score each contour as a ball candidate
    struct Candidate {
        float x, y, radius;
        float score;
        int   contourIdx;
    };

    std::vector<Candidate> candidates;

    for (size_t i = 0; i < contours.size(); ++i) {
        float area = static_cast<float>(cv::contourArea(contours[i]));

        // Filter by area
        if (area < m_config.minContourArea || area > m_config.maxContourArea) {
            continue;
        }

        // Compute circularity
        float circularity = computeCircularity(contours[i]);
        if (circularity < m_config.minCircularity) {
            continue;
        }

        // Compute minimum enclosing circle
        cv::Point2f center;
        float radius;
        cv::minEnclosingCircle(contours[i], center, radius);

        // Score: weighted combination of circularity and area appropriateness
        // Ideal ball area ~ π * r² for a ball with r ≈ 10-30 pixels
        float idealArea = CV_PI * radius * radius;
        float fillRatio = area / idealArea; // How well the contour fills its circle
        float score = circularity * 0.4f + fillRatio * 0.3f +
                      std::min(area / 500.0f, 1.0f) * 0.3f;

        // Adjust center coordinates back to full-frame if ROI was used
        float fullX = center.x + (roi.width > 0 ? roi.x : 0);
        float fullY = center.y + (roi.height > 0 ? roi.y : 0);

        candidates.push_back({fullX, fullY, radius, score, (int)i});
    }

    if (candidates.empty()) return std::nullopt;

    // Select the best candidate (highest score)
    auto best = std::max_element(candidates.begin(), candidates.end(),
        [](const Candidate& a, const Candidate& b) {
            return a.score < b.score;
        });

    CVDetectionResult result;
    result.found      = true;
    result.x          = best->x;
    result.y          = best->y;
    result.radius     = best->radius;
    result.confidence = std::min(best->score, 1.0f);
    result.needsTFLiteFallback = (result.confidence < m_config.cvConfidenceThreshold);
    result.roi        = roi;

    return result;
}

CVDetectionResult CVPipeline::processFrame(
    const uint8_t* yuvFrame,
    int width,
    int height,
    const cv::Rect& roi,
    double timestamp)
{
    // Convert YUV to BGR
    cv::Mat bgrFrame = convertYUVtoBGR(yuvFrame, width, height);

    return processMatFrame(bgrFrame, roi, timestamp);
}

CVDetectionResult CVPipeline::processMatFrame(
    const cv::Mat& frame,
    const cv::Rect& roi,
    double timestamp)
{
    CVDetectionResult noResult;
    noResult.found = false;
    noResult.needsTFLiteFallback = true;
    noResult.x = noResult.y = noResult.radius = noResult.confidence = 0;
    noResult.roi = roi;

    if (frame.empty()) return noResult;

    // Apply ROI cropping if available (saves ~85% processing)
    cv::Mat processFrame;
    cv::Rect effectiveROI = roi;

    if (m_config.useROI && roi.width > 0 && roi.height > 0) {
        // Clamp ROI to frame bounds
        effectiveROI.x = std::max(0, std::min(roi.x, frame.cols - 1));
        effectiveROI.y = std::max(0, std::min(roi.y, frame.rows - 1));
        effectiveROI.width = std::min(roi.width, frame.cols - effectiveROI.x);
        effectiveROI.height = std::min(roi.height, frame.rows - effectiveROI.y);

        if (effectiveROI.width < 20 || effectiveROI.height < 20) {
            // ROI too small — process full frame
            processFrame = frame;
            effectiveROI = cv::Rect(0, 0, frame.cols, frame.rows);
        } else {
            processFrame = frame(effectiveROI);
        }
    } else {
        processFrame = frame;
        effectiveROI = cv::Rect(0, 0, frame.cols, frame.rows);
    }

    // Stage 1: Color filtering
    cv::Mat mask = applyColorFilter(processFrame);

    // Stage 2: Morphological cleanup
    applyMorphology(mask);

    // Stage 3: Store debug mask (for dev overlay)
    mask.copyTo(m_debugMask);

    // Stage 4: Find ball candidate
    auto candidate = findBallCandidate(mask, effectiveROI);

    if (candidate.has_value()) {
        return candidate.value();
    }

    return noResult;
}

void CVPipeline::setColorProfile(const ColorProfile& profile) {
    m_config.colorProfile = profile;
}

void CVPipeline::setConfig(const PipelineConfig& config) {
    m_config = config;
    m_morphKernel = cv::getStructuringElement(
        cv::MORPH_ELLIPSE,
        cv::Size(m_config.morphKernelSize, m_config.morphKernelSize)
    );
}

} // namespace picklejudge
