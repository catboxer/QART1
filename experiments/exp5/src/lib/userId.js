import { USER_ID_WORDS } from './userIdWords.js';

const WORDS_PER_ID = 4; // 300 words, 4 distinct = ~8 billion possible IDs

/** Cryptographically-sourced random integer in [0, max), without modulo bias. */
function randomInt(max) {
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  do {
    crypto.getRandomValues(buf);
  } while (buf[0] >= limit);
  return buf[0] % max;
}

/** A new random user ID: four distinct words joined by hyphens, e.g. "falcon-otter-meadow-copper". */
export function generateUserId() {
  const used = new Set();
  const chosen = [];
  while (chosen.length < WORDS_PER_ID) {
    const i = randomInt(USER_ID_WORDS.length);
    if (used.has(i)) continue;
    used.add(i);
    chosen.push(USER_ID_WORDS[i]);
  }
  return chosen.join('-');
}

/**
 * Tidy what a person typed so "Falcon Otter  meadow-copper" matches "falcon-otter-meadow-copper":
 * lowercase, spaces/underscores/commas/dots become single hyphens.
 */
export function normalizeUserId(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_,.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** True if the (normalized) text looks like a four-word user ID. */
export function looksLikeUserId(raw) {
  return /^[a-z]+(-[a-z]+){3}$/.test(normalizeUserId(raw));
}
