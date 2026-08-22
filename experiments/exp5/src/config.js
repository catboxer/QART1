// App-level settings (used by App.js for the QA hash)
export const config = {
  CONSENT_VERSION: 'v1-2025-10-12',
  QA_SECRET: 'WHAT_THE_QUARK_EXP_4',
  APP_VERSION: 'exp5.1',

  // QRNG source: 'qrng-race' (Outshift/LFDR/ANU), 'random-org' (Random.org), or 'crypto-test' (crypto.getRandomValues for testing)
  // Set to 'random-org' for testing to avoid using paid Outshift quota
  // Set to 'crypto-test' when out of bits during development (will still test timing attack mitigations)
  QRNG_SOURCE: 'qrng-race', // Switch to 'qrng-race' for production, 'random-org' for testing, or 'crypto-test' for local testing
};

// Experiment constants grouped under experiments.pk
config.experiments = {
  pk: {
    EXPERIMENT_ID: 'hurst_exp5_v1',
    VISUAL_HZ: 5, // 5 Hz pulse frequency for loading screen
    REST_MS: 2500, // 2.5 s breather
    BLOCKS_TOTAL: 80, // 80 blocks of focus → fetch → results

    // ── Bit stream size ───────────────────────────────────────────────────────
    // Change TRIALS_PER_BLOCK here — BITS_PER_BLOCK is derived automatically below.
    // Validated values: 150 | 288 | 576 | 1152
    TRIALS_PER_BLOCK: 150,

    // Firestore collection for session responses
    PRESCREEN_COLLECTION: 'experiment5_responses',
    // Multi-session accumulation
    TARGET_SESSIONS: 10, // soft target — session 10 shows a completion message but does not block further sessions
    MAX_SESSIONS_FOR_ANALYSIS: 20, // consent gate blocks further sessions beyond this usable count (hard cap)
    PARTICIPANT_COLLECTION: 'experiment5_participants',
    EMAIL_LOOKUP_COLLECTION: 'experiment5_email_lookup',

    // Audit configuration (NIST SP 800-22 Randomness Testing)
    AUDIT_EVERY_N_BLOCKS: 10, // Run audit break every N blocks
    AUDIT_BITS_PER_BREAK: 1000, // Fetch 1000 bits for RNG quality test during audit
    // NIST tests run during audit:
    // 1. Frequency (Monobit) Test - checks proportion of 0s vs 1s (p ≥ 0.01 to pass)
    // 2. Runs Test - checks oscillation between bits (p ≥ 0.01 to pass)
    // 3. Longest Run Test - checks max consecutive 1s (p ≥ 0.01 to pass)
    // Reference: NIST SP 800-22 Rev. 1a (https://csrc.nist.gov/publications/detail/sp/800-22/rev-1a/final)

    // Target color assignment: 'per_session' assigns one target at session start
    // and holds it for all 80 blocks (no re-randomization at audit breaks).
    // 'per_audit' (legacy) re-randomizes the target after every audit break
    // (every AUDIT_EVERY_N_BLOCKS blocks).
    TARGET_ASSIGNMENT: 'per_session',

    AUTO_MODE_SESSIONS: 5, // Number of automated baseline sessions to run (access via #auto URL)
    AUTO_MODE_REST_MS: 1000, // 1 second auto-continue delay between blocks in auto-mode
    AI_MODE_SESSIONS: 5, // Number of AI agent sessions to run (access via #ai URL)
  },
};

// ── Derive BITS_PER_BLOCK from TRIALS_PER_BLOCK ──────────────────────────────
const pk = config.experiments.pk;

pk.BITS_PER_BLOCK = 1 + 2 * pk.TRIALS_PER_BLOCK;

// Propagate top-level fields so pkConfig consumers (C.*) can access them
pk.APP_VERSION = config.APP_VERSION;

// To test QRNG for bias run node validate-qrng-node.js. This uses 50K bits.
// Convenience export so existing imports keep working:
export const pkConfig = config.experiments.pk;
