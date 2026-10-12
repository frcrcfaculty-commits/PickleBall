// pbj/math.hpp — dependency-free numerical core for the PickleJudge engine.
//
// Design constraints:
//   * No external libraries (no Eigen/OpenCV). Compiles on any C++17 host,
//     Android NDK, or iOS toolchain unchanged. Fully unit-testable off-device.
//   * double precision everywhere. The whole pipeline's error budget is
//     millimetres; float would be fine numerically but double removes an
//     entire class of "is it precision?" debugging on-device.
//   * Everything here is deterministic and allocation-free on hot paths.

#pragma once
#include <cmath>
#include <cstddef>
#include <algorithm>
#include <array>
#include <vector>
#include <limits>

namespace pbj {

constexpr double kEps = 1e-12;

// ---------------------------------------------------------------------------
// Small vectors
// ---------------------------------------------------------------------------
struct Vec2 {
    double x = 0, y = 0;
    Vec2() = default;
    Vec2(double x_, double y_) : x(x_), y(y_) {}
    Vec2 operator+(const Vec2& o) const { return {x + o.x, y + o.y}; }
    Vec2 operator-(const Vec2& o) const { return {x - o.x, y - o.y}; }
    Vec2 operator*(double s)      const { return {x * s, y * s}; }
    double dot(const Vec2& o)     const { return x * o.x + y * o.y; }
    double norm()                 const { return std::sqrt(x * x + y * y); }
};

struct Vec3 {
    double x = 0, y = 0, z = 0;
    Vec3() = default;
    Vec3(double x_, double y_, double z_) : x(x_), y(y_), z(z_) {}
    Vec3 operator+(const Vec3& o) const { return {x + o.x, y + o.y, z + o.z}; }
    Vec3 operator-(const Vec3& o) const { return {x - o.x, y - o.y, z - o.z}; }
    Vec3 operator*(double s)      const { return {x * s, y * s, z * s}; }
    double dot(const Vec3& o)     const { return x * o.x + y * o.y + z * o.z; }
    Vec3 cross(const Vec3& o)     const {
        return {y * o.z - z * o.y, z * o.x - x * o.z, x * o.y - y * o.x};
    }
    double norm() const { return std::sqrt(dot(*this)); }
    Vec3 normalized() const {
        double n = norm();
        return n > kEps ? Vec3{x / n, y / n, z / n} : Vec3{0, 0, 0};
    }
};

// ---------------------------------------------------------------------------
// 3x3 matrix (row-major)
// ---------------------------------------------------------------------------
struct Mat3 {
    double m[3][3] = {{0, 0, 0}, {0, 0, 0}, {0, 0, 0}};

    static Mat3 identity() {
        Mat3 I; I.m[0][0] = I.m[1][1] = I.m[2][2] = 1.0; return I;
    }
    static Mat3 fromCols(const Vec3& c0, const Vec3& c1, const Vec3& c2) {
        Mat3 M;
        M.m[0][0] = c0.x; M.m[0][1] = c1.x; M.m[0][2] = c2.x;
        M.m[1][0] = c0.y; M.m[1][1] = c1.y; M.m[1][2] = c2.y;
        M.m[2][0] = c0.z; M.m[2][1] = c1.z; M.m[2][2] = c2.z;
        return M;
    }
    Vec3 col(int j) const { return {m[0][j], m[1][j], m[2][j]}; }

    Mat3 operator*(const Mat3& B) const {
        Mat3 R;
        for (int i = 0; i < 3; ++i)
            for (int j = 0; j < 3; ++j) {
                double s = 0;
                for (int k = 0; k < 3; ++k) s += m[i][k] * B.m[k][j];
                R.m[i][j] = s;
            }
        return R;
    }
    Vec3 operator*(const Vec3& v) const {
        return {m[0][0] * v.x + m[0][1] * v.y + m[0][2] * v.z,
                m[1][0] * v.x + m[1][1] * v.y + m[1][2] * v.z,
                m[2][0] * v.x + m[2][1] * v.y + m[2][2] * v.z};
    }
    Mat3 operator*(double s) const {
        Mat3 R;
        for (int i = 0; i < 3; ++i) for (int j = 0; j < 3; ++j) R.m[i][j] = m[i][j] * s;
        return R;
    }
    Mat3 transposed() const {
        Mat3 R;
        for (int i = 0; i < 3; ++i) for (int j = 0; j < 3; ++j) R.m[i][j] = m[j][i];
        return R;
    }
    double det() const {
        return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
             - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
             + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    }
    // Inverse via adjugate. Returns false if singular.
    bool inverse(Mat3& out) const {
        double d = det();
        if (std::fabs(d) < kEps) return false;
        double id = 1.0 / d;
        out.m[0][0] =  (m[1][1] * m[2][2] - m[1][2] * m[2][1]) * id;
        out.m[0][1] = -(m[0][1] * m[2][2] - m[0][2] * m[2][1]) * id;
        out.m[0][2] =  (m[0][1] * m[1][2] - m[0][2] * m[1][1]) * id;
        out.m[1][0] = -(m[1][0] * m[2][2] - m[1][2] * m[2][0]) * id;
        out.m[1][1] =  (m[0][0] * m[2][2] - m[0][2] * m[2][0]) * id;
        out.m[1][2] = -(m[0][0] * m[1][2] - m[0][2] * m[1][0]) * id;
        out.m[2][0] =  (m[1][0] * m[2][1] - m[1][1] * m[2][0]) * id;
        out.m[2][1] = -(m[0][0] * m[2][1] - m[0][1] * m[2][0]) * id;
        out.m[2][2] =  (m[0][0] * m[1][1] - m[0][1] * m[1][0]) * id;
        return true;
    }
    // Apply as a homography to an inhomogeneous 2D point. Returns false if the
    // point maps to the plane at infinity (w ~ 0).
    bool applyHomography(const Vec2& p, Vec2& out) const {
        Vec3 q = (*this) * Vec3{p.x, p.y, 1.0};
        if (std::fabs(q.z) < kEps) return false;
        out = {q.x / q.z, q.y / q.z};
        return true;
    }
};

// ---------------------------------------------------------------------------
// 2x2 symmetric covariance helper
// ---------------------------------------------------------------------------
struct Cov2 {
    // [ xx xy ; xy yy ]
    double xx = 0, xy = 0, yy = 0;
    static Cov2 isotropic(double var) { return {var, 0.0, var}; }
    Cov2 operator+(const Cov2& o) const { return {xx + o.xx, xy + o.xy, yy + o.yy}; }
    Cov2 operator*(double s) const { return {xx * s, xy * s, yy * s}; }
    double det() const { return xx * yy - xy * xy; }
    bool inverse(Cov2& out) const {
        double d = det();
        if (d < kEps) return false;
        out = {yy / d, -xy / d, xx / d};
        return true;
    }
    // Quadratic form vᵀ Σ v — variance of the projection of this covariance
    // onto direction v. Used to collapse 2D uncertainty onto a line normal.
    double quad(const Vec2& v) const {
        return v.x * v.x * xx + 2.0 * v.x * v.y * xy + v.y * v.y * yy;
    }
    // J Σ Jᵀ for a 2x2 Jacobian J = [a b; c d].
    Cov2 congruence(double a, double b, double c, double d) const {
        // Σ' = J Σ Jᵀ
        double s00 = a * xx + b * xy, s01 = a * xy + b * yy;
        double s10 = c * xx + d * xy, s11 = c * xy + d * yy;
        return {s00 * a + s01 * b, s00 * c + s01 * d, s10 * c + s11 * d};
    }
    double maxEigen() const {
        double tr = xx + yy;
        double disc = std::sqrt(std::max(0.0, tr * tr * 0.25 - det()));
        return tr * 0.5 + disc;
    }
};

// ---------------------------------------------------------------------------
// Symmetric Jacobi eigensolver for small dense matrices (used at N=9 for the
// normalized DLT: h = eigenvector of AᵀA with the smallest eigenvalue).
// Jacobi is O(N³·sweeps) — trivial at N=9 — and unconditionally stable for
// symmetric input, which AᵀA is by construction. No pivoting fragility.
// ---------------------------------------------------------------------------
template <size_t N>
struct SymEig {
    std::array<double, N> values{};                 // ascending
    std::array<std::array<double, N>, N> vectors{}; // vectors[k] = k-th eigenvector
};

template <size_t N>
inline SymEig<N> jacobiEigenSymmetric(std::array<std::array<double, N>, N> A,
                                      int maxSweeps = 64) {
    std::array<std::array<double, N>, N> V{};
    for (size_t i = 0; i < N; ++i) V[i][i] = 1.0;

    for (int sweep = 0; sweep < maxSweeps; ++sweep) {
        double off = 0;
        for (size_t p = 0; p < N; ++p)
            for (size_t q = p + 1; q < N; ++q) off += A[p][q] * A[p][q];
        if (off < 1e-24) break;

        for (size_t p = 0; p < N; ++p) {
            for (size_t q = p + 1; q < N; ++q) {
                double apq = A[p][q];
                if (std::fabs(apq) < 1e-30) continue;
                double theta = (A[q][q] - A[p][p]) / (2.0 * apq);
                double t = (theta >= 0 ? 1.0 : -1.0) /
                           (std::fabs(theta) + std::sqrt(theta * theta + 1.0));
                double c = 1.0 / std::sqrt(t * t + 1.0);
                double s = t * c;

                for (size_t k = 0; k < N; ++k) {
                    double akp = A[k][p], akq = A[k][q];
                    A[k][p] = c * akp - s * akq;
                    A[k][q] = s * akp + c * akq;
                }
                for (size_t k = 0; k < N; ++k) {
                    double apk = A[p][k], aqk = A[q][k];
                    A[p][k] = c * apk - s * aqk;
                    A[q][k] = s * apk + c * aqk;
                }
                for (size_t k = 0; k < N; ++k) {
                    double vkp = V[k][p], vkq = V[k][q];
                    V[k][p] = c * vkp - s * vkq;
                    V[k][q] = s * vkp + c * vkq;
                }
            }
        }
    }

    SymEig<N> out;
    std::array<size_t, N> idx{};
    for (size_t i = 0; i < N; ++i) idx[i] = i;
    std::sort(idx.begin(), idx.end(),
              [&](size_t a, size_t b) { return A[a][a] < A[b][b]; });
    for (size_t r = 0; r < N; ++r) {
        out.values[r] = A[idx[r]][idx[r]];
        for (size_t k = 0; k < N; ++k) out.vectors[r][k] = V[k][idx[r]];
    }
    return out;
}

// ---------------------------------------------------------------------------
// Weighted polynomial least squares, degree ≤ 2.
//
// This is the workhorse of the bounce detector: per-branch quadratic fits of
// image row v(t) and per-branch linear fits of image column u(t). We need not
// just coefficients but the *prediction variance* at an arbitrary query time,
//   Var[p(t*)] = φ(t*)ᵀ (AᵀWA)⁻¹ φ(t*) · s²,   s² = SSE_w / (n − p)
// because the contact-point covariance is what feeds fusion and the verdict.
// Times are shifted by t0 (caller supplies) to keep the normal equations
// well-conditioned; never fit raw epoch timestamps.
// ---------------------------------------------------------------------------
struct PolyFit {
    int degree = -1;              // -1 = invalid
    double c[3] = {0, 0, 0};      // p(t) = c0 + c1 t + c2 t²
    double C[3][3] = {{0}};       // (AᵀWA)⁻¹, valid entries up to degree
    double s2 = 0;                // residual variance estimate
    double rms = 0;               // weighted RMS residual (same units as y)
    int n = 0;

    bool valid() const { return degree >= 0; }
    double eval(double t) const { return c[0] + t * (c[1] + t * c[2]); }
    double deriv(double t) const { return c[1] + 2.0 * c[2] * t; }
    // Prediction variance of the *mean curve* at t (not including new-obs noise).
    double predVar(double t) const {
        double phi[3] = {1.0, t, t * t};
        int p = degree + 1;
        double v = 0;
        for (int i = 0; i < p; ++i)
            for (int j = 0; j < p; ++j) v += phi[i] * C[i][j] * phi[j];
        return std::max(0.0, v * s2);
    }
    double derivVar(double t) const {
        double phi[3] = {0.0, 1.0, 2.0 * t};
        int p = degree + 1;
        double v = 0;
        for (int i = 0; i < p; ++i)
            for (int j = 0; j < p; ++j) v += phi[i] * C[i][j] * phi[j];
        return std::max(0.0, v * s2);
    }
};

// Solve small symmetric positive-definite system via Cholesky (p ≤ 3).
inline bool cholSolve(int p, double M[3][3], const double b[3], double x[3],
                      double Minv[3][3] = nullptr) {
    double L[3][3] = {{0}};
    for (int i = 0; i < p; ++i) {
        for (int j = 0; j <= i; ++j) {
            double s = M[i][j];
            for (int k = 0; k < j; ++k) s -= L[i][k] * L[j][k];
            if (i == j) {
                if (s <= 1e-14) return false;
                L[i][i] = std::sqrt(s);
            } else {
                L[i][j] = s / L[j][j];
            }
        }
    }
    // Forward/back substitution for x
    double y[3];
    for (int i = 0; i < p; ++i) {
        double s = b[i];
        for (int k = 0; k < i; ++k) s -= L[i][k] * y[k];
        y[i] = s / L[i][i];
    }
    for (int i = p - 1; i >= 0; --i) {
        double s = y[i];
        for (int k = i + 1; k < p; ++k) s -= L[k][i] * x[k];
        x[i] = s / L[i][i];
    }
    if (Minv) {
        // Invert via p solves against unit vectors.
        for (int col = 0; col < p; ++col) {
            double e[3] = {0, 0, 0}; e[col] = 1.0;
            double yy[3], xx[3];
            for (int i = 0; i < p; ++i) {
                double s = e[i];
                for (int k = 0; k < i; ++k) s -= L[i][k] * yy[k];
                yy[i] = s / L[i][i];
            }
            for (int i = p - 1; i >= 0; --i) {
                double s = yy[i];
                for (int k = i + 1; k < p; ++k) s -= L[k][i] * xx[k];
                xx[i] = s / L[i][i];
            }
            for (int r = 0; r < p; ++r) Minv[r][col] = xx[r];
        }
    }
    return true;
}

inline PolyFit fitPolyWeighted(const double* t, const double* y, const double* w,
                               int n, int degree) {
    PolyFit f;
    int p = degree + 1;
    if (degree < 0 || degree > 2 || n < p) return f;

    double M[3][3] = {{0}}, b[3] = {0, 0, 0};
    for (int k = 0; k < n; ++k) {
        double wk = w ? w[k] : 1.0;
        if (wk <= 0) continue;
        double phi[3] = {1.0, t[k], t[k] * t[k]};
        for (int i = 0; i < p; ++i) {
            b[i] += wk * phi[i] * y[k];
            for (int j = i; j < p; ++j) M[i][j] += wk * phi[i] * phi[j];
        }
    }
    for (int i = 0; i < p; ++i)
        for (int j = 0; j < i; ++j) M[i][j] = M[j][i];

    double x[3], Minv[3][3];
    if (!cholSolve(p, M, b, x, Minv)) return f;

    f.degree = degree; f.n = n;
    for (int i = 0; i < p; ++i) f.c[i] = x[i];
    for (int i = 0; i < p; ++i)
        for (int j = 0; j < p; ++j) f.C[i][j] = Minv[i][j];

    double sse = 0, wsum = 0;
    for (int k = 0; k < n; ++k) {
        double wk = w ? w[k] : 1.0;
        if (wk <= 0) continue;
        double r = y[k] - f.eval(t[k]);
        sse += wk * r * r;
        wsum += wk;
    }
    int dof = n - p;
    f.s2 = dof > 0 ? sse / dof : sse;             // conservative when dof==0
    f.rms = wsum > 0 ? std::sqrt(sse / wsum) : 0;
    return f;
}

// ---------------------------------------------------------------------------
// Robust statistics — clock sync and outlier gating.
// ---------------------------------------------------------------------------
inline double median(std::vector<double> v) {
    if (v.empty()) return 0;
    size_t k = v.size() / 2;
    std::nth_element(v.begin(), v.begin() + k, v.end());
    double m = v[k];
    if (v.size() % 2 == 0) {
        std::nth_element(v.begin(), v.begin() + k - 1, v.begin() + k);
        m = 0.5 * (m + v[k - 1]);
    }
    return m;
}

inline double mad(const std::vector<double>& v, double med) {
    std::vector<double> d; d.reserve(v.size());
    for (double x : v) d.push_back(std::fabs(x - med));
    return 1.4826 * median(std::move(d)); // ≈ σ for Gaussian residuals
}

// Theil–Sen slope: median of pairwise slopes. Breakdown point ~29%, immune to
// the asymmetric-delay outliers that wreck OLS drift estimates on Wi-Fi.
inline double theilSenSlope(const std::vector<double>& x,
                            const std::vector<double>& y) {
    size_t n = std::min(x.size(), y.size());
    if (n < 2) return 0;
    std::vector<double> slopes;
    slopes.reserve(n * (n - 1) / 2);
    for (size_t i = 0; i < n; ++i)
        for (size_t j = i + 1; j < n; ++j) {
            double dx = x[j] - x[i];
            if (std::fabs(dx) > kEps) slopes.push_back((y[j] - y[i]) / dx);
        }
    return slopes.empty() ? 0 : median(std::move(slopes));
}

// Standard normal CDF — converts a signed margin/σ into P(IN).
inline double normCdf(double z) { return 0.5 * std::erfc(-z / std::sqrt(2.0)); }

} // namespace pbj
