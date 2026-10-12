# Field Validation Protocol

Synthetic tests prove the math. They cannot prove the product. This protocol is
the only evidence that matters, and no part of it can be delegated to me.

## Ground truth method (accuracy ~3 mm, five times better than the engine)

1. Dust a ball lightly with talcum powder before each rally. On impact it
   leaves a visible circular mark on the court surface.
2. After each bounce, before the next, photograph the mark with a phone held
   overhead, with a steel tape laid across the nearest two painted lines in
   frame.
3. Measure the mark centre perpendicular to both lines. Convert to the
   net-centred metric frame: x = signed distance from the centerline,
   y = signed distance from the net.
4. Record the app's reported values from the debug overlay (build a debug
   screen that shows `x, y, p_in, sigma_m, cameras, verdict` and lets you tap
   to log a row).

Do NOT use a second video camera as ground truth. A camera is exactly the
instrument under test; you would be measuring the engine against itself.

## Session design — 200 bounces minimum, at least 60 within 30 mm of a line

Deliberately generate the hard cases. Random rallies produce almost no
near-line bounces, so a "200 bounce" session of ordinary play proves nothing
about the only decision the app exists to make.

| Block | Bounces | Content |
|---|---|---|
| A | 40 | Hand-dropped balls aimed at sideline, ±40 mm, both sides |
| B | 40 | Hand-dropped at baseline, ±40 mm |
| C | 30 | Serves landing on and around the NVZ line (fault boundary) |
| D | 30 | Corners: sideline ∩ baseline, both signs |
| E | 40 | Live rally play, whatever lands |
| F | 20 | Adversarial: bright yellow shirt on court, second ball rolling, wet patch, low sun behind the far baseline |

Block F is not optional. It is the block that tells you whether the detector
survives reality, and it is where I expect the current HSV-only detector to
fail outright.

## Conditions matrix — repeat blocks A–D under each

Bright direct sun · overcast · indoor gym lighting · dusk with court floods.
Green court and blue court. Wet surface after rain. One session each.

## Scoring

    python3 tools/score_validation.py session_*.csv

Ship gates are encoded in the tool. The one that decides everything:

> **Zero confident wrong calls across ≥200 bounces including ≥60 near-line.**

A single confident wrong OUT call at a tournament, filmed and posted, ends the
product. The engine's abstention logic is designed so that this number is zero
by construction — the field data is what proves the design assumption held.

Gate G5 (sigma honesty) is the subtle one. If measured error is 30 mm while
the engine reports 8 mm sigma, every probability it emits is a lie, the 98%
threshold no longer means 98%, and abstention silently stops protecting
anyone. Fix by inflating the detector's assumed image-space noise until G5
lands near 1.0 — never by relaxing G1.

## Thermal and sustained performance (separate session, same rig)

Run 60 continuous minutes at production settings on the two lowest-spec target
devices. Log every 10 s: frame processing time (ms), delivered FPS, thermal
state, battery %, and detector hit rate. A pass is: FPS ≥ 55 sustained, no
thermal shutdown, battery ≥ 25% remaining, detector hit rate not degrading.

Expect this to fail first on iOS at 4K/60 with the OpenCV pipeline. The fix
order is: (1) drop detection to 1/4 scale — already implemented in
BallDetectorV2, (2) drop capture to 4K/30 and accept 2x timing latency,
(3) drop to 1080p and accept ~2x position sigma. Do not fix it by disabling
the motion gate.
