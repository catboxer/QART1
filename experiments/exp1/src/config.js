export const config = {
  // Versioning
  CONSENT_VERSION: 'v1-2025-08-15',
  QA_SECRET: 'WHAT_THE_QUARK_EXP_1',
  DEBRIEF_URL:
    'https://experiments.whatthequark.com/debriefs/experiment1',
  REQUIRE_PRE: false,
  // Trial counts
  trialsPerBlock: {
    full_stack: 8, // Baseline block
    spoon_love: 8, // Quantum block
  },

  // Priming experiment parameters

  BOOST_MIN: 5,
  BOOST_MAX: 15,

  // Confetti display thresholds (score must be > this value)
  confetti: {
    baseline: 56,
    quantum: 56,
  },
};
// Alter whether feedback is displayed.
