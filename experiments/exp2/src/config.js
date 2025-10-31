export const config = {
  // Versioning
  CONSENT_VERSION: 'v1-2025-08-14',
  QA_SECRET: 'WHAT_THE_QUARK_EXP_2',
  DEBRIEF_URL: 'https://whatthequark.com/debriefs/',

  // Trial counts
  trialsPerBlock: {
    // full_stack: 15, // Baseline block (commented out - can re-enable later)
    spoon_love: 100, // Quantum block
  },

  // Priming experiment parameters (commented out - can re-enable later)
  // BOOST_MIN: 5,
  // BOOST_MAX: 15,

  // Confetti display thresholds (score must be > this value)
  confetti: {
    baseline: 56,
    quantum: 56,
  },

  // High score email threshold (p-value for statistical significance)
  // Set to 0.05 for production, 0.5 for testing
  emailSignificanceThreshold: 0.05,
};
// Alter whether feedback is displayed.
