"""
Closed-form power calculation for Exp5's confirmatory paired-delta H_RS
("R/S persistence") test, Human vs Baseline. See the companion file
Exp5_RS_Persistence_Power_Analysis.md in this folder for the full writeup,
inputs, and final decision -- this script reproduces every number in it.

Recreated 2026-08-16 after an earlier version of this analysis (title
"Exp5_Power_Calculation_Statistician_Review.md") could not be located on disk
or in Drive. Every input below was re-verified directly against the real
frozen pilot data (exp4 + exp5-prescreen) rather than trusted from memory.

MODEL
-----
A participant's own mean delta_h, averaged over K blocks, has variance:

    Var(participant mean) = sigma_within^2 / K + sigma_between^2

Baseline is collected continuously/automatically (not participant-limited),
so its contribution to the standard error is treated as negligible -- this
reduces to a one-sample test of the Human participant-level grand mean
against Baseline's near-zero reference mean:

    SE(grand mean) = sqrt(Var(participant mean) / N)
    power = Phi(SESOI / SE - z_alpha)      [one-sided alpha]

INPUTS (verified against real data, 2026-08-16)
------------------------------------------------
sigma_within = 0.064
    Pooled block-level SD of delta_h (hurst_subject - hurst_pcs), across ALL
    conditions and BOTH datasets. Computed fresh from Frozen_Blocks_2026-02-
    10_195735.csv (exp4) and Frozen_Exp5Prescreen_Blocks_2026-07-25.csv:
    pooled SD = 0.06417, N=21,047 blocks. Every individual condition/dataset
    breakdown fell in 0.0637-0.0653 -- genuinely stable, confirming the
    recollected 0.064 figure.

SESOI = 0.003
    Half the pilot's Human5+ PARTICIPANT-LEVEL mean effect. Important
    definitional note: exp4 Human5+ (3 participants, 840 blocks) has a
    BLOCK-WEIGHTED pooled mean delta_h of +0.00435, but the UNWEIGHTED
    AVERAGE OF THE THREE PARTICIPANTS' OWN MEANS is +0.00643 (individual
    values: +0.00933, +0.00803, +0.00194). It is this participant-level
    average -- the correct quantity for a participant-clustered design --
    that was halved to get SESOI=0.003 (0.00643/2 = 0.0032), correcting for
    known inflation sources (nested-threshold selection, single-participant
    sensitivity, retrospective family definition).

sigma_between: NOT a single trusted number. Real per-participant-mean SD is
    highly unstable at pilot scale (exp4 Human5+, 3 participants: SD=0.00395;
    exp5-prescreen Human5+, 3 participants: SD=0.00157; exp4 all-121-Human:
    SD=0.01145; exp5-prescreen all-12-Human: SD=0.00366) -- consistent with
    the recollection's own framing that a point estimate (~0.0009) was
    "explicitly marked untrusted." Two bracketing scenarios are used instead:
        conservative = 0.0057
        stress       = 0.010

alpha = 0.05, one-sided (matches this project's convention for other
    directional, pre-specified hypotheses).

FINAL DECISION (this session, 2026-08-16)
------------------------------------------
120 participants x 5 sessions x 80 blocks/session (400 blocks/participant,
48,000 total Human blocks).

Rationale: the population-level test plateaus almost immediately past ~2
sessions (sigma_between dominates once K exceeds roughly 41-126 blocks,
depending on scenario) -- so sessions barely move population-level power.
5 sessions was kept anyway because individual-level detection (flagging a
specific standout participant for case-study follow-up, per the prereg's
"Individual Outlier/Convergence Flagging" item) has NO such floor -- it
keeps improving with more within-person data. At 5 sessions, a pilot-
strongest-performer-sized individual (~0.0093) is flagged with 90% power
(vs only 73% at 3 sessions); an average-repeat-participant-sized individual
(~0.0064) reaches 64% (vs 46% at 3 sessions).

120 was chosen over the smaller ~105 minimum because it clears 90% power
under the pessimistic stress scenario with more margin (93.1% vs the bare-
minimum 90.0%) while asking for the same 5 sessions either way.

BASELINE NOISE (resolved 2026-08-16, was previously "still open")
--------------------------------------------------------------------
The model above treats Baseline as a perfectly-known reference (SE=0). Real
data says otherwise: Baseline's own delta_h is not a clean theoretical zero
and varies by dataset (-0.0017 in exp4, sign-flipped in exp5-prescreen).
Directly measured Baseline BETWEEN-SESSION SD of mean delta_h:
    exp4:           0.0110  (103 sessions)
    exp5-prescreen: 0.0074  (59 sessions)  -- more protocol-relevant, matches
                                              the planned 80-block design
Baseline's blocks behave close to independent within a session (clustered/
naive SE ratio 0.94x-1.02x) -- no extra within-session clustering penalty,
this is purely a "how many independent Baseline sessions do you have" issue.

Folding Var(Baseline_mean) = sigma_between_session_baseline^2 / N_baseline
into Var(Human_mean - Baseline_mean) at the locked N=120/K=400 Human design:
    at PILOT-SCALE Baseline (59-103 sessions, i.e. Baseline collected no
    more than it already has been): power drops to 67-84%, BELOW the 90%
    target under every scenario. This was previously unaddressed by the
    Human-only calculation above.

MINIMUM BASELINE SESSIONS, first pass (see baseline_min_sessions_for_power()
below) -- treating the raw observed between-session SD as an irreducible
per-session floor:
    using exp5-prescreen's sigma (0.0074), stress-Human:   415 sessions
    using exp4's sigma (0.0110), stress-Human:              915 sessions

DECOMPOSITION CHECK (2026-08-16, refines the above): is the observed
between-session SD real drift, or just ordinary block-level sampling noise
that hasn't been averaged out at only 30-80 blocks/session? Solving
    sigma_between_session_observed^2 ~= sigma_within^2/blocks_per_session + sigma_between_true^2
for sigma_between_true:
    exp4 (30 blocks/session):  observed=0.0110 vs pure-noise-predicted=0.0117
        -> 100% of the observed SD is explained by ordinary sampling noise.
           No genuine between-session component survives; exp4's 0.0110
           should be DISCARDED as a Baseline-noise estimate.
    exp5-prescreen (80 blocks/session): observed=0.0074 vs pure-noise-
        predicted=0.0072 -> 93.5% is sampling noise, genuine residual
        sigma_between_true = 0.0019 (small, but real).

CORRECTED MODEL (see population_power_baseline_corrected() below):
    Var(Baseline mean) = sigma_within^2/total_baseline_blocks
                          + sigma_between_true^2/n_baseline_sessions
using sigma_between_true=0.0019. At realistic scale the sigma_within/
total_blocks term dominates (~14x the between-session term), so the
practical minimum barely moves versus the uncorrected estimate: 420
sessions (33,600 blocks) for 90% power under stress-Human, vs 415 before.

WHAT ACTUALLY CHANGES IS THE INTERPRETATION, NOT THE HEADLINE NUMBER: this
is not primarily a "need many independent Baseline sessions to escape a
real per-session penalty" problem (there is barely any real per-session
penalty) -- it is a "need enough TOTAL Baseline blocks" problem, the same
simple 1/sqrt(N) sampling-noise story as everywhere else in this analysis.
How those blocks are batched into sessions is close to irrelevant; total
block count is what's actually being locked in.

RECOMMENDATION: prespecify >=500 Baseline sessions / ~40,000 total blocks
as an explicit minimum (currently absent from the OSF prereg, which only
says Baseline totals are "reported as-achieved" with no floor). Baseline
collection is automated/continuous, not recruitment-limited like Human --
there's no real cost argument for leaving this open-ended given how much it
moves power. ~900 sessions / ~72,000 blocks clears the target comfortably
(91.7% under stress-Human) at low added cost (API/compute time only, no
additional human participants).

REMAINING OPEN ITEMS
------------------------------------------------
- Recruitment is not a general-population sample (purposive sampling from
  practice/neurodivergent communities) -- external validity caveat, does not
  change this calculation but qualifies what it can be generalized to.
- This script does not reproduce the specific N-per-power-target figures
  from the (unlocated) recollected document "Exp5_Power_Calculation_
  Statistician_Review.md" -- e.g. it found N=36/101 (conservative/stress)
  sufficient for 90% power at 10 sessions (Human-only model), versus the
  recollection's N=68/189. Testing two-sided alpha closed only part of the
  gap (N=44/123). The remaining discrepancy is unexplained; this script's
  numbers are the ones independently verified against real data.
"""
import numpy as np
from scipy import stats

SIGMA_WITHIN = 0.064
SESOI = 0.003
SIGMA_BETWEEN_SCENARIOS = {"conservative": 0.0057, "stress": 0.010}
ALPHA = 0.05  # one-sided
BLOCKS_PER_SESSION = 80

# Baseline's own between-session SD of mean delta_h (see BASELINE NOISE above).
# Raw/uncorrected -- conflates real between-session drift with ordinary
# block-level sampling noise. Kept for comparison against the corrected model.
BASELINE_SIGMA_BETWEEN_SESSION = {
    "exp5-prescreen (protocol-matched)": 0.0074,
    "exp4 (more conservative)": 0.0110,
}

# Corrected: genuine between-session component only, after subtracting off
# ordinary sampling noise (see DECOMPOSITION CHECK above). exp4's residual
# was negative (fully explained by noise) -- discarded, not usable here.
SIGMA_BETWEEN_BASELINE_TRUE = 0.0019  # exp5-prescreen, corrected

z_alpha = stats.norm.ppf(1 - ALPHA)


def population_power(N, K, sigma_between, baseline_se=0.0):
    """Power for the confirmatory Human-vs-Baseline grand-mean test.
    N = participants, K = blocks/participant (sessions * 80).
    baseline_se: Baseline's own SE, 0.0 reproduces the original
    Baseline-treated-as-known model."""
    var_participant_mean = SIGMA_WITHIN**2 / K + sigma_between**2
    se_human_mean = np.sqrt(var_participant_mean / N)
    se_diff = np.sqrt(se_human_mean**2 + baseline_se**2)
    return stats.norm.cdf(SESOI / se_diff - z_alpha)


def baseline_min_sessions_for_power(sigma_between_human, sigma_between_session_baseline,
                                     target_power, N=120, K=400, max_sessions=3000):
    """Minimum Baseline sessions so the Human-vs-Baseline test reaches
    target_power, given the locked Human design (N participants, K blocks each)."""
    for n_base in range(10, max_sessions, 5):
        baseline_se = sigma_between_session_baseline / np.sqrt(n_base)
        if population_power(N, K, sigma_between_human, baseline_se) >= target_power:
            return n_base
    return None


def population_power_baseline_corrected(N, K, sigma_between_human, total_baseline_blocks, n_baseline_sessions):
    """Power for the confirmatory test using the CORRECTED Baseline model:
    Var(Baseline mean) = sigma_within^2/total_blocks + sigma_between_true^2/n_sessions
    (real between-session drift, not sampling-noise-inflated). This is the
    authoritative model -- see DECOMPOSITION CHECK above."""
    var_human = SIGMA_WITHIN**2 / K + sigma_between_human**2
    se_human_mean = np.sqrt(var_human / N)
    var_baseline = SIGMA_WITHIN**2 / total_baseline_blocks + SIGMA_BETWEEN_BASELINE_TRUE**2 / n_baseline_sessions
    se_diff = np.sqrt(se_human_mean**2 + var_baseline)
    return stats.norm.cdf(SESOI / se_diff - z_alpha)


def baseline_min_sessions_corrected(sigma_between_human, target_power, N=120, K=400, max_sessions=3000):
    """Minimum Baseline sessions (at 80 blocks/session) under the corrected
    total-blocks-dominated model."""
    for n_base in range(10, max_sessions, 5):
        total_blocks = n_base * BLOCKS_PER_SESSION
        if population_power_baseline_corrected(N, K, sigma_between_human, total_blocks, n_base) >= target_power:
            return n_base
    return None


def individual_power(K, true_effect, alpha=0.05):
    """Power to flag ONE person's own effect as distinguishable from zero,
    using only their own K blocks (no participant pooling)."""
    se = SIGMA_WITHIN / np.sqrt(K)
    z_a = stats.norm.ppf(1 - alpha)
    return stats.norm.cdf(true_effect / se - z_a)


if __name__ == "__main__":
    N, SESSIONS = 120, 5
    K = SESSIONS * BLOCKS_PER_SESSION

    print("=" * 90)
    print(f"FINAL DESIGN: N={N} participants x {SESSIONS} sessions x "
          f"{BLOCKS_PER_SESSION} blocks/session (K={K} blocks/participant)")
    print("=" * 90)
    for scenario, sigma_between in SIGMA_BETWEEN_SCENARIOS.items():
        p = population_power(N, K, sigma_between)
        print(f"  Population-level power, {scenario} (sigma_between={sigma_between}): {p:.4f}")

    print("\nIndividual-level detection power at 5 sessions vs 3 sessions:")
    for sessions in (3, 5, 10):
        k = sessions * BLOCKS_PER_SESSION
        print(f"\n  {sessions} sessions (K={k}):")
        for true_eff, label in [(0.0064, "pilot avg 5+ effect"), (0.0093, "pilot strongest performer")]:
            print(f"    power to flag a single {label} individual: {individual_power(k, true_eff):.3f}")

    print("\n" + "=" * 90)
    print("BASELINE NOISE: power at pilot-scale Baseline vs the recommended minimum")
    print("=" * 90)
    pilot_scale = {"exp5-prescreen (protocol-matched)": 59, "exp4 (more conservative)": 103}
    for label, sigma_b in BASELINE_SIGMA_BETWEEN_SESSION.items():
        n_pilot = pilot_scale[label]
        se_pilot = sigma_b / np.sqrt(n_pilot)
        se_500 = sigma_b / np.sqrt(500)
        se_900 = sigma_b / np.sqrt(900)
        print(f"\n  Baseline sigma_between_session={sigma_b} [{label}]")
        for hlabel, sb_h in SIGMA_BETWEEN_SCENARIOS.items():
            p_pilot = population_power(N, K, sb_h, se_pilot)
            p_500 = population_power(N, K, sb_h, se_500)
            p_900 = population_power(N, K, sb_h, se_900)
            n_min_90 = baseline_min_sessions_for_power(sb_h, sigma_b, 0.90)
            print(f"    {hlabel:<12} Human: pilot-scale({n_pilot} sess)={p_pilot:.3f}  "
                  f"@500 sess={p_500:.3f}  @900 sess={p_900:.3f}  "
                  f"[min Baseline sessions for 90% power: {n_min_90}]")

    print("\n" + "=" * 90)
    print("CORRECTED MODEL: total-blocks-dominated, sigma_between_true=0.0019 (not the")
    print("sampling-noise-inflated 0.0074/0.0110 used above)")
    print("=" * 90)
    for hlabel, sb_h in SIGMA_BETWEEN_SCENARIOS.items():
        n_min = baseline_min_sessions_corrected(sb_h, 0.90)
        blocks_min = n_min * BLOCKS_PER_SESSION if n_min else None
        print(f"\n  {hlabel} Human: min Baseline sessions for 90% power = {n_min} ({blocks_min} blocks)")
        for n in (n_pilot, 500, 900):
            p = population_power_baseline_corrected(N, K, sb_h, n * BLOCKS_PER_SESSION, n)
            print(f"    @ {n} sessions ({n*BLOCKS_PER_SESSION} blocks): power = {p:.4f}")
