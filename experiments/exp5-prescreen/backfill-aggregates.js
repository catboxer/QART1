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

const PRESCREEN_COLLECTION  = 'prescreen_sessions_exp5';
const PARTICIPANT_COLLECTION = 'prescreen_participants';
const TRIALS_PER_BLOCK = 150;
const BITS_PER_BLOCK   = 1 + 2 * TRIALS_PER_BLOCK; // 301

function zFromBinom(k, n, p = 0.5) {
  if (n <= 0) return 0;
  return (k - n * p) / (p * Math.sqrt(n));
}

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

  // Already complete — check if subjectZ also present
  if (data.aggregates?.hurst_subject?.length > 0 && data.raw_bits_b64) {
    if (data.aggregates?.subjectZ !== undefined) {
      console.log(`  ✓  ${sessionId}: already complete, skipping`);
      return 'skipped';
    }
    // Patch: compute subjectZ from stored hit totals without re-reading minutes
    const { totalHits = 0, totalTrials = 0 } = data.aggregates;
    const subjectZ = zFromBinom(totalHits, totalTrials);
    await db.collection(PRESCREEN_COLLECTION).doc(sessionId).update({
      'aggregates.subjectZ':       subjectZ,
      'aggregates.subjectHitRate': totalTrials > 0 ? totalHits / totalTrials : 0.5,
    });
    console.log(`  ➕ ${sessionId}: patched subjectZ=${subjectZ.toFixed(3)}`);
    return 'patched';
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
  const subjectZ     = zFromBinom(totalHits, totalTrials);
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
      subjectZ,
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

async function updateParticipantProfiles() {
  console.log(`\nUpdating participant profile cumulative verdicts in "${PARTICIPANT_COLLECTION}"...\n`);

  const snap = await db.collection(PARTICIPANT_COLLECTION).get();
  let updated = 0, skipped = 0, failed = 0;

  for (const pdoc of snap.docs) {
    const profile = pdoc.data();
    const hash    = pdoc.id;

    if (!profile.latest_cumulative_verdict) { skipped++; continue; }
    if (profile.latest_cumulative_verdict.scoreAnomalyFlag !== undefined) {
      console.log(`  ✓  ${hash.slice(0, 8)}…: already has scoreAnomalyFlag, skipping`);
      skipped++;
      continue;
    }

    try {
      // Sum hits/trials across all usable sessions for this participant
      const sessSnap = await db.collection(PRESCREEN_COLLECTION)
        .where('participant_hash', '==', hash)
        .where('completed', '==', true)
        .get();

      let totalHits = 0, totalTrials = 0;
      for (const sdoc of sessSnap.docs) {
        const d = sdoc.data();
        if (!(d.aggregates?.hurst_subject?.length > 0) || !d.raw_bits_b64) continue;
        totalHits   += d.aggregates?.totalHits   ?? 0;
        totalTrials += d.aggregates?.totalTrials  ?? 0;
      }

      if (totalTrials === 0) { skipped++; continue; }

      const subjectZ        = zFromBinom(totalHits, totalTrials);
      const scoreAnomalyFlag = Math.abs(subjectZ) >= 2;
      const cumulativeHitRate = totalHits / totalTrials;
      const currentRank     = profile.latest_cumulative_verdict.rank;
      const effectiveRank   = currentRank === 'none' && scoreAnomalyFlag ? 'score_anomaly' : currentRank;

      await db.collection(PARTICIPANT_COLLECTION).doc(hash).update({
        'latest_cumulative_verdict.scoreAnomalyFlag': scoreAnomalyFlag,
        'latest_cumulative_verdict.subjectZ':          subjectZ,
        'latest_cumulative_verdict.cumulativeHitRate': cumulativeHitRate,
        'latest_cumulative_verdict.rank':              effectiveRank,
      });

      console.log(`  ✅ ${hash.slice(0, 8)}…: subjectZ=${subjectZ.toFixed(3)}, scoreAnomaly=${scoreAnomalyFlag}, rank=${effectiveRank}`);
      updated++;
    } catch (err) {
      console.error(`  ❌ ${hash.slice(0, 8)}…: FAILED — ${err.message}`);
      failed++;
    }
  }

  console.log(`\nParticipant profiles: ${updated} updated, ${skipped} skipped, ${failed} failed.`);
}

async function main() {
  console.log(`Processing all completed sessions in "${PRESCREEN_COLLECTION}"...\n`);

  const snap = await db.collection(PRESCREEN_COLLECTION)
    .where('completed', '==', true)
    .get();

  let total = 0, backfilled = 0, patched = 0, skipped = 0, failed = 0;

  for (const sdoc of snap.docs) {
    total++;
    try {
      const result = await backfillSession(sdoc);
      if (result === 'backfilled') backfilled++;
      else if (result === 'patched') patched++;
      else skipped++;
    } catch (err) {
      console.error(`  ❌ ${sdoc.id}: FAILED — ${err.message}`);
      failed++;
    }
  }

  console.log(`\nSessions: ${total} total, ${backfilled} backfilled, ${patched} patched, ${skipped} skipped, ${failed} failed.`);

  await updateParticipantProfiles();
  process.exit(0);
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
