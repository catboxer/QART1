#!/usr/bin/env python3
"""
Session-clustered bootstrap on (synchronized - independent-position) for
persistence dose=0.35, both hit-rate and HRS recovery error. Resamples the
same 103 sessions jointly for both conditions each draw, since both share
the same underlying real Baseline data -- gives one CI directly on the
difference, rather than eyeballing overlap of two separate CIs.
"""
import ast
import numpy as np
import pandas as pd

rng = np.random.default_rng(20260821)

blocks = pd.read_csv("Frozen_Blocks_2026-02-10_195735.csv")
sess = pd.read_csv("Frozen_Sessions_2026-02-10_195735.csv")
baseline_ids = set(sess.loc[sess.agent_class == "baseline", "sessionId"])
b = blocks[blocks.sessionId.isin(baseline_ids)].copy()
assert len(b) == 3090 and b.sessionId.nunique() == 103

parsed = b["trial_data"].apply(ast.literal_eval)
subject = np.array([p["subject_bits"] for p in parsed], dtype=np.int8)
demon = np.array([p["demon_bits"] for p in parsed], dtype=np.int8)
target = np.array([p["target_bit"] for p in parsed], dtype=np.int8)
session_ids = b["sessionId"].to_numpy()
unique_sessions = np.unique(session_ids)
n_blocks, n_bits = subject.shape

def hurst_approx(x):
    x = x.astype(np.float64) * 2 - 1
    m = x.mean(axis=1, keepdims=True)
    d = x - m
    y = np.cumsum(d, axis=1)
    R = np.maximum(0, y.max(axis=1)) - np.minimum(0, y.min(axis=1))
    S = np.sqrt((d * d).mean(axis=1)); S[S == 0] = 1
    ratio = np.where(R / S == 0, 1, R / S)
    return np.clip(np.log(ratio) / np.log(n_bits), 0, 1)

def clean_delta(s, d, t):
    hs = (s == t[:, None]).mean(axis=1); hd = (d == t[:, None]).mean(axis=1)
    return hs - hd, hurst_approx(s) - hurst_approx(d)

clean_hit, clean_hurst = clean_delta(subject, demon, target)

def apply_persistence(bits, dose, shared_mask=None):
    out = bits.copy(); n, m = out.shape
    select = shared_mask if shared_mask is not None else (rng.random((n, m)) < dose)
    select = select.copy(); select[:, 0] = False
    for i in range(1, m):
        cs = select[:, i]; out[cs, i] = out[cs, i - 1]
    return out

def run_realizations(dose, n_real, sync):
    rec_hit = np.empty((n_blocks, n_real)); rec_hurst = np.empty((n_blocks, n_real))
    for r in range(n_real):
        if sync:
            shared = rng.random(subject.shape) < dose
            s = apply_persistence(subject, dose, shared); d = apply_persistence(demon, dose, shared)
        else:
            s = apply_persistence(subject, dose); d = apply_persistence(demon, dose)
        dh, dhu = clean_delta(s, d, target)
        rec_hit[:, r] = dh - clean_hit; rec_hurst[:, r] = dhu - clean_hurst
    return rec_hit, rec_hurst

print("Running persistence dose=0.35, R=100, both mask types...")
hit_indep, hurst_indep = run_realizations(0.35, 100, sync=False)
hit_sync, hurst_sync = run_realizations(0.35, 100, sync=True)

def session_means(per_block_r_avg):
    df = pd.DataFrame({"session": session_ids, "val": per_block_r_avg})
    return df.groupby("session")["val"].mean().reindex(unique_sessions).to_numpy()

sm_hit_indep = session_means(hit_indep.mean(axis=1))
sm_hit_sync = session_means(hit_sync.mean(axis=1))
sm_hurst_indep = session_means(hurst_indep.mean(axis=1))
sm_hurst_sync = session_means(hurst_sync.mean(axis=1))

n_sess = len(unique_sessions)
n_boot = 5000

def paired_diff_ci(sm_a, sm_b, label):
    boot_diffs = np.empty(n_boot)
    for i in range(n_boot):
        idx = rng.integers(0, n_sess, n_sess)  # SAME resample for both conditions
        boot_diffs[i] = sm_a[idx].mean() - sm_b[idx].mean()
    lo, hi = np.percentile(boot_diffs, [2.5, 97.5])
    point = sm_a.mean() - sm_b.mean()
    excludes_zero = (lo > 0) or (hi < 0)
    print(f"{label}: sync-minus-indep = {point:+.5f}  95% CI=[{lo:+.5f},{hi:+.5f}]  excludes_zero={excludes_zero}")

print()
paired_diff_ci(sm_hit_sync, sm_hit_indep, "hit-rate  (persistence, dose=0.35)")
paired_diff_ci(sm_hurst_sync, sm_hurst_indep, "HRS       (persistence, dose=0.35)")
