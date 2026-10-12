#include "pbj/camera.hpp"
#include <cmath>

namespace pbj {

// ---------------------------------------------------------------------------
// Hartley normalization: translate centroid to origin, scale mean radius to
// √2. Without this, ATA mixes O(1) and O(10⁶) terms (pixel coords squared)
// and the smallest eigenvector drowns in conditioning noise.
// ---------------------------------------------------------------------------
static Mat3 normalizingTransform(const std::vector<Vec2>& pts) {
    double cx = 0, cy = 0;
    for (const auto& p : pts) { cx += p.x; cy += p.y; }
    cx /= pts.size(); cy /= pts.size();
    double meanDist = 0;
    for (const auto& p : pts)
        meanDist += std::sqrt((p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy));
    meanDist /= pts.size();
    double s = meanDist > kEps ? std::sqrt(2.0) / meanDist : 1.0;
    Mat3 T = Mat3::identity();
    T.m[0][0] = s; T.m[0][2] = -s * cx;
    T.m[1][1] = s; T.m[1][2] = -s * cy;
    return T;
}

bool Camera::dltHomography(const std::vector<Correspondence>& pairs, Mat3& Hout) {
    const size_t n = pairs.size();
    if (n < 4) return false;

    std::vector<Vec2> cs, is;
    cs.reserve(n); is.reserve(n);
    for (const auto& p : pairs) { cs.push_back(p.court); is.push_back(p.image); }
    Mat3 Tc = normalizingTransform(cs);
    Mat3 Ti = normalizingTransform(is);

    // Accumulate AᵀA directly (A is 2n×9; we never materialize it).
    std::array<std::array<double, 9>, 9> ATA{};
    for (size_t k = 0; k < n; ++k) {
        Vec2 X, x;
        Tc.applyHomography(cs[k], X);
        Ti.applyHomography(is[k], x);
        const double r1[9] = {-X.x, -X.y, -1, 0, 0, 0, x.x * X.x, x.x * X.y, x.x};
        const double r2[9] = {0, 0, 0, -X.x, -X.y, -1, x.y * X.x, x.y * X.y, x.y};
        for (int i = 0; i < 9; ++i)
            for (int j = 0; j < 9; ++j)
                ATA[i][j] += r1[i] * r1[j] + r2[i] * r2[j];
    }

    auto eig = jacobiEigenSymmetric<9>(ATA);
    const auto& h = eig.vectors[0]; // smallest eigenvalue → null direction

    Mat3 Hn;
    for (int i = 0; i < 3; ++i)
        for (int j = 0; j < 3; ++j) Hn.m[i][j] = h[i * 3 + j];

    // Denormalize: x = Ti⁻¹ Hn Tc X
    Mat3 TiInv;
    if (!Ti.inverse(TiInv)) return false;
    Mat3 H = TiInv * Hn * Tc;

    // Sign fix: court centroid must map with positive w (in front, not
    // reflected through the projective sign ambiguity).
    double ccx = 0, ccy = 0;
    for (const auto& p : cs) { ccx += p.x; ccy += p.y; }
    ccx /= n; ccy /= n;
    Vec3 q = H * Vec3{ccx, ccy, 1.0};
    if (q.z < 0) H = H * -1.0;

    // Scale-normalize (Frobenius) for numeric hygiene downstream.
    double fro = 0;
    for (int i = 0; i < 3; ++i) for (int j = 0; j < 3; ++j) fro += H.m[i][j] * H.m[i][j];
    fro = std::sqrt(fro);
    if (fro < kEps) return false;
    Hout = H * (1.0 / fro);
    return true;
}

// ---------------------------------------------------------------------------
// Focal from the homography itself (image of the absolute conic, reduced to
// one unknown f with pp at image centre and square pixels).
// With pp-centred coords, H' = diag(f,f,1)·[r1 r2 t], columns h1, h2:
//   r1 ⟂ r2      ⇒ (a1a2 + b1b2)/f² + c1c2 = 0
//   |r1| = |r2|  ⇒ (a1²+b1² − a2²−b2²)/f² + (c1² − c2²) = 0
// Two independent estimates of f²; each degenerates for particular camera
// attitudes (e.g. the first when c1c2→0), so use conditioning-weighted
// fusion and reject the pose entirely if neither survives — better no
// parallax correction *flagged* than a garbage one applied silently.
// ---------------------------------------------------------------------------
bool Camera::estimateFocal(double& fOut) const {
    Mat3 P = Mat3::identity();
    P.m[0][2] = -m_cx;
    P.m[1][2] = -m_cy;
    Mat3 Hc = P * m_H;

    const double a1 = Hc.m[0][0], b1 = Hc.m[1][0], c1 = Hc.m[2][0];
    const double a2 = Hc.m[0][1], b2 = Hc.m[1][1], c2 = Hc.m[2][1];

    const double num1 = -(a1 * a2 + b1 * b2), den1 = c1 * c2;
    const double num2 = a1 * a1 + b1 * b1 - a2 * a2 - b2 * b2;
    const double den2 = c2 * c2 - c1 * c1;

    double invF2num = 0, invF2den = 0; // weighted mean in 1/f² space
    auto consider = [&](double num, double den) {
        if (std::fabs(den) < 1e-14) return;
        double f2 = num / den;
        if (!(f2 > 0) || !std::isfinite(f2)) return;
        double w = std::fabs(den); // conditioning weight
        invF2num += w * (1.0 / f2);
        invF2den += w;
    };
    consider(num1, den1);
    consider(num2, den2);
    if (invF2den < 1e-14) return false;

    double f = std::sqrt(invF2den / invF2num);
    const double dim = std::max(m_imageW, m_imageH);
    if (!(f > 0.35 * dim && f < 5.0 * dim)) return false; // physical sanity
    fOut = f;
    return true;
}

// ---------------------------------------------------------------------------
// Planar pose: M = K⁻¹H = λ⁻¹[r1 r2 t]. Cheirality fixes λ's sign; Gram–
// Schmidt repairs the noise-broken orthogonality; camera-above-ground is the
// final physical gate.
// ---------------------------------------------------------------------------
bool Camera::recoverPose(double f) {
    Mat3 Kinv = Mat3::identity();
    Kinv.m[0][0] = 1.0 / f; Kinv.m[0][2] = -m_cx / f;
    Kinv.m[1][1] = 1.0 / f; Kinv.m[1][2] = -m_cy / f;

    Mat3 M = Kinv * m_H;
    Vec3 m1 = M.col(0), m2 = M.col(1), m3 = M.col(2);

    double lambda = 2.0 / (m1.norm() + m2.norm() + kEps);

    // Cheirality: the calibration centroid must land in front of the camera.
    double ccx = 0, ccy = 0;
    for (const auto& p : m_pairs) { ccx += p.court.x; ccy += p.court.y; }
    ccx /= m_pairs.size(); ccy /= m_pairs.size();
    Vec3 pc = (m1 * ccx + m2 * ccy + m3) * lambda;
    if (pc.z < 0) lambda = -lambda;

    Vec3 r1 = (m1 * lambda).normalized();
    Vec3 r2raw = m2 * lambda;
    Vec3 r2 = (r2raw - r1 * r1.dot(r2raw)).normalized();
    Vec3 r3 = r1.cross(r2);
    Vec3 t = m3 * lambda;

    m_R = Mat3::fromCols(r1, r2, r3);
    m_t = t;
    m_center = (m_R.transposed() * t) * -1.0;

    if (m_center.z < 0.20) return false; // camera below 20 cm ⇒ nonsense pose
    return true;
}

void Camera::buildElevated(double z) {
    Mat3 K = Mat3::identity();
    K.m[0][0] = m_f; K.m[0][2] = m_cx;
    K.m[1][1] = m_f; K.m[1][2] = m_cy;
    Vec3 r1 = m_R.col(0), r2 = m_R.col(1), r3 = m_R.col(2);
    m_Hr = K * Mat3::fromCols(r1, r2, m_t + r3 * z);
    m_Hr.inverse(m_HrInv);
}

void Camera::setKnownIntrinsics(double f, double cx, double cy) {
    m_f = f; m_cx = cx; m_cy = cy; m_knownK = true;
}

Camera::Result Camera::calibrate(double imageW, double imageH,
                                 const std::vector<Correspondence>& pairs,
                                 double ballRadius) {
    m_hasH = m_hasPose = false;
    m_imageW = imageW; m_imageH = imageH;
    m_ballRadius = ballRadius;
    m_pairs = pairs;
    if (!m_knownK) { m_cx = imageW * 0.5; m_cy = imageH * 0.5; }

    if (pairs.size() < 4) return {false, "need >= 4 correspondences"};
    if (!dltHomography(pairs, m_H)) return {false, "degenerate configuration"};
    if (!m_H.inverse(m_Hinv))       return {false, "singular homography"};
    m_hasH = true;

    // Reprojection RMS (px) — this is the calibration quality number the UI
    // shows and the covariance model consumes.
    double sse = 0;
    for (const auto& p : pairs) {
        Vec2 proj;
        if (m_H.applyHomography(p.court, proj)) {
            Vec2 d = proj - p.image;
            sse += d.dot(d);
        }
    }
    m_reprojRms = std::sqrt(sse / pairs.size());
    // The homography consumes 8 dof; with n pairs (2n residual equations) the
    // raw RMS underestimates the true error sigma by sqrt(2n / (2n - 8)) —
    // at the 6-point minimum-ish calibration that is a 1.73x correction, and
    // ignoring it makes two independently calibrated cameras look mutually
    // inconsistent when they are merely both honest about a small sample.
    {
        const double eq = 2.0 * static_cast<double>(pairs.size());
        m_calibSigmaPx = m_reprojRms * std::sqrt(eq / std::max(1.0, eq - 8.0));
    }

    double f = m_f;
    if (!m_knownK && !estimateFocal(f)) {
        return {true, "homography ok; focal recovery degenerate — no parallax correction"};
    }
    m_f = f;

    if (!recoverPose(f)) {
        return {true, "homography ok; pose failed physical checks — no parallax correction"};
    }
    m_hasPose = true;
    buildElevated(ballRadius);
    return {true, ""};
}

bool Camera::imageToPlane(const Vec2& px, double z, Vec2& out) const {
    if (m_hasPose) {
        if (std::fabs(z - m_ballRadius) < 1e-9) return m_HrInv.applyHomography(px, out);
        // Arbitrary height: rebuild on the fly (cheap; used by tests/tools).
        Mat3 K = Mat3::identity();
        K.m[0][0] = m_f; K.m[0][2] = m_cx;
        K.m[1][1] = m_f; K.m[1][2] = m_cy;
        Mat3 Hz = K * Mat3::fromCols(m_R.col(0), m_R.col(1), m_t + m_R.col(2) * z);
        Mat3 HzInv;
        if (!Hz.inverse(HzInv)) return false;
        return HzInv.applyHomography(px, out);
    }
    if (!m_hasH) return false;
    return m_Hinv.applyHomography(px, out); // parallax-uncorrected fallback
}

bool Camera::groundToImage(const Vec2& court, Vec2& out) const {
    if (!m_hasH) return false;
    return m_H.applyHomography(court, out);
}

Cov2 Camera::courtCovariance(const Vec2& px, const Cov2& imgCov, double z) const {
    // Numeric Jacobian of image→plane(z), central differences at ±0.5 px.
    const double d = 0.5;
    Vec2 xu1, xu2, xv1, xv2;
    bool ok = imageToPlane({px.x + d, px.y}, z, xu1) &&
              imageToPlane({px.x - d, px.y}, z, xu2) &&
              imageToPlane({px.x, px.y + d}, z, xv1) &&
              imageToPlane({px.x, px.y - d}, z, xv2);
    if (!ok) return Cov2::isotropic(1.0); // 1 m² — effectively "unknown"

    const double Ju[2] = {(xu1.x - xu2.x) / (2 * d), (xv1.x - xv2.x) / (2 * d)};
    const double Jv[2] = {(xu1.y - xu2.y) / (2 * d), (xv1.y - xv2.y) / (2 * d)};

    // Fold calibration error in as isotropic image noise of reprojRms px.
    Cov2 imgTotal = imgCov + Cov2::isotropic(m_calibSigmaPx * m_calibSigmaPx);
    Cov2 c = imgTotal.congruence(Ju[0], Ju[1], Jv[0], Jv[1]);

    if (!m_hasPose) {
        // Uncorrected parallax: displacement magnitude ≈ z / tan(elevation).
        // Without a pose we cannot know the elevation, so budget the worst of
        // the sane placement range (≥ 12°) as an isotropic 1σ floor. This is
        // what keeps "homography-only" calibrations from issuing confident
        // wrong calls near lines.
        const double parallax = z / std::tan(12.0 * M_PI / 180.0);
        c = c + Cov2::isotropic(parallax * parallax);
    }
    return c;
}

} // namespace pbj
