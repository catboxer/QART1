import { useState, useRef, useCallback } from 'react';
import {
  collection, addDoc, setDoc, serverTimestamp,
} from 'firebase/firestore';
import { packBitsToBase64, unpackBitsFromBase64 } from '../lib/rawBitsCodec.js';
import { normalCdf } from '../stats/index.js';

// Linear regression of ys ~ index; returns slope + two-tailed p-value.
function linReg(ys) {
  const n = ys.length;
  if (n < 3) return { slope: null, pValue: null };
  const xMean = (n - 1) / 2;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;
  const Sxx = ys.reduce((s, _, i) => s + (i - xMean) ** 2, 0);
  const Sxy = ys.reduce((s, y, i) => s + (i - xMean) * (y - yMean), 0);
  const slope = Sxy / Sxx;
  const intercept = yMean - slope * xMean;
  const sse = ys.reduce((s, y, i) => s + (y - (intercept + slope * i)) ** 2, 0);
  const seSlope = Math.sqrt(sse / (n - 2) / Sxx);
  const t = seSlope > 0 ? slope / seSlope : 0;
  return { slope, pValue: 2 * (1 - normalCdf(Math.abs(t))) };
}

// Run-length encode an array of strings → [[value, count], ...]
function rleEncode(arr) {
  if (!arr.length) return [];
  const out = [];
  let cur = arr[0], count = 1;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] === cur) { count++; }
    else { out.push([cur, count]); cur = arr[i]; count = 1; }
  }
  out.push([cur, count]);
  return out;
}

/**
 * Owns Firestore run-doc creation and session-level aggregate writes.
 *
 * runRef is created lazily via ensureRunDoc — never derived from blockIdx or phase.
 * lastPersistedBlockRef lives here (persistence concern, not trial concern).
 *
 * @param {{
 *   db, C,
 *   target, uid, requireUid,
 *   participantHash, isAutoMode, isAIMode,
 *   totals, totalGhostHits,
 *   deltaHurstHistory, hurstSubjectHistory, hurstDemonHistory,
 *   allRawBitsRef, qrngProviderRef, qrngProviderSeqRef,
 * }} options
 */
export function useSessionPersistence({
  db, C,
  target, uid, requireUid,
  participantHash, isAutoMode, isAIMode,
  totals, totalGhostHits,
  deltaHurstHistory, hurstSubjectHistory, hurstDemonHistory,
  allRawBitsRef, qrngProviderRef, qrngProviderSeqRef,
}) {
  const [runRef, setRunRef] = useState(null);
  const ensureRunDocPromiseRef = useRef(null);
  const isCreatingDocRef = useRef(false);

  // lastPersistedBlockRef: persistence concern — guards double-saves across renders.
  // Reset to -1 on session reset (caller's responsibility via the returned setter).
  const lastPersistedBlockRef = useRef(-1);

  // ── ensureRunDoc: idempotent run-doc creation ────────────────────────────────
  const ensureRunDoc = useCallback(async () => {
    console.log('[ensureRunDoc] called — runRef:', !!runRef, 'isCreating:', isCreatingDocRef.current, 'hasPending:', !!ensureRunDocPromiseRef.current, 'target:', !!target, 'uid:', uid ? uid.substring(0, 8) : null);
    if (runRef) return runRef;

    // If already creating, wait for the existing promise
    if (isCreatingDocRef.current || ensureRunDocPromiseRef.current) {
      console.log('[ensureRunDoc] deduped — awaiting existing promise');
      return await ensureRunDocPromiseRef.current;
    }

    isCreatingDocRef.current = true;

    const createPromise = (async () => {
      try {
        if (!target)
          throw new Error('logic/order: target must be set before creating run');
        const uidNow = uid || (await requireUid());

        const col = collection(db, C.PRESCREEN_COLLECTION);
        const now = new Date();
        const day_bucket = now.toISOString().slice(0, 10);
        const startOfWeek = new Date(now);
        startOfWeek.setUTCDate(now.getUTCDate() - now.getUTCDay());
        const week_bucket = startOfWeek.toISOString().slice(0, 10);

        console.log('[ensureRunDoc] calling addDoc — uid:', uidNow.substring(0, 8), 'collection:', C.PRESCREEN_COLLECTION);
        const docRef = await addDoc(col, {
          participant_id: uidNow,
          participant_hash: participantHash || null,
          experimentId: C.EXPERIMENT_ID,
          createdAt: serverTimestamp(),
          blocks_planned: C.BLOCKS_TOTAL,
          timestamp: now.toISOString(),
          session_type: isAutoMode ? 'baseline' : isAIMode ? 'ai_agent' : 'human',
          app_version: C.APP_VERSION,
          day_bucket,
          week_bucket,
          exitedEarly: false,
        });
        console.log('[ensureRunDoc] addDoc success:', docRef.id);
        setRunRef(docRef);
        return docRef;
      } catch (error) {
        console.error('[ensureRunDoc] addDoc FAILED:', error);
        throw error;
      } finally {
        ensureRunDocPromiseRef.current = null;
        isCreatingDocRef.current = false;
      }
    })();

    ensureRunDocPromiseRef.current = createPromise;
    return await createPromise;
  }, [runRef, target, uid, requireUid, isAutoMode, isAIMode, participantHash]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── saveSessionAggregates: end-of-session write ──────────────────────────────
  const saveSessionAggregates = useCallback(async () => {
    if (!runRef) return;

    try {
      const hitRate      = totals.n > 0 ? totals.k / totals.n        : 0.5;
      const ghostHitRate = totals.n > 0 ? totalGhostHits / totals.n  : 0.5;

      const meanDH = deltaHurstHistory.length > 0
        ? deltaHurstHistory.reduce((a, b) => a + b, 0) / deltaHurstHistory.length
        : 0;

      const splitAt = Math.floor(C.BLOCKS_TOTAL / 2);
      const early = deltaHurstHistory.slice(0, splitAt);
      const late  = deltaHurstHistory.slice(splitAt);
      const mean_deltaH_early = early.length > 0
        ? early.reduce((a, b) => a + b, 0) / early.length : null;
      const mean_deltaH_late = late.length > 0
        ? late.reduce((a, b) => a + b, 0) / late.length : null;
      const { slope: reg_slope, pValue: reg_pValue } = linReg(deltaHurstHistory);

      const raw_bits_b64 = allRawBitsRef.current.length > 0
        ? packBitsToBase64(allRawBitsRef.current)
        : null;

      // Dev-mode round-trip integrity check — zero cost in production
      if (process.env.NODE_ENV === 'development' && raw_bits_b64) {
        const orig = allRawBitsRef.current;
        const rt = unpackBitsFromBase64(raw_bits_b64, orig.length, C.BITS_PER_BLOCK);
        let ok = rt.length === orig.length;
        if (ok) {
          const checkIdxs = [0, Math.floor(orig.length / 2), orig.length - 1];
          outer: for (const bi of checkIdxs) {
            if (rt[bi].length !== orig[bi].length) { ok = false; break; }
            for (let i = 0; i < orig[bi].length; i++) {
              if (rt[bi][i] !== orig[bi][i]) { ok = false; break outer; }
            }
          }
        }
        if (!ok) console.error('❌ raw_bits_b64 round-trip FAILED — packing corruption');
        else console.log(`✅ raw_bits_b64 round-trip OK (${orig.length} blocks × ${C.BITS_PER_BLOCK} bits)`);
      }

      await setDoc(
        runRef,
        {
          block_count_actual: deltaHurstHistory.length,
          blocks_expected: C.BLOCKS_TOTAL,
          qrng_provider: qrngProviderRef.current,
          qrng_provider_sequence: rleEncode(qrngProviderSeqRef.current),
          aggregates: {
            totalHits: totals.k,
            totalTrials: totals.n,
            totalGhostHits,
            hitRate,
            ghostHitRate,
            blocksCompleted: deltaHurstHistory.length,
            blocksPlanned: C.BLOCKS_TOTAL,
            sessionComplete: deltaHurstHistory.length >= C.BLOCKS_TOTAL,
            lastUpdated: new Date().toISOString(),
            hurst_subject: hurstSubjectHistory,
            hurst_demon: hurstDemonHistory,
            delta_h: deltaHurstHistory,
            hurstDelta: { mean: meanDH, blockDeltas: deltaHurstHistory },
          },
          ...(raw_bits_b64 ? { raw_bits_b64 } : {}),
          demon_hits_total:    totalGhostHits,
          demon_trials_total:  totals.n,
          demon_mean_hit_rate: ghostHitRate,
          monitoring: {
            mean_deltaH_early,
            mean_deltaH_late,
            difference: mean_deltaH_early !== null && mean_deltaH_late !== null
              ? mean_deltaH_late - mean_deltaH_early : null,
            reg_slope,
            reg_pValue,
          },
        },
        { merge: true },
      );

      console.log('✅ Session aggregates saved:', runRef.id, {
        hitRate, ghostHitRate, blocks: deltaHurstHistory.length,
      });
    } catch (error) {
      console.error('❌ Failed to save session aggregates:', error);
    }
  }, [runRef, totals, totalGhostHits, deltaHurstHistory, hurstSubjectHistory, hurstDemonHistory]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    runRef,
    setRunRef,             // for auto-mode session reset to clear runRef
    ensureRunDoc,
    lastPersistedBlockRef,
    saveSessionAggregates,
  };
}
