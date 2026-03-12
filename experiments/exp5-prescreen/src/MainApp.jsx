// src/MainApp.jsx
import './App.css';
import React, {
  useEffect,
  useRef,
  useState,
} from 'react';
import { pkConfig as C } from './config.js';
import { db } from './firebase.js';
import {
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { preQuestions, postQuestions } from './questions.js';
import { QuestionsForm } from './Forms.jsx';
import { HurstDeltaGauge } from './Scoring.jsx';
import confetti from 'canvas-confetti';
import ConsentGate from './ui/ConsentGate.jsx';
import { usePhaseRouter } from './hooks/usePhaseRouter.js';
import { useParticipantProfile } from './hooks/useParticipantProfile.js';
import { usePrescreenAnalysis } from './hooks/usePrescreenAnalysis.js';
import { useSessionPersistence } from './hooks/useSessionPersistence.js';
import { useTrialRunner } from './hooks/useTrialRunner.js';

// ── Monitoring helpers ────────────────────────────────────────────────────────

// Runtime configuration validation
function validateConfig() {
  const errors = [];

  if (!C.VISUAL_HZ || C.VISUAL_HZ <= 0)
    errors.push('VISUAL_HZ must be positive');
  if (!C.BLOCKS_TOTAL || C.BLOCKS_TOTAL <= 0)
    errors.push('BLOCKS_TOTAL must be positive');
  if (!C.TRIALS_PER_BLOCK || C.TRIALS_PER_BLOCK <= 0)
    errors.push('TRIALS_PER_BLOCK must be positive');
  if (!C.BITS_PER_BLOCK || C.BITS_PER_BLOCK <= 0)
    errors.push('BITS_PER_BLOCK must be positive');
  // Cross-validation: Ensure config values are consistent
  if (C.BITS_PER_BLOCK !== 1 + 2 * C.TRIALS_PER_BLOCK) {
    errors.push(
      `BITS_PER_BLOCK must equal 1 + 2*TRIALS_PER_BLOCK (expected ${1 + 2 * C.TRIALS_PER_BLOCK}, got ${C.BITS_PER_BLOCK})`,
    );
  }

  if (errors.length > 0) {
    throw new Error(
      `Configuration validation failed: ${errors.join(', ')}`,
    );
  }
}

// Validate configuration on load
validateConfig();

// ===== main =====
export default function MainApp() {
  // Auto-mode for baseline data collection (activated via URL hash #auto)
  const isAutoMode = window.location.hash.includes('auto');
  // AI-mode for AI agent sessions (activated via URL hash #ai)
  const isAIMode = window.location.hash.includes('ai');
  // Preview mode: jump straight to the invite/summary screen for UI review (activated via URL hash #preview)
  const isPreviewMode = window.location.hash.includes('preview');
  const [autoSessionCount, setAutoSessionCount] = useState(0);
  const [autoSessionTarget, setAutoSessionTarget] = useState(
    isAIMode ? C.AI_MODE_SESSIONS : C.AUTO_MODE_SESSIONS,
  );

  // ---- participant profile, sign-in, session history
  const {
    loading: profileLoading,
    uid,
    setPreDone,
    participantHash,
    participantProfile,
    emailPlaintext,
    sessionCount, setSessionCount,
    usableSessionCount,
    pastH_s, pastH_d, pastBits, pastDemonBits,
    pastDemonHits, pastDemonTrials,
    requireUid,
    loadParticipant,
    loadAutoParticipant,
    setCumulativeHistory,
  } = useParticipantProfile({ db, C });

  // ---- target assignment
  const [target, setTarget] = useState(null);
  const targetAssignedRef = useRef(false);
  const targetRef = useRef(target); // Keep ref in sync for audit phase to avoid dependency issues

  useEffect(() => {
    if (targetAssignedRef.current) {
      return;
    }
    if (!target) {
      targetAssignedRef.current = true; // Set flag immediately to prevent second execution

      const randomByte = crypto.getRandomValues(new Uint8Array(1))[0];
      const randomBit = randomByte & 1;
      const t = randomBit ? 'BLUE' : 'ORANGE';
      setTarget(t);
    }
  }, [target]);

  // Keep targetRef in sync with target state
  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  // Preview mode: jump to summary screen as soon as app is ready
  useEffect(() => {
    if (!isPreviewMode || profileLoading || !target) return;
    goToSummary();
  }, [isPreviewMode, profileLoading, target]); // eslint-disable-line react-hooks/exhaustive-deps

  // Trials per block (from config)
  const trialsPerBlock = C.TRIALS_PER_BLOCK;

  // Load participant history for auto/AI modes once uid is available.
  // Uses uid as participantHash so each fresh incognito/Puppeteer batch is isolated.
  const autoParticipantLoadedRef = useRef(false);
  useEffect(() => {
    if (!isAutoMode && !isAIMode) return;
    if (profileLoading || !uid) return;
    if (autoParticipantLoadedRef.current) return;
    autoParticipantLoadedRef.current = true;
    loadAutoParticipant();
  }, [isAutoMode, isAIMode, profileLoading, uid, loadAutoParticipant]); // eslint-disable-line react-hooks/exhaustive-deps

  // savedCumulativeRef owned by usePrescreenAnalysis (accessed via resetAnalysis())
  const fetchTriggeredAtRef = useRef(null); // Capture when fetching was triggered (button press or auto-timer)
  const qrngProviderRef = useRef(null); // Track QRNG provider across blocks ('mixed' if it changes)
  const qrngProviderSeqRef = useRef([]); // Per-block provider labels, for RLE encoding at session end
  const allRawBitsRef = useRef([]); // Full 301-bit calls per block (assignment + both halves)

  // ---- phase & per-minute state
  const {
    phase,
    goToPreQ, goToOnboarding,
    goToTargetAnnounce, goToFetching, goToScore,
    goToRest, goToAudit, goToNext, goToPreparingNext,
    goToResults, goToSummary, goToDone,
    goToAutoComplete, goToAIComplete, goToMaxSessions,
  } = usePhaseRouter();
  const [blockIdx, setblockIdx] = useState(-1);
  const [isRunning, setIsRunning] = useState(false);
  const [lastBlock, setLastBlock] = useState(null);
  const [totals, setTotals] = useState({ k: 0, n: 0 });
  const [totalGhostHits, setTotalGhostHits] = useState(0);

  // Hurst delta tracking across blocks
  const [deltaHurstHistory, setDeltaHurstHistory] = useState([]);
  const [hurstSubjectHistory, setHurstSubjectHistory] = useState([]);
  const [hurstDemonHistory, setHurstDemonHistory] = useState([]);
  const [subjectBitsHistory, setSubjectBitsHistory] = useState([]);
  const [demonBitsHistory, setDemonBitsHistory] = useState([]);

  // ---- session persistence: runRef creation + aggregate writes
  const {
    runRef,
    setRunRef,
    ensureRunDoc,
    lastPersistedBlockRef,
    saveSessionAggregates,
  } = useSessionPersistence({
    db, C,
    target, uid, requireUid,
    participantHash, isAutoMode, isAIMode,
    totals, totalGhostHits,
    deltaHurstHistory, hurstSubjectHistory, hurstDemonHistory,
    allRawBitsRef, qrngProviderRef, qrngProviderSeqRef,
  });

  // ---- prescreen analysis (session + cumulative) + rank writes
  const {
    sessionAnalysis,
    cumulativeAnalysis,
    isCumulativeReady,
    decision,
    inviteStatus,
    resetAnalysis,
  } = usePrescreenAnalysis({
    db, C,
    phase, sessionCount, usableSessionCount, isAutoMode, isAIMode,
    hurstSubjectHistory, hurstDemonHistory, subjectBitsHistory, demonBitsHistory,
    totalGhostHits, totals,
    pastH_s, pastH_d, pastBits, pastDemonBits, pastDemonHits, pastDemonTrials,
    runRef, allRawBitsRef,
    participantHash, participantProfile, emailPlaintext,
    onHistoryUpdated: setCumulativeHistory,
  });

  // ---- trial runner: refs, processTrials (internal), persistMinute (internal),
  //      endMinute, fetching effect, audit effect, block-persistence effect
  const { refs: trialRunnerRefs } = useTrialRunner({
    C,
    phase, target, setTarget,
    isAutoMode, isAIMode,
    goToScore, goToRest, goToResults,
    runRef,
    blockIdx, setblockIdx,
    setIsRunning, setLastBlock,
    setTotals, setTotalGhostHits,
    setDeltaHurstHistory, setHurstSubjectHistory,
    setHurstDemonHistory, setSubjectBitsHistory, setDemonBitsHistory,
    saveSessionAggregates, lastPersistedBlockRef,
    fetchTriggeredAtRef, allRawBitsRef, qrngProviderRef, qrngProviderSeqRef,
  });

  const [inviteForm, setInviteForm] = useState({
    firstName: '',
    lastName: '',
    location: '',
    age: '',
    email: '',
  });
  const [inviteSubmitted, setInviteSubmitted] = useState(false);
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteError, setInviteError] = useState(null);

  // Auto-mode and AI-mode: Skip consent/questions, auto-restart, and auto-continue rest screens
  useEffect(() => {
    if (!isAutoMode && !isAIMode) return;

    // Auto-mode: skip all screens
    // AI-mode: skip consent/pre_questions/info, but SHOW prime (research background)
    if (
      phase === 'consent' ||
      phase === 'pre_questions' ||
      phase === 'info' ||
      phase === 'prime' ||
      phase === 'preQ'
    ) {
      goToOnboarding();
    } else if (phase === 'score' && isAutoMode) {
      // Auto-continue score screens in auto-mode
      const timer = setTimeout(() => {
        // Check if session is complete (all 40 blocks done)
        if (blockIdx >= C.BLOCKS_TOTAL) {
          goToResults();
        } else {
          // Check if audit is needed based on the just-completed block (not the incremented blockIdx)
          const completedBlockIdx = trialRunnerRefs.blockIdxToPersistRef.current;
          const needsAudit =
            completedBlockIdx >= 0 &&
            (completedBlockIdx + 1) % C.AUDIT_EVERY_N_BLOCKS === 0 &&
            blockIdx < C.BLOCKS_TOTAL;
          needsAudit ? goToAudit() : goToTargetAnnounce();
        }
      }, C.AUTO_MODE_REST_MS);
      return () => clearTimeout(timer);
    } else if (
      (phase === 'rest' || phase === 'target_announce') &&
      isAutoMode
    ) {
      // Auto-continue rest/target_announce screens in auto-mode
      const timer = setTimeout(() => {
        fetchTriggeredAtRef.current = new Date().toISOString();
        goToFetching(); // Go to fetching phase instead of old startNextMinute
      }, C.AUTO_MODE_REST_MS);
      return () => clearTimeout(timer);
    } else if (phase === 'audit' && isAutoMode) {
      // Auto-continue audit screens in auto-mode
      const timer = setTimeout(() => {
        goToTargetAnnounce();
      }, C.AUTO_MODE_REST_MS);
      return () => clearTimeout(timer);
    } else if (phase === 'results') {
      // Fire-and-forget — transition immediately like exp4; writes complete in background
      if (runRef) {
        const isFullSession =
          allRawBitsRef.current.length === C.BLOCKS_TOTAL;
        saveSessionAggregates().catch(err =>
          console.error('saveSessionAggregates failed (background):', err),
        );
        if (isFullSession) {
          setDoc(runRef, { completed: true }, { merge: true }).catch(
            console.error,
          );
        }
      }
      goToNext();
    } else if ((phase === 'done' && isAutoMode) || phase === 'summary') {
      // Auto-mode: skip post-questionnaire; AI-mode: show questions for agent to fill
      goToNext();
    } else if (phase === 'next') {
      // Immediately transition to avoid re-triggering
      const newCount = autoSessionCount + 1;

      if (newCount < autoSessionTarget) {
        // Reset for next session
        setAutoSessionCount(newCount);
        goToPreparingNext();
      } else {
        setAutoSessionCount(newCount); // Update count before showing completion
        isAIMode ? goToAIComplete() : goToAutoComplete();
      }
    } else if (phase === 'preparing_next') {
      // Delayed reset to ensure clean state transition
      setTimeout(() => {
        // Reset state
        setRunRef(null);
        setblockIdx(-1);
        setTotals({ k: 0, n: 0 });
        setTotalGhostHits(0);
        setLastBlock(null);
        setIsRunning(false);
        setDeltaHurstHistory([]);
        setHurstSubjectHistory([]);
        setHurstDemonHistory([]);
        setSubjectBitsHistory([]);
        setDemonBitsHistory([]);
        resetAnalysis(); // clears sessionAnalysis, cumulativeAnalysis, savedCumulativeRef

        // Reset target flag so new target gets assigned
        targetAssignedRef.current = false;
        setTarget(null);

        // Reset per-session refs
        qrngProviderRef.current = null;
        qrngProviderSeqRef.current = [];
        allRawBitsRef.current = [];
        lastPersistedBlockRef.current = -1;
        trialRunnerRefs.blockIdxToPersistRef.current = -1;

        goToOnboarding();
      }, 100);
    }
    // Note: blockIdxToPersistRef is a ref, not state, so it doesn't need to be in the dep array
    // All goTo* functions, resetAnalysis, setRunRef, lastPersistedBlockRef are stable
  }, [isAutoMode, isAIMode, phase, blockIdx, autoSessionCount, autoSessionTarget, runRef, saveSessionAggregates]); // eslint-disable-line react-hooks/exhaustive-deps

  // Note: processTrials, persistMinute, endMinute, fetching effect, audit effect,
  // and block-persistence effect are owned by useTrialRunner above.

  // Pre-fill invite form email from consent when entering summary
  useEffect(() => {
    if (phase !== 'summary') return;
    if (!emailPlaintext) return;
    setInviteForm((f) =>
      f.email ? f : { ...f, email: emailPlaintext },
    );
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fire confetti on summary screen when subject is invite-eligible (gold or silver)
  useEffect(() => {
    if (phase !== 'summary') return;
    if (!decision.eligible) return;
    // Gold confetti burst
    confetti({
      particleCount: 120,
      spread: 80,
      colors: ['#f59e0b', '#fcd34d', '#fbbf24', '#d97706', '#fff'],
      origin: { y: 0.5 },
    });
    setTimeout(
      () =>
        confetti({
          particleCount: 60,
          spread: 55,
          angle: 60,
          colors: ['#f59e0b', '#fcd34d', '#fff'],
          origin: { x: 0, y: 0.6 },
        }),
      300,
    );
    setTimeout(
      () =>
        confetti({
          particleCount: 60,
          spread: 55,
          angle: 120,
          colors: ['#f59e0b', '#fcd34d', '#fff'],
          origin: { x: 1, y: 0.6 },
        }),
      300,
    );
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Note: Exit functionality removed - sessions complete automatically or handle early exits in useEffect

  // Ensure document is created early in onboarding phase.
  // Wait for uid — calling ensureRunDoc with uid=null triggers requireUid() which races
  // with the sign-in effect in useParticipantProfile and creates a duplicate anonymous user.
  useEffect(() => {
    if (phase === 'onboarding' && !runRef && target && uid) {
      console.log('[ensureRunDoc] onboarding useEffect firing — calling ensureRunDoc');
      ensureRunDoc().catch(console.error);
    }
  }, [phase, runRef, target, uid, ensureRunDoc]);

  // Analysis effects moved to usePrescreenAnalysis hook

  // ===== flow gates =====
  if (profileLoading || !target) {
    return <div style={{ padding: 24 }}>Loading…</div>;
  }

  // In MainApp.jsx, replace the ConsentGate section with:

  // CONSENT - Skip for auto/AI modes
  if (phase === 'consent') {
    // Auto and AI modes skip consent and questions
    if (isAutoMode || isAIMode) {
      goToOnboarding();
      return null;
    }

    return (
      <div style={{ position: 'relative' }}>
        <ConsentGate
          title="Pre-Screening: Potential Participant Qualification"
          showBlindingNote={false}
          studyDescription={`You are participating in a pre-screening session to determine eligibility for a future research study (Experiment 5). This session identifies individuals who show high resonance with quantum random systems. You will complete ${C.BLOCKS_TOTAL} blocks each ~2 seconds long and brief questionnaires (approximately 5 minutes total).`}
          bullets={[
            'You will receive a target color assignment (blue or orange)',
            'Your task is to get your target color above 50%. Concentrate your attention on your target color right before and during the moment quantum data is fetched from a quantum random number generator.',
            'When focused and ready, press "I\'m Ready" and keep focusing as your color pulses. This triggers the quantum random number generator and the sigantures in the QRNG during your focused intention is what we\'re testing.',
            'We collect data on quantum random sequences, your performance metrics, timing patterns, and your questionnaire responses.',
            'Participation is completely voluntary; you may exit at any time.',
            'If you provide your email, we store it to link your sessions across devices and to contact you if you are selected for the next phase of research. Your email will not be shared with third parties or used for any other purpose.',
            'To request deletion of your data, email h@whatthequark.com with the subject line "Data Deletion Request". Include the email address you used when participating and we will remove your records.',
            'Data will be retained indefinitely to enable scientific replication and analysis, unless a deletion request is received.',
            'Hosting providers may log IP addresses for security purposes; these logs are not linked to your study data.',
          ]}
          onAgree={async ({ email } = {}) => {
            // Reset analysis state so it's recomputed fresh for this session
            resetAnalysis();
            const { skipPreQ, usableCount } = await loadParticipant(email);
            if (usableCount >= C.MAX_SESSIONS_FOR_ANALYSIS) {
              goToMaxSessions();
              return;
            }
            skipPreQ ? goToOnboarding() : goToPreQ();
          }}
        />
      </div>
    );
  }

  // MAX SESSIONS REACHED
  if (phase === 'max_sessions') {
    return (
      <div className="App" style={{ textAlign: 'left', padding: 24 }}>
        <h1 style={{ marginTop: 0 }}>Thank You for Participating</h1>
        <p>
          You have completed the maximum number of pre-screening sessions for this study.
          Your contributions are appreciated and have been recorded.
        </p>
        <p>
          Please contact the study administrator if you have questions or would like to
          continue participating in future phases of the research.
        </p>
        <p>
          <a href="mailto:h@whatthequark.com">h@whatthequark.com</a>
        </p>
      </div>
    );
  }

  // PRE QUESTIONS - Skip for auto/AI modes
  if (phase === 'preQ') {
    // Auto and AI modes skip questions
    if (isAutoMode || isAIMode) {
      goToOnboarding();
      return null;
    }

    return (
      <div style={{ position: 'relative' }}>
        <QuestionsForm
          title="Before you begin"
          questions={preQuestions}
          requiredAll
          onSubmit={async (answers, { valid }) => {
            if (!valid) return;
            goToOnboarding();
            try {
              const uidNow = await requireUid();
              // Save to participants collection like exp1
              const ref = doc(db, 'participants', uidNow);
              const snap = await getDoc(ref);
              const demographics = { ...answers };

              if (snap.exists()) {
                await updateDoc(ref, {
                  demographics,
                  demographics_version: 'v1',
                  updated_at: serverTimestamp(),
                });
              } else {
                await setDoc(ref, {
                  demographics,
                  demographics_version: 'v1',
                  created_at: serverTimestamp(),
                  updated_at: serverTimestamp(),
                  profile_version: 1,
                });
              }

              if (typeof localStorage !== 'undefined') {
                localStorage.setItem(
                  `pre_done:${C.EXPERIMENT_ID}:${uidNow}`,
                  '1',
                );
                localStorage.setItem(
                  `pre_done_global:${C.EXPERIMENT_ID}`,
                  '1',
                );
              }
              setPreDone(true);
            } catch (e) {
              console.warn(
                'Pre survey save error (non-blocking):',
                e,
              );
              console.warn('Debug info:', {
                uid: uid,
                runRefId: runRef?.id,
                profileLoading: profileLoading,
                errorCode: e?.code,
                errorMessage: e?.message,
              });
            }
          }}
        />
      </div>
    );
  }

  // INFO SCREEN (binaural beats information) - Skip for auto/AI modes

  // ONBOARDING
  if (phase === 'onboarding') {
    const canContinue = !!runRef; // Live mode - no tapes needed

    // Show auto-mode status if active
    if (isAutoMode) {
      // Auto-start when runRef is ready OR when target is assigned (for subsequent sessions).
      // uid guard prevents racing with useParticipantProfile's sign-in effect.
      if ((canContinue || target) && !isRunning && uid) {
        ensureRunDoc().then(() => {
          setblockIdx(0); // Initialize to 0 for first block
          goToRest();
        }); // Go to rest, then auto-mode will trigger fetching
      }

      const isComplete = autoSessionCount >= autoSessionTarget;

      return (
        <div style={{ padding: 24, maxWidth: 760 }}>
          <h1>🤖 Auto-Mode Baseline Collection</h1>

          {autoSessionCount === 0 && (
            <div
              style={{
                marginBottom: 20,
                padding: 20,
                background: '#f0f0f0',
                borderRadius: 8,
              }}
            >
              <label
                style={{
                  display: 'block',
                  marginBottom: 5,
                  fontWeight: 'bold',
                }}
              >
                Number of sessions to run:
              </label>
              <input
                type="number"
                value={autoSessionTarget}
                onChange={(e) =>
                  setAutoSessionTarget(
                    Math.max(1, parseInt(e.target.value) || 1),
                  )
                }
                min="1"
                max="1000"
                style={{
                  padding: '8px',
                  width: '100px',
                  marginRight: 10,
                }}
              />
              <span style={{ fontSize: 12, color: '#666' }}>
                (Each session = {C.BLOCKS_TOTAL} blocks)
              </span>
            </div>
          )}

          <p style={{ fontSize: 18, marginTop: 20 }}>
            Sessions:{' '}
            <strong>
              {autoSessionCount} / {autoSessionTarget}
            </strong>
          </p>

          {isComplete ? (
            <p
              style={{
                color: '#1a8f1a',
                fontWeight: 'bold',
                marginTop: 10,
              }}
            >
              ✅ All sessions complete! Check QA dashboard.
            </p>
          ) : (
            <p style={{ color: '#666', marginTop: 10 }}>
              {canContinue ? 'Running...' : 'Starting...'}
            </p>
          )}
        </div>
      );
    }

    // AI mode — auto-initialize runRef to enable Continue button (but still require AI to click it)
    // Mirrors exp4's proven approach: render-body call is belt-and-suspenders alongside the useEffect.
    if (isAIMode && !canContinue && !isRunning && target && uid) {
      ensureRunDoc().catch(err =>
        console.error('❌ AI-MODE: Failed to initialize runRef:', err),
      );
    }

    // Expose canContinue for AI agent polling (avoids waitForFunction DOM starvation)
    if (isAIMode && typeof window !== 'undefined') {
      window.expState = {
        phase: 'onboarding',
        canContinue,
        target,
        blockIdx: 0,
        totalBlocks: C.BLOCKS_TOTAL,
      };
    }

    return (
      <div
        style={{ padding: 24, maxWidth: 760, position: 'relative' }}
      >
        <h1>
          {isAIMode
            ? '🤖 AI Agent Mode'
            : 'Assessing Randomness Suppression During Conscious Intention Tasks — Pilot Study'}
        </h1>

        <div style={{ marginBottom: 30, marginTop: 30 }}>
          <h3 style={{ color: '#2c3e50', marginBottom: 15 }}>
            What to Expect:
          </h3>
          <ul style={{ fontSize: 16, lineHeight: 1.8 }}>
            <li>
              You'll complete {C.BLOCKS_TOTAL} short blocks with
              breaks between each. <b>Before </b>each block begins,
              take a moment to settle and direct your attention toward
              your chosen target color. This focus should begin just
              before you start the block and continue through the
              fetch period.
            </li>
            <li>
              <strong>Critical moment:</strong> Immediately before and
              as you click <em>"I'm Ready"</em>, the system will
              retrieve quantum random data while your target color
              pulses on the screen.{' '}
              <strong>
                This is the period to sustain clear, steady focus on
                your target color. Focus your intention before and
                during your click of the I'm Ready button.
              </strong>
            </li>

            <li>
              You will see your target color flashing during the
              fetch. After the quantum data is retrieved, results
              appear instantly. The goal is to score over 50% as often
              as possible.
            </li>
            <li>
              During breaks take a moment to breathe and clear your
              mind.
            </li>
          </ul>
        </div>

        {/* Continue button */}
        <div style={{ textAlign: 'center', marginTop: 40 }}>
          <button
            onClick={() => {
              if (canContinue && !isRunning) {
                ensureRunDoc()
                  .then(() => {
                    setblockIdx(0);
                    goToRest();
                  })
                  .catch((err) => {
                    console.error('❌ ensureRunDoc failed:', err);
                  });
              }
            }}
            disabled={!canContinue}
            style={{
              padding: '20px 60px',
              fontSize: 20,
              fontWeight: 'bold',
              background: canContinue ? '#10b981' : '#ccc',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: canContinue ? 'pointer' : 'not-allowed',
              boxShadow: canContinue
                ? '0 4px 6px rgba(0,0,0,0.1)'
                : 'none',
            }}
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  // SCORE - Show last block results
  if (phase === 'score') {
    const pctLast =
      lastBlock && lastBlock.n
        ? Math.round((100 * lastBlock.k) / lastBlock.n)
        : 0;
    // Use the just-completed block index (the one that was saved, not the incremented one)
    const completedBlockIdx = trialRunnerRefs.blockIdxToPersistRef.current;
    const completedBlockNum = completedBlockIdx + 1; // Human-readable (1-30)
    // Show audit after blocks 5, 10, 15, 20, 25 (when completed block is 4, 9, 14, 19, 24 in 0-indexed)
    const needsAudit =
      completedBlockIdx >= 0 &&
      (completedBlockIdx + 1) % C.AUDIT_EVERY_N_BLOCKS === 0 &&
      blockIdx < C.BLOCKS_TOTAL;
    const isSessionComplete = blockIdx >= C.BLOCKS_TOTAL;

    // Expose state for AI agent to read
    if (isAIMode && typeof window !== 'undefined') {
      window.expState = {
        phase: 'score',
        blockIdx: completedBlockNum, // Use human-readable block number (1-30) for consistency with other phases
        completedBlock: completedBlockNum,
        totalBlocks: C.BLOCKS_TOTAL,
        score: pctLast,
        hits: lastBlock?.k || 0,
        trials: lastBlock?.n || 0,
        isSessionComplete,
        needsAudit,
      };
    }

    const sessionPct =
      totals.n > 0
        ? ((100 * totals.k) / totals.n).toFixed(1)
        : '50.0';
    const blockColor =
      pctLast > 50 ? '#15803d' : pctLast < 50 ? '#b45309' : '#6b7280';
    const blockBg =
      pctLast > 50 ? '#dcfce7' : pctLast < 50 ? '#fff7ed' : '#f3f4f6';
    const blockBorder =
      pctLast > 50 ? '#86efac' : pctLast < 50 ? '#fed7aa' : '#e5e7eb';

    return (
      <div
        style={{
          padding: 24,
          textAlign: 'center',
          maxWidth: 600,
          margin: '0 auto',
        }}
      >
        <h2 style={{ marginBottom: sessionCount > 0 ? 4 : 20 }}>
          Block {completedBlockNum} of {C.BLOCKS_TOTAL}
        </h2>
        {sessionCount > 0 && (
          <div
            style={{
              fontSize: 11,
              color: '#9ca3af',
              marginBottom: 14,
            }}
          >
            Session {sessionCount + 1}
          </div>
        )}

        {/* Hero: block hit score */}
        <div
          style={{
            padding: '40px 32px',
            borderRadius: 16,
            background: blockBg,
            border: `2px solid ${blockBorder}`,
            marginBottom: 12,
            minHeight: 240,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              fontSize: 12,
              color: '#6b7280',
              letterSpacing: '0.06em',
              marginBottom: 4,
            }}
          >
            THIS BLOCK
          </div>
          <div
            style={{
              fontSize: 72,
              fontWeight: 900,
              color: blockColor,
              lineHeight: 1,
              marginBottom: 4,
            }}
          >
            {pctLast}%
          </div>
          <div style={{ fontSize: 13, color: '#6b7280' }}>
            {lastBlock?.k ?? 0} hits · target &gt; 50%
          </div>
        </div>

        {/* Session running total */}
        <div
          style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}
        >
          Session average:{' '}
          <strong
            style={{
              color:
                parseFloat(sessionPct) > 50 ? '#15803d' : '#6b7280',
            }}
          >
            {sessionPct}%
          </strong>
          <span style={{ marginLeft: 8 }}>
            ({totals.k} / {totals.n})
          </span>
        </div>

        <button
          onClick={() => {
            if (blockIdx >= C.BLOCKS_TOTAL) {
              goToResults();
            } else if (needsAudit) {
              goToAudit();
            } else {
              goToTargetAnnounce();
            }
          }}
          style={{
            marginTop: 28,
            padding: '16px 32px',
            fontSize: 18,
            fontWeight: 600,
            background: '#10b981',
            color: 'white',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
          }}
        >
          Continue
        </button>
      </div>
    );
  }

  // TARGET_ANNOUNCE / REST - Large target display with "I'm Ready" button
  if (phase === 'target_announce' || phase === 'rest') {
    const targetColor = target === 'BLUE' ? '#1e40af' : '#ea580c';
    const targetEmoji = target === 'BLUE' ? '🟦' : '🟠';
    const isFirstBlock = blockIdx === 0;

    // Expose state for AI agent to read
    if (isAIMode && typeof window !== 'undefined') {
      window.expState = {
        target,
        score: 0,
        hits: 0,
        trials: 0,
        totalTrials: trialsPerBlock,
        blockIdx: blockIdx,
        totalBlocks: C.BLOCKS_TOTAL,
      };
    }

    return (
      <div
        style={{
          padding: 24,
          textAlign: 'center',
          maxWidth: 600,
          margin: '0 auto',
        }}
      >
        {/* Target display — same size as score box */}
        <div
          style={{
            padding: '40px 32px',
            background: '#f9f9f9',
            borderRadius: 16,
            border: `2px solid ${targetColor}`,
            marginBottom: 12,
            minHeight: 240,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <p
            style={{
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: '0.06em',
              marginBottom: 8,
              color: '#6b7280',
            }}
          >
            YOUR TARGET
          </p>
          <div
            style={{ fontSize: 80, marginBottom: 8, lineHeight: 1 }}
          >
            {targetEmoji}
          </div>
          <div
            style={{
              fontSize: 44,
              fontWeight: 'bold',
              color: targetColor,
            }}
          >
            {target}
          </div>
        </div>

        {/* Ready prompt */}
        <div
          style={{
            padding: 24,
            background: '#f0f7ff',
            borderRadius: 12,
            border: '2px solid #3b82f6',
            marginBottom: 20,
          }}
        >
          <p
            style={{
              fontSize: 18,
              marginBottom: 16,
              fontWeight: 500,
            }}
          >
            {isFirstBlock
              ? 'Ready to begin?'
              : 'Ready for the next block?'}
          </p>
          <p style={{ fontSize: 16, marginBottom: 8, color: '#555' }}>
            We're about to fetch quantum data from the QRNG.
          </p>
          <p style={{ fontSize: 16, marginBottom: 0, color: '#555' }}>
            <strong>
              Bring your attention to your target color just before
              clicking the button, and sustain that steady focus while
              the screen flashes.
            </strong>
          </p>
        </div>

        <button
          onClick={() => {
            fetchTriggeredAtRef.current = new Date().toISOString();
            goToFetching();
          }}
          style={{
            marginTop: 28,
            padding: '16px 32px',
            fontSize: 18,
            fontWeight: 600,
            background: '#10b981',
            color: 'white',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
            transition: 'transform 0.1s',
          }}
          onMouseDown={(e) =>
            (e.currentTarget.style.transform = 'scale(0.95)')
          }
          onMouseUp={(e) =>
            (e.currentTarget.style.transform = 'scale(1)')
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.transform = 'scale(1)')
          }
        >
          I'm Ready
        </button>

        <div style={{ fontSize: 14, opacity: 0.75, marginTop: 16 }}>
          Block {blockIdx + 1} of {C.BLOCKS_TOTAL}
          {sessionCount > 0 && (
            <span
              style={{
                marginLeft: 10,
                fontSize: 11,
                color: '#9ca3af',
              }}
            >
              · Session {sessionCount + 1}
            </span>
          )}
        </div>
      </div>
    );
  }

  // AUDIT - Rest & recovery screen with audit fetch in background
  if (phase === 'audit') {
    // Use the just-completed block for display
    const completedBlockIdx = trialRunnerRefs.blockIdxToPersistRef.current;
    const completedBlockNum = completedBlockIdx + 1;

    return (
      <div
        style={{
          padding: 24,
          textAlign: 'center',
          maxWidth: 600,
          margin: '0 auto',
        }}
      >
        <h2 style={{ marginBottom: 32 }}>
          Block {completedBlockNum} Complete
        </h2>

        {/* Audit rest prompt */}
        <div
          style={{
            marginTop: 32,
            padding: 32,
            background: '#f0fdf4',
            borderRadius: 12,
            border: '2px solid #10b981',
          }}
        >
          <h3 style={{ color: '#059669', marginBottom: 16 }}>
            Rest & Recovery
          </h3>
          <p
            style={{
              fontSize: 18,
              lineHeight: 1.6,
              marginBottom: 16,
            }}
          >
            Take a moment to breathe and relax...
          </p>
          <p style={{ fontSize: 14, color: '#6b7280' }}>
            Clear your mind. Let go of any focus or intention.
          </p>
        </div>

        {/* Continue button */}
        <button
          onClick={() => goToTargetAnnounce()}
          style={{
            marginTop: 32,
            padding: '16px 32px',
            fontSize: 18,
            fontWeight: 600,
            background: '#10b981',
            color: 'white',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
          }}
          onMouseDown={(e) =>
            (e.currentTarget.style.transform = 'scale(0.95)')
          }
          onMouseUp={(e) =>
            (e.currentTarget.style.transform = 'scale(1)')
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.transform = 'scale(1)')
          }
        >
          Continue
        </button>

        <p style={{ marginTop: 16, fontSize: 14, color: '#6b7280' }}>
          Block {completedBlockNum} of {C.BLOCKS_TOTAL}
          {sessionCount > 0 && (
            <span style={{ marginLeft: 10 }}>
              · Session {sessionCount + 1}
            </span>
          )}
        </p>
      </div>
    );
  }

  // FETCHING - Full-screen target color with 5Hz pulse + white spinner
  if (phase === 'fetching') {
    const targetColor = target === 'BLUE' ? '#1e40af' : '#ea580c';
    const pulseKeyframes = `
      @keyframes breathe {
        0%, 100% { opacity: 0.8; }
        50% { opacity: 1; }
      }
    `;

    return (
      <>
        <style>{pulseKeyframes}</style>
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: targetColor,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            animation: 'breathe 200ms ease-in-out infinite', // 5 Hz = 200ms cycle
          }}
        >
          {/* White spinner */}
          <div
            style={{
              width: 80,
              height: 80,
              border: '8px solid rgba(255, 255, 255, 0.3)',
              borderTop: '8px solid white',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              marginBottom: 24,
            }}
          />

          <style>{`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>

          <p
            style={{
              color: 'white',
              fontSize: 24,
              fontWeight: 500,
              textAlign: 'center',
            }}
          >
            Fetching quantum data...
          </p>
        </div>
      </>
    );
  }

  // RUNNING phase removed - trials process instantly now

  // POST QUESTIONS (shown after results screen — scoring already saved)
  if (phase === 'done') {
    // Auto-mode skips post-questionnaire (handled by useEffect); AI-mode renders it for the agent
    if (isAutoMode) {
      return null;
    }

    // Expose phase for AI agent polling
    if (isAIMode && typeof window !== 'undefined') {
      window.expState = { phase: 'done' };
    }

    return (
      <div style={{ position: 'relative' }}>
        <QuestionsForm
          title="Quick wrap-up"
          questions={postQuestions}
          onSubmit={async (answers, { valid }) => {
            if (!valid) return;
            try {
              if (runRef) {
                await saveSessionAggregates();
                await setDoc(
                  runRef,
                  { post_survey: answers, completed: true },
                  { merge: true },
                );
              }

              // No email — use UID-based counter in participants/{uid} (same-device only)
              if (!participantHash) {
                const newCount = sessionCount + 1;
                if (uid) {
                  try {
                    await setDoc(
                      doc(db, 'participants', uid),
                      { exp5_prescreen_sessions: newCount },
                      { merge: true },
                    );
                  } catch (e) {
                    console.error(
                      'UID count update failed (non-blocking):',
                      e,
                    );
                  }
                }
                setSessionCount(newCount);
                goToSummary();
                return;
              }

              // Cumulative data already saved in results phase — just update session count and proceed
              setSessionCount(sessionCount + 1);
              goToSummary();
            } catch (e) {
              console.warn('Post survey save error:', e);
              goToSummary();
            }
          }}
        />
      </div>
    );
  }

  // RESULTS
  if (phase === 'results') {
    // If session exited early (not all blocks completed), skip to summary
    const sessionCompleted = blockIdx >= C.BLOCKS_TOTAL;
    if (!sessionCompleted) {
      goToSummary();
      return null;
    }

    const nBlocks = deltaHurstHistory.length;
    const hitRate =
      totals.n > 0
        ? ((100 * totals.k) / totals.n).toFixed(1)
        : '50.0';
    const hr = parseFloat(hitRate);
    const heroColor =
      hr > 50 ? '#15803d' : hr < 50 ? '#b45309' : '#6b7280';
    const heroBg =
      hr > 50 ? '#dcfce7' : hr < 50 ? '#fff7ed' : '#f3f4f6';
    const heroBorder =
      hr > 50 ? '#86efac' : hr < 50 ? '#fed7aa' : '#e5e7eb';

    // Sessions 1–4: simplified view — hit rate + "need more sessions" message.
    // isDecisionSession is true only when cumulative analysis has actually run
    // (5+ usable sessions). This is the definitive gate — no array-length arithmetic.
    if (!isCumulativeReady) {
      const remaining = Math.max(0, C.MIN_SESSIONS_FOR_DECISION - (usableSessionCount + 1));
      const earlyRank = sessionAnalysis
        ? decision.rank
        : null;
      return (
        <div
          className="App"
          style={{
            textAlign: 'center',
            maxWidth: 600,
            margin: '0 auto',
            padding: 24,
          }}
        >
          <h1>Session Average</h1>

          <div
            style={{
              padding: '28px 32px',
              borderRadius: 16,
              background: heroBg,
              border: `2px solid ${heroBorder}`,
              marginBottom: 20,
            }}
          >
            <div
              style={{
                fontSize: 13,
                color: '#6b7280',
                marginBottom: 4,
                letterSpacing: '0.05em',
              }}
            >
              TARGET: EXCEED 50%
            </div>
            <div
              style={{
                fontSize: 72,
                fontWeight: 900,
                color: heroColor,
                lineHeight: 1,
                marginBottom: 6,
              }}
            >
              {hitRate}%
            </div>
            <div style={{ fontSize: 14, color: '#6b7280' }}>
              {totals.k.toLocaleString()} hits out of{' '}
              {totals.n.toLocaleString()} trials · {nBlocks} blocks
            </div>
          </div>

          <div
            style={{
              padding: 20,
              background: '#f8fafc',
              borderRadius: 12,
              border: '1px solid #e2e8f0',
              marginBottom: 16,
              textAlign: 'left',
            }}
          >
            <p
              style={{
                fontSize: 15,
                color: '#374151',
                marginBottom: 10,
              }}
            >
              We need{' '}
              <strong>
                {remaining} more session{remaining !== 1 ? 's' : ''}
              </strong>{' '}
              to establish your cumulative result. Each session adds
              statistical power — results become much more reliable
              after {C.MIN_SESSIONS_FOR_DECISION} sessions.
            </p>
            <p
              style={{
                fontSize: 13,
                color: '#6b7280',
                marginBottom: 0,
              }}
            >
              💡 <strong>Note:</strong> No more than 3 sessions a day
              please as we have rate limits with our quantum random
              API.
            </p>
          </div>

          {(earlyRank === 'gold' || earlyRank === 'silver') && (
            <div
              style={{
                padding: 20,
                background: earlyRank === 'gold' ? '#fffbeb' : '#f0fdf4',
                borderRadius: 12,
                border: `2px solid ${earlyRank === 'gold' ? '#f59e0b' : '#34d399'}`,
                marginBottom: 16,
                textAlign: 'left',
              }}
            >
              <p
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: earlyRank === 'gold' ? '#92400e' : '#065f46',
                  marginBottom: 6,
                }}
              >
                {earlyRank === 'gold' ? '⚡ Strong early signal' : '✦ Interesting early signal'}
              </p>
              <p
                style={{
                  fontSize: 13,
                  color: earlyRank === 'gold' ? '#78350f' : '#064e3b',
                  marginBottom: 0,
                  lineHeight: 1.6,
                }}
              >
                {earlyRank === 'gold'
                  ? 'Your session produced a pattern well above what chance would predict — this is rare. We need more sessions to confirm it, but this is a very encouraging start.'
                  : 'Your session showed an interesting pattern worth following up on. More sessions will tell us whether it holds up.'}
              </p>
            </div>
          )}

          <div
            style={{
              padding: 16,
              background: '#eff6ff',
              borderRadius: 12,
              border: '1px solid #bfdbfe',
              marginBottom: 20,
              textAlign: 'left',
            }}
          >
            <p
              style={{
                fontSize: 13,
                color: '#1e40af',
                marginBottom: 0,
                lineHeight: 1.6,
              }}
            >
              <strong>A note on the score:</strong> The percentage is
              just a focusing target, not what we're measuring. We're
              looking at the underlying patterns in how the random
              numbers were generated during your session, which a
              simple hit rate doesn't reveal. A score below 50% is
              just as valuable to the research as one above it.
            </p>
          </div>

          <button
            className="primary-btn"
            onClick={() => goToDone()}
            style={{ marginTop: 8 }}
          >
            Continue
          </button>
        </div>
      );
    }

    // Session 5+: wait for cumulative analysis
    if (!isCumulativeReady) {
      return (
        <div style={{ padding: 24, textAlign: 'center' }}>
          Computing cumulative analysis…
        </div>
      );
    }

    const analysis = cumulativeAnalysis;
    const cumNBlocks = analysis.nBlocks; // total blocks across all sessions
    const finalDeltaH = analysis.deltaH.meanDeltaH;

    // ── Evaluation on cumulative data — from pre-computed decision ─────────────
    const { ksGate, collapseGate, eligible, rank: rawRank, intensityTier } = decision;
    const verified = rawRank === 'gold';
    const shuffleYes = collapseGate;

    // SE intensity label (from evaluatePrescreen — session-empirical SD(ΔH)/√n)
    const tierLabels = {
      1: 'Subtle',
      2: 'Solid Presence',
      3: 'Exceptional',
    };
    const tierLabel = intensityTier
      ? tierLabels[intensityTier]
      : null;

    // Modality (null-based SE for direction classification, cumulative SE)
    const SE = C.NULL_HURST_SD / Math.sqrt(cumNBlocks);
    const absDelta = Math.abs(finalDeltaH);
    const isDynamic = ksGate && absDelta < SE;
    let modality = null;
    if (isDynamic)
      modality = { label: 'Dynamic Harmonic', sub: 'Oscillation' };
    else if (finalDeltaH >= SE)
      modality = { label: 'Flow-Oriented', sub: 'Persistence' };
    else if (finalDeltaH <= -SE)
      modality = { label: 'Pulse-Oriented', sub: 'Anti-Persistence' };

    return (
      <div
        className="App"
        style={{
          textAlign: 'center',
          maxWidth: 600,
          margin: '0 auto',
          padding: 24,
        }}
      >
        <h1>Prescreening Results</h1>

        {/* ── Hero: Hit Score ─────────────────────────────────────────────── */}
        <div
          style={{
            padding: '28px 32px',
            borderRadius: 16,
            background: heroBg,
            border: `2px solid ${heroBorder}`,
            marginBottom: 20,
          }}
        >
          <div
            style={{
              fontSize: 13,
              color: '#6b7280',
              marginBottom: 4,
              letterSpacing: '0.05em',
            }}
          >
            TARGET: EXCEED 50%
          </div>
          <div
            style={{
              fontSize: 72,
              fontWeight: 900,
              color: heroColor,
              lineHeight: 1,
              marginBottom: 6,
            }}
          >
            {hitRate}%
          </div>
          <div style={{ fontSize: 14, color: '#6b7280' }}>
            {totals.k.toLocaleString()} hits out of{' '}
            {totals.n.toLocaleString()} trials · {nBlocks} blocks
          </div>
        </div>

        {/* ── Hurst Delta Gauge ───────────────────────────────────────────── */}
        <HurstDeltaGauge
          meanDeltaH={finalDeltaH}
          blockCount={cumNBlocks}
        />
        <div
          style={{
            fontSize: 11,
            color: '#9ca3af',
            textAlign: 'center',
            marginTop: 2,
            marginBottom: 8,
          }}
        >
          Cumulative trend across{' '}
          {Math.round(cumNBlocks / C.BLOCKS_TOTAL)} sessions (
          {cumNBlocks} blocks). Statistical confirmation below.
        </div>

        {/* ── Cumulative Analysis ──────────────────────────────────────────── */}
        {analysis &&
          (() => {
            let irVerdict, irColor, irBg, irDesc;
            if (eligible && verified) {
              irVerdict = 'Verified Temporal Influencer';
              irColor = '#15803d';
              irBg = '#dcfce7';
              irDesc =
                'Pattern detected and confirmed — the structure lived in the sequence order, not just the bit count.';
            } else if (eligible) {
              irVerdict = 'Candidate Signal Detected';
              irColor = '#1d4ed8';
              irBg = '#eff6ff';
              irDesc =
                'A signal was detected and showed meaningful collapse upon scrambling.';
            } else if (rawRank === 'candidate') {
              irVerdict = 'Possible Signal — Inconclusive';
              irColor = '#b45309';
              irBg = '#fff7ed';
              irDesc =
                'Your stream showed an unusual distribution but the collapse test was inconclusive.';
            } else {
              irVerdict = 'No Pattern Detected';
              irColor = '#6b7280';
              irBg = '#f9fafb';
              irDesc =
                'Your stream was consistent with normal random variation.';
            }

            return (
              <div
                style={{
                  textAlign: 'left',
                  marginTop: 20,
                  marginBottom: 16,
                  fontSize: 13,
                }}
              >
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 12,
                    letterSpacing: '0.08em',
                    color: '#9ca3af',
                    textAlign: 'center',
                    marginBottom: 12,
                  }}
                >
                  CUMULATIVE ANALYSIS · {Math.round(cumNBlocks / C.BLOCKS_TOTAL)} SESSIONS
                </div>

                {/* Verdict badge */}
                {(eligible || rawRank === 'candidate') && (
                  <div
                    style={{ marginBottom: 10, textAlign: 'center' }}
                  >
                    {modality && (
                      <span
                        style={{
                          fontSize: 14,
                          fontWeight: 700,
                          color: irColor,
                        }}
                      >
                        {modality.label}
                        <span
                          style={{ fontWeight: 400, marginLeft: 6 }}
                        >
                          ({modality.sub})
                        </span>
                      </span>
                    )}
                    {intensityTier && (
                      <span
                        style={{
                          marginLeft: 10,
                          padding: '2px 10px',
                          borderRadius: 10,
                          background: irColor + '22',
                          color: irColor,
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        Tier {intensityTier} · {tierLabel}
                      </span>
                    )}
                  </div>
                )}

                {/* Step 1 */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 14px',
                    borderRadius: 8,
                    marginBottom: 6,
                    background: '#f8f9fa',
                    border: '1px solid #e5e7eb',
                  }}
                >
                  <div>
                    <span style={{ fontWeight: 600 }}>
                      Signal Presence
                    </span>
                    <span
                      style={{
                        color: '#9ca3af',
                        marginLeft: 8,
                        fontSize: 12,
                      }}
                    >
                      Did your Hurst pattern differ from the
                      uninfluenced control stream?
                    </span>
                  </div>
                  <div
                    style={{
                      fontWeight: 700,
                      color: ksGate ? '#15803d' : '#9ca3af',
                      flexShrink: 0,
                      marginLeft: 12,
                    }}
                  >
                    {ksGate ? 'YES' : 'NO'}
                  </div>
                </div>

                {/* Step 2 */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 14px',
                    borderRadius: 8,
                    marginBottom: 6,
                    background: '#f8f9fa',
                    border: '1px solid #e5e7eb',
                  }}
                >
                  <div>
                    <span style={{ fontWeight: 600 }}>
                      Pattern Structure
                    </span>
                    <span
                      style={{
                        color: '#9ca3af',
                        marginLeft: 8,
                        fontSize: 12,
                      }}
                    >
                      Did the pattern collapse when bit order was
                      randomised?
                    </span>
                  </div>
                  <div
                    style={{
                      fontWeight: 700,
                      color: shuffleYes ? '#15803d' : '#9ca3af',
                      flexShrink: 0,
                      marginLeft: 12,
                    }}
                  >
                    {shuffleYes ? 'YES' : 'NO'}
                  </div>
                </div>

                {/* Verdict */}
                <div
                  style={{
                    padding: '12px 16px',
                    borderRadius: 10,
                    background: irBg,
                    border: `2px solid ${irColor}`,
                  }}
                >
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 14,
                      color: irColor,
                      marginBottom: 4,
                    }}
                  >
                    {irVerdict}
                  </div>
                  <div style={{ color: '#555', fontSize: 12 }}>
                    {irDesc}
                  </div>
                </div>
              </div>
            );
          })()}

        <button
          className="primary-btn"
          onClick={() => goToDone()}
          style={{ marginTop: 8 }}
        >
          Continue
        </button>
      </div>
    );
  }

  // AUTO-MODE / AI-MODE COMPLETION SCREEN
  if (phase === 'auto_complete' || phase === 'ai_complete') {
    return (
      <div
        className="App"
        style={{
          textAlign: 'center',
          maxWidth: 600,
          margin: '0 auto',
          padding: 24,
        }}
      >
        <h1>
          🤖 {phase === 'ai_complete' ? 'AI-Mode' : 'Auto-Mode'}{' '}
          Complete
        </h1>
        <div
          style={{
            marginTop: 32,
            padding: '24px',
            background: '#f0fdf4',
            border: '2px solid #10b981',
            borderRadius: 8,
          }}
        >
          <h2 style={{ color: '#059669', marginBottom: 16 }}>
            ✓{' '}
            {phase === 'ai_complete'
              ? 'AI Agent Sessions'
              : 'Baseline Data Collection'}{' '}
            Complete
          </h2>
          <p style={{ fontSize: 18, marginBottom: 12 }}>
            Successfully completed {autoSessionCount}{' '}
            {phase === 'ai_complete' ? 'AI agent' : 'baseline'}{' '}
            session{autoSessionCount !== 1 ? 's' : ''}
          </p>
          <p style={{ color: '#6b7280', fontSize: 14 }}>
            Data has been saved to the database. You can now view the
            results in the QA dashboard.
          </p>
        </div>

        <div
          style={{
            marginTop: 24,
            padding: '16px',
            background: '#fff',
            border: '1px solid #ddd',
            borderRadius: 8,
          }}
        >
          <p
            style={{
              fontFamily: 'monospace',
              fontSize: 12,
              color: '#6b7280',
            }}
          >
            {phase === 'ai_complete'
              ? 'AI-mode enabled via #ai URL hash'
              : 'Auto-mode enabled via #auto URL hash'}
          </p>
        </div>
      </div>
    );
  }

  // FINAL SCREEN
  if (phase === 'summary') {
    // Invite eligibility from usePrescreenAnalysis — inviteStatus is single source of truth
    // Preview mode (#preview) forces gold for UI review
    const isCumulativeSession = isCumulativeReady;
    const inviteEligible = isPreviewMode || inviteStatus.showInvite;
    const summaryRank = isPreviewMode ? 'gold' : inviteStatus.summaryRank;

    return (
      <div
        className="App"
        style={{
          textAlign: 'center',
          maxWidth: 600,
          margin: '0 auto',
          padding: 24,
        }}
      >
        <h1>Thank You!</h1>

        <div
          style={{
            textAlign: 'left',
            marginBottom: 32,
            padding: '20px',
            background: '#f8f9fa',
            borderRadius: 8,
          }}
        >
          <h3>Session Complete</h3>
          <p>
            Thank you for participating in this research on temporal
            pattern influence.
          </p>

          <h4>Questions or Concerns</h4>
          <p>
            If you have any questions about this research, please
            contact the research team at{' '}
            <a href="mailto:h@whatthequark.com">h@whatthequark.com</a>
          </p>
        </div>

        {/* Invite box — gold/silver (strong signal) or candidate (anomalous pattern, manual review) */}
        {inviteEligible &&
          (() => {
            const isCandidate = summaryRank === 'candidate';
            const boxStyle = isCandidate
              ? {
                  position: 'relative',
                  marginBottom: 24,
                  padding: '24px 28px',
                  background: '#eff6ff',
                  border: '2px solid #60a5fa',
                  borderRadius: 14,
                  boxShadow: '0 0 16px #60a5fa33',
                }
              : {
                  position: 'relative',
                  marginBottom: 24,
                  padding: '24px 28px',
                  background: '#fffbeb',
                  border: '3px solid #f59e0b',
                  borderRadius: 14,
                  boxShadow: '0 0 24px #f59e0b55',
                };
            const labelColor = isCandidate ? '#1d4ed8' : '#b45309';
            const headColor = isCandidate ? '#1e3a8a' : '#92400e';
            const bodyColor = isCandidate ? '#1e40af' : '#78350f';
            return (
              <div style={boxStyle}>
                {!isCandidate && (
                  <>
                    <span
                      style={{
                        position: 'absolute',
                        top: -14,
                        left: 10,
                        fontSize: 24,
                      }}
                    >
                      ⭐
                    </span>
                    <span
                      style={{
                        position: 'absolute',
                        top: -14,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        fontSize: 24,
                      }}
                    >
                      ⭐
                    </span>
                    <span
                      style={{
                        position: 'absolute',
                        top: -14,
                        right: 10,
                        fontSize: 24,
                      }}
                    >
                      ⭐
                    </span>
                    <span
                      style={{
                        position: 'absolute',
                        bottom: -14,
                        left: 10,
                        fontSize: 24,
                      }}
                    >
                      ⭐
                    </span>
                    <span
                      style={{
                        position: 'absolute',
                        bottom: -14,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        fontSize: 24,
                      }}
                    >
                      ⭐
                    </span>
                    <span
                      style={{
                        position: 'absolute',
                        bottom: -14,
                        right: 10,
                        fontSize: 24,
                      }}
                    >
                      ⭐
                    </span>
                  </>
                )}
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.1em',
                    color: labelColor,
                    marginBottom: 6,
                  }}
                >
                  {isCandidate
                    ? 'INTERESTING PATTERN DETECTED'
                    : 'STATUS: HIGH-RESONANCE SIGNATURE DETECTED'}
                </div>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 17,
                    color: headColor,
                    marginBottom: 12,
                  }}
                >
                  {isCandidate
                    ? "We'd like to learn more about your session"
                    : 'You are a strong candidate for Experiment 5'}
                </div>
                <p
                  style={{
                    margin: '0 0 10px',
                    color: bodyColor,
                    fontSize: 14,
                    textAlign: 'left',
                  }}
                >
                  {isCandidate
                    ? 'Your session showed an unusual pattern in the quantum stream that our research team would like to review.'
                    : 'Your interaction with the quantum stream has met the criteria for the next phase of our research.'}
                </p>
                <p
                  style={{
                    margin: '0 0 10px',
                    color: bodyColor,
                    fontSize: 14,
                    textAlign: 'left',
                  }}
                >
                  Participants who participate in Experiment 5 will
                  receive a personal performance report including your
                  individual scores and how your results compare to
                  the broader participant pool.
                </p>
                <p
                  style={{
                    margin: '0 0 16px',
                    color: bodyColor,
                    fontSize: 14,
                    textAlign: 'left',
                  }}
                >
                  {isCandidate
                    ? "Leave your details below and we'll be in touch:"
                    : 'Leave your details below to secure your place and receive your personal results when the study concludes:'}
                </p>

                {inviteSubmitted ? (
                  <div
                    style={{
                      padding: '12px 16px',
                      background: '#dcfce7',
                      borderRadius: 8,
                      color: '#15803d',
                      fontWeight: 600,
                      fontSize: 14,
                    }}
                  >
                    Thank you — we'll be in touch!
                  </div>
                ) : (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setInviteSubmitting(true);
                      setInviteError(null);
                      try {
                        await addDoc(collection(db, 'exp5_invites'), {
                          ...inviteForm,
                          age:
                            Number(inviteForm.age) || inviteForm.age,
                          submittedAt: serverTimestamp(),
                          experimentId: C.EXPERIMENT_ID,
                          sessionId: runRef?.id ?? null,
                          rank: summaryRank,
                        });
                        setInviteSubmitted(true);
                      } catch (err) {
                        console.error('Invite save failed:', err);
                        setInviteError(
                          err?.message ||
                            'Submission failed — please try again.',
                        );
                      }
                      setInviteSubmitting(false);
                    }}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 10,
                      textAlign: 'left',
                    }}
                  >
                    <div>
                      <label
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: '#92400e',
                          display: 'block',
                          marginBottom: 3,
                        }}
                      >
                        First Name
                      </label>
                      <input
                        required
                        value={inviteForm.firstName}
                        onChange={(e) =>
                          setInviteForm((f) => ({
                            ...f,
                            firstName: e.target.value,
                          }))
                        }
                        style={{
                          width: '100%',
                          padding: '7px 10px',
                          borderRadius: 6,
                          border: '1px solid #f59e0b',
                          fontSize: 14,
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                    <div>
                      <label
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: '#92400e',
                          display: 'block',
                          marginBottom: 3,
                        }}
                      >
                        Last Name
                      </label>
                      <input
                        required
                        value={inviteForm.lastName}
                        onChange={(e) =>
                          setInviteForm((f) => ({
                            ...f,
                            lastName: e.target.value,
                          }))
                        }
                        style={{
                          width: '100%',
                          padding: '7px 10px',
                          borderRadius: 6,
                          border: '1px solid #f59e0b',
                          fontSize: 14,
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                    <div>
                      <label
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: '#92400e',
                          display: 'block',
                          marginBottom: 3,
                        }}
                      >
                        Country
                      </label>
                      <input
                        required
                        placeholder="Country"
                        value={inviteForm.location}
                        onChange={(e) =>
                          setInviteForm((f) => ({
                            ...f,
                            location: e.target.value,
                          }))
                        }
                        style={{
                          width: '100%',
                          padding: '7px 10px',
                          borderRadius: 6,
                          border: '1px solid #f59e0b',
                          fontSize: 14,
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                    <div>
                      <label
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: '#92400e',
                          display: 'block',
                          marginBottom: 3,
                        }}
                      >
                        Age
                      </label>
                      <input
                        required
                        type="number"
                        min="18"
                        max="120"
                        value={inviteForm.age}
                        onChange={(e) =>
                          setInviteForm((f) => ({
                            ...f,
                            age: e.target.value,
                          }))
                        }
                        style={{
                          width: '100%',
                          padding: '7px 10px',
                          borderRadius: 6,
                          border: '1px solid #f59e0b',
                          fontSize: 14,
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: '#92400e',
                          display: 'block',
                          marginBottom: 3,
                        }}
                      >
                        Email
                      </label>
                      <input
                        required
                        type="email"
                        value={inviteForm.email}
                        onChange={(e) =>
                          setInviteForm((f) => ({
                            ...f,
                            email: e.target.value,
                          }))
                        }
                        style={{
                          width: '100%',
                          padding: '7px 10px',
                          borderRadius: 6,
                          border: '1px solid #f59e0b',
                          fontSize: 14,
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                    {inviteError && (
                      <div
                        style={{
                          gridColumn: '1 / -1',
                          padding: '10px 14px',
                          background: '#fef2f2',
                          border: '1px solid #fca5a5',
                          borderRadius: 8,
                          color: '#dc2626',
                          fontSize: 13,
                        }}
                      >
                        {inviteError}
                      </div>
                    )}
                    <div
                      style={{
                        gridColumn: '1 / -1',
                        textAlign: 'center',
                        marginTop: 4,
                      }}
                    >
                      <button
                        type="submit"
                        disabled={inviteSubmitting}
                        style={{
                          padding: '10px 28px',
                          background: isCandidate
                            ? '#ea580c'
                            : '#f59e0b',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 8,
                          fontWeight: 700,
                          fontSize: 14,
                          cursor: inviteSubmitting
                            ? 'wait'
                            : 'pointer',
                        }}
                      >
                        {inviteSubmitting
                          ? 'Submitting…'
                          : isCandidate
                            ? 'Request Further Testing'
                            : 'Join Experiment 5'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            );
          })()}

        <div
          style={{
            padding: '16px',
            background: '#fff',
            border: '1px solid #ddd',
            borderRadius: 8,
          }}
        >
          <p style={{ marginTop: 0 }}>
            <a
              href="https://zenodo.org/records/18714884"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: '#3b82f6',
                textDecoration: 'underline',
              }}
            >
              Read about the methodology behind this pre-screening for
              Experiment 5.
            </a>
          </p>

          {isCumulativeSession ? (
            <p
              style={{
                textAlign: 'left',
                fontSize: 14,
                color: '#374151',
              }}
            >
              Each session adds statistical power — feel free to run
              more sessions to refine your result. Spread sessions
              across different days for best results.
            </p>
          ) : (
            <ul style={{ textAlign: 'left', marginTop: 16 }}>
              <li>
                Repeat this experiment at least 5 times — results
                become much more reliable across sessions.
              </li>
              <li>
                Share with friends and family interested in
                participating in our study — large datasets matter
                here.
              </li>
            </ul>
          )}

          <button
            onClick={() => window.location.reload()}
            className="primary-btn"
            style={{ marginTop: '1em' }}
          >
            Retake
          </button>
        </div>
      </div>
    );
  }
}
