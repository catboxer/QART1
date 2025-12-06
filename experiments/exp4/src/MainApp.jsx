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
} from './stats/index.js';
import { db, ensureSignedIn } from './firebase.js';
import {
  collection, doc, addDoc, setDoc, getDoc, getDocs, updateDoc, serverTimestamp,
} from 'firebase/firestore';
import { fetchQRNGBits } from './fetchQRNGBits.js';
import { runNISTAudit } from './nistTests.js';

import { preQuestions, postQuestions } from './questions.js';
import { QuestionsForm } from './Forms.jsx';
import { BlockScoreboard } from './Scoring.jsx';
import HighScoreEmailGate from './ui/HighScoreEmailGate.jsx';
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

  // ---- schedule (20×150 driven by config: VISUAL_HZ * (BLOCK_MS/1000) should be 150; BLOCKS_TOTAL=20)
  // All blocks are now live - no scheduling needed
  const trialsPerBlock = Math.round((C.BLOCK_MS / 1000) * C.VISUAL_HZ);

  // ---- run doc
  const [runRef, setRunRef] = useState(null);
  const ensureRunDocPromiseRef = useRef(null); // Prevent race conditions
  const isCreatingDocRef = useRef(false); // Immediate flag to prevent race conditions

  const ensureRunDoc = useCallback(async (exitInfo = null) => {
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

        const col = collection(db, 'experiment3_ai_responses');
        const docData = {
          participant_id: uidNow,
          experimentId: C.EXPERIMENT_ID,
          createdAt: serverTimestamp(),
          target_side: target,
          tape_meta: null, // No tapes in live-only mode
          minutes_planned: C.BLOCKS_TOTAL, // All blocks are live
          timestamp: new Date().toISOString(),
          session_type: isAutoMode ? 'baseline' : isAIMode ? 'ai_agent' : 'human',
          mode: isAutoMode ? 'baseline' : isAIMode ? 'ai' : 'human',
        };

        // Add exit info if provided
        if (exitInfo) {
          docData.exitedEarly = true;
          docData.exit_reason = exitInfo.reason || 'unspecified';
          docData.exit_reason_notes = exitInfo.notes || null;
          docData.exit_block_index = exitInfo.blockIdx || null;
        } else {
          docData.exitedEarly = false;
          docData.exit_reason = null;
          docData.exit_reason_notes = null;
          docData.exit_block_index = null;
        }

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
    const n = C.TRIALS_PER_BLOCK; // Should be 150
    const halfA = quantumBits.slice(1, 1 + n);    // bits 1 to (1+n)
    const halfB = quantumBits.slice(1 + n, 1 + 2*n);  // bits (1+n) to (1+2n)

    const subjectBits = subjectGetsFirstHalf ? halfA : halfB;
    const demonBits = subjectGetsFirstHalf ? halfB : halfA;

    // Process subject bits
    for (let i = 0; i < n; i++) {
      const bit = parseInt(subjectBits[i], 10);
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

    const blockSummary = {
      k, n, z, pTwo,
      kd, nd: n, zd, pd,
      kind: 'instant'
    };

    setLastBlock(blockSummary);
    setTotals(t => ({ k: t.k + k, n: t.n + n }));
    setTotalGhostHits(t => t + kd);

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

      await setDoc(runRef, {
        aggregates: {
          totalHits: totals.k,
          totalTrials: totals.n,
          totalGhostHits: totalGhostHits,
          hitRate: hitRate,
          ghostHitRate: ghostHitRate,
          blocksCompleted: blockIdx,
          blocksPlanned: C.BLOCKS_TOTAL,
          sessionComplete: blockIdx >= C.BLOCKS_TOTAL,
          target: target,
          lastUpdated: new Date().toISOString()
        }
      }, { merge: true });

      console.log('✅ Session aggregates saved:', runRef.id, { hitRate, ghostHitRate, blocks: blockIdx });
    } catch (error) {
      console.error('❌ Failed to save session aggregates:', error);
    }
  }, [runRef, totals, totalGhostHits, blockIdx, target]);

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


      // Minimum window size for meaningful entropy calculation (standard is 1000 bits)
      const MIN_WINDOW_SIZE = 1000;

      // k=2: split into first/second half (1500/1500 for 3000 bits)
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

      // k=3: split into thirds (1000/1000/1000 for 3000 bits)
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
      setPhase('done');
      return;
    }

    let isCancelled = false;

    (async () => {
      try {
        // Fetch quantum bits (301 bits: 1 for assignment + 300 for trials)
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

        // Always persist (we need all 30 blocks saved, idx 0-29)
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
    if (phase === 'consent' || phase === 'pre_questions' || phase === 'info') {
      setPhase(isAIMode && phase === 'consent' ? 'prime' : 'onboarding');
    } else if (isAutoMode && phase === 'prime') {
      // Auto-mode skips prime, AI-mode shows it
      setPhase('onboarding');
    } else if (phase === 'score' && isAutoMode) {
      // Auto-continue score screens in auto-mode
      const timer = setTimeout(() => {
        // Check if session is complete (all 30 blocks done)
        if (blockIdx >= C.BLOCKS_TOTAL) {
          setPhase('done');
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
    } else if (phase === 'done') {
      // Skip post-questionnaire in auto/AI mode, go to results
      // Mark session as completed since we're skipping the post-questionnaire
      if (runRef) {
        Promise.all([
          saveSessionAggregates(),
          setDoc(runRef, { completed: true }, { merge: true })
        ])
          .then(() => {
            console.warn('✅ Session marked as completed:', runRef.id);
            setPhase('results');
          })
          .catch(err => {
            console.error('❌ Failed to mark session as completed:', err);
            setPhase('results'); // Continue anyway even if save fails
          });
      } else {
        console.warn('⚠️ No runRef available to mark as completed');
        setPhase('results');
      }
    } else if (phase === 'results' || phase === 'summary') {
      // Skip results/summary screens in auto/AI mode, go to next session
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

        // Reset target flag so new target gets assigned
        targetAssignedRef.current = false;
        setTarget(null);

        setPhase('consent');
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

    const n = C.TRIALS_PER_BLOCK; // Should be 150
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
  // No tick loop needed since all 150 trials are processed at once





  // Note: Exit functionality removed - sessions complete automatically or handle early exits in useEffect

  // Ensure document is created early in onboarding phase
  useEffect(() => {
    if (phase === 'onboarding' && !runRef && target) {
      ensureRunDoc().catch(console.error);
    }
  }, [phase, runRef, target, ensureRunDoc]);

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
      setPhase('prime');
      return null;
    }

    return (
      <div style={{ position: 'relative' }}>
        <ConsentGate
          title="Consent to Participate"
          studyDescription="This study investigates whether different types of agents (human consciousness, artificial intelligence, and automated systems) show distinct patterns when attempting to influence quantum random number generators. You will complete 30 blocks each ~3 seconds long and brief questionnaires (approximately 5 minutes total)."
          bullets={[
            'You will receive a target color assignment (blue or orange)',
            'Your task is to get your target color above 50%. Concentrate your attention on your target color right before and during the moment quantum data is fetched from a quantum random number generator.',
            'When focused and ready, press "I\'m Ready" and keep focusing as your color pulses. This triggers the quantum random number generator and the sigantures in the QRNG during your focused intention is what we\'re testing.', 
            'We collect data on quantum random sequences, your performance metrics, timing patterns, and your questionnaire responses.',
            'Participation is completely voluntary; you may exit at any time using the door button.',
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
            setPhase(shouldSkipPre ? 'prime' : 'preQ');
          }}
        />
      </div>
    );
  }

  // PRE QUESTIONS - Skip for auto/AI modes
  if (phase === 'preQ') {
    // Auto and AI modes skip questions
    if (isAutoMode || isAIMode) {
      setPhase('prime');
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
            setPhase('prime');
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

  // PRIME SCREEN (research background - shown to all participants)
  if (phase === 'prime') {
    return (
      <div style={{ padding: 24, position: 'relative' }}>
        <h2>Research Background</h2>
        <div style={{ border: '1px solid #ddd', padding: 20, borderRadius: 12, background: '#f9f9f9', minHeight: 300 }}>
          <div>
            <h3 style={{ marginTop: 0, color: '#2c3e50' }}>PK Research: Moving Beyond "Does PSI Exist?"</h3>
            <div style={{ lineHeight: 1.6, fontSize: 15 }}>
              <p>Between 1959 and 2000, researchers conducted 515 controlled experiments testing whether human intention could influence random number generators. Dean Radin and Roger Nelson's meta-analysis found effects deviating more than 16 standard deviations from chance. That's a cumulative result across nearly 100 independent researchers, multiple continents, and increasingly rigorous protocols. The effect is small (less than 1% deviation) but persistent: studies published after 1987 showed nearly identical effect sizes to earlier work (z-scores 0.61 vs 0.73) even as experimental quality improved. Now we're testing whether similar patterns appear in AI systems alongside human participants.</p>

              <p style={{ fontStyle: 'italic', color: '#555', marginBottom: 0 }}>Your participation helps map the landscape of consciousness-matter interaction.</p>
            </div>
          </div>

        
        </div>
        <div style={{ marginTop: 8 }}>
          <button
            onClick={() => setPhase('info')}
            style={{
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
      </div>
    );
  }

  // INFO SCREEN (binaural beats information) - Skip for auto/AI modes
  if (phase === 'info') {
    // Auto and AI modes skip binaural beats info
    if (isAutoMode || isAIMode) {
      setPhase('onboarding');
      return null;
    }

    const binauralText = "Correlations have been found with some researchers claiming mental coherence increasing PSI through use of binaural beats.";

    return (
      <div style={{ padding: 24, maxWidth: 760, position: 'relative' }}>
        <h3 style={{ marginTop: 0, color: '#2c3e50' }}>Optional Enhancement: Binaural Beats</h3>
        <div style={{ marginTop: 20, padding: 20, background: '#f8f9fa', borderRadius: 12, border: '1px solid #e9ecef' }}>
          <ul style={{ fontSize: 16, lineHeight: 1.6 }}>
            <li><strong>About binaural beats:</strong> {binauralText}</li>
            <li><strong>What you need:</strong> A pair of headphones.</li>
            <li><strong>How:</strong> Use <a href="https://mynoise.net/NoiseMachines/binauralBrainwaveGenerator.php" target="_blank" rel="noopener noreferrer">this binaural beat generator</a> or your preferred app and set the frequency between <strong>4–8&nbsp;Hz</strong>, choosing the level that feels most comfortable.</li>
            <li><strong>Choose:</strong>You must choose to either use binaural beats for your entire session or complete the whole session without them. You're welcome to take this experiment multiple times. Try some sessions with binaural beats and others without them to explore different approaches</li>
            <li><strong>Prepare:</strong> Listen for at least 1–2 minutes before starting. Breathe deeply and try to empty your mind.</li>
          </ul>
        </div>

        <div style={{ marginTop: 20 }}>
          <button
            onClick={() => setPhase('onboarding')}
            style={{
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

      </div>
    );
  }

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
                (Each session = 20 blocks, ~10 min)
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
            <li>You'll complete 30 short blocks with breaks between each. <b>Before </b>each block begins, take a moment to settle and direct your attention toward your chosen target color. This focus should begin just before you start the block and continue through the fetch period.</li>
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

    return (
      <div style={{ padding: 24, textAlign: 'center', maxWidth: 600, margin: '0 auto' }}>
        <h2 style={{ marginBottom: 20 }}>Block {completedBlockNum} Complete</h2>

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
              fontWeight: 600
            }}
          >
            Your Score: {pctLast}% ({lastBlock.k}/{lastBlock.n} HITs)
          </div>
        )}

        {/* Session totals */}
        <BlockScoreboard
          last={lastBlock || { k: 0, n: 0, z: 0, pTwo: 1, kind: 'instant' }}
          totals={totals}
          targetSide={target}
          hideGhost={true}
          hideBlockType={true}
        />

        <button
          onClick={() => {
            // Check if this was the final block
            if (blockIdx >= C.BLOCKS_TOTAL) {
              setPhase('done');
            } else if (needsAudit) {
              setPhase('audit');
            } else {
              setPhase('target_announce');
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
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
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

  // POST QUESTIONS
  if (phase === 'done') {
    // Auto/AI modes are handled by useEffect above, which marks completed:true before transition
    // This render block only handles human mode
    if (isAutoMode || isAIMode) {
      return null; // useEffect will handle transition
    }

    return (
      <div style={{ position: 'relative' }}>
        <QuestionsForm
          title="Quick wrap-up"
          questions={postQuestions}
          onSubmit={async (answers, { valid }) => {
            if (!valid) return;
            setPhase('results');
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
    const finalPct = totals.n ? Math.round((100 * totals.k) / totals.n) : 0;

    // If session exited early (not all blocks completed), skip to summary
    const sessionCompleted = blockIdx >= C.BLOCKS_TOTAL;
    if (!sessionCompleted) {
      // Go directly to summary with session ID, no score or email capture
      setPhase('summary');
      return null;
    }

    return (
      <div className="App" style={{ textAlign: 'center', maxWidth: 600, margin: '0 auto', padding: 24 }}>
        <h1>Your Results</h1>

        <div
          style={{
            display: 'inline-block',
            padding: '20px 30px',
            borderRadius: 12,
            border: '2px solid #ddd',
            background: '#eef8ee',
            marginBottom: 24,
            fontSize: 24,
            fontWeight: 700
          }}
        >
          Final Score: {finalPct}%
        </div>

        <div style={{ textAlign: 'left', marginBottom: 32, padding: '16px', background: '#f8f9fa', borderRadius: 8 }}>
          <h4>What This Study Investigated</h4>
          <p>This experiment tested whether focused mental intention could influence quantum random number generators to bias outcomes toward a target color. You were assigned a target color (blue or orange) and asked to focus your attention on that color immediately before and during the moment quantum data was fetched from a real quantum random number generator. Your task was to make your target color appear more than 50% of the time through focused intention alone.</p>

          <h4>Understanding Your Score</h4>
          <p>A single session score doesn't tell us much about whether you have any ability, but repeating the experiment multiple times can reveal meaningful patterns. Very high scores (consistently above 55%) or very low scores (consistently below 45%) across many sessions could indicate a significant effect.</p>

          <p>To evaluate your personal performance: complete at least 10 sessions, then calculate your average score. If your average is consistently above 52-53% or below 47-48% across multiple sets of 10 sessions, this might indicate a genuine pattern rather than random variation. Remember, low scores are just as telling as high scores—we would simply test you with reversed instructions.</p>

          <h4>Next Steps</h4>
          <p>Your data contributes to a larger dataset that will be analyzed for statistical patterns, comparing human participants, AI agents, and automated baselines. Results will be made available once data collection is complete and analysis is finished.</p>
        </div>

        {/* Hide email capture for auto-mode and AI-mode */}
        {!isAutoMode && !isAIMode && (
          <HighScoreEmailGate
            experiment="exp4"
            step="done"
            sessionId={runRef?.id}
            participantId={uid}
            finalPercent={finalPct}
            cutoffOverride={C.FINALIST_MIN_PCT}
            lowCutoffOverride={C.FINALIST_MAX_PCT}
          />
        )}

        <button
          className="primary-btn"
          onClick={() => setPhase('summary')}
          style={{ marginTop: 16 }}
        >
          Continue to Session Details
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
    return (
      <div className="App" style={{ textAlign: 'center', maxWidth: 600, margin: '0 auto', padding: 24 }}>
        <h1>Thank You!</h1>

        <div style={{ textAlign: 'left', marginBottom: 32, padding: '20px', background: '#f8f9fa', borderRadius: 8 }}>
          <h3>Study Complete</h3>
          <p>Thank you for participating in this research on attention and random pattern generation.</p>

          <h4>Questions or Concerns</h4>
          <p>If you have any questions about this research, please contact the research team at <a href="mailto:h@whatthequark.com">h@whatthequark.com</a></p>
        </div>

        <div style={{ marginTop: 24, padding: '16px', background: '#fff', border: '1px solid #ddd', borderRadius: 8 }}>
          <p>Session ID: <code>{runRef?.id}</code></p>
          <p style={{ marginTop: 16 }}>
            Redeem Survey Circle Code with one click: <a href="https://www.surveycircle.com/ZZ4P-RCF3-P54R-7DVE/" target="_blank" rel="noopener noreferrer">https://www.surveycircle.com/ZZ4P-RCF3-P54R-7DVE/</a>
          </p>
          <p style={{ marginTop: 16 }}>
            Get Karma for free research participants at SurveySwap.io: <a href="https://surveyswap.io/sr/Y3MS-6Z81-IQDK" target="_blank" rel="noopener noreferrer">https://surveyswap.io/sr/Y3MS-6Z81-IQDK</a> (or enter code manually: <strong>Y3MS-6Z81-IQDK</strong>)
          </p>
          <p style={{ marginTop: 16 }}>
            <a href="https://whatthequark.com/human-ai-quantum-test/" target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6', textDecoration: 'underline' }}>Read about the methodology behind this experiment</a>
          </p>
          <p>To keep the study fair and unbiased for future participants, we're holding back full details until data collection is complete.</p>

          <ul style={{ textAlign: 'left', marginTop: 16 }}>
            <li>Try again in different mindsets, with and without binaural beats.</li>
            <li>Share with friends—large datasets matter here.</li>
            <li>
              We'll post a full debrief at{' '}
              <a href="https://whatthequark.com/debriefs/">https://whatthequark.com/debriefs/</a> when the study closes.
            </li>
          </ul>

          <button
            onClick={() => window.location.reload()}
            className="primary-btn"
            style={{ marginTop: '1em' }}
          >
            Run It Again
          </button>

          <div style={{ marginTop: 12 }}>
            <a
              className="secondary-btn"
              href="mailto:h@whatthequark.com?subject=Experiment%20Results%20Updates"
            >
              Email me when results are posted
            </a>
          </div>
        </div>
      </div>
    );
  }
}
