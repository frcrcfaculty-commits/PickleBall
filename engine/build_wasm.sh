#!/usr/bin/env bash
# Builds engine/ -> web/public/pbj_engine.wasm with zig (pip install ziglang).
# Zig ships a complete clang + libc++ for wasm32-wasi, so no emsdk download.
set -euo pipefail
cd "$(dirname "$0")"
ZIG="${ZIG:-python3 -m ziglang}"
OUT=../web/public/pbj_engine.wasm
$ZIG c++ -target wasm32-wasi -O2 -std=c++17 \
  -DPBJ_SINGLE_THREAD -fno-exceptions -fno-rtti \
  -Iinclude \
  src/court.cpp src/camera.cpp src/track.cpp src/bounce.cpp \
  src/clocksync.cpp src/fuse.cpp src/decision.cpp src/engine.cpp src/c_api.cpp \
  -mexec-model=reactor -Wl,--no-entry -Wl,--export-dynamic \
  -Wl,--strip-all -o "$OUT"
ls -l "$OUT"
