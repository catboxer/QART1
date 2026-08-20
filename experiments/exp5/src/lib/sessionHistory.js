import { unpackBitsFromBase64 } from './rawBitsCodec.js';

/**
 * Build cumulative participant history from Firestore session snap docs.
 *
 * sessionCount    — all completed human sessions (for display / profile write).
 * usableSessionCount — sessions with valid hurst_subject + hurst_demon + raw_bits_b64
 *                      (gates the cumulative analysis verdict).
 *
 * @param {Array} snapDocs  - snap.docs from a Firestore getDocs() call
 * @param {object} C        - config object (needs BITS_PER_BLOCK, TRIALS_PER_BLOCK)
 * @returns {{
 *   sessionCount: number,
 *   usableSessionCount: number,
 *   pastH_s: number[],
 *   pastH_d: number[],
 *   pastBits: number[][],
 *   pastDemonBits: number[][],
 *   pastDemonHits: number,
 *   pastDemonTrials: number,
 *   pastSubjectHits: number,
 * }}
 *
 * NOTE: pastBits and pastDemonBits are always the same length — one entry per usable block.
 * Sessions predating the demon-bits feature will have raw_bits_b64 with both halves packed,
 * so both arrays are reconstructed together or not at all (usability gate includes raw_bits_b64).
 */
export function buildParticipantHistory(snapDocs, C, { includeAllTypes = false } = {}) {
  let cumH_s = [], cumH_d = [], cumBits = [], cumDemonBits = [];
  let cumDemonHits = 0, cumDemonTrials = 0, cumSubjectHits = 0;
  let sessionCount = 0, usableSessionCount = 0;

  for (const d of snapDocs) {
    const data = d.data();
    const isHuman = !data.session_type || data.session_type === 'human';
    if (!includeAllTypes && !isHuman) continue;

    sessionCount++; // count every completed human session for display

    const h_s = data.aggregates?.hurst_subject;
    const h_d = data.aggregates?.hurst_demon;
    const bitsB64 = data.raw_bits_b64;


    // Only count sessions that have usable Hurst + bit data.
    // Sessions missing this data don't contribute to the analysis,
    // so they must not count toward the usable threshold either.
    if (Array.isArray(h_s) && h_s.length > 0 && Array.isArray(h_d) && bitsB64) {
      usableSessionCount++;
      cumH_s.push(...h_s);
      cumH_d.push(...h_d);
      cumSubjectHits += data.aggregates?.totalHits      ?? 0;
      cumDemonHits   += data.aggregates?.totalGhostHits ?? 0;
      cumDemonTrials += data.aggregates?.totalTrials    ?? 0;

      // Unpack full BITS_PER_BLOCK calls; re-derive subject half via assignment bit
      const blocks = unpackBitsFromBase64(bitsB64, h_s.length, C.BITS_PER_BLOCK);
      const n = C.TRIALS_PER_BLOCK;
      for (const block of blocks) {
        const subjectGetsFirstHalf = block[0] === 1;
        const halfA = block.slice(1, 1 + n);
        const halfB = block.slice(1 + n, 1 + 2 * n);
        cumBits.push(subjectGetsFirstHalf ? halfA : halfB);
        cumDemonBits.push(subjectGetsFirstHalf ? halfB : halfA);
      }
    }
  }

  return {
    sessionCount,
    usableSessionCount,
    pastH_s:         cumH_s,
    pastH_d:         cumH_d,
    pastBits:        cumBits,
    pastDemonBits:   cumDemonBits,
    pastSubjectHits: cumSubjectHits,
    pastDemonHits:   cumDemonHits,
    pastDemonTrials: cumDemonTrials,
  };
}
