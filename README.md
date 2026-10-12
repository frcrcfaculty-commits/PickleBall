# PickleJudge

Two phones on tripods call pickleball lines — and say "too close" instead of guessing.

- **Decision:** one web codebase (TypeScript + C++ engine in WebAssembly + WebGL2 detector), wrapped
  for the App Store and Play Store with Capacitor → [`docs/DECISION.md`](docs/DECISION.md)
- **Agents:** read [`AGENTS.md`](AGENTS.md) first. Work is landed only by `tools/agent/land.sh`.
- **Ledger:** [`TASKS.md`](TASKS.md)
- **Status at a glance:** `bash tools/agent/status.sh`

| Path | What |
|---|---|
| `engine/` | C++17 geometry/bounce/sync/fusion/decision engine + ground-truth tests |
| `web/src/core/` | wasm wrapper, camera, GPU + reference detectors, `Judge` orchestrator, contracts |
| `web/spike.html` | 25-second device check: is this phone capable? |
| `web/test/` | wasm engine tests, detector tests on rendered frames, pixels→verdict test |
| `docs/` | architecture, decision, field validation protocol, store listing, privacy |
| `legacy/react-native/` | the earlier React Native attempt (never built) — reference only |

```bash
cd engine && cmake -B build && cmake --build build && ./build/pbj_tests   # 57 C++ checks
cd web && npm ci && npm run check                                         # typecheck + tests + build
```
