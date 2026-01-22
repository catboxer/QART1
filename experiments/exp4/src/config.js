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
    EXPERIMENT_ID: 'pk_focus_fetch_v2',
    VISUAL_HZ: 5,                  // 5 Hz pulse frequency for loading screen
    REST_MS: 2500,                 // 2.5 s breather
    BLOCKS_TOTAL: 30,             // 30 blocks of focus → fetch → results
    TRIALS_PER_BLOCK: 150,        // 150 trials per block (instant processing)
    BITS_PER_BLOCK: 301,          // 301 bits: 1 for assignment + 300 for trials (150 subject, 150 demon)

    // Audit configuration (NIST SP 800-22 Randomness Testing)
    AUDIT_EVERY_N_BLOCKS: 5,      // Run audit break every N blocks
    AUDIT_BITS_PER_BREAK: 1000,   // Fetch 1000 bits for RNG quality test during audit
    // NIST tests run during audit:
    // 1. Frequency (Monobit) Test - checks proportion of 0s vs 1s (p ≥ 0.01 to pass)
    // 2. Runs Test - checks oscillation between bits (p ≥ 0.01 to pass)
    // 3. Longest Run Test - checks max consecutive 1s (p ≥ 0.01 to pass)
    // Reference: NIST SP 800-22 Rev. 1a (https://csrc.nist.gov/publications/detail/sp/800-22/rev-1a/final)

    NEEDLE_WINDOW: 20,
    PRIME_PROB: 0.75, // 75% prime / 25% neutral
    TARGET_SIDES: ['BLUE', 'ORANGE'], // Color targets for visualization (hardcoded in MainApp)
    LOW_CONTRAST_MODE: false, // default OFF (toggle available)
    SHOW_FEEDBACK_GAUGE: false, // circular gauge showing real-time performance
    SHOW_CONDITION_IN_HUD: false,
    SESSION_ALPHA: 0.01,
    BLOCK_HIGHLIGHT_PCT: 52, //what score gets a congrats
    FINALIST_MIN_PCT: 54, // 54 email capture high score gate opens at or above this percent
    FINALIST_MAX_PCT: 46, // 46 email capture low score gate opens at or below this percent
    AUTO_MODE_SESSIONS: 1, // Number of automated baseline sessions to run (access via #auto URL /exp4#auto)
    AUTO_MODE_REST_MS: 1000, // 1 second auto-continue delay between blocks in auto-mode
    AI_MODE_SESSIONS: 12, // Set this in ai-config.js as it reads it from there. Number of AI agent sessions to run (access via #ai URL /exp4#ai) - run sh experiments/exp4/run-ai.sh first
  },
};
// To test QRNG for bias run node validate-qrng-node.js. This uses 50K bits.
// Convenience export so existing imports keep working:
export const pkConfig = config.experiments.pk;
