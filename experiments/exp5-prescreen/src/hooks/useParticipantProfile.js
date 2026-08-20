import { useState, useEffect, useCallback } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { ensureSignedIn } from '../firebase.js';

// ── email → truncated SHA-256 hex ────────────────────────────────────────────
async function hashEmail(email) {
  const encoded = new TextEncoder().encode(email.toLowerCase().trim());
  const buf = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

/**
 * Owns Firebase sign-in and participant profile load.
 *
 * loadParticipant(email) — call from ConsentGate.onAgree.
 *   Sets all participant state, returns { skipPreQ }.
 *
 * requireUid() — async; throws if auth fails (use before Firestore writes).
 *
 * sessionCount comes straight off the participant profile doc's own scalar
 * counter -- no per-session history query or bit-array reconstruction needed,
 * since nothing here computes cumulative analysis anymore.
 *
 * @param {{ db, C }} options
 */
export function useParticipantProfile({ db, C }) {
  const [userReady, setUserReady] = useState(false);
  const [checkedReturning, setCheckedReturning] = useState(false);
  const [uid, setUid] = useState(null);

  // localStorage-backed flag: skip preQ if they've already done it this device
  const [preDone, setPreDone] = useState(() => {
    try {
      return (
        localStorage.getItem(`pre_done_global:${C.EXPERIMENT_ID}`) === '1'
      );
    } catch {
      return false;
    }
  });

  const [participantHash, setParticipantHash] = useState(null);
  const [participantProfile, setParticipantProfile] = useState(null);
  const [emailPlaintext, setEmailPlaintext] = useState('');
  const [sessionCount, setSessionCount] = useState(0);

  // ── sign-in effect (runs once at mount) ─────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const u = await ensureSignedIn();
        setUid(u?.uid || null);
        // Fast local skip for preQ if they've done it on this device
        try {
          const globalKey = `pre_done_global:${C.EXPERIMENT_ID}`;
          if (localStorage.getItem(globalKey) === '1') setPreDone(true);
        } catch {}
      } finally {
        setUserReady(true);
        setCheckedReturning(true);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── requireUid — for Firestore writes that need a valid UID ─────────────────
  const requireUid = useCallback(async () => {
    const u = await ensureSignedIn();
    if (!u || !u.uid)
      throw new Error('auth/no-user: sign-in required before writing');
    return u.uid;
  }, []);

  // ── loadAutoParticipant — called once at mount for auto/AI modes ─────────────
  // Uses uid as participantHash; reads the participant profile doc's session_count
  // scalar directly (participants/{uid}, same doc useSessionPersistence writes to).
  const loadAutoParticipant = useCallback(async () => {
    if (!uid) return { usableCount: 0 };
    setParticipantHash(uid);
    try {
      const profRef = doc(db, C.PARTICIPANT_COLLECTION, uid);
      const profSnap = await getDoc(profRef);
      const profile = profSnap.exists() ? profSnap.data() : null;
      setParticipantProfile(profile);
      const sc = profile?.session_count ?? 0;
      setSessionCount(sc);
      return { usableCount: sc };
    } catch (err) {
      console.error('Auto participant profile load failed (non-blocking):', err);
      return { usableCount: 0 };
    }
  }, [db, C, uid]);

  // ── loadParticipant — called from ConsentGate.onAgree ───────────────────────
  // Returns { skipPreQ, usableCount } so the caller can navigate.
  const loadParticipant = useCallback(
    async (email) => {
      let profile = null;
      let usableCount = 0;
      if (email) {
        setEmailPlaintext(email);
        try {
          const hash = await hashEmail(email);
          setParticipantHash(hash);
          const profRef = doc(db, C.PARTICIPANT_COLLECTION, hash);
          const profSnap = await getDoc(profRef);
          profile = profSnap.exists() ? profSnap.data() : null;
          setParticipantProfile(profile);
          usableCount = profile?.session_count ?? 0;
          setSessionCount(usableCount);
        } catch (err) {
          console.error('Profile load error (non-blocking):', err);
        }
      } else if (uid) {
        // Fallback: UID → exp5-specific counter on participants/{uid}
        // (scoped to this experiment so it doesn't collide with other studies)
        try {
          const uidRef = doc(db, 'participants', uid);
          const uidSnap = await getDoc(uidRef);
          if (uidSnap.exists()) {
            setSessionCount(uidSnap.data().exp5_prescreen_sessions ?? 0);
          }
        } catch (err) {
          console.error('UID session count load failed (non-blocking):', err);
        }
      }

      // Determine preQ skip: profile flag OR device localStorage flag
      let localPreDone = false;
      try {
        localPreDone =
          localStorage.getItem(`pre_done_global:${C.EXPERIMENT_ID}`) === '1';
      } catch {}
      const skipPreQ = profile?.pre_q_completed || preDone || localPreDone;
      return { skipPreQ, usableCount };
    },
    [db, C, uid, preDone],
  );

  return {
    loading: !userReady || !checkedReturning,
    uid,
    preDone,
    setPreDone,       // for preQ completion handler
    participantHash,
    participantProfile,
    emailPlaintext,
    sessionCount,        // all completed sessions — display + profile write
    setSessionCount,     // for postQ session-count increment
    requireUid,
    loadParticipant,
    loadAutoParticipant,
  };
}
