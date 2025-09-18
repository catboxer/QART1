export const config = {
  // Versioning
  CONSENT_VERSION: 'v1-2025-08-15',
  QA_SECRET: 'WHAT_THE_QUARK_EXP_1',
  DEBRIEF_URL: 'https://whatthequark.com/debriefs/',
  REQUIRE_PRE: false,
  REDUNDANT_R: 4,   
  // Trial counts in 5s
  trialsPerBlock: {
    full_stack: 30, // Baseline block
    spoon_love: 30, // Quantum block
    client_local: 30, // Quantum block
  },
  // Minium number of trials to be considered full experiment
  completerMin: {
    full_stack: 30,
    spoon_love: 30,
    client_local: 30,
  },
  // High score email threshold (p-value for statistical significance)
  // Set to 0.05 for production, 0.5 for testing
  emailSignificanceThreshold: 0.05,
};