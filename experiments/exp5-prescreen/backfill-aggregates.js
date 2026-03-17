/**
 * backfill-aggregates.js
 *
 * Reconstructs missing aggregates + raw_bits_b64 for human sessions saved before
 * the import.meta.env.DEV bug was fixed (saveSessionAggregates crashed before setDoc ran).
 *
 * Sources used:
 *   block_commits/{idx}.bits  → raw QRNG bit string → reconstructs raw_bits_b64
 *   minutes/{idx}.hurst_delta → per-block Hurst values
 *   minutes/{idx}.hits/n/demon_hits → hit totals
 *
 * Run from experiments/exp5-prescreen/:
 *   node backfill-aggregates.js
 */

'use strict';

const admin = require('firebase-admin');
const fs    = require('fs');
const path  = require('path');

const serviceAccountPath = path.resolve(__dirname, '../../serviceAccountKey.json');
if (!fs.existsSync(serviceAccountPath)) {
  console.error('serviceAccountKey.json not found at:', serviceAccountPath);
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(require(serviceAccountPath)) });
const db = admin.firestore();

const PRESCREEN_COLLECTION = 'prescreen_sessions_exp5';
const TRIALS_PER_BLOCK = 150;
const BITS_PER_BLOCK   = 1 + 2 * TRIALS_PER_BLOCK; // 301

// Mirrors rawBitsCodec.js packBitsToBase64 — uses Buffer instead of btoa for Node.js
function packBitsToBase64(bitsPerBlock) {
  const totalBits = bitsPerBlock.reduce((s, b) => s + b.length, 0);
  const nBytes    = Math.ceil(totalBits / 8);
  const bytes     = new Uint8Array(nBytes);
  let globalBit   = 0;
  for (const block of bitsPerBlock) {
    for (const bit of block) {
      bytes[Math.floor(globalBit / 8)] |= bit << (7 - (globalBit % 8));
      globalBit++;
    }
  }
  return Buffer.from(bytes).toString('base64');
}

async function backfillSession(sessionDoc) {
  const data      = sessionDoc.data();
  const sessionId = sessionDoc.id;

  // Already complete — skip
  if (data.aggregates?.hurst_subject?.length > 0 && data.raw_bits_b64) {
    console.log(`  ✓  ${sessionId}: already complete, skipping`);
    return 'skipped';
  }

  // Read minutes subcollection — Hurst values + hit totals
  const minutesSnap = await db
    .collection(PRESCREEN_COLLECTION).doc(sessionId)
    .collection('minutes').orderBy('idx', 'asc').get();

  if (minutesSnap.empty) {
    console.log(`  ✗  ${sessionId}: no minutes subcollection, skipping`);
    return 'no_minutes';
  }

  // Read block_commits subcollection — raw QRNG bits for raw_bits_b64
  const commitsSnap = await db
    .collection(PRESCREEN_COLLECTION).doc(sessionId)
    .collection('block_commits').orderBy('blockIdx', 'asc').get();

  const commitsByIdx = {};
  for (const cdoc of commitsSnap.docs) {
    const d = cdoc.data();
    if (d.bits && d.bits.length === BITS_PER_BLOCK) {
      commitsByIdx[d.blockIdx] = d.bits;
    }
  }

  const hurst_subject = [];
  const hurst_demon   = [];
  const delta_h       = [];
  let totalHits = 0, totalTrials = 0, totalGhostHits = 0;
  const rawBlockBits  = [];
  let missingCommits  = 0;

  for (const mdoc of minutesSnap.docs) {
    const m   = mdoc.data();
    const idx = m.idx;

    hurst_subject.push(m.hurst_delta?.subject ?? null);
    hurst_demon.push(m.hurst_delta?.pcs       ?? null);
    delta_h.push(m.hurst_delta?.delta         ?? null);

    totalHits      += m.hits       ?? 0;
    totalTrials    += m.n          ?? 0;
    totalGhostHits += m.demon_hits ?? 0;

    // Raw bits: prefer block_commits (exact original), fall back to trial_data
    if (commitsByIdx[idx] !== undefined) {
      rawBlockBits.push(commitsByIdx[idx].split('').map(Number));
    } else if (m.trial_data?.subject_bits && m.trial_data?.demon_bits) {
      // Reconstruct with assignment bit = 1 (subject = halfA).
      // The Hurst values are already correctly stored so this only affects
      // the bit-level Colab analysis; flag it with _backfilled_assumed_assignment.
      rawBlockBits.push([1, ...m.trial_data.subject_bits, ...m.trial_data.demon_bits]);
      missingCommits++;
    } else {
      missingCommits++;
    }
  }

  const hitRate      = totalTrials > 0 ? totalHits      / totalTrials : 0.5;
  const ghostHitRate = totalTrials > 0 ? totalGhostHits / totalTrials : 0.5;
  const blocksCompleted = minutesSnap.size;
  const validDH = delta_h.filter((v) => v !== null);
  const meanDH  = validDH.length > 0
    ? validDH.reduce((a, b) => a + b, 0) / validDH.length : 0;

  const raw_bits_b64 = rawBlockBits.length > 0 ? packBitsToBase64(rawBlockBits) : null;

  const update = {
    aggregates: {
      totalHits,
      totalTrials,
      totalGhostHits,
      hitRate,
      ghostHitRate,
      blocksCompleted,
      blocksPlanned: 80,
      sessionComplete: blocksCompleted >= 80,
      hurst_subject,
      hurst_demon,
      delta_h,
      hurstDelta: { mean: meanDH, blockDeltas: delta_h },
      lastUpdated: new Date().toISOString(),
      _backfilled: true,
      ...(missingCommits > 0 ? { _backfilled_assumed_assignment: missingCommits } : {}),
    },
    block_count_actual: blocksCompleted,
  };

  if (raw_bits_b64) update.raw_bits_b64 = raw_bits_b64;

  await db.collection(PRESCREEN_COLLECTION).doc(sessionId).update(update);

  const flags = [
    `${blocksCompleted} blocks`,
    raw_bits_b64 ? 'raw_bits_b64 ✓' : 'NO raw_bits_b64',
    missingCommits ? `${missingCommits} commit(s) reconstructed from trial_data` : null,
  ].filter(Boolean).join(', ');

  console.log(`  ✅ ${sessionId}: ${flags}`);
  return 'backfilled';
}

async function main() {
  console.log(`Querying completed human sessions in "${PRESCREEN_COLLECTION}"...\n`);

  const snap = await db.collection(PRESCREEN_COLLECTION)
    .where('completed', '==', true)
    .get();

  let total = 0, backfilled = 0, skipped = 0, failed = 0;

  for (const sdoc of snap.docs) {
    const d       = sdoc.data();
    const isHuman = !d.session_type || d.session_type === 'human';
    if (!isHuman) continue;
    total++;

    try {
      const result = await backfillSession(sdoc);
      if (result === 'backfilled') backfilled++;
      else skipped++;
    } catch (err) {
      console.error(`  ❌ ${sdoc.id}: FAILED — ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. ${total} human sessions: ${backfilled} backfilled, ${skipped} skipped, ${failed} failed.`);
  process.exit(0);
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
