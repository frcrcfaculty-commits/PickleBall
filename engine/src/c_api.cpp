// c_api.cpp — flat C ABI over pbj::Engine for WebAssembly.
//
// Deliberately primitive: doubles and ints only, one global engine, one shared
// I/O buffer in linear memory. No Embind, no generated glue — the JS side
// (web/src/core/engine.ts) is ~150 lines and fully auditable. Every function
// here is exported with the `pbj_` prefix.
//
// Buffer layout produced by pbj_poll():
//   buf[0] = nOutbound, buf[1] = nCalls
//   then nOutbound records of OUT_STRIDE doubles:
//     t, tSigma, x, y, covXX, covXY, covYY, evidenceZ, parallaxCorrected
//   then nCalls records of CALL_STRIDE doubles:
//     verdict(0 IN,1 OUT,2 FAULT,3 NO_CALL), pIn, marginM, sigmaM,
//     nearestLineId, x, y, t, cameras, consistent, parallaxCorrected
//
// Keep these strides in sync with web/src/core/engine.ts (asserted at load
// time through pbj_abi_version / pbj_strides).

#include "pbj/engine.hpp"
#include <cstring>
#include <string>

#if defined(__wasm__)
#define PBJ_EXPORT(name) __attribute__((export_name(#name)))
#else
#define PBJ_EXPORT(name)
#endif

using namespace pbj;

namespace {
constexpr int kAbiVersion = 1;
constexpr int OUT_STRIDE = 9;
constexpr int CALL_STRIDE = 11;
constexpr int kBufDoubles = 4096;
constexpr int kInDoubles = 256;

Engine* g_engine = nullptr;
double g_buf[kBufDoubles];
double g_in[kInDoubles];

Engine& eng() {
    if (!g_engine) g_engine = new Engine();
    return *g_engine;
}

const char* kLineNames[] = {"", "sideline_left", "sideline_right", "baseline",
                            "net", "nvz_line", "centerline"};
int lineId(const char* name) {
    for (int i = 1; i < 7; ++i)
        if (std::strcmp(name, kLineNames[i]) == 0) return i;
    return 0;
}
} // namespace

extern "C" {

PBJ_EXPORT(pbj_abi_version) int pbj_abi_version() { return kAbiVersion; }
PBJ_EXPORT(pbj_out_stride)  int pbj_out_stride()  { return OUT_STRIDE; }
PBJ_EXPORT(pbj_call_stride) int pbj_call_stride() { return CALL_STRIDE; }
PBJ_EXPORT(pbj_buffer)      double* pbj_buffer()  { return g_buf; }
PBJ_EXPORT(pbj_input)       double* pbj_input()   { return g_in; }
PBJ_EXPORT(pbj_buffer_len)  int pbj_buffer_len()  { return kBufDoubles; }
PBJ_EXPORT(pbj_input_len)   int pbj_input_len()   { return kInDoubles; }

PBJ_EXPORT(pbj_reset_engine) void pbj_reset_engine() {
    delete g_engine;
    g_engine = new Engine();
}

PBJ_EXPORT(pbj_set_intrinsics)
void pbj_set_intrinsics(double f, double cx, double cy) {
    eng().setKnownIntrinsics(f, cx, cy);
}

// Pairs are read from pbj_input(): [courtX, courtY, u, v] * n.
// Returns bit0 = ok, bit1 = pose valid. Reprojection RMS via pbj_status().
PBJ_EXPORT(pbj_calibrate)
int pbj_calibrate(double imageW, double imageH, int nPairs) {
    if (nPairs < 0 || nPairs * 4 > kInDoubles) return 0;
    std::vector<Correspondence> pairs;
    for (int i = 0; i < nPairs; ++i) {
        pairs.push_back({{g_in[4 * i], g_in[4 * i + 1]},
                         {g_in[4 * i + 2], g_in[4 * i + 3]}});
    }
    auto r = eng().calibrate(imageW, imageH, pairs);
    auto st = eng().status();
    return (r.ok ? 1 : 0) | (st.poseValid ? 2 : 0);
}

PBJ_EXPORT(pbj_set_context)
void pbj_set_context(int type, int targetSide, int boxSignX) {
    CallContext c;
    c.type = type ? CallContext::Type::Serve : CallContext::Type::Rally;
    c.targetSide = targetSide ? Side::B : Side::A;
    c.boxSignX = boxSignX >= 0 ? +1 : -1;
    eng().setContext(c);
}

PBJ_EXPORT(pbj_set_peer) void pbj_set_peer(int connected) {
    eng().setPeerConnected(connected != 0);
}

PBJ_EXPORT(pbj_set_rolling_shutter)
void pbj_set_rolling_shutter(double readoutS, double imageH) {
    eng().setRollingShutter(readoutS, imageH);
}

PBJ_EXPORT(pbj_feed_detection)
void pbj_feed_detection(double t, double u, double v, double r, double score) {
    eng().feedDetection(t, u, v, r, score);
}

PBJ_EXPORT(pbj_feed_sync)
void pbj_feed_sync(double t1, double t2, double t3, double t4) {
    eng().feedSyncSample(t1, t2, t3, t4);
}

PBJ_EXPORT(pbj_feed_remote)
void pbj_feed_remote(double t, double tSigma, double x, double y,
                     double cxx, double cxy, double cyy, double z, int pc) {
    OutboundContact rc;
    rc.tContactLocal = t; rc.tSigma = tSigma;
    rc.x = x; rc.y = y;
    rc.covXX = cxx; rc.covXY = cxy; rc.covYY = cyy;
    rc.evidenceZ = z; rc.parallaxCorrected = pc != 0;
    eng().feedRemoteContact(rc);
}

// Writes u, v to g_buf[0..1]. Returns 1 on success.
PBJ_EXPORT(pbj_ground_to_image) int pbj_ground_to_image(double x, double y) {
    double u, v;
    if (!eng().groundToImage(x, y, u, v)) return 0;
    g_buf[0] = u; g_buf[1] = v;
    return 1;
}

// Writes the 3x3 ground homography (court m -> px) row-major to g_buf[0..8].
PBJ_EXPORT(pbj_ground_homography) int pbj_ground_homography() {
    return eng().groundHomography(g_buf) ? 1 : 0;
}

PBJ_EXPORT(pbj_reset_play) void pbj_reset_play() { eng().resetPlay(); }

PBJ_EXPORT(pbj_poll) int pbj_poll(double now) {
    std::vector<OutboundContact> ob;
    std::vector<LineCall> calls;
    eng().poll(now, ob, calls);

    const int maxRecords = (kBufDoubles - 2) / CALL_STRIDE;
    int nOb = std::min<int>(ob.size(), maxRecords / 2);
    int nCalls = std::min<int>(calls.size(), maxRecords / 2);
    g_buf[0] = nOb;
    g_buf[1] = nCalls;
    double* p = g_buf + 2;
    for (int i = 0; i < nOb; ++i) {
        const auto& o = ob[i];
        const double rec[OUT_STRIDE] = {o.tContactLocal, o.tSigma, o.x, o.y,
            o.covXX, o.covXY, o.covYY, o.evidenceZ,
            o.parallaxCorrected ? 1.0 : 0.0};
        std::memcpy(p, rec, sizeof(rec)); p += OUT_STRIDE;
    }
    for (int i = 0; i < nCalls; ++i) {
        const auto& c = calls[i];
        const double rec[CALL_STRIDE] = {
            static_cast<double>(static_cast<int>(c.verdict)), c.pIn, c.marginM,
            c.sigmaM, static_cast<double>(lineId(c.nearestLine)),
            c.contact.x, c.contact.y, c.tContact,
            static_cast<double>(c.camerasUsed), c.fusedConsistent ? 1.0 : 0.0,
            c.parallaxCorrected ? 1.0 : 0.0};
        std::memcpy(p, rec, sizeof(rec)); p += CALL_STRIDE;
    }
    return nOb + nCalls;
}

// Fills g_buf[0..11]: calibrated, poseValid, reprojRmsPx, cameraHeightM,
// focalPx, clockLocked, clockUncertaintyMs, clockDriftPpm, trackLength,
// peerConnected, latencyOffsetMs, latencySamples.
PBJ_EXPORT(pbj_status) void pbj_status() {
    auto s = eng().status();
    const double v[12] = {s.calibrated ? 1.0 : 0.0, s.poseValid ? 1.0 : 0.0,
        s.reprojRmsPx, s.cameraHeightM, s.focalPx, s.clockLocked ? 1.0 : 0.0,
        s.clockUncertaintyMs, s.clockDriftPpm,
        static_cast<double>(s.trackLength), s.peerConnected ? 1.0 : 0.0,
        eng().learnedLatencyOffsetS() * 1000.0,
        static_cast<double>(eng().latencySamples())};
    std::memcpy(g_buf, v, sizeof(v));
}

} // extern "C"
