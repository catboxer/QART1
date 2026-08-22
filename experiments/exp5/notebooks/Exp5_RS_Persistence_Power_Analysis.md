# Exp5 R/S Persistence (ΔH) Power Analysis

on t
**Status:** Final design decision reached 2026-08-16. Runnable calculation in
`Exp5_RS_Persistence_Power_Analysis.py` in this same folder — run it directly
to reproduce every number below.

## Why this document exists

An earlier version of this analysis apparently existed as
`Exp5_Power_Calculation_Statistician_Review.md`, but could not be located
anywhere on disk or in Drive when needed again. This document (and its
companion script) is the recreation, built from first principles and
verified directly against real frozen pilot data rather than trusted from
memory — so it doesn't get lost the same way twice.

## The question

How many participants (N) and sessions/participant (K, at a fixed 80
blocks/session) are needed to adequately power Exp5's confirmatory
Human-vs-Baseline test on the paired-delta H_RS (Hurst/R-S) signature —
while keeping the number of _subjects_ as low as reasonably possible
(sessions per person were the preferred lever to trade against, not subject
count).

## Model

A participant's own mean ΔH, averaged over K blocks, has variance:

```
Var(participant mean) = σ_within² / K + σ_between²
```

Baseline is collected continuously/automatically (not participant-limited),
so its contribution to the standard error is treated as negligible — this
reduces to a one-sample test of the Human participant-level grand mean
against Baseline's near-zero reference mean, with `SE = sqrt(Var / N)`.

This is a standard, correct model for this kind of nested (blocks-within-
sessions-within-participants) design — not a simplification.

## Inputs (verified against real data, 2026-08-16)

| Input     | Value                                      | Source                                                                                                                                                                                                                                                     |
| --------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| σ_within  | **0.064**                                  | Pooled block-level SD of ΔH, all conditions, both datasets (exp4 + exp5-prescreen). Confirmed: pooled SD = 0.06417 (N=21,047 blocks); every individual condition/dataset breakdown fell in 0.0637–0.0653.                                                  |
| SESOI     | **0.003**                                  | Half the pilot's Human5+ **participant-level** mean effect (+0.00643 — the unweighted average of the three Human5+ participants' own means: +0.00933, +0.00803, +0.00194). Note this is _not_ the block-weighted pooled mean, which is smaller (+0.00435). |
| σ_between | **0.00366 (conservative) / 0.01145 (stress)** | **Revised 2026-08-22 — stated rule, not an undocumented bracket.** Four candidate per-participant SD estimates exist: exp4 Human5+ (n=3, SD=0.00395), exp5-prescreen Human5+ (n=3, SD=0.00157), exp4 all-Human (n=121, SD=0.01145), exp5-prescreen all-Human (n=12, SD=0.00366). The two Human5+ estimates are excluded as candidates — same selection-bias grounds already applied elsewhere in this project: both come from the same retrospectively-selected 3-participant subgroup, so their own between-participant SD is entangled with the same selection process that inflated the mean effect, not just noisy from small n. The two full-sample, non-subgroup estimates are used directly as the bounds instead. (Previous values 0.0057/0.010 were an unexplained bracket — no stated rule connected them to the four candidate numbers; superseded.) |
| α         | 0.05, one-sided                            | Matches this project's convention for other directional, pre-specified hypotheses.                                                                                                                                                                         |

## What was checked and didn't fully verify

A recollected version of this analysis claimed specific minimum-N figures
(e.g. N=68 conservative / N=189 stress at 10 sessions for 90% power) that
this recreation could not reproduce — the closed-form model here found
roughly half that (N=36 / N=101). Testing a two-sided-alpha assumption
closed part of the gap (N=44 / N=123) but not all of it. The remaining
discrepancy is unexplained and the recollected document itself could not be
located to check directly. **The numbers in this document are the
independently-verified ones**, not the recollected ones.

## Result: population-level power surface

Sessions barely matter for population-level power — it plateaus almost
immediately (crossover at ~126 blocks / ~1.6 sessions under the conservative
scenario, ~41 blocks / ~0.5 sessions under stress) because σ_between becomes
the dominant term. N is the lever that matters here, not K.

## Population-level minimum: revised 2026-08-22 to N=143 (was 120)

With the corrected σ_between bounds above, N=120 no longer clears 90% power under the stress
scenario — it caps at **86.85%**, a hard ceiling from Human-side N alone that no amount of extra
Baseline data fixes. Two layers of correction were needed to find the true minimum, not one:

1. Treating Baseline as perfectly known (idealized, no Baseline sampling noise), the minimum is
   N=136 (90.28% power).
2. Once Baseline noise is properly modeled instead of idealized away (`population_power_baseline_corrected`,
   which combines both the within-session/total-blocks term and the genuine between-session term,
   at 900 Baseline sessions), N=136 only reaches 88.79% — still short. The actual minimum, with
   Baseline noise correctly included, is **N=143** (90.04% power).

|                        | Conservative (σ_between=0.00366) | Stress (σ_between=0.01145), Baseline properly modeled @900 sessions |
| ---------------------- | --------------------------------- | --------------------------- |
| Population-level power at N=120 | 100.0%                    | **86.85%** (below target)   |
| Population-level power at N=143 | 100.0%                    | **90.04%**                   |

At N=143, the minimum Baseline sessions for 90% power under stress is 880 (70,400 blocks) — the
existing "≥500 minimum, ~900 comfortable" Baseline recommendation below already covers this; no
change needed there.

**This does not change the N=200 recruitment target already decided.** 200 was already set as a
buffer above the (previously 120, now 143) population-level minimum specifically to support
individual-level flagging and the psi-ability subgroup/moderation analyses, not because the
primary test itself required 200. N=143 is still comfortably under 200.

**Downstream note — resolved:** the Baseline-session tables and decomposition-check numbers further
below in this document have now been recomputed against N=143 and the corrected σ_between bounds
(see the script's live output); the ≥500/~900-session recommendation is unchanged and remains
valid under the corrected inputs.

**Why 5 sessions, not 3, despite population power plateauing by ~2:**
individual-level detection (flagging a specific standout participant for
case-study follow-up — the prereg's "Individual Outlier/Convergence
Flagging" item) has no such floor; it keeps improving with more
within-person data since there's no σ_between term in a single person's own
estimate.

| Sessions | Power to flag a pilot-average-5+-sized individual (~0.0064) | Power to flag a pilot-strongest-performer-sized individual (~0.0093) |
| -------- | ----------------------------------------------------------- | -------------------------------------------------------------------- |
| 3        | 46.2%                                                       | 72.8%                                                                |
| **5**    | **63.9%**                                                   | **89.6%**                                                            |
| 10       | 88.2%                                                       | 99.3%                                                                |

3 sessions is genuinely inadequate for reliable individual-level flagging;
5 sessions gets a strong individual performer to a solid 90%.

**Why 120 over the bare-minimum ~105**: clears 90% power under the
pessimistic stress scenario with real margin (93.1% vs the bare-minimum
90.0%), for the same 5 sessions either way.

## Baseline noise (resolved 2026-08-16 — was previously "still open")

**Note: this section's specific power percentages were computed at the old N=120 and are stale.
The reasoning (why Baseline's own noise matters, how it's measured) is still valid; the numbers
are not — see "Population-level minimum: revised 2026-08-22 to N=143" above and the CORRECTED
MODEL output in the companion script for the current figures.**

The model above treats Baseline as a perfectly-known reference (SE=0). Real
data says otherwise: Baseline's own ΔH doesn't sit at a clean theoretical
zero, and drifts by a small amount that differs by dataset (−0.0017 in
exp4, sign-flipped in exp5-prescreen — see project NOTES.md 2026-08-11
baseline-offset investigation). If the confirmatory test compares Human
against Baseline rather than a fixed structural null, uncertainty in where
Baseline itself lands adds to the total noise the design needs to detect
through.

**Directly measured Baseline between-session SD of mean ΔH:**

| Dataset        | Sessions | Between-session SD                                                        | Clustered/naive SE ratio |
| -------------- | -------- | ------------------------------------------------------------------------- | ------------------------ |
| exp4           | 103      | **0.0110**                                                                | 0.94x                    |
| exp5-prescreen | 59       | **0.0074** (more protocol-relevant — matches the planned 80-block design) | 1.02x                    |

Both ratios ≈1 — Baseline's blocks behave close to independent within a
session, so this is purely a "how many independent Baseline sessions do you
have" issue, not a deeper non-independence problem.

**Folding `Var(Baseline_mean) = σ²_between-session / N_baseline` into
`Var(Human_mean − Baseline_mean)`, at the locked N=120/5-session Human
design:**

| Baseline scale                             | Power, conservative-Human | Power, stress-Human |
| ------------------------------------------ | ------------------------- | ------------------- |
| Baseline treated as known (original model) | 99.96%                    | 93.1%               |
| **Pilot-scale as-is (59–103 sessions)**    | **78–84%**                | **67–71%**          |
| 500 sessions                               | 99–100%                   | 87–91%              |
| 900 sessions                               | 99.6–99.9%                | 90–92%              |

At the amount of Baseline data currently sitting in the frozen pilot files,
this gap alone drops the design **below the 90% target** — this was a real,
previously-unaddressed omission, not a rounding correction.

**Minimum Baseline sessions for ≥90% power, first pass** (worst-case Human
scenario, treating the raw observed between-session SD as an irreducible
per-session floor):

| Baseline σ estimate                       | Min sessions for 90% power   |
| ----------------------------------------- | ---------------------------- |
| exp5-prescreen (0.0074, protocol-matched) | 415 sessions (33,200 blocks) |
| exp4 (0.0110, more conservative)          | 915 sessions (73,200 blocks) |

### Decomposition check: is this real drift, or just leftover sampling noise?

Since the design uses 80-block sessions, the natural instinct is to trust
the exp5-prescreen number (0.0074) over exp4's (0.0110, measured at only
30 blocks/session). Worth checking directly rather than assuming: is the
observed between-session SD genuine between-session drift, or mostly
ordinary block-level sampling noise that a short session hasn't averaged
out yet? Solving `σ²_observed ≈ σ_within²/blocks_per_session + σ²_true` for
σ_true:

| Dataset        | Blocks/session | Observed SD | Pure-sampling-noise prediction | Genuine residual                                         |
| -------------- | -------------- | ----------- | ------------------------------ | -------------------------------------------------------- |
| exp4           | 30             | 0.0110      | 0.0117                         | **~0 — fully explained by noise; discard this estimate** |
| exp5-prescreen | 80             | 0.0074      | 0.0072                         | **0.0019 — small, but real**                             |

exp4's figure was never a real Baseline-noise estimate — at only 30
blocks/session, its whole observed "between-session SD" is explained by
ordinary sampling noise with nothing left over. exp5-prescreen's genuine
between-session component is much smaller than the raw 0.0074 suggested:
just **0.0019**.

**Corrected model**: `Var(Baseline mean) = σ_within²/total_blocks +
σ²_true/n_sessions`, using σ_true=0.0019. At realistic scale the
σ_within/total-blocks term dominates (~14× the between-session term), so
the practical minimum barely moves: **420 sessions (33,600 blocks)** for
90% power under stress-Human — almost identical to the uncorrected 415.

**What changes is the interpretation, not the headline number**: this was
never really a "need many independent sessions to escape a real per-session
penalty" problem — there's barely a real per-session penalty at all. It's a
"need enough total blocks" problem, the same ordinary 1/√N sampling story
as everywhere else in this analysis. How those blocks are batched into
sessions is close to irrelevant; total block count is what's actually being
locked in.

**Recommendation: prespecify ≥500 Baseline sessions (~40,000 total blocks)
as an explicit minimum** — currently absent from the OSF prereg, which only
says Baseline totals are "reported as-achieved," with no floor. Baseline
collection is automated/continuous, not recruitment-limited like Human —
there is no real cost argument for leaving this open-ended given how much
it moves power. At the corrected N=143, ~900 sessions (~72,000 blocks) clears the target
(90.04% under stress-Human, per the CORRECTED MODEL output above) at the cost of API/compute time
only, not additional human participants. (This paragraph originally cited 91.7% at the old N=120;
updated 2026-08-22.)

## Still open — not folded into this calculation

- **Recruitment is not a general-population sample** (purposive sampling
  from practice/neurodivergent communities per the OSF prereg's Target
  Population section) — an external-validity caveat, doesn't change this
  calculation but qualifies what it generalizes to.
- This document does not reproduce the specific N-per-power-target figures
  from the unlocated recollected document `Exp5_Power_Calculation_
Statistician_Review.md` — see "What was checked and didn't fully verify"
  above.
