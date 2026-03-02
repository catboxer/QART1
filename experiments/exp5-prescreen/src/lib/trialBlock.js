import { hurstApprox } from '../stats/coherence.js';
import { zFromBinom, twoSidedP } from '../stats/index.js';

/**
 * Split a raw QRNG bit string into assignment, subject, and demon halves.
 * Bit 0 is the assignment bit (QRNG-based, not Math.random).
 * Bits 1..n are halfA, bits n+1..2n are halfB.
 *
 * @param {string} rawBitString  - e.g. "10110..." (BITS_PER_BLOCK chars)
 * @param {number} trialsPerBlock
 * @returns {{ assignmentBit, subjectGetsFirstHalf, parsedSubjectBits, parsedDemonBits }}
 */
export function splitBlockBits(rawBitString, trialsPerBlock) {
  const n = trialsPerBlock;
  const assignmentBit = parseInt(rawBitString[0], 10);
  const subjectGetsFirstHalf = assignmentBit === 1;

  const halfA = rawBitString.slice(1, 1 + n);
  const halfB = rawBitString.slice(1 + n, 1 + 2 * n);

  const subjectStr = subjectGetsFirstHalf ? halfA : halfB;
  const demonStr   = subjectGetsFirstHalf ? halfB : halfA;

  const parsedSubjectBits = Array.from(subjectStr, (c) => parseInt(c, 10));
  const parsedDemonBits   = Array.from(demonStr,   (c) => parseInt(c, 10));

  return { assignmentBit, subjectGetsFirstHalf, parsedSubjectBits, parsedDemonBits };
}

/**
 * Compute all per-block statistics from parsed subject and demon bit arrays.
 *
 * @param {number[]} parsedSubjectBits
 * @param {number[]} parsedDemonBits
 * @param {number}   targetBit  - 1 for BLUE, 0 for ORANGE
 * @returns blockSummary object + extracted scalars
 */
export function computeBlockStats(parsedSubjectBits, parsedDemonBits, targetBit) {
  const n  = parsedSubjectBits.length;
  const k  = parsedSubjectBits.filter((b) => b === targetBit).length;
  const kd = parsedDemonBits.filter((b) => b === targetBit).length;

  const z   = zFromBinom(k,  n, 0.5);
  const zd  = zFromBinom(kd, n, 0.5);
  const pTwo = twoSidedP(z);
  const pd   = twoSidedP(zd);

  const blockSubjHurst = hurstApprox(parsedSubjectBits);
  const blockPCSHurst  = hurstApprox(parsedDemonBits);
  const blockDeltaH    = blockSubjHurst - blockPCSHurst;

  const blockSummary = {
    k, n, z, pTwo,
    kd, nd: n, zd, pd,
    kind: 'instant',
    subjectHurst: blockSubjHurst,
    pcsHurst:     blockPCSHurst,
    deltaH:       blockDeltaH,
  };

  return { k, kd, blockSubjHurst, blockPCSHurst, blockDeltaH, blockSummary };
}
