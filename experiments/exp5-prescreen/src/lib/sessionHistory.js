import { unpackBitsFromBase64 } from './rawBitsCodec.js';

/**
 * Build cumulative participant history from Firestore session snap docs.
 *
 * Only human sessions with valid hurst_subject arrays and raw_bits_b64 are
 * counted as "usable". Sessions missing these fields contribute nothing and
 * are excluded from usableSessionCount (which gates the cumulative verdict).
 *
 * @param {Array} snapDocs  - snap.docs from a Firestore getDocs() call
 * @param {object} C        - config object (needs BITS_PER_BLOCK, TRIALS_PER_BLOCK)
 * @returns {{
 *   usableSessionCount: number,
 *   pastH_s: number[],
 *   pastH_d: number[],
 *   pastBits: number[][],
 *   pastDemonHits: number,
 *   pastDemonTrials: number,
 * }}
 */
export function buildParticipantHistory(snapDocs, C) {
  let cumH_s = [], cumH_d = [], cumBits = [];
  let cumDemonHits = 0, cumDemonTrials = 0, usableSessionCount = 0;

  for (const d of snapDocs) {
    const data = d.data();
    const isHuman = !data.session_type || data.session_type === 'human';
    if (!isHuman) continue;

    const h_s = data.aggregates?.hurst_subject;
    const h_d = data.aggregates?.hurst_demon;
    const bitsB64 = data.raw_bits_b64;

    // Only count sessions that have usable Hurst + bit data.
    // Sessions missing this data don't contribute to the analysis,
    // so they must not count toward the session threshold either.
    if (Array.isArray(h_s) && h_s.length > 0 && bitsB64) {
      usableSessionCount++;
      cumH_s.push(...h_s);
      cumH_d.push(...h_d);
      cumDemonHits  += data.aggregates?.totalGhostHits ?? 0;
      cumDemonTrials += data.aggregates?.totalTrials   ?? 0;

      // Unpack full BITS_PER_BLOCK calls; re-derive subject half via assignment bit
      const blocks = unpackBitsFromBase64(bitsB64, h_s.length, C.BITS_PER_BLOCK);
      const n = C.TRIALS_PER_BLOCK;
      for (const block of blocks) {
        const subjectGetsFirstHalf = block[0] === 1;
        const halfA = block.slice(1, 1 + n);
        const halfB = block.slice(1 + n, 1 + 2 * n);
        cumBits.push(subjectGetsFirstHalf ? halfA : halfB);
      }
    }
  }

  return {
    usableSessionCount,
    pastH_s:        cumH_s,
    pastH_d:        cumH_d,
    pastBits:       cumBits,
    pastDemonHits,
    pastDemonTrials,
  };
}
