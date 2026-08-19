# Provider Validation — Prespecification

**Dated:** 2026-08-18 (written before any data collection under this design)
**Condition label:** `provider_validation` — never `baseline`, never merged into any pilot arm
**Storage:** Firestore collection `exp4_artificial_injection` (completely separate from `experiment3_ai_responses`, which holds all real exp4/pilot data)

## 1. Motivation

We don't have a real physical artifact-injection device to calibrate whether the
analysis pipeline (dDrop / artWarn / H_RS-based structure checks) can actually detect
a genuine, mechanistically-real difference in the bitstream when one is present. QRNG
provider identity is a real, controllable variable that plausibly could produce a
detectable statistical signature (different physical processes, different post-processing,
different firmware) — switching providers under experimenter control gives us an actual
known perturbation to inject, so we can ask two things:

1. Does provider identity produce a detectable difference in hit rate / H_RS on its own?
2. Does that difference (if any) cancel out under the same paired-delta design used
   in the real experiment, or does it leak through?

This is a validation of the pipeline's sensitivity, not a PK measurement. No human or
AI intention is involved — every block is acquired identically to exp4's baseline
(auto-mode) mechanics, just with the QRNG source explicitly controlled and logged
instead of left to the production race/fallback logic.

## 2. Design

1. **Provider identity logged per call, non-negotiable.** Every block doc records both
   `provider_requested` (what the script asked for) and `provider_actual` (the `source`
   field the provider's own response identifies itself with). Any mismatch is a flagged
   anomaly, not silently accepted.
2. **Explicit control, not observation.** The script calls Outshift and LFDR directly
   (same request shapes as `netlify/functions/qrng-race.js`'s `fromOutshift`/`fromLFDR`),
   using `QRNG_OUTSHIFT_API_KEY` from the repo-root `.env`. It never goes through the
   production race/fallback endpoint, so it can never be silently redirected to ANU or
   to a different provider than the one it asked for.
3. **Randomized order, not alternation — via balanced block-randomized sittings.**
   Each sitting pre-generates a random shuffle of a fixed multiset (default: 15 Outshift
   + 15 LFDR = 30 blocks, matching a real Exp4 session length) before any bits are pulled, and logs that planned sequence
   up front. This avoids both strict ABAB aliasing and the failure mode where Outshift's
   daily quota exhausts mid-sitting and silently reshapes a naive per-call coin-flip into
   "early blocks are Outshift, late blocks are LFDR" — a temporal confound by construction.
   See §4 for the exhaustion-handling rule.
4. **Acquisition mechanics identical to exp4.** Same 301-bit call (1 assignment bit + 150 +
   150), same bit-0 assignment rule (`assignmentBit === 1` → subject gets first half), same
   split — ported verbatim from `src/MainApp.jsx`'s `processTrials`. Only the endpoint
   selection and the logging are new; the pipeline itself is untouched.
5. **Timestamp + sitting ID per call, multiple separate sittings.** Every block doc carries
   an ISO timestamp and a `sitting_id`. Sittings are run at different times of day / different
   days, never as one continuous run, so time-of-day drift can be checked as a candidate
   confound rather than assumed away.
6. **Own condition label, own collection.** `condition: 'provider_validation'` on every doc,
   stored in `exp4_artificial_injection` — a Firestore collection with no relationship to
   `experiment3_ai_responses`. It cannot accidentally merge into the pilot's Baseline arm
   because it is not in the same collection, not in the same document ID space, and not
   tagged `baseline`.
7. **This document**, written and dated before collection begins.

## 3. Outshift quota handling (switching rule)

Outshift is also the production pilot's preferred provider — every call this script makes
competes for the same daily quota as real participant sessions. To bound that risk:

- Default per-sitting Outshift budget: **15 calls** (well under whatever the daily cap
  turns out to be, and small relative to the pilot's own usage).
- If an Outshift call fails with a quota/rate-limit signal (matching the same `_429`
  detection `qrng-race.js`'s circuit breaker uses), the script does **not** substitute
  LFDR for that slot. It logs the failure, halts the sitting immediately, and marks the
  sitting doc `ended_reason: 'outshift_exhausted'`. The next sitting starts a fresh
  balanced 15/15 shuffle. This guarantees every *completed* sitting's provider sequence
  is exactly the pre-registered random permutation — never quietly reshaped by exhaustion.
- Any other fetch error (timeout, malformed response) after retries triggers the same
  halt-and-log behavior (`ended_reason: 'fetch_error'`), for the same reason: a sitting
  either completes exactly as planned or stops and says why.
- Sittings should be run when pilot traffic is expected to be low, to minimize quota
  contention with real participants.

## 4. Target sample size

~3,930 blocks per provider (262 completed 30-block sittings), run across enough
separate sittings/days to support the time-of-day check in §5. Sized to reach 80% power
against the most conservative benchmark effect size considered in §8, not just the more
likely ones (see §8 for the full power table and reasoning).

## 5. Primary analysis (two-step test)

Computed identically to the existing exp4/exp5-prescreen pipeline (same hit-rate and H_RS
definitions already used on `raw_bits_b64` / `block_commits` data), grouped by
`provider_actual` instead of by experimental condition:

1. **Does provider produce a detectable difference?** Compare hit rate and H_RS between
   Outshift-served and LFDR-served blocks directly (unpaired, since there's no human
   pairing structure here — this is a pure RNG-source comparison). This is the sensitivity
   check: if the pipeline can't find a difference here, when a real mechanistic difference
   plausibly exists, that bounds how much we should trust it finding one elsewhere.
2. **Does it cancel in a paired-delta construction?** Reconstruct the same kind of paired
   delta the real pipeline uses (e.g. within-sitting or within-block-window contrasts)
   using provider identity as the paired factor, and check whether a real, detected
   provider effect from step 1 washes out under that pairing — which would tell us
   whether the paired-delta design itself is robust to a real confound of this size, or
   whether it can leak through.

Time-of-day is checked as an explicit covariate (sitting start hour) against both hit rate
and H_RS, per §2.5, before either step above is treated as clean.

## 6. What this is not

Not a PK measurement, not eligible for prescreen/eligibility gating, not to be pooled with
`experiment3_ai_responses` or any Baseline/AI arm under any circumstance.

## 7. Addendum — asymmetric (stream-specific) variant

**Dated:** 2026-08-18 (written before any data collection under §2; the splicing analysis
below is written before that analysis is run, but reuses §2's collection — no new collection
is prespecified as the primary approach for this variant)
**Condition label (analysis-derived, not a collection condition):** `provider_validation_asymmetric_spliced`
**Storage:** derived at analysis time from the existing `exp4_artificial_injection` /
`provider_validation` collection — no new Firestore writes for the primary approach.

### 7.1 Motivation

§5 above tests whether the paired-delta protocol cancels a *common-mode* provider artifact —
one that hits both paired streams identically, because both streams came from the same call.
That directly answers the part of the editor's objection about the cancellation mechanism
never having been exercised by a real (not simulated) artifact. It does not touch his other,
harder objection: *"Potential stream-specific, asymmetric, temporal, or provider-dependent
sources of structure are not necessarily removed by paired subtraction."* Common-mode-by-
construction cannot produce an asymmetric artifact, because both streams always share a
provider in that design. This addendum constructs the complementary case.

### 7.2 Primary approach: splice, don't re-collect

Rather than a live dual-fetch collection, build the asymmetric pair post-hoc from data
already collected under §2: take one block whose 301-bit call was served by Outshift and one
block served by LFDR, and treat one block's subject-stream as "stream1" and the other block's
subject-stream as "stream2" of a synthetic cross-provider pair. No new API calls, no new
Firestore collection — pure analysis of the common-mode dataset.

**Constraint, stated up front:** the two spliced blocks were never fetched simultaneously, so
any difference between them could be provider identity *or* could be time-of-day/day-to-day
drift — splicing alone cannot separate those. Mitigation: **restrict candidate pairs to the
same sitting** (or adjacent sittings close in time) rather than pairing across the whole
dataset. A sitting spans minutes, not hours, so this keeps the confound small without
requiring new collection. Report the time gap between spliced pairs as a diagnostic alongside
the result, not just the result itself.

### 7.3 What a result means

If a provider-driven difference was detected in §5 step 1, the prediction under a simple
additive model is that the paired delta (stream1 − stream2) in the spliced construction should
track that same magnitude directly, rather than cancel toward zero — because the two streams
here are not sharing a common-mode source. Confirming that (rather than an unexplained
cancellation or amplification, and with the same-sitting constraint keeping the time-gap
confound small) is what demonstrates the mechanism is understood, not just asserted: paired
subtraction removes shared common-mode structure and preserves stream-specific structure,
rather than behaving unpredictably outside the common-mode case the manuscript's simulated
positive control covered.

### 7.4 Fallback: live dual-fetch variant (optional, not the primary plan)

`run-provider-validation-asymmetric.js` exists and is tested (see repo) as a stronger,
zero-temporal-gap version: it fetches both streams live, seconds apart, within the same block,
always from different providers, and writes to the same isolated collection with condition
`provider_validation_asymmetric`. This is only worth running if the spliced analysis above
comes back ambiguous and a version with no time gap at all is needed to settle it — it costs
additional Outshift quota (one call per block, same budget math as §3) that the spliced
approach doesn't need at all.

## 8. OSF Registration Fields

**Dated:** 2026-08-19, written before any real (non-smoke-test) sitting has run.
**Template:** standard OSF Preregistration (not Secondary Data Analysis Plan — this is genuinely new, not-yet-collected data, unlike the companion injection preregistration).
**Subject:** Statistical Methodology.

**Description:** A real, controlled, prospective test of whether the Paired-Delta Protocol's paired-subtraction architecture cancels a genuine physical common-mode artifact, using QRNG provider identity (Outshift vs. LFDR) as an experimenter-controlled, randomized, logged disturbance. Directly answers the Frontiers Chief Editor's rejection concern that provider identity was never retained or controllable as an analytic factor. Uses identical acquisition mechanics to Exp4 (301-bit call, bit-0 assignment, 150/150 split), via a standalone script that calls each provider directly, bypassing the production race/fallback so provider is fully under experimenter control rather than incidentally observed.

**Research questions:**
1. Does Outshift-served data differ from LFDR-served data in unpaired hit rate (Subject-alone or PCS-alone)?
2. Does Outshift-served data differ from LFDR-served data in unpaired H_RS?
3. Does the paired Subject-minus-PCS difference (hit rate) differ by provider?
4. Does the paired Subject-minus-PCS difference (H_RS) differ by provider?

**Hypotheses:** H1 (RQ1, RQ2): non-directional — no prediction of which provider will show higher/lower values if a difference exists, only that a real physical difference between two independent QRNG sources is plausible a priori. H2 (RQ3, RQ4): if a real provider-driven difference is found in RQ1/RQ2, it will not appear in the paired difference — i.e., magnitude of the paired-difference provider effect will be smaller than the unpaired provider effect, consistent with common-mode cancellation. This is the central claim under test, not assumed.

**Manipulated variables:** Provider (Outshift, LFDR) — controlled, block-randomized within each 30-block sitting (15/15 split, Fisher-Yates shuffle, logged before any calls are made), never left to a race/fallback.

**Sample size / stopping rule:** Target ~3,930 blocks/provider (262 completed 30-block sittings), via scheduled automated sittings (~20/day) over roughly 13 days, or until target reached, whichever is later. Sized for 80% power against the most conservative benchmark effect size, not just the more likely ones (see Sample size rationale below). A sitting halts immediately on any fetch failure (no substitution — see §3) so realized N depends on real-world API reliability and may fall short of target; this will be reported, not backfilled by relaxing the halt rule.

**Measured variables:** Outcomes — hit rate and H_RS per stream (Subject, PCS) and their paired difference, per block. Predictor — `provider_actual` (the real per-call source field returned by each provider's own API response, not merely what was requested; any request/actual mismatch is logged as a flagged anomaly, not silently accepted). Also logged: `sitting_id`, `call_timestamp`, `fetch_latency_ms`.

**Statistical models / equivalence bound — open design decision, stated honestly:** unlike the companion injection preregistration, there is no pre-existing dataset here to derive a resolution floor (δ) from before collection starts. Plan: after the first ~10 sittings, derive this design's own resolution floor via the same whole-sitting bootstrap method used in the companion registration, lock it via a dated addendum to this document, then continue to the full target. Fallback if that initial batch is too small to produce a stable estimate: reuse δ=0.002 from the companion injection preregistration instead, with that substitution also recorded in the same addendum rather than decided silently.

**Sample size rationale / power analysis:** the ~3,930 block target balances a practical constraint (Outshift's ~300 calls/day quota vs. wanting an adequately large sample) against a real, data-grounded power calculation, deliberately sized to reach 80% power against the most conservative benchmark considered, not just the more likely ones.

Grounding: `experiments/exp5-prescreen` (a sibling experiment, same acquisition mechanics — same 301-bit call, same bit-0 assignment, same 150/150 split, byte-identical `hurstApprox` implementation) has complete, correctly-recorded per-block provider identity for every block, unlike Exp4's own frozen export. Its Baseline-condition subset (4,720 blocks, 59 sessions, no possible intention confound, same reasoning as restricting to Baseline elsewhere in this document) contains 1,232 real Outshift-served blocks (17 sessions) and 1,744 real LFDR-served blocks (22 sessions). Session-level H_RS SD: Outshift 0.00746, LFDR 0.00486, pooled 0.00612.

A secondary check on this same exp5-prescreen data: the session-level Outshift-vs-LFDR H_RS difference itself has a 95% bootstrap CI of [-0.00770, -0.00008] — barely excluding zero, but a real, detectable difference in that dataset, not obviously noise. Treated with appropriate caution (a barely-significant result in one dataset is not strong evidence on its own, and may shrink toward zero on independent replication), but it meaningfully raises the odds that Step 1 of this study finds a genuine effect to test cancellation of, rather than nothing.

Using the pooled SD as the working variance estimate (two-sample comparison, alpha=0.05 two-sided):

| Target effect size | Sessions/sittings needed per provider, 80% power |
|---|---|
| 0.0044 (Track B's actual observed benchmark) | ~30 |
| 0.0030 (Track B's rounded benchmark) | ~65 |
| 0.0015 (Track B's conservative margin) | ~261 |

The target of 262 sittings (3,930 blocks/provider) is set to reach 80% power against all three benchmarks, including the most conservative one — a deliberate choice to avoid landing in the same "barely significant, could be noise" territory as the exp5-prescreen check above. This pooled SD is a real two-provider comparison (unlike an earlier, since-superseded version of this section that used a one-sided LFDR-only estimate from Exp4's own partial data), though it draws on a different experiment's data, not Exp4's own — a real, if smaller, caveat than before. Will be checked directly once real two-provider data exists from this study's own collection (still planned, via the same initial ~10-sitting batch and dated-addendum mechanism as the delta derivation below).

**Inference criteria:** Two-sided bootstrap CIs (clustered by sitting), for both the unpaired (Step 1) and paired (Step 2) comparisons. Classification against whichever δ is locked per the item above. Two-of-two step logic: Step 2 conclusions are only interpreted relative to whether Step 1 found anything to cancel.

**Prior knowledge / already-collected data — full disclosure:** two "smoke-test" sittings already exist in the `exp4_artificial_injection` Firestore collection, run to verify the collection script functions correctly against real APIs before any real collection: `pv_1787113000691_bdb2aa` (condition `provider_validation`, 2 blocks — 1 Outshift, 1 LFDR) and `pva_1787116665640_5c3bca` (condition `provider_validation_asymmetric`, 2 blocks). Combined, 4 real blocks of data already exist and have been looked at (to confirm the script worked), predating this registration. These are labeled `"smoke-test"` and are trivial in number (not analyzed for any research question, not included in the target sample size above), but are disclosed here rather than silently excluded, consistent with this project's disclosure practice elsewhere. Recommend either deleting them before real collection starts, or explicitly excluding sittings labeled `"smoke-test"` from all analysis queries.
