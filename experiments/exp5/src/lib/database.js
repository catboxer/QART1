// src/lib/database.js
//
// THE ONLY FILE IN EXP5 THAT TALKS TO THE DATABASE.
//
// Every read and write goes through a named function here, so that moving from Google
// Firestore to an LMU server means rewriting this one file (each function would call the
// LMU API instead). Nothing else in the app imports 'firebase/firestore'.
//
// Rules for this file:
//  - Callers pass plain data; Firestore-specific things (server timestamps, increment,
//    arrayUnion) are applied here, never by callers.
//  - A "session handle" (the value returned by createSession) is opaque to callers: pass it
//    back to the session functions below and never look inside it.
//  - Behaviour is intentionally identical to the code this replaced. Callers still decide
//    whether a failure blocks anything (several writes are fire-and-forget by design).
//
// Collections (names come from config.js):
//   PRESCREEN_COLLECTION            one document per session, with subcollections
//                                   minutes/{n}, block_commits/{n}, audits/after_block_{n}
//   PARTICIPANT_COLLECTION          one pseudonymous profile per participant key
//   EMAIL_LOOKUP_COLLECTION         PRIVATE linkage record (plaintext email / Prolific ID, code)
//   PROLIFIC_SESSION_COLLECTION     one claim per Prolific SESSION_ID
//   PAYMENT_CODE_COLLECTION         one claim per personal payment code
//   participants/{uid}              this browser's private questionnaire answers

import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db, ensureSignedIn } from '../firebase.js';
import { pkConfig as C } from '../config.js';

// ── Sign-in ──────────────────────────────────────────────────────────────────

export { ensureSignedIn };

// ── Participant profiles (pseudonymous, keyed by participant key) ────────────

/** -> { exists: boolean, data: object|null } */
export async function getParticipantProfile(key) {
  const snap = await getDoc(doc(db, C.PARTICIPANT_COLLECTION, key));
  return { exists: snap.exists(), data: snap.exists() ? snap.data() : null };
}

/** Make `aliasKey` point at the real profile `targetKey` (so either identifier finds it). */
export async function createProfileAlias(aliasKey, targetKey) {
  await setDoc(
    doc(db, C.PARTICIPANT_COLLECTION, aliasKey),
    { alias_of: targetKey, created_at: serverTimestamp() },
    { merge: true },
  );
}

/** Which version of the consent text this participant agreed to (lets returning participants skip consent). */
export async function saveConsentRecord(key, { version }) {
  await setDoc(
    doc(db, C.PARTICIPANT_COLLECTION, key),
    { consent_version: version, consented_at: serverTimestamp() },
    { merge: true },
  );
}

/** The participant has submitted the whole pre-questionnaire. */
export async function markQuestionnaireDone(key) {
  await setDoc(
    doc(db, C.PARTICIPANT_COLLECTION, key),
    { pre_q_completed: true, pre_q_completed_at: serverTimestamp() },
    { merge: true },
  );
}

/** The participant clicked "Request payment now" (participation ends). */
export async function markPaymentRequested(key) {
  await setDoc(
    doc(db, C.PARTICIPANT_COLLECTION, key),
    { payment_requested: true, payment_requested_at: serverTimestamp() },
    { merge: true },
  );
}

/**
 * Called once when a session finishes. Adds to the profile's session counter
 * (or sets it to the Prolific wave when one was given), and records the date.
 */
export async function recordSessionCompletedOnProfile(
  key,
  { wave, sessionType, emailOptIn, isNewProfile, hits, trials },
) {
  await setDoc(
    doc(db, C.PARTICIPANT_COLLECTION, key),
    {
      // Prolific wave (when given) is authoritative; otherwise add one.
      session_count: wave ? wave : increment(1),
      // Running totals across all sessions, for the "average across all completed
      // sessions" figure on the results screen.
      ...(Number.isFinite(hits) && Number.isFinite(trials)
        ? { total_hits: increment(hits), total_trials: increment(trials) }
        : {}),
      last_session_date: new Date().toISOString().slice(0, 10),
      participant_type: sessionType,
      updated_at: serverTimestamp(),
      ...(emailOptIn !== undefined ? { email_opt_in: emailOptIn } : {}),
      ...(isNewProfile ? { created_at: serverTimestamp() } : {}),
    },
    { merge: true },
  );
}

// ── Private linkage record (plaintext email / Prolific ID, payment code) ─────

/** Fields left undefined/null are not written (including emailOptIn). */
export async function saveLinkageRecord(
  key,
  { email, prolificId, tremendousToken, emailOptIn },
) {
  await setDoc(
    doc(db, C.EMAIL_LOOKUP_COLLECTION, key),
    {
      ...(email ? { email } : {}),
      ...(prolificId ? { prolific_id: prolificId } : {}),
      ...(tremendousToken ? { tremendous_token: tremendousToken } : {}),
      ...(emailOptIn !== undefined ? { email_opt_in: emailOptIn } : {}),
      updated_at: serverTimestamp(),
    },
    { merge: true },
  );
}

/** Contact preferences given at consent; the latest answer is current, all are kept in a history. */
export async function saveContactPreferences(
  key,
  { resultsContact, futureContact, sessionNumber },
) {
  await setDoc(
    doc(db, C.EMAIL_LOOKUP_COLLECTION, key),
    {
      results_contact: !!resultsContact,
      future_contact: !!futureContact,
      contact_updated_at: serverTimestamp(),
      contact_history: arrayUnion({
        at: new Date().toISOString(),
        session_number: sessionNumber,
        results_contact: !!resultsContact,
        future_contact: !!futureContact,
      }),
    },
    { merge: true },
  );
}

// ── This browser's private questionnaire answers: participants/{uid} ─────────

/** Session count for people with no email/Prolific ID (same-browser only); null if none. */
export async function getUidSessionCount(uid) {
  const snap = await getDoc(doc(db, 'participants', uid));
  return snap.exists() ? (snap.data().exp5_sessions ?? 0) : null;
}

export async function setUidSessionCount(uid, count) {
  await setDoc(
    doc(db, 'participants', uid),
    { exp5_sessions: count },
    { merge: true },
  );
}

/** Pre-questionnaire answers so far (merged across pages), with the order the pages were shown in. */
export async function savePreQuestionnairePage(
  uid,
  { answers, participantKey, pageOrder, pageIndex, extra = {} },
) {
  await setDoc(
    doc(db, 'participants', uid),
    {
      demographics: answers,
      participant_hash: participantKey || null,
      demographics_version: 'v2',
      pre_q_page_order: pageOrder,
      pre_q_pages_done: pageIndex + 1,
      ...extra,
      updated_at: serverTimestamp(),
      ...(pageIndex === 0 ? { created_at: serverTimestamp() } : {}),
    },
    { merge: true },
  );
}

// ── Sessions ─────────────────────────────────────────────────────────────────

/** Create the session record. Returns an opaque handle for the session functions below. */
export async function createSession(fields) {
  return addDoc(collection(db, C.PRESCREEN_COLLECTION), {
    ...fields,
    createdAt: serverTimestamp(),
  });
}

/** Handle id, for logging only. */
export function sessionId(session) {
  return session?.id ?? null;
}

/** End-of-session summary (aggregates, raw bits, provider sequence, monitoring numbers). */
export async function saveSessionSummary(session, fields) {
  await setDoc(session, fields, { merge: true });
}

export async function markSessionCompleted(session) {
  await setDoc(session, { completed: true }, { merge: true });
}

export async function savePostSurvey(session, answers) {
  await setDoc(session, { post_survey: answers, completed: true }, { merge: true });
}

/** The session ended early (e.g. the random-number source was unavailable). */
export async function markSessionExitedEarly(session, fields) {
  await updateDoc(session, { exitedEarly: true, ...fields });
}

export async function recordAuditFailure(session, blockIdx) {
  await setDoc(
    session,
    {
      audit_failure_count: increment(1),
      audit_failed_blocks: arrayUnion(blockIdx),
    },
    { merge: true },
  );
}

/** Per-block results: sessions/{id}/minutes/{blockIdx} (merged, as before) */
export async function saveBlockResult(session, blockIdx, fields) {
  await setDoc(
    doc(session, 'minutes', String(blockIdx)),
    { ...fields, startedAt: serverTimestamp() },
    { merge: true },
  );
}

/** The raw bits committed before processing: sessions/{id}/block_commits/{blockIdx} */
export async function saveBlockCommit(session, blockIdx, fields) {
  await setDoc(doc(session, 'block_commits', String(blockIdx)), {
    ...fields,
    committedAt: serverTimestamp(),
  });
}

/** Randomness audit: sessions/{id}/audits/after_block_{blockIdx} */
export async function saveAudit(session, blockIdx, fields) {
  await setDoc(doc(session, 'audits', `after_block_${blockIdx}`), fields);
}

/** Past completed sessions for an automated-test user (automated modes only). Returns raw documents. */
export async function listCompletedSessionsForUid(uid) {
  const snap = await getDocs(
    query(
      collection(db, C.PRESCREEN_COLLECTION),
      where('participant_id', '==', uid),
      where('completed', '==', true),
      orderBy('createdAt', 'asc'),
      limit(50),
    ),
  );
  return snap.docs;
}

// ── Prolific session claims (one session per Prolific SESSION_ID) ────────────

/** -> claim data, or null if the SESSION_ID has not been used. */
export async function getProlificClaim(sessionId) {
  const snap = await getDoc(doc(db, C.PROLIFIC_SESSION_COLLECTION, sessionId));
  return snap.exists() ? snap.data() : null;
}

/** Create the claim. Throws (permission-denied) if it already exists. */
export async function createProlificClaim(sessionId, { uid, studyId }) {
  await setDoc(doc(db, C.PROLIFIC_SESSION_COLLECTION, sessionId), {
    uid,
    study_id: studyId || null,
    completed: false,
    created_at: serverTimestamp(),
  });
}

export async function completeProlificClaim(sessionId) {
  await updateDoc(doc(db, C.PROLIFIC_SESSION_COLLECTION, sessionId), {
    completed: true,
    completed_at: serverTimestamp(),
  });
}

// ── Payment-code claims (one participant per personal payment code) ──────────

/** -> the participant key that claimed this code, or null if unclaimed. */
export async function getPaymentCodeClaimOwner(code) {
  const snap = await getDoc(doc(db, C.PAYMENT_CODE_COLLECTION, code));
  return snap.exists() ? (snap.data().participant_hash ?? null) : null;
}

/** Create the claim. Throws (permission-denied) if it already exists. */
export async function createPaymentCodeClaim(code, participantKey) {
  await setDoc(doc(db, C.PAYMENT_CODE_COLLECTION, code), {
    participant_hash: participantKey,
    created_at: serverTimestamp(),
  });
}
