import { useState } from 'react';

/**
 * Owns the phase state and all named transitions.
 * Eliminates scattered setPhase('string') literals; callers use named functions.
 *
 * Phase values (internal strings — only this hook should reference them raw):
 *   consent → preQ → onboarding → target_announce ↔ rest
 *   → fetching → score → audit → results → summary → done
 *   auto_complete | ai_complete  (auto/AI mode terminal screens)
 *   next | preparing_next        (auto/AI mode inter-block transitions)
 *   max_sessions                 (participant has reached MAX_SESSIONS_FOR_ANALYSIS)
 */
export function usePhaseRouter() {
  const [phase, setPhase] = useState('consent');

  return {
    phase,
    // ── named transitions ────────────────────────────────────────────────────
    goToConsent:       () => setPhase('consent'),
    goToPreQ:          () => setPhase('preQ'),
    goToOnboarding:    () => setPhase('onboarding'),
    goToTargetAnnounce:() => setPhase('target_announce'),
    goToFetching:      () => setPhase('fetching'),
    goToScore:         () => setPhase('score'),
    goToRest:          () => setPhase('rest'),
    goToAudit:         () => setPhase('audit'),
    goToNext:          () => setPhase('next'),
    goToPreparingNext: () => setPhase('preparing_next'),
    goToResults:       () => setPhase('results'),
    goToSummary:       () => setPhase('summary'),
    goToDone:          () => setPhase('done'),
    goToAutoComplete:  () => setPhase('auto_complete'),
    goToAIComplete:    () => setPhase('ai_complete'),
    goToMaxSessions:   () => setPhase('max_sessions'),
  };
}
