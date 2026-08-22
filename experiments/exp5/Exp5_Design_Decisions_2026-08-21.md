---
name: project-exp5-design-2026-08-21
description: "Exp5 preregistration design decisions reached 2026-08-21 — assignment timing, N=200 power justification, 3-tier confirmatory/diagnostic/sensitivity hierarchy (revised after external review), analysis plan. Supersedes ad hoc earlier framings."
metadata: 
  node_type: memory
  type: project
  originSessionId: 08e41a6b-82aa-4b3f-b886-1be74c99fa9e
  modified: 2026-08-22T05:42:29.604Z
---

Locked design decisions for the new (not amended) Exp5 OSF preregistration, reached in a single long working session on 2026-08-21. This supersedes earlier, less settled framings referenced in other memory files (project_revision_status.md) and in experiments/exp6-pilot/notebooks/OSF_Preregistration_Exp5_Registered_2026-08-20.md, which reflects the currently-registered (old) design, not this one.

## Assignment timing (the split)

Moving from bit0-embedded-in-the-same-call assignment to an independent draw for assignment, made right after the participant forms intent and presses the button, but before the QRNG content call goes out. Content generation stays one unified call, both halves generated together — whole-call reconstruction is preserved.

**Why:** the field's actual objection to the current (Exp4) design is that a stream-specific effect requires content to correlate with bit0's *meaning*, which is only assigned downstream in software after generation — a teleological/feedback-driven requirement never argued for explicitly. Deciding assignment's role before content exists removes this: a later correlation with an already-meaningful designation is ordinary forward causation. This does not require the "sealed target, well before intent" framing (that solves an information-leakage problem that doesn't apply here, since nobody ever sees the assignment) — same-call-adjacent timing, right after intent, is sufficient. Does not conflict with the PI's own holistic/diffuse-intent theoretical framework — the participant never aims at a physical half in either design, only at a target color.

**New requirement:** the independent assignment draw needs its own unbiasedness validation (50/50, independent of content), separate from whatever validated bit0 for Exp4.

## Sample size / power (H_RS metric, not hit-rate)

Base model already worked out in `experiments/exp6-pilot/notebooks/Exp5_RS_Persistence_Power_Analysis.md` (+ companion `.py`), dated 2026-08-16, verified against real frozen pilot data; reused directly (not reimplemented) for every number below.

- **120 participants × 5 sessions × 80 blocks/session** (400 blocks/participant) is the population-level-detection minimum. Power: 99.96% conservative / 93.1% stress-case *if Baseline is treated as known*.
- **Final recruitment target is 200, not 120.** 120 covers the primary confirmatory test alone; 200 is set as a buffer specifically so secondary analyses (individual-level flagging, which has no power plateau and keeps improving with N; the psi-ability subgroup and moderation analysis below) have a realistic chance at adequate size, not because the primary test itself needs 200. State this distinction explicitly in the prereg — 200 recruited, powered for 120 completers on the primary test.
- An earlier internal estimate of N=10 should be treated as superseded, not reconciled against. Checked directly: N=10 only reaches 90% power in this same model if the assumed true effect is close to the pilot's *raw, unhalved* participant-level effect (~0.006) or the single strongest pilot performer's effect (~0.0097) — i.e. it implicitly took the pilot's own (inflated, 3-person, retrospectively-selected) effect size at face value. Using a small, selected pilot's observed effect directly as the expected true effect for a follow-up power calculation is a known statistical pitfall, not a reasonable alternative estimate.
- **Baseline needs its own explicit floor — currently missing from the registered prereg.** At realistic pilot-scale Baseline (59–103 sessions) power drops to 67–84%, below target. Recommendation: **≥500 Baseline sessions minimum, ~900 comfortable** (90–92% even under stress). Baseline collection is automated/continuous, no real cost to setting this floor.
- Model is participant-mean-based with between-participant variance as the dominant term — this already satisfies the clustering lesson below (120–200 >> 3 independent clusters).

### Psi-ability subgroup and moderation analysis power (2026-08-21)

Concern raised: broad recruitment across communities may dilute an effect concentrated among high-psi-experience responders, the same washout Exp4's own Human5+ subgroup demonstrated (signal present at n=3, invisible when pooled into the full 122). Addressed with two complementary, prespecified secondary analyses rather than one:

- **Top-tier subgroup** (`psiConfidence` = yes_active, filling in from yes_inconsistent if needed). Power at this same H_RS model, K=400, Baseline≥900 sessions: N=20 gives 65.8% (conservative) / 35.7% (stress); N=50 gives 94.4% (conservative) / 64.6% (stress); reaching 90% under *both* scenarios needs N=120, i.e. most of the sample, which defeats the point of a subgroup. **Working target is N=50, explicitly accepted as adequately powered only under the conservative scenario**, matching how individual-level flagging was already held to a looser bar than the primary test. Real achievable N depends on the actual yes_active response rate in the 200-person sample, not yet known — flag as open/TBD in the prereg, not assumed.
- **Continuous moderation analysis** (condition × psi-ability interaction, full N=200, ability as ordinal predictor): addresses the same washout question without discarding the low-experience majority of the sample. Trades lower per-effect-size sensitivity (interaction terms need more power than main effects for the same true effect) for using the complete dataset rather than ~25% of it. Both analyses should be kept in the prereg, not one instead of the other.

## Hierarchy structure — revised 2026-08-21 after external LLM review, this is the version to use

An earlier draft used primary / secondary (conditional on primary) / tertiary / label-swap. External review caught two real problems with that draft, not just stylistic ones, and the structure below supersedes it entirely.

**Three tiers, not four:**

1. **Confirmatory detection test.** Direct Subject-stream vs. Baseline, full locked population. The only analysis permitted to support the prespecified detection claim.
2. **Mandatory diagnostic characterization — run and reported every time, regardless of the primary's outcome, not gated on primary success.** Subject vs. Baseline, PCS vs. Baseline, Subject-minus-PCS vs. Baseline, reconstructed whole-call vs. Baseline, joint 2D Subject-PCS comparison. These determine how the observed data are configured; they do not independently establish detection, and cannot override a null primary result, but they're the tools that explain *why* a primary result came out the way it did (insufficient precision vs. effect confined to PCS vs. opposition vs. relational-only pattern invisible to any marginal test) — which is exactly what gating them on primary success would have thrown away.
3. **Sensitivity and robustness analyses**, always reported where applicable: label-swap, participant-clustered inference, provider/timing sensitivity, prespecified relational analyses (lag, windowed variance-narrowing), metric calibration and artifact-injection checks.

**Corrected rationale for direct-as-primary** (the original "cannot structurally cancel to zero regardless of mechanism" claim was wrong, not just imprecise — direct has its own blind spot: an effect confined entirely to PCS, or a purely relational change with both marginals unchanged, would be invisible to it too). Accurate version to use going forward: *"The direct Subject-stream comparison was selected as the sole primary test because it does not impose the paired-difference assumption that a relevant change must survive Subject-minus-PCS subtraction. It tests the prespecified marginal Subject-stream hypothesis without committing in advance to whether PCS changes in the same or opposite direction. It is not an omnibus test of every pattern PDP can detect."*

**Preemptive answer to the obvious reviewer question** ("if direct alone determines detection, what does PDP contribute?"): PDP is not being proposed as a more powerful detection test. It's a diagnostic architecture that determines whether a detected or suggestive direct-stream pattern is localized, shared across the call, opposed between streams, assignment-dependent, or relational — legibility of mechanism, not raw detection power.

**Framing for the manuscript**: present this hierarchy as the recommended framework for a future confirmatory implementation, learned from the pilot — not as something retrospectively imposed on the pilot's own (exploratory, hierarchy-free) analysis. The pilot stays labeled exploratory throughout.

**Joint 2D test**: do not call it "tertiary" or imply it sits at a rank alongside primary/secondary — it belongs in the diagnostic/robustness tier, explicitly a joint diagnostic or robustness analysis, not confirmation of any kind. Its demonstrated value this session was structural (axis-agnostic by construction, true regardless of data quality), not empirical — Exp4's own 2D p-value carries the identical n=3 clustering exposure as direct/paired.

## The clustering lesson (why it matters for everything above)

Discovered/confirmed 2026-08-21 while auditing the Beyond-The-Mean NB1/NB2 notebooks against Exp4's Human 5+ finding: **no clustering-correction method (wild cluster bootstrap, cluster-robust SE, participant fixed effects) produces a trustworthy result at only 3 independent clusters**, regardless of how many sessions or blocks sit underneath them. This is not a new finding invented this session — the notebooks' own existing "Hierarchy-Preserving Bootstrap Sensitivity" section already reached the same conclusion independently and correctly hedges its own output as "descriptive... cannot establish generalizability."

**Implication for Exp5:** what matters for valid inference is the number of independent *participants*, not total sessions or blocks. This is why N=120–200 (not a subgroup-restricted N) is the right target, and why any planned subgroup analysis needs its own independent check that it isn't recreating the n=3 problem at a different scale.

**Also implies a manuscript fix still pending:** Exp4's Section 3.6.4.2 sentence "This is the main subgroup estimate because its bootstrap interval accounts for blocks being grouped within sessions and contributors" oversells what contributor-level accounting achieves at n=3 — the n=3 caveat exists later in the same section but isn't adjacent to this claim. Needs tightening so the caveat sits next to the claim, not four sentences downstream. Not yet fixed as of 2026-08-21.

## Additional prespecified secondary analyses

- **Explicitly dropped:** a dose-response hypothesis on cumulative session count (rejected by PI 2026-08-21 — "that is wrong").
- **Lag correlation**, one named lag (candidate: lag+2), not the full ±3 family re-tested. NB2 already has the infrastructure (Lagged Cross-Correlation Family). **Provenance honesty requirement, flagged by external review 2026-08-21 and correct:** if +2 is being carried forward because it's the lag that looked interesting in the earlier exploratory multi-lag pass on pilot data (NB2 cell 71 itself admits this: "any family-surviving result remains a candidate for preregistered replication rather than evidence that lag+2 is mechanistically privileged"), that's still informed by having looked at data first, a smaller one-time version of the same selection problem naming a single lag was supposed to fix. Not a reason to avoid using lag+2. A reason the prereg text must say so plainly: *"this lag was selected based on exploratory pilot analysis and is now tested once, confirmatorily, on new data"* rather than presenting it as independently derived.
- **Windowed local coupling stability / variance-narrowing.** Candidate window sizes 10, 16, 20 blocks (all divide 80 evenly; going higher than 20 leaves too few windows per session for a stable within-session variance estimate). **Same multiplicity flag as the lag item, also correct, also from external review:** testing all three and reporting whichever shows something is a mini version of the family-search problem at 1/3 scale. Fix: **W=10 is the single prespecified primary** (8 windows/session, most stable within-session variance estimate; also happens to match one of the two window sizes NB2's own earlier exploratory local-coupling analysis used on 30-block sessions — worth stating that provenance too, same principle as the lag item). W=16 and W=20 are named sensitivity checks, reported alongside, not independent confirmatory tests.
- **Psi-ability subgroup**, built from `psiConfidence` survey item ("Do you have a psychic ability that you can actively use?" — 4-tier radio: yes_active / yes_inconsistent / experiences_only / no; defined in `experiments/exp5-prescreen/src/questions.js`, present on both `main` and current branch identically). "Top 10%" as originally described doesn't map cleanly onto this — it's categorical, not a continuous score, so the working definition is "the yes_active tier," filling in from yes_inconsistent if needed to reach target size. **Note:** `main` branch also declares a `withFrequency`/`frequencyId: 'experienceFrequency'` companion field on the `experienceTypes` checkbox question, which sounded like a plausible "how much you use it" match, but it's schema-only — no UI component anywhere renders it, so there's no real collected data behind it. Don't use it. Power detail for this subgroup and its moderation-analysis companion is in the Sample size section above.

## Analysis methodology (house style, carried forward from existing notebooks)

Point estimates may be block-weighted; **all uncertainty (CIs, p-values, null tests) must use participant-then-session hierarchy-preserving resampling**, matching NB2's existing convention. Naive block-level tests get reported only as transparent reference numbers, never as the basis for a claim. Whole-call reconstruction (using true physical bit order from the raw-bits pickle, confirmed 2026-08-21 to be mathematically order-invariant for the R/S statistic under two-block swap — a closed-loop cumulative-sum property, not a bug) should be built into the plan from the start as a named secondary analysis, not discovered as a gap afterward. Baseline should be checked against the theoretical ideal-random null (not only against Human), so a future "treatment effect vs. baseline drift" question doesn't need reconstructing after the fact.

## Related memory

See [[project_revision_status]] for the broader Frontiers revision context this sits inside, and [[feedback_rigor_before_trust]] for the working pattern (cluster-check, contrast directly, power-check nulls, verify before trusting) that produced most of these findings.
