import {
  getProlificClaim,
  createProlificClaim,
  completeProlificClaim,
} from './database.js';

/**
 * One Prolific SESSION_ID (one Prolific submission) may start exactly one study
 * session. Without this, reloading the same Prolific URL would let someone run
 * again on the same submission.
 *
 * The claim is keyed by the SESSION_ID. The database allows it to be created only
 * once and updated only by the same user, so two tabs racing to claim the same ID
 * cannot both succeed (the second write is refused).
 *
 * claimProlificSession -> { ok: true } | { ok: false, reason }
 *   reason: 'missing_session_id' | 'already_used'
 *   (any database failure throws; the caller should fail closed)
 *
 * A claim by the same signed-in user that is not yet marked completed is
 * allowed through, so a reload or crash mid-session can resume.
 */
export async function claimProlificSession(uid, rec) {
  const sessionId = rec?.sessionId;
  if (!sessionId) return { ok: false, reason: 'missing_session_id' };

  const existing = await getProlificClaim(sessionId);
  if (existing) {
    if (existing.uid === uid && !existing.completed) return { ok: true };
    return { ok: false, reason: 'already_used' };
  }
  try {
    await createProlificClaim(sessionId, { uid, studyId: rec.studyId });
  } catch (err) {
    // Lost the race to another tab/device that claimed it first.
    if (err?.code === 'permission-denied') {
      return { ok: false, reason: 'already_used' };
    }
    throw err;
  }
  return { ok: true };
}

export async function markProlificSessionCompleted(rec) {
  if (!rec?.sessionId) return;
  await completeProlificClaim(rec.sessionId);
}
