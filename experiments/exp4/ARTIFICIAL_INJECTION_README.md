# Exp4 Artificial Injection / Provider Validation — Handoff README

**Branch:** `exp4-artificial-injection` (off `main`)
**Last updated:** 2026-08-19
**Purpose of this file:** so anyone (including a future session with no memory of how this got built) can pick this up cold.

## Why this exists

The Exp4 manuscript ("The Paired-Delta Protocol") was rejected by the Frontiers Chief Editor. His central objection:

> "the experiment relied on multiple QRNG providers, while provider identity was not retained at the block level and consequently cannot be evaluated as an analytic factor... a stronger validation of the proposed artifact-control properties would require prospective testing under independently characterized sources of artifact."

Everything on this branch is aimed at closing that gap. There are **two complementary tracks**, both real, neither a substitute for the other:

- **Track A — real, controlled provider injection** (this file's main subject). Deliberately switches which real QRNG provider (Outshift vs. LFDR) serves each call, under experimenter control, and tests whether the paired-delta architecture cancels a genuine physical common-mode artifact. This is the one the editor's letter is most directly pointing at.
- **Track B — synthetic NIST-sourced injection preregistration.** Already fully built, preregistered, and submitted to OSF (see `injection-preregistration-exp4.md`, `resolution_floor_derivation-exp4.md`, `check-hrs-common-mode-cancellation.js`, `crossed_bootstrap_realization_diagnostic.py`). Not the subject of this README — that track is done pending the OSF registration finalizing.

## The original design brief (7 points), verbatim intent

1. **Log provider identity per call** — non-negotiable. The one thing everything else refines.
2. **Control provider selection, don't just observe it.** Two known endpoints/API keys, script picks per call — not left to a load balancer or race.
3. **Randomize the order, not strict alternation** (A,B,A,B,…) — avoids aliasing with periodic timing effects.
4. **Keep acquisition mechanics identical to Exp4** — same 301-bit call, same bit-0 assignment, same 150/150 split. Only the endpoint and logging change.
5. **Log timestamp + batch/session ID per call, multiple separate sittings** — rules out time-of-day drift as a confound.
6. **Tag as its own condition label** (`provider_validation`, not "Baseline") — can never get merged into the pilot's Baseline arm.
7. **Write the analysis plan before collecting** — see `PROVIDER_VALIDATION_PRESPEC.md`.

## Status checklist

| # | Item | Status |
|---|---|---|
| 1 | Provider identity capture | ✅ Fixed in `src/fetchQRNGBits.js` (was recording the meta-route `'qrng-race'` instead of the real per-call provider — bug, now fixed, matches the already-working version in exp5/exp5-prescreen/exp6-pilot). **Committed, NOT deployed.** |
| 2 | Explicit provider control | ✅ `run-provider-validation.js` calls Outshift/LFDR directly, bypassing the production race/fallback entirely. |
| 3 | Randomized order | ✅ Balanced block-randomized shuffle per sitting (Fisher-Yates), not alternation. |
| 4 | Identical acquisition mechanics | ✅ Same 301-bit call, bit-0 assignment, 150/150 split — ported verbatim from `src/MainApp.jsx`'s `processTrials`. |
| 5 | Timestamp/session ID, multiple sittings | ✅ Built in (`sitting_id`, `call_timestamp`, `committed_at`). No sittings actually run yet. |
| 6 | Own condition label | ✅ `condition: 'provider_validation'`, written to Firestore collection `exp4_artificial_injection` — fully isolated from `experiment3_ai_responses` (the real pilot data). |
| 7 | Analysis plan before collecting | ✅ `PROVIDER_VALIDATION_PRESPEC.md`, including a §7 addendum on the asymmetric/stream-specific variant. **Not yet OSF-registered** — should be, before any real collection starts (same reasoning as Track B's OSF registration). |

## What's actually blocking real data collection

**Nothing is collected yet.** The single blocker: `src/fetchQRNGBits.js`'s fix needs to be deployed to production before real sittings mean anything, because:
- `run-provider-validation.js` / `run-provider-validation-asymmetric.js` call Outshift/LFDR directly — they don't need the deploy, they're ready to run right now.
- But the **real Baseline/AI production collection** (a separate, complementary, *observational* piece — see below) needs the fix live, since AI-mode drives the actual production URL via Puppeteer.

Deploying requires an explicit go-ahead (per standing instruction: never push without being told to). Nothing pushed anywhere yet — this whole branch is local-only.

## Real Baseline/AI production collection — separate from the controlled study, don't conflate them

Running real Baseline/AI sessions through the normal exp4 app (with the fix deployed) is **not the same thing** as the controlled `run-provider-validation.js` study, and doesn't replace it:
- It gives you provider identity **observationally** — whatever the production race/fallback naturally did, not randomized/controlled/balanced.
- Real risk: Outshift is preferred-first in production, so exposure could be heavily skewed toward Outshift, and any LFDR exposure would cluster around whenever Outshift happened to be down — reintroducing a time confound.
- Still useful as a real-condition sanity check, but the controlled study is what actually satisfies "prospective testing under independently characterized sources of artifact."

**Known gap, not yet built:** device/browser/latency/timing capture. Confirmed nowhere in exp4's codebase (checked `MainApp.jsx` for `navigator.*`/`userAgent`/device/latency — nothing). Your own manuscript's §5.8 names this as desirable ("Device, browser, latency, and relevant timing variables should also be logged when privacy and feasibility permit"). Not implemented.

## Practical numbers for running real sittings

- **Outshift daily budget:** ~100,000 bits/day account-wide, shared with the live pilot. Each block call costs 304 bits (38 bytes requested, 3 discarded). Budget conservatively to **300 Outshift calls/day**, not the ~328 theoretical max, leaving headroom for the live pilot.
- **Recommended cadence:** ~15 sittings/day at `node experiments/exp4/run-provider-validation.js --batch-size 40 --outshift-budget 20`, spread across different times of day (this is what makes the time-of-day check meaningful). ~7-8 days to reach the ~2,000-2,500 blocks/provider target in the prespec.
- **Open question, never resolved:** whether to run a smaller staged batch first (e.g. 200-400 blocks/provider) to check for *any* detectable provider effect before committing the full week — raised because raw hit-rate differences between two working QRNGs may be too small to detect at this sample size; H_RS/structure metrics are more likely to show something. Prespec was never updated with a staged plan — worth deciding before starting.
- **Two smoke-test sittings already sit in Firestore** (`exp4_artificial_injection`, labeled `"smoke-test"`, 2 blocks each) — harmless, filterable by label, never cleaned up. Delete or ignore.

## File manifest (this directory)

| File | What it is |
|---|---|
| `src/fetchQRNGBits.js` | The provider-capture fix. Not deployed. |
| `run-provider-validation.js` | Controlled common-mode study — Outshift vs. LFDR, randomized, balanced sittings. Smoke-tested working, no real data collected. |
| `run-provider-validation-asymmetric.js` | Live dual-fetch asymmetric variant. Built, smoke-tested, but **demoted to optional fallback** — primary asymmetric analysis is splicing already-collected common-mode data (free, no new collection), not this script. Only run this if the spliced analysis is ambiguous. |
| `PROVIDER_VALIDATION_PRESPEC.md` | Prespecification for Track A (this track). Not yet OSF-registered. |
| `injection-preregistration-exp4.md` | Track B's locked preregistration (NIST-sourced synthetic injection, δ=0.002 equivalence bound, 100 realizations/dose). Already submitted to OSF (Secondary Data Analysis Plan template, embargoed). |
| `resolution_floor_derivation-exp4.md` | How δ=0.002 was derived — provenance record for Track B. |
| `check-hrs-common-mode-cancellation.js` | Resolves whether paired-delta cancellation holds for the nonlinear HRS estimator (yes, via exchangeability, confirmed by simulation). Track B. |
| `crossed_bootstrap_realization_diagnostic.py` | Decomposes session- vs. realization-driven variance; the diagnostic that set Track B's realization count. Needs `notebooks/Frozen_Blocks_2026-02-10_195735.csv` and `Frozen_Sessions_2026-02-10_195735.csv` (gitignored, kept local — present in this branch's working tree already). Track B. |

## Recommended next steps, in order

1. Decide on `fetchQRNGBits.js`: commit as-is (already done here) → get explicit go-ahead → deploy to production.
2. Decide the staged-vs-full-target collection question above before running real sittings.
3. Consider OSF-registering `PROVIDER_VALIDATION_PRESPEC.md` before any real Outshift/LFDR sittings begin (same rationale as Track B — no data collected yet, still genuinely prospective).
4. Optionally: add device/browser/latency capture if you want the real Baseline/AI observational piece to close that manuscript-flagged gap too.
5. Run real sittings per the cadence above once 1-3 are settled.
