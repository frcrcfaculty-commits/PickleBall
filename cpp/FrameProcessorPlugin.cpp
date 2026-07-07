/**
 * FrameProcessorPlugin.cpp
 * 
 * VisionCamera Frame Processor Plugin that bridges the React Native JS layer
 * to the C++ OpenCV pipeline. Registered as a JSI worklet function that runs
 * synchronously on the camera's native thread.
 * 
 * This is the entry point called for every camera frame at 60-120 FPS.
 * It orchestrates: CVPipeline → BallTracker → BounceDetector
 * and returns a lightweight result object to JavaScript.
 * 
 * Key design decisions:
 * - Zero-copy frame access via VisionCamera's buffer pointer
 * - All cv::Mat objects are pre-allocated (no per-frame heap allocation)
 * - Returns only primitive types to JS (no Mat or complex objects cross bridge)
 * - Thread-safe: all state is owned by a single pipeline instance per device
 */

#include "CVPipeline.h"
#include "BallTracker.h"
#include "BounceDetector.h"
#include "HomographyCalibrator.h"

#include <memory>
#include <mutex>

// Platform-specific includes for VisionCamera plugin registration
#if defined(__APPLE__)
#include <VisionCamera/FrameProcessorPlugin.h>
#include <VisionCamera/FrameProcessorPluginHostObject.h>
#include <VisionCamera/Frame.h>
#else
// Android JNI includes
#include <jni.h>
#include <fbjni/fbjni.h>
#endif

namespace picklejudge {

/**
 * Global pipeline state — singleton per device.
 * Protected by mutex for thread safety during config changes.
 */
class PickleJudgePipeline {
public:
    static PickleJudgePipeline& instance() {
        static PickleJudgePipeline inst;
        return inst;
    }

    struct FrameResult {
        bool   ballFound;
        float  pixelX;
        float  pixelY;
        float  courtX;
        float  courtY;
        float  radius;
        float  confidence;
        bool   isBounce;
        float  bounceCourtX;
        float  bounceCourtY;
        double bounceTimestamp;
        float  bounceConfidence;
        int    trackingState;   // 0=not tracking, 1=tracking, 2=coasting
    };

    /**
     * Process a single camera frame through the full pipeline.
     * 
     * @param frameBuffer   Raw pixel data from camera
     * @param width         Frame width
     * @param height        Frame height
     * @param timestamp     Synchronized timestamp (from ClockSync)
     * @param bytesPerRow   Stride of the frame buffer
     * @return              Lightweight result for JS consumption
     */
    FrameResult processFrame(
        const uint8_t* frameBuffer,
        int width,
        int height,
        double timestamp,
        int bytesPerRow)
    {
        std::lock_guard<std::mutex> lock(m_configMutex);

        FrameResult result = {};
        result.ballFound = false;
        result.isBounce = false;
        result.trackingState = m_tracker.isTracking() ? 1 : 0;

        // Step 1: Determine ROI from tracker prediction
        cv::Rect roi;
        if (m_tracker.isTracking()) {
            roi = m_tracker.getPredictedROI(width, height, 100);
            result.trackingState = m_tracker.getCoastCount() > 0 ? 2 : 1;
        }

        // Step 2: Run CV pipeline (color filtering + contour detection)
        auto cvResult = m_cvPipeline.processFrame(
            frameBuffer, width, height, roi, timestamp);

        // Step 3: Update ball tracker with detection result
        std::optional<Detection> detection;
        if (cvResult.found) {
            detection = Detection{
                cvResult.x,
                cvResult.y,
                cvResult.radius,
                cvResult.confidence,
                timestamp
            };
        }

        auto trackPoint = m_tracker.update(detection, timestamp);

        if (trackPoint.has_value()) {
            result.ballFound = true;
            result.pixelX    = static_cast<float>(trackPoint->pixelX);
            result.pixelY    = static_cast<float>(trackPoint->pixelY);
            result.radius    = static_cast<float>(trackPoint->radius);
            result.confidence = static_cast<float>(trackPoint->confidence);

            // Step 4: Transform to court coordinates if calibrated
            if (m_calibrator.isCalibrated()) {
                auto courtPt = m_calibrator.pixelToCourtCoord(
                    result.pixelX, result.pixelY);
                result.courtX = courtPt.x;
                result.courtY = courtPt.y;

                // Update the track point's court coordinates in history
                // (needed by bounce detector)
                auto& history = const_cast<std::deque<TrackPoint>&>(
                    m_tracker.getHistory());
                if (!history.empty()) {
                    history.back().courtX = courtPt.x;
                    history.back().courtY = courtPt.y;
                }
            }

            // Step 5: Check for bounce
            auto bounceResult = m_bounceDetector.detect(m_tracker.getHistory());
            if (bounceResult.detected) {
                result.isBounce       = true;
                result.bounceCourtX   = static_cast<float>(bounceResult.courtX);
                result.bounceCourtY   = static_cast<float>(bounceResult.courtY);
                result.bounceTimestamp = bounceResult.timestamp;
                result.bounceConfidence = static_cast<float>(bounceResult.confidence);
            }
        }

        result.trackingState = m_tracker.isTracking() ?
            (m_tracker.getCoastCount() > 0 ? 2 : 1) : 0;

        return result;
    }

    /**
     * Set the homography matrix for court coordinate mapping.
     * Called from JS when calibration is completed.
     */
    void setCalibration(const std::vector<double>& homographyData) {
        std::lock_guard<std::mutex> lock(m_configMutex);
        m_calibrator.deserializeHomography(homographyData);
    }

    /**
     * Set calibration from 4 image corner points.
     */
    void calibrateFromCorners(
        const std::vector<cv::Point2f>& corners,
        bool isNearSide)
    {
        std::lock_guard<std::mutex> lock(m_configMutex);
        m_calibrator.computeHomography(corners, isNearSide);
    }

    /**
     * Update color profile for different ball types.
     */
    void setColorProfile(const ColorProfile& profile) {
        std::lock_guard<std::mutex> lock(m_configMutex);
        m_cvPipeline.setColorProfile(profile);
    }

    /**
     * Reset all pipeline state (new game).
     */
    void resetPipeline() {
        std::lock_guard<std::mutex> lock(m_configMutex);
        m_tracker.reset();
        m_bounceDetector.reset();
    }

    /**
     * Get the homography calibrator (for overlay generation).
     */
    const HomographyCalibrator& getCalibrator() const { return m_calibrator; }

private:
    PickleJudgePipeline() = default;

    CVPipeline            m_cvPipeline;
    BallTracker           m_tracker{30, 5};       // 30-frame history, 5-frame coast
    BounceDetector        m_bounceDetector;
    HomographyCalibrator  m_calibrator;
    std::mutex            m_configMutex;
};

} // namespace picklejudge

// =============================================================================
// VisionCamera Frame Processor Plugin Registration
// =============================================================================

#if defined(__APPLE__)

// iOS: Register as a VisionCamera Frame Processor Plugin
// This makes the function callable as `processPickleFrame(frame)` in JS worklets.

@interface PickleFrameProcessorPlugin : FrameProcessorPlugin
@end

@implementation PickleFrameProcessorPlugin

- (instancetype)initWithProxy:(VisionCameraProxyHolder*)proxy
                  withOptions:(NSDictionary* _Nullable)options {
    self = [super initWithProxy:proxy withOptions:options];
    return self;
}

- (id _Nullable)callback:(Frame* _Nonnull)frame
           withArguments:(NSDictionary* _Nullable)arguments {
    
    // Extract synchronized timestamp from arguments (passed from ClockSync.ts)
    double syncedTimestamp = 0.0;
    if (arguments[@"timestamp"]) {
        syncedTimestamp = [arguments[@"timestamp"] doubleValue];
    }

    // Get the pixel buffer from the frame
    CVPixelBufferRef pixelBuffer = CMSampleBufferGetImageBuffer(frame.buffer);
    if (!pixelBuffer) return nil;

    CVPixelBufferLockBaseAddress(pixelBuffer, kCVPixelBufferLock_ReadOnly);

    int width  = (int)CVPixelBufferGetWidth(pixelBuffer);
    int height = (int)CVPixelBufferGetHeight(pixelBuffer);
    int bytesPerRow = (int)CVPixelBufferGetBytesPerRow(pixelBuffer);
    const uint8_t* baseAddress = (const uint8_t*)CVPixelBufferGetBaseAddress(pixelBuffer);

    // Run the pipeline
    auto result = picklejudge::PickleJudgePipeline::instance().processFrame(
        baseAddress, width, height, syncedTimestamp, bytesPerRow);

    CVPixelBufferUnlockBaseAddress(pixelBuffer, kCVPixelBufferLock_ReadOnly);

    // Return lightweight dictionary to JS
    return @{
        @"ballFound":       @(result.ballFound),
        @"pixelX":          @(result.pixelX),
        @"pixelY":          @(result.pixelY),
        @"courtX":          @(result.courtX),
        @"courtY":          @(result.courtY),
        @"radius":          @(result.radius),
        @"confidence":      @(result.confidence),
        @"isBounce":        @(result.isBounce),
        @"bounceCourtX":    @(result.bounceCourtX),
        @"bounceCourtY":    @(result.bounceCourtY),
        @"bounceTimestamp":  @(result.bounceTimestamp),
        @"bounceConfidence": @(result.bounceConfidence),
        @"trackingState":   @(result.trackingState),
    };
}

VISION_EXPORT_FRAME_PROCESSOR(PickleFrameProcessorPlugin, processPickleFrame)

@end

#else // Android

// Android: Register via JNI for VisionCamera Frame Processor
// The frame data is passed as a direct ByteBuffer from Camera2 API

extern "C" {

JNIEXPORT jobject JNICALL
Java_com_picklejudge_PickleFrameProcessor_processFrame(
    JNIEnv* env,
    jobject thiz,
    jobject frameBuffer,
    jint width,
    jint height,
    jdouble timestamp,
    jint bytesPerRow)
{
    auto* buffer = static_cast<uint8_t*>(
        env->GetDirectBufferAddress(frameBuffer));

    if (!buffer) return nullptr;

    auto result = picklejudge::PickleJudgePipeline::instance().processFrame(
        buffer, width, height, timestamp, bytesPerRow);

    // Create a HashMap to return to JS
    jclass hashMapClass = env->FindClass("java/util/HashMap");
    jmethodID hashMapInit = env->GetMethodID(hashMapClass, "<init>", "()V");
    jmethodID putMethod = env->GetMethodID(hashMapClass, "put",
        "(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;");

    jobject hashMap = env->NewObject(hashMapClass, hashMapInit);

    auto putBool = [&](const char* key, bool val) {
        jclass boolClass = env->FindClass("java/lang/Boolean");
        jmethodID valueOf = env->GetStaticMethodID(boolClass, "valueOf",
            "(Z)Ljava/lang/Boolean;");
        env->CallObjectMethod(hashMap, putMethod,
            env->NewStringUTF(key),
            env->CallStaticObjectMethod(boolClass, valueOf, val));
    };

    auto putFloat = [&](const char* key, float val) {
        jclass floatClass = env->FindClass("java/lang/Float");
        jmethodID valueOf = env->GetStaticMethodID(floatClass, "valueOf",
            "(F)Ljava/lang/Float;");
        env->CallObjectMethod(hashMap, putMethod,
            env->NewStringUTF(key),
            env->CallStaticObjectMethod(floatClass, valueOf, val));
    };

    auto putDouble = [&](const char* key, double val) {
        jclass doubleClass = env->FindClass("java/lang/Double");
        jmethodID valueOf = env->GetStaticMethodID(doubleClass, "valueOf",
            "(D)Ljava/lang/Double;");
        env->CallObjectMethod(hashMap, putMethod,
            env->NewStringUTF(key),
            env->CallStaticObjectMethod(doubleClass, valueOf, val));
    };

    auto putInt = [&](const char* key, int val) {
        jclass intClass = env->FindClass("java/lang/Integer");
        jmethodID valueOf = env->GetStaticMethodID(intClass, "valueOf",
            "(I)Ljava/lang/Integer;");
        env->CallObjectMethod(hashMap, putMethod,
            env->NewStringUTF(key),
            env->CallStaticObjectMethod(intClass, valueOf, val));
    };

    putBool("ballFound", result.ballFound);
    putFloat("pixelX", result.pixelX);
    putFloat("pixelY", result.pixelY);
    putFloat("courtX", result.courtX);
    putFloat("courtY", result.courtY);
    putFloat("radius", result.radius);
    putFloat("confidence", result.confidence);
    putBool("isBounce", result.isBounce);
    putFloat("bounceCourtX", result.bounceCourtX);
    putFloat("bounceCourtY", result.bounceCourtY);
    putDouble("bounceTimestamp", result.bounceTimestamp);
    putFloat("bounceConfidence", result.bounceConfidence);
    putInt("trackingState", result.trackingState);

    return hashMap;
}

// Calibration JNI
JNIEXPORT void JNICALL
Java_com_picklejudge_PickleFrameProcessor_calibrate(
    JNIEnv* env,
    jobject thiz,
    jfloatArray corners,
    jboolean isNearSide)
{
    jfloat* cornerData = env->GetFloatArrayElements(corners, nullptr);
    jsize len = env->GetArrayLength(corners);

    if (len == 8) {
        std::vector<cv::Point2f> pts = {
            {cornerData[0], cornerData[1]},
            {cornerData[2], cornerData[3]},
            {cornerData[4], cornerData[5]},
            {cornerData[6], cornerData[7]}
        };
        picklejudge::PickleJudgePipeline::instance().calibrateFromCorners(
            pts, isNearSide);
    }

    env->ReleaseFloatArrayElements(corners, cornerData, 0);
}

JNIEXPORT void JNICALL
Java_com_picklejudge_PickleFrameProcessor_resetPipeline(
    JNIEnv* env, jobject thiz)
{
    picklejudge::PickleJudgePipeline::instance().resetPipeline();
}

} // extern "C"

#endif // Platform
