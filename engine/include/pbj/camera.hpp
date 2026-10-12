// pbj/camera.hpp — single-camera geometry: calibration and image↔court mapping.
//
// THE CENTRAL FIX vs. the legacy pipeline
// ---------------------------------------
// A homography H maps the court's z=0 plane to the image. Applying H⁻¹ to the
// pixel of an AIRBORNE ball intersects the ball's viewing ray with the GROUND,
// producing a point displaced away from the camera by  Δ = z_ball / tan(α)
// (α = ray elevation). At phone-on-tripod geometries (α ≈ 10–30°) even the
// ball's own radius at the bounce instant (z = 36.5 mm) becomes a 7–20 cm
// error — an order of magnitude larger than a line call's tolerance.
//
// Fix: recover the full planar pose (K, R, t) from the same homography, then
// build the ELEVATED-PLANE homography for the plane z = r_ball:
//
//     H  = K [ r1  r2  t ]            (ground plane,   z = 0)
//     H_r = K [ r1  r2  t + r·r3 ]    (ball-centre plane at contact, z = r)
//
// The ball's image centre at the bounce instant lies (to first order) on the
// plane z = r_ball, so H_r⁻¹ maps it to the true (X, Y) of the contact point
// with zero parallax bias. Tracking and bounce fitting stay in IMAGE space;
// this mapping is applied exactly once, to the fitted contact pixel.
//
// K is assumed square-pixel with principal point at the image centre — valid
// to <0.5 % on phone cameras and dwarfed by other error terms. If the app can
// obtain factory intrinsics (iOS AVCameraCalibrationData / Android
// LENS_INTRINSIC_CALIBRATION), pass them via setKnownIntrinsics() and the
// self-calibration step is skipped.

#pragma once
#include "math.hpp"
#include <vector>

namespace pbj {

struct Correspondence {
    Vec2 court;  // metres, z = 0 plane (see court.hpp frame)
    Vec2 image;  // pixels
};

class Camera {
public:
    struct Result {
        bool ok = false;
        const char* error = "";
    };

    // Optional: factory intrinsics (skips focal self-calibration).
    void setKnownIntrinsics(double f, double cx, double cy);

    // Calibrate from ≥4 non-degenerate correspondences (tapped landmarks).
    // Computes H (DLT), then f (if unknown), then (R, t), then H_r for
    // ballRadius. Partial success is possible: homography valid but pose not
    // (e.g. focal recovery degenerate) — see flags below.
    Result calibrate(double imageW, double imageH,
                     const std::vector<Correspondence>& pairs,
                     double ballRadius);

    bool hasHomography() const { return m_hasH; }
    bool hasPose()       const { return m_hasPose; }
    double reprojRmsPx() const { return m_reprojRms; }
    double focalPx()     const { return m_f; }
    Vec3 cameraCenter()  const { return m_center; }

    // image → court-plane at height z. Uses pose when available; when only
    // the ground homography exists, z is ignored (caller must treat the
    // result as parallax-uncorrected — see parallaxCorrected()).
    bool imageToPlane(const Vec2& px, double z, Vec2& out) const;
    bool parallaxCorrected() const { return m_hasPose; }

    // court ground point → image (for overlay rendering / debugging).
    bool groundToImage(const Vec2& court, Vec2& out) const;

    // Propagate an image-space covariance (px²) of a point at height z into
    // court-frame covariance (m²). Includes the calibration reprojection RMS
    // as isotropic image noise, and — when the pose is unavailable — an
    // additive uncorrected-parallax floor so downstream confidence stays
    // honest instead of optimistic.
    Cov2 courtCovariance(const Vec2& px, const Cov2& imgCov, double z) const;

    // Exposed for tests.
    Mat3 H() const    { return m_H; }
    Mat3 Hr() const   { return m_Hr; }
    Mat3 R() const    { return m_R; }
    Vec3 t() const    { return m_t; }

    // Standalone normalized-DLT (also used by tests).
    static bool dltHomography(const std::vector<Correspondence>& pairs, Mat3& H);

private:
    bool estimateFocal(double& fOut) const;
    bool recoverPose(double f);
    void buildElevated(double z);

    double m_imageW = 0, m_imageH = 0;
    double m_f = 0, m_cx = 0, m_cy = 0;
    bool m_knownK = false;

    Mat3 m_H, m_Hinv;       // ground plane
    Mat3 m_Hr, m_HrInv;     // z = ballRadius plane
    Mat3 m_R;  Vec3 m_t;    // court → camera
    Vec3 m_center;          // camera centre in court frame
    double m_ballRadius = 0;
    double m_reprojRms = 1.0;
    double m_calibSigmaPx = 1.0; // rms corrected for DLT dof (see .cpp)

    bool m_hasH = false, m_hasPose = false;
    std::vector<Correspondence> m_pairs;
};

} // namespace pbj
