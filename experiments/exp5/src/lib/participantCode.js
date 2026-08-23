import { PARTICIPANT_CODE_WORDS } from './participantCodeWords.js';

/** Cryptographically-sourced random integer in [0, max). */
function randomInt(max) {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % max;
}

/**
 * Generates a 3-distinct-word participant code, e.g. "falcon-otter-meadow".
 *
 * Purely client-side -- no uniqueness check against storage. At 300 words
 * drawn 3 at a time without repeats, that's 300*299*298 (~26.7M) possible
 * codes, which keeps collision risk negligible at this study's scale
 * without ever needing a database lookup at generation time. See
 * participantCodeWords.js for the full rationale.
 */
export function generateParticipantCode() {
  const words = PARTICIPANT_CODE_WORDS;
  const usedIndices = new Set();
  const chosen = [];
  while (chosen.length < 3) {
    const idx = randomInt(words.length);
    if (usedIndices.has(idx)) continue;
    usedIndices.add(idx);
    chosen.push(words[idx]);
  }
  return chosen.join('-');
}
