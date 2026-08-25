# Exp5-Prescreen — Running Notes

Miscellaneous findings, data-quality checks, and audits about this experiment's
data that don't belong in `README.md` (design doc) or `CHANGES.md` (config/code
changelog). Newest entries at the top.

---

## 2026-08-12 — Block-level metric correlation structure: mechanical vs. genuine cross-metric agreement (new analysis, exploratory, supersedes initial framing below)

Follow-up to the block-level Spearman correlation matrix across 10 direct-Subject-stream
ordering/structure metrics (HRS, lag-1 autocorrelation, n-gram entropy orders 1-4,
entropy-order slope, run count, max run length, run-length entropy — computed on Exp4's
canonical `df` after running `Exp4_Notebook2_Zen_Temporal_Structure_Analysis.ipynb` Cells
5+46+50 in sequence, pooled N=11,607 and Baseline-only N=3,090; full matrices in
`metric_corr_pooled.csv` / `metric_corr_baseline.csv` in scratchpad). That matrix showed a
tight correlation cluster among Lag-1 AC / Run count / Max run length / Run-length entropy
(|ρ| up to 0.97) and a moderate link from HRS into that same cluster (ρ≈0.28-0.39). This
entry reports whether any of that is a genuine cross-metric empirical relationship versus a
mechanical consequence of every block being exactly n=150 bits.

**Method (all three checks, same null)**: 20,000 fair Bernoulli(0.5) sequences at fixed
n=150, seed=2026 — zero true cross-sequence signal by construction, pure finite-length
combinatorial noise. Same correlation matrix and a conditional-variance diagnostic (SD of
one metric within a fixed value of Run count, divided by that metric's marginal SD — near 0
means Run count mechanically determines it, near 1 means Run count leaves it essentially
independent) computed on this null and compared directly to the real data.

**Check 1 — Lag-1 AC / Run count / Max run / Run-length entropy vs. null:**
All six pairwise correlations among these four matched the null to within 0.0002-0.0071
(e.g. Lag-1 AC vs Run count: null=-0.9922, real Baseline=-0.9920). The raw correlation
magnitudes in this quartet are close to fully forced by the fixed-length counting
constraint, not empirical convergence of independent instruments.

**Check 2 — HRS vs. the same cluster:**
Null already accounts for most of the correlation (null ρ≈0.26-0.35 vs. real ρ≈0.28-0.39)
but leaves a small, consistently-signed residual (+0.015 to +0.037, larger in Baseline-only
than pooled) that the null does not explain — a real, if small, effect on top of the
mechanical floor.

**Check 3 — the conditional-variance diagnostic, extended to Max run length, computed on
the null itself (N=20,000):**

| Metric | Conditional/marginal SD ratio (within fixed Run count, null data, N=20,000) |
|---|---|
| Lag-1 AC | 0.12 |
| Run-length entropy | 0.24 |
| Max run length | 0.94 |
| HRS | 0.94 |

This split the four-metric cluster by magnitude into an apparent "near-duplicate pair"
(Lag-1 AC, low ratio) and an apparent "independent pair" (Max run length, HRS, high ratio),
with Run-length entropy sitting ambiguously in between. This N=20,000-on-the-null-only
comparison could not by itself say whether 0.24 (or 0.94) reflected anything about REAL
data versus being purely a property of the null's own combinatorics — Check 4 resolves this.

**Check 4 — resolving the ambiguous ratios: real data vs. null sampling distribution at
matched N (not just the null's own point estimate).** The N=20,000 null gives a very
precise ratio estimate, but real Baseline only has N=3,090 blocks — comparing a noisy
real-data ratio against a near-noiseless null point estimate isn't a fair test. Fix:
bootstrap-resampled N=3,090-sized (and N=11,607, pooled) subsamples from the same null
pool (2,000 draws each) to get the null's own sampling distribution of the ratio at
real-data-matched N, then compare real data's actual ratio against that distribution.

| Metric | Real Baseline ratio (N=3,090) | Null 95% range (N=3,090-matched) | Verdict |
|---|---|---|---|
| Lag-1 AC (calibration anchor) | 0.1116 | [0.1080, 0.1222] | INSIDE — p≈0.34 |
| Run-length entropy | 0.2297 | [0.2232, 0.2412] | **INSIDE — p≈0.58** |
| Max run length | 0.9047 | [0.9015, 0.9304] | **INSIDE — p≈0.13** |
| HRS (calibration anchor) | 0.9318 | [0.9386, 0.9577] | OUTSIDE — p≈0.002 |

Calibration check passed: Lag-1 AC (already known near-duplicate) correctly lands inside
the null range; HRS (already known to carry a small real residual, Check 2) correctly
lands outside — on the low side, meaning run count explains *slightly more* of real HRS's
variance than chance predicts, consistent with Check 2's small positive raw-correlation
residual.

**Both Run-length entropy and Max run length resolve to null-consistent** at real
Baseline's actual sample size — their leftover (conditional) variance is statistically
indistinguishable from what pure fixed-length combinatorics alone produces. **Run-length
entropy's 0.24 is not an intermediate/ambiguous case — it resolves to the same side as the
near-duplicate pair, not the independent side its raw magnitude might suggest by eye.**

The pooled (N=11,607) version of this same comparison was run too, but is **not trusted**:
at pooled N, even the Lag-1 AC calibration anchor comes out "outside" the null range,
which means pooling Baseline+AI+Human together introduces between-condition heterogeneity
the null doesn't model — contaminating the comparison with a second source of variance
unrelated to the mechanical-vs-real question. Baseline-only is the valid comparison here.

**Corrected framing (supersedes the original "tight cluster of four" description, and
supersedes the earlier "Max run length is not informationally redundant, like HRS"
framing above)**: of the four metrics, only **HRS** carries a real, non-mechanical residual
correlation with Run count, and even that residual is small. Lag-1 AC, Run-length entropy,
and Max run length are all statistically consistent with pure null/mechanical behavior at
real Baseline's sample size — differing from each other only in how MUCH of their variance
the fixed-length constraint happens to explain (12% leftover for Lag-1 AC's near-duplicate
relationship with Run count, ~23-30% for Run-length entropy and Max run length), not in
whether they carry extra signal beyond that constraint.

Scripts: `run_cluster_structural_check.py`, `hrs_runcluster_null_check.py`,
`runlength_entropy_resolve.py` + `_stage2.py` (the matched-N real-vs-null resolution). Not
yet folded into any notebook.

---

## 2026-08-11 — Baseline offset mechanism investigation (new analysis, exploratory)

Whether Exp4 Baseline's realized paired offset (−0.0017, 95% CI [−0.003823, +0.000301],
not individually resolved) is a pipeline artifact or ordinary sampling noise. ~29% of the
Human5+-vs-Baseline contrast is attributable to this negative Baseline mean, so this bears on how
that result should be read. An earlier exp5-prescreen cross-dataset comparison was underpowered
and removed from the manuscript; this is a fresh, more direct test.

**Part 1 (primary) — synthetic pipeline check**: `hurstApprox` and the assignment-bit/half-split
logic copied verbatim from production (`experiments/exp4/src/stats/coherence.js`,
`MainApp.jsx`'s `processTrials`), run via Node — not a Python port. 200 reps of 3,090 synthetic
fair-Bernoulli(0.5) blocks (103 sessions × 30 blocks, matching real Baseline exactly) through the
real split/scoring logic. Mean of 200 synthetic paired means: +0.000061, 95% range
[−0.002435, +0.002217]. **Real Exp4's −0.0017 falls inside this range.**

**Part 2 — mechanism breakdowns on real data**: flat/unresolved by QRNG provider (fetch-mode
label, session-level only — caveated, not block-level) and by calendar-quarter time period.
Session length is constant (30 blocks/session) for all 103 Baseline sessions, so that
stratification is degenerate. **Within-session block position DID resolve**: early-half mean
−0.004065 [−0.007494, −0.000809] vs. late-half +0.000583 [−0.002272, +0.003494], direct
early-minus-late contrast −0.004647 [−0.009254, −0.000049] — the one part of this investigation
that showed a systematic, resolved pattern.

**Part 3 — physical-half check**: raw halfA−halfB (pre-label) offset = −0.000682
[−0.003046, +0.001693], smaller in magnitude than the labeled Subject−PCS offset (−0.001741,
[−0.003887, +0.000415]) — neither individually resolved at N=103.

**Part 4 — composition margins**: no resolved bit-composition (proportion-of-ones) difference
between halves or between labeled streams. No bias-quantification attempted (no closed-form
composition→bias mapping already implemented in this codebase).

Full script outputs in scratchpad (`baseline_synthetic_pipeline.js`,
`baseline_mechanism_breakdown.py`). Not yet added to any notebook.

---

## 2026-08-11 — AI session-level Subject-PCS hit-rate association traced to pseudo-replication (dropped manuscript item, resolution reconstructed)

Follow-up to the dropped manuscript item "C6. AI session-level Subject–PCS hit-rate
association." No written record of the original resolution reasoning could be found anywhere
searchable (NB1 itself, git history in this repo and the BTM-ZEN sibling repo, project memory
files, manuscript PDFs, filesystem-wide search) — but the exact statistical source was traced and
a concrete, well-supported mechanism was found (built fresh this session, not recovered from a
prior document).

**Source confirmed**: `Exp4_Notebook1_Zen_Paired_Control_Stream_Design_Validation.ipynb`, cell 19
("Subject–PCS Association Diagnostics"), TEST 1 — between-session correlation of AI's mean
Subject hit rate vs. mean PCS hit rate across 126 sessions. Reproduced exactly against NB1's own
`df`: Pearson r=+0.2044, p=.0217, Holm-adjusted p=.0650 (does not survive); Spearman ρ=+0.2182,
p=.0141, Holm-adjusted p=.0423 (survives narrowly).

**Mechanism**: all 15 AI participants run their entire session set as one uninterrupted automated
burst (zero gaps >60min anywhere in an AI participant's session history — confirmed via the same
batch-clustering convention used for the MI checks earlier this session). So AI's 126 "sessions"
are not 126 independent observations — they collapse to exactly **15 truly independent units**.

Collapsed to the true unit (participant = batch, 1:1 for AI):

| Level | N | Pearson r | p | Spearman ρ | p |
|---|---|---|---|---|---|
| Session (as originally reported) | 126 | +0.2044 | .0217 | +0.2182 | **.0141** |
| True independent unit (participant) | 15 | +0.3756 | .168 | **−0.0107** | **.970** |

The Spearman association — the one that narrowly survived Holm correction — **collapses
completely** at the true-unit level (rho flips sign, lands at ~0, p=.97): a pseudo-replication
artifact from treating 126 non-independent, burst-clustered session draws as independent data
points. Pearson at N=15 is not significant either (p=.168) and is likely leverage-driven at that
small N.

This is offered as a well-supported reconstruction of why this item is a non-issue, not a recovery
of the original documented reasoning (which remains unlocated). Matches the standing outline
instruction not to single out AI hit-rate association or frame it as AI-specific.

---

## 2026-08-11 — Alternative-metric battery extended to all conditions (Human-all/Baseline/AI) + pairwise contrasts — added to NB1

Follow-up to 2026-08-10's Human5+-only rebuild (lag-1 autocorrelation, n-gram entropy 1-4,
entropy-rate slope, Fisher z, Levene, 2D energy distance — direct + relational, hierarchy-aware:
contributor-level for Human, session-level for Baseline/AI). Extended to Human(all)/Baseline/AI
plus 3 pairwise contrasts (Human(all)-Baseline, AI-Baseline, Human(all)-AI), 10,000 bootstrap
draws, 95% CIs.

**Result: 1 resolved cell out of ~48 across the entire battery** (Entropy-rate slope — direct,
Human(all)-Baseline, diff=+0.000121), and it is **boundary-fragile**: a re-run with a different
bootstrap seed gave CI=[-0.000003, +0.000247] (crosses zero) vs. the first run's
[+0.0000009, +0.000251] (barely excludes zero). Flips resolution status depending on RNG draw —
effectively the whole battery is null across all three conditions and all three pairwise
contrasts.

**Discovery during this work**: `Exp4_Notebook1_Zen_Paired_Control_Stream_Design_Validation.ipynb`
already has a "Condition Comparisons of Subject–PCS Relationship Structure" section (§3.2.5,
Cells 20-21) covering the same 3 pairwise contrasts for Fisher z / energy distance / a
Levene-Brown-Forsythe variance test — but via whole-session-bundle permutation, not
contributor-clustered bootstrap. Does not cover lag-1/entropy/slope at all. New cells were
inserted right after Cell 21 (now cells 22-24) as an explicit **companion**, not a duplicate:
adds the genuinely-new lag-1/entropy/slope material, and frames the Fisher z/Levene/energy
distance additions as a hierarchy-aware bootstrap-CI companion to the existing permutation
p-values, with a markdown cell stating the methodological relationship explicitly. Verified by
executing the new cells end-to-end against NB1's own data pipeline (`human_df`/`ai_df`/`base_df`,
`hurst_subject`/`hurst_pcs`, `subject_bits`/`demon_bits`) — runs cleanly, `ac1_subject` values
cross-checked exact against Zen NB2's independently-computed Cell 46 cache.

Also found (separately, same session): lag-1/entropy/entropy-rate-slope for Human5+ specifically
already exist in `Exp4_Notebook2_Zen_Temporal_Structure_Analysis.ipynb` Cell 46 ("Alternative
Ordering Metrics — Three Conditions and Human 5+") — point estimates cross-validate exactly
(6 decimal places) against the independently-built NB2b-based rebuild from 2026-08-10, though CI
widths differ meaningfully (Cell 46's CIs are ~30-40% wider). Likely explained by Human5+'s N=3
contributor count making the contributor-level bootstrap highly discretized (only 27 distinct
3-with-replacement draws from 3 items) — small differences in RNG draw sequence or exact
resampling implementation can shift percentile-CI bounds substantially at this N. Not yet
root-caused further; flagged as a known fragility, consistent with [[user_is_pi_participant]]'s
prior note that Human5+ = 3 contributors is already a documented small-N concern.

Not yet done: adding the genuinely-new (Fisher z/Levene/energy distance/MI-bias-floor) material
to NB2's Cell 46 area for Human5+ scope specifically (task still pending).

---

## 2026-08-10 — Three-way shuffle-null comparison (Subject-only / paired / PCS-only) — NEW ANALYSIS, EXPLORATORY, prompted by post-hoc curiosity about null construction

Not a verification of an existing manuscript number — a new analysis. Motivated by
finding (during the §3.6 verification pass, same date) that the shuffle test's null
construction changed at some point between an older Subject-only-shuffle version (used
for the "Beyond the Mean" draft's Figure 4) and the current notebook's paired-shuffle
version (Cell 36, `Exp4_Notebook2_Zen_Temporal_Structure_Analysis.ipynb`, "Paper section:
3.6.3"). Neither existing version tests the reverse (shuffle PCS only, Subject fixed) —
this adds that third condition and runs all three matched on the same block set and the
same per-window permutation draws, so any difference between conditions reflects the
null construction itself, not incidental randomness.

**Step 0**: the old Subject-only shuffle's raw numeric output was found — not in this
repo, but in a sibling repo, `~/Desktop/WTQ/BTM-ZEN/Beyond-The-Mean`, commit `63b6b7d`
(2026-06-18). Same block set (840 Human5+ / 3090 Baseline) as current. qart-experiment's
own committed history has the same cell's *code* but its cached output is stale/mismatched
(a pre-existing, separately-since-fixed bug — belongs to an unrelated "Appendix D" analysis).

**Step 1 sanity check**: Null B (paired, matching Cell 36's method) reproduces Cell 36's
published numbers closely but not bit-identically (max deviation 0.0008 at W=150,
exact at W=1/5/25) — expected, since the shared-permutation requirement forced a
vectorized batch RNG draw order, not Cell 36's original sequential per-block calls.
Same seed (42), same N_SHUFFLES (200).

**Three-condition table** (mean KS-D, Human 5+ vs Baseline, 200 realizations/W):

| W | Null A (Subject-only, PCS fixed) | Null B (paired, same perm both streams) | Null C (PCS-only, Subject fixed) |
|---|---|---|---|
| 1 | 0.0541 | 0.0541 | 0.0541 |
| 3 | 0.0458 | 0.0494 | 0.0536 |
| 5 | 0.0545 | 0.0600 | 0.0574 |
| 10 | 0.0568 | 0.0631 | 0.0585 |
| 25 | 0.0570 | 0.0586 | 0.0546 |
| 50 | 0.0427 | 0.0392 | 0.0473 |
| 150 | 0.0369 | 0.0341 | 0.0398 |

Reference (unshuffled) KS-D = 0.0541, p = 0.0398.

**Pairwise bootstrap summary** (2000 resamples, mean |KS-D difference| across all 7 W, same
block-resample shared across W per draw):

| Pair | Observed mean\|diff\| | 95% CI |
|---|---|---|
| A−B | 0.0033 | [0.0035, 0.0142] |
| A−C | 0.0032 | [0.0048, 0.0195] |
| B−C | 0.0042 | [0.0045, 0.0174] |

Full per-W bootstrap CIs (7 rows × 3 pairs) not reproduced here — see conversation log.
No cell added to any notebook yet; this ran standalone in scratchpad
(`three_null_shuffle.py`, `three_null_bootstrap.py`). Numbers only, no interpretation
attached per the request that prompted this.

---

## 2026-08-10 — Same contributor-aliasing problem found in the windowed-correlation-variance omnibus test (Notebook 2b, Step 8)

Follow-up: checked whether the two other retroactive analyses referencing exp5-prescreen Human
data — the windowed-correlation-variance finding ([[project_windowed_correlation_section15]]) and
the lag+2 exploratory family — share the same naive-UID clustering problem found above.

**Lag+2** (`Exp4_Notebook2_Zen_Temporal_Structure_Analysis.ipynb`, Cells 71-74): loads only Exp4
frozen files (`Frozen_Blocks_2026-02-10...`, `Frozen_Exp4_RawBlockBits...`) — does not touch
exp5-prescreen data at all. Not affected by this issue.

**Windowed-correlation-variance** (`Exp4_Notebook2b_Retroactive_Structure_Metrics.ipynb`, Section
15, Step 8 omnibus permutation test — Cells 15j/134): uses the same naive Firebase-UID
`participant_id` clustering, and it's worse here than the Statistic 2 case above, because it
changes **strata membership**, not just N:

- PI's three aliases (`y612...`, `aYQL5LQb...`, `aYuCWBAc...`) sum to 11 true sessions — once
  merged, PI moves entirely out of "Human2-4" and into "Human5+".
- georgemikemiller's two aliases (`RSrkU8Yd...`, `jaFBRIlW...`) sum to 5 true sessions — same
  move, Human2-4 → Human5+.
- This directly contradicts the notebook's own claimed "zero overlap between Human5+ and
  Human2-4" disjointness check, which only compared raw UID strings.

**Recomputed omnibus test** (combined stat = mean(log variance-ratio) across W=5/10/15/20,
participant-level exact/Monte Carlo permutation):

| Comparison | Naive (N) | p | Conservative dedup (N) | p | Extended dedup (N) | p |
|---|---|---|---|---|---|---|
| Human(all) vs Baseline | 12 | 0.0076 | 9 | 0.0120 | 8 | 0.0148 |
| Human5+ vs Baseline | 3 | 0.0455 | 4 | 0.0420 | 3 | 0.0591 |
| Human2-4 vs Baseline | 9 | 0.0175 | 5 | 0.0604 | 5 | 0.0604 |

**Human2-4 does not survive dedup** — crosses over p=0.05 in both corrected scenarios. The
notebook's claim that Human2-4 "carries its own independent, exactly-significant signal... a real
contribution from participants never flagged by any prior test" does not hold up and should not be
cited as established. **Human5+ is boundary-fragile** — survives (barely) under conservative dedup,
fails under the extended sensitivity scenario; verdict flips depending on whether `wvToPbdc...` is
folded into PI. **Human(all) vs Baseline is the one result that holds up** across every clustering
scenario tried (weakens from p=0.0076 to p=0.0148, but stays under 0.05 throughout) — this, not the
original three-way "all significant" summary, is the honest headline result from Step 8.

Notebook updated in place: inserted Cell 15j-2 (dedup re-run, all three scenarios) after the
original Cell 15j, and rewrote the Step 8 Interpretation cell to state the corrected picture
instead of the original overstated one. Not yet re-run end-to-end in Colab — cached output not
available for either the original or corrected cells in the local file.

**Open item carried over**: Exp4's own Human contributor pool (used in Cell 15k's replication
attempt) has not been audited for the same kind of aliasing — flagged, not assumed clean.

---

## 2026-08-10 — Contributor dedup for the Human-condition contributor-clustered bootstrap (resolves open item below)

Follow-up to the PI-run session count entry below: the "12 contributors" used as
the resampling unit for the Exp5-prescreen Human-PCS side of the Baseline-vs-
Human-PCS reversal check (Statistic 2 in
`Exp4_vs_Exp5Prescreen_Baseline_CrossDataset_Check_2026-08-09.ipynb`) is a naive
count of distinct Firebase auth UIDs. Audited all 12 against
`Frozen_Exp5Prescreen_Participants_2026-07-25.csv` (via `session_rank_history`
sid links, plus exact date + `session_count` corroboration for docs with no
rank_history trace) to find true independent participants.

**Confirmed merges (hard evidence — email + date + session-count match):**
- `y612YV0ACNSi8gs6TnC3QIueQi23`, `aYQL5LQbYUfvmcahficaM6fz2032`,
  `aYuCWBAcACaz6v1lBdQfjYfoQlp1` → all **PI**, under 3 different emails
  ([REDACTED] / [REDACTED] / [REDACTED] /
  [REDACTED]). `aYQL5LQb...` is additionally confirmed a test
  account — it also ran baseline-condition sessions under the same UID, which
  a genuine human participant would not do.
- `RSrkU8YdCxNBMszFKmpw7vUjJS52` + `jaFBRIlWA9O2p6Cn69uel8OEK5G3` → one real
  external participant ([REDACTED]), 2+3=5 sessions matching
  their participant doc's `session_count` and date range exactly.

→ **naive N=12 collapses to N=9 true contributor units** (conservative, primary).

**Sensitivity scenario:** `wvToPbdcnOhWXWmVQHA2pBinMb43` is the identical UID
to one of Exp4's 3 flagged Baseline "insider" (PI) contributors, but has no
exp5-internal email trail confirming it independently. Folding it into PI as a
sensitivity check gives **N=8**.

**Recomputed contributor-clustered bootstrap for Baseline − Human_PCS** (point
estimate unchanged at +0.000489 across all three — dedup only changes the
resampling unit, not the block-weighted mean):

| Clustering | N units | 95% CI | width | resolved? |
|---|---|---|---|---|
| Naive (Firebase UID) | 12 | [−0.000647, +0.002092] | 0.002739 | no |
| Conservative dedup | 9 | [−0.000657, +0.002319] | 0.002975 | no |
| Extended dedup (sensitivity) | 8 | [−0.000618, +0.002916] | 0.003534 | no |

CI widens as expected with fewer true clusters, but the conclusion is
unchanged in all three: CI still includes zero. This is the corrected number
to cite if this contrast stays in the manuscript. Notebook updated in place
with the dedup mapping, all three scenarios, and an updated Interpretation
cell citing N=9.

**Resolves the open item below**: the 19-vs-8 session-count gap is now largely
explained — `[REDACTED]`'s claimed 10 sessions and `[REDACTED]`'s
claimed 2 sessions are split across `aYuCWBAcACaz6v1lBdQfjYfoQlp1` (only 1 of
10 claimed sessions actually exists in the Sessions CSV — the other 9 were
likely started but never completed/persisted) and `aYQL5LQbYUfvmcahficaM6fz2032`
(2 of 2 claimed sessions confirmed, both under the `human` condition — this UID
separately ran 5 more sessions under `baseline`, tracked in its own raw-UID-keyed
participant doc, not counted in the `human` session_count at all).

---

## 2026-08-10 — PI-run session count

Checked how many prescreen sessions belong to the PI (Rosalee Rester / Andrea
Rester Campbell), using the 4 known PI `participant_id` values against the
frozen snapshot `Frozen_Exp5Prescreen_Participants_2026-07-25.csv`.

**PI participant_ids checked:**
- `1fa4dbfb252784545e0b827a54f17593` — [REDACTED]
- `2ca85939294aefb09b481ef700f681f2` — [REDACTED]
- `37b161c00c84ac48ebbd1b72ce91b339` — [REDACTED]
- `4afd2a0aff7de98915abc66c4e0f3a78` — [REDACTED]

All 4 are logged as `participant_type: human`, none under baseline/AI.

| participant_id | email | session_count | usable_session_count |
|---|---|---|---|
| `1fa4dbfb...` | [REDACTED] | 3 | 3 |
| `2ca85939...` | [REDACTED] | 2 | — (not populated) |
| `37b161c0...` | [REDACTED] | 10 | 8 |
| `4afd2a0a...` | [REDACTED] | 4 | 3 |
| **Total** | | **19** | 14 (of the 2 populated) |

**Caveat found during the check:** the participant-doc `session_count` field
(19 total) likely over-counts. Cross-referencing via each participant doc's
`session_rank_history` (only populated for 4 of the 19 sessions) shows all 4
traced session_ids land on a single Firebase auth UID,
`y612YV0ACNSi8gs6TnC3QIueQi23` — the same account already flagged in the Exp4
audit as "the PI's own account, also a Baseline contributor." That UID has
**8 total sessions** directly in `Frozen_Exp5Prescreen_Sessions_2026-07-25.csv`,
all `human` condition — a smaller, more trustworthy number than the 19
self-reported counter total, since several of the 4 hash-IDs above appear to be
different emails entered under the same physical device/account rather than 4
distinct people.

**Open item:** full reconciliation of why participant-doc counters (19) exceed
the UID-linked session count (8) — i.e., which of the 19 are real distinct runs
vs. duplicate/test sessions — has not been done. Use **8** (UID-verified) as the
conservative PI-session count for any exclusion/sampling-hierarchy analysis
until that reconciliation happens.
