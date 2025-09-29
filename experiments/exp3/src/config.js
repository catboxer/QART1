// App-level settings (used by App.js for the QA hash)
export const config = {
  CONSENT_VERSION: 'v1-2025-09-3',
  QA_SECRET: 'WHAT_THE_QUARK_EXP_3',
  DEBRIEF_URL: 'https://whatthequark.com/debriefs/',
};

// Experiment constants grouped under experiments.pk
config.experiments = {
  pk: {
    EXPERIMENT_ID: 'pk_live_pilot_v1',
    VISUAL_HZ: 5,                  // 200 ms ticks
    BLOCK_MS: 30000,               // 30 s blocks (~150 trials)
    REST_MS: 2500,                 // 2.5 s breather
    BLOCKS_TOTAL: 18,             // 18 blocks ≈ 9 min total runtime
    SESSIONS_PER_PARTICIPANT: 2,
    USE_LIVE_STREAM: true,          // Always use live quantum stream
    LIVE_STREAM_DURATION_MS: 90_000, // how long to stream per LS minute
    NEEDLE_WINDOW: 20,
    PRIME_PROB: 0.75, // 75% prime / 25% neutral
    TARGET_SIDES: ['RED', 'GREEN'],
    LOW_CONTRAST_MODE: false, // default OFF (toggle available)
    SHOW_FEEDBACK_GAUGE: false, // circular gauge showing real-time performance
    SHOW_CONDITION_IN_HUD: false,
    SESSION_ALPHA: 0.01,
    BLOCK_HIGHLIGHT_PCT: 52, //what score gets a congrats
    FINALIST_MIN_PCT: 55, // email capture high score gate opens at or above this percent

    // High score email threshold (p-value for statistical significance)
    // Set to 0.05 for production, 0.5 for testing
    emailSignificanceThreshold: 0.05,

    // storage
    FIRESTORE_RUNS: 'runs',
    FIRESTORE_TAPES: 'tapes',
  },
};

// Convenience export so existing imports keep working:
export const pkConfig = config.experiments.pk;
