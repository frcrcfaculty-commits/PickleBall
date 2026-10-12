#include "BallDetectorV2.hpp"
#include <cmath>

namespace pbj {

void BallDetectorV2::setHomography(const cv::Matx33d& H, double ballDiameterM) {
    m_Hinv = H.inv();
    m_ballDiameterM = ballDiameterM;
    m_haveH = true;
    m_radiusLut.clear();
    m_lutH = 0;
}

float BallDetectorV2::expectedRadiusAtRow(float vFull) const {
    if (!m_haveH) return 0.f;
    const int bin = std::max(0, static_cast<int>(vFull) / 8);
    if (bin < static_cast<int>(m_radiusLut.size()) && m_radiusLut[bin] > 0)
        return m_radiusLut[bin];

    // Back-project the image point (image centre column, this row) to the
    // ground plane; step one ball diameter in court X; re-project; the pixel
    // distance is the ball's apparent DIAMETER at that row.
    const double u = 0.0; // column cancels for a well-behaved H; use 0 offset
    auto toCourt = [&](double px, double py, double& X, double& Y) -> bool {
        cv::Vec3d q = m_Hinv * cv::Vec3d(px, py, 1.0);
        if (std::fabs(q[2]) < 1e-12) return false;
        X = q[0] / q[2]; Y = q[1] / q[2];
        return true;
    };
    cv::Matx33d H = m_Hinv.inv();
    auto toPixel = [&](double X, double Y, double& px, double& py) -> bool {
        cv::Vec3d q = H * cv::Vec3d(X, Y, 1.0);
        if (std::fabs(q[2]) < 1e-12) return false;
        px = q[0] / q[2]; py = q[1] / q[2];
        return true;
    };

    double X, Y, p2x, p2y;
    float r = 0.f;
    if (toCourt(u, vFull, X, Y) && toPixel(X + m_ballDiameterM, Y, p2x, p2y)) {
        const double dx = p2x - u, dy = p2y - vFull;
        r = static_cast<float>(0.5 * std::sqrt(dx * dx + dy * dy));
    }
    if (bin >= static_cast<int>(m_radiusLut.size())) m_radiusLut.resize(bin + 1, 0.f);
    m_radiusLut[bin] = r;
    return r;
}

std::optional<BallDetection> BallDetectorV2::searchMask(
        const cv::Mat& mask, const cv::Mat& bgrSmall, const cv::Mat& bgr,
        cv::Rect roiSmall) const {
    const int S = m_cfg.downscale;
    cv::Mat sub = mask(roiSmall);

    std::vector<std::vector<cv::Point>> contours;
    cv::findContours(sub, contours, cv::RETR_EXTERNAL, cv::CHAIN_APPROX_SIMPLE);
    if (contours.empty()) return std::nullopt;

    double bestScore = 0;
    BallDetection best;

    for (const auto& c : contours) {
        const double area = cv::contourArea(c);
        if (area < m_cfg.minAreaPx) continue;
        const double peri = cv::arcLength(c, true);
        if (peri < 1e-6) continue;

        const double circ = 4.0 * CV_PI * area / (peri * peri);
        if (circ < m_cfg.minCircularity) continue;

        cv::Point2f ctr; float rad;
        cv::minEnclosingCircle(c, ctr, rad);
        if (rad < 0.5f) continue;
        const double fill = area / (CV_PI * rad * rad);
        if (fill < m_cfg.minFillRatio) continue;

        // Back to full-resolution coordinates.
        const float uFull = (ctr.x + roiSmall.x) * S;
        const float vFull = (ctr.y + roiSmall.y) * S;
        const float rFull = rad * S;

        // SCALE PRIOR — the strongest false-positive filter.
        double scaleScore = 1.0;
        const float rExp = expectedRadiusAtRow(vFull);
        if (rExp > 0.5f) {
            const double ratio = rFull / rExp;
            if (ratio > m_cfg.scaleTolerance || ratio < 1.0 / m_cfg.scaleTolerance)
                continue;
            scaleScore = 1.0 / (1.0 + std::fabs(std::log(ratio)));
        }

        const double s = 0.40 * circ + 0.25 * fill + 0.35 * scaleScore;
        if (s <= bestScore) continue;
        bestScore = s;
        best = {uFull, vFull, rFull, static_cast<float>(std::min(1.0, s))};
    }
    if (bestScore <= 0) return std::nullopt;

    // Sub-pixel refinement at FULL resolution: intensity-weighted centroid of
    // the colour mask inside a tight ROI. Worth ~0.3 px, which at 4K is ~2 mm
    // of court distance — the same order as the whole fusion improvement.
    const int pad = static_cast<int>(std::ceil(best.radiusPx * 1.6f)) + 2;
    cv::Rect full(cv::Point(static_cast<int>(best.u) - pad,
                            static_cast<int>(best.v) - pad),
                  cv::Size(2 * pad, 2 * pad));
    full &= cv::Rect(0, 0, bgr.cols, bgr.rows);
    if (full.width > 3 && full.height > 3) {
        cv::Mat hsv, m;
        cv::cvtColor(bgr(full), hsv, cv::COLOR_BGR2HSV);
        cv::inRange(hsv, m_cfg.lowerHSV, m_cfg.upperHSV, m);
        cv::Moments mo = cv::moments(m, true);
        if (mo.m00 > 1.0) {
            best.u = static_cast<float>(full.x + mo.m10 / mo.m00);
            best.v = static_cast<float>(full.y + mo.m01 / mo.m00);
            best.radiusPx = static_cast<float>(std::sqrt(mo.m00 / CV_PI));
        }
    }
    return best;
}

std::optional<BallDetection> BallDetectorV2::detect(
        const cv::Mat& bgr, const cv::Point2f* predicted, float predRadius) {
    const int S = m_cfg.downscale;
    cv::Mat small;
    cv::resize(bgr, small, cv::Size(bgr.cols / S, bgr.rows / S), 0, 0,
               cv::INTER_AREA);
    cv::cvtColor(small, m_graySmall, cv::COLOR_BGR2GRAY);

    // --- 1. MOTION GATE ---------------------------------------------------
    if (m_bg.empty()) {
        m_graySmall.convertTo(m_bg, CV_32F);
        m_frames = 1;
        return std::nullopt; // no motion evidence on the very first frame
    }
    cv::Mat bg8;
    m_bg.convertTo(bg8, CV_8U);
    cv::absdiff(m_graySmall, bg8, m_diff);
    cv::threshold(m_diff, m_motionMask, m_cfg.motionThresh, 255, cv::THRESH_BINARY);
    // Dilate so the ball's mask survives partial background overlap.
    static const cv::Mat k = cv::getStructuringElement(cv::MORPH_ELLIPSE, {3, 3});
    cv::dilate(m_motionMask, m_motionMask, k);

    // Update the background model. The ball is fast, so it never bakes in;
    // players standing still DO bake in, which is exactly what we want.
    cv::accumulateWeighted(m_graySmall, m_bg, m_cfg.bgAlpha);
    ++m_frames;
    if (m_frames < 8) return std::nullopt; // let the model settle

    // --- 2. COLOUR (tiebreaker, ANDed — never a gate on its own) ----------
    cv::cvtColor(small, m_hsvSmall, cv::COLOR_BGR2HSV);
    cv::inRange(m_hsvSmall, m_cfg.lowerHSV, m_cfg.upperHSV, m_colorMask);
    cv::bitwise_and(m_motionMask, m_colorMask, m_mask);

    // --- 3. PREDICTED ROI FIRST, THEN FULL FRAME --------------------------
    const cv::Rect frameRoi(0, 0, m_mask.cols, m_mask.rows);
    if (predicted && predRadius > 0.5f) {
        const int pad = static_cast<int>(m_cfg.roiPadFactor * predRadius / S) + 6;
        cv::Rect roi(cv::Point(static_cast<int>(predicted->x / S) - pad,
                               static_cast<int>(predicted->y / S) - pad),
                     cv::Size(2 * pad, 2 * pad));
        roi &= frameRoi;
        if (roi.width > 3 && roi.height > 3) {
            auto hit = searchMask(m_mask, small, bgr, roi);
            if (hit) return hit;
        }
    }
    return searchMask(m_mask, small, bgr, frameRoi);
}

} // namespace pbj
