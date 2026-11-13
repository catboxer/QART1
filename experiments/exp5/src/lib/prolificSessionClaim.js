import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';

/**
 * One Prolific SESSION_ID (one Prolific submission) may start exactly one study
 * session. Without this, reloading the same Prolific URL would let someone run
 * again on the same submission.
 *
 * The claim is a document keyed by the SESSION_ID. Firestore rules only allow
 * it to be created once and updated by the same user, so two tabs racing to
 * claim the same ID cannot both succeed (the second write is an update by a
 * different uid and is rejected).
 *
 * claimProlificSession -> { ok: true } | { ok: false, reason }
 *   reason: 'missing_session_id' | 'already_used'
 *   (any Firestore failure throws; the caller should fail closed)
 *
 * A claim by the same signed-in user that is not yet marked completed is
 * allowed through, so a reload or crash mid-session can resume.
 */
export async function claimProlificSession(db, collectionName, uid, rec) {
  const sessionId = rec?.sessionId;
  if (!sessionId) return { ok: false, reason: 'missing_session_id' };

  const ref = doc(db, collectionName, sessionId);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const d = snap.data();
    if (d.uid === uid && !d.completed) return { ok: true };
    return { ok: false, reason: 'already_used' };
  }
  try {
    await setDoc(ref, {
      uid,
      study_id: rec.studyId || null,
      completed: false,
      created_at: serverTimestamp(),
    });
  } catch (err) {
    // Lost the race to another tab/device that claimed it first.
    if (err?.code === 'permission-denied') {
      return { ok: false, reason: 'already_used' };
    }
    throw err;
  }
  return { ok: true };
}

export async function markProlificSessionCompleted(db, collectionName, rec) {
  if (!rec?.sessionId) return;
  await updateDoc(doc(db, collectionName, rec.sessionId), {
    completed: true,
    completed_at: serverTimestamp(),
  });
}
