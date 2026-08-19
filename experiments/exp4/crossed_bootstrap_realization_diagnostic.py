#!/usr/bin/env python3
"""
crossed_bootstrap_realization_diagnostic.py

Answers the open question in injection-preregistration-exp4.md Section 2/3:
how much of the current 50-realization CI width is realization-driven
(reducible by more realizations) vs. session-driven (an irreducible floor
near the measured resolution floor, delta ~ 0.002)?

Data: Frozen_Blocks_2026-02-10_195735.csv / Frozen_Sessions_2026-02-10_195735.csv
(the same frozen Baseline dataset used in resolution_floor_derivation-exp4.md
-- 103 sessions, 3090 blocks, confirmed by exact count match here).

Method:
  1. Reconstruct clean per-block hit-rate delta and Hurst delta from the
     already-split subject_bits/demon_bits stored in trial_data.
  2. For two representative dose/mechanism pairs (the manuscript's largest
     tested doses: persistence=0.35, literal-bias=0.20, independent-position
     masking, matching Section 3.3.1/3.3.2), run R=50 independent injected
     realizations per block and record the block-level recovery error
     (post-injection delta minus clean delta) for every (block, realization).
  3. Decompose variance into a session component (existing whole-session
     bootstrap, using the R-realization mean per block -- this reproduces
     the current method) and a realization component (variance across
     realizations within a block, before session-averaging).
  4. Empirically validate the 1/K scaling of the realization component by
     running the crossed bootstrap at several K (realizations averaged per
     block per bootstrap draw) and comparing to the analytic prediction,
     then project to K values beyond 50.

Output: printed table, K -> projected 95% CI half-width, for hit-rate and
Hurst-delta, both mechanisms.
"""

import ast
import numpy as np
import pandas as pd

rng = np.random.default_rng(20260819)

# ---------------- load & reconstruct ----------------

blocks = pd.read_csv("Frozen_Blocks_2026-02-10_195735.csv")
sess = pd.read_csv("Frozen_Sessions_2026-02-10_195735.csv")
baseline_ids = set(sess.loc[sess.agent_class == "baseline", "sessionId"])
b = blocks[blocks.sessionId.isin(baseline_ids)].copy()
assert len(b) == 3090 and b.sessionId.nunique() == 103, "dataset mismatch -- expected 3090 blocks / 103 sessions"

parsed = b["trial_data"].apply(ast.literal_eval)
subject = np.array([p["subject_bits"] for p in parsed], dtype=np.int8)   # (3090, 150)
demon = np.array([p["demon_bits"] for p in parsed], dtype=np.int8)       # (3090, 150)
target = np.array([p["target_bit"] for p in parsed], dtype=np.int8)      # (3090,)
session_ids = b["sessionId"].to_numpy()
unique_sessions = np.unique(session_ids)
n_blocks, n_bits = subject.shape


def hurst_approx(x_bits_2d):
    """Vectorized port of src/stats/coherence.js hurstApprox. x_bits_2d: (n, 150) 0/1 array."""
    x = x_bits_2d.astype(np.float64) * 2 - 1  # map to +-1
    mean = x.mean(axis=1, keepdims=True)
    d = x - mean
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

# ---------------- injection mechanisms (independent-position, as in 3.3.1/3.3.2) ----------------

def apply_literal_bias(bits_2d, dose, literal_values):
    """literal_values: (n,) array of 0/1, one randomly chosen direction per block (per call, matches manuscript)."""
    mask = rng.random(bits_2d.shape) < dose
    out = bits_2d.copy()
    lv = literal_values[:, None] * np.ones_like(bits_2d)
    out[mask] = lv[mask]
    return out


def apply_persistence(bits_2d, dose):
    """Sequential: each selected position repeats the (possibly already-updated) preceding bit."""
    out = bits_2d.copy()
    n, m = out.shape
    select = rng.random((n, m)) < dose
    select[:, 0] = False
    for i in range(1, m):
        col_select = select[:, i]
        out[col_select, i] = out[col_select, i - 1]
    return out


def run_realizations(mechanism, dose, n_realizations):
    """Returns recovery_error_hit, recovery_error_hurst: (n_blocks, n_realizations)."""
    rec_hit = np.empty((n_blocks, n_realizations))
    rec_hurst = np.empty((n_blocks, n_realizations))
    for r in range(n_realizations):
        if mechanism == "literal":
            literal_values = (rng.random(n_blocks) < 0.5).astype(np.int8)
            s = apply_literal_bias(subject, dose, literal_values)
            d = apply_literal_bias(demon, dose, literal_values)
        else:
            s = apply_persistence(subject, dose)
            d = apply_persistence(demon, dose)
        dh, dhu = clean_delta(s, d, target)
        rec_hit[:, r] = dh - clean_delta_hit
        rec_hurst[:, r] = dhu - clean_delta_hurst
    return rec_hit, rec_hurst


# ---------------- session-level whole-session bootstrap (existing method, R-averaged input) ----------------

def session_bootstrap_ci(per_block_values, n_boot=3000):
    df = pd.DataFrame({"session": session_ids, "val": per_block_values})
    session_means = df.groupby("session")["val"].mean()
    sessions = session_means.index.to_numpy()
    vals = session_means.to_numpy()
    n = len(sessions)
    boot_means = np.empty(n_boot)
    for i in range(n_boot):
        idx = rng.integers(0, n, n)
        boot_means[i] = vals[idx].mean()
    lo, hi = np.percentile(boot_means, [2.5, 97.5])
    return vals.mean(), lo, hi, (hi - lo) / 2


# ---------------- crossed bootstrap: also resample K realizations per block per draw ----------------

def crossed_bootstrap_ci(rec_matrix, K, n_boot=1500):
    """rec_matrix: (n_blocks, R). Each bootstrap draw resamples sessions AND, for each block,
    averages K realizations drawn with replacement from the R available."""
    R = rec_matrix.shape[1]
    df_index = pd.DataFrame({"session": session_ids})
    sessions = unique_sessions
    n_sess = len(sessions)
    session_to_rows = {s: np.where(session_ids == s)[0] for s in sessions}

    boot_means = np.empty(n_boot)
    for i in range(n_boot):
        sess_idx = rng.integers(0, n_sess, n_sess)
        sampled_sessions = sessions[sess_idx]
        session_level_vals = np.empty(n_sess)
        for j, s in enumerate(sampled_sessions):
            rows = session_to_rows[s]
            real_idx = rng.integers(0, R, (len(rows), K))
            block_vals = rec_matrix[rows[:, None], real_idx].mean(axis=1)
            session_level_vals[j] = block_vals.mean()
        boot_means[i] = session_level_vals.mean()
    lo, hi = np.percentile(boot_means, [2.5, 97.5])
    return (hi - lo) / 2


def main():
    for mechanism, dose in [("persistence", 0.35), ("literal", 0.20)]:
        print(f"\n{'='*70}\nMechanism: {mechanism}  dose={dose}  (independent-position, R=50)\n{'='*70}")
        rec_hit, rec_hurst = run_realizations(mechanism, dose, 50)

        for label, rec in [("hit-rate", rec_hit), ("HRS", rec_hurst)]:
            r_mean_per_block = rec.mean(axis=1)  # current method's input: mean over R=50
            mean_val, lo, hi, hw_existing = session_bootstrap_ci(r_mean_per_block)
            print(f"\n  [{label}] existing-style (R=50 pre-averaged, session bootstrap only):")
            print(f"    mean={mean_val:+.5f}  95% CI=[{lo:+.5f}, {hi:+.5f}]  half-width={hw_existing:.5f}")

            print(f"  [{label}] crossed bootstrap (both session AND realization resampled) at various K:")
            for K in [1, 5, 10, 25, 50]:
                hw = crossed_bootstrap_ci(rec, K)
                print(f"    K={K:4d} realizations/dose -> half-width={hw:.5f}")

            # empirical realization-variance component per block (pooled), for analytic projection
            per_block_real_var = rec.var(axis=1, ddof=1)
            avg_real_var = per_block_real_var.mean()
            hw_K1 = crossed_bootstrap_ci(rec, 1)
            hw_K50 = crossed_bootstrap_ci(rec, 50)
            # solve Var(K) = A + B/K using two empirical points, project further
            # Var(1) = A + B ; Var(50) = A + B/50  =>  B = (Var(1)-Var(50)) / (1 - 1/50)
            var1 = (hw_K1 / 1.96) ** 2
            var50 = (hw_K50 / 1.96) ** 2
            B = (var1 - var50) / (1 - 1 / 50)
            A = var1 - B
            print(f"  [{label}] fitted model Var(K) = {A:.7f} + {B:.7f}/K  (A = session-driven floor, B = realization-driven term)")
            print(f"  [{label}] projected half-width at larger K:")
            for K in [50, 100, 200, 500, 1000, 2000]:
                var_k = A + B / K
                hw_k = 1.96 * np.sqrt(max(var_k, 0))
                print(f"    K={K:5d} -> projected half-width={hw_k:.5f}  (floor-only limit as K->inf: {1.96*np.sqrt(max(A,0)):.5f})")


if __name__ == "__main__":
    main()
