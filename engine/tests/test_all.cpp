// test_all.cpp — synthetic ground-truth verification of the whole engine.
//
// Philosophy: every module is tested against EXACT simulated physics and an
// EXACT projective camera, with realistic noise injected on top. If the
// recovered contact point doesn't land within tolerance of where the
// simulator put the ball, the build fails. The parallax A/B test in
// particular is the regression guard for the core geometric fix.

#include "pbj/math.hpp"
#include "pbj/court.hpp"
#include "pbj/camera.hpp"
#include "pbj/track.hpp"
#include "pbj/bounce.hpp"
#include "pbj/clocksync.hpp"
#include "pbj/fuse.hpp"
#include "pbj/decision.hpp"
#include "pbj/engine.hpp"

#include <cstdio>
#include <random>

using namespace pbj;

static int g_pass = 0, g_fail = 0;
#define CHECK(cond, msg, ...)                                            \
    do {                                                                 \
        if (cond) { ++g_pass; }                                          \
        else { ++g_fail;                                                 \
               std::printf("  FAIL %s:%d  " msg "\n", __FILE__, __LINE__,\
                           ##__VA_ARGS__); }                             \
    } while (0)

// ---------------------------------------------------------------------------
// Exact synthetic pinhole camera (ground truth generator — independent code
// path from pbj::Camera on purpose).
// ---------------------------------------------------------------------------
struct SynthCam {
    Vec3 C;        // centre, court frame
    Mat3 R;        // world → camera
    double f, cx, cy, w, h;

    static SynthCam lookAt(Vec3 C, Vec3 target, double f, double w, double h) {
        SynthCam s;
        s.C = C; s.f = f; s.cx = w * 0.5; s.cy = h * 0.5; s.w = w; s.h = h;
        Vec3 zc = (target - C).normalized();
        Vec3 xc = zc.cross(Vec3{0, 0, 1}).normalized();
        Vec3 yc = zc.cross(xc);
        // rows of R are the camera axes expressed in world coords
        s.R.m[0][0] = xc.x; s.R.m[0][1] = xc.y; s.R.m[0][2] = xc.z;
        s.R.m[1][0] = yc.x; s.R.m[1][1] = yc.y; s.R.m[1][2] = yc.z;
        s.R.m[2][0] = zc.x; s.R.m[2][1] = zc.y; s.R.m[2][2] = zc.z;
        return s;
    }
    bool project(const Vec3& P, Vec2& px) const {
        Vec3 pc = R * (P - C);
        if (pc.z < 0.1) return false;
        px = {f * pc.x / pc.z + cx, f * pc.y / pc.z + cy};
        return true;
    }
};

static std::vector<Correspondence>
calibPairs(const SynthCam& cam, std::mt19937& rng, double noisePx,
           std::initializer_list<int> ids) {
    std::normal_distribution<double> N(0.0, noisePx);
    std::vector<Correspondence> out;
    for (int id : ids) {
        Vec2 cp = calibrationPoint(id);
        Vec2 px;
        if (cam.project({cp.x, cp.y, 0.0}, px) &&
            px.x >= 0 && px.x <= cam.w && px.y >= 0 && px.y <= cam.h) {
            out.push_back({cp, {px.x + N(rng), px.y + N(rng)}});
        }
    }
    return out;
}

// Standard rig: phone on a ~2.3 m pole just outside the LEFT sideline near
// mid-court, judging Side B at 4K. This matters: a phone parked 9+ m behind
// the baseline sees far lines at <8 deg elevation, where one pixel smears
// into ~9 cm of depth — no algorithm rescues that. Camera placement is part
// of the accuracy budget and the tests encode a placement that works.
static SynthCam standardCam() {
    return SynthCam::lookAt({-5.0, 0.5, 2.8}, {-0.2, 4.4, 0.0},
                            2400.0, 3840, 2160);
}

// ---------------------------------------------------------------------------
static void testMath() {
    std::puts("[math]");
    // Jacobi: known 3x3-in-9x9 embedding is overkill; verify on a matrix with
    // a known null vector: A = BᵀB with B missing one direction.
    std::array<std::array<double, 9>, 9> M{};
    std::mt19937 rng(7);
    std::normal_distribution<double> N(0, 1);
    double null[9]; double nn = 0;
    for (int i = 0; i < 9; ++i) { null[i] = N(rng); nn += null[i] * null[i]; }
    nn = std::sqrt(nn);
    for (int i = 0; i < 9; ++i) null[i] /= nn;
    for (int r = 0; r < 8; ++r) { // 8 random rows, all ⟂ null
        double row[9]; double d = 0;
        for (int i = 0; i < 9; ++i) { row[i] = N(rng); d += row[i] * null[i]; }
        for (int i = 0; i < 9; ++i) row[i] -= d * null[i];
        for (int i = 0; i < 9; ++i)
            for (int j = 0; j < 9; ++j) M[i][j] += row[i] * row[j];
    }
    auto eig = jacobiEigenSymmetric<9>(M);
    double dot = 0;
    for (int i = 0; i < 9; ++i) dot += eig.vectors[0][i] * null[i];
    CHECK(std::fabs(eig.values[0]) < 1e-9, "smallest eigenvalue ~0, got %g",
          eig.values[0]);
    CHECK(std::fabs(std::fabs(dot) - 1.0) < 1e-6,
          "null vector recovered, |dot|=%g", std::fabs(dot));

    // Weighted quadratic fit recovers exact coefficients + variance behaves.
    double t[9], y[9];
    for (int i = 0; i < 9; ++i) { t[i] = -0.2 + 0.05 * i;
                                  y[i] = 3.0 + 2.0 * t[i] - 4.9 * t[i] * t[i]; }
    PolyFit pf = fitPolyWeighted(t, y, nullptr, 9, 2);
    CHECK(std::fabs(pf.c[0] - 3.0) < 1e-9 && std::fabs(pf.c[1] - 2.0) < 1e-9 &&
          std::fabs(pf.c[2] + 4.9) < 1e-9, "exact quadratic recovered");
    CHECK(pf.rms < 1e-9, "noise-free rms ~0");

    // Theil–Sen shrugs off 25% outliers.
    std::vector<double> xs, ys;
    for (int i = 0; i < 40; ++i) {
        xs.push_back(i);
        ys.push_back(5.0 + 0.02 * i + ((i % 4 == 0) ? 3.0 : 0.0));
    }
    double slope = theilSenSlope(xs, ys);
    CHECK(std::fabs(slope - 0.02) < 0.004, "TS slope %.4f vs 0.02", slope);
}

// ---------------------------------------------------------------------------
static void testCourt() {
    std::puts("[court]");
    using namespace court;
    const double rho = kContactPatchRadius;

    CallContext rally; rally.type = CallContext::Type::Rally;
    rally.targetSide = Side::B;
    LegalRegion r = regionFor(rally, rho);

    // Contact centre 5 mm OUTSIDE the sideline outer edge: patch (12 mm)
    // still overlaps the line ⇒ IN under rally semantics.
    MarginResult m1 = marginTo(r, {kHalfWidth + 0.005, 3.0});
    CHECK(m1.margin > 0, "rally: patch clipping the line is IN (m=%.4f)",
          m1.margin);
    // 20 mm outside: patch clears the line ⇒ OUT.
    MarginResult m2 = marginTo(r, {kHalfWidth + 0.020, 3.0});
    CHECK(m2.margin < 0, "rally: 20mm past line is OUT (m=%.4f)", m2.margin);
    CHECK(std::string(m2.nearestLine) == "sideline_right", "line name");

    // Serve, +X box on side B.
    CallContext serve; serve.type = CallContext::Type::Serve;
    serve.targetSide = Side::B; serve.boxSignX = +1;
    LegalRegion sr = regionFor(serve, rho);

    // Contact 5 mm beyond NVZ line's outer edge: patch still reaches back
    // onto the line ⇒ FAULT (exclusive edge).
    MarginResult s1 = marginTo(sr, {1.5, kNvzDepth + 0.005});
    CHECK(s1.margin < 0 && s1.nvzFault, "serve: patch touching NVZ line = FAULT");
    // 20 mm beyond: clean ⇒ IN.
    MarginResult s2 = marginTo(sr, {1.5, kNvzDepth + 0.020});
    CHECK(s2.margin > 0, "serve: clear of NVZ line = IN (m=%.4f)", s2.margin);
    // Centerline touch is IN for the serve.
    MarginResult s3 = marginTo(sr, {-0.005, 4.5});
    CHECK(s3.margin > 0, "serve: centerline touch = IN");
    // Long serve past baseline = OUT, not fault.
    MarginResult s4 = marginTo(sr, {1.5, kHalfLength + 0.05});
    CHECK(s4.margin < 0 && !s4.nvzFault, "serve long = OUT (not fault)");
}

// ---------------------------------------------------------------------------
static void testCameraAndParallax() {
    std::puts("[camera + parallax]");
    std::mt19937 rng(42);
    SynthCam sc = standardCam();

    auto pairs = calibPairs(sc, rng, 0.6,
        {B_BASELINE_LEFT, B_BASELINE_CENTER, B_BASELINE_RIGHT,
         B_NVZ_LEFT, B_NVZ_CENTER, B_NVZ_RIGHT});
    CHECK(pairs.size() == 6, "all Side-B landmarks visible (got %zu)",
          pairs.size());

    Camera cam;
    auto res = cam.calibrate(3840, 2160, pairs, court::kBallRadius);
    CHECK(res.ok, "calibrate: %s", res.error);
    CHECK(cam.hasPose(), "pose recovered: %s", res.error);
    CHECK(cam.reprojRmsPx() < 2.0, "reproj RMS %.2f px", cam.reprojRmsPx());
    CHECK(std::fabs(cam.focalPx() - sc.f) / sc.f < 0.06,
          "focal %.0f vs true %.0f", cam.focalPx(), sc.f);
    Vec3 C = cam.cameraCenter();
    double cErr = (C - sc.C).norm();
    CHECK(cErr < 0.25, "camera centre err %.3f m", cErr);

    // Held-out ground point round-trips.
    Vec2 gt{1.7, 4.2}, px, back;
    sc.project({gt.x, gt.y, 0}, px);
    cam.imageToPlane(px, 0.0, back);
    CHECK((back - gt).norm() < 0.012, "ground round-trip err %.4f m",
          (back - gt).norm());

    // THE PARALLAX A/B TEST. Ball centre at contact height z = r_ball, right
    // on the far sideline near the baseline corner — worst-case ray obliquity.
    Vec2 contact{2.9, 6.2};
    Vec2 pxBall;
    sc.project({contact.x, contact.y, court::kBallRadius}, pxBall);

    Vec2 viaGround, viaElevated;
    cam.imageToPlane(pxBall, 0.0, viaGround);                  // legacy path
    cam.imageToPlane(pxBall, court::kBallRadius, viaElevated); // corrected
    double eg = (viaGround - contact).norm();
    double ee = (viaElevated - contact).norm();
    std::printf("  parallax: ground-plane err = %.1f mm, z=r plane err = %.1f mm\n",
                eg * 1000, ee * 1000);
    CHECK(eg > 0.06, "legacy ground mapping shows the expected bias (%.3f m)", eg);
    CHECK(ee < 0.020, "elevated-plane mapping kills it (%.4f m)", ee);
    CHECK(ee < eg * 0.30, "large improvement (ratio %.2f)", ee / eg);

    // Covariance is finite, positive, and sane in scale (a 1px σ at ~11 m
    // range with f=1500 is centimetres, not metres).
    Cov2 cc = cam.courtCovariance(pxBall, Cov2::isotropic(1.0),
                                  court::kBallRadius);
    CHECK(cc.xx > 0 && cc.yy > 0 && cc.det() > 0, "cov positive definite");
    CHECK(std::sqrt(cc.maxEigen()) < 0.20, "cov scale sane: %.3f m",
          std::sqrt(cc.maxEigen()));
}

// ---------------------------------------------------------------------------
// Ballistic bounce simulator: returns ball CENTRE at time t.
// Contact at tb with the centre at height r. w_in = descent speed at contact.
// ---------------------------------------------------------------------------
struct BounceSim {
    Vec2 xyContact;   // ground contact point
    double tb;
    Vec2 vXYin, vXYout;
    double wIn, e;    // vertical speed at contact; restitution
    static constexpr double g = 9.81;

    Vec3 center(double t) const {
        double r = court::kBallRadius;
        if (t <= tb) {
            double dt = tb - t;
            return {xyContact.x - vXYin.x * dt,
                    xyContact.y - vXYin.y * dt,
                    r + wIn * dt - 0.5 * g * dt * dt};
        }
        double dt = t - tb;
        return {xyContact.x + vXYout.x * dt,
                xyContact.y + vXYout.y * dt,
                r + e * wIn * dt - 0.5 * g * dt * dt};
    }
};

static void testBounceEndToEnd() {
    std::puts("[bounce end-to-end, single camera]");
    std::mt19937 rng(99);
    std::normal_distribution<double> Npx(0.0, 0.7);

    SynthCam sc = standardCam();
    Engine::Config ecfg;
    Engine eng(ecfg);
    auto pairs = calibPairs(sc, rng, 0.5,
        {B_BASELINE_LEFT, B_BASELINE_CENTER, B_BASELINE_RIGHT,
         B_NVZ_LEFT, B_NVZ_CENTER, B_NVZ_RIGHT});
    auto res = eng.calibrate(3840, 2160, pairs);
    CHECK(res.ok && eng.status().poseValid, "engine calibrated w/ pose");

    CallContext ctx; ctx.type = CallContext::Type::Rally;
    ctx.targetSide = Side::B;
    eng.setContext(ctx);
    eng.setPeerConnected(false);

    // Ball lands 30 mm INSIDE the right sideline, mid-depth. 60 fps.
    BounceSim sim;
    sim.xyContact = {court::kHalfWidth - 0.030, 4.6};
    sim.tb = 10.317;                       // deliberately off frame grid
    sim.vXYin = {2.6, 3.4}; sim.vXYout = {2.1, 2.7};
    sim.wIn = 5.2; sim.e = 0.55;

    const double fps = 60.0;
    for (int k = 0; k < 40; ++k) {
        double t = sim.tb - 0.33 + k / fps;
        Vec3 P = sim.center(t);
        Vec2 px;
        if (!sc.project(P, px)) continue;
        eng.feedDetection(t, px.x + Npx(rng), px.y + Npx(rng), 14.0, 0.9);
    }

    std::vector<OutboundContact> ob;
    std::vector<LineCall> calls;
    eng.poll(sim.tb + 1.0, ob, calls);

    CHECK(calls.size() == 1, "exactly one call emitted (got %zu)", calls.size());
    CHECK(ob.size() == 1, "one outbound contact for the peer");
    if (!calls.empty()) {
        const LineCall& c = calls[0];
        double err = (c.contact - sim.xyContact).norm();
        double terr = std::fabs(c.tContact - sim.tb);
        std::printf("  contact err = %.1f mm, time err = %.2f ms, "
                    "sigma = %.1f mm, p(in) = %.3f, verdict = %s\n",
                    err * 1000, terr * 1000, c.sigmaM * 1000, c.pIn,
                    verdictName(c.verdict));
        CHECK(err < 0.030, "contact within 30 mm (%.1f mm)", err * 1000);
        CHECK(terr < 0.006, "sub-frame timing (%.2f ms < 6 ms; frame=16.7)",
              terr * 1000);
        CHECK(c.verdict == Verdict::In, "ball 30mm inside ⇒ IN");
        CHECK(c.parallaxCorrected, "used elevated-plane mapping");
    }

    // Negative control: smooth flight with no bounce must stay silent.
    Engine eng2(ecfg);
    eng2.calibrate(3840, 2160, pairs);
    eng2.setPeerConnected(false);
    for (int k = 0; k < 40; ++k) {
        double t = 20.0 + k / fps;
        Vec3 P{-2.0 + 5.0 * (k / fps), 2.0 + 3.0 * (k / fps),
               1.4 + 2.0 * (k / fps) - 4.905 * (k / fps) * (k / fps)};
        Vec2 px;
        if (!sc.project(P, px)) continue;
        eng2.feedDetection(t, px.x + Npx(rng), px.y + Npx(rng), 14.0, 0.9);
    }
    std::vector<OutboundContact> ob2; std::vector<LineCall> c2;
    eng2.poll(21.0, ob2, c2);
    for (const auto& fc : c2)
        std::printf("  FALSE CALL: t=%.3f xy=(%.2f,%.2f) verdict=%s p=%.2f\n",
                    fc.tContact, fc.contact.x, fc.contact.y,
                    verdictName(fc.verdict), fc.pIn);
    CHECK(c2.empty() && ob2.empty(), "no false bounce on smooth flight");
}

// ---------------------------------------------------------------------------
static void testClockSync() {
    std::puts("[clock sync]");
    std::mt19937 rng(5);
    std::exponential_distribution<double> jitter(1.0 / 0.0015); // mean 1.5 ms
    std::uniform_real_distribution<double> U(0, 1);

    const double theta0 = 0.7431;   // remote − local at t=0
    const double drift = 8e-6;      // 8 ppm
    const double base = 0.002;      // one-way base delay

    ClockSync cs;
    for (int i = 0; i < 90; ++i) {
        double t1 = 5.0 + i * 0.7;
        double d1 = base + jitter(rng) + (U(rng) < 0.10 ? 0.030 : 0.0);
        double d2 = base + jitter(rng) + (U(rng) < 0.10 ? 0.030 : 0.0);
        double theta = theta0 + drift * t1;
        double t2 = t1 + d1 + theta;   // remote clock
        double t3 = t2 + 0.0004;
        double t4 = (t3 - theta) + d2; // back on local clock
        cs.addSample({t1, t2, t3, t4});
    }
    CHECK(cs.locked(), "locked (unc = %.2f ms)", cs.uncertaintyS() * 1000);

    double tEval = 5.0 + 89 * 0.7;
    double err = std::fabs(cs.offsetAt(tEval) - (theta0 + drift * tEval));
    std::printf("  offset err at end = %.3f ms, drift est = %.1f ppm, "
                "unc = %.2f ms\n", err * 1000, cs.driftPpm(),
                cs.uncertaintyS() * 1000);
    CHECK(err < 0.0015, "offset within 1.5 ms under asymmetric jitter");
    CHECK(cs.driftPpm() > 0, "drift sign recovered");

    double tR = theta0 + drift * 100.0 + 100.0; // remote time of local t=100
    CHECK(std::fabs(cs.remoteToLocal(tR) - 100.0) < 0.002,
          "remoteToLocal round-trip");
}

// ---------------------------------------------------------------------------
static void testFusionAndDecision() {
    std::puts("[fusion + decision]");
    Fuser fu;

    ContactEstimate a, b;
    a.valid = b.valid = true;
    a.tContact = 100.000; b.tContact = 100.004;
    a.tSigma = b.tSigma = 0.004;
    a.xy = {3.055, 4.60}; a.cov = Cov2::isotropic(0.012 * 0.012);
    b.xy = {3.045, 4.61}; b.cov = Cov2::isotropic(0.018 * 0.018);

    CHECK(fu.sameEvent(a, b, 0.002), "association accepts same bounce");
    ContactEstimate late = b; late.tContact = 100.30;
    CHECK(!fu.sameEvent(a, late, 0.002), "association rejects next bounce");

    FusedContact f = fu.fuse(a, b);
    CHECK(f.valid && f.consistent && f.nCameras == 2, "clean fusion");
    CHECK(f.cov.maxEigen() < a.cov.maxEigen() &&
          f.cov.maxEigen() < b.cov.maxEigen(), "fused tighter than either");

    ContactEstimate liar = b; liar.xy = {3.35, 4.60}; // 30 cm off
    FusedContact fBad = fu.fuse(a, liar);
    CHECK(!fBad.consistent, "χ² gate catches disagreement (m2=%.1f)",
          fBad.mahal2);
    CHECK((fBad.xy - a.xy).norm() < 1e-9, "kept the tighter estimate");
    CHECK(fBad.cov.maxEigen() > a.cov.maxEigen(), "…with inflated cov");

    // Decision: fused point is ~2 mm outside the sideline outer edge; patch
    // makes it IN under rally rules with high confidence at ~7 mm σ... run it.
    DecisionEngine de;
    CallContext ctx; ctx.targetSide = Side::B;
    LineCall lc = de.decide(f, ctx);
    std::printf("  fused: (%.3f, %.3f) ±%.1f mm, margin %.1f mm, p(in)=%.3f → %s\n",
                f.xy.x, f.xy.y, std::sqrt(f.cov.maxEigen()) * 1000,
                lc.marginM * 1000, lc.pIn, verdictName(lc.verdict));
    CHECK(lc.verdict == Verdict::In || lc.verdict == Verdict::NoCall,
          "near-line ball never called OUT here");

    // Abstention: 5 mm out with 20 mm σ.
    FusedContact weak;
    weak.valid = true;
    weak.xy = {court::kHalfWidth + 0.017, 4.0};
    weak.cov = Cov2::isotropic(0.020 * 0.020);
    weak.nCameras = 1;
    LineCall wc = de.decide(weak, ctx);
    CHECK(wc.verdict == Verdict::NoCall, "too-close-to-call abstains (p=%.2f)",
          wc.pIn);

    // Serve fault typing.
    CallContext serve; serve.type = CallContext::Type::Serve;
    serve.targetSide = Side::B; serve.boxSignX = +1;
    FusedContact shortServe;
    shortServe.valid = true;
    shortServe.xy = {1.5, court::kNvzDepth - 0.10};
    shortServe.cov = Cov2::isotropic(0.010 * 0.010);
    shortServe.nCameras = 2;
    LineCall sc2 = de.decide(shortServe, serve);
    CHECK(sc2.verdict == Verdict::Fault, "short serve ⇒ FAULT, got %s",
          verdictName(sc2.verdict));
}

// ---------------------------------------------------------------------------
// Two engines, two synthetic cameras, a real clock offset between them, the
// wire protocol in the middle. The full product, in miniature.
// ---------------------------------------------------------------------------
static void testDualEngineEndToEnd() {
    std::puts("[dual-camera end-to-end]");
    std::mt19937 rng(2024);
    std::normal_distribution<double> Npx(0.0, 0.7);

    SynthCam camA = standardCam();
    SynthCam camB = SynthCam::lookAt({5.0, 0.5, 2.8}, {0.2, 4.4, 0.0},
                                     2450.0, 3840, 2160);
    const double thetaBA = 12.345; // B's clock = A's clock + θ

    Engine A((Engine::Config())), B((Engine::Config()));
    auto pa = calibPairs(camA, rng, 0.5,
        {B_BASELINE_LEFT, B_BASELINE_CENTER, B_BASELINE_RIGHT,
         B_NVZ_LEFT, B_NVZ_CENTER, B_NVZ_RIGHT});
    auto pb = calibPairs(camB, rng, 0.5,
        {B_BASELINE_LEFT, B_BASELINE_CENTER, B_BASELINE_RIGHT,
         B_NVZ_LEFT, B_NVZ_CENTER, B_NVZ_RIGHT});
    CHECK(A.calibrate(3840, 2160, pa).ok, "A calibrated");
    CHECK(B.calibrate(3840, 2160, pb).ok, "B calibrated");
    A.setPeerConnected(true); B.setPeerConnected(true);
    CallContext ctx; ctx.targetSide = Side::B;
    A.setContext(ctx); B.setContext(ctx);

    // Sync A's clock model of B (A initiates pings).
    std::exponential_distribution<double> jit(1.0 / 0.0012);
    for (int i = 0; i < 30; ++i) {
        double t1 = 1.0 + i * 0.2;
        double t2 = t1 + 0.002 + jit(rng) + thetaBA;
        double t3 = t2 + 0.0003;
        double t4 = t3 - thetaBA + 0.002 + jit(rng);
        A.feedSyncSample(t1, t2, t3, t4);
    }
    CHECK(A.status().clockLocked, "A↔B clock locked (unc %.2f ms)",
          A.status().clockUncertaintyMs);

    // Ball clips the line: centre 8 mm OUTSIDE the outer edge — patch
    // overlaps the line ⇒ correct answer is IN by ~4 mm of margin. This is
    // exactly the ±1 cm regime where single-camera σ makes it a coin flip and
    // fusion has to earn its keep.
    BounceSim sim;
    sim.xyContact = {court::kHalfWidth + 0.008, 5.1};
    sim.tb = 30.4123;
    sim.vXYin = {1.9, 3.8}; sim.vXYout = {1.5, 3.0};
    sim.wIn = 4.8; sim.e = 0.55;

    const double fps = 60.0;
    for (int k = 0; k < 40; ++k) {
        double tA = sim.tb - 0.33 + k / fps;      // A's clock
        Vec3 P = sim.center(tA);
        Vec2 px;
        if (camA.project(P, px))
            A.feedDetection(tA, px.x + Npx(rng), px.y + Npx(rng), 14, 0.9);
        if (camB.project(P, px))
            B.feedDetection(tA + thetaBA, px.x + Npx(rng), px.y + Npx(rng), 14, 0.9);
    }

    // Move B's outbound contact over the "wire" into A.
    std::vector<OutboundContact> obB; std::vector<LineCall> cB;
    B.poll(sim.tb + thetaBA + 1.0, obB, cB);
    CHECK(obB.size() == 1, "B produced its contact estimate");
    for (const auto& oc : obB) A.feedRemoteContact(oc);

    std::vector<OutboundContact> obA; std::vector<LineCall> cA;
    A.poll(sim.tb + 1.0, obA, cA);
    CHECK(cA.size() == 1, "A emitted exactly one fused call (got %zu)",
          cA.size());
    if (!cA.empty()) {
        const LineCall& c = cA[0];
        double err = (c.contact - sim.xyContact).norm();
        std::printf("  fused: err = %.1f mm, sigma = %.1f mm, cams = %d, "
                    "consistent = %d, p(in) = %.3f → %s (margin %.1f mm)\n",
                    err * 1000, c.sigmaM * 1000, c.camerasUsed,
                    (int)c.fusedConsistent, c.pIn, verdictName(c.verdict),
                    c.marginM * 1000);
        CHECK(c.camerasUsed == 2 && c.fusedConsistent, "true 2-camera fusion");
        CHECK(err < 0.020, "fused contact within 20 mm (%.1f)", err * 1000);
        CHECK(c.verdict != Verdict::Out,
              "line-clipping ball is never called OUT");
    }
}


// ---------------------------------------------------------------------------
// Browser reality: each device adds an unknown constant capture->callback
// latency that clock sync cannot observe. Device B here is 45 ms "late".
// Without latency learning the 10 ms association gate rejects every true
// pair; the engine must learn the offset from spatially-agreeing contacts and
// end up producing genuine 2-camera fusions.
// ---------------------------------------------------------------------------
static void testLatencyLearning() {
    std::puts("[inter-device latency learning]");
    std::mt19937 rng(77);
    std::normal_distribution<double> Npx(0.0, 0.7);

    SynthCam camA = standardCam();
    SynthCam camB = SynthCam::lookAt({5.0, 0.5, 2.8}, {0.2, 4.4, 0.0},
                                     2450.0, 3840, 2160);
    const double thetaBA = 3.21;
    const double latencyB = 0.045;   // B's frames are stamped 45 ms late

    Engine A((Engine::Config())), B((Engine::Config()));
    auto pa = calibPairs(camA, rng, 0.5, {B_BASELINE_LEFT, B_BASELINE_CENTER,
        B_BASELINE_RIGHT, B_NVZ_LEFT, B_NVZ_CENTER, B_NVZ_RIGHT});
    auto pb = calibPairs(camB, rng, 0.5, {B_BASELINE_LEFT, B_BASELINE_CENTER,
        B_BASELINE_RIGHT, B_NVZ_LEFT, B_NVZ_CENTER, B_NVZ_RIGHT});
    A.calibrate(3840, 2160, pa); B.calibrate(3840, 2160, pb);
    A.setPeerConnected(true); B.setPeerConnected(true);
    CallContext ctx; ctx.targetSide = Side::B;
    A.setContext(ctx); B.setContext(ctx);

    std::exponential_distribution<double> jit(1.0 / 0.0012);
    for (int i = 0; i < 30; ++i) {
        double t1 = 1.0 + i * 0.2;
        double t2 = t1 + 0.002 + jit(rng) + thetaBA;
        double t3 = t2 + 0.0003;
        double t4 = t3 - thetaBA + 0.002 + jit(rng);
        A.feedSyncSample(t1, t2, t3, t4);
    }

    const Vec2 spots[6] = {{1.2, 4.0}, {-1.8, 5.5}, {2.5, 3.1},
                           {-0.6, 6.0}, {0.9, 2.8}, {-2.2, 4.4}};
    int fused = 0, total = 0;
    for (int b = 0; b < 6; ++b) {
        BounceSim sim;
        sim.xyContact = spots[b];
        sim.tb = 50.0 + 2.0 * b + 0.0137 * b;
        sim.vXYin = {0.8, 3.2}; sim.vXYout = {0.6, 2.6};
        sim.wIn = 4.6; sim.e = 0.55;
        for (int k = 0; k < 40; ++k) {
            double tA = sim.tb - 0.33 + k / 60.0;
            Vec3 P = sim.center(tA);
            Vec2 px;
            if (camA.project(P, px)) {
                double nv = Npx(rng), nu = Npx(rng);
                A.feedDetection(tA, px.x + nu, px.y + nv, 14, 0.9);
            }
            if (camB.project(P, px)) {
                double nv = Npx(rng), nu = Npx(rng);
                B.feedDetection(tA + thetaBA + latencyB, px.x + nu, px.y + nv, 14, 0.9);
            }
        }
        std::vector<OutboundContact> obB; std::vector<LineCall> cB;
        B.poll(sim.tb + thetaBA + 1.0, obB, cB);
        for (const auto& oc : obB) A.feedRemoteContact(oc);
        std::vector<OutboundContact> obA; std::vector<LineCall> cA;
        A.poll(sim.tb + 1.0, obA, cA);
        for (const auto& c : cA) { ++total; if (c.camerasUsed == 2) ++fused; }
    }
    double off = A.learnedLatencyOffsetS();
    std::printf("  learned offset = %.1f ms (true %.1f), fused %d/%d calls\n",
                off * 1000, latencyB * 1000, fused, total);
    CHECK(total == 6, "one call per bounce (got %d)", total);
    CHECK(fused == 6, "every bounce fused across both cameras (got %d)", fused);
    CHECK(std::fabs(off - latencyB) < 0.006, "offset within 6 ms of truth");
}

// ---------------------------------------------------------------------------
int main() {
    testMath();
    testCourt();
    testCameraAndParallax();
    testBounceEndToEnd();
    testClockSync();
    testFusionAndDecision();
    testDualEngineEndToEnd();
    testLatencyLearning();
    std::printf("\n%d passed, %d failed\n", g_pass, g_fail);
    return g_fail == 0 ? 0 : 1;
}
