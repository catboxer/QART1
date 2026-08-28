// App-level settings (used by App.js for the QA hash)
export const config = {
  CONSENT_VERSION: 'v1-2025-10-12',
  QA_SECRET: 'WHAT_THE_QUARK_EXP_4',
  APP_VERSION: 'exp5.2',

  // QRNG source: 'qrng-race' (Outshift/LFDR/ANU), 'random-org' (Random.org), or 'crypto-test' (crypto.getRandomValues for testing)
  // Set to 'random-org' for testing to avoid using paid Outshift quota
  // Set to 'crypto-test' when out of bits during development (will still test timing attack mitigations)
  QRNG_SOURCE: 'qrng-race', // Switch to 'qrng-race' for production, 'random-org' for testing, or 'crypto-test' for local testing

  // Within 'qrng-race', skip straight past Outshift to LFDR (ANU is disabled
  // unconditionally in qrng-race.js, so skipping Outshift makes LFDR the
  // only remaining provider). Auto-gated on the dev build so local testing
  // never burns paid Outshift quota, without needing a manual flip back
  // before deploying -- react-scripts sets NODE_ENV to 'production' for
  // `npm run build` / the Netlify build, 'development' for `npm start`.
  FORCE_SKIP_OUTSHIFT: process.env.NODE_ENV === 'development',
};

// Experiment constants grouped under experiments.pk
config.experiments = {
  pk: {
    EXPERIMENT_ID: 'hurst_prescreen_v1',
    VISUAL_HZ: 5, // 5 Hz pulse frequency for loading screen
    REST_MS: 2500, // 2.5 s breather
    BLOCKS_TOTAL: 80, // 80 blocks of focus → fetch → results

    // ── Bit stream size ───────────────────────────────────────────────────────
    // Change TRIALS_PER_BLOCK here — BITS_PER_BLOCK and all NULL_HURST_* constants
    // are derived automatically from the lookup table below.
    // Validated values: 150 | 288 | 576 | 1152
    TRIALS_PER_BLOCK: 150,

    // ── Null distributions (single-scale R/S, 10k simulations per N) ─────────
    // Source: hurst_null_distributions.ipynb — seed 42, numpy default_rng
    NULL_DISTRIBUTIONS: {
      150: {
        mean: 0.52799,
        sd: 0.04579,
        p10: 0.46875,
        p25: 0.49594,
        p50: 0.52837,
        p75: 0.55979,
        p90: 0.58732,
        p95: 0.60355,
        p99: 0.63135,
      },
      288: {
        mean: 0.52827,
        sd: 0.03988,
        p10: 0.47662,
        p25: 0.50031,
        p50: 0.52812,
        p75: 0.5563,
        p90: 0.58045,
        p95: 0.59454,
        p99: 0.61803,
      },
      576: {
        mean: 0.52729,
        sd: 0.035,
        p10: 0.4823,
        p25: 0.50301,
        p50: 0.52737,
        p75: 0.5512,
        p90: 0.57247,
        p95: 0.58601,
        p99: 0.607,
      },
      1152: {
        mean: 0.52656,
        sd: 0.03086,
        p10: 0.48663,
        p25: 0.50513,
        p50: 0.52696,
        p75: 0.548,
        p90: 0.56639,
        p95: 0.5776,
        p99: 0.5971,
      },
    },

    // Firestore collection for prescreen sessions
    PRESCREEN_COLLECTION: 'prescreen_sessions_exp5',
    // Multi-session accumulation
    TARGET_SESSIONS: 10, // soft target — shows a completion message but does not block further sessions
    MAX_SESSIONS_FOR_ANALYSIS: 20, // consent gate blocks further sessions beyond this usable count
    PARTICIPANT_COLLECTION: 'prescreen_participants',
    // Plaintext email lives here only, separate from the scalars-only participant doc above
    PARTICIPANT_EMAIL_LOOKUP_EXP5_PRESCREEN: 'prescreen_email_lookup',
    // Pre-questionnaire demographics + no-email session-count fallback, keyed on Firebase uid.
    // Own collection so this experiment never shares/collides with other experiments' data
    // (the shared 'participants' collection was doing that by field-name convention only).
    DEMOGRAPHICS_COLLECTION: 'prescreen_demographics',

    // Audit configuration (NIST SP 800-22 Randomness Testing)
    AUDIT_EVERY_N_BLOCKS: 10, // Run audit break every N blocks
    AUDIT_BITS_PER_BREAK: 1000, // Fetch 1000 bits for RNG quality test during audit
    // NIST tests run during audit:
    // 1. Frequency (Monobit) Test - checks proportion of 0s vs 1s (p ≥ 0.01 to pass)
    // 2. Runs Test - checks oscillation between bits (p ≥ 0.01 to pass)
    // 3. Longest Run Test - checks max consecutive 1s (p ≥ 0.01 to pass)
    // Reference: NIST SP 800-22 Rev. 1a (https://csrc.nist.gov/publications/detail/sp/800-22/rev-1a/final)

    AUTO_MODE_SESSIONS: 1, // Number of automated baseline sessions to run (access via #auto URL)
    // 1 session per load so each fresh incognito window/UID produces exactly
    // one session -- baseline collection runs as a scripted loop of fresh
    // incognito windows (see notebooks/run_baseline_overnight.sh), not by
    // loading #auto once and letting it run multiple sessions in one tab.
    AUTO_MODE_REST_MS: 200, // 0.2 second auto-continue delay between blocks in auto-mode
    AI_MODE_SESSIONS: 5, // Number of AI agent sessions to run (access via #ai URL)
  },
};

// ── Derive BITS_PER_BLOCK and flat NULL_HURST_* from TRIALS_PER_BLOCK ────────
const pk = config.experiments.pk;

pk.BITS_PER_BLOCK = 1 + 2 * pk.TRIALS_PER_BLOCK;

const _nullDist = pk.NULL_DISTRIBUTIONS[pk.TRIALS_PER_BLOCK];
if (!_nullDist) {
  throw new Error(
    `config: No null distribution for TRIALS_PER_BLOCK=${pk.TRIALS_PER_BLOCK}. ` +
      `Add an entry to NULL_DISTRIBUTIONS or use a validated value: ${Object.keys(pk.NULL_DISTRIBUTIONS).join(', ')}.`,
  );
}
pk.NULL_HURST_MEAN = _nullDist.mean;
pk.NULL_HURST_SD = _nullDist.sd;
pk.NULL_HURST_P10 = _nullDist.p10;
pk.NULL_HURST_P25 = _nullDist.p25;
pk.NULL_HURST_P50 = _nullDist.p50;
pk.NULL_HURST_P75 = _nullDist.p75;
pk.NULL_HURST_P90 = _nullDist.p90;
pk.NULL_HURST_P95 = _nullDist.p95;
pk.NULL_HURST_P99 = _nullDist.p99;

// Propagate top-level fields so pkConfig consumers (C.*) can access them
pk.APP_VERSION = config.APP_VERSION;

// To test QRNG for bias run node validate-qrng-node.js. This uses 50K bits.
// Convenience export so existing imports keep working:
export const pkConfig = config.experiments.pk;
