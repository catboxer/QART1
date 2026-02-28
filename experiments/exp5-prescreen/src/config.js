// App-level settings (used by App.js for the QA hash)
export const config = {
  CONSENT_VERSION: 'v1-2025-10-12',
  QA_SECRET: 'WHAT_THE_QUARK_EXP_4',
  DEBRIEF_URL: 'https://whatthequark.com/debriefs/',

  // QRNG source: 'qrng-race' (Outshift/LFDR/ANU), 'random-org' (Random.org), or 'crypto-test' (crypto.getRandomValues for testing)
  // Set to 'random-org' for testing to avoid using paid Outshift quota
  // Set to 'crypto-test' when out of bits during development (will still test timing attack mitigations)
  QRNG_SOURCE: 'qrng-race', // Switch to 'qrng-race' for production, 'random-org' for testing, or 'crypto-test' for local testing
};

// Experiment constants grouped under experiments.pk
config.experiments = {
  pk: {
    EXPERIMENT_ID: 'hurst_prescreen_v1',
    VISUAL_HZ: 5,                  // 5 Hz pulse frequency for loading screen
    REST_MS: 2500,                 // 2.5 s breather
    BLOCKS_TOTAL: 80,              // 80 blocks of focus → fetch → results

    // ── Bit stream size ───────────────────────────────────────────────────────
    // Change TRIALS_PER_BLOCK here — BITS_PER_BLOCK and all NULL_HURST_* constants
    // are derived automatically from the lookup table below.
    // Validated values: 150 | 288 | 576 | 1152
    TRIALS_PER_BLOCK: 150,

    // ── Null distributions (single-scale R/S, 10k simulations per N) ─────────
    // Source: hurst_null_distributions.ipynb — seed 42, numpy default_rng
    NULL_DISTRIBUTIONS: {
      150: {
        mean: 0.52799, sd: 0.04579,
        p10: 0.46875, p25: 0.49594, p50: 0.52837,
        p75: 0.55979, p90: 0.58732, p95: 0.60355, p99: 0.63135,
      },
      288: {
        mean: 0.52827, sd: 0.03988,
        p10: 0.47662, p25: 0.50031, p50: 0.52812,
        p75: 0.55630, p90: 0.58045, p95: 0.59454, p99: 0.61803,
      },
      576: {
        mean: 0.52729, sd: 0.03500,
        p10: 0.48230, p25: 0.50301, p50: 0.52737,
        p75: 0.55120, p90: 0.57247, p95: 0.58601, p99: 0.60700,
      },
      1152: {
        mean: 0.52656, sd: 0.03086,
        p10: 0.48663, p25: 0.50513, p50: 0.52696,
        p75: 0.54800, p90: 0.56639, p95: 0.57760, p99: 0.59710,
      },
    },

    // Hurst delta thresholds (from pilot data: 5+ session subgroup ΔH=+0.004, KS p=0.040)
    HURST_YELLOW_THRESHOLD: 0.002, // trending — matches 2-4 session range
    HURST_GREEN_THRESHOLD: 0.004,  // significant — matches 5+ session subgroup

    // ── Prescreen eligibility gates ──────────────────────────────────────────
    // Layer 1: KS anomaly (permissive — catch weak responders)
    PRESCREEN_KS_ALPHA: 0.15,
    // Layer 2: Shuffle collapse (OR logic)
    PRESCREEN_COLLAPSE_ALPHA: 0.10,   // permutation p-value gate
    PRESCREEN_DDROP_MIN: 0.15,        // magnitude collapse gate (silver threshold)
    PRESCREEN_DDROP_GOLD: 0.20,       // gold rank threshold (stronger magnitude)
    PRESCREEN_COLLAPSE_GOLD: 0.05,    // gold rank threshold (stronger probability)
    // Intensity tier thresholds (SE multiples of |mean ΔH| for eligible sessions)
    // Tier 1: |t| < T2  (subtle — collapseP carried the vote)
    // Tier 2: T2 ≤ |t| < T3  (moderate — ΔH above noise)
    // Tier 3: |t| ≥ T3  (strong — clearly above null)
    PRESCREEN_INTENSITY_T2: 1,   // 1 SE boundary
    PRESCREEN_INTENSITY_T3: 2,   // 2 SE boundary

    // PCS quality warning thresholds (informational only — never gates)
    // nullZ / ghostZ: session-mean Hurst Z and demon hit-rate Z. |Z| > 1.5 fires ~13% of null sessions.
    PRESCREEN_PCS_NULLZ_WARN: 1.5,
    // sdRatio: demonSD / null_SD. >1.5 means demon Hurst is 50% more dispersed than expected.
    PRESCREEN_PCS_SD_RATIO_WARN: 1.5,
    // Shuffle iterations (500 reduces Monte Carlo noise for cumulative analysis)
    N_SHUFFLES: 500,

    // Firestore collection for prescreen sessions
    PRESCREEN_COLLECTION: 'prescreen_sessions_exp5',
    // Multi-session accumulation
    MIN_SESSIONS_FOR_DECISION: 5,   // sessions 1-4 show "come back" screen; 5+ show cumulative result
    PARTICIPANT_COLLECTION: 'prescreen_participants',

    // Audit configuration (NIST SP 800-22 Randomness Testing)
    AUDIT_EVERY_N_BLOCKS: 10,     // Run audit break every N blocks
    AUDIT_BITS_PER_BREAK: 1000,   // Fetch 1000 bits for RNG quality test during audit
    // NIST tests run during audit:
    // 1. Frequency (Monobit) Test - checks proportion of 0s vs 1s (p ≥ 0.01 to pass)
    // 2. Runs Test - checks oscillation between bits (p ≥ 0.01 to pass)
    // 3. Longest Run Test - checks max consecutive 1s (p ≥ 0.01 to pass)
    // Reference: NIST SP 800-22 Rev. 1a (https://csrc.nist.gov/publications/detail/sp/800-22/rev-1a/final)

    NEEDLE_WINDOW: 40,
    PRIME_PROB: 0.75, // 75% prime / 25% neutral
    TARGET_SIDES: ['BLUE', 'ORANGE'], // Color targets for visualization (hardcoded in MainApp)
    LOW_CONTRAST_MODE: false, // default OFF (toggle available)
    SHOW_FEEDBACK_GAUGE: false, // circular gauge showing real-time performance
    SHOW_CONDITION_IN_HUD: false,
    SESSION_ALPHA: 0.01,
    BLOCK_HIGHLIGHT_PCT: 52, //what score gets a congrats
    FINALIST_MIN_PCT: 54, // 54 email capture high score gate opens at or above this percent
    FINALIST_MAX_PCT: 46, // 46 email capture low score gate opens at or below this percent
    AUTO_MODE_SESSIONS: 20, // Number of automated baseline sessions to run (access via #auto URL /exp4#auto)
    AUTO_MODE_REST_MS: 1000, // 1 second auto-continue delay between blocks in auto-mode
    AI_MODE_SESSIONS: 12, // Set this in ai-config.js as it reads it from there. Number of AI agent sessions to run (access via #ai URL /exp4#ai) - run 'sh experiments/exp4/run-ai.sh' first
  },
};

// ── Derive BITS_PER_BLOCK and flat NULL_HURST_* from TRIALS_PER_BLOCK ────────
const pk = config.experiments.pk;

pk.BITS_PER_BLOCK = 1 + 2 * pk.TRIALS_PER_BLOCK;

const _nullDist = pk.NULL_DISTRIBUTIONS[pk.TRIALS_PER_BLOCK];
if (!_nullDist) {
  throw new Error(
    `config: No null distribution for TRIALS_PER_BLOCK=${pk.TRIALS_PER_BLOCK}. ` +
    `Add an entry to NULL_DISTRIBUTIONS or use a validated value: ${Object.keys(pk.NULL_DISTRIBUTIONS).join(', ')}.`
  );
}
pk.NULL_HURST_MEAN = _nullDist.mean;
pk.NULL_HURST_SD   = _nullDist.sd;
pk.NULL_HURST_P10  = _nullDist.p10;
pk.NULL_HURST_P25  = _nullDist.p25;
pk.NULL_HURST_P50  = _nullDist.p50;
pk.NULL_HURST_P75  = _nullDist.p75;
pk.NULL_HURST_P90  = _nullDist.p90;
pk.NULL_HURST_P95  = _nullDist.p95;
pk.NULL_HURST_P99  = _nullDist.p99;

// To test QRNG for bias run node validate-qrng-node.js. This uses 50K bits.
// Convenience export so existing imports keep working:
export const pkConfig = config.experiments.pk;
