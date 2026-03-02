import { useState, useRef, useCallback, useEffect } from 'react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { computeSessionAnalysis, evaluatePrescreen } from '../stats/index.js';

/**
 * Owns all prescreen analysis logic: session analysis, cumulative analysis,
 * Firestore rank writes, and pre-computed decision/inviteStatus.
 *
 * Single caller of evaluatePrescreen — no other file calls it.
 *
 * @param {{
 *   db, C,
 *   phase, sessionCount, isAutoMode, isAIMode,
 *   hurstSubjectHistory, hurstDemonHistory, subjectBitsHistory,
 *   totalGhostHits, totals,
 *   pastH_s, pastH_d, pastBits, pastDemonHits, pastDemonTrials,
 *   runRef, allRawBitsRef,
 *   participantHash, participantProfile, emailPlaintext,
 * }} options
 */
export function usePrescreenAnalysis({
  db, C,
  phase, sessionCount, isAutoMode, isAIMode,
  hurstSubjectHistory, hurstDemonHistory, subjectBitsHistory,
  totalGhostHits, totals,
  pastH_s, pastH_d, pastBits, pastDemonHits, pastDemonTrials,
  runRef, allRawBitsRef,
  participantHash, participantProfile, emailPlaintext,
}) {
  const [sessionAnalysis, setSessionAnalysis] = useState(null);
  const [cumulativeAnalysis, setCumulativeAnalysis] = useState(null);
  const savedCumulativeRef = useRef(false); // prevent double-save per session

  // ── resetAnalysis — called from ConsentGate.onAgree and auto-mode session reset ──
  const resetAnalysis = useCallback(() => {
    setSessionAnalysis(null);
    setCumulativeAnalysis(null);
    savedCumulativeRef.current = false;
  }, []);

  // ── Effect 1: Session analysis (enters results phase) ────────────────────────
  useEffect(() => {
    if (phase !== 'results') return;
    if (sessionAnalysis) return; // already computed
    if (hurstSubjectHistory.length === 0) return;
    if (subjectBitsHistory.length !== hurstSubjectHistory.length) {
      console.warn(
        '[prescreen] lockstep mismatch — subjectBitsHistory:',
        subjectBitsHistory.length,
        'hurstSubjectHistory:',
        hurstSubjectHistory.length,
      );
    }
    const result = computeSessionAnalysis(
      subjectBitsHistory,
      hurstSubjectHistory,
      hurstDemonHistory,
      { mean: C.NULL_HURST_MEAN, sd: C.NULL_HURST_SD },
      C.N_SHUFFLES,
      totalGhostHits,
      totals.n,
    );
    setSessionAnalysis(result);
  }, [
    phase, sessionAnalysis,
    subjectBitsHistory, hurstSubjectHistory, hurstDemonHistory,
    totalGhostHits, totals.n,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Effect 2: Cumulative save + rank write (enters results phase) ─────────────
  useEffect(() => {
    if (phase !== 'results') return;
    if (isAutoMode || isAIMode) return; // never accumulate baseline/AI sessions
    if (savedCumulativeRef.current) return; // already saved this session

    const newCount = sessionCount + 1;

    // Combine past-session data with current session
    const newH_s   = [...pastH_s,       ...hurstSubjectHistory];
    const newH_d   = [...pastH_d,       ...hurstDemonHistory];
    const newBits  = [...pastBits,      ...subjectBitsHistory];
    const newDemonHits   = pastDemonHits   + totalGhostHits;
    const newDemonTrials = pastDemonTrials + totals.n;

    if (newH_s.length === 0) return;

    // Mark session as completed and save participant profile scalars
    if (participantHash) {
      savedCumulativeRef.current = true;

      // Mark session complete only when all blocks are accounted for
      if (runRef && allRawBitsRef.current.length === C.BLOCKS_TOTAL) {
        setDoc(runRef, { completed: true }, { merge: true }).catch(console.error);
      }

      // Participant doc: scalars only — no growing arrays
      const profRef = doc(db, C.PARTICIPANT_COLLECTION, participantHash);
      const todayUTC = new Date().toISOString().slice(0, 10);
      const lastDate = participantProfile?.last_session_date;
      const newToday =
        lastDate === todayUTC
          ? (participantProfile?.sessions_today ?? 0) + 1
          : 1;
      setDoc(
        profRef,
        {
          session_count: newCount,
          last_session_date: todayUTC,
          sessions_today: newToday,
          pre_q_completed: true,
          updated_at: serverTimestamp(),
          ...(emailPlaintext ? { email: emailPlaintext } : {}),
          ...(!participantProfile ? { created_at: serverTimestamp() } : {}),
        },
        { merge: true },
      ).catch((err) => console.error('Profile save failed:', err));
    }

    // Session 5+: compute cumulative analysis for display
    if (newCount < C.MIN_SESSIONS_FOR_DECISION) return;
    if (cumulativeAnalysis) return;

    const cumAnalysis = computeSessionAnalysis(
      newBits,
      newH_s,
      newH_d,
      { mean: C.NULL_HURST_MEAN, sd: C.NULL_HURST_SD },
      C.N_SHUFFLES,
      newDemonHits,
      newDemonTrials,
    );
    setCumulativeAnalysis(cumAnalysis);

    // Write cumulative prescreen_rank / prescreen_eligible to session doc
    if (runRef) {
      const { rank: cumRank, eligible: cumEligible } = evaluatePrescreen(cumAnalysis, C);
      const sessionKind = isAutoMode ? 'baseline' : isAIMode ? 'ai' : 'human';
      setDoc(
        runRef,
        {
          prescreen_rank: `${cumRank}-${sessionKind}`,
          prescreen_eligible: cumEligible,
        },
        { merge: true },
      ).catch(console.error);
    }
  }, [
    phase, sessionCount, cumulativeAnalysis,
    participantProfile, participantHash, emailPlaintext,
    runRef, isAutoMode, isAIMode,
    hurstSubjectHistory, hurstDemonHistory, subjectBitsHistory,
    totalGhostHits, totals.n,
    pastH_s, pastH_d, pastBits, pastDemonHits, pastDemonTrials,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Effect 3: Per-session QA stats write (fires when sessionAnalysis is ready) ─
  // prescreen_rank / prescreen_eligible are NOT written here — they require cumulative
  // data (5+ sessions) and are written by Effect 2.
  useEffect(() => {
    if (!sessionAnalysis || !runRef) return;
    const {
      rank: rawRank,
      ksGate,
      collapseGate,
      pcsWarning,
      intensityTier,
    } = evaluatePrescreen(sessionAnalysis, C);
    const sessionKind = isAutoMode ? 'baseline' : isAIMode ? 'ai' : 'human';
    const pcs = sessionAnalysis.pcs;
    setDoc(
      runRef,
      {
        session_rank: `${rawRank}-${sessionKind}`,
        session_ks_p: sessionAnalysis.ks.originalP,
        session_ks_gate: ksGate,
        session_collapse_p: sessionAnalysis.shuffle.collapseP,
        session_ddrop: sessionAnalysis.shuffle.dDrop,
        session_collapse_gate: collapseGate,
        session_intensity_tier: intensityTier ?? 'none',
        session_pcs_warning: pcsWarning,
        session_pcs_nullz: pcs.nullZ,
        session_pcs_ghostz: pcs.ghostZ,
        session_pcs_sdratio: pcs.sdRatio,
        session_pcs_crosscorr: pcs.crossCorr,
      },
      { merge: true },
    ).catch(console.error);
  }, [sessionAnalysis, runRef]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived: decision and inviteStatus ────────────────────────────────────────
  const isCumulativeReady = cumulativeAnalysis != null;

  // Use cumulative analysis when available, session analysis otherwise
  const activeAnalysis = cumulativeAnalysis ?? sessionAnalysis;
  let decision = {
    scope: null, rank: null, eligible: false,
    ksGate: false, collapseGate: false,
    intensityTier: null, pcsWarning: false, pcsFlags: {},
  };
  if (activeAnalysis) {
    const scope = cumulativeAnalysis ? 'cumulative' : 'session';
    const ev = evaluatePrescreen(activeAnalysis, C);
    decision = { scope, ...ev };
  }

  // inviteStatus: summary screen uses this to show invite form
  const { rank, eligible } = decision;
  const showInvite = eligible || rank === 'candidate';
  const category = eligible ? 'eligible' : rank === 'candidate' ? 'candidate_review' : 'none';
  const inviteStatus = { showInvite, category, summaryRank: rank };

  return {
    sessionAnalysis,
    cumulativeAnalysis,
    isCumulativeReady,
    decision,
    inviteStatus,
    resetAnalysis,
  };
}
