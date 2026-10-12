# PickleJudge engine — dependency-free C++17 core.
# Builds identically on host (for tests), Android NDK, and iOS.
cmake_minimum_required(VERSION 3.18)
project(pbj_engine CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(pbj_engine STATIC
    src/court.cpp
    src/camera.cpp
    src/track.cpp
    src/bounce.cpp
    src/clocksync.cpp
    src/fuse.cpp
    src/decision.cpp
    src/engine.cpp
)
target_include_directories(pbj_engine PUBLIC include)
target_compile_options(pbj_engine PRIVATE -Wall -Wextra -O2)

# Host-only test binary (skipped automatically when cross-compiling).
if(NOT CMAKE_CROSSCOMPILING)
    enable_testing()
    add_executable(pbj_tests tests/test_all.cpp)
    target_link_libraries(pbj_tests pbj_engine)
    target_compile_options(pbj_tests PRIVATE -Wall -Wextra -O2)
    add_test(NAME pbj_tests COMMAND pbj_tests)
endif()
