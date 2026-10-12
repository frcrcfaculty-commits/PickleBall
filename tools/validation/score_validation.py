#!/usr/bin/env python3
"""
score_validation.py — turn a field session CSV into a ship / no-ship verdict.

This is the gate that synthetic tests cannot replace. It answers the only
question that matters: how often does the app make a CONFIDENT WRONG CALL?

INPUT CSV (one row per bounce), columns:
    bounce_id      any unique string
    truth_x,truth_y   measured contact centre, metres, net-centred frame
    truth_verdict     IN | OUT | FAULT      (from the tape measure + rulebook)
    app_x,app_y       what the app reported
    app_verdict       IN | OUT | FAULT | NO_CALL
    p_in              app's reported P(legal)
    sigma_m           app's reported margin sigma
    cameras           1 or 2

GROUND TRUTH PROTOCOL — see docs/FIELD_VALIDATION.md. Summary: dust the ball
with talc, the impact leaves a visible mark, measure the mark centre from two
painted lines with a tape, convert to the net-centred frame. Human measurement
noise is ~3 mm — five times smaller than the engine's own sigma, so it is a
legitimate reference.

SHIP GATES (defaults below, override with flags):
    G1  RMS position error            <= 25 mm
    G2  systematic bias magnitude     <= 10 mm   (bias is fixable; noise is not)
    G3  confident-wrong-call rate      = 0 in >= 200 bounces, of which
                                        >= 60 are within 30 mm of a line
    G4  no-call rate on clear balls   <= 2%      (product is useless if it
                                                  abstains on obvious calls)

Usage:
    python3 tools/score_validation.py session_2026_07_20.csv
    python3 tools/score_validation.py *.csv --near-line-mm 30
"""
import argparse
import csv
import math
import sys
from collections import Counter

CALLS = ("IN", "OUT", "FAULT")


def load(paths):
    rows = []
    for p in paths:
        with open(p, newline="") as f:
            for r in csv.DictReader(f):
                if not r.get("bounce_id"):
                    continue
                rows.append({
                    "id": r["bounce_id"],
                    "tx": float(r["truth_x"]), "ty": float(r["truth_y"]),
                    "tv": r["truth_verdict"].strip().upper(),
                    "ax": float(r["app_x"]), "ay": float(r["app_y"]),
                    "av": r["app_verdict"].strip().upper(),
                    "p": float(r["p_in"]), "sig": float(r["sigma_m"]),
                    "cams": int(r["cameras"]),
                    "src": p,
                })
    return rows


def analyze(rows, near_line_m, gates):
    n = len(rows)
    if n == 0:
        print("no rows", file=sys.stderr)
        return 1

    ex = [r["ax"] - r["tx"] for r in rows]
    ey = [r["ay"] - r["ty"] for r in rows]
    err = [math.hypot(a, b) for a, b in zip(ex, ey)]

    bias_x, bias_y = sum(ex) / n, sum(ey) / n
    bias = math.hypot(bias_x, bias_y)
    rms = math.sqrt(sum(e * e for e in err) / n)
    p95 = sorted(err)[min(n - 1, int(0.95 * n))]

    # Calibration check: is the reported sigma honest? If the engine says 8 mm
    # and errors are 30 mm, every probability it emits is a lie and the
    # abstention logic silently stops protecting anyone.
    z = [e / r["sig"] for e, r in zip(err, rows) if r["sig"] > 1e-6]
    z_rms = math.sqrt(sum(v * v for v in z) / len(z)) if z else float("nan")

    # Confusion + the number that decides the product.
    conf = Counter()
    confident_wrong = []
    near = [r for r in rows if is_near_line(r, near_line_m)]
    clear = [r for r in rows if r not in near]
    nocall_clear = 0

    for r in rows:
        conf[(r["tv"], r["av"])] += 1
        if r["av"] in CALLS and r["av"] != r["tv"]:
            confident_wrong.append(r)
    for r in clear:
        if r["av"] == "NO_CALL":
            nocall_clear += 1

    print(f"\n=== PickleJudge field validation — {n} bounces "
          f"({sum(1 for r in rows if r['cams'] == 2)} dual-camera) ===\n")
    print("POSITION")
    print(f"  bias            {bias*1000:7.1f} mm   (x {bias_x*1000:+.1f}, y {bias_y*1000:+.1f})")
    print(f"  RMS error       {rms*1000:7.1f} mm")
    print(f"  p95 error       {p95*1000:7.1f} mm")
    print(f"  worst           {max(err)*1000:7.1f} mm")
    print("\nUNCERTAINTY HONESTY")
    print(f"  RMS of (error / reported sigma) = {z_rms:.2f}")
    print("    ~1.0 means reported confidence is trustworthy.")
    print("    >1.5 means the engine is OVERCONFIDENT — probabilities are lies.")
    print("    <0.6 means it is needlessly timid and will over-abstain.")

    print(f"\nCONFUSION MATRIX (truth -> app)")
    labels = ["IN", "OUT", "FAULT", "NO_CALL"]
    print("            " + "".join(f"{l:>9}" for l in labels))
    for t in CALLS:
        row = "".join(f"{conf[(t,a)]:>9}" for a in labels)
        print(f"  {t:<10}{row}")

    print(f"\nCONFIDENT WRONG CALLS: {len(confident_wrong)}")
    for r in confident_wrong[:12]:
        print(f"    {r['id']:<14} truth={r['tv']:<5} app={r['av']:<5} "
              f"p_in={r['p']:.3f} err={math.hypot(r['ax']-r['tx'], r['ay']-r['ty'])*1000:.0f}mm "
              f"[{r['src']}]")
    if len(confident_wrong) > 12:
        print(f"    ... and {len(confident_wrong)-12} more")

    nc_rate = nocall_clear / len(clear) if clear else 0.0
    print(f"\nNEAR-LINE BOUNCES (<= {near_line_m*1000:.0f} mm): {len(near)}")
    print(f"NO-CALL RATE ON CLEAR BALLS: {nc_rate*100:.1f}%  "
          f"({nocall_clear}/{len(clear)})")

    print("\n=== SHIP GATES ===")
    results = [
        ("G1 RMS <= %.0f mm" % (gates['rms']*1000), rms <= gates['rms'],
         f"{rms*1000:.1f} mm"),
        ("G2 bias <= %.0f mm" % (gates['bias']*1000), bias <= gates['bias'],
         f"{bias*1000:.1f} mm"),
        ("G3 zero confident wrong calls", len(confident_wrong) == 0,
         f"{len(confident_wrong)}"),
        ("G3b n >= %d bounces" % gates['n'], n >= gates['n'], f"{n}"),
        ("G3c near-line n >= %d" % gates['n_near'], len(near) >= gates['n_near'],
         f"{len(near)}"),
        ("G4 clear-ball no-call <= %.0f%%" % (gates['nocall']*100),
         nc_rate <= gates['nocall'], f"{nc_rate*100:.1f}%"),
        ("G5 sigma honesty 0.6 <= z <= 1.5",
         0.6 <= z_rms <= 1.5 if z_rms == z_rms else False, f"{z_rms:.2f}"),
    ]
    passed = 0
    for name, ok, val in results:
        print(f"  [{'PASS' if ok else 'FAIL'}] {name:<38} {val}")
        passed += ok
    verdict = "SHIP" if passed == len(results) else "DO NOT SHIP"
    print(f"\nVERDICT: {verdict}  ({passed}/{len(results)} gates)\n")
    return 0 if passed == len(results) else 1


HALF_W, HALF_L, NVZ = 3.0480, 6.7056, 2.1336


def is_near_line(r, tol):
    """Distance from the truth contact to the nearest painted boundary."""
    d = [abs(abs(r["tx"]) - HALF_W),          # sidelines
         abs(abs(r["ty"]) - HALF_L),          # baselines
         abs(abs(r["ty"]) - NVZ),             # NVZ lines
         abs(r["tx"])]                        # centerline
    return min(d) <= tol


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv", nargs="+")
    ap.add_argument("--near-line-mm", type=float, default=30.0)
    ap.add_argument("--rms-mm", type=float, default=25.0)
    ap.add_argument("--bias-mm", type=float, default=10.0)
    ap.add_argument("--min-n", type=int, default=200)
    ap.add_argument("--min-near", type=int, default=60)
    ap.add_argument("--max-nocall", type=float, default=0.02)
    a = ap.parse_args()
    gates = {"rms": a.rms_mm / 1000, "bias": a.bias_mm / 1000,
             "n": a.min_n, "n_near": a.min_near, "nocall": a.max_nocall}
    sys.exit(analyze(load(a.csv), a.near_line_mm / 1000, gates))


if __name__ == "__main__":
    main()
