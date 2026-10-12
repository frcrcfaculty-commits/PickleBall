// BallDetectorV2.hpp — motion-gated ball detection.
//
// WHY THE COLOR-ONLY DETECTOR CANNOT SHIP
// ---------------------------------------
// CVPipeline.cpp thresholds HSV and picks the roundest contour. On a real
// court that fires on: yellow/green painted lines (same hue as the ball),
// bright shirts and shoes, sun glare on wet paint, balls on adjacent courts,
// and the paddle's edge guard. A perfect geometry engine fed one false
// detection emits a confident wrong call — the worst possible failure for
// this product. Color is a WEAK cue. The strong cues are:
//
//   1. MOTION. The ball is the only small, fast, round thing in the scene.
//      Lines never move. Shirts move slowly and are large. A running-mean
//      background model + frame differencing kills ~95% of color false
//      positives at ~1 ms/frame on downscaled input.
//
//   2. SCALE PRIOR. The calibration homography tells us, for any image row,
//      how many pixels a 74 mm ball subtends there. A blob 3x too large is
//      not the ball, no matter how round. This is free — the geometry is
//      already computed — and it is what rejects shirts and shoes.
//
//   3. TEMPORAL CONSISTENCY. The tracker already predicts the next position;
//      searching a predicted ROI first is both faster and far more selective
//      than a full-frame search.
//
// Colour is retained as a tiebreaker score, never as a gate on its own.
//
// PERFORMANCE CONTRACT (must be measured on target hardware, see
// docs/FIELD_VALIDATION.md): detection runs on a downscaled grayscale/HSV
// pyramid level (default 1/4 linear = 960x540 from 4K). Only the final
// centroid refinement touches full resolution, inside a small ROI. Budget:
// < 6 ms/frame, leaving headroom at 60 fps.

#pragma once
#include <opencv2/opencv.hpp>
#include <optional>

namespace pbj {

struct BallDetection {
    float u = 0, v = 0;       // FULL-RESOLUTION pixel centre, sub-pixel
    float radiusPx = 0;       // full-resolution radius
    float score = 0;          // (0,1] — feeds BallTrack detection weight
};

class BallDetectorV2 {
public:
    struct Config {
        int    downscale        = 4;      // detection pyramid level (linear)
        double bgAlpha          = 0.02;   // running-mean learning rate/frame
        int    motionThresh     = 18;     // 0..255 on the downscaled gray diff
        cv::Scalar lowerHSV     = {25, 70, 70};   // outdoor yellow-green ball
        cv::Scalar upperHSV     = {45, 255, 255};
        double minCircularity   = 0.62;
        double minFillRatio     = 0.55;
        double scaleTolerance   = 2.2;    // accept radius within [r/tol, r*tol]
        double roiPadFactor     = 4.0;    // predicted-ROI half-size = pad * r
        int    minAreaPx        = 4;      // on the downscaled image
    };

    explicit BallDetectorV2(const Config& cfg = Config()) : m_cfg(cfg) {}

    /**
     * Supply the ground-plane homography H (court metres -> full-res pixels)
     * once after calibration. Enables the scale prior. Without it the detector
     * still works but loses its strongest false-positive filter.
     */
    void setHomography(const cv::Matx33d& H, double ballDiameterM);

    /**
     * @param bgr        full-resolution BGR frame
     * @param predicted  optional predicted full-res centre from BallTrack
     * @param predRadius predicted full-res radius (0 if unknown)
     */
    std::optional<BallDetection> detect(const cv::Mat& bgr,
                                        const cv::Point2f* predicted = nullptr,
                                        float predRadius = 0.f);

    void reset() { m_bg.release(); m_frames = 0; }

private:
    // Expected ball radius in full-res pixels at image row v. Derived by
    // back-projecting the pixel to the ground plane, stepping one ball
    // diameter along +X in court metres, and re-projecting. Monotone in v,
    // so we cache a small LUT.
    float expectedRadiusAtRow(float vFull) const;

    std::optional<BallDetection> searchMask(const cv::Mat& mask,
                                            const cv::Mat& bgrSmall,
                                            const cv::Mat& bgr,
                                            cv::Rect roiSmall) const;

    Config m_cfg;
    cv::Mat m_bg;              // CV_32F running mean, downscaled gray
    cv::Mat m_graySmall, m_hsvSmall, m_diff, m_motionMask, m_colorMask, m_mask;
    long    m_frames = 0;

    bool m_haveH = false;
    cv::Matx33d m_Hinv;
    double m_ballDiameterM = 0.074;
    mutable std::vector<float> m_radiusLut;  // indexed by full-res row/8
    mutable int m_lutH = 0;
};

} // namespace pbj
