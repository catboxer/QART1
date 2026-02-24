// src/MainApp.jsx
import './App.css';
import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
} from 'react';
import { pkConfig as C } from './config.js';
import {
  zFromBinom,
  twoSidedP,
  cumulativeRange,
  hurstApprox,
  lag1Autocorr,
  shannonEntropy,
  computeSessionAnalysis,
  evaluatePrescreen,
} from './stats/index.js';
import { db, ensureSignedIn } from './firebase.js';
import {
  collection, doc, addDoc, setDoc, getDoc, getDocs, updateDoc, serverTimestamp,
} from 'firebase/firestore';
import { fetchQRNGBits } from './fetchQRNGBits.js';
import { runNISTAudit } from './nistTests.js';

import { preQuestions, postQuestions } from './questions.js';
import { QuestionsForm } from './Forms.jsx';
import { HurstDeltaGauge } from './Scoring.jsx';
import confetti from 'canvas-confetti';
import ConsentGate from './ui/ConsentGate.jsx';

// Runtime configuration validation
function validateConfig() {
  const errors = [];

  if (!C.VISUAL_HZ || C.VISUAL_HZ <= 0) errors.push('VISUAL_HZ must be positive');
  if (!C.BLOCKS_TOTAL || C.BLOCKS_TOTAL <= 0) errors.push('BLOCKS_TOTAL must be positive');
  if (!C.TRIALS_PER_BLOCK || C.TRIALS_PER_BLOCK <= 0) errors.push('TRIALS_PER_BLOCK must be positive');
  if (!C.BITS_PER_BLOCK || C.BITS_PER_BLOCK <= 0) errors.push('BITS_PER_BLOCK must be positive');
  if (C.PRIME_PROB < 0 || C.PRIME_PROB > 1) errors.push('PRIME_PROB must be between 0 and 1');
  if (!Array.isArray(C.TARGET_SIDES) || C.TARGET_SIDES.length === 0) errors.push('TARGET_SIDES must be non-empty array');

  // Cross-validation: Ensure config values are consistent
  if (C.BITS_PER_BLOCK !== 1 + 2 * C.TRIALS_PER_BLOCK) {
    errors.push(`BITS_PER_BLOCK must equal 1 + 2*TRIALS_PER_BLOCK (expected ${1 + 2 * C.TRIALS_PER_BLOCK}, got ${C.BITS_PER_BLOCK})`);
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed: ${errors.join(', ')}`);
  }
}

// Validate configuration on load
validateConfig();

// Note: All quantum bit fetching is now handled by fetchQRNGBits() function
// which includes cryptographic authentication and validation

// ===== main =====
export default function MainApp() {
  // Auto-mode for baseline data collection (activated via URL hash #auto)
  const isAutoMode = window.location.hash.includes('auto');
  // AI-mode for AI agent sessions (activated via URL hash #ai)
  const isAIMode = window.location.hash.includes('ai');
  const [autoSessionCount, setAutoSessionCount] = useState(0);
  const [autoSessionTarget, setAutoSessionTarget] = useState(isAIMode ? C.AI_MODE_SESSIONS : C.AUTO_MODE_SESSIONS);

  const [userReady, setUserReady] = useState(false);
  const [uid, setUid] = useState(null);

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

  // ---- returning participant (skip preQ on same device)
  const [preDone, setPreDone] = useState(() => {
    try { return localStorage.getItem(`pre_done_global:${C.EXPERIMENT_ID}`) === '1'; }
    catch { return false; }
  });
  const [checkedReturning, setCheckedReturning] = useState(false);  // ← add this



 
  // ---- sign-in (local-only returning check)
    useEffect(() => {
        (async () => {
         try {
             const u = await ensureSignedIn();
             setUid(u?.uid || null);
             // fast local skip for preQ if they've done it on this device
               try {
                   const globalKey = `pre_done_global:${C.EXPERIMENT_ID}`;
                   if (localStorage.getItem(globalKey) === '1') {
                       setPreDone(true);
                     }
                 } catch { }
           } finally {
             setUserReady(true);
             setCheckedReturning(true);
           }
          })();
      }, []);


  const requireUid = useCallback(async () => {
    const u = await ensureSignedIn();
    if (!u || !u.uid) throw new Error('auth/no-user: sign-in required before writing');
    return u.uid;
  }, []);

  // makeTape function removed - live streams only

  // prepareSessionArtifacts function removed - live streams only

  // Trials per block (from config)
  const trialsPerBlock = C.TRIALS_PER_BLOCK;

  // ---- run doc
  const [runRef, setRunRef] = useState(null);
  const ensureRunDocPromiseRef = useRef(null); // Prevent race conditions
  const isCreatingDocRef = useRef(false); // Immediate flag to prevent race conditions

  const ensureRunDoc = useCallback(async () => {
    if (runRef) {
      return runRef;
    }

    // If already creating, wait for the existing promise
    if (isCreatingDocRef.current || ensureRunDocPromiseRef.current) {
      return await ensureRunDocPromiseRef.current;
    }

    // Set flag immediately to block concurrent calls
    isCreatingDocRef.current = true;

    // Create new promise and store it IMMEDIATELY
    const createPromise = (async () => {
      try {
        if (!target) throw new Error('logic/order: target must be set before creating run');
        const uidNow = uid || (await requireUid());

        const col = collection(db, C.PRESCREEN_COLLECTION);
        const docData = {
          participant_id: uidNow,
          experimentId: C.EXPERIMENT_ID,
          createdAt: serverTimestamp(),
          blocks_planned: C.BLOCKS_TOTAL,
          timestamp: new Date().toISOString(),
          session_type: isAutoMode ? 'baseline' : isAIMode ? 'ai_agent' : 'human',
        };

        docData.exitedEarly = false;

        const docRef = await addDoc(col, docData);

        setRunRef(docRef);
        return docRef;
      } catch (error) {
        console.error('ensureRunDoc: error creating document', error);
        throw error;
      } finally {
        ensureRunDocPromiseRef.current = null; // Clear the promise
        isCreatingDocRef.current = false; // Clear the flag
      }
    })();

    // Store the promise immediately to block concurrent calls
    ensureRunDocPromiseRef.current = createPromise;

    const result = await createPromise;
    return result;
  }, [runRef, target, uid, requireUid, isAutoMode, isAIMode]);

  // ---- phase & per-minute state
  const [phase, setPhase] = useState('consent');
  const [blockIdx, setblockIdx] = useState(-1);
  const [isRunning, setIsRunning] = useState(false);
  const [lastBlock, setLastBlock] = useState(null);
  const [totals, setTotals] = useState({ k: 0, n: 0 });
  const [totalGhostHits, setTotalGhostHits] = useState(0);

  // Hurst delta tracking across blocks
  const [deltaHurstHistory, setDeltaHurstHistory] = useState([]);
  const [runningMeanDeltaH, setRunningMeanDeltaH] = useState(0);
  const [hurstSubjectHistory, setHurstSubjectHistory] = useState([]);
  const [hurstDemonHistory, setHurstDemonHistory] = useState([]);
  const [subjectBitsHistory, setSubjectBitsHistory] = useState([]);
  const [sessionAnalysis, setSessionAnalysis] = useState(null);
  const [inviteForm, setInviteForm] = useState({ firstName: '', lastName: '', location: '', age: '', email: '' });
  const [inviteSubmitted, setInviteSubmitted] = useState(false);
  const [inviteSubmitting, setInviteSubmitting] = useState(false);

  const bitsRef = useRef([]);
  const demonBitsRef = useRef([]);
  const alignedRef = useRef([]);
  const hitsRef = useRef(0);
  const demonHitsRef = useRef(0);
  const blockAuthRef = useRef(null); // Cryptographic authentication for current block's bitstream
  const auditAuthRef = useRef(null); // Cryptographic authentication for audit bitstream
  const blockIdxToPersist = useRef(-1); // Stores the correct blockIdx to save

  // Process trials with randomized half assignment (subject/demon)
  const processTrials = useCallback((quantumBits) => {
    if (quantumBits.length !== C.BITS_PER_BLOCK) {
      throw new Error(`Expected ${C.BITS_PER_BLOCK} bits, got ${quantumBits.length}`);
    }

    // Clear previous block data
    bitsRef.current = [];
    demonBitsRef.current = [];
    alignedRef.current = [];
    hitsRef.current = 0;
    demonHitsRef.current = 0;

    const targetBit = target === 'BLUE' ? 1 : 0;

    // Use first bit (bit 0) to decide assignment (QRNG-based, not Math.random())
    const assignmentBit = parseInt(quantumBits[0], 10);
    const subjectGetsFirstHalf = assignmentBit === 1;

    // Split remaining bits (after assignment bit) into two halves for trials
    const n = C.TRIALS_PER_BLOCK;
    const halfA = quantumBits.slice(1, 1 + n);    // bits 1 to (1+n)
    const halfB = quantumBits.slice(1 + n, 1 + 2*n);  // bits (1+n) to (1+2n)

    const subjectBits = subjectGetsFirstHalf ? halfA : halfB;
    const demonBits = subjectGetsFirstHalf ? halfB : halfA;

    // Process subject bits
    const parsedSubjectBits = [];
    for (let i = 0; i < n; i++) {
      const bit = parseInt(subjectBits[i], 10);
      parsedSubjectBits.push(bit);
      bitsRef.current.push(bit);
      alignedRef.current.push(bit === targetBit ? 1 : 0);
      if (bit === targetBit) hitsRef.current++;
    }

    // Process demon bits
    for (let i = 0; i < n; i++) {
      const bit = parseInt(demonBits[i], 10);
      demonBitsRef.current.push(bit);
      if (bit === targetBit) demonHitsRef.current++;
    }

    // Calculate stats
    const k = hitsRef.current;
    const kd = demonHitsRef.current;
    const z = zFromBinom(k, n, 0.5);
    const zd = zFromBinom(kd, n, 0.5);
    const pTwo = twoSidedP(z);
    const pd = twoSidedP(zd);

    // Compute Hurst delta for this block (ΔH = H_subject − H_PCS)
    const blockSubjHurst = hurstApprox(bitsRef.current);
    const blockPCSHurst = hurstApprox(demonBitsRef.current);
    const blockDeltaH = blockSubjHurst - blockPCSHurst;

    const blockSummary = {
      k, n, z, pTwo,
      kd, nd: n, zd, pd,
      kind: 'instant',
      subjectHurst: blockSubjHurst,
      pcsHurst: blockPCSHurst,
      deltaH: blockDeltaH,
    };

    setLastBlock(blockSummary);
    setTotals(t => ({ k: t.k + k, n: t.n + n }));
    setTotalGhostHits(t => t + kd);
    setDeltaHurstHistory(prev => {
      const next = [...prev, blockDeltaH];
      setRunningMeanDeltaH(next.reduce((a, b) => a + b, 0) / next.length);
      return next;
    });
    setHurstSubjectHistory(prev => [...prev, blockSubjHurst]);
    setHurstDemonHistory(prev => [...prev, blockPCSHurst]);
    setSubjectBitsHistory(prev => [...prev, parsedSubjectBits]);

    // Increment block index
    setblockIdx(prev => prev + 1);

    // Note: persistMinute will be called after this via a useEffect watching blockIdx

  }, [target]);

  // Save session-level aggregates for fast QA dashboard loading
  const saveSessionAggregates = useCallback(async () => {
    if (!runRef) return;

    try {
      const hitRate = totals.n > 0 ? totals.k / totals.n : 0.5;
      const ghostHitRate = totals.n > 0 ? totalGhostHits / totals.n : 0.5;

      const meanDH = deltaHurstHistory.length > 0
        ? deltaHurstHistory.reduce((a, b) => a + b, 0) / deltaHurstHistory.length
        : 0;

      await setDoc(runRef, {
        aggregates: {
          totalHits: totals.k,
          totalTrials: totals.n,
          totalGhostHits: totalGhostHits,
          hitRate: hitRate,
          ghostHitRate: ghostHitRate,
          blocksCompleted: deltaHurstHistory.length,
          blocksPlanned: C.BLOCKS_TOTAL,
          sessionComplete: deltaHurstHistory.length >= C.BLOCKS_TOTAL,
          lastUpdated: new Date().toISOString(),
          hurstDelta: {
            mean: meanDH,
            blockDeltas: deltaHurstHistory,
          }
        }
      }, { merge: true });

      console.log('✅ Session aggregates saved:', runRef.id, { hitRate, ghostHitRate, blocks: deltaHurstHistory.length });
    } catch (error) {
      console.error('❌ Failed to save session aggregates:', error);
    }
  }, [runRef, totals, totalGhostHits, deltaHurstHistory]);

  // Calculate and save session-level temporal entropy (k=2 and k=3 windows)
  const calculateSessionTemporalEntropy = useCallback(async () => {
    if (!runRef) return;

    try {
      const allSubjectBits = [];
      const allGhostBits = [];

      // Fetch all minutes to get their indices
      const minutesSnapshot = await getDocs(collection(runRef, 'minutes'));
      const sortedMinutes = minutesSnapshot.docs
        .map(d => ({ id: d.id, ref: d.ref, data: d.data(), idx: d.data().idx || 0 }))
        .sort((a, b) => a.idx - b.idx);

      // For each minute, read trial_data arrays directly from minute docs
      for (const minute of sortedMinutes) {
        const minuteData = minute.data;

        // Extract bits from trial_data arrays stored in each minute doc
        if (minuteData.trial_data?.subject_bits && minuteData.trial_data?.demon_bits) {
          allSubjectBits.push(...minuteData.trial_data.subject_bits);
          allGhostBits.push(...minuteData.trial_data.demon_bits);
        }
      }

      const n = allSubjectBits.length;

      if (n === 0) {
        console.warn('No subject bits found for session-level entropy calculation');
        return;
      }

      // NEW: Aggregate block-level entropy trajectories for H(t) fitting
      const allBlockEntropySubj = [];
      const allBlockEntropyGhost = [];

      // Fetch block-level entropy from each minute
      for (const minute of sortedMinutes) {
        const minuteDoc = await getDoc(minute.ref);
        const minuteData = minuteDoc.data();

        if (minuteData?.entropy?.block_entropy_subj !== undefined) {
          allBlockEntropySubj.push({
            blockIdx: minuteData.entropy.block_idx,
            entropy: minuteData.entropy.block_entropy_subj,
            timestamp: minuteData.entropy.block_timestamp || minuteData.timing?.block_start_time
          });
        }

        if (minuteData?.entropy?.block_entropy_ghost !== undefined) {
          allBlockEntropyGhost.push({
            blockIdx: minuteData.entropy.block_idx,
            entropy: minuteData.entropy.block_entropy_ghost,
            timestamp: minuteData.entropy.block_timestamp || minuteData.timing?.block_start_time
          });
        }
      }


      // Minimum window size: one full block's worth of bits (576).
      // k=2 fires for early exits before block 2; k=3 before block 3.
      const MIN_WINDOW_SIZE = C.TRIALS_PER_BLOCK;

      // k=2: split into first/second half (each = n/2 bits)
      const half = Math.floor(n / 2);
      if (half < MIN_WINDOW_SIZE) {
        console.warn(`Insufficient bits for k=2 temporal entropy: ${n} bits (need ${MIN_WINDOW_SIZE * 2}+ for meaningful windows)`);
        return;
      }
      const entropy_k2 = [
        shannonEntropy(allSubjectBits.slice(0, half)),
        shannonEntropy(allSubjectBits.slice(half, n))
      ];
      const ghost_entropy_k2 = [
        shannonEntropy(allGhostBits.slice(0, half)),
        shannonEntropy(allGhostBits.slice(half, n))
      ];

      // k=3: split into thirds (each = n/3 bits)
      const third = Math.floor(n / 3);
      if (third < MIN_WINDOW_SIZE) {
        console.warn(`Insufficient bits for k=3 temporal entropy: ${n} bits (need ${MIN_WINDOW_SIZE * 3}+ for meaningful windows)`);
        return;
      }
      const entropy_k3 = [
        shannonEntropy(allSubjectBits.slice(0, third)),
        shannonEntropy(allSubjectBits.slice(third, 2 * third)),
        shannonEntropy(allSubjectBits.slice(2 * third, n))
      ];
      const ghost_entropy_k3 = [
        shannonEntropy(allGhostBits.slice(0, third)),
        shannonEntropy(allGhostBits.slice(third, 2 * third)),
        shannonEntropy(allGhostBits.slice(2 * third, n))
      ];


      // Save to session document
      await setDoc(runRef, {
        entropy: {
          temporal: {
            subj_bits_count: n,
            entropy_k2: entropy_k2,
            entropy_k3: entropy_k3,
            ghost_entropy_k2: ghost_entropy_k2,
            ghost_entropy_k3: ghost_entropy_k3,
          },
          temporal_trajectories: {
            block_level_subj: allBlockEntropySubj,
            block_level_ghost: allBlockEntropyGhost,
            // This enables H_subject(t) and H_ghost(t) fitting for thermalization analysis
          }
        }
      }, { merge: true });

      // Reset all accumulators to prevent bleed into next session
      bitsRef.current = [];
      demonBitsRef.current = [];
      alignedRef.current = [];
    } catch (error) {
      console.error('Error calculating session temporal entropy:', error);
    }
  }, [runRef]);

  // Fetch subject+demon tape when entering fetching phase, then process trials
  const [needsPersist, setNeedsPersist] = useState(false);

  useEffect(() => {
    if (phase !== 'fetching') return;
    // Guard: Don't fetch if we've already completed all blocks
    if (blockIdx >= C.BLOCKS_TOTAL) {
      setPhase('results');
      return;
    }

    let isCancelled = false;

    (async () => {
      try {
        // Fetch quantum bits (1153 bits: 1 assignment + 576 subject + 576 demon)
        const quantumData = await fetchQRNGBits(C.BITS_PER_BLOCK);

        if (isCancelled) return;

        // Check if we just completed the final block BEFORE processing
        // blockIdx in closure is the value BEFORE processTrials increments it
        const justCompletedBlockIdx = blockIdx;
        const nextBlockIdx = justCompletedBlockIdx + 1;

        // Store the current blockIdx before it gets incremented (this is what persistMinute should use)
        blockIdxToPersist.current = blockIdx;

        // Store authentication data for this block
        blockAuthRef.current = {
          hash: quantumData.hash,
          timestamp: quantumData.timestamp,
          source: quantumData.source,
          bitCount: quantumData.bits.length
        };

        // ANTI-TIMING-ATTACK: Save raw bits to Firestore BEFORE processing
        // This prevents AI agents from aborting after peeking at bits but before persistence
        // If agent aborts here, we'll have the bits and can detect strategic abandonment
        if (runRef) {
          const blockCommitDoc = doc(runRef, 'block_commits', String(blockIdx));
          await setDoc(blockCommitDoc, {
            blockIdx: blockIdx,
            bits: quantumData.bits,
            auth: {
              hash: quantumData.hash,
              timestamp: quantumData.timestamp,
              source: quantumData.source,
              bitCount: quantumData.bits.length
            },
            committedAt: serverTimestamp(),
            clientCommitTime: new Date().toISOString(),
            target: target
          });
        }

        // Process all trials instantly (this increments blockIdx from blockIdx to blockIdx+1)
        processTrials(quantumData.bits);

        // Always persist (we need all 40 blocks saved, idx 0-39)
        setNeedsPersist(true);

        // Always go to score phase first to show results
        setPhase('score');

        // If this was the final block, calculate session entropy in background
        if (nextBlockIdx >= C.BLOCKS_TOTAL) {
          calculateSessionTemporalEntropy().catch(err =>
            console.error('Failed to calculate final entropy:', err)
          );
        }

      } catch (error) {
        console.error('❌ Failed to fetch bits:', error);

        // Capture detailed error information
        const errorDetails = {
          message: error.message || String(error),
          stack: error.stack,
          timestamp: new Date().toISOString(),
        };
        console.error('📋 Error details:', errorDetails);

        if (!isCancelled) {
          if (isAutoMode || isAIMode) {
            // Auto/AI mode: exit early without completing session (no alert popup)
            // Mark as early exit and go to results
            if (runRef) {
              await updateDoc(runRef, {
                exitedEarly: true,
                exit_reason: 'qrng_unavailable',
                exit_error_details: errorDetails,
                exit_block_index: blockIdx
              });
            }
            setPhase('results');
          } else {
            // Human mode: show alert and exit gracefully
            alert('We ran out of QRNG data for today. Your progress has been saved. Please schedule a session with us or try again tomorrow.');
            // Save and exit
            if (runRef) {
              await updateDoc(runRef, {
                exitedEarly: true,
                exit_reason: 'qrng_unavailable',
                exit_error_details: errorDetails,
                exit_block_index: blockIdx
              });
            }
            setPhase('results');
          }
        }
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [phase, blockIdx, processTrials, calculateSessionTemporalEntropy, isAutoMode, isAIMode, runRef, target]);

  // Audit phase: Fetch audit bits in background and randomize target
  useEffect(() => {
    if (phase !== 'audit') return;

    let isCancelled = false;

    (async () => {
      try {
        // Fetch audit bits (no validation needed during fetch, we'll validate after)
        const auditData = await fetchQRNGBits(C.AUDIT_BITS_PER_BREAK, 3, false);

        if (isCancelled) return;

        // Store authentication data for audit
        auditAuthRef.current = {
          hash: auditData.hash,
          timestamp: auditData.timestamp,
          source: auditData.source,
          bitCount: auditData.bits.length
        };

        // Run NIST SP 800-22 randomness tests
        const nistResults = runNISTAudit(auditData.bits);

        const isRandom = nistResults.allTestsPass;

        // Extract summary stats for backwards compatibility
        const ones = auditData.bits.split('').filter(b => b === '1').length;
        const proportion = ones / C.AUDIT_BITS_PER_BREAK;

        const validationStats = {
          // NIST test results
          nist: {
            allPass: nistResults.allTestsPass,
            frequency: {
              pValue: nistResults.tests.frequency.pValue,
              pass: nistResults.tests.frequency.pass
            },
            runs: {
              pValue: nistResults.tests.runs.pValue,
              pass: nistResults.tests.runs.pass,
              observed: nistResults.tests.runs.runsObserved
            },
            longestRun: {
              pValue: nistResults.tests.longestRun.pValue,
              pass: nistResults.tests.longestRun.pass,
              chiSquared: nistResults.tests.longestRun.statistic,
              df: nistResults.tests.longestRun.degreesOfFreedom
            }
          },
          // Basic stats
          length: auditData.bits.length,
          ones,
          onesRatio: (ones / auditData.bits.length).toFixed(4),
          reference: nistResults.reference
        };

        // Calculate audit entropy
        const auditBitArray = auditData.bits.split('').map(b => parseInt(b));
        const auditEntropy = shannonEntropy(auditBitArray);

        // Save audit to Firebase with authentication data
        if (runRef) {
          const auditDoc = doc(runRef, 'audits', `after_block_${blockIdx}`);
          await setDoc(auditDoc, {
            blockAfter: blockIdx,
            totalBits: C.AUDIT_BITS_PER_BREAK,
            auditBits: auditData.bits, // Store the actual bit string for QA analysis
            ones,
            proportion,
            entropy: auditEntropy,
            isRandom,
            validation: validationStats,
            timestamp: Date.now(),
            // Cryptographic authentication
            auth: {
              hash: auditData.hash,
              timestamp: auditData.timestamp,
              source: auditData.source
            }
          });
        }

        // Randomize target for next set of blocks
        const randomByte = crypto.getRandomValues(new Uint8Array(1))[0];
        const randomBit = randomByte & 1;
        const newTarget = randomBit ? 'BLUE' : 'ORANGE';

        setTarget(newTarget);

      } catch (error) {
        console.error('❌ Audit failed:', error);
        // Don't block progression on audit failure
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [phase, blockIdx, runRef]); // Removed 'target' to prevent infinite loop when target is randomized

  // Auto-mode and AI-mode: Skip consent/questions, auto-restart, and auto-continue rest screens
  useEffect(() => {
    if (!isAutoMode && !isAIMode) return;

    // Auto-mode: skip all screens
    // AI-mode: skip consent/pre_questions/info, but SHOW prime (research background)
    if (phase === 'consent' || phase === 'pre_questions' || phase === 'info' || phase === 'prime' || phase === 'preQ') {
      setPhase('onboarding');
    } else if (phase === 'score' && isAutoMode) {
      // Auto-continue score screens in auto-mode
      const timer = setTimeout(() => {
        // Check if session is complete (all 40 blocks done)
        if (blockIdx >= C.BLOCKS_TOTAL) {
          setPhase('results');
        } else {
          // Check if audit is needed based on the just-completed block (not the incremented blockIdx)
          const completedBlockIdx = blockIdxToPersist.current;
          const needsAudit = completedBlockIdx >= 0 && (completedBlockIdx + 1) % C.AUDIT_EVERY_N_BLOCKS === 0 && blockIdx < C.BLOCKS_TOTAL;
          setPhase(needsAudit ? 'audit' : 'target_announce');
        }
      }, C.AUTO_MODE_REST_MS);
      return () => clearTimeout(timer);
    } else if ((phase === 'rest' || phase === 'target_announce') && isAutoMode) {
      // Auto-continue rest/target_announce screens in auto-mode
      const timer = setTimeout(() => {
        setPhase('fetching'); // Go to fetching phase instead of old startNextMinute
      }, C.AUTO_MODE_REST_MS);
      return () => clearTimeout(timer);
    } else if (phase === 'audit' && isAutoMode) {
      // Auto-continue audit screens in auto-mode
      const timer = setTimeout(() => {
        setPhase('target_announce');
      }, C.AUTO_MODE_REST_MS);
      return () => clearTimeout(timer);
    } else if (phase === 'results') {
      // Mark session as completed and advance (skip results/postQ/summary in auto/AI mode)
      if (runRef) {
        Promise.all([
          saveSessionAggregates(),
          setDoc(runRef, { completed: true }, { merge: true })
        ])
          .then(() => setPhase('next'))
          .catch(() => setPhase('next'));
      } else {
        setPhase('next');
      }
    } else if (phase === 'done' || phase === 'summary') {
      // Skip post-questionnaire and summary in auto/AI mode
      setPhase('next');
    } else if (phase === 'next') {
      // Immediately transition to avoid re-triggering
      const newCount = autoSessionCount + 1;

      if (newCount < autoSessionTarget) {
        // Reset for next session
        setAutoSessionCount(newCount);
        setPhase('preparing_next');
      } else {
        setAutoSessionCount(newCount); // Update count before showing completion
        setPhase(isAIMode ? 'ai_complete' : 'auto_complete');
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
        setRunningMeanDeltaH(0);
        setHurstSubjectHistory([]);
        setHurstDemonHistory([]);
        setSubjectBitsHistory([]);
        setSessionAnalysis(null);

        // Reset target flag so new target gets assigned
        targetAssignedRef.current = false;
        setTarget(null);

        setPhase('onboarding');
      }, 100);
    }
    // Note: blockIdxToPersist is a ref, not a state, so it doesn't need to be in dependencies
  }, [isAutoMode, isAIMode, phase, blockIdx, autoSessionCount, autoSessionTarget, runRef, saveSessionAggregates]);

  // Note: Buffer management functions removed - no longer needed with instant trial processing
  const minuteInvalidRef = useRef(false);
  const endMinuteRef = useRef(() => { });

  // --- persist & end-minute (persist must be defined BEFORE endMinute) ---
  const persistMinute = useCallback(async () => {
    if (!runRef) return;

    // Use the captured blockIdx (before increment) instead of current blockIdx
    const saveBlockIdx = blockIdxToPersist.current;

    if (saveBlockIdx < 0 || saveBlockIdx >= C.BLOCKS_TOTAL) {
      return;
    }

    const n = C.TRIALS_PER_BLOCK;
    const k = hitsRef.current;
    const kd = demonHitsRef.current;

    const z = zFromBinom(k, n, 0.5);
    const pTwo = twoSidedP(z);
    const zd = zFromBinom(kd, n, 0.5);
    const pd = twoSidedP(zd);

    // Subject metrics
    const cohRange = cumulativeRange(bitsRef.current);
    const hurst = hurstApprox(bitsRef.current);
    const ac1 = lag1Autocorr(bitsRef.current);

    // Demon metrics
    const dCohRange = cumulativeRange(demonBitsRef.current);
    const dHurst = hurstApprox(demonBitsRef.current);
    const dAc1 = lag1Autocorr(demonBitsRef.current);

    // Block-level entropy (n bits per block)
    const blockSubjEntropy = bitsRef.current.length > 0 ? shannonEntropy(bitsRef.current) : null;
    const blockDemonEntropy = demonBitsRef.current.length > 0 ? shannonEntropy(demonBitsRef.current) : null;

    // Block-level k2 split
    const half = Math.floor(n / 2);
    const blockK2Subj = [
      shannonEntropy(bitsRef.current.slice(0, half)),
      shannonEntropy(bitsRef.current.slice(half))
    ];
    const blockK2Demon = [
      shannonEntropy(demonBitsRef.current.slice(0, half)),
      shannonEntropy(demonBitsRef.current.slice(half))
    ];

    // Block-level k3 split
    const third = Math.floor(n / 3);
    const blockK3Subj = [
      shannonEntropy(bitsRef.current.slice(0, third)),
      shannonEntropy(bitsRef.current.slice(third, 2 * third)),
      shannonEntropy(bitsRef.current.slice(2 * third))
    ];
    const blockK3Demon = [
      shannonEntropy(demonBitsRef.current.slice(0, third)),
      shannonEntropy(demonBitsRef.current.slice(third, 2 * third)),
      shannonEntropy(demonBitsRef.current.slice(2 * third))
    ];

    const mdoc = doc(runRef, 'minutes', String(saveBlockIdx));

    const targetBit = target === 'BLUE' ? 1 : 0;

    await setDoc(mdoc, {
      idx: saveBlockIdx,
      kind: 'instant',
      ended_by: 'instant_process',
      startedAt: serverTimestamp(),

      // Subject data
      n, hits: k, z, pTwo,
      coherence: { cumRange: cohRange, hurst },
      resonance: { ac1 },

      // Demon data
      demon_hits: kd, demon_z: zd, demon_pTwo: pd,
      demon_metrics: {
        coherence: { cumRange: dCohRange, hurst: dHurst },
        resonance: { ac1: dAc1 }
      },

      // Entropy
      entropy: {
        block_entropy_subj: blockSubjEntropy,
        block_entropy_demon: blockDemonEntropy,
        block_k2_subj: blockK2Subj,
        block_k2_demon: blockK2Demon,
        block_k3_subj: blockK3Subj,
        block_k3_demon: blockK3Demon,
        bits_count: n
      },

      // Store bit sequences
      trial_data: {
        subject_bits: bitsRef.current,
        demon_bits: demonBitsRef.current,
        target_bit: targetBit,
        trial_count: n
      },

      // Hurst delta for this block
      hurst_delta: {
        subject: hurst,
        pcs: dHurst,
        delta: hurst - dHurst,
      },

      // Cryptographic authentication of quantum bitstream
      auth: blockAuthRef.current ? {
        hash: blockAuthRef.current.hash,
        timestamp: blockAuthRef.current.timestamp,
        source: blockAuthRef.current.source,
        bitCount: blockAuthRef.current.bitCount
      } : null
    }, { merge: true });
  }, [runRef, target]);

  const endMinute = useCallback(async () => {
    setIsRunning(false);
    await persistMinute();
    if (minuteInvalidRef.current) { setPhase('rest'); return; }
    // Always go to rest phase first, even for the final block
    setPhase('rest');
  }, [persistMinute]);

  useEffect(() => {
    endMinuteRef.current = endMinute;
  }, [endMinute]);

  // Save block data after processing (must be after persistMinute is defined)
  useEffect(() => {
    if (!needsPersist || !runRef) return;

    Promise.all([
      persistMinute(),
      saveSessionAggregates() // Update aggregates after each block
    ])
      .then(() => {
        setNeedsPersist(false);
      })
      .catch(err => {
        console.error('❌ Failed to save block data:', err);
        setNeedsPersist(false);
      });
  }, [needsPersist, runRef, persistMinute, saveSessionAggregates]);

  // Note: Trial processing is now handled instantly by processTrials() function
  // No tick loop needed since all trials are processed at once





  // Fire confetti on summary screen when subject is invite-eligible (gold or silver)
  useEffect(() => {
    if (phase !== 'summary' || !sessionAnalysis) return;
    const { eligible } = evaluatePrescreen(sessionAnalysis, C);
    if (!eligible) return;
    // Gold confetti burst
    confetti({ particleCount: 120, spread: 80, colors: ['#f59e0b', '#fcd34d', '#fbbf24', '#d97706', '#fff'], origin: { y: 0.5 } });
    setTimeout(() => confetti({ particleCount: 60, spread: 55, angle: 60,  colors: ['#f59e0b', '#fcd34d', '#fff'], origin: { x: 0, y: 0.6 } }), 300);
    setTimeout(() => confetti({ particleCount: 60, spread: 55, angle: 120, colors: ['#f59e0b', '#fcd34d', '#fff'], origin: { x: 1, y: 0.6 } }), 300);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Note: Exit functionality removed - sessions complete automatically or handle early exits in useEffect

  // Ensure document is created early in onboarding phase
  useEffect(() => {
    if (phase === 'onboarding' && !runRef && target) {
      ensureRunDoc().catch(console.error);
    }
  }, [phase, runRef, target, ensureRunDoc]);

  // Compute session analysis once when entering results phase (200-shuffle permutation test)
  useEffect(() => {
    if (phase !== 'results') return;
    if (sessionAnalysis) return; // already computed
    if (hurstSubjectHistory.length === 0) return;
    if (subjectBitsHistory.length !== hurstSubjectHistory.length) {
      console.warn('[prescreen] lockstep mismatch — subjectBitsHistory:', subjectBitsHistory.length, 'hurstSubjectHistory:', hurstSubjectHistory.length);
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
  }, [phase, sessionAnalysis, subjectBitsHistory, hurstSubjectHistory, hurstDemonHistory, totalGhostHits, totals.n]);

  // Save rank to session document once sessionAnalysis is ready
  useEffect(() => {
    if (!sessionAnalysis || !runRef) return;
    const { rank: rawRank, ksGate, collapseGate, pcsWarning, eligible, intensityTier } = evaluatePrescreen(sessionAnalysis, C);
    const sessionKind = isAutoMode ? 'baseline' : isAIMode ? 'ai' : 'human';
    const rank = `${rawRank}-${sessionKind}`; // e.g. 'gold-human', 'none-baseline', 'silver-ai'
    const pcs = sessionAnalysis.pcs;
    setDoc(runRef, {
      prescreen_rank:            rank,
      prescreen_eligible:        eligible,
      prescreen_ks_p:            sessionAnalysis.ks.originalP,
      prescreen_ks_gate:         ksGate,
      prescreen_collapse_p:      sessionAnalysis.shuffle.collapseP,
      prescreen_ddrop:           sessionAnalysis.shuffle.dDrop,
      prescreen_collapse_gate:   collapseGate,
      prescreen_intensity_tier:  intensityTier ?? 'none',
      prescreen_pcs_warning:     pcsWarning,
      prescreen_pcs_nullz:       pcs.nullZ,
      prescreen_pcs_ghostz:      pcs.ghostZ,
      prescreen_pcs_sdratio:     pcs.sdRatio,
      prescreen_pcs_crosscorr:   pcs.crossCorr,
    }, { merge: true }).catch(console.error);
  }, [sessionAnalysis, runRef]); // eslint-disable-line react-hooks/exhaustive-deps

  // ===== flow gates =====
  if (!userReady || !target || !checkedReturning) {
    return (
      <div style={{ padding: 24 }}>
        Loading…
      </div>
    );
  }

  // In MainApp.jsx, replace the ConsentGate section with:

  // CONSENT - Skip for auto/AI modes
  if (phase === 'consent') {
    // Auto and AI modes skip consent and questions
    if (isAutoMode || isAIMode) {
      setPhase('onboarding');
      return null;
    }

    return (
      <div style={{ position: 'relative' }}>
        <ConsentGate
          title="Pre-Screening: Potential Participant Qualification"
          studyDescription="You are participating in a pre-screening session to determine eligibility for a future research study (Experiment 5). This session identifies individuals who show high resonance with quantum random systems. You will complete 40 blocks each ~3 seconds long and brief questionnaires (approximately 5 minutes total)."
          bullets={[
            'You will receive a target color assignment (blue or orange)',
            'Your task is to get your target color above 50%. Concentrate your attention on your target color right before and during the moment quantum data is fetched from a quantum random number generator.',
            'When focused and ready, press "I\'m Ready" and keep focusing as your color pulses. This triggers the quantum random number generator and the sigantures in the QRNG during your focused intention is what we\'re testing.',
            'We collect data on quantum random sequences, your performance metrics, timing patterns, and your questionnaire responses.',
            'Participation is completely voluntary; you may exit at any time.',
            'All data is stored anonymously and securely for research purposes.',
            'Data will be retained indefinitely to enable scientific replication and analysis.',
            'Hosting providers may log IP addresses for security purposes, but these are not linked to your study data.',
          ]}
          onAgree={() => {
            // Double-check localStorage before deciding
            let localPreDone = false;
            try {
              localPreDone = localStorage.getItem(`pre_done_global:${C.EXPERIMENT_ID}`) === '1';
            } catch {}

            const shouldSkipPre = preDone || localPreDone;
            setPhase(shouldSkipPre ? 'onboarding' : 'preQ');
          }}
        />
      </div>
    );
  }

  // PRE QUESTIONS - Skip for auto/AI modes
  if (phase === 'preQ') {
    // Auto and AI modes skip questions
    if (isAutoMode || isAIMode) {
      setPhase('onboarding');
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
            setPhase('onboarding');
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
                localStorage.setItem(`pre_done:${C.EXPERIMENT_ID}:${uidNow}`, '1');
                localStorage.setItem(`pre_done_global:${C.EXPERIMENT_ID}`, '1');
              }
              setPreDone(true);
            } catch (e) {
              console.warn('Pre survey save error (non-blocking):', e);
              console.warn('Debug info:', {
                uid: uid,
                runRefId: runRef?.id,
                userReady: userReady,
                errorCode: e?.code,
                errorMessage: e?.message
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
      // Auto-start when runRef is ready OR when target is assigned (for subsequent sessions)
      if ((canContinue || target) && !isRunning) {
        ensureRunDoc().then(() => {
          setblockIdx(0); // Initialize to 0 for first block
          setPhase('rest');
        }); // Go to rest, then auto-mode will trigger fetching
      }

      const isComplete = autoSessionCount >= autoSessionTarget;

      return (
        <div style={{ padding: 24, maxWidth: 760 }}>
          <h1>🤖 Auto-Mode Baseline Collection</h1>

          {autoSessionCount === 0 && (
            <div style={{ marginBottom: 20, padding: 20, background: '#f0f0f0', borderRadius: 8 }}>
              <label style={{ display: 'block', marginBottom: 5, fontWeight: 'bold' }}>
                Number of sessions to run:
              </label>
              <input
                type="number"
                value={autoSessionTarget}
                onChange={(e) => setAutoSessionTarget(Math.max(1, parseInt(e.target.value) || 1))}
                min="1"
                max="1000"
                style={{ padding: '8px', width: '100px', marginRight: 10 }}
              />
              <span style={{ fontSize: 12, color: '#666' }}>
                (Each session = {C.BLOCKS_TOTAL} blocks)
              </span>
            </div>
          )}

          <p style={{ fontSize: 18, marginTop: 20 }}>
            Sessions: <strong>{autoSessionCount} / {autoSessionTarget}</strong>
          </p>

          {isComplete ? (
            <p style={{ color: '#1a8f1a', fontWeight: 'bold', marginTop: 10 }}>
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

    // AI mode - auto-initialize runRef to enable Continue button (but still require AI to click it)
    if (isAIMode && !canContinue && !isRunning && target && uid) {
      ensureRunDoc().catch(err => {
        console.error('❌ AI-MODE: Failed to initialize runRef:', err);
      });
    }

    return (
      <div style={{ padding: 24, maxWidth: 760, position: 'relative' }}>
        <h1>{isAIMode ? '🤖 AI Agent Mode' : 'Assessing Randomness Suppression During Conscious Intention Tasks — Pilot Study'}</h1>

        <div style={{ marginBottom: 30, marginTop: 30 }}>
          <h3 style={{ color: '#2c3e50', marginBottom: 15 }}>What to Expect:</h3>
          <ul style={{ fontSize: 16, lineHeight: 1.8 }}>
            <li>You'll complete {C.BLOCKS_TOTAL} short blocks with breaks between each. <b>Before </b>each block begins, take a moment to settle and direct your attention toward your chosen target color. This focus should begin just before you start the block and continue through the fetch period.</li>
            <li><strong>Critical moment:</strong> Immediately before and as you click <em>"I'm Ready"</em>, the system will retrieve quantum random data while your target color pulses on the screen. <strong>This is the period to sustain clear, steady focus on your target color. Focus your intention before and during your click of the I'm Ready button.</strong></li>

            <li>You will see your target color flashing during the fetch. After the quantum data is retrieved, results appear instantly. The goal is to score over 50% as often as possible.</li>
            <li>During breaks take a moment to breathe and clear your mind.</li>
          </ul>
        </div>

        {/* Continue button */}
        <div style={{ textAlign: 'center', marginTop: 40 }}>
          <button
            onClick={() => {
              if (canContinue && !isRunning) {
                ensureRunDoc().then(() => {
                  setblockIdx(0);
                  setPhase('rest');
                }).catch(err => {
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
              boxShadow: canContinue ? '0 4px 6px rgba(0,0,0,0.1)' : 'none'
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
    const pctLast = lastBlock && lastBlock.n ? Math.round((100 * lastBlock.k) / lastBlock.n) : 0;
    // Use the just-completed block index (the one that was saved, not the incremented one)
    const completedBlockIdx = blockIdxToPersist.current;
    const completedBlockNum = completedBlockIdx + 1; // Human-readable (1-30)
    // Show audit after blocks 5, 10, 15, 20, 25 (when completed block is 4, 9, 14, 19, 24 in 0-indexed)
    const needsAudit = completedBlockIdx >= 0 && (completedBlockIdx + 1) % C.AUDIT_EVERY_N_BLOCKS === 0 && blockIdx < C.BLOCKS_TOTAL;
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
        needsAudit
      };
    }

    const sessionPct = totals.n > 0 ? (100 * totals.k / totals.n).toFixed(1) : '50.0';
    const blockColor = pctLast > 50 ? '#15803d' : pctLast < 50 ? '#b45309' : '#6b7280';
    const blockBg    = pctLast > 50 ? '#dcfce7'  : pctLast < 50 ? '#fff7ed'  : '#f3f4f6';
    const blockBorder= pctLast > 50 ? '#86efac'  : pctLast < 50 ? '#fed7aa'  : '#e5e7eb';

    return (
      <div style={{ padding: 24, textAlign: 'center', maxWidth: 600, margin: '0 auto' }}>
        <h2 style={{ marginBottom: 20 }}>Block {completedBlockNum} of {C.BLOCKS_TOTAL}</h2>

        {/* Hero: block hit score */}
        <div style={{ padding: '24px 32px', borderRadius: 16, background: blockBg, border: `2px solid ${blockBorder}`, marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: '#6b7280', letterSpacing: '0.06em', marginBottom: 4 }}>THIS BLOCK</div>
          <div style={{ fontSize: 72, fontWeight: 900, color: blockColor, lineHeight: 1, marginBottom: 4 }}>
            {pctLast}%
          </div>
          <div style={{ fontSize: 13, color: '#6b7280' }}>
            {lastBlock?.k ?? 0} hits · target &gt; 50%
          </div>
        </div>

        {/* Session running total */}
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>
          Session average: <strong style={{ color: parseFloat(sessionPct) > 50 ? '#15803d' : '#6b7280' }}>{sessionPct}%</strong>
          <span style={{ marginLeft: 8 }}>({totals.k} / {totals.n})</span>
        </div>

        {/* Hurst delta gauge — secondary */}
        <HurstDeltaGauge
          meanDeltaH={runningMeanDeltaH}
          blockDeltaH={lastBlock?.deltaH ?? null}
          blockCount={deltaHurstHistory.length}
        />

        <button
          onClick={() => {
            if (blockIdx >= C.BLOCKS_TOTAL) {
              setPhase('results');
            } else if (needsAudit) {
              setPhase('audit');
            } else {
              setPhase('target_announce');
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
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
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
        totalBlocks: C.BLOCKS_TOTAL
      };
    }

    return (
      <div style={{ padding: 24, textAlign: 'center', maxWidth: 600, margin: '0 auto' }}>
        {/* Large target display */}
        <div style={{
          padding: 60,
          background: '#f9f9f9',
          borderRadius: 20,
          border: `4px solid ${targetColor}`,
          marginBottom: 40
        }}>
          <p style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 20, color: '#666' }}>
            Your Target:
          </p>
          <div style={{ fontSize: 96, marginBottom: 10 }}>
            {targetEmoji}
          </div>
          <div style={{ fontSize: 48, fontWeight: 'bold', color: targetColor }}>
            {target}
          </div>
        </div>

        {/* Ready prompt */}
        <div style={{
          padding: 24,
          background: '#f0f7ff',
          borderRadius: 12,
          border: '2px solid #3b82f6',
          marginBottom: 24
        }}>
          <p style={{ fontSize: 18, marginBottom: 16, fontWeight: 500 }}>
            {isFirstBlock ? 'Ready to begin?' : 'Ready for the next block?'}
          </p>

          <p style={{ fontSize: 16, marginBottom: 8, color: '#555' }}>
            We're about to fetch quantum data from the QRNG.
          </p>
          <p style={{ fontSize: 16, marginBottom: 20, color: '#555' }}>
            <strong>Bring your attention to your target color just before clicking the button, and sustain that steady focus while the screen flashes.</strong> 
          </p>
          <p>Click when ready.</p>
          <button
            onClick={() => setPhase('fetching')}
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
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
            }}
            onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.95)')}
            onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
            onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
          >
            I'm Ready
          </button>
        </div>

        <div style={{ fontSize: 14, opacity: 0.75, marginTop: 16 }}>
          Block {blockIdx + 1} of {C.BLOCKS_TOTAL}
        </div>
      </div>
    );
  }

  // AUDIT - Rest & recovery screen with audit fetch in background
  if (phase === 'audit') {
    // Use the just-completed block for display
    const completedBlockIdx = blockIdxToPersist.current;
    const completedBlockNum = completedBlockIdx + 1;

    return (
      <div style={{ padding: 24, textAlign: 'center', maxWidth: 600, margin: '0 auto' }}>
        <h2 style={{ marginBottom: 32 }}>Block {completedBlockNum} Complete</h2>

        {/* Audit rest prompt */}
        <div style={{
          marginTop: 32,
          padding: 32,
          background: '#f0fdf4',
          borderRadius: 12,
          border: '2px solid #10b981'
        }}>
          <h3 style={{ color: '#059669', marginBottom: 16 }}>Rest & Recovery</h3>
          <p style={{ fontSize: 18, lineHeight: 1.6, marginBottom: 16 }}>
            Take a moment to breathe and relax...
          </p>
          <p style={{ fontSize: 14, color: '#6b7280' }}>
            Clear your mind. Let go of any focus or intention.
          </p>
        </div>

        {/* Continue button */}
        <button
          onClick={() => setPhase('target_announce')}
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
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
          }}
          onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.95)')}
          onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
          onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
        >
          Continue
        </button>

        <p style={{ marginTop: 16, fontSize: 14, color: '#6b7280' }}>
          Block {completedBlockNum} of {C.BLOCKS_TOTAL}
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
        <div style={{
          position: 'fixed',
          inset: 0,
          background: targetColor,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          animation: 'breathe 200ms ease-in-out infinite', // 5 Hz = 200ms cycle
        }}>
          {/* White spinner */}
          <div style={{
            width: 80,
            height: 80,
            border: '8px solid rgba(255, 255, 255, 0.3)',
            borderTop: '8px solid white',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            marginBottom: 24
          }} />

          <style>{`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>

          <p style={{
            color: 'white',
            fontSize: 24,
            fontWeight: 500,
            textAlign: 'center'
          }}>
            Fetching quantum data...
          </p>
        </div>
      </>
    );
  }

  // RUNNING phase removed - trials process instantly now

  // POST QUESTIONS (shown after results screen — scoring already saved)
  if (phase === 'done') {
    // Auto/AI modes skip post-questionnaire entirely (handled by useEffect)
    if (isAutoMode || isAIMode) {
      return null;
    }

    return (
      <div style={{ position: 'relative' }}>
        <QuestionsForm
          title="Quick wrap-up"
          questions={postQuestions}
          onSubmit={async (answers, { valid }) => {
            if (!valid) return;
            setPhase('summary');
            try {
              if (runRef) {
                await saveSessionAggregates();
                await setDoc(runRef, { post_survey: answers, completed: true }, { merge: true });
              }
            } catch (e) {
              console.warn('Post survey save error (non-blocking):', e);
            }
          }}
        />
      </div>
    );
  }

  // SIMPLE RESULTS
  if (phase === 'results') {
    // If session exited early (not all blocks completed), skip to summary
    const sessionCompleted = blockIdx >= C.BLOCKS_TOTAL;
    if (!sessionCompleted) {
      setPhase('summary');
      return null;
    }

    // Wait for shuffle-test computation (useEffect above)
    if (!sessionAnalysis) {
      return <div style={{ padding: 24, textAlign: 'center' }}>Analysing session…</div>;
    }

    const finalDeltaH = runningMeanDeltaH;
    const nBlocks = deltaHurstHistory.length;
    const hitRate = totals.n > 0 ? (100 * totals.k / totals.n).toFixed(1) : '50.0';
    const analysis = sessionAnalysis;

    // ── Evaluation (single source of truth) ──────────────────────────────────
    const { ksGate, collapseGate, eligible, rank: rawRank, intensityTier } = evaluatePrescreen(analysis, C);
    const verified   = rawRank === 'gold';
    const shuffleYes = collapseGate;

    // SE intensity label (from evaluatePrescreen — session-empirical SD(ΔH)/√n)
    const tierLabels = { 1: 'Subtle', 2: 'Solid Presence', 3: 'Exceptional' };
    const tierLabel  = intensityTier ? tierLabels[intensityTier] : null;

    // Modality (null-based SE for direction classification)
    const SE       = C.NULL_HURST_SD / Math.sqrt(nBlocks);
    const absDelta = Math.abs(finalDeltaH);
    const isDynamic = ksGate && absDelta < SE;
    let modality = null;
    if      (isDynamic)          modality = { label: 'Dynamic Harmonic', sub: 'Oscillation'      };
    else if (finalDeltaH >= SE)  modality = { label: 'Flow-Oriented',    sub: 'Persistence'      };
    else if (finalDeltaH <= -SE) modality = { label: 'Pulse-Oriented',   sub: 'Anti-Persistence' };

    return (
      <div className="App" style={{ textAlign: 'center', maxWidth: 600, margin: '0 auto', padding: 24 }}>
        <h1>Prescreening Results</h1>

        {/* ── Hero: Hit Score ─────────────────────────────────────────────── */}
        {(() => {
          const hr = parseFloat(hitRate);
          const above = hr > 50;
          const heroColor = above ? '#15803d' : hr < 50 ? '#b45309' : '#6b7280';
          const heroBg    = above ? '#dcfce7'  : hr < 50 ? '#fff7ed'  : '#f3f4f6';
          const heroBorder= above ? '#86efac'  : hr < 50 ? '#fed7aa'  : '#e5e7eb';
          return (
            <div style={{ padding: '28px 32px', borderRadius: 16, background: heroBg, border: `2px solid ${heroBorder}`, marginBottom: 20 }}>
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 4, letterSpacing: '0.05em' }}>
                TARGET: EXCEED 50%
              </div>
              <div style={{ fontSize: 72, fontWeight: 900, color: heroColor, lineHeight: 1, marginBottom: 6 }}>
                {hitRate}%
              </div>
              <div style={{ fontSize: 14, color: '#6b7280' }}>
                {totals.k.toLocaleString()} hits out of {totals.n.toLocaleString()} trials · {nBlocks} blocks
              </div>
            </div>
          );
        })()}

        {/* ── Hurst Delta Gauge ───────────────────────────────────────────── */}
        <HurstDeltaGauge
          meanDeltaH={finalDeltaH}
          blockCount={nBlocks}
        />

        {/* ── Session Analysis (smaller, below) ───────────────────────────── */}
        {analysis && (() => {
          let irVerdict, irColor, irBg, irDesc;
          if (eligible && verified) {
            irVerdict = 'Verified Temporal Influencer';
            irColor = '#15803d'; irBg = '#dcfce7';
            irDesc = 'Pattern detected and confirmed — the structure lived in the sequence order, not just the bit count.';
          } else if (eligible) {
            irVerdict = 'Candidate Signal Detected';
            irColor = '#1d4ed8'; irBg = '#eff6ff';
            irDesc = 'A signal was detected and showed meaningful collapse upon scrambling.';
          } else if (rawRank === 'candidate') {
            irVerdict = 'Possible Signal — Inconclusive';
            irColor = '#b45309'; irBg = '#fff7ed';
            irDesc = 'Your stream showed an unusual distribution but the collapse test was inconclusive.';
          } else {
            irVerdict = 'No Pattern Detected';
            irColor = '#6b7280'; irBg = '#f9fafb';
            irDesc = 'Your stream was consistent with normal random variation.';
          }

          return (
            <div style={{ textAlign: 'left', marginTop: 20, marginBottom: 16, fontSize: 13 }}>
              <div style={{ fontWeight: 600, fontSize: 12, letterSpacing: '0.08em', color: '#9ca3af', textAlign: 'center', marginBottom: 12 }}>
                SESSION ANALYSIS
              </div>

              {/* Verdict badge */}
              {(eligible || rawRank === 'candidate') && (
                <div style={{ marginBottom: 10, textAlign: 'center' }}>
                  {modality && (
                    <span style={{ fontSize: 14, fontWeight: 700, color: irColor }}>
                      {modality.label}
                      <span style={{ fontWeight: 400, marginLeft: 6 }}>({modality.sub})</span>
                    </span>
                  )}
                  {intensityTier && (
                    <span style={{ marginLeft: 10, padding: '2px 10px', borderRadius: 10, background: irColor + '22', color: irColor, fontSize: 11, fontWeight: 600 }}>
                      Tier {intensityTier} · {tierLabel}
                    </span>
                  )}
                </div>
              )}

              {/* Step 1 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: 8, marginBottom: 6, background: '#f8f9fa', border: '1px solid #e5e7eb' }}>
                <div>
                  <span style={{ fontWeight: 600 }}>Signal Presence</span>
                  <span style={{ color: '#9ca3af', marginLeft: 8, fontSize: 12 }}>Did your stream differ from the control?</span>
                </div>
                <div style={{ fontWeight: 700, color: ksGate ? '#15803d' : '#9ca3af', flexShrink: 0, marginLeft: 12 }}>
                  {ksGate ? 'YES' : 'NO'}
                </div>
              </div>

              {/* Step 2 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: 8, marginBottom: 6, background: '#f8f9fa', border: '1px solid #e5e7eb' }}>
                <div>
                  <span style={{ fontWeight: 600 }}>Pattern Structure</span>
                  <span style={{ color: '#9ca3af', marginLeft: 8, fontSize: 12 }}>Did the pattern collapse when bit order was randomised?</span>
                </div>
                <div style={{ fontWeight: 700, color: shuffleYes ? '#15803d' : '#9ca3af', flexShrink: 0, marginLeft: 12 }}>
                  {shuffleYes ? 'YES' : 'NO'}
                </div>
              </div>


              {/* Verdict */}
              <div style={{ padding: '12px 16px', borderRadius: 10, background: irBg, border: `2px solid ${irColor}` }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: irColor, marginBottom: 4 }}>{irVerdict}</div>
                <div style={{ color: '#555', fontSize: 12 }}>{irDesc}</div>
              </div>
            </div>
          );
        })()}

        <button
          className="primary-btn"
          onClick={() => setPhase('done')}
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
      <div className="App" style={{ textAlign: 'center', maxWidth: 600, margin: '0 auto', padding: 24 }}>
        <h1>🤖 {phase === 'ai_complete' ? 'AI-Mode' : 'Auto-Mode'} Complete</h1>
        <div style={{ marginTop: 32, padding: '24px', background: '#f0fdf4', border: '2px solid #10b981', borderRadius: 8 }}>
          <h2 style={{ color: '#059669', marginBottom: 16 }}>✓ {phase === 'ai_complete' ? 'AI Agent Sessions' : 'Baseline Data Collection'} Complete</h2>
          <p style={{ fontSize: 18, marginBottom: 12 }}>
            Successfully completed {autoSessionCount} {phase === 'ai_complete' ? 'AI agent' : 'baseline'} session{autoSessionCount !== 1 ? 's' : ''}
          </p>
          <p style={{ color: '#6b7280', fontSize: 14 }}>
            Data has been saved to the database. You can now view the results in the QA dashboard.
          </p>
        </div>

        <div style={{ marginTop: 24, padding: '16px', background: '#fff', border: '1px solid #ddd', borderRadius: 8 }}>
          <p style={{ fontFamily: 'monospace', fontSize: 12, color: '#6b7280' }}>
            {phase === 'ai_complete' ? 'AI-mode enabled via #ai URL hash' : 'Auto-mode enabled via #auto URL hash'}
          </p>
        </div>
      </div>
    );
  }

  // FINAL SCREEN
  if (phase === 'summary') {
    // Compute invite eligibility from sessionAnalysis (single source of truth)
    let inviteEligible = false;
    let summaryRank = null;
    if (sessionAnalysis) {
      const { rank: r, eligible } = evaluatePrescreen(sessionAnalysis, C);
      summaryRank = r;
      inviteEligible = eligible; // gold or silver only (candidate gets no invite)
    }

    return (
      <div className="App" style={{ textAlign: 'center', maxWidth: 600, margin: '0 auto', padding: 24 }}>
        <h1>Thank You!</h1>

        <div style={{ textAlign: 'left', marginBottom: 32, padding: '20px', background: '#f8f9fa', borderRadius: 8 }}>
          <h3>Session Complete</h3>
          <p>Thank you for participating in this research on temporal pattern influence.</p>

          <h4>Questions or Concerns</h4>
          <p>If you have any questions about this research, please contact the research team at <a href="mailto:h@whatthequark.com">h@whatthequark.com</a></p>
        </div>

        {/* Invite box — only for verified temporal influencers with minimum signal */}
        {inviteEligible && (
          <div style={{
            position: 'relative',
            marginBottom: 24, padding: '24px 28px',
            background: '#fffbeb',
            border: '3px solid #f59e0b',
            borderRadius: 14,
            boxShadow: '0 0 24px #f59e0b55',
          }}>
            <span style={{ position: 'absolute', top: -14, left:  10, fontSize: 24 }}>⭐</span>
            <span style={{ position: 'absolute', top: -14, left:  '50%', transform: 'translateX(-50%)', fontSize: 24 }}>⭐</span>
            <span style={{ position: 'absolute', top: -14, right: 10, fontSize: 24 }}>⭐</span>
            <span style={{ position: 'absolute', bottom: -14, left:  10, fontSize: 24 }}>⭐</span>
            <span style={{ position: 'absolute', bottom: -14, left:  '50%', transform: 'translateX(-50%)', fontSize: 24 }}>⭐</span>
            <span style={{ position: 'absolute', bottom: -14, right: 10, fontSize: 24 }}>⭐</span>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: '#b45309', marginBottom: 6 }}>
              STATUS: HIGH-RESONANCE SIGNATURE DETECTED
            </div>
            <div style={{ fontWeight: 700, fontSize: 17, color: '#92400e', marginBottom: 12 }}>
              You are a strong candidate for Experiment 5
            </div>
            <p style={{ margin: '0 0 10px', color: '#78350f', fontSize: 14, textAlign: 'left' }}>
              Your interaction with the quantum stream has met the criteria for the next phase of our research.
            </p>
            <p style={{ margin: '0 0 10px', color: '#78350f', fontSize: 14, textAlign: 'left' }}>
              To maintain experimental control, we do not provide individual performance metrics or raw data. However, upon the conclusion of the study, a formal write-up and summary of the aggregate findings will be distributed to our participant list.
            </p>
            <p style={{ margin: '0 0 16px', color: '#78350f', fontSize: 14, textAlign: 'left' }}>
              If you would like to be considered for the next stage of this study and receive a copy of the final research paper once published, please provide your contact details below:
            </p>

            {inviteSubmitted ? (
              <div style={{ padding: '12px 16px', background: '#dcfce7', borderRadius: 8, color: '#15803d', fontWeight: 600, fontSize: 14 }}>
                Thank you — we'll be in touch!
              </div>
            ) : (
              <form
                onSubmit={async e => {
                  e.preventDefault();
                  setInviteSubmitting(true);
                  try {
                    await addDoc(collection(db, 'exp5_invites'), {
                      ...inviteForm,
                      age: Number(inviteForm.age) || inviteForm.age,
                      submittedAt: serverTimestamp(),
                      experimentId: C.EXPERIMENT_ID,
                      sessionId: runRef?.id ?? null,
                      rank: summaryRank,
                    });
                    setInviteSubmitted(true);
                  } catch (err) {
                    console.error('Invite save failed:', err);
                  }
                  setInviteSubmitting(false);
                }}
                style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, textAlign: 'left' }}
              >
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#92400e', display: 'block', marginBottom: 3 }}>First Name</label>
                  <input required value={inviteForm.firstName} onChange={e => setInviteForm(f => ({ ...f, firstName: e.target.value }))}
                    style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #f59e0b', fontSize: 14, boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#92400e', display: 'block', marginBottom: 3 }}>Last Name</label>
                  <input required value={inviteForm.lastName} onChange={e => setInviteForm(f => ({ ...f, lastName: e.target.value }))}
                    style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #f59e0b', fontSize: 14, boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#92400e', display: 'block', marginBottom: 3 }}>Location</label>
                  <input required placeholder="City, Country" value={inviteForm.location} onChange={e => setInviteForm(f => ({ ...f, location: e.target.value }))}
                    style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #f59e0b', fontSize: 14, boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#92400e', display: 'block', marginBottom: 3 }}>Age</label>
                  <input required type="number" min="18" max="120" value={inviteForm.age} onChange={e => setInviteForm(f => ({ ...f, age: e.target.value }))}
                    style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #f59e0b', fontSize: 14, boxSizing: 'border-box' }} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#92400e', display: 'block', marginBottom: 3 }}>Email</label>
                  <input required type="email" value={inviteForm.email} onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))}
                    style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #f59e0b', fontSize: 14, boxSizing: 'border-box' }} />
                </div>
                <div style={{ gridColumn: '1 / -1', textAlign: 'center', marginTop: 4 }}>
                  <button type="submit" disabled={inviteSubmitting}
                    style={{ padding: '10px 28px', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: inviteSubmitting ? 'wait' : 'pointer' }}>
                    {inviteSubmitting ? 'Submitting…' : 'Join Experiment 5'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        <div style={{ padding: '16px', background: '#fff', border: '1px solid #ddd', borderRadius: 8 }}>
          <p style={{ marginTop: 0 }}>
            <a href="https://zenodo.org/records/18714884" target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6', textDecoration: 'underline' }}>Read about the methodology behind this pre-screening for Experiment 5.</a>
          </p>

          <ul style={{ textAlign: 'left', marginTop: 16 }}>
            <li>Repeat this experiment at least 5 times.</li>
            <li>Share with friends and family interested in participating in our study — large datasets matter here.</li>
          </ul>

          <button
            onClick={() => window.location.reload()}
            className="primary-btn"
            style={{ marginTop: '1em' }}
          >
            Run It Again
          </button>
        </div>
      </div>
    );
  }
}
