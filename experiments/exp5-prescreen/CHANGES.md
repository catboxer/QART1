# Exp5 Prescreen — Session Changes

## Eligibility model

**Two-layer swiss cheese (was three):**
- Layer 1 — KS anomaly gate: `ks.originalP < PRESCREEN_KS_ALPHA (0.10)`
- Layer 2 — Shuffle collapse gate (OR logic): `collapseP < 0.10` OR `dDrop >= 0.15`
- `eligible = ksGate && collapseGate`

**PCS validation is now informational only** (was Layer 3).
Three diagnostics fire an amber warning; none are gates. Reason: within-fetch stream
correlation (~r = 0.35) is structural to the adjacent-buffer split design — both halves
come from the same 1153-bit fetch. This is expected and harmless (ΔH cancels it).

## Ranking (saved to Firestore as `prescreen_rank`)
- `gold` — eligible + dDrop > 0.30
- `silver` — eligible + dDrop ≤ 0.30 (includes collapseP-only signals; catches low-amplitude effects)
- `candidate` — `ksGate && !collapseGate` exactly — Firestore tag only, no invite UI
Rank always includes session kind suffix — `evaluatePrescreen` returns the base rank,
MainApp composes `${rank}-${sessionKind}`:
- `gold-human`, `gold-ai`, `gold-baseline`
- `silver-human`, `silver-ai`, `silver-baseline`
- `candidate-human`, `candidate-ai`, `candidate-baseline`
- `none-human`, `none-ai`, `none-baseline`

Both gold and silver receive the invite form (`inviteEligible = eligible`).
Candidate is for researcher audit: distribution is anomalous but temporal ordering unconfirmed.
All session types write prescreen fields.

## Intensity Overlay (new — appended to gold/silver)
Within eligible sessions, `intensityTier` (1/2/3) quantifies effect size:
- Tier 1 — `|mean ΔH| / SE < 1` — Subtle (collapseP may have carried the vote)
- Tier 2 — `1 ≤ |mean ΔH| / SE < 2` — Solid Presence
- Tier 3 — `|mean ΔH| / SE ≥ 2` — Exceptional

SE = `SD(ΔH across blocks) / √nBlocks` — session-empirical, not null-distribution-fixed.
`intensityTier` is null for candidate/null ranks.
Displayed as a badge chip in the results verdict card ("Tier 2 · Solid Presence").

## Config constants (in `pkConfig`)
```
PRESCREEN_KS_ALPHA:          0.10
PRESCREEN_COLLAPSE_ALPHA:    0.10
PRESCREEN_DDROP_MIN:         0.15
PRESCREEN_INTENSITY_T2:      1      // SE boundary: Tier 1 → Tier 2
PRESCREEN_INTENSITY_T3:      2      // SE boundary: Tier 2 → Tier 3
PRESCREEN_PCS_NULLZ_WARN:    1.5   // applies to nullZ and ghostZ — warning only
PRESCREEN_PCS_SD_RATIO_WARN: 1.5   // demonSD / null_SD inflation threshold
N_SHUFFLES:                  200
```
Removed: `PRESCREEN_PCS_NULLZ_MAX`, `PRESCREEN_CROSSCORR_MAX`, `PRESCREEN_PCS_OUTLIER_MAX`

## `computeSessionAnalysis` signature
```js
computeSessionAnalysis(
  subjectBitsHistory,    // Array<Array<0|1>> — exactly TRIALS_PER_BLOCK bits per slot
  hurstSubjectHistory,   // Array<number>
  hurstDemonHistory,     // Array<number>
  nullHurst,             // { mean, sd } from config
  nShuffles,             // default 200
  totalDemonHits,        // number|null — for ghostZ
  totalDemonTrials,      // number|null — for ghostZ
)
```
MainApp passes `totalGhostHits` and `totals.n` (demon trial count equals subject trial
count — same n per block, different halves of the same fetch).

## `computeSessionAnalysis` return shape
```js
{
  nBlocks,
  ks:      { originalD, originalP },
  shuffle: { collapseP, meanShuffledD, dDrop, nShuffles },
  pcs:     { demonMean, demonSD, nullZ, ghostZ, sdRatio, crossCorr },
  deltaH:  { meanDeltaH, seDeltaH },
}
```

**Removed entirely:** `passed`, `meanShiftOnly` (used hardcoded 0.05 — stale vs
configurable gates in `evaluatePrescreen`), `originalSignificant` (same problem).
`evaluatePrescreen` is the single source of truth for all threshold decisions.

**pcs fields:**
- `nullZ` — session-mean demon Hurst Z vs null (SE = null_SD / √nBlocks)
- `ghostZ` — demon bit hit-rate Z vs 0.5; null if totalDemonHits not provided
- `sdRatio` — `demonSD / null_SD`; > 1.5 suggests over-dispersion
- `crossCorr` — Pearson r between H_subject and H_demon per block; expected ~0.35 (structural, diagnostic only)

**deltaH fields:**
- `meanDeltaH` — mean of (H_subject − H_demon) across blocks
- `seDeltaH` — SD(ΔH) / √nBlocks — used for intensityTier

**pearsonR** re-added for `crossCorr` (not used in any gate).

## `evaluatePrescreen(analysis, C)` return shape
```js
{ ksGate, collapseGate, eligible, rank, intensityTier, pcsWarning, pcsFlags }
// pcsFlags: { nullZFlag, ghostZFlag, sdRatioFlag }
```
Single source of truth — confetti trigger, Firestore save, results phase, summary phase.

- Candidate: exactly `ksGate && !collapseGate` — no other conditions
- `pcsWarning` fires if any of nullZ, ghostZ, or sdRatio exceed their thresholds
- Amber banner shows which specific metrics triggered
- Old `seTier` display (null-distribution-fixed SE) replaced by `intensityTier`

## Permutation p-value correction
```js
collapseP = (nGreater + 1) / (nShuffles + 1)   // was: nGreater / nShuffles
```
Avoids `collapseP = 0.0` (overconfident with finite shuffle count). With N=200 the
minimum p is now 1/201 ≈ 0.005 — well below the 0.10 gate.

## Shuffle test (verified)
Still within-block Fisher-Yates: `subjectBitsHistory.map(bits => hurstApprox(shuffled(bits)))`.
Each block's 576 bits shuffled independently; demon history is fixed across all permutations.

## `subjectBitsHistory` storage (verified correct)
`bitsRef.current` is reset to `[]` at the top of every `processTrials` call, so it is
per-block, not cumulative. `parsedSubjectBits` is a new local array built in the subject
loop, stored as: `setSubjectBitsHistory(prev => [...prev, parsedSubjectBits])`.
Each slot is exactly `TRIALS_PER_BLOCK` = 576 bits. Shuffle test is valid.

## Bits-per-block
- `TRIALS_PER_BLOCK = 576`, `BITS_PER_BLOCK = 1153` (1 assignment + 576 subject + 576 demon)
- `validateConfig()` enforces `BITS_PER_BLOCK === 1 + 2 * TRIALS_PER_BLOCK` at runtime
- All stale "30 blocks / 150 trials / 300 bits" strings updated throughout

## HurstDeltaGauge marker swap
- Current block → solid blue line + dot on top (the moving indicator)
- Session average → purple dashed line (stable reference)

## Block indexing (verified correct)
- `blockIdxToPersist.current = blockIdx` captured before `processTrials` increments it
- Minutes saved as docs `0..39`, matching `blockIdx` range before increment
- `saveSessionAggregates` uses `deltaHurstHistory.length` for `blocksCompleted`
  (more reliable than `blockIdx` state timing)

## App.js
- QA dashboard routing removed. `App.js` now just renders `<MainApp />`
- `QAExport.jsx` kept on disk — all Firestore writes preserved for Colab analysis
- Affected only the in-app dashboard UI, not any data collection

## Firestore fields saved per session
```
prescreen_rank, prescreen_eligible,
prescreen_ks_p, prescreen_ks_gate,
prescreen_collapse_p, prescreen_ddrop, prescreen_collapse_gate,
prescreen_intensity_tier,
prescreen_pcs_warning,
prescreen_pcs_nullz, prescreen_pcs_ghostz, prescreen_pcs_sdratio, prescreen_pcs_crosscorr
```
