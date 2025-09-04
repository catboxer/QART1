// exp3/src/config.js

// App-level settings (used by App.js for the QA hash)
export const config = {
  CONSENT_VERSION: 'v1-2025-09-3',
  QA_SECRET: 'WHAT_THE_QUARK_EXP_3',
  DEBRIEF_URL: 'https://whatthequark.com/debriefs/',
};

// Experiment constants grouped under experiments.pk
config.experiments = {
  pk: {
    EXPERIMENT_ID: 'pk_retro_pk_pilot_v0',
    VISUAL_HZ: 5,
    // TRIAL_MS: 143,
    MINUTES_TOTAL: 14,
    REST_MS: 10_000,
    RETRO_TAPE_BITS: 300,
    RETRO_USE_TAPE_B_LAST: true, // last Retro minute uses Tape B
    NEEDLE_WINDOW: 20,
    PRIME_PROB: 0.75, // 75% prime / 25% neutral
    TARGET_SIDES: ['RED', 'GREEN'],
    LOW_CONTRAST_MODE: false, // default OFF (toggle available)
    // storage
    FIRESTORE_RUNS: 'runs',
    FIRESTORE_TAPES: 'tapes',
  },
};

// Convenience export so existing imports keep working:
export const pkConfig = config.experiments.pk;
