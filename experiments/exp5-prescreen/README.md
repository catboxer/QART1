# Experiment 5 — Prescreening Protocol

## Purpose

This prescreening identifies individuals who show statistically reliable structure in quantum random number sequences during focused attention trials. It is a multi-session gate before Experiment 5 proper. A single session at 80 blocks is statistically underpowered for detecting real effects — the prescreen accumulates data across a minimum of 5 sessions before rendering a verdict.

---

## Experiment Design

Each session consists of **80 blocks**. Each block:

1. Participant is shown their target colour (blue or orange), assigned once per session at random
2. Participant focuses on their target and presses "I'm Ready"
3. **301 quantum bits** are fetched from the QRNG (1 assignment bit + 150 subject bits + 150 demon/control bits)
4. Subject bits are assigned to trials based on the first bit; the remaining 300 bits split 150/150 between the subject stream and the demon control stream
5. Hit rate and Hurst exponent are computed for both streams
6. Results are displayed; the participant rests briefly before the next block

Every 10 blocks an **RNG quality audit** fetches 1,000 bits and runs three NIST SP 800-22 tests (Frequency/Monobit, Runs, Longest Run). This guards against source bias contaminating the analysis.

**Bit source priority:** Outshift QRNG (Cisco) → LFDR → ANU. If the daily Outshift limit is hit, the session automatically falls through to LFDR for the remainder of that session without interruption.

---

## What We Are Measuring

The primary metric is **not hit rate**. Hit rate is a focusing target shown to the participant to give them a goal, but it is a weak signal in short sessions — a genuine effect in a 150-trial block would shift hit rate by only fractions of a percent, easily lost in noise.

What we actually test is whether the **temporal ordering** of the quantum bit sequence differs between the subject stream and the uninfluenced control (demon) stream. Specifically, we compute the **Hurst exponent (H)** for each stream per block — a measure of long-range dependence and self-similarity in the bit sequence — and test whether the distribution of H values across blocks diverges between subject and demon in a way that cannot be explained by random reordering of the bits.

This approach is motivated by pilot data showing that genuine responders exhibit a consistent ΔH signature (H_subject − H_demon) across sessions, with cumulative power increasing with session count.

---

## Why Multiple Sessions

At 80 blocks per session, the standard error of the mean ΔH is approximately:

```
SE = null_SD / √80 ≈ 0.046 / 8.9 ≈ 0.005
```

Pilot data suggested genuine responders show |mean ΔH| ≈ 0.008–0.009. At 80 blocks this yields a t-statistic of roughly 1.6–1.8 — a ~50% miss rate. At 5 sessions (400 cumulative blocks):

```
SE = 0.046 / √400 ≈ 0.0023
```

The same effect size now gives t ≈ 3.5–4, with power exceeding 95%. No verdict is rendered until at least **5 completed sessions** have been accumulated.

---

## Scoring Methodology

All scoring runs on the **cumulative dataset** across all sessions, not on individual session data. The per-session results screen (sessions 1–4) shows hit rate only. From session 5 onwards the full cumulative analysis is displayed.

### Layer 1 — KS Anomaly Gate

A two-sample **Kolmogorov-Smirnov test** compares the distribution of H_subject values across all cumulative blocks against the distribution of H_demon values.

- **Threshold:** `p < 0.10` (`PRESCREEN_KS_ALPHA`)
- **Passes if:** the two distributions are sufficiently different that a 10% false positive rate is acceptable at the screening stage
- **Rationale:** A loose threshold is intentional for a prescreen. We want high sensitivity — missing a genuine responder is a worse outcome than inviting a false positive for further testing. The shuffle gate (Layer 2) provides the specificity.

### Layer 2 — Shuffle Collapse Gate

If the KS anomaly could be due to a simple **mean shift in bit frequency** (e.g. a slight bias in the QRNG producing more 1s), shuffling the bits within each block destroys temporal structure but preserves frequency. A genuine temporal signal should **collapse** under shuffling; a frequency artefact should survive.

For each of **200 permutations**, all subject bit sequences are shuffled within-block (Fisher-Yates), Hurst is recomputed, and the KS distance is recalculated against the fixed demon stream.

The gate passes if **either**:

| Criterion | Threshold | Meaning |
|---|---|---|
| `collapseP` | `< 0.10` | The original KS distance is anomalously large relative to 200 shuffled replicates |
| `dDrop` | `≥ 0.15` | The KS distance dropped by at least 15% after shuffling — direct magnitude evidence of collapse |

OR logic catches both strong temporal signals (clear collapse) and weaker signals where the magnitude drop is meaningful even if the p-value sits just above threshold.

- **Rationale for `collapseP` correction:** `collapseP = (nGreater + 1) / (nShuffles + 1)` rather than `nGreater / nShuffles`, which would allow `p = 0.0` — overconfident with only 200 shuffles. The minimum achievable p is now 1/201 ≈ 0.005.

### Eligibility

```
eligible = ksGate AND collapseGate
```

Both layers must pass. An eligible participant proceeds to the invite form.

---

## Ranking

| Rank | Condition | Meaning |
|---|---|---|
| `gold` | eligible + `dDrop > 0.30` | High-confidence temporal structure; strong collapse |
| `silver` | eligible + `dDrop ≤ 0.30` | Signal detected; collapseP may have carried the gate |
| `candidate` | `ksGate AND NOT collapseGate` | Distribution anomaly present but temporal ordering unconfirmed — flagged for researcher review, no invite |
| `none` | neither gate passes | No detectable pattern |

Both gold and silver receive the invite form. The distinction is for internal prioritisation.

---

## Intensity Tiers (Gold and Silver only)

Within eligible sessions, an intensity tier quantifies effect size relative to the empirical standard error of ΔH across all cumulative blocks:

```
t = |mean ΔH| / SE_ΔH
SE_ΔH = SD(ΔH across blocks) / √nBlocks
```

| Tier | Condition | Label |
|---|---|---|
| 1 | `t < 1` | Subtle — collapseP may have carried the vote |
| 2 | `1 ≤ t < 2` | Solid Presence |
| 3 | `t ≥ 2` | Exceptional |

SE is computed from the empirical spread of ΔH across cumulative blocks, not from the null distribution. This makes intensity meaningful even when the null distribution is a poor fit.

---

## PCS (Control Stream) Validation

The demon/control stream is an uninfluenced half of the same quantum fetch. Three diagnostics check whether the control stream itself is behaving as expected. These are **informational only** — they never affect eligibility or rank. They flag potential QRNG quality issues for researcher review.

| Diagnostic | Threshold | Meaning |
|---|---|---|
| `nullZ` | `|Z| > 1.5` | Demon Hurst mean drifted from null expectation |
| `ghostZ` | `|Z| > 1.5` | Demon bit hit-rate biased away from 50% |
| `sdRatio` | `> 1.5` | Demon Hurst SD inflated vs null SD (over-dispersion) |

`ghostZ` is computed cumulatively across all sessions using accumulated demon hit counts.

**Note on cross-correlation:** The Pearson r between H_subject and H_demon per block is expected to be approximately 0.35 due to the adjacent-buffer split design — both streams come from the same 1,153-bit fetch, so they share within-fetch structure. This is structural to the design and harmless (ΔH cancels it). It is recorded diagnostically but is not a gate.

---

## Configuration Constants

```
TRIALS_PER_BLOCK:           150       — trials per block (150 subject + 150 demon)
BITS_PER_BLOCK:             301       — 1 assignment + 2 × 150
BLOCKS_TOTAL:               80        — blocks per session
MIN_SESSIONS_FOR_DECISION:  5         — cumulative verdict not shown before this

NULL_HURST_MEAN:            0.52799   — finite-sample null for N=150 (10k simulations)
NULL_HURST_SD:              0.04579

PRESCREEN_KS_ALPHA:         0.10      — KS gate threshold (loose by design)
PRESCREEN_COLLAPSE_ALPHA:   0.10      — permutation p-value gate
PRESCREEN_DDROP_MIN:        0.15      — magnitude collapse gate
N_SHUFFLES:                 200       — permutations per analysis

PRESCREEN_INTENSITY_T2:     1         — Tier 1→2 SE boundary
PRESCREEN_INTENSITY_T3:     2         — Tier 2→3 SE boundary

PRESCREEN_PCS_NULLZ_WARN:   1.5       — demon Hurst Z and ghost Z warning
PRESCREEN_PCS_SD_RATIO_WARN: 1.5      — demon SD inflation warning

AUDIT_EVERY_N_BLOCKS:       10        — NIST audit frequency
AUDIT_BITS_PER_BREAK:       1000      — bits fetched per audit
```

Null distribution values are derived from `hurst_null_distributions.ipynb` (seed 42, numpy `default_rng`, 10,000 simulations at N=150).

---

## Session Linking

Participants provide an email at consent. The email is stored in plain text on the `prescreen_participants` Firestore document to allow contact with eligible participants and to link sessions across devices. The document ID is `SHA-256(email)[0:32]` for lookup. Sessions without an email fall back to Firebase anonymous UID for same-device session counting only.

The participant profile accumulates:
- `cumulative_h_subject` — Hurst values per block across all sessions
- `cumulative_h_demon` — control stream Hurst values
- `cumulative_bits_subject` — raw subject bit strings per block
- `cumulative_demon_hits` / `cumulative_demon_trials` — for ghostZ
- `session_count`, `session_ids`, `last_session_date`, `sessions_today`

---

## Firestore Collections

| Collection | Purpose |
|---|---|
| `prescreen_sessions_exp5` | One doc per session, contains per-block stats, Hurst history, audit results, post-survey |
| `prescreen_participants` | One doc per email hash, cumulative arrays across all sessions |
| `exp5_invites` | Invite form submissions from eligible participants |
