# How the equivalence bound (δ = 0.002) was derived

**Date.** 2026-08-16.

**Purpose of this document.** A record of process, not a manuscript section. This explains what was run, on what data, using whose code, and why the resulting number is trustworthy enough to lock into the injection preregistration. Written so that a statistician reviewing the preregistration later can see the provenance chain rather than take the number on faith.

## The problem this solves

The original Section 3.3.1/3.3.2 injection results called a dose "clean" (no systematic bias) whenever its bootstrap CI included zero. That criterion has no stated tolerance — a CI that includes zero is also compatible with any bias smaller than the CI's own half-width, so "includes zero" cannot distinguish a genuinely unbiased pipeline from an underpowered test. Converting this to a real equivalence test (TOST-style: claim "no detectable bias" only if the CI falls entirely within ±δ) requires fixing δ in advance, and fixing it based on something other than a guess.

## What δ needed to represent

δ was defined as: the smallest bias the design could realistically detect, given the actual session-to-session noise in the real data and the actual sample size (103 Baseline sessions, 3,090 blocks). This is a precision/resolution question, answerable from data that has never been touched by any injected disturbance — the real, unperturbed paired-difference series.

## First attempt: CSV-only reconstruction (earlier in this conversation)

Before the raw-bit pickle was available, I rebuilt an approximation of the pipeline from the four public Frozen CSVs (Blocks, Sessions, Participants, Audits), which contain the already-split `subject_bits`/`demon_bits` columns. I recomputed the Hurst statistic myself from a hand-written port of the `hurstApprox` function, then ran a session-cluster bootstrap I wrote myself.

Result: half-width ≈ 0.00201 (hit rate), ≈ 0.00209 (Hurst delta).

This was informative but not authoritative, because it used my own reimplementation of the Hurst function and my own bootstrap code, not the actual code that produced the manuscript's Section 3.3 results. A mismatch between my version and the real pipeline would not have been visible.

## Second attempt: the real pipeline

You uploaded two files: the actual notebook (`Exp4_Notebook1_Zen_Paired_Control_Stream_Design_Validation`, containing the real injection code in cells 57–65) and the raw 301-bit pickle it depends on (`Frozen_Exp4_RawBlockBits_2026-07-26.pkl`), which is not part of the public data release and lives only on your Drive.

**Setup.** All five required inputs (four CSVs plus the pickle) were staged together and run through the notebook's own Cell 3 setup code verbatim, which:
- Reconstructs Subject/PCS bit assignment from the raw 301-bit calls and the recorded assignment bit
- Hash-validates every raw call's SHA-256 against the frozen block's recorded `qrng_hash`
- Asserts that reconstructed hit rates and Hurst values match the frozen, already-published block-level values exactly

All assertions passed with zero mismatches (`Clean reconstruction mismatches: 0`; `Raw-call hash mismatches: 0`; `Raw-call label reconstruction mismatches: 0`). The recovered dataset matched the manuscript's reported counts exactly: 3,090 Baseline blocks, 103 sessions, 11,607 total clean blocks across all three conditions.

One unrelated fix was needed to get this far: `pandas.read_csv` failed on the Audits file because two columns (`qrng_hash`, `audit_bits`, both long hex/bit strings) were being auto-inferred as integers and overflowing. This was patched by forcing those two columns to load as strings. This column pair is not used anywhere in the injection code (cells 57–65); the fix only unblocks Cell 3's unrelated audit-summary table.

**Speed fix, verified before use.** The notebook's `hurst_matrix` function calls the original `hurstApprox` once per row using a pure Python loop, which the injection sweep needs to call several hundred times across 3,090-row matrices (50 realizations x multiple doses x two mask types). Run verbatim, this did not complete within the available execution window. I replaced it with a vectorized NumPy version of the identical arithmetic and confirmed equivalence before using it anywhere: on 500 random test rows, the maximum absolute difference between the original loop and the vectorized version was 4.4 x 10⁻¹⁶, i.e., floating-point noise, not a behavioral difference. No other line of the injection code was changed. The full injection sweep (cells 57–63) was then run with only this one substitution.

**Sanity check against the manuscript.** The rerun reproduced the manuscript's already-published Section 3.3.1 numbers to the reported precision — e.g., synchronized literal-bias at dose 0.20 gave a recovery-error mean of −0.000007, matching the manuscript's reported −0.000007 exactly, with a recovery-error RMS of 0.0257 also matching. This confirms the staged environment and the speed-patched code reproduce the actual published pipeline, not a divergent version of it.

**The dose = 0 dead end.** My first instinct was to read the resolution floor directly off the injection sweep's own dose = 0 row. This turned out to be the wrong quantity: at dose 0, the injection functions (`apply_literal_bias`, `apply_persistence`) select bits to modify using `uniforms < dose`, which is never true when dose = 0. No bits are touched, so the recovered stream is bit-for-bit identical to the clean stream, and the error is exactly zero by mathematical construction — not because the pipeline is precise, but because nothing was perturbed. Every dose = 0 row in the output confirmed this (all statistics exactly 0.000000). This is not a resolution measurement and I discarded it once the reasoning became clear rather than reporting it as if it were one.

**What actually answers the question.** The real resolution floor comes from asking how precisely the mean of the real, unperturbed paired-difference series (`clean_delta_hit`, `clean_delta_hurst` — the validated, hash-checked reconstruction of the actual Baseline data) can be estimated at all, given real session clustering. This was computed using the notebook's own `session_bootstrap_mean` function (whole-session resampling, 3,000 bootstrap draws, the same function and seed family the injection sweep itself uses for its CIs), applied directly to `clean_delta_hit` and `clean_delta_hurst` with no injection involved.

## Result

| Statistic | n (blocks / sessions) | Observed mean | 95% whole-session bootstrap CI | Half-width |
|---|---|---|---|---|
| Hit-rate paired difference (clean_delta_hit) | 3,090 / 103 | 0.000201 | [−0.001836, +0.002205] | 0.00202 |
| Hurst-delta paired difference (clean_delta_hurst) | 3,090 / 103 | −0.001741 | [−0.003948, +0.000386] | 0.00217 |

## Convergence across three independent computations

| Method | Hit-rate half-width | Hurst-delta half-width |
|---|---|---|
| CSV-only reconstruction, my own Hurst + bootstrap code | 0.00201 | 0.00209 |
| Real pipeline, real raw bits, notebook's own bootstrap function | 0.00202 | 0.00217 |
| Manuscript's already-published Section 3.3.4 physical-half calibration (a related but distinct quantity, computed a third way) | — | 0.00237 |

All three land in the same narrow band around 0.002. This is not proof the number is correct in some absolute sense, but three structurally different computations landing in the same place is a reasonable basis for trusting the order of magnitude, rather than treating it as a coincidence.

## What this changes

The originally proposed δ = 0.005 (in the first draft of the injection preregistration) was set from "roughly half the smallest effect size discussed elsewhere in the manuscript" — a substantive judgment call, not a measurement, and looser than what the design can actually resolve. The measured resolution floor is δ ≈ 0.002. Using 0.005 would have made the equivalence claims in Section 3.3.1/3.3.2 look more confident than the data supports.

## What this does not resolve

This establishes only the resolution floor. It does not:
- Rerun or reinterpret the actual dose-response injection results at nonzero doses (Section 3.3.1/3.3.2's reported recovery errors are unchanged by this work)
- Address whether whole-session cluster bootstrap is the correct resampling unit if within-session block correlation has structure not captured by treating sessions as exchangeable (flagged previously, not resolved here)
- Substitute for independent review of whether δ = 0.002, rounded from 0.00202/0.00217, is the number that should actually be locked in the preregistration, versus a more conservative or more principled derivation a statistician might prefer

## STATISTICAL REVIEW FLAG (carried forward)

**Decision.** Whether δ = 0.002 (or a rounded/adjusted version of it) is an appropriate, non-circular equivalence bound for the preregistered injection analysis.

**Why it matters.** This bound determines which doses in Section 3.3.1/3.3.2 will be reported as "no detectable systematic residual" versus "indeterminate" versus "fails to cancel" once the equivalence framing is applied.

**A/B/C.**
- (A) What the data show: three convergent estimates of resolution near 0.002, from the real, hash-validated, unperturbed paired-difference series.
- (B) What the procedure tests: the width of a whole-session cluster bootstrap CI on real Baseline data with no injection, i.e., the smallest bias magnitude this specific design (103 sessions, this variance structure) could statistically distinguish from zero.
- (C) What is scientifically justified: that 0.002 is a reasonable, data-derived estimate of measurement resolution for this design. It is not yet justified as a substantive claim about what bias magnitude would matter scientifically — that is a separate judgment this document does not make.

**Human review needed? YES.** Confirm the resampling unit (session) is appropriate given known block-level correlation structure elsewhere in this dataset, and confirm 0.002 (rather than a rounded, padded, or differently-derived value) is the number that should be written into the preregistration before it is committed.


---

## Part 2: Deriving an Exp5 sample-size target from the same resolution floor

**Date.** 2026-08-16, same session as Part 1.

**Purpose of this section.** A record of how the pilot's measured resolution floor (delta approximately 0.002, Part 1) was used to reason about whether Exp5's planned design (200 participants, 5 sessions each, 80 blocks per session) gives adequate power to resolve effects near the size of the retired Human 5+ Hurst-delta finding. This section documents the reasoning, the checks run, what they showed, what they did not show, and what remains a judgment call for a statistician rather than something settled here.

### The question

The retired Human 5+ subgroup finding (already correctly characterized elsewhere in this project as fully explained by selection, not disproven as a real effect) showed stream-level Hurst shifts of +0.00315 and -0.00294. Whatever the status of that specific finding, its magnitude is a useful benchmark. Is Exp5, as currently planned, even capable of resolving an effect of that size, separate from any question of whether such an effect is real.

### Step 1: does resolution improve with more sessions, and by how much

The pilot's Baseline data (103 real sessions) was used to check whether the whole-session bootstrap CI half-width shrinks according to the standard 1/sqrt(n) relationship as sessions increase. This was tested empirically, not assumed, by drawing real subsamples of 20, 40, 60, 80, and all 103 sessions from the actual data and recomputing the bootstrap CI half-width at each size.

Result. The 1/sqrt(n) prediction, anchored at the true n=103 value, matched the empirically observed half-width at each smaller subsample size to within about 7 percent at the widest discrepancy (n=60). This was treated as adequate validation to extrapolate the same relationship to session counts larger than the pilot's 103, while noting explicitly that this is an extrapolation beyond the directly observed range, not a directly verified result at those larger sizes.

### Step 2: extrapolated sessions needed for various target resolutions

Using half-width(n) = half-width(103) times sqrt(103/n), sessions needed to reach a target delta were computed for both hit-rate and Hurst-delta statistics.

| Target delta | Sessions needed, hit rate | Sessions needed, Hurst delta |
|---|---|---|
| 0.0020 (pilot's actual floor) | approximately 100 | approximately 114 |
| 0.0015 | approximately 178 | approximately 203 |
| 0.0010 | approximately 401 | approximately 457 |
| 0.0007 | approximately 818 | approximately 933 |
| 0.0005 | approximately 1,604 | approximately 1,828 |

A target of delta = 0.0015 was selected as a planning benchmark, roughly half the magnitude of the retired Human 5+ Hurst-delta shifts (0.00315 / 0.00294), giving a margin rather than sitting exactly at the edge of detectability. This gave a target of approximately 203 sessions for Hurst-delta.

Caveats stated at this step, before proceeding. This calculation assumed each new session has noise characteristics similar to the pilot's Baseline sessions, assumed sessions are the correct unit and are independent of each other, and did not yet account for the fact that Exp5 assigns multiple sessions to the same participant, which the 1/sqrt(n) calculation implicitly treats as if every session were an independent draw.

### Step 3: does Exp5's actual design (200 participants times 5 sessions) clear that target

Raw arithmetic. 200 times 5 equals 1,000 sessions, comfortably above the approximately 203-session target, if sessions can be treated as independent. Whether they can be depends on how correlated a given participant's five sessions are with each other, an open question the pilot's Baseline data (only 3 participants) could not answer reliably.

### Step 4: checking the independence assumption against real data

Two comparisons were run, each contrasting a session-level bootstrap (treats every session as its own independent unit) against a participant-level bootstrap (resamples whole participants, keeping each participant's sessions together, which is the more conservative treatment if within-participant correlation exists).

Baseline condition (3 participants, 103 sessions). Ratio (participant-level half-width divided by session-level half-width) equals 0.72. This result was set aside as unreliable. With only 3 participants, a participant-level bootstrap has only 10 possible distinct resamples, too few for the resulting interval to be trustworthy. This is a small-sample degeneracy in the bootstrap procedure itself, not evidence that clustering doesn't matter.

Human condition (121 participants, 158 sessions, median 1 session per participant). Ratio equals 0.94. Because most participants contributed only one session in this condition, this comparison mostly could not distinguish session from participant as a clustering unit, and so is only weakly informative about what happens when participants contribute many sessions each, which is the actual structure Exp5 will have.

AI condition (15 participants, 126 sessions, median 8 sessions per participant). This is the closest structural match in the existing data to Exp5's planned design, though Exp5 plans a fixed 5 sessions per participant rather than AI's variable 1 to 15. Ratio equals 1.06, meaning the participant-level CI was about 6 percent wider than the session-level CI.

Caveat on this last check, stated plainly. 15 participants is thin for a participant-level bootstrap, better than Baseline's 3, but still limited, and the ratio should be read as directional (clustering appears to cost a modest, single-digit percentage in resolution) rather than as a precise multiplier to apply to Exp5's sample-size target.

### Conclusion reached, and its status

Combining Steps 2 through 4. The approximately 203-session target from Step 2, adjusted by a conservative 10 to 15 percent haircut for participant clustering (larger than either real check suggested, to stay on the cautious side), remains well below Exp5's planned 1,000 sessions. On this basis, Exp5's planned design (200 participants times 5 sessions) was judged likely adequately powered to resolve an effect near half the magnitude of the retired Human 5+ Hurst-delta finding.

This conclusion rests on three things. First, an extrapolated 1/sqrt(n) relationship, empirically validated within the observed range (20 to 103 sessions) but not directly tested beyond it. Second, a clustering correction estimated from two conditions (Human, AI) that each imperfectly match Exp5's actual structure, neither with a large number of participants. Third, an assumption that new Exp5 sessions will have noise characteristics similar to the pilot's Baseline sessions, which may not hold if providers, session length, or population change.

None of these three points has been checked by anyone other than the process documented here.

### STATISTICAL REVIEW FLAG

Decision. Whether Exp5's planned 200 participants times 5 sessions times 80 blocks gives adequate power to resolve effects near delta = 0.0015 (Hurst-delta), given the reasoning chain above.

Why it matters. This bears directly on a real, costly design decision already reflected in a grant application, and on whether a future null result in Exp5 would be interpretable as no effect versus underpowered to see it.

What could go wrong. Each of the three open points above could independently push the real required sample size higher than estimated. If the 1/sqrt(n) relationship breaks down at larger n, if within-participant correlation is stronger in Exp5's actual population than in the AI or Human conditions, or if Exp5's session or provider characteristics differ enough from the pilot that the resolution floor itself shifts.

Exploratory or confirmatory. Exploratory. This entire sample-size determination was constructed after seeing the pilot data and the retired Human 5+ effect size, not preregistered in advance of any of it.

Independent of other analyses. No. It reuses the same delta approximately 0.002 resolution-floor calculation from Part 1 of this document as its starting point, and inherits any uncertainty in that number.

What a statistician should verify. First, whether a formal mixed-effects or hierarchical power calculation, built for Exp5's specific planned analysis rather than this CI-width proxy, gives a similar sample-size requirement. Second, whether the 1/sqrt(n) extrapolation is appropriate to project out to session counts roughly 2 to 10 times beyond the pilot's observed range (103 up to as much as 1,000). Third, whether a 10 to 15 percent clustering correction is adequately conservative, or whether Exp5's actual participant population might show stronger within-participant correlation than the Human or AI conditions did.

Human review needed. YES, specifically the three items above, before this sample-size reasoning is treated as settled in any grant materials or the Exp5 preregistration itself.


---

## Part 3: Formal power calculation and clustering correction (ICC / design effect)

**Date.** 2026-08-16, same session as Parts 1 and 2.

**Purpose of this section.** Part 2 used an informal shortcut (CI half-width scaling, target delta = half the retired effect size) to argue Exp5's design was likely adequate. This section replaces that shortcut with two more standard tools: a formal one-sample power calculation, and a design-effect (ICC-based) correction for the fact that Exp5 assigns multiple sessions to the same participant. It also directly answers the question of whether too few participants exist in the available data to check this.

### Why the Part 2 shortcut needed replacing

The Part 2 target (delta = 0.0015, half the retired Human 5+ effect size of approximately 0.003) was a judgment call, not a derived quantity. The 95 percent figure used throughout this project belongs to the confidence level of a constructed interval; it does not by itself specify what fraction of a hypothesized true effect should be treated as a detection margin. The standard tool for that question is statistical power: given a true effect size, a chosen confidence level (alpha = 0.05, matching 95 percent two-sided confidence), and a chosen power (conventionally 80 or 90 percent, the probability of detecting the effect if it is really there), how large a sample is required.

### Step 1: formal power calculation using pilot variance

Using the pilot Baseline session-level standard deviation of delta_hurst (0.011000, computed across 103 sessions) in the standard one-sample power formula:

n = ((z_alpha/2 + z_power)^2 * sigma^2) / (effect_size^2)

| Effect size | Power | Sessions needed |
|---|---|---|
| 0.00315 (retired Human 5+ subject-side shift) | 80% | 96 |
| 0.00315 | 90% | 128 |
| 0.00294 (retired Human 5+ PCS-side shift) | 80% | 110 |
| 0.00294 | 90% | 147 |
| 0.003 (rounded benchmark) | 80% | 106 |
| 0.003 | 90% | 141 |
| 0.0015 (Part 2's margin target) | 80% | 422 |
| 0.0015 | 90% | 565 |

This clarified that the Part 2 shortcut (203 sessions) was not a formal power calculation. It was closer to, though not identical with, a high-power target for detecting an effect half the size of the one actually observed, a stricter and more conservative implicit standard than the conventional 80 to 90 percent power against the full observed effect size. The formal calculation targeting the actual observed effect size (0.003) at conventional power needs only 106 to 141 sessions, well under half of what Part 2's shortcut implied.

Either way, Exp5's planned 1,000 sessions clears every value in this table.

### Step 2: does clustering (multiple sessions per participant) threaten this

Exp5 assigns 5 sessions to each of 200 participants, rather than 1,000 independent participants each contributing one session. If a participant's sessions resemble each other more than they resemble a stranger's session, the effective number of independent units is smaller than the raw session count, and the power calculation above would be overly optimistic. This is a real, standard concern in any repeated-measures design and needed to be checked rather than assumed away.

### Step 3: is there enough data to check this

Three existing conditions were available, with very different suitability for this check.

Baseline: only 3 participants. Too few for any reliable estimate: a bootstrap or ANOVA-based statistic computed on 3 groups is dominated by small-sample noise, and this condition was set aside as uninformative for this specific question (though it remains useful for other purposes elsewhere in this project).

Human: 121 participants, but median 1 session per participant. Most participants contribute no within-participant repetition at all, so this condition has very little power to detect or rule out within-participant correlation, since there is barely any "within" to measure.

AI: 15 participants, median 8 sessions per participant, range 1 to 15. This is the only condition with both enough participants and enough within-participant repetition to estimate correlation meaningfully, and it is structurally the closest available match to Exp5's repeated-measures design, though not a perfect one (Exp5 plans a fixed 5 sessions per participant, not a variable 1 to 15).

### Step 4: measuring the correlation directly (intraclass correlation, ICC)

A standard one-way random-effects ANOVA estimator was used to compute the intraclass correlation coefficient (ICC) of delta_hurst, with participant as the clustering variable, separately for the AI and Human conditions (Baseline excluded per Step 3).

| Condition | Participants | Blocks | Avg. group size | ICC |
|---|---|---|---|---|
| AI | 15 | 3,780 | 247.7 | 0.0015 |
| Human | 121 | 4,737 | 38.6 | 0.0004 |

Both values are close to zero. This means a given participant's delta_hurst values do not meaningfully resemble each other more than they resemble a randomly chosen other participant's values, in either available dataset.

### Step 5: applying the measured ICC to Exp5's planned design

The standard survey-methodology design effect formula, DEFF = 1 + (m-1) x ICC, was applied using Exp5's planned m=5 sessions per participant, converting the raw 1,000 planned sessions into an effective number of independent sessions under a range of assumed ICC values, including values well beyond what was actually measured, as a deliberate stress test.

| Assumed ICC | Design effect (DEFF) | Effective independent sessions (of 1,000 planned) |
|---|---|---|
| 0.00 (no clustering) | 1.00 | 1,000 |
| 0.05 (approx. 33x the measured AI value) | 1.20 | 833 |
| 0.10 | 1.40 | 714 |
| 0.20 | 1.80 | 556 |
| 0.30 (approx. 200x the measured value) | 2.20 | 455 |

Even under the most pessimistic tested assumption (ICC = 0.30, roughly 200 times the measured AI value), Exp5 retains 455 effective independent sessions, still well above the 106 to 141 sessions the formal power calculation (Step 1) requires for 80 to 90 percent power against the observed 0.003 effect size, and still above the more conservative 422 to 565 sessions the Part 2 margin target would require.

### Conclusion

Two separate concerns are both resolved favorably by this analysis. First, whether Exp5's sample size is adequate to detect an effect near the magnitude of the retired Human 5+ finding: yes, with substantial margin, under a standard power calculation. Second, whether too few participants exist in the available pilot data to check the clustering assumption underlying that calculation: no, the AI condition (15 participants, median 8 sessions) provided an adequate, if imperfect, basis for a direct ICC estimate, and that estimate was reassuringly small.

This does not eliminate all uncertainty. The ICC estimates come from the AI and Human conditions, not from Exp5's actual future population, which could in principle behave differently. But the stress test in Step 5 shows the conclusion is not fragile. It would take an implausibly large increase in clustering, far beyond anything observed in the available data, to threaten Exp5's power.

### STATISTICAL REVIEW FLAG

Decision. Whether the ICC estimates from the Human and AI conditions (0.0004 and 0.0015) are an adequate basis for concluding Exp5's clustered design (200 participants times 5 sessions) retains sufficient power, in place of a direct ICC estimate from Exp5's own future population, which does not yet exist.

Why it matters. If Exp5's real population turns out to have meaningfully higher within-participant correlation than either reference condition, actual power could be lower than this analysis concludes, though the Step 5 stress test suggests a large gap would be needed for this to matter.

What could go wrong. The AI condition has only 15 participants, and while adequate for a directional ICC estimate, it is not a large sample for that specific statistic. The one-way ANOVA ICC estimator also assumes similar variance structure across participants, which was not separately checked.

Exploratory or confirmatory. Exploratory. Both the choice to check ICC at all, and the specific reference conditions used, were chosen after seeing the general shape of the pilot data.

Independent of other analyses. Partially. The underlying delta_hurst values are the same data used elsewhere in this project (Parts 1 and 2 of this document, and the broader Human 5+ investigation), so this is not a wholly independent check, though the ICC question itself (within-participant correlation) is a different statistical property than anything previously computed on this data.

What a statistician should verify. First, whether the one-way ANOVA ICC estimator is appropriate given the AI condition's unbalanced group sizes (1 to 15 sessions per participant). Second, whether the standard DEFF formula is the right correction for a repeated-measures design of Exp5's specific structure, or whether a full mixed-effects power simulation would be more appropriate before this is finalized in grant materials. Third, whether the Human and AI conditions are reasonable proxies for Exp5's future population, given that both differ from Exp5 in recruitment and structure.

Human review needed. YES, specifically the three items above, before this power and clustering analysis is treated as a finished power calculation in the Exp5 preregistration or grant application, rather than as strong preliminary evidence supporting the planned sample size.
