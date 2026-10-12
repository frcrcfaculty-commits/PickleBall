// PBJEngineJSI.cpp — JSI binding for the pbj engine.
// Drop into repo cpp/ alongside FrameProcessorPlugin.cpp. Register from your
// existing JSI install point (or the VisionCamera plugin's install hook):
//
//     #include "PBJEngineJSI.cpp"   // or add to CMake sources
//     pbj::installJSI(runtime);
//
// Android CMakeLists: add_subdirectory(../engine engine) and link pbj_engine.
// iOS podspec: add engine/src/*.cpp and engine/include to the pod sources.
//
// All methods are plain-number in/out (no JSON parsing on the hot path).
// feedDetection is safe to call from the frame-processor worklet thread; the
// engine's internal mutex handles cross-thread access.

#include <jsi/jsi.h>
#include <memory>
#include "pbj/engine.hpp"

namespace pbj {
using namespace facebook;

static std::shared_ptr<Engine> gEngine;

static jsi::Value makeFn(jsi::Runtime& rt, const char* name, unsigned argc,
                         jsi::HostFunctionType fn) {
    return jsi::Function::createFromHostFunction(
        rt, jsi::PropNameID::forAscii(rt, name), argc, std::move(fn));
}

void installJSI(jsi::Runtime& rt) {
    if (!gEngine) gEngine = std::make_shared<Engine>();
    auto obj = jsi::Object(rt);

    // calibrate(imageW, imageH, flatPairs: number[])  → {ok, error, poseValid, reprojRmsPx}
    // flatPairs = [courtX, courtY, imageU, imageV] * N
    obj.setProperty(rt, "calibrate", makeFn(rt, "calibrate", 3,
        [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* a, size_t) {
            double w = a[0].asNumber(), h = a[1].asNumber();
            auto arr = a[2].asObject(rt).asArray(rt);
            std::vector<Correspondence> pairs;
            size_t n = arr.size(rt);
            for (size_t i = 0; i + 3 < n; i += 4) {
                pairs.push_back({{arr.getValueAtIndex(rt, i).asNumber(),
                                  arr.getValueAtIndex(rt, i + 1).asNumber()},
                                 {arr.getValueAtIndex(rt, i + 2).asNumber(),
                                  arr.getValueAtIndex(rt, i + 3).asNumber()}});
            }
            auto res = gEngine->calibrate(w, h, pairs);
            auto st = gEngine->status();
            auto out = jsi::Object(rt);
            out.setProperty(rt, "ok", res.ok);
            out.setProperty(rt, "error", jsi::String::createFromUtf8(rt, res.error));
            out.setProperty(rt, "poseValid", st.poseValid);
            out.setProperty(rt, "reprojRmsPx", st.reprojRmsPx);
            return jsi::Value(rt, out);
        }));

    // setKnownIntrinsics(f, cx, cy) — pass factory intrinsics when available
    obj.setProperty(rt, "setKnownIntrinsics", makeFn(rt, "setKnownIntrinsics", 3,
        [](jsi::Runtime&, const jsi::Value&, const jsi::Value* a, size_t) {
            gEngine->setKnownIntrinsics(a[0].asNumber(), a[1].asNumber(),
                                        a[2].asNumber());
            return jsi::Value::undefined();
        }));

    // feedDetection(tSeconds, u, v, radiusPx, score) — WORKLET THREAD OK
    obj.setProperty(rt, "feedDetection", makeFn(rt, "feedDetection", 5,
        [](jsi::Runtime&, const jsi::Value&, const jsi::Value* a, size_t) {
            gEngine->feedDetection(a[0].asNumber(), a[1].asNumber(),
                                   a[2].asNumber(), a[3].asNumber(),
                                   a[4].asNumber());
            return jsi::Value::undefined();
        }));

    // feedSyncSample(t1, t2, t3, t4)  — seconds, this device initiated
    obj.setProperty(rt, "feedSyncSample", makeFn(rt, "feedSyncSample", 4,
        [](jsi::Runtime&, const jsi::Value&, const jsi::Value* a, size_t) {
            gEngine->feedSyncSample(a[0].asNumber(), a[1].asNumber(),
                                    a[2].asNumber(), a[3].asNumber());
            return jsi::Value::undefined();
        }));

    // feedRemoteContact(t, tSigma, x, y, cxx, cxy, cyy, evidenceZ, parallaxOk)
    obj.setProperty(rt, "feedRemoteContact", makeFn(rt, "feedRemoteContact", 9,
        [](jsi::Runtime&, const jsi::Value&, const jsi::Value* a, size_t) {
            OutboundContact rc;
            rc.tContactLocal = a[0].asNumber(); rc.tSigma = a[1].asNumber();
            rc.x = a[2].asNumber(); rc.y = a[3].asNumber();
            rc.covXX = a[4].asNumber(); rc.covXY = a[5].asNumber();
            rc.covYY = a[6].asNumber();
            rc.evidenceZ = a[7].asNumber();
            rc.parallaxCorrected = a[8].getBool();
            gEngine->feedRemoteContact(rc);
            return jsi::Value::undefined();
        }));

    // setContext(type: 0 rally | 1 serve, targetSide: 0 A | 1 B, boxSignX)
    obj.setProperty(rt, "setContext", makeFn(rt, "setContext", 3,
        [](jsi::Runtime&, const jsi::Value&, const jsi::Value* a, size_t) {
            CallContext c;
            c.type = a[0].asNumber() > 0.5 ? CallContext::Type::Serve
                                           : CallContext::Type::Rally;
            c.targetSide = a[1].asNumber() > 0.5 ? Side::B : Side::A;
            c.boxSignX = a[2].asNumber() >= 0 ? +1 : -1;
            gEngine->setContext(c);
            return jsi::Value::undefined();
        }));

    obj.setProperty(rt, "setPeerConnected", makeFn(rt, "setPeerConnected", 1,
        [](jsi::Runtime&, const jsi::Value&, const jsi::Value* a, size_t) {
            gEngine->setPeerConnected(a[0].getBool());
            return jsi::Value::undefined();
        }));

    obj.setProperty(rt, "setRollingShutter", makeFn(rt, "setRollingShutter", 2,
        [](jsi::Runtime&, const jsi::Value&, const jsi::Value* a, size_t) {
            gEngine->setRollingShutter(a[0].asNumber(), a[1].asNumber());
            return jsi::Value::undefined();
        }));

    obj.setProperty(rt, "resetPlay", makeFn(rt, "resetPlay", 0,
        [](jsi::Runtime&, const jsi::Value&, const jsi::Value*, size_t) {
            gEngine->resetPlay();
            return jsi::Value::undefined();
        }));

    // poll(nowSeconds) → { outbound: [...], calls: [...] }
    obj.setProperty(rt, "poll", makeFn(rt, "poll", 1,
        [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* a, size_t) {
            std::vector<OutboundContact> ob;
            std::vector<LineCall> calls;
            gEngine->poll(a[0].asNumber(), ob, calls);

            auto obArr = jsi::Array(rt, ob.size());
            for (size_t i = 0; i < ob.size(); ++i) {
                auto o = jsi::Object(rt);
                o.setProperty(rt, "t", ob[i].tContactLocal);
                o.setProperty(rt, "tSigma", ob[i].tSigma);
                o.setProperty(rt, "x", ob[i].x);
                o.setProperty(rt, "y", ob[i].y);
                o.setProperty(rt, "covXX", ob[i].covXX);
                o.setProperty(rt, "covXY", ob[i].covXY);
                o.setProperty(rt, "covYY", ob[i].covYY);
                o.setProperty(rt, "evidenceZ", ob[i].evidenceZ);
                o.setProperty(rt, "parallaxCorrected", ob[i].parallaxCorrected);
                obArr.setValueAtIndex(rt, i, o);
            }
            auto cArr = jsi::Array(rt, calls.size());
            for (size_t i = 0; i < calls.size(); ++i) {
                const LineCall& c = calls[i];
                auto o = jsi::Object(rt);
                o.setProperty(rt, "verdict",
                              jsi::String::createFromUtf8(rt, verdictName(c.verdict)));
                o.setProperty(rt, "pIn", c.pIn);
                o.setProperty(rt, "marginM", c.marginM);
                o.setProperty(rt, "sigmaM", c.sigmaM);
                o.setProperty(rt, "nearestLine",
                              jsi::String::createFromUtf8(rt, c.nearestLine));
                o.setProperty(rt, "x", c.contact.x);
                o.setProperty(rt, "y", c.contact.y);
                o.setProperty(rt, "t", c.tContact);
                o.setProperty(rt, "cameras", c.camerasUsed);
                o.setProperty(rt, "consistent", c.fusedConsistent);
                o.setProperty(rt, "parallaxCorrected", c.parallaxCorrected);
                cArr.setValueAtIndex(rt, i, o);
            }
            auto out = jsi::Object(rt);
            out.setProperty(rt, "outbound", obArr);
            out.setProperty(rt, "calls", cArr);
            return jsi::Value(rt, out);
        }));

    // status() → EngineStatus mirror
    obj.setProperty(rt, "status", makeFn(rt, "status", 0,
        [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value*, size_t) {
            auto st = gEngine->status();
            auto o = jsi::Object(rt);
            o.setProperty(rt, "calibrated", st.calibrated);
            o.setProperty(rt, "poseValid", st.poseValid);
            o.setProperty(rt, "reprojRmsPx", st.reprojRmsPx);
            o.setProperty(rt, "cameraHeightM", st.cameraHeightM);
            o.setProperty(rt, "focalPx", st.focalPx);
            o.setProperty(rt, "clockLocked", st.clockLocked);
            o.setProperty(rt, "clockUncertaintyMs", st.clockUncertaintyMs);
            o.setProperty(rt, "clockDriftPpm", st.clockDriftPpm);
            o.setProperty(rt, "trackLength", (double)st.trackLength);
            o.setProperty(rt, "peerConnected", st.peerConnected);
            return jsi::Value(rt, o);
        }));

    rt.global().setProperty(rt, "PBJEngine", obj);
}

} // namespace pbj
