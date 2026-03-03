import { useRef, useCallback, useEffect } from 'react';
import {
  doc, setDoc, updateDoc, serverTimestamp, increment, arrayUnion,
} from 'firebase/firestore';
import { fetchQRNGBits } from '../fetchQRNGBits.js';
import { runNISTAudit } from '../nistTests.js';
import { splitBlockBits, computeBlockStats } from '../lib/trialBlock.js';
import {
  zFromBinom, twoSidedP, cumulativeRange,
  hurstApprox, lag1Autocorr, shannonEntropy,
} from '../stats/index.js';

/**
 * Owns all trial-execution concerns: refs, processTrials (INTERNAL),
 * persistMinute (INTERNAL), endMinute, fetching effect, audit effect,
 * and the block-persistence effect.
 *
 * Trial state (blockIdx, totals, etc.) lives in MainApp to avoid a circular
 * dependency with useSessionPersistence, which closes over those same values.
 *
 * Non-negotiable invariant: processTrials is NOT in the public API.
 * blockIdxToPersistRef is written ONLY here, never re-derived from blockIdx.
 *
 * @param {{
 *   C,
 *   phase, target, setTarget,
 *   isAutoMode, isAIMode,
 *   goToScore, goToRest, goToResults,
 *   runRef,
 *   blockIdx, setblockIdx,
 *   setIsRunning, setLastBlock,
 *   setTotals, setTotalGhostHits,
 *   setDeltaHurstHistory, setHurstSubjectHistory,
 *   setHurstDemonHistory, setSubjectBitsHistory,
 *   saveSessionAggregates, lastPersistedBlockRef,
 *   fetchTriggeredAtRef, allRawBitsRef, qrngProviderRef, qrngProviderSeqRef,
 * }} options
 */
export function useTrialRunner({
  C,
  phase, target, setTarget,
  isAutoMode, isAIMode,
  goToScore, goToRest, goToResults,
  runRef,
  blockIdx, setblockIdx,
  setIsRunning, setLastBlock,
  setTotals, setTotalGhostHits,
  setDeltaHurstHistory, setHurstSubjectHistory,
  setHurstDemonHistory, setSubjectBitsHistory,
  saveSessionAggregates, lastPersistedBlockRef,
  fetchTriggeredAtRef, allRawBitsRef, qrngProviderRef, qrngProviderSeqRef,
}) {
  // ── Block-data refs ──────────────────────────────────────────────────────────
  const bitsRef      = useRef([]);
  const demonBitsRef = useRef([]);
  const alignedRef   = useRef([]);
  const hitsRef      = useRef(0);
  const demonHitsRef = useRef(0);
  const blockAuthRef = useRef(null);
  const auditAuthRef = useRef(null);

  // Written once per block in the fetching effect BEFORE processTrials increments blockIdx.
  // Never re-derived from blockIdx or history lengths.
  const blockIdxToPersistRef = useRef(-1);

  // Misc
  const minuteInvalidRef = useRef(false);
  const endMinuteRef     = useRef(() => {});

  // ── processTrials — INTERNAL, not in public API ──────────────────────────────
  const processTrials = useCallback(
    (quantumBits) => {
      if (quantumBits.length !== C.BITS_PER_BLOCK) {
        throw new Error(`Expected ${C.BITS_PER_BLOCK} bits, got ${quantumBits.length}`);
      }

      // Reset per-block refs
      bitsRef.current      = [];
      demonBitsRef.current = [];
      alignedRef.current   = [];
      hitsRef.current      = 0;
      demonHitsRef.current = 0;

      const targetBit = target === 'BLUE' ? 1 : 0;

      const { parsedSubjectBits, parsedDemonBits } = splitBlockBits(quantumBits, C.TRIALS_PER_BLOCK);
      const { k, kd, blockSubjHurst, blockPCSHurst, blockDeltaH, blockSummary } =
        computeBlockStats(parsedSubjectBits, parsedDemonBits, targetBit);

      bitsRef.current      = parsedSubjectBits;
      demonBitsRef.current = parsedDemonBits;
      alignedRef.current   = parsedSubjectBits.map((b) => (b === targetBit ? 1 : 0));
      hitsRef.current      = k;
      demonHitsRef.current = kd;

      setLastBlock(blockSummary);
      setTotals((t) => ({ k: t.k + k, n: t.n + parsedSubjectBits.length }));
      setTotalGhostHits((t) => t + kd);
      setDeltaHurstHistory((prev) => [...prev, blockDeltaH]);
      setHurstSubjectHistory((prev) => [...prev, blockSubjHurst]);
      setHurstDemonHistory((prev) => [...prev, blockPCSHurst]);
      setSubjectBitsHistory((prev) => [...prev, parsedSubjectBits]);

      // Increment block index last — the block-persistence effect fires on this change
      setblockIdx((prev) => prev + 1);
    },
    [target], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ── persistMinute — INTERNAL ────────────────────────────────────────────────
  const persistMinute = useCallback(async () => {
    if (!runRef) return;

    const saveBlockIdx = blockIdxToPersistRef.current;
    if (saveBlockIdx < 0 || saveBlockIdx >= C.BLOCKS_TOTAL) return;

    const n  = C.TRIALS_PER_BLOCK;
    const k  = hitsRef.current;
    const kd = demonHitsRef.current;

    const z    = zFromBinom(k, n, 0.5);
    const pTwo = twoSidedP(z);
    const zd   = zFromBinom(kd, n, 0.5);
    const pd   = twoSidedP(zd);

    // Subject metrics
    const cohRange = cumulativeRange(bitsRef.current);
    const hurst    = hurstApprox(bitsRef.current);
    const ac1      = lag1Autocorr(bitsRef.current);

    // Demon metrics
    const dCohRange = cumulativeRange(demonBitsRef.current);
    const dHurst    = hurstApprox(demonBitsRef.current);
    const dAc1      = lag1Autocorr(demonBitsRef.current);

    // Entropy
    const blockSubjEntropy  = bitsRef.current.length > 0      ? shannonEntropy(bitsRef.current)      : null;
    const blockDemonEntropy = demonBitsRef.current.length > 0  ? shannonEntropy(demonBitsRef.current) : null;

    // k2 split
    const half = Math.floor(n / 2);
    const blockK2Subj = [
      shannonEntropy(bitsRef.current.slice(0, half)),
      shannonEntropy(bitsRef.current.slice(half)),
    ];
    const blockK2Demon = [
      shannonEntropy(demonBitsRef.current.slice(0, half)),
      shannonEntropy(demonBitsRef.current.slice(half)),
    ];

    // k3 split
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

    const mdoc      = doc(runRef, 'minutes', String(saveBlockIdx));
    const targetBit = target === 'BLUE' ? 1 : 0;

    await setDoc(
      mdoc,
      {
        idx:       saveBlockIdx,
        kind:      'instant',
        ended_by:  'instant_process',
        startedAt: serverTimestamp(),
        fetch_triggered_at: fetchTriggeredAtRef.current,

        // Subject
        n, hits: k, z, pTwo,
        coherence: { cumRange: cohRange, hurst },
        resonance: { ac1 },

        // Demon
        demon_hits: kd, demon_z: zd, demon_pTwo: pd,
        demon_metrics: {
          coherence: { cumRange: dCohRange, hurst: dHurst },
          resonance: { ac1: dAc1 },
        },

        // Entropy
        entropy: {
          block_idx:           saveBlockIdx,
          block_timestamp:     new Date().toISOString(),
          block_entropy_subj:  blockSubjEntropy,
          block_entropy_demon: blockDemonEntropy,
          block_k2_subj:       blockK2Subj,
          block_k2_demon:      blockK2Demon,
          block_k3_subj:       blockK3Subj,
          block_k3_demon:      blockK3Demon,
          bits_count:          n,
        },

        // Raw trial data
        trial_data: {
          subject_bits: bitsRef.current,
          demon_bits:   demonBitsRef.current,
          target_bit:   targetBit,
          trial_count:  n,
        },

        // Hurst delta
        hurst_delta: {
          subject: hurst,
          pcs:     dHurst,
          delta:   hurst - dHurst,
        },

        // Cryptographic auth
        auth: blockAuthRef.current
          ? {
              hash:      blockAuthRef.current.hash,
              timestamp: blockAuthRef.current.timestamp,
              source:    blockAuthRef.current.source,
              bitCount:  blockAuthRef.current.bitCount,
            }
          : null,
      },
      { merge: true },
    );
  }, [runRef, target]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── endMinute ───────────────────────────────────────────────────────────────
  const endMinute = useCallback(async () => {
    setIsRunning(false);
    await persistMinute();
    if (minuteInvalidRef.current) {
      goToRest();
      return;
    }
    goToRest();
  }, [persistMinute, goToRest, setIsRunning]);

  useEffect(() => {
    endMinuteRef.current = endMinute;
  }, [endMinute]);

  // ── Fetching effect ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'fetching') return;
    if (blockIdx >= C.BLOCKS_TOTAL) {
      goToResults();
      return;
    }

    let isCancelled = false;

    (async () => {
      try {
        const quantumData = await fetchQRNGBits(C.BITS_PER_BLOCK);
        if (isCancelled) return;

        // Capture blockIdx BEFORE processTrials increments it — invariant #1
        blockIdxToPersistRef.current = blockIdx;

        blockAuthRef.current = {
          hash:     quantumData.hash,
          timestamp: quantumData.timestamp,
          source:   quantumData.source,
          bitCount: quantumData.bits.length,
        };

        // Track provider
        const src = quantumData.source;
        qrngProviderSeqRef.current.push(src);
        if (qrngProviderRef.current === null) {
          qrngProviderRef.current = src;
        } else if (qrngProviderRef.current !== src && qrngProviderRef.current !== 'mixed') {
          qrngProviderRef.current = 'mixed';
        }

        // ANTI-TIMING-ATTACK: commit bits to Firestore before processing
        if (runRef) {
          const blockCommitDoc = doc(runRef, 'block_commits', String(blockIdx));
          await setDoc(blockCommitDoc, {
            blockIdx,
            bits: quantumData.bits,
            auth: {
              hash:      quantumData.hash,
              timestamp: quantumData.timestamp,
              source:    quantumData.source,
              bitCount:  quantumData.bits.length,
            },
            committedAt:      serverTimestamp(),
            clientCommitTime: new Date().toISOString(),
            target,
          });
        }

        allRawBitsRef.current.push(quantumData.bits.split('').map(Number));

        processTrials(quantumData.bits);
        goToScore();
      } catch (error) {
        console.error('❌ Failed to fetch bits:', error);
        const errorDetails = {
          message:   error.message || String(error),
          stack:     error.stack,
          timestamp: new Date().toISOString(),
        };
        console.error('📋 Error details:', errorDetails);

        if (!isCancelled) {
          if (runRef) {
            await updateDoc(runRef, {
              exitedEarly:         true,
              exit_reason:         'qrng_unavailable',
              exit_error_details:  errorDetails,
              exit_block_index:    blockIdx,
            });
          }
          goToResults();
        }
      }
    })();

    return () => { isCancelled = true; };
  }, [phase, blockIdx, processTrials, isAutoMode, isAIMode, runRef, target]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Audit effect ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'audit') return;

    let isCancelled = false;

    (async () => {
      try {
        const auditData = await fetchQRNGBits(C.AUDIT_BITS_PER_BREAK, 3, false);
        if (isCancelled) return;

        auditAuthRef.current = {
          hash:     auditData.hash,
          timestamp: auditData.timestamp,
          source:   auditData.source,
          bitCount: auditData.bits.length,
        };

        const nistResults = runNISTAudit(auditData.bits);
        const isRandom    = nistResults.allTestsPass;
        const ones        = auditData.bits.split('').filter((b) => b === '1').length;
        const proportion  = ones / C.AUDIT_BITS_PER_BREAK;

        const validationStats = {
          nist: {
            allPass:    nistResults.allTestsPass,
            frequency:  {
              pValue: nistResults.tests.frequency.pValue,
              pass:   nistResults.tests.frequency.pass,
            },
            runs: {
              pValue:   nistResults.tests.runs.pValue,
              pass:     nistResults.tests.runs.pass,
              observed: nistResults.tests.runs.runsObserved,
            },
            longestRun: {
              pValue:     nistResults.tests.longestRun.pValue,
              pass:       nistResults.tests.longestRun.pass,
              chiSquared: nistResults.tests.longestRun.statistic,
              df:         nistResults.tests.longestRun.degreesOfFreedom,
            },
          },
          length:    auditData.bits.length,
          ones,
          onesRatio: (ones / auditData.bits.length).toFixed(4),
          reference: nistResults.reference,
        };

        const auditBitArray = auditData.bits.split('').map((b) => parseInt(b));
        const auditEntropy  = shannonEntropy(auditBitArray);

        if (runRef) {
          const auditDoc = doc(runRef, 'audits', `after_block_${blockIdx}`);
          await setDoc(auditDoc, {
            blockAfter:   blockIdx,
            totalBits:    C.AUDIT_BITS_PER_BREAK,
            auditBits:    auditData.bits,
            ones,
            proportion,
            entropy:      auditEntropy,
            isRandom,
            validation:   validationStats,
            timestamp:    Date.now(),
            auth: {
              hash:      auditData.hash,
              timestamp: auditData.timestamp,
              source:    auditData.source,
            },
          });

          if (!isRandom) {
            await setDoc(runRef, {
              audit_failure_count:  increment(1),
              audit_failed_blocks:  arrayUnion(blockIdx),
            }, { merge: true });
          }
        }

        // Randomize target for the next set of blocks
        const randomByte = crypto.getRandomValues(new Uint8Array(1))[0];
        setTarget(randomByte & 1 ? 'BLUE' : 'ORANGE');
      } catch (error) {
        console.error('❌ Audit failed:', error);
        // Don't block progression on audit failure
      }
    })();

    return () => { isCancelled = true; };
  }, [phase, blockIdx, runRef]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Block-persistence effect ─────────────────────────────────────────────────
  // Fires when blockIdx increments (same render as processTrials).
  // lastPersistedBlockRef guards against double-saves.
  useEffect(() => {
    const blockToSave = blockIdxToPersistRef.current;
    if (blockToSave < 0 || lastPersistedBlockRef.current >= blockToSave || !runRef) return;
    lastPersistedBlockRef.current = blockToSave;
    Promise.all([
      persistMinute(),
      saveSessionAggregates(),
    ]).catch((err) => {
      console.error('❌ Failed to save block data:', err);
    });
  }, [blockIdx, runRef, persistMinute, saveSessionAggregates]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    refs: {
      blockIdxToPersistRef,
      blockAuthRef,
      auditAuthRef,
      bitsRef,
      demonBitsRef,
      alignedRef,
      hitsRef,
      demonHitsRef,
    },
    endMinuteRef,
    minuteInvalidRef,
  };
}
