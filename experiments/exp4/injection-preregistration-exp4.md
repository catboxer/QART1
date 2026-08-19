# Preregistration: Artifact-Injection Simulation Parameters, Paired-Delta QRNG Architecture

**Author.** Andrea Rester Campbell, independent researcher.

**Date fixed.** 2026-08-16, prior to any rerun of the injection notebook against the frozen Baseline dataset (3,090 calls, 103 sessions).

**Purpose.** To fix the injection mechanisms, dose grid, and pass/fail criteria in advance of execution, so that the reported results cannot reflect post-hoc selection of favorable parameters. This document is committed to the project repository with a timestamp before the notebook is rerun. It does not resolve the deeper limitation that the artifact characterization remains internal to this study (see Not Resolved, below); it resolves the narrower problem that the dose grid was previously chosen without a stated external justification.

## 1. Source of the mechanisms

The two injection mechanisms are not chosen freehand. They correspond to the two continuous health tests that NIST Special Publication 800-90B (Recommendation for the Entropy Sources Used for Random Bit Generation, January 2018) requires entropy-source submitters to implement or substitute for, specifically to catch the two failure modes the standard identifies as needing continuous detection (SP 800-90B Section 4.4, "Approved Continuous Health Tests"):

- **Repetition Count Test (SP 800-90B Section 4.4.1).** Detects a noise source that becomes "stuck" on a single output value for a long period. Cutoff value C is the smallest integer satisfying the target false-positive rate α ≥ 2^(−H(C−1)), where H is the assessed min-entropy per sample. NIST's example: at α = 2^−20 and H = 2.0 bits/sample, C = 11.
- **Adaptive Proportion Test (SP 800-90B Section 4.4.2).** Detects a value becoming disproportionately common within a sliding window (W = 1024 samples for binary sources). Cutoff C is chosen so that Pr(B ≥ C) ≤ α within the window.

SP 800-90B Section 4.3, item 8 additionally requires submitters to document "any known or suspected noise source failure modes" and to include tests targeting them. These two tests are the standard's own answer to that requirement; they are not a mechanism this study invented.

**Mapping to the present injections.**

| This study's mechanism | SP 800-90B analogue | What it targets |
|---|---|---|
| Shared persistence disturbance (Section 3.3.2) | Repetition Count Test (4.4.1) | Runs of repeated bit values |
| Shared literal-bit composition bias (Section 3.3.1) | Adaptive Proportion Test (4.4.2) | Sustained excess proportion of one bit value |

This mapping supports the claim that the injected mechanisms are drawn from a documented, external taxonomy of real QRNG/TRNG failure modes. It does not support a claim that the injected magnitudes match any specific provider's real failure history, since no provider-level incident log was recorded for this study (Section 5.8). That gap is the reason a prospective, externally logged arm remains necessary (see Not Resolved).

## 2. Fixed parameters

**Persistence disturbance (repetition-type).** Applied to raw bits before Subject-PCS assignment, both physical halves, synchronized-mask and independent-position implementations, as in the existing Section 3.3.2 procedure.

- Dose grid (probability of repeating the preceding bit): 0.05, 0.10, 0.20, 0.35. Unchanged from the existing manuscript. Retained rather than re-derived from NIST's C formula because the existing grid already spans a wider range of induced runs than the SP 800-90B cutoff at this block's assessed entropy would require to trigger detection, and changing it now would itself be a post-hoc adjustment.
- Realizations per nonzero dose: **LOCKED at 100, dated 2026-08-19, per the crossed session-by-realization bootstrap diagnostic below.** Not 50 (manuscript's own §3.3.4 already flagged as insufficient), not 200 (would have been an unjustified guess). 100 gives a small, real precision gain over 50 at negligible extra compute; the diagnostic shows going further than that buys essentially nothing (see below) — the bottleneck for the one dose that doesn't cleanly pass is session count, not realization count, and no realization number fixes that.

**Literal-bit composition disturbance (proportion-type).** Applied to raw bits before Subject-PCS assignment, both physical halves, synchronized-mask and independent-position implementations, as in the existing Section 3.3.1 procedure.

- Dose grid (probability a bit position is replaced by the selected literal value): 0.02, 0.05, 0.10, 0.20. Unchanged.
- Realizations per nonzero dose: same open status as above.

Both grids are retained from the already-reported Section 3.3 results rather than regenerated, because the purpose of this document is to fix the interpretive and reporting framework going forward, not to rerun a study that already ran within reasonable bounds. If this notebook is rerun for a resubmission, the same grid will be used and the same seeds documented in the accompanying code will be preserved so the run is reproducible.

## 3. Pre-specified pass/fail criterion

This is the change from the original run. The original report characterized a result as "little systematic shift" whenever the bootstrap CI for the mean recovery error included zero. That criterion has no pre-specified tolerance and cannot distinguish "no residual bias" from "a residual bias too small for this sample size to detect." The following replaces it.

- **Equivalence bound, δ = 0.002.** A dose is classified as producing no detectable systematic residual only if the two-sided 95% whole-session bootstrap CI for the mean recovery error lies entirely within ±0.002 in the relevant units (fractional hit rate for the literal-bit mechanism; single-scale HRS-score units for the persistence mechanism).

  This bound is not a judgment call. It is the measured resolution floor of the design: the half-width of a 95% whole-session cluster bootstrap CI computed on the real, unperturbed Baseline paired-difference series (`clean_delta_hit`, `clean_delta_hurst`), using the notebook's own `session_bootstrap_mean` function, on the actual 301-bit raw calls reconstructed and hash-validated against the frozen dataset (3,090 blocks, 103 sessions, zero reconstruction mismatches). Measured values were 0.00202 (hit rate) and 0.00217 (Hurst delta); 0.002 is used for both as a common, rounded-down bound. Three independent computations (a hand-reconstructed CSV-only version, the real pipeline, and the manuscript's already-published Section 3.3.4 physical-half calibration, a related but distinct quantity) converged to the same order of magnitude. Full derivation and code provenance in `resolution_floor_derivation-exp4.md`, committed alongside this file.

  An earlier draft of this document set δ = 0.005 from "roughly half the smallest effect size discussed elsewhere in the manuscript." That was a substantive judgment call, not a measurement, and looser than what the design can resolve. It is superseded by the measured value above.

  **Correction, 2026-08-19, after running the crossed session-by-realization bootstrap** (`crossed_bootstrap_realization_diagnostic.py`, committed alongside this file). An earlier draft of this caveat guessed that the recovery-error CI's best achievable half-width, as realizations → ∞, would approach δ=0.002 itself (the clean-series resolution floor). That guess was wrong, and the actual diagnostic result is more specific and more useful:

  The recovery-error statistic (post-injection delta minus clean delta, same blocks) is a *within-block* contrast, not the raw clean-delta itself, so it partially cancels the same session/block noise that sets δ — its own achievable floor is generally *tighter* than δ, not equal to it. Measured directly (reconstructing the real Baseline dataset from `Frozen_Blocks_2026-02-10_195735.csv`, 103 sessions / 3,090 blocks, confirmed exact match to the resolution-floor derivation's dataset):

  | Mechanism, dose | Statistic | Existing (R=50) half-width | Asymptotic floor (R→∞) |
  |---|---|---|---|
  | Literal-bias, 0.20 | hit rate | 0.00044 (matches manuscript's reported 0.00044 exactly) | 0.00043 |
  | Literal-bias, 0.20 | HRS | 0.00095 | 0.00102 |
  | Persistence, 0.35 | hit rate | 0.00027 | 0.00029 |
  | Persistence, 0.35 | HRS | 0.00136 (matches manuscript's reported ~0.00129) | 0.00136 |

  Three of these four already sit comfortably inside ±0.002 at R=50, with or without more realizations. **Persistence-HRS at dose 0.35 is the one real exception**, and it's already essentially at its floor by R=50 (0.00136 existing vs. 0.00136 asymptotic — realizations buy almost nothing here). Its 95% CI (mean +0.00109 ± 0.00136 ≈ [−0.00027, +0.00245]) just barely fails to sit entirely within ±0.002, and no realization count fixes that, because the limiting factor is session count (103 real Baseline sessions), not realization count. **This should be reported as indeterminate at this dose, with an explicit note that more injected realizations will not resolve it — only more real sessions would.** This is a materially different, more defensible statement than the original guess, and it directly explains why §3.3.4's "more realizations needed" framing, while a reasonable guess at the time, doesn't actually hold once measured.
- **Indeterminate.** If the CI is not entirely within ±0.002 but also does not exclude zero, the result is reported as indeterminate, not as a pass.
- **Fails to cancel.** If the CI excludes zero, or lies partly or wholly outside ±0.002, the dose is reported as showing a detectable residual.
- Block-level recovery-error RMS will continue to be reported descriptively at every dose, as in the original manuscript, since it is not a claim under test here.

## 4. Reporting rule

Whatever classification results from Section 3 will be reported for every dose in the grid, including doses that fail to cancel or are indeterminate. No dose will be dropped, re-run with different seeds, or described using different language than what this document specifies, without a dated addendum to this file explaining the change and why it was made before, not after, seeing its effect on the result.

## 5. Not resolved by this document

This preregistration fixes the parameters and criteria. It does not convert the study into the kind of evidence Frontiers' editor asked for. Three limitations remain and should be stated in any resubmission:

1. **Internal characterization.** The disturbances are still specified, injected, and measured by the same pipeline. This document removes the risk that parameters were chosen after seeing favorable results, but it does not introduce an artifact whose existence and magnitude are independently verified outside this study.
2. **Whole-call vs. within-call structure.** Both mechanisms as implemented here are applied to both physical halves with the same type and average strength, meaning they are, by construction, closer to whole-call disturbances than to disturbances with genuine within-call asymmetry. A disturbance constant across the whole call is expected to cancel under paired subtraction for linear statistics such as hit rate as a matter of arithmetic, not as an empirical finding. Whether this holds for the nonlinear single-scale HRS estimator was an open item as of this document's original drafting — **now checked, see Section 6a below, added 2026-08-19.**
3. **No real artifact was exercised.** As stated throughout Section 3.3.5 of the manuscript, no naturally occurring common-mode structure was present in the sampled Baseline data. This preregistration governs a simulation study; it is not a substitute for the prospective, externally logged artifact arm described in Section 4.4.

## 6. Open item requiring verification before this document is relied upon

Whether the paired-delta transform (Subject minus PCS) exactly cancels a whole-call-constant additive disturbance for the single-scale Hurst/R-S estimator, given that the estimator is nonlinear. This is known to hold for hit rate (a linear/mean statistic) but has not been separately confirmed for the R/S estimator. If it does not hold exactly, some of the persistence-injection results carry more information than the "arithmetic identity" framing implies, and that framing should be revised accordingly. Flagged for statistician review; do not resolve by assertion.

## 6a. Section 6 numeric check (added 2026-08-19, before this document is locked)

A Monte Carlo check was run (`check-hrs-common-mode-cancellation.js`, committed alongside this file), using the actual `hurstApprox` implementation from `src/stats/coherence.js` (not a reimplementation), N=5,000 simulated realizations, 150-bit i.i.d. Bernoulli(0.5) stream pairs.

**Result: cancellation holds for HRS, not just hit rate, and the reason is exchangeability, not linearity.** If the same disturbance distribution is applied independently to two streams that started out identically distributed, the two post-disturbance streams are exchangeable, so E[statistic(A)] = E[statistic(B)] for *any* statistic — this is a more general argument than "linear statistics cancel by arithmetic," and it covers HRS.

Across all four symmetric conditions tested (literal-bias and persistence, synchronized and independent-position masks, at the manuscript's largest tested doses: 0.20 and 0.35 respectively), mean ΔHRS stayed near zero (0.0002–0.0008) with every 95% CI including zero:

| Condition | Mean ΔHRS | 95% CI |
|---|---|---|
| Literal dose=0.20, synchronized | +0.00019 | [−0.00158, +0.00196] |
| Literal dose=0.20, independent-position | −0.00059 | [−0.00234, +0.00116] |
| Persistence dose=0.35, synchronized | +0.00071 | [−0.00106, +0.00247] |
| Persistence dose=0.35, independent-position | −0.00075 | [−0.00256, +0.00107] |

Negative controls confirm the check has power to detect a real residual, not just an underpowered non-result: unequal-half persistence (A=0.35, B=0.10, genuinely asymmetric) gave mean ΔHRS = +0.04659, 95% CI = [+0.04480, +0.04838] — 23× the δ=0.002 bound, clearly excludes zero, as expected from §3.3.3.

One nuance worth reporting rather than glossing over: subject-only literal-bias (asymmetric, composition-type) produced the expected large hit-rate shift (~0.098, matching the analytic ~half-dose expectation) but only a weak, CI-includes-zero HRS shift. Not a flaw in the check — HRS is an ordering-sensitive statistic (§4.5/§4.6), so a pure composition-type asymmetry doesn't necessarily register strongly in it. A genuinely ordering-type asymmetry (unequal-half persistence, above) does register strongly. This should be stated as a scope limit on what HRS is sensitive to, not implied to be universal.

**Caveat on what this does and doesn't establish.** This simulation used fresh, independent bit-pairs per realization — an idealized setup, not the real study's structure (103 fixed real sessions crossed with injected realizations per session). It establishes the *mechanism* (exchangeability implies cancellation-in-expectation, for HRS as for any statistic) cleanly. It does not replace the crossed session-by-realization bootstrap needed to determine the real study's achievable CI width — see the Section 3 caveat above regarding the δ floor and realization count.

**Still flagged for statistician review**, per Section 6's original instruction: the exchangeability argument and its numeric confirmation should be checked independently before being relied upon in a manuscript, particularly the claim that it generalizes beyond the two mechanisms and two mask types actually tested here.
