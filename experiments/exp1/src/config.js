export const config = {
  // Versioning
  CONSENT_VERSION: 'v1-2025-08-15',
  QA_SECRET: 'WHAT_THE_QUARK_EXP_1',
  DEBRIEF_URL: 'https://whatthequark.com/debriefs/',
  REQUIRE_PRE: false,
  // --- GATING FEATURE FLAG ---
  // This new flag controls the quantum remapping feature.
  // true = spoon_love block uses click-timing remap (original behavior)
  // false = spoon_love block acts like full_stack (no remap)
  // SET TO false TO DISABLE REMAPPING
  ENABLE_QUANTUM_REMAP: false,
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
};
