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
  normalCdf,
  computeSessionAnalysis,
  evaluatePrescreen,
} from './stats/index.js';
import { db, ensureSignedIn } from './firebase.js';
import {
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  serverTimestamp,
  query,
  where,
  orderBy,
  limit,
} from 'firebase/firestore';
import { fetchQRNGBits } from './fetchQRNGBits.js';
import { runNISTAudit } from './nistTests.js';
import { preQuestions, postQuestions } from './questions.js';
import { QuestionsForm } from './Forms.jsx';
import { HurstDeltaGauge } from './Scoring.jsx';
import confetti from 'canvas-confetti';
import ConsentGate from './ui/ConsentGate.jsx';

// ── Monitoring helpers ────────────────────────────────────────────────────────

// Linear regression of ys ~ index; returns slope + two-tailed p-value
function linReg(ys) {
  const n = ys.length;
  if (n < 3) return { slope: null, pValue: null };
  const xMean = (n - 1) / 2;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;
  const Sxx = ys.reduce((s, _, i) => s + (i - xMean) ** 2, 0);
  const Sxy = ys.reduce(
    (s, y, i) => s + (i - xMean) * (y - yMean),
    0,
  );
  const slope = Sxy / Sxx;
  const intercept = yMean - slope * xMean;
  const sse = ys.reduce(
    (s, y, i) => s + (y - (intercept + slope * i)) ** 2,
    0,
  );
  const seSlope = Math.sqrt(sse / (n - 2) / Sxx);
  const t = seSlope > 0 ? slope / seSlope : 0;
  return { slope, pValue: 2 * (1 - normalCdf(Math.abs(t))) };
}

async function hashEmail(email) {
  const encoded = new TextEncoder().encode(
    email.toLowerCase().trim(),
  );
  const buf = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

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
  if (C.PRIME_PROB < 0 || C.PRIME_PROB > 1)
    errors.push('PRIME_PROB must be between 0 and 1');
  if (!Array.isArray(C.TARGET_SIDES) || C.TARGET_SIDES.length === 0)
    errors.push('TARGET_SIDES must be non-empty array');

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

// Note: All quantum bit fetching is now handled by fetchQRNGBits() function
// which includes cryptographic authentication and validation

// ── Run-length encode an array of strings → [[value, count], ...] ─────────────
function rleEncode(arr) {
  if (!arr.length) return [];
  const out = [];
  let cur = arr[0],
    count = 1;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] === cur) {
      count++;
    } else {
      out.push([cur, count]);
      cur = arr[i];
      count = 1;
    }
  }
  out.push([cur, count]);
  return out;
}

// ── Bit-packing helpers (session-level raw_bits_b64) ─────────────────────────

// Pack an array-of-arrays of 0|1 bits into a base64 string.
// bits[blockIdx][trialIdx] → sequentially packed, MSB first.
function packBitsToBase64(bitsPerBlock) {
  const totalBits = bitsPerBlock.reduce((s, b) => s + b.length, 0);
  const nBytes = Math.ceil(totalBits / 8);
  const bytes = new Uint8Array(nBytes);
  let globalBit = 0;
  for (const block of bitsPerBlock) {
    for (const bit of block) {
      bytes[Math.floor(globalBit / 8)] |=
        bit << (7 - (globalBit % 8));
      globalBit++;
    }
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// Unpack a base64 string into blockCount arrays of bitsPerBlock bits each.
function unpackBitsFromBase64(b64, blockCount, bitsPerBlock) {
  if (!b64 || blockCount === 0) return [];
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++)
    bytes[i] = binary.charCodeAt(i);
  const result = [];
  let globalBit = 0;
  for (let s = 0; s < blockCount; s++) {
    const block = [];
    for (let b = 0; b < bitsPerBlock; b++) {
      block.push(
        (bytes[Math.floor(globalBit / 8)] >> (7 - (globalBit % 8))) &
          1,
      );
      globalBit++;
    }
    result.push(block);
  }
  return result;
}

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

  // Preview mode: jump to summary screen as soon as app is ready
  useEffect(() => {
    if (!isPreviewMode || !userReady || !target) return;
    setPhase('summary');
  }, [isPreviewMode, userReady, target]);

  // ---- returning participant (skip preQ on same device)
  const [preDone, setPreDone] = useState(() => {
    try {
      return (
        localStorage.getItem(`pre_done_global:${C.EXPERIMENT_ID}`) ===
        '1'
      );
    } catch {
      return false;
    }
  });
  const [checkedReturning, setCheckedReturning] = useState(false); // ← add this

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
        } catch {}
      } finally {
        setUserReady(true);
        setCheckedReturning(true);
      }
    })();
  }, []);

  const requireUid = useCallback(async () => {
    const u = await ensureSignedIn();
    if (!u || !u.uid)
      throw new Error(
        'auth/no-user: sign-in required before writing',
      );
    return u.uid;
  }, []);

  // makeTape function removed - live streams only

  // prepareSessionArtifacts function removed - live streams only

  // Trials per block (from config)
  const trialsPerBlock = C.TRIALS_PER_BLOCK;

  // Multi-session accumulation (declared here so participantHash is in scope for ensureRunDoc deps)
  const [participantHash, setParticipantHash] = useState(null);
  const [participantProfile, setParticipantProfile] = useState(null);
  const [emailPlaintext, setEmailPlaintext] = useState('');
  const [sessionCount, setSessionCount] = useState(0);
  const [cumulativeAnalysis, setCumulativeAnalysis] = useState(null);
  // Past-session data loaded at consent (from querying prescreen_sessions_exp5)
  const [pastH_s, setPastH_s] = useState([]);
  const [pastH_d, setPastH_d] = useState([]);
  const [pastBits, setPastBits] = useState([]);
  const [pastDemonHits, setPastDemonHits] = useState(0);
  const [pastDemonTrials, setPastDemonTrials] = useState(0);

  // ---- run doc
  const [runRef, setRunRef] = useState(null);
  const ensureRunDocPromiseRef = useRef(null); // Prevent race conditions
  const isCreatingDocRef = useRef(false); // Immediate flag to prevent race conditions
  const savedCumulativeRef = useRef(false); // Prevent double-save of cumulative data
  const fetchTriggeredAtRef = useRef(null); // Capture when fetching was triggered (button press or auto-timer)
  const qrngProviderRef = useRef(null); // Track QRNG provider across blocks ('mixed' if it changes)
  const qrngProviderSeqRef = useRef([]); // Per-block provider labels, for RLE encoding at session end
  const allRawBitsRef = useRef([]); // Full 301-bit calls per block (assignment + both halves)

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
        if (!target)
          throw new Error(
            'logic/order: target must be set before creating run',
          );
        const uidNow = uid || (await requireUid());

        const col = collection(db, C.PRESCREEN_COLLECTION);
        const now = new Date();
        const day_bucket = now.toISOString().slice(0, 10);
        const startOfWeek = new Date(now);
        startOfWeek.setUTCDate(now.getUTCDate() - now.getUTCDay());
        const week_bucket = startOfWeek.toISOString().slice(0, 10);
        const docData = {
          participant_id: uidNow,
          participant_hash: participantHash || null,
          experimentId: C.EXPERIMENT_ID,
          createdAt: serverTimestamp(),
          blocks_planned: C.BLOCKS_TOTAL,
          timestamp: now.toISOString(),
          session_type: isAutoMode
            ? 'baseline'
            : isAIMode
              ? 'ai_agent'
              : 'human',
          app_version: C.APP_VERSION,
          day_bucket,
          week_bucket,
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
  }, [
    runRef,
    target,
    uid,
    requireUid,
    isAutoMode,
    isAIMode,
    participantHash,
  ]);

  // ---- phase & per-minute state
  const [phase, setPhase] = useState('consent');
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
  const [sessionAnalysis, setSessionAnalysis] = useState(null);
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

  const bitsRef = useRef([]);
  const demonBitsRef = useRef([]);
  const alignedRef = useRef([]);
  const hitsRef = useRef(0);
  const demonHitsRef = useRef(0);
  const blockAuthRef = useRef(null); // Cryptographic authentication for current block's bitstream
  const auditAuthRef = useRef(null); // Cryptographic authentication for audit bitstream
  const blockIdxToPersist = useRef(-1); // Stores the correct blockIdx to save

  // Process trials with randomized half assignment (subject/demon)
  const processTrials = useCallback(
    (quantumBits) => {
      if (quantumBits.length !== C.BITS_PER_BLOCK) {
        throw new Error(
          `Expected ${C.BITS_PER_BLOCK} bits, got ${quantumBits.length}`,
        );
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
      const halfA = quantumBits.slice(1, 1 + n); // bits 1 to (1+n)
      const halfB = quantumBits.slice(1 + n, 1 + 2 * n); // bits (1+n) to (1+2n)

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
        k,
        n,
        z,
        pTwo,
        kd,
        nd: n,
        zd,
        pd,
        kind: 'instant',
        subjectHurst: blockSubjHurst,
        pcsHurst: blockPCSHurst,
        deltaH: blockDeltaH,
      };

      setLastBlock(blockSummary);
      setTotals((t) => ({ k: t.k + k, n: t.n + n }));
      setTotalGhostHits((t) => t + kd);
      setDeltaHurstHistory((prev) => [...prev, blockDeltaH]);
      setHurstSubjectHistory((prev) => [...prev, blockSubjHurst]);
      setHurstDemonHistory((prev) => [...prev, blockPCSHurst]);
      setSubjectBitsHistory((prev) => [...prev, parsedSubjectBits]);

      // Increment block index
      setblockIdx((prev) => prev + 1);

      // Note: persistMinute will be called after this via a useEffect watching blockIdx
    },
    [target],
  );

  // Save session-level aggregates for fast QA dashboard loading
  const saveSessionAggregates = useCallback(async () => {
    if (!runRef) return;

    try {
      const hitRate = totals.n > 0 ? totals.k / totals.n : 0.5;
      const ghostHitRate =
        totals.n > 0 ? totalGhostHits / totals.n : 0.5;

      const meanDH =
        deltaHurstHistory.length > 0
          ? deltaHurstHistory.reduce((a, b) => a + b, 0) /
            deltaHurstHistory.length
          : 0;

      // ── Monitoring metrics (scalars only) ──────────────────────────────────
      const splitAt = Math.floor(C.BLOCKS_TOTAL / 2); // 40
      const early = deltaHurstHistory.slice(0, splitAt);
      const late = deltaHurstHistory.slice(splitAt);
      const mean_deltaH_early =
        early.length > 0
          ? early.reduce((a, b) => a + b, 0) / early.length
          : null;
      const mean_deltaH_late =
        late.length > 0
          ? late.reduce((a, b) => a + b, 0) / late.length
          : null;
      const { slope: reg_slope, pValue: reg_pValue } =
        linReg(deltaHurstHistory);

      // ── Pack full 301-bit calls (assignment + both halves) for Colab blob ─────
      // Preserves assignment bit, demon half, and subject half for full re-derivation.
      const raw_bits_b64 =
        allRawBitsRef.current.length > 0
          ? packBitsToBase64(allRawBitsRef.current)
          : null;

      // Dev-mode round-trip integrity check — zero cost in production
      if (import.meta.env.DEV && raw_bits_b64) {
        const orig = allRawBitsRef.current;
        const rt = unpackBitsFromBase64(
          raw_bits_b64,
          orig.length,
          C.BITS_PER_BLOCK,
        );
        let ok = rt.length === orig.length;
        if (ok) {
          const checkIdxs = [
            0,
            Math.floor(orig.length / 2),
            orig.length - 1,
          ];
          outer: for (const bi of checkIdxs) {
            if (rt[bi].length !== orig[bi].length) {
              ok = false;
              break;
            }
            for (let i = 0; i < orig[bi].length; i++) {
              if (rt[bi][i] !== orig[bi][i]) {
                ok = false;
                break outer;
              }
            }
          }
        }
        if (!ok)
          console.error(
            '❌ raw_bits_b64 round-trip FAILED — packing corruption',
          );
        else
          console.log(
            `✅ raw_bits_b64 round-trip OK (${orig.length} blocks × ${C.BITS_PER_BLOCK} bits)`,
          );
      }

      await setDoc(
        runRef,
        {
          block_count_actual: deltaHurstHistory.length,
          blocks_expected: C.BLOCKS_TOTAL,
          qrng_provider: qrngProviderRef.current,
          qrng_provider_sequence: rleEncode(
            qrngProviderSeqRef.current,
          ),
          aggregates: {
            totalHits: totals.k,
            totalTrials: totals.n,
            totalGhostHits: totalGhostHits,
            hitRate: hitRate,
            ghostHitRate: ghostHitRate,
            blocksCompleted: deltaHurstHistory.length,
            blocksPlanned: C.BLOCKS_TOTAL,
            sessionComplete:
              deltaHurstHistory.length >= C.BLOCKS_TOTAL,
            lastUpdated: new Date().toISOString(),
            hurst_subject: hurstSubjectHistory,
            hurst_demon: hurstDemonHistory,
            delta_h: deltaHurstHistory,
            hurstDelta: {
              mean: meanDH,
              blockDeltas: deltaHurstHistory,
            },
          },
          ...(raw_bits_b64 ? { raw_bits_b64 } : {}),
          // Top-level scalars for easy Colab aggregation (no nested field paths needed for ghostZ)
          demon_hits_total: totalGhostHits,
          demon_trials_total: totals.n,
          demon_mean_hit_rate: ghostHitRate,
          monitoring: {
            mean_deltaH_early,
            mean_deltaH_late,
            difference:
              mean_deltaH_early !== null && mean_deltaH_late !== null
                ? mean_deltaH_late - mean_deltaH_early
                : null,
            reg_slope,
            reg_pValue,
          },
        },
        { merge: true },
      );

      console.log('✅ Session aggregates saved:', runRef.id, {
        hitRate,
        ghostHitRate,
        blocks: deltaHurstHistory.length,
      });
    } catch (error) {
      console.error('❌ Failed to save session aggregates:', error);
    }
  }, [
    runRef,
    totals,
    totalGhostHits,
    deltaHurstHistory,
    hurstSubjectHistory,
    hurstDemonHistory,
  ]);

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

        // Store the current blockIdx before it gets incremented (this is what persistMinute should use)
        blockIdxToPersist.current = blockIdx;

        // Store authentication data for this block
        blockAuthRef.current = {
          hash: quantumData.hash,
          timestamp: quantumData.timestamp,
          source: quantumData.source,
          bitCount: quantumData.bits.length,
        };

        // Track QRNG provider (mark 'mixed' if it changes mid-session)
        const src = quantumData.source;
        qrngProviderSeqRef.current.push(src);
        if (qrngProviderRef.current === null) {
          qrngProviderRef.current = src;
        } else if (
          qrngProviderRef.current !== src &&
          qrngProviderRef.current !== 'mixed'
        ) {
          qrngProviderRef.current = 'mixed';
        }

        // ANTI-TIMING-ATTACK: Save raw bits to Firestore BEFORE processing
        // This prevents AI agents from aborting after peeking at bits but before persistence
        // If agent aborts here, we'll have the bits and can detect strategic abandonment
        if (runRef) {
          const blockCommitDoc = doc(
            runRef,
            'block_commits',
            String(blockIdx),
          );
          await setDoc(blockCommitDoc, {
            blockIdx: blockIdx,
            bits: quantumData.bits,
            auth: {
              hash: quantumData.hash,
              timestamp: quantumData.timestamp,
              source: quantumData.source,
              bitCount: quantumData.bits.length,
            },
            committedAt: serverTimestamp(),
            clientCommitTime: new Date().toISOString(),
            target: target,
          });
        }

        // Accumulate full 301-bit call (assignment + both halves) for session-level blob
        allRawBitsRef.current.push(
          quantumData.bits.split('').map(Number),
        );

        // Process all trials instantly (this increments blockIdx from blockIdx to blockIdx+1)
        processTrials(quantumData.bits);

        // Always persist (we need all 40 blocks saved, idx 0-39)
        setNeedsPersist(true);

        // Always go to score phase first to show results
        setPhase('score');
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
                exit_block_index: blockIdx,
              });
            }
            setPhase('results');
          } else {
            // Human mode: show alert and exit gracefully
            alert(
              'We ran out of QRNG data for today. Your progress has been saved. Please schedule a session with us or try again tomorrow.',
            );
            // Save and exit
            if (runRef) {
              await updateDoc(runRef, {
                exitedEarly: true,
                exit_reason: 'qrng_unavailable',
                exit_error_details: errorDetails,
                exit_block_index: blockIdx,
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
  }, [
    phase,
    blockIdx,
    processTrials,
    isAutoMode,
    isAIMode,
    runRef,
    target,
  ]);

  // Audit phase: Fetch audit bits in background and randomize target
  useEffect(() => {
    if (phase !== 'audit') return;

    let isCancelled = false;

    (async () => {
      try {
        // Fetch audit bits (no validation needed during fetch, we'll validate after)
        const auditData = await fetchQRNGBits(
          C.AUDIT_BITS_PER_BREAK,
          3,
          false,
        );

        if (isCancelled) return;

        // Store authentication data for audit
        auditAuthRef.current = {
          hash: auditData.hash,
          timestamp: auditData.timestamp,
          source: auditData.source,
          bitCount: auditData.bits.length,
        };

        // Run NIST SP 800-22 randomness tests
        const nistResults = runNISTAudit(auditData.bits);

        const isRandom = nistResults.allTestsPass;

        // Extract summary stats for backwards compatibility
        const ones = auditData.bits
          .split('')
          .filter((b) => b === '1').length;
        const proportion = ones / C.AUDIT_BITS_PER_BREAK;

        const validationStats = {
          // NIST test results
          nist: {
            allPass: nistResults.allTestsPass,
            frequency: {
              pValue: nistResults.tests.frequency.pValue,
              pass: nistResults.tests.frequency.pass,
            },
            runs: {
              pValue: nistResults.tests.runs.pValue,
              pass: nistResults.tests.runs.pass,
              observed: nistResults.tests.runs.runsObserved,
            },
            longestRun: {
              pValue: nistResults.tests.longestRun.pValue,
              pass: nistResults.tests.longestRun.pass,
              chiSquared: nistResults.tests.longestRun.statistic,
              df: nistResults.tests.longestRun.degreesOfFreedom,
            },
          },
          // Basic stats
          length: auditData.bits.length,
          ones,
          onesRatio: (ones / auditData.bits.length).toFixed(4),
          reference: nistResults.reference,
        };

        // Calculate audit entropy
        const auditBitArray = auditData.bits
          .split('')
          .map((b) => parseInt(b));
        const auditEntropy = shannonEntropy(auditBitArray);

        // Save audit to Firebase with authentication data
        if (runRef) {
          const auditDoc = doc(
            runRef,
            'audits',
            `after_block_${blockIdx}`,
          );
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
              source: auditData.source,
            },
          });
        }

        // Randomize target for next set of blocks
        const randomByte = crypto.getRandomValues(
          new Uint8Array(1),
        )[0];
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
    if (
      phase === 'consent' ||
      phase === 'pre_questions' ||
      phase === 'info' ||
      phase === 'prime' ||
      phase === 'preQ'
    ) {
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
          const needsAudit =
            completedBlockIdx >= 0 &&
            (completedBlockIdx + 1) % C.AUDIT_EVERY_N_BLOCKS === 0 &&
            blockIdx < C.BLOCKS_TOTAL;
          setPhase(needsAudit ? 'audit' : 'target_announce');
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
        const isFullSession =
          allRawBitsRef.current.length === C.BLOCKS_TOTAL;
        Promise.all([
          saveSessionAggregates(),
          ...(isFullSession
            ? [setDoc(runRef, { completed: true }, { merge: true })]
            : []),
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
        setHurstSubjectHistory([]);
        setHurstDemonHistory([]);
        setSubjectBitsHistory([]);
        setSessionAnalysis(null);

        // Reset target flag so new target gets assigned
        targetAssignedRef.current = false;
        setTarget(null);

        // Reset per-session refs
        savedCumulativeRef.current = false;
        qrngProviderRef.current = null;
        qrngProviderSeqRef.current = [];
        allRawBitsRef.current = [];

        setPhase('onboarding');
      }, 100);
    }
    // Note: blockIdxToPersist is a ref, not a state, so it doesn't need to be in dependencies
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

  // Note: Buffer management functions removed - no longer needed with instant trial processing
  const minuteInvalidRef = useRef(false);
  const endMinuteRef = useRef(() => {});

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
    const blockSubjEntropy =
      bitsRef.current.length > 0
        ? shannonEntropy(bitsRef.current)
        : null;
    const blockDemonEntropy =
      demonBitsRef.current.length > 0
        ? shannonEntropy(demonBitsRef.current)
        : null;

    // Block-level k2 split
    const half = Math.floor(n / 2);
    const blockK2Subj = [
      shannonEntropy(bitsRef.current.slice(0, half)),
      shannonEntropy(bitsRef.current.slice(half)),
    ];
    const blockK2Demon = [
      shannonEntropy(demonBitsRef.current.slice(0, half)),
      shannonEntropy(demonBitsRef.current.slice(half)),
    ];

    // Block-level k3 split
    const third = Math.floor(n / 3);
    const blockK3Subj = [
      shannonEntropy(bitsRef.current.slice(0, third)),
      shannonEntropy(bitsRef.current.slice(third, 2 * third)),
      shannonEntropy(bitsRef.current.slice(2 * third)),
    ];
    const blockK3Demon = [
      shannonEntropy(demonBitsRef.current.slice(0, third)),
      shannonEntropy(demonBitsRef.current.slice(third, 2 * third)),
      shannonEntropy(demonBitsRef.current.slice(2 * third)),
    ];

    const mdoc = doc(runRef, 'minutes', String(saveBlockIdx));

    const targetBit = target === 'BLUE' ? 1 : 0;

    await setDoc(
      mdoc,
      {
        idx: saveBlockIdx,
        kind: 'instant',
        ended_by: 'instant_process',
        startedAt: serverTimestamp(),
        fetch_triggered_at: fetchTriggeredAtRef.current,

        // Subject data
        n,
        hits: k,
        z,
        pTwo,
        coherence: { cumRange: cohRange, hurst },
        resonance: { ac1 },

        // Demon data
        demon_hits: kd,
        demon_z: zd,
        demon_pTwo: pd,
        demon_metrics: {
          coherence: { cumRange: dCohRange, hurst: dHurst },
          resonance: { ac1: dAc1 },
        },

        // Entropy
        entropy: {
          block_idx: saveBlockIdx,
          block_timestamp: new Date().toISOString(),
          block_entropy_subj: blockSubjEntropy,
          block_entropy_demon: blockDemonEntropy,
          block_k2_subj: blockK2Subj,
          block_k2_demon: blockK2Demon,
          block_k3_subj: blockK3Subj,
          block_k3_demon: blockK3Demon,
          bits_count: n,
        },

        // Store bit sequences
        trial_data: {
          subject_bits: bitsRef.current,
          demon_bits: demonBitsRef.current,
          target_bit: targetBit,
          trial_count: n,
        },

        // Hurst delta for this block
        hurst_delta: {
          subject: hurst,
          pcs: dHurst,
          delta: hurst - dHurst,
        },

        // Cryptographic authentication of quantum bitstream
        auth: blockAuthRef.current
          ? {
              hash: blockAuthRef.current.hash,
              timestamp: blockAuthRef.current.timestamp,
              source: blockAuthRef.current.source,
              bitCount: blockAuthRef.current.bitCount,
            }
          : null,
      },
      { merge: true },
    );
  }, [runRef, target]);

  const endMinute = useCallback(async () => {
    setIsRunning(false);
    await persistMinute();
    if (minuteInvalidRef.current) {
      setPhase('rest');
      return;
    }
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
      saveSessionAggregates(), // Update aggregates after each block
    ])
      .then(() => {
        setNeedsPersist(false);
      })
      .catch((err) => {
        console.error('❌ Failed to save block data:', err);
        setNeedsPersist(false);
      });
  }, [needsPersist, runRef, persistMinute, saveSessionAggregates]);

  // Note: Trial processing is now handled instantly by processTrials() function
  // No tick loop needed since all trials are processed at once

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
    const analysisForConfetti = cumulativeAnalysis || sessionAnalysis;
    if (!analysisForConfetti) return;
    const { eligible } = evaluatePrescreen(analysisForConfetti, C);
    if (!eligible) return;
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
    phase,
    sessionAnalysis,
    subjectBitsHistory,
    hurstSubjectHistory,
    hurstDemonHistory,
    totalGhostHits,
    totals.n,
  ]);

  // Save cumulative data and (for session 5+) compute cumulative analysis when entering results phase
  useEffect(() => {
    if (phase !== 'results') return;
    if (isAutoMode || isAIMode) return; // never accumulate baseline/AI sessions
    if (savedCumulativeRef.current) return; // already saved this session

    const newCount = sessionCount + 1;

    // Combine past-session data (loaded from session query at consent) with current session
    const newH_s = [...pastH_s, ...hurstSubjectHistory];
    const newH_d = [...pastH_d, ...hurstDemonHistory];
    const newBits = [...pastBits, ...subjectBitsHistory]; // arrays of 0|1 (not strings)
    const newDemonHits = pastDemonHits + totalGhostHits;
    const newDemonTrials = pastDemonTrials + totals.n;

    if (newH_s.length === 0) return;

    // Mark session as completed and save scalars-only participant profile
    if (participantHash) {
      savedCumulativeRef.current = true;

      // Mark session complete only when all blocks are accounted for
      if (runRef && allRawBitsRef.current.length === C.BLOCKS_TOTAL) {
        setDoc(runRef, { completed: true }, { merge: true }).catch(
          console.error,
        );
      }

      // Participant doc: scalars only — no growing arrays
      const profRef = doc(
        db,
        C.PARTICIPANT_COLLECTION,
        participantHash,
      );
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
          ...(!participantProfile
            ? { created_at: serverTimestamp() }
            : {}),
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
  }, [
    phase,
    sessionCount,
    cumulativeAnalysis,
    participantProfile,
    participantHash,
    emailPlaintext,
    runRef,
    isAutoMode,
    isAIMode,
    hurstSubjectHistory,
    hurstDemonHistory,
    subjectBitsHistory,
    totalGhostHits,
    totals.n,
    pastH_s,
    pastH_d,
    pastBits,
    pastDemonHits,
    pastDemonTrials,
  ]);

  // Save rank to session document once sessionAnalysis is ready
  useEffect(() => {
    if (!sessionAnalysis || !runRef) return;
    const {
      rank: rawRank,
      ksGate,
      collapseGate,
      pcsWarning,
      eligible,
      intensityTier,
    } = evaluatePrescreen(sessionAnalysis, C);
    const sessionKind = isAutoMode
      ? 'baseline'
      : isAIMode
        ? 'ai'
        : 'human';
    const rank = `${rawRank}-${sessionKind}`; // e.g. 'gold-human', 'none-baseline', 'silver-ai'
    const pcs = sessionAnalysis.pcs;
    setDoc(
      runRef,
      {
        prescreen_rank: rank,
        prescreen_eligible: eligible,
        prescreen_ks_p: sessionAnalysis.ks.originalP,
        prescreen_ks_gate: ksGate,
        prescreen_collapse_p: sessionAnalysis.shuffle.collapseP,
        prescreen_ddrop: sessionAnalysis.shuffle.dDrop,
        prescreen_collapse_gate: collapseGate,
        prescreen_intensity_tier: intensityTier ?? 'none',
        prescreen_pcs_warning: pcsWarning,
        prescreen_pcs_nullz: pcs.nullZ,
        prescreen_pcs_ghostz: pcs.ghostZ,
        prescreen_pcs_sdratio: pcs.sdRatio,
        prescreen_pcs_crosscorr: pcs.crossCorr,
      },
      { merge: true },
    ).catch(console.error);
  }, [sessionAnalysis, runRef]); // eslint-disable-line react-hooks/exhaustive-deps

  // ===== flow gates =====
  if (!userReady || !target || !checkedReturning) {
    return <div style={{ padding: 24 }}>Loading…</div>;
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
            // Reset cumulative analysis so it's recomputed fresh for this session
            setCumulativeAnalysis(null);
            savedCumulativeRef.current = false;
            let profile = null;
            if (email) {
              setEmailPlaintext(email);
              // Primary: email hash → prescreen_participants profile + session query
              try {
                const hash = await hashEmail(email);
                setParticipantHash(hash);
                const profRef = doc(
                  db,
                  C.PARTICIPANT_COLLECTION,
                  hash,
                );
                const profSnap = await getDoc(profRef);
                profile = profSnap.exists() ? profSnap.data() : null;
                setParticipantProfile(profile);

                // Query past sessions for cumulative reconstruction
                try {
                  const sessionsQ = query(
                    collection(db, C.PRESCREEN_COLLECTION),
                    where('participant_hash', '==', hash),
                    where('completed', '==', true),
                    orderBy('createdAt', 'asc'),
                    limit(50),
                  );
                  const snap = await getDocs(sessionsQ);
                  let cumH_s = [],
                    cumH_d = [],
                    cumBits = [];
                  let cumDemonHits = 0,
                    cumDemonTrials = 0,
                    completedCount = 0;
                  for (const d of snap.docs) {
                    const data = d.data();
                    const isHuman =
                      !data.session_type ||
                      data.session_type === 'human';
                    if (!isHuman) continue;
                    completedCount++;
                    const h_s = data.aggregates?.hurst_subject;
                    const h_d = data.aggregates?.hurst_demon;
                    const bitsB64 = data.raw_bits_b64;
                    if (
                      Array.isArray(h_s) &&
                      h_s.length > 0 &&
                      bitsB64
                    ) {
                      cumH_s.push(...h_s);
                      cumH_d.push(...h_d);
                      // Unpack full 301-bit calls; re-derive subject half using assignment bit
                      const blocks301 = unpackBitsFromBase64(
                        bitsB64,
                        h_s.length,
                        C.BITS_PER_BLOCK,
                      );
                      const n = C.TRIALS_PER_BLOCK;
                      for (const block of blocks301) {
                        const subjectGetsFirstHalf = block[0] === 1;
                        const halfA = block.slice(1, 1 + n);
                        const halfB = block.slice(1 + n, 1 + 2 * n);
                        cumBits.push(
                          subjectGetsFirstHalf ? halfA : halfB,
                        );
                      }
                    }
                    cumDemonHits +=
                      data.aggregates?.totalGhostHits ?? 0;
                    cumDemonTrials +=
                      data.aggregates?.totalTrials ?? 0;
                  }
                  setPastH_s(cumH_s);
                  setPastH_d(cumH_d);
                  setPastBits(cumBits);
                  setPastDemonHits(cumDemonHits);
                  setPastDemonTrials(cumDemonTrials);
                  setSessionCount(completedCount);
                } catch (err) {
                  console.error(
                    'Session history query failed (non-blocking):',
                    err,
                  );
                  setSessionCount(profile?.session_count ?? 0);
                }
              } catch (err) {
                console.error(
                  'Profile load error (non-blocking):',
                  err,
                );
              }
            } else if (uid) {
              // Fallback: UID → exp5-specific counter on participants/{uid}
              // (scoped to this experiment so it doesn't collide with other studies)
              try {
                const uidRef = doc(db, 'participants', uid);
                const uidSnap = await getDoc(uidRef);
                if (uidSnap.exists()) {
                  setSessionCount(
                    uidSnap.data().exp5_prescreen_sessions ?? 0,
                  );
                }
              } catch (err) {
                console.error(
                  'UID session count load failed (non-blocking):',
                  err,
                );
              }
            }
            let localPreDone = false;
            try {
              localPreDone =
                localStorage.getItem(
                  `pre_done_global:${C.EXPERIMENT_ID}`,
                ) === '1';
            } catch {}
            const skipPreQ =
              profile?.pre_q_completed || preDone || localPreDone;
            setPhase(skipPreQ ? 'onboarding' : 'preQ');
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
                userReady: userReady,
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

    // AI mode - auto-initialize runRef to enable Continue button (but still require AI to click it)
    if (isAIMode && !canContinue && !isRunning && target && uid) {
      ensureRunDoc().catch((err) => {
        console.error(
          '❌ AI-MODE: Failed to initialize runRef:',
          err,
        );
      });
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
                    setPhase('rest');
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
    const completedBlockIdx = blockIdxToPersist.current;
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
            setPhase('fetching');
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
    const completedBlockIdx = blockIdxToPersist.current;
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
                setPhase('summary');
                return;
              }

              // Cumulative data already saved in results phase — just update session count and proceed
              setSessionCount(sessionCount + 1);
              setPhase('summary');
            } catch (e) {
              console.warn('Post survey save error:', e);
              setPhase('summary');
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
      setPhase('summary');
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

    // Sessions 1–4: simplified view — hit rate + "need more sessions" message
    const isDecisionSession =
      sessionCount + 1 >= C.MIN_SESSIONS_FOR_DECISION;
    if (!isDecisionSession) {
      const remaining =
        C.MIN_SESSIONS_FOR_DECISION - (sessionCount + 1);
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
            onClick={() => setPhase('done')}
            style={{ marginTop: 8 }}
          >
            Continue
          </button>
        </div>
      );
    }

    // Session 5+: wait for cumulative analysis
    if (!cumulativeAnalysis) {
      return (
        <div style={{ padding: 24, textAlign: 'center' }}>
          Computing cumulative analysis…
        </div>
      );
    }

    const analysis = cumulativeAnalysis;
    const cumNBlocks = analysis.nBlocks; // total blocks across all sessions
    const finalDeltaH = analysis.deltaH.meanDeltaH;

    // ── Evaluation on cumulative data ─────────────────────────────────────────
    const {
      ksGate,
      collapseGate,
      eligible,
      rank: rawRank,
      intensityTier,
    } = evaluatePrescreen(analysis, C);
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
                  CUMULATIVE ANALYSIS · {sessionCount + 1} SESSIONS
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
    // Compute invite eligibility from sessionAnalysis (single source of truth)
    // In preview mode (#preview) force gold so the invite UI is visible for review
    const isCumulativeSession =
      sessionCount >= C.MIN_SESSIONS_FOR_DECISION;
    const analysisToUse = cumulativeAnalysis || sessionAnalysis;
    let inviteEligible = isPreviewMode;
    let summaryRank = isPreviewMode ? 'gold' : null;
    if (!isPreviewMode && analysisToUse) {
      const { rank: r, eligible } = evaluatePrescreen(
        analysisToUse,
        C,
      );
      summaryRank = r;
      inviteEligible = eligible || r === 'candidate'; // gold, silver, and candidate all get invite
    }

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
