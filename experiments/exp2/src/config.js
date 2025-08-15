export const config = {
  // Versioning
  CONSENT_VERSION: 'v1-2025-08-14',
  QA_SECRET: 'WHAT_THE_QUARK_EXP_2',
  DEBRIEF_URL:
    'https://experiments.whatthequark.com/debriefs/experiment2',

  // Trial counts
  trialsPerBlock: {
    full_stack: 30, // Baseline block
    spoon_love: 100, // Quantum block
  },

  // Priming experiment parameters
  priming: {
    BOOST_MIN: 5,
    BOOST_MAX: 15,
    FLOOR: 60,
  },

  // Confetti display thresholds (score must be > this value)
  confetti: {
    baseline: 56,
    quantum: 56,
  },
};
// Alter whether feedback is displayed.
