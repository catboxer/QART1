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
 *   phase, sessionCount, usableSessionCount, isAutoMode, isAIMode,
 *   hurstSubjectHistory, hurstDemonHistory, subjectBitsHistory, demonBitsHistory,
 *   totalGhostHits, totals,
 *   pastH_s, pastH_d, pastBits, pastDemonBits, pastDemonHits, pastDemonTrials,
 *   runRef, allRawBitsRef,
 *   participantHash, participantProfile, emailPlaintext,
 * }} options
 */
export function usePrescreenAnalysis({
  db, C,
  phase, sessionCount, usableSessionCount, isAutoMode, isAIMode,
  hurstSubjectHistory, hurstDemonHistory, subjectBitsHistory, demonBitsHistory,
  totalGhostHits, totals,
  pastH_s, pastH_d, pastBits, pastDemonBits, pastSubjectHits = 0, pastDemonHits, pastDemonTrials,
  runRef, allRawBitsRef,
  participantHash, participantProfile, emailPlaintext,
  onHistoryUpdated,
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
      demonBitsHistory,
      hurstSubjectHistory,
      hurstDemonHistory,
      { mean: C.NULL_HURST_MEAN, sd: C.NULL_HURST_SD },
      C.N_SHUFFLES,
      totalGhostHits,
      totals.n,
    );
    setSessionAnalysis(result);
  }, [phase, sessionAnalysis, subjectBitsHistory, demonBitsHistory, hurstSubjectHistory, hurstDemonHistory, totalGhostHits, totals.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Effect 2: Cumulative save + rank write (enters results phase) ─────────────
  useEffect(() => {
    if (phase !== 'results') return;
    if (savedCumulativeRef.current) return; // already saved this session

    const newCount = sessionCount + 1;
    const usableNewCount = usableSessionCount + 1;

    // Combine past-session data with current session
    const newH_s        = [...pastH_s,        ...hurstSubjectHistory];
    const newH_d        = [...pastH_d,        ...hurstDemonHistory];
    const newBits       = [...pastBits,       ...subjectBitsHistory];
    const newDemonBits  = [...pastDemonBits,  ...demonBitsHistory];
    const newSubjectHits = pastSubjectHits + totals.k;
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
      setDoc(
        profRef,
        {
          session_count: newCount,
          last_session_date: todayUTC,
          pre_q_completed: true,
          participant_type: isAutoMode ? 'baseline' : isAIMode ? 'ai' : 'human',
          updated_at: serverTimestamp(),
          ...(emailPlaintext ? { email: emailPlaintext } : {}),
          ...(!participantProfile ? { created_at: serverTimestamp() } : {}),
        },
        { merge: true },
      ).catch((err) => console.error('Profile save failed:', err));
    }

    // Update in-memory history for auto/AI back-to-back sessions so the next
    // session in the same browser instance starts with the correct accumulated data.
    if ((isAutoMode || isAIMode) && onHistoryUpdated) {
      onHistoryUpdated({
        h_s: newH_s, h_d: newH_d, bits: newBits, dBits: newDemonBits,
        subjectHits: newSubjectHits, dHits: newDemonHits, dTrials: newDemonTrials,
        count: newCount, usableCount: usableNewCount,
      });
    }

    // 5+ usable sessions: compute cumulative analysis
    if (usableNewCount < C.MIN_SESSIONS_FOR_DECISION) return;
    if (cumulativeAnalysis) return;

    const cumAnalysis = computeSessionAnalysis(
      newBits,
      newDemonBits,
      newH_s,
      newH_d,
      { mean: C.NULL_HURST_MEAN, sd: C.NULL_HURST_SD },
      C.N_SHUFFLES,
      newDemonHits,
      newDemonTrials,
    );
    setCumulativeAnalysis(cumAnalysis);

    const cumEval = evaluatePrescreen(cumAnalysis, C);

    // Score anomaly: cumulative binomial Z for raw subject hit rate
    const cumSubjectZ = newDemonTrials > 0
      ? (newSubjectHits - newDemonTrials * 0.5) / (0.5 * Math.sqrt(newDemonTrials))
      : 0;
    const scoreAnomalyFlag = Math.abs(cumSubjectZ) >= 2;
    // Override rank to 'score_anomaly' only when Hurst gates produced nothing
    const effectiveRank = cumEval.rank === 'none' && scoreAnomalyFlag
      ? 'score_anomaly'
      : cumEval.rank;

    // Write cumulative prescreen_rank / prescreen_eligible to session doc
    if (runRef) {
      const sessionKind = isAutoMode ? 'baseline' : isAIMode ? 'ai' : 'human';
      setDoc(
        runRef,
        {
          prescreen_rank: `${effectiveRank}-${sessionKind}`,
          prescreen_eligible: cumEval.eligible,
          prescreen_would_be_rank: cumEval.wouldBeRank !== effectiveRank ? `${cumEval.wouldBeRank}-${sessionKind}` : null,
          prescreen_score_anomaly: scoreAnomalyFlag,
          prescreen_subject_z: cumSubjectZ,
        },
        { merge: true },
      ).catch(console.error);
    }

    // Cache cumulative verdict on participant doc for quick access in future sessions
    if (participantHash) {
      const profRef = doc(db, C.PARTICIPANT_COLLECTION, participantHash);
      setDoc(
        profRef,
        {
          latest_cumulative_verdict: {
            rank:               effectiveRank,
            wouldBeRank:        cumEval.wouldBeRank,
            eligible:           cumEval.eligible,
            ksGate:             cumEval.ksGate,
            collapseGate:       cumEval.collapseGate,
            intensityTier:      cumEval.intensityTier,
            pcsWarning:         cumEval.pcsWarning,
            artifactWarning:    cumEval.artifactWarning,
            scoreAnomalyFlag,
            subjectZ:           cumSubjectZ,
            cumulativeHitRate:  newDemonTrials > 0 ? newSubjectHits / newDemonTrials : null,
            ksP:                cumAnalysis.ks.originalP,
            collapseP:          cumAnalysis.shuffleSubject.collapseP,
            dDrop:              cumAnalysis.shuffleSubject.dDrop,
            demonCollapseP:     cumAnalysis.shuffleDemon?.collapseP ?? null,
            demonDDrop:         cumAnalysis.shuffleDemon?.dDrop ?? null,
            deltaDGap:          cumAnalysis.artifactContrast?.deltaDGap ?? null,
          },
          latest_usable_session_count: usableNewCount,
          latest_verdict_updated_at:   serverTimestamp(),
        },
        { merge: true },
      ).catch(err => console.error('Verdict cache save failed:', err));
    }
  }, [phase, sessionCount, usableSessionCount, cumulativeAnalysis, participantProfile, participantHash, emailPlaintext, runRef, isAutoMode, isAIMode, onHistoryUpdated, hurstSubjectHistory, hurstDemonHistory, subjectBitsHistory, demonBitsHistory, totalGhostHits, totals.n, totals.k, pastH_s, pastH_d, pastBits, pastDemonBits, pastSubjectHits, pastDemonHits, pastDemonTrials]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Effect 3: Per-session QA stats write (fires when sessionAnalysis is ready) ─
  // prescreen_rank / prescreen_eligible are NOT written here — they require cumulative
  // data (5+ sessions) and are written by Effect 2.
  useEffect(() => {
    if (!sessionAnalysis || !runRef) return;
    const {
      rank: rawRank,
      wouldBeRank: rawWouldBeRank,
      ksGate,
      collapseGate,
      pcsWarning,
      intensityTier,
      artifactWarning,
    } = evaluatePrescreen(sessionAnalysis, C);
    const sessionKind = isAutoMode ? 'baseline' : isAIMode ? 'ai' : 'human';
    const pcs = sessionAnalysis.pcs;
    setDoc(
      runRef,
      {
        session_rank: `${rawRank}-${sessionKind}`,
        session_would_be_rank: rawWouldBeRank !== rawRank ? `${rawWouldBeRank}-${sessionKind}` : null,
        session_ks_p: sessionAnalysis.ks.originalP,
        session_ks_gate: ksGate,
        session_collapse_p: sessionAnalysis.shuffleSubject.collapseP,
        session_ddrop: sessionAnalysis.shuffleSubject.dDrop,
        session_collapse_gate: collapseGate,
        session_intensity_tier: intensityTier ?? 'none',
        session_pcs_warning: pcsWarning,
        session_pcs_nullz: pcs.nullZ,
        session_pcs_ghostz: pcs.ghostZ,
        session_pcs_sdratio: pcs.sdRatio,
        session_pcs_crosscorr: pcs.crossCorr,
        session_artifact_warning: artifactWarning,
        session_demon_collapse_p: sessionAnalysis.shuffleDemon?.collapseP ?? null,
        session_demon_ddrop: sessionAnalysis.shuffleDemon?.dDrop ?? null,
        session_artifact_delta_dgap: sessionAnalysis.artifactContrast?.deltaDGap ?? null,
      },
      { merge: true },
    ).catch(console.error);
  }, [sessionAnalysis, runRef]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived: decision and inviteStatus ────────────────────────────────────────
  const isCumulativeReady = cumulativeAnalysis != null;

  // Score anomaly: cumulative binomial Z for raw subject hit rate (cumulative only)
  let scoreAnomalyFlag = false;
  if (isCumulativeReady) {
    const cumHits   = pastSubjectHits + totals.k;
    const cumTrials = pastDemonTrials + totals.n;
    if (cumTrials > 0) {
      const z = (cumHits - cumTrials * 0.5) / (0.5 * Math.sqrt(cumTrials));
      scoreAnomalyFlag = Math.abs(z) >= 2;
    }
  }

  // Use cumulative analysis when available, session analysis otherwise.
  // NOTE: eligible and showInvite are always false before isCumulativeReady —
  // this preserves the 5-session gate for confetti and the invite form.
  const activeAnalysis = cumulativeAnalysis ?? sessionAnalysis;
  let decision = {
    scope: null, rank: null, eligible: false,
    ksGate: false, collapseGate: false,
    intensityTier: null, pcsWarning: false, pcsFlags: {}, scoreAnomalyFlag: false,
  };
  if (activeAnalysis) {
    const scope = cumulativeAnalysis ? 'cumulative' : 'session';
    const ev = evaluatePrescreen(activeAnalysis, C);
    let finalRank = ev.rank;
    if (isCumulativeReady && finalRank === 'none' && scoreAnomalyFlag) {
      finalRank = 'score_anomaly';
    }
    // eligible is only meaningful once we have cumulative confirmation
    decision = { scope, ...ev, rank: finalRank, scoreAnomalyFlag, eligible: isCumulativeReady ? ev.eligible : false };
  }

  // inviteStatus: summary screen uses this to show invite form
  const { rank, eligible } = decision;
  // Both showInvite and category require cumulative data — session-only rank never triggers invite.
  // Suppress if participant has already submitted their email (stored on profile).
  const alreadySignedUp = !!participantProfile?.email;
  const showInvite = !alreadySignedUp && isCumulativeReady &&
    (eligible || rank === 'candidate' || rank === 'score_anomaly');
  const category = eligible ? 'eligible'
    : rank === 'candidate'     ? 'candidate_review'
    : rank === 'score_anomaly' ? 'score_anomaly'
    : 'none';
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
