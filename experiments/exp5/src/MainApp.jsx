// src/MainApp.jsx
import './App.css';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { pkConfig as C } from './config.js';
import {
  markSessionCompleted,
  savePostSurvey,
  savePreQuestionnairePage,
  markQuestionnaireDone,
  saveContactPreferences,
  saveConsentRecord,
  setUidSessionCount,
} from './lib/database.js';
import { preQuestionPages, postQuestions, attentionCheckSummary } from './questions.js';
import PagedQuestionnaire from './PagedQuestionnaire.jsx';
import { QuestionsForm } from './Forms.jsx';
import ConsentInfoPage, {
  FRIENDLY_TITLE,
  consentVersionFor,
} from './ui/ConsentInfoPage.jsx';
import ReturningParticipantGate from './ui/ReturningParticipantGate.jsx';
import WelcomeBackPage from './ui/WelcomeBackPage.jsx';
import UserIdScreen from './ui/UserIdScreen.jsx';
import { generateUserId, normalizeUserId } from './lib/userId.js';
import { getRecruitment, prolificCompletionUrl } from './lib/recruitment.js';
import { claimPaymentCode, lookupPaymentCodeOwner } from './lib/paymentCodeClaim.js';
import { recordPaymentRequest } from './lib/paymentRequest.js';
import {
  claimProlificSession,
  markProlificSessionCompleted,
} from './lib/prolificSessionClaim.js';
import PaymentCompletionPage from './ui/PaymentCompletionPage.jsx';
import { usePhaseRouter } from './hooks/usePhaseRouter.js';
import { useParticipantProfile } from './hooks/useParticipantProfile.js';
import { useSessionPersistence } from './hooks/useSessionPersistence.js';
import { useTrialRunner } from './hooks/useTrialRunner.js';
import { BlockScoreboard } from './Scoring.jsx';

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
  const isAutoMode = window.location.hash === '#auto';
  // AI-mode for AI agent sessions (activated via URL hash #ai)
  const isAIMode = window.location.hash === '#ai';
  // Preview mode: jump straight to the invite/summary screen for UI review (activated via URL hash #preview)
  const isPreviewMode = window.location.hash === '#preview';
  const [autoSessionCount, setAutoSessionCount] = useState(0);
  const [autoSessionTarget, setAutoSessionTarget] = useState(
    isAIMode ? C.AI_MODE_SESSIONS : C.AUTO_MODE_SESSIONS,
  );

  // ---- participant profile, sign-in, session history
  const {
    loading: profileLoading,
    uid,
    participantHash,
    participantProfile,
    emailPlaintext,
    prolificId,
    sessionCount,
    setSessionCount,
    usableSessionCount,
    pastH_s,
    pastH_d,
    pastBits,
    pastDemonBits,
    pastSubjectHits,
    pastDemonHits,
    pastDemonTrials,
    requireUid,
    loadParticipant,
    loadParticipantByKey,
    peekParticipant,
    loadAutoParticipant,
    setCumulativeHistory,
  } = useParticipantProfile({ C });

  // ---- consent: email-contact permission (set in ConsentInfoPage.onAgree)
  // null until a consent page gives an answer this visit (returning participants skip consent,
  // so their earlier answer must not be overwritten)
  const emailOptInRef = useRef(null);

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
    goToPayment,
    goToAutoComplete,
    goToAIComplete,
    goToMaxSessions,
  } = usePhaseRouter();
  const [declinedParticipation, setDeclinedParticipation] =
    useState(false);
  // null | 'already_used' | 'missing_session_id' | 'error' -- set when a Prolific link can't start a session
  const [prolificBlock, setProlificBlock] = useState(null);
  // Entry before consent: 'ask' (volunteers: "have you taken part before?"), 'checking'
  // (Prolific / paid-link users: a quick read-only look-up), 'welcome_back' (already consented
  // to the current text, so skip consent), or 'consent'.
  const [entryStep, setEntryStep] = useState(() =>
    getRecruitment().source === 'volunteer' ? 'ask' : 'checking',
  );
  const [returning, setReturning] = useState(null); // { key } | { email } | { prolificId }
  const [prefillEmail, setPrefillEmail] = useState('');
  // Volunteer who chose a generated user ID: the new ID, and the consent details to finish with
  const [newUserId, setNewUserId] = useState(null);
  const [pendingConsent, setPendingConsent] = useState(null);
  const [entryBusy, setEntryBusy] = useState(false);
  // true once this participant has clicked "Request payment now" (ends participation)
  const [paymentRequested, setPaymentRequested] = useState(false);
  // Read once from the URL at startup (stable object, safe in effect deps).
  const recruitment = useMemo(() => getRecruitment(), []);
  // Mark the Prolific session as completed when the end of the session is
  // reached, so the same link cannot be resumed afterwards.
  useEffect(() => {
    if (phase !== 'payment' && phase !== 'summary') return;
    const rec = getRecruitment();
    if (rec.source !== 'prolific') return;
    markProlificSessionCompleted(rec).catch((err) =>
      console.error('Prolific completion mark failed:', err),
    );
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps
  // People arriving through a Prolific link or a personal payment-code link are identified by
  // the link itself. If they have already consented to the current text, skip consent.
  // Read-only; any failure just falls back to showing the consent page.
  useEffect(() => {
    if (phase !== 'consent' || entryStep !== 'checking' || !uid) return;
    if (isAutoMode || isAIMode) return;
    let cancelled = false;
    (async () => {
      try {
        const wanted = consentVersionFor(recruitment.source);
        let found = null;
        if (recruitment.source === 'prolific') {
          const r = await peekParticipant({ prolificId: recruitment.prolificId });
          if (r.profile?.consent_version === wanted) {
            found = { prolificId: recruitment.prolificId };
          }
        } else if (recruitment.tremendousToken) {
          const { valid, owner } = await lookupPaymentCodeOwner(recruitment.tremendousToken);
          if (valid && owner) {
            const r = await peekParticipant({ key: owner });
            if (r.profile?.consent_version === wanted) found = { key: owner };
          }
        }
        if (cancelled) return;
        if (found) {
          setReturning(found);
          setEntryStep('welcome_back');
        } else {
          setEntryStep('consent');
        }
      } catch (err) {
        console.error('Returning-participant check failed (showing consent):', err);
        if (!cancelled) setEntryStep('consent');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, entryStep, uid]); // eslint-disable-line react-hooks/exhaustive-deps

  // Never leave someone on "Loading" if sign-in or the check hangs: fall back to consent.
  useEffect(() => {
    if (entryStep !== 'checking') return undefined;
    const t = setTimeout(() => setEntryStep('consent'), 8000);
    return () => clearTimeout(t);
  }, [entryStep]);
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

  // ---- session persistence: runRef creation + aggregate writes + completion bookkeeping
  const {
    runRef,
    setRunRef,
    ensureRunDoc,
    lastPersistedBlockRef,
    saveSessionAggregates,
    resetCompletionFlag,
  } = useSessionPersistence({
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
    usableSessionCount,
    subjectBitsHistory,
    demonBitsHistory,
    pastH_s,
    pastH_d,
    pastBits,
    pastDemonBits,
    pastSubjectHits,
    pastDemonHits,
    pastDemonTrials,
    participantProfile,
    emailPlaintext,
    prolificId,
    emailOptInRef,
    recruitment,
    onHistoryUpdated: setCumulativeHistory,
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
    setSubjectBitsHistory,
    setDemonBitsHistory,
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
          markSessionCompleted(runRef).catch(console.error);
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
        setSubjectBitsHistory([]);
        setDemonBitsHistory([]);
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

  // ===== flow gates =====
  if (profileLoading || !target) {
    return <div style={{ padding: 24 }}>Loading…</div>;
  }

  // CONSENT - Skip for auto/AI modes
  // ---- Starting a session, after either the consent page or the welcome-back page.
  // Every guard lives here so a returning participant who skips consent goes through exactly the
  // same checks as one who consents: Prolific link reuse, payment already requested, personal
  // payment code, Prolific WAVE, the session limit.
  const startEntry = async ({ load, contact, consentVersion }) => {
    const rec = getRecruitment();
    // Prolific: one SESSION_ID may start one session. Fail closed.
    if (rec.source === 'prolific') {
      try {
        const claim = await claimProlificSession(await requireUid(), rec);
        if (!claim.ok) {
          setProlificBlock(claim.reason);
          return;
        }
      } catch (err) {
        console.error('Prolific session claim failed:', err);
        setProlificBlock('error');
        return;
      }
    }
    // Reset completion state so it's recomputed fresh for this session
    resetCompletionFlag();
    // Results-contact permission (also used when a session completes). Only set when a consent
    // page gave an answer this visit. Without an email there is nothing to contact: false.
    if (contact) {
      emailOptInRef.current = contact.email ? contact.resultsContact : false;
    }
    const loaded = await load();
    let { skipPreQ, usableCount } = loaded;
    const { participantHash: loadedHash, paymentRequested: alreadyRequested } = loaded;
    // Payment already requested: participation has ended.
    if (alreadyRequested) {
      setProlificBlock('payment_requested');
      return;
    }
    // Remember which consent text this participant agreed to, so returning visits can skip it.
    if (consentVersion && loadedHash) {
      saveConsentRecord(loadedHash, { version: consentVersion }).catch((e) =>
        console.error('Consent record save failed:', e),
      );
    }
    // Personal payment code in the link: must be genuine, and usable by one participant only.
    // Fail closed. (No code at all is allowed; such participants simply can't be paid.)
    if (rec.source === 'direct' && rec.tremendousToken && loadedHash) {
      try {
        const codeClaim = await claimPaymentCode(rec.tremendousToken, loadedHash);
        if (!codeClaim.ok) {
          setProlificBlock(codeClaim.reason);
          return;
        }
      } catch (err) {
        console.error('Payment code check failed:', err);
        setProlificBlock('error');
        return;
      }
    }
    // Prolific WAVE=n in the link is authoritative for the session number: this is session n,
    // so n-1 are already done, and the pre-questionnaire is shown only on wave 1.
    if (rec.source === 'prolific' && rec.wave) {
      if (rec.wave - 1 !== usableCount) {
        console.warn(
          `WAVE=${rec.wave} differs from stored session count ${usableCount}; using WAVE.`,
        );
      }
      setSessionCount(rec.wave - 1);
      usableCount = rec.wave - 1;
      skipPreQ = rec.wave > 1;
    }
    // Contact preferences, saved with the private linkage record each time a consent page is
    // answered. The latest answer is current; every answer is kept in contact_history.
    if (contact?.email && loadedHash) {
      saveContactPreferences(loadedHash, {
        resultsContact: contact.resultsContact,
        futureContact: contact.futureContact,
        sessionNumber: usableCount + 1,
      }).catch((e) => console.error('Contact preferences save failed:', e));
    }
    if (usableCount >= C.MAX_SESSIONS_FOR_ANALYSIS) {
      goToMaxSessions();
      return;
    }
    // Straight on: skip the pre-questionnaire only if this participant has already submitted it
    // (or WAVE > 1 for Prolific).
    if (skipPreQ) goToOnboarding();
    else goToPreQ();
  };

  if (phase === 'consent') {
    // Auto and AI modes skip consent and questions
    if (isAutoMode || isAIMode) {
      goToOnboarding();
      return null;
    }

    if (prolificBlock) {
      return (
        <div className="App" style={{ textAlign: 'center', padding: 24 }}>
          <h1>This link cannot be used</h1>
          <p>
            {prolificBlock === 'payment_requested'
              ? 'You have already requested payment, so your participation in the study has ended. Thank you for taking part!'
              : prolificBlock === 'invalid_code'
              ? 'This study link is not valid. Please use the exact link you were sent, or contact a.campbell@lmu.de.'
              : prolificBlock === 'code_used'
                ? 'This study link has already been used by another participant. Please contact a.campbell@lmu.de.'
                : prolificBlock === 'already_used'
              ? 'This Prolific link has already been used for a session. Please return to Prolific and start a new session from there.'
              : prolificBlock === 'missing_session_id'
                ? 'This link is incomplete. Please return to Prolific and open the study from there.'
                : 'Something went wrong while checking your link. Please reload the page or return to Prolific and try again.'}
          </p>
        </div>
      );
    }

    if (declinedParticipation) {
      return (
        <div
          className="App"
          style={{ textAlign: 'center', padding: 24 }}
        >
          <h1>You have chosen not to participate</h1>
          <p>
            No information was recorded. You may now close this
            window.
          </p>
        </div>
      );
    }

    if (entryStep === 'checking') {
      return (
        <div className="App" style={{ textAlign: 'center', padding: 24 }}>
          <p>Loading…</p>
        </div>
      );
    }

    if (entryStep === 'ask') {
      return (
        <ReturningParticipantGate
          onNew={() => setEntryStep('consent')}
          onLookup={async (typed) => {
            // An "@" means an email address; otherwise it is a four-word user ID.
            const isEmail = typed.includes('@');
            const who = isEmail
              ? { email: typed }
              : { userId: normalizeUserId(typed) };
            const r = await peekParticipant(who);
            if (r.profile?.consent_version === consentVersionFor('volunteer')) {
              setReturning(who);
              setEntryStep('welcome_back');
              return { found: true };
            }
            if (r.profile) {
              // Known, but they have not agreed to the current consent text.
              if (isEmail) setPrefillEmail(typed);
              setEntryStep('consent');
              return { found: true };
            }
            return { found: false };
          }}
        />
      );
    }

    if (entryStep === 'welcome_back') {
      return (
        <WelcomeBackPage
          busy={entryBusy}
          onContinue={async () => {
            setEntryBusy(true);
            try {
              await startEntry({
                load: () =>
                  returning?.key
                    ? loadParticipantByKey(returning.key)
                    : loadParticipant(
                        returning?.email || null,
                        returning?.prolificId || null,
                        returning?.userId || null,
                      ),
                contact: null,
                consentVersion: null,
              });
            } finally {
              setEntryBusy(false);
            }
          }}
        />
      );
    }

    if (entryStep === 'show_user_id' && newUserId) {
      return (
        <UserIdScreen
          userId={newUserId}
          onConfirmed={() =>
            startEntry({
              load: () => loadParticipant(null, null, newUserId),
              contact: { email: null, resultsContact: false, futureContact: false },
              consentVersion: pendingConsent?.consentVersion || null,
            })
          }
        />
      );
    }

    return (
      <div style={{ position: 'relative' }}>
        <ConsentInfoPage
          recruitment={getRecruitment()}
          initialEmail={prefillEmail}
          onDecline={() => setDeclinedParticipation(true)}
          onAgree={async ({
            email,
            prolificId: consentProlificId,
            resultsContact,
            futureContact,
            consentVersion,
            wantsUserId,
          } = {}) => {
            if (wantsUserId) {
              // Make a new, unused four-word ID, show it, and only continue once they have
              // typed it back. Nothing is saved until then.
              let id = generateUserId();
              for (let i = 0; i < 5; i++) {
                const taken = await peekParticipant({ userId: id });
                if (!taken.profile) break;
                id = generateUserId();
              }
              setNewUserId(id);
              setPendingConsent({ consentVersion });
              setEntryStep('show_user_id');
              return;
            }
            return startEntry({
              load: () => loadParticipant(email, consentProlificId),
              contact: { email, resultsContact, futureContact },
              consentVersion,
            });
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
          You have completed the maximum number of sessions for this
          study. Your contributions are appreciated and have been
          recorded.
        </p>
        <p>
          Please contact the study administrator if you have questions
          or would like to continue participating in future phases of
          the research.
        </p>
        <p>
          <a href="mailto:a.campbell@lmu.de">a.campbell@lmu.de</a>
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
        <PagedQuestionnaire
          title="Before you begin"
          pages={preQuestionPages}
          onPageSaved={async ({ pageIndex, answers, order, isLast }) => {
            // Save the answers so far (merged) under this browser's private
            // participants/{uid} document, with the participant key and the
            // order the pages were shown in.
            try {
              const uidNow = await requireUid();
              await savePreQuestionnairePage(uidNow, {
                answers,
                participantKey: participantHash,
                pageOrder: order,
                pageIndex,
                // Attention-check result so far (recorded only; never blocks anyone)
                extra: (() => {
                  const a = attentionCheckSummary(answers);
                  return { attention_checks_passed: a.passed, attention_checks_total: a.total };
                })(),
              });
            } catch (e) {
              console.warn('Pre survey save error (non-blocking):', e);
            }
            // After the last page: mark the questionnaire as submitted on THIS
            // participant's profile (the flag the next visit reads to skip it).
            if (isLast) {
              if (participantHash) {
                try {
                  await markQuestionnaireDone(participantHash);
                } catch (e) {
                  console.error('Questionnaire flag save failed:', e);
                }
              } else {
                console.warn('Questionnaire flag not saved: no participant key');
              }
            }
          }}
          onComplete={() => goToOnboarding()}
        />
      </div>
    );
  }

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
        <h1>{isAIMode ? '🤖 AI Agent Mode' : FRIENDLY_TITLE}</h1>

        <div style={{ marginBottom: 30, marginTop: 30 }}>
          <h3 style={{ color: '#2c3e50', marginBottom: 15 }}>
            What to Expect:
          </h3>
          <ul style={{ fontSize: 16, lineHeight: 1.8 }}>
            {target && (
              <li>
                Your target color for this session is{' '}
                <strong
                  style={{
                    color: target === 'BLUE' ? '#1e40af' : '#ea580c',
                  }}
                >
                  {target}
                </strong>
                .
              </li>
            )}
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
              You will see your target color displayed steadily during
              the fetch, with a loading spinner. After the quantum
              data is retrieved, results appear instantly. The goal is
              to score over 50% as often as possible.
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
            Your Score: {pctLast}% ({lastBlock.k}/{lastBlock.n} HITs)
          </div>
        )}

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
        {/* Large target display */}
        <div
          style={{
            padding: 60,
            background: '#f9f9f9',
            borderRadius: 20,
            border: `4px solid ${targetColor}`,
            marginBottom: 40,
          }}
        >
          <p
            style={{
              fontSize: 24,
              fontWeight: 'bold',
              marginBottom: 20,
              color: '#666',
            }}
          >
            Your Target:
          </p>
          <div
            style={{ fontSize: 96, marginBottom: 10, lineHeight: 1 }}
          >
            {targetEmoji}
          </div>
          <div
            style={{
              fontSize: 48,
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
            marginBottom: 24,
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
          <p
            style={{ fontSize: 16, marginBottom: 20, color: '#555' }}
          >
            <strong>
              Bring your attention to your target color and form your
              intent before clicking the button.
            </strong>
          </p>
          <p>Click when ready.</p>
          <button
            onClick={() => {
              fetchTriggeredAtRef.current = new Date().toISOString();
              goToFetching();
            }}
            style={{
              padding: '16px 48px',
              fontSize: 20,
              fontWeight: 'bold',
              borderRadius: 8,
              border: 'none',
              background: '#10b981',
              color: '#fff',
              cursor: 'pointer',
              transition: 'transform 0.1s',
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
            I'm Ready
          </button>
        </div>

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
                await savePostSurvey(runRef, answers);
              }

              // No email — use UID-based counter in participants/{uid} (same-device only)
              if (!participantHash) {
                const newCount = sessionCount + 1;
                if (uid) {
                  try {
                    await setUidSessionCount(uid, newCount);
                  } catch (e) {
                    console.error(
                      'UID count update failed (non-blocking):',
                      e,
                    );
                  }
                }
                setSessionCount(newCount);
                goToPayment();
                return;
              }

              // Cumulative data already saved in results phase — just update session count and proceed
              setSessionCount(sessionCount + 1);
              goToPayment();
            } catch (e) {
              console.warn('Post survey save error:', e);
              goToPayment();
            }
          }}
        />
      </div>
    );
  }

  // PAYMENT - Provider-neutral session-completion screen (no payment integration yet)
  if (phase === 'payment') {
    // Prolific pays per submission and volunteers are not paid, so neither has
    // a balance or payout choice: go straight to the thank-you page (which
    // carries the return-to-Prolific link for Prolific participants).
    if (
      isAutoMode ||
      isAIMode ||
      recruitment.source === 'prolific' ||
      recruitment.source === 'volunteer'
    ) {
      goToSummary();
      return null;
    }

    return (
      <div style={{ position: 'relative' }}>
        <PaymentCompletionPage
          sessionsCompleted={sessionCount}
          totalSessions={C.TARGET_SESSIONS}
          amountPerSession={5}
          isProlific={getRecruitment().source === 'prolific'}
          onReturnLater={() => goToSummary()}
          onFinishAndRequestPayment={async () => {
            await recordPaymentRequest({
              participantHash,
              tremendousCode: recruitment.tremendousToken,
              sessionsCompleted: sessionCount,
            });
            setPaymentRequested(true);
            goToSummary();
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

    // Cumulative average across all completed sessions, including this one.
    const cumTrials = pastDemonTrials + totals.n;
    const cumSubjectHitRate =
      cumTrials > 0
        ? ((100 * (pastSubjectHits + totals.k)) / cumTrials).toFixed(
            1,
          )
        : '50.0';

    const sessionNumber = sessionCount + 1;
    const sessionsRemain = sessionNumber < C.TARGET_SESSIONS;

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
        <h1>Session Results</h1>

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
              : `Thank you for completing ${C.TARGET_SESSIONS} sessions`}
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
    const isProlificSummary = recruitment.source === 'prolific';
    const sessionsRemain =
      !paymentRequested && sessionCount < C.TARGET_SESSIONS;
    const completionUrl = prolificCompletionUrl(
      recruitment.wave ?? sessionCount,
      C.PROLIFIC_COMPLETION_CODES,
      C.PROLIFIC_COMPLETION_CODE_DEFAULT,
    );

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

        {isProlificSummary && (
          <div style={{ marginBottom: 24 }}>
            <p style={{ fontSize: 17, lineHeight: 1.6 }}>
              Please click the button below to return to Prolific, so
              that your session is recorded and you can be paid.
            </p>
            <a
              href={completionUrl}
              className="primary-btn"
              style={{
                display: 'inline-block',
                textDecoration: 'none',
                fontSize: '1.15rem',
                padding: '0.9rem 1.6rem',
              }}
            >
              Return to Prolific
            </a>
          </div>
        )}

        <div
          style={{
            textAlign: 'left',
            marginBottom: 32,
            padding: '20px',
            background: '#f8f9fa',
            borderRadius: 8,
          }}
        >
          <h3>
            {paymentRequested
              ? 'Payment requested'
              : isProlificSummary
                ? `Session ${sessionCount} of ${C.TARGET_SESSIONS} complete`
                : sessionsRemain
                ? `${sessionCount} Session${sessionCount !== 1 ? 's' : ''} Complete — ${C.TARGET_SESSIONS - sessionCount} more to go`
                : `All ${C.TARGET_SESSIONS} Sessions Complete`}
          </h3>
          <p>
            Thank you for participating in this research on temporal
            pattern influence.
            {paymentRequested &&
              ' Your payment request has been received. Your participation is now complete, and you will be paid for the sessions you completed.'}
          </p>

          <h4>Questions or Concerns</h4>
          <p>
            If you have any questions about this research, or would
            like to request a full debrief once the study closes,
            please contact the research team at{' '}
            <a href="mailto:a.campbell@lmu.de">a.campbell@lmu.de</a>
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
          <ul style={{ textAlign: 'left', marginTop: 0 }}>
            {sessionsRemain && !isProlificSummary && (
              <li>
                When you are ready for your next session, use the same
                link you used today.
              </li>
            )}
            <li>
              <a
                href="https://zenodo.org/records/18714884"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: '#3b82f6',
                  textDecoration: 'underline',
                }}
              >
                Read about the methodology behind Study 2.
              </a>
            </li>
          </ul>
        </div>
      </div>
    );
  }
}
