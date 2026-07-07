cmake_minimum_required(VERSION 3.18)
project(PickleJudgeCpp CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ==============================================================================
# OpenCV Configuration
# ==============================================================================
# OpenCV must be pre-built for mobile targets (arm64-v8a, arm64).
# Set OPENCV_DIR to your OpenCV mobile SDK root:
#   iOS:     opencv2.framework path
#   Android: OpenCV-android-sdk/sdk/native/jni
#
# For iOS, use the xcframework variant:
#   set(OPENCV_DIR "${CMAKE_CURRENT_SOURCE_DIR}/third_party/opencv/ios")
# For Android, the path is set via gradle ndk configuration.
# ==============================================================================

if(ANDROID)
    # Android: OpenCV via pre-built static libs
    set(OpenCV_DIR "${CMAKE_CURRENT_SOURCE_DIR}/third_party/opencv/android/sdk/native/jni")
    find_package(OpenCV REQUIRED)
    
    # Android log library for __android_log_print
    find_library(log-lib log)
elseif(APPLE)
    # iOS: OpenCV via framework
    set(OPENCV_FRAMEWORK "${CMAKE_CURRENT_SOURCE_DIR}/third_party/opencv/ios/opencv2.framework")
    if(NOT EXISTS ${OPENCV_FRAMEWORK})
        message(FATAL_ERROR "OpenCV framework not found at ${OPENCV_FRAMEWORK}. "
                "Download from https://opencv.org/releases/ and place in third_party/opencv/ios/")
    endif()
endif()

# ==============================================================================
# PickleJudge C++ Core Library
# ==============================================================================
set(PICKLE_SOURCES
    cpp/CVPipeline.cpp
    cpp/HomographyCalibrator.cpp
    cpp/BallTracker.cpp
    cpp/BounceDetector.cpp
    cpp/FrameProcessorPlugin.cpp
)

set(PICKLE_HEADERS
    cpp/CVPipeline.h
    cpp/HomographyCalibrator.h
    cpp/BallTracker.h
    cpp/BounceDetector.h
)

# Build as shared library for React Native TurboModule / Frame Processor Plugin
add_library(picklejudge_cv SHARED ${PICKLE_SOURCES} ${PICKLE_HEADERS})

target_include_directories(picklejudge_cv PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/cpp
)

if(ANDROID)
    target_link_libraries(picklejudge_cv
        ${OpenCV_LIBS}
        ${log-lib}
    )
    target_include_directories(picklejudge_cv PRIVATE ${OpenCV_INCLUDE_DIRS})
elseif(APPLE)
    target_link_libraries(picklejudge_cv
        "-framework opencv2"
        "-framework Accelerate"
        "-framework CoreMedia"
        "-framework CoreVideo"
    )
    target_include_directories(picklejudge_cv PRIVATE
        "${OPENCV_FRAMEWORK}/Headers"
    )
    set_target_properties(picklejudge_cv PROPERTIES
        FRAMEWORK TRUE
        MACOSX_FRAMEWORK_IDENTIFIER com.picklejudge.cv
    )
endif()

# Compiler flags for performance
target_compile_options(picklejudge_cv PRIVATE
    -O3                    # Max optimization
    -ffast-math            # Aggressive floating point (safe for our use case)
    -DNDEBUG               # Disable asserts in release
    -fvisibility=hidden    # Reduce symbol table size
)

# ARM NEON optimizations (mobile ARM64)
if(CMAKE_SYSTEM_PROCESSOR MATCHES "aarch64|arm64")
    target_compile_options(picklejudge_cv PRIVATE
        -march=armv8-a+fp+simd
    )
endif()

# ==============================================================================
# Unit Tests (host build only — not for mobile)
# ==============================================================================
option(BUILD_TESTS "Build C++ unit tests" OFF)
if(BUILD_TESTS)
    enable_testing()
    find_package(GTest REQUIRED)
    
    add_executable(pickle_tests
        cpp/tests/test_homography.cpp
        cpp/tests/test_bounce_detector.cpp
        cpp/tests/test_ball_tracker.cpp
    )
    target_link_libraries(pickle_tests
        picklejudge_cv
        GTest::GTest
        GTest::Main
        ${OpenCV_LIBS}
    )
    add_test(NAME PickleJudgeTests COMMAND pickle_tests)
endif()
