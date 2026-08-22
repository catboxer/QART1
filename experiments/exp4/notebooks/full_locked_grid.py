#!/usr/bin/env python3
"""
full_locked_grid.py

The actual locked confirmatory analysis from injection-preregistration-exp4.md
Sections 2-4: full dose grid (persistence: 0.05/0.10/0.20/0.35; literal-bias:
0.02/0.05/0.10/0.20), both synchronized-mask and independent-position
implementations, R=100 realizations/dose (locked 2026-08-19), on the real
frozen Baseline dataset (103 sessions, 3090 blocks), classified Pass /
Indeterminate / Fails-to-cancel per Section 3's exact rule against the
pre-specified equivalence bound delta=0.002.

Reuses the exact hurst_approx / clean_delta / session_bootstrap_ci functions
already validated in crossed_bootstrap_realization_diagnostic.py (their R=50
output exactly reproduced the manuscript's already-published numbers). Adds
synchronized-mask support, which that script did not implement, ported from
check-hrs-common-mode-cancellation.js's makeSharedPositions/applyLiteralBias/
applyPersistence pattern (the same pattern already used and validated in
Section 6a of the prereg).

Classification rule (Section 3, exact):
  1. If the 95% CI excludes zero              -> FAILS TO CANCEL
  2. Else if the CI lies entirely within +/-delta -> PASS
  3. Else (includes zero, extends beyond delta)   -> INDETERMINATE
"""

import ast
import json
import numpy as np
import pandas as pd

rng = np.random.default_rng(20260819)
DELTA = 0.002

# ---------------- load & reconstruct (identical to the validated diagnostic) ----------------

blocks = pd.read_csv("Frozen_Blocks_2026-02-10_195735.csv")
sess = pd.read_csv("Frozen_Sessions_2026-02-10_195735.csv")
baseline_ids = set(sess.loc[sess.agent_class == "baseline", "sessionId"])
b = blocks[blocks.sessionId.isin(baseline_ids)].copy()
assert len(b) == 3090 and b.sessionId.nunique() == 103, "dataset mismatch -- expected 3090 blocks / 103 sessions"

parsed = b["trial_data"].apply(ast.literal_eval)
subject = np.array([p["subject_bits"] for p in parsed], dtype=np.int8)
demon = np.array([p["demon_bits"] for p in parsed], dtype=np.int8)
target = np.array([p["target_bit"] for p in parsed], dtype=np.int8)
session_ids = b["sessionId"].to_numpy()
unique_sessions = np.unique(session_ids)
n_blocks, n_bits = subject.shape
print(f"Loaded: {n_blocks} blocks, {len(unique_sessions)} sessions, {n_bits} bits/stream")


def hurst_approx(x_bits_2d):
    x = x_bits_2d.astype(np.float64) * 2 - 1
    mean_ = x.mean(axis=1, keepdims=True)
    d = x - mean_
    y = np.cumsum(d, axis=1)
    minY = np.minimum(0, y.min(axis=1))
    maxY = np.maximum(0, y.max(axis=1))
    R = maxY - minY
    S = np.sqrt((d * d).mean(axis=1))
    S[S == 0] = 1
    ratio = np.where(R / S == 0, 1, R / S)
    h = np.log(ratio) / np.log(n_bits)
    return np.clip(h, 0, 1)


def clean_delta(subject_bits, demon_bits, target_bit):
    hit_s = (subject_bits == target_bit[:, None]).mean(axis=1)
    hit_d = (demon_bits == target_bit[:, None]).mean(axis=1)
    delta_hit = hit_s - hit_d
    delta_hurst = hurst_approx(subject_bits) - hurst_approx(demon_bits)
    return delta_hit, delta_hurst


clean_delta_hit, clean_delta_hurst = clean_delta(subject, demon, target)

# ---------------- injection mechanisms, now with synchronized-mask support ----------------

def apply_literal_bias(bits_2d, dose, literal_values, shared_mask=None):
    mask = shared_mask if shared_mask is not None else (rng.random(bits_2d.shape) < dose)
    out = bits_2d.copy()
    lv = literal_values[:, None] * np.ones_like(bits_2d)
    out[mask] = lv[mask]
    return out, mask


def apply_persistence(bits_2d, dose, shared_mask=None):
    out = bits_2d.copy()
    n, m = out.shape
    select = shared_mask if shared_mask is not None else (rng.random((n, m)) < dose)
    select = select.copy()
    select[:, 0] = False
    for i in range(1, m):
        col_select = select[:, i]
        out[col_select, i] = out[col_select, i - 1]
    return out


def run_realizations(mechanism, dose, n_realizations, sync_mask):
    rec_hit = np.empty((n_blocks, n_realizations))
    rec_hurst = np.empty((n_blocks, n_realizations))
    for r in range(n_realizations):
        if mechanism == "literal":
            literal_values = (rng.random(n_blocks) < 0.5).astype(np.int8)
            if sync_mask:
                shared = rng.random(subject.shape) < dose
                s, _ = apply_literal_bias(subject, dose, literal_values, shared)
                d, _ = apply_literal_bias(demon, dose, literal_values, shared)
            else:
                s, _ = apply_literal_bias(subject, dose, literal_values)
                d, _ = apply_literal_bias(demon, dose, literal_values)
        else:
            if sync_mask:
                shared = rng.random(subject.shape) < dose
                s = apply_persistence(subject, dose, shared)
                d = apply_persistence(demon, dose, shared)
            else:
                s = apply_persistence(subject, dose)
                d = apply_persistence(demon, dose)
        dh, dhu = clean_delta(s, d, target)
        rec_hit[:, r] = dh - clean_delta_hit
        rec_hurst[:, r] = dhu - clean_delta_hurst
    return rec_hit, rec_hurst


def session_bootstrap_ci(per_block_values, n_boot=3000):
    df = pd.DataFrame({"session": session_ids, "val": per_block_values})
    session_means = df.groupby("session")["val"].mean()
    vals = session_means.to_numpy()
    n = len(vals)
    boot_means = np.empty(n_boot)
    for i in range(n_boot):
        idx = rng.integers(0, n, n)
        boot_means[i] = vals[idx].mean()
    lo, hi = np.percentile(boot_means, [2.5, 97.5])
    return vals.mean(), lo, hi


def classify(lo, hi, delta=DELTA):
    excludes_zero = (lo > 0) or (hi < 0)
    if excludes_zero:
        return "FAILS TO CANCEL"
    within_delta = (lo >= -delta) and (hi <= delta)
    if within_delta:
        return "PASS"
    return "INDETERMINATE"


N_REALIZATIONS = 100
GRID = {
    "persistence": [0.05, 0.10, 0.20, 0.35],
    "literal": [0.02, 0.05, 0.10, 0.20],
}
RELEVANT_METRIC = {"persistence": "hurst", "literal": "hit"}

results = []
for mechanism, doses in GRID.items():
    for dose in doses:
        for sync_mask in [False, True]:
            mask_label = "synchronized" if sync_mask else "independent-position"
            rec_hit, rec_hurst = run_realizations(mechanism, dose, N_REALIZATIONS, sync_mask)
            hit_r_avg = rec_hit.mean(axis=1)
            hurst_r_avg = rec_hurst.mean(axis=1)

            mean_hit, lo_hit, hi_hit = session_bootstrap_ci(hit_r_avg)
            mean_hurst, lo_hurst, hi_hurst = session_bootstrap_ci(hurst_r_avg)

            cls_hit = classify(lo_hit, hi_hit)
            cls_hurst = classify(lo_hurst, hi_hurst)
            relevant_cls = cls_hurst if RELEVANT_METRIC[mechanism] == "hurst" else cls_hit

            row = {
                "mechanism": mechanism,
                "dose": dose,
                "mask": mask_label,
                "relevant_metric": RELEVANT_METRIC[mechanism],
                "relevant_classification": relevant_cls,
                "hit_mean": mean_hit, "hit_ci_lo": lo_hit, "hit_ci_hi": hi_hit, "hit_classification": cls_hit,
                "hurst_mean": mean_hurst, "hurst_ci_lo": lo_hurst, "hurst_ci_hi": hi_hurst, "hurst_classification": cls_hurst,
                "hit_rms": float(np.sqrt((rec_hit ** 2).mean())),
                "hurst_rms": float(np.sqrt((rec_hurst ** 2).mean())),
            }
            results.append(row)
            print(f"{mechanism:12s} dose={dose:.2f} {mask_label:22s} "
                  f"[{RELEVANT_METRIC[mechanism]}] {relevant_cls:16s} "
                  f"hit=({mean_hit:+.5f},[{lo_hit:+.5f},{hi_hit:+.5f}]) "
                  f"hrs=({mean_hurst:+.5f},[{lo_hurst:+.5f},{hi_hurst:+.5f}])")

with open("full_locked_grid_results.json", "w") as f:
    json.dump(results, f, indent=2)

print("\n\n=== SUMMARY: relevant-metric classification per Section 3 ===")
for row in results:
    print(f"{row['mechanism']:12s} dose={row['dose']:.2f} {row['mask']:22s} -> {row['relevant_classification']}")

n_pass = sum(1 for r in results if r['relevant_classification'] == 'PASS')
n_indet = sum(1 for r in results if r['relevant_classification'] == 'INDETERMINATE')
n_fail = sum(1 for r in results if r['relevant_classification'] == 'FAILS TO CANCEL')
print(f"\nTotals: {n_pass} PASS, {n_indet} INDETERMINATE, {n_fail} FAILS TO CANCEL, out of {len(results)} conditions")
