// src/MainApp.jsx
import './App.css';
import React, { useEffect, useRef, useState } from 'react';
import { pkConfig as C } from './config.js';
import { db } from './firebase.js';
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { preQuestions, postQuestions } from './questions.js';
import { QuestionsForm } from './Forms.jsx';
import { BlockScoreboard } from './Scoring.jsx';
import ConsentGate from './ui/ConsentGate.jsx';
import { usePhaseRouter } from './hooks/usePhaseRouter.js';
import { useParticipantProfile } from './hooks/useParticipantProfile.js';
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
    sessionCount,
    setSessionCount,
    requireUid,
    loadParticipant,
    loadAutoParticipant,
  } = useParticipantProfile({ db, C });

  // ---- consent: email-contact permission (set in ConsentGate.onAgree)
  const emailOptInRef = useRef(false);

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
  }, [
    isAutoMode,
    isAIMode,
    profileLoading,
    uid,
    loadAutoParticipant,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchTriggeredAtRef = useRef(null); // Capture when fetching was triggered (button press or auto-timer)
  const qrngProviderRef = useRef(null); // Track QRNG provider across blocks ('mixed' if it changes)
  const qrngProviderSeqRef = useRef([]); // Per-block provider labels, for RLE encoding at session end
  const allRawBitsRef = useRef([]); // Full 301-bit calls per block (assignment + both halves)

  // ---- phase & per-minute state
  const {
    phase,
    goToPreQ,
    goToOnboarding,
    goToTargetAnnounce,
    goToFetching,
    goToScore,
    goToRest,
    goToAudit,
    goToNext,
    goToPreparingNext,
    goToResults,
    goToSummary,
    goToDone,
    goToAutoComplete,
    goToAIComplete,
    goToMaxSessions,
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

  // ---- session persistence: runRef creation + aggregate writes + completion bookkeeping
  const {
    runRef,
    setRunRef,
    ensureRunDoc,
    lastPersistedBlockRef,
    saveSessionAggregates,
    resetCompletionFlag,
  } = useSessionPersistence({
    db,
    C,
    target,
    uid,
    requireUid,
    participantHash,
    isAutoMode,
    isAIMode,
    totals,
    totalGhostHits,
    deltaHurstHistory,
    hurstSubjectHistory,
    hurstDemonHistory,
    allRawBitsRef,
    qrngProviderRef,
    qrngProviderSeqRef,
    phase,
    sessionCount,
    participantProfile,
    emailPlaintext,
    emailOptInRef,
  });

  // ---- trial runner: refs, processTrials (internal), persistMinute (internal),
  //      endMinute, fetching effect, audit effect, block-persistence effect
  const { refs: trialRunnerRefs } = useTrialRunner({
    C,
    phase,
    target,
    setTarget,
    isAutoMode,
    isAIMode,
    goToScore,
    goToRest,
    goToResults,
    runRef,
    blockIdx,
    setblockIdx,
    setIsRunning,
    setLastBlock,
    setTotals,
    setTotalGhostHits,
    setDeltaHurstHistory,
    setHurstSubjectHistory,
    setHurstDemonHistory,
    saveSessionAggregates,
    lastPersistedBlockRef,
    fetchTriggeredAtRef,
    allRawBitsRef,
    qrngProviderRef,
    qrngProviderSeqRef,
  });

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
          const completedBlockIdx =
            trialRunnerRefs.blockIdxToPersistRef.current;
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
        saveSessionAggregates().catch((err) =>
          console.error(
            'saveSessionAggregates failed (background):',
            err,
          ),
        );
        if (isFullSession) {
          setDoc(runRef, { completed: true }, { merge: true }).catch(
            console.error,
          );
        }
      }
      isAIMode ? goToDone() : goToNext();
    } else if (
      (phase === 'done' && isAutoMode) ||
      phase === 'summary'
    ) {
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
        resetCompletionFlag();

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
    // All goTo* functions, resetCompletionFlag, setRunRef, lastPersistedBlockRef are stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isAutoMode,
    isAIMode,
    phase,
    blockIdx,
    autoSessionCount,
    autoSessionTarget,
    runRef,
    saveSessionAggregates,
  ]);

  // Note: processTrials, persistMinute, endMinute, fetching effect, audit effect,
  // and block-persistence effect are owned by useTrialRunner above.

  // Note: Exit functionality removed - sessions complete automatically or handle early exits in useEffect

  // Ensure document is created early in onboarding phase.
  // Wait for uid — calling ensureRunDoc with uid=null triggers requireUid() which races
  // with the sign-in effect in useParticipantProfile and creates a duplicate anonymous user.
  useEffect(() => {
    if (phase === 'onboarding' && !runRef && target && uid) {
      console.log(
        '[ensureRunDoc] onboarding useEffect firing — calling ensureRunDoc',
      );
      ensureRunDoc().catch(console.error);
    }
  }, [phase, runRef, target, uid, ensureRunDoc]);

  // Human mode: save aggregates (hitRate, subjectZ, Hurst R/S, etc.) as soon as
  // the session's 80 blocks are done, independent of whether the participant
  // goes on to submit the exit survey. Auto/AI modes already save at this same
  // point via the auto-mode effect above; keyed on runRef.id (not a manual
  // reset ref) so it naturally re-arms for each new session's doc.
  const savedResultsAggregatesForRef = useRef(null);
  useEffect(() => {
    if (isAutoMode || isAIMode) return;
    if (phase !== 'results') return;
    if (blockIdx < C.BLOCKS_TOTAL) return;
    if (!runRef) return;
    if (savedResultsAggregatesForRef.current === runRef.id) return;
    savedResultsAggregatesForRef.current = runRef.id;
    saveSessionAggregates().catch((err) =>
      console.error('saveSessionAggregates failed (results phase):', err),
    );
  }, [isAutoMode, isAIMode, phase, blockIdx, runRef, saveSessionAggregates]);

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
          title="Experiment 4b: Intent and Quantum Random Number Generators"
          showBlindingNote={false}
          studyDescription={`Thank you for participating! You will complete ${C.BLOCKS_TOTAL} blocks each ~2 seconds long and brief questionnaires (approximately 5 minutes total).`}
          bullets={[
            'You will receive one target color assignment (blue or orange) for the entire session',
            'Your task is to get your target color above 50%. Concentrate your attention on your target color right before and during the moment quantum data is fetched from a quantum random number generator.',
            'When focused and ready, press "I\'m Ready" and keep focusing while your target color is shown. This triggers the quantum random number generator, and the signatures in the QRNG during your focused intention is what we\'re testing.',
            'We collect data on quantum random sequences, your performance metrics, timing patterns, and your questionnaire responses.',
            'Participation is completely voluntary; you may exit at any time. At the end of each session you will be provided a Session ID for your records. This can be used to request removal at any time.',
            'If you provide your email, we store it to link your sessions across devices. Your email will not be shared with third parties or used for any other purpose.',
            'To request deletion of your data, email h@whatthequark.com with the subject line "Data Deletion Request". Include the email address you used when participating and we will remove your records.',
            'Data will be retained indefinitely to enable scientific replication and analysis, unless a deletion request is received.',
            'Hosting providers may log IP addresses for security purposes; these logs are not linked to your study data.',
          ]}
          onAgree={async ({ email, emailOptIn } = {}) => {
            resetCompletionFlag();
            emailOptInRef.current = emailOptIn;
            const { skipPreQ, usableCount } =
              await loadParticipant(email);
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
          You have completed the maximum number of pre-screening
          sessions for this study. Your contributions are appreciated
          and have been recorded.
        </p>
        <p>
          Please contact the study administrator if you have questions
          or would like to continue participating in future phases of
          the research.
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
              const ref = doc(db, C.DEMOGRAPHICS_COLLECTION, uidNow);
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
      ensureRunDoc().catch((err) =>
        console.error(
          '❌ AI-MODE: Failed to initialize runRef:',
          err,
        ),
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
            : 'Experiment 4b: Intent and Quantum Random Number Generators'}
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
              fills the screen.{' '}
              <strong>
                This is the period to sustain clear, steady focus on
                your target color. Focus your intention before and
                during your click of the I'm Ready button.
              </strong>
            </li>

            <li>
              You will see your target color displayed steadily during the
              fetch, with a loading spinner. After the quantum data is retrieved,
              results appear instantly. The goal is to score over 50% as often
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
                setblockIdx(0);
                goToRest();
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
    const completedBlockIdx =
      trialRunnerRefs.blockIdxToPersistRef.current;
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

    return (
      <div
        style={{
          padding: 24,
          textAlign: 'center',
          maxWidth: 600,
          margin: '0 auto',
        }}
      >
        <h2 style={{ marginBottom: 28 }}>
          Block {completedBlockNum} Complete
        </h2>
        {sessionCount > 0 && (
          <div
            style={{
              fontSize: 11,
              color: '#9ca3af',
              marginBottom: 16,
            }}
          >
            Session {sessionCount + 1}
          </div>
        )}

        {/* Show last block score */}
        {lastBlock && lastBlock.n > 0 && (
          <div
            style={{
              display: 'inline-block',
              padding: '16px 24px',
              borderRadius: 12,
              border: '2px solid #ddd',
              background: '#f9f9f9',
              marginBottom: 24,
              fontSize: 24,
              fontWeight: 600,
            }}
          >
            Your Score: {pctLast}%
          </div>
        )}

        {/* Session totals */}
        <BlockScoreboard
          last={lastBlock || { k: 0, n: 0, kind: 'instant' }}
          totals={totals}
          targetSide={target}
          hideGhost={true}
          hideBlockType={true}
        />

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
        >
          Continue
        </button>

        <p style={{ marginTop: 16, fontSize: 14, color: '#6b7280' }}>
          Block {completedBlockNum} of {C.BLOCKS_TOTAL}
        </p>
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
              Bring your attention to your target color and form your
              intent before clicking the button.
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
    const completedBlockIdx =
      trialRunnerRefs.blockIdxToPersistRef.current;
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

  // FETCHING - Full-screen solid target color + white spinner (no flashing,
  // for photosensitivity safety; the spinner alone carries the loading signal)
  if (phase === 'fetching') {
    const targetColor = target === 'BLUE' ? '#1e40af' : '#ea580c';

    return (
      <>
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: targetColor,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
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

              // No email — use UID-based counter (same-device only)
              if (!participantHash) {
                const newCount = sessionCount + 1;
                if (uid) {
                  try {
                    await setDoc(
                      doc(db, C.DEMOGRAPHICS_COLLECTION, uid),
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

    const sessionNumber = sessionCount + 1;
    const sessionsRemain = sessionNumber < C.TARGET_SESSIONS;

    // Cumulative average from cheap running scalar totals on the participant
    // profile doc (cumulative_hits/cumulative_trials), not a per-session
    // history query -- see the comment in useSessionPersistence.js.
    const cumTrials =
      (participantProfile?.cumulative_trials ?? 0) + totals.n;
    const cumSubjectHitRate =
      cumTrials > 0
        ? (
            (100 *
              ((participantProfile?.cumulative_hits ?? 0) +
                totals.k)) /
            cumTrials
          ).toFixed(1)
        : '50.0';

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
        <h1>Results</h1>

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
              marginBottom: 0,
            }}
          >
            <strong>
              Your average across all completed sessions:
            </strong>{' '}
            {cumSubjectHitRate}%
          </p>
        </div>

        <div
          style={{
            padding: 16,
            background: '#f0fdf4',
            borderRadius: 12,
            border: '1px solid #bbf7d0',
            marginBottom: 16,
            textAlign: 'center',
          }}
        >
          <p
            style={{
              fontSize: 15,
              color: '#15803d',
              marginBottom: 0,
              fontWeight: 600,
            }}
          >
            {sessionsRemain
              ? `Session ${sessionNumber} of ${C.TARGET_SESSIONS} complete`
              : `Thank you for completing ${sessionNumber} sessions`}
          </p>
        </div>

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
            numbers were generated during your session, which a simple
            hit rate doesn't reveal. A score below 50% is just as
            valuable to the research as one above it.
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
          <p>
            Your session number is{' '}
            <strong>{runRef?.id ?? 'unavailable'}</strong>. Please
            include this session number if you email us with a
            question, an issue, or a request to delete this session
            from our records for privacy reasons.
          </p>
        </div>

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
              href="https://zenodo.org/records/22004303"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: '#3b82f6',
                textDecoration: 'underline',
              }}
            >
              Read about the methodology behind this research.
            </a>
          </p>

          <ul style={{ textAlign: 'left', marginTop: 16 }}>
            <li>
              Feel free to run more sessions. Spread them across
              different days for best results.
            </li>
            <li>
              Share with friends and family interested in
              participating in our study. Large datasets matter here.
            </li>
          </ul>

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
