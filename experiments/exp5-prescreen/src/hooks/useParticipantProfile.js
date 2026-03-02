import { useState, useEffect, useCallback } from 'react';
import {
  collection, doc, getDoc, getDocs,
  query, where, orderBy, limit,
} from 'firebase/firestore';
import { ensureSignedIn } from '../firebase.js';
import { buildParticipantHistory } from '../lib/sessionHistory.js';

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
 * Owns Firebase sign-in, participant profile load, and session history.
 *
 * loadParticipant(email) — call from ConsentGate.onAgree.
 *   Sets all participant state, returns { skipPreQ }.
 *
 * requireUid() — async; throws if auth fails (use before Firestore writes).
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

  // Multi-session accumulation (populated by loadParticipant)
  const [participantHash, setParticipantHash] = useState(null);
  const [participantProfile, setParticipantProfile] = useState(null);
  const [emailPlaintext, setEmailPlaintext] = useState('');
  const [sessionCount, setSessionCount] = useState(0);
  const [pastH_s, setPastH_s] = useState([]);
  const [pastH_d, setPastH_d] = useState([]);
  const [pastBits, setPastBits] = useState([]);
  const [pastDemonHits, setPastDemonHits] = useState(0);
  const [pastDemonTrials, setPastDemonTrials] = useState(0);

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

  // ── loadParticipant — called from ConsentGate.onAgree ───────────────────────
  // Returns { skipPreQ } so the caller can navigate.
  const loadParticipant = useCallback(
    async (email) => {
      let profile = null;
      if (email) {
        setEmailPlaintext(email);
        try {
          const hash = await hashEmail(email);
          setParticipantHash(hash);
          const profRef = doc(db, C.PARTICIPANT_COLLECTION, hash);
          const profSnap = await getDoc(profRef);
          profile = profSnap.exists() ? profSnap.data() : null;
          setParticipantProfile(profile);

          // Query past sessions for cumulative reconstruction
          try {
            const sessionsQ = query(
              collection(db, C.PRESCREEN_COLLECTION),
              where('participant_hash', '==', hash),
              where('completed', '==', true),
              orderBy('createdAt', 'asc'),
              limit(50),
            );
            const snap = await getDocs(sessionsQ);
            const {
              usableSessionCount,
              pastH_s: h_s,
              pastH_d: h_d,
              pastBits: bits,
              pastDemonHits: dHits,
              pastDemonTrials: dTrials,
            } = buildParticipantHistory(snap.docs, C);
            setPastH_s(h_s);
            setPastH_d(h_d);
            setPastBits(bits);
            setPastDemonHits(dHits);
            setPastDemonTrials(dTrials);
            setSessionCount(usableSessionCount);
          } catch (err) {
            console.error('Session history query failed (non-blocking):', err);
            setSessionCount(profile?.session_count ?? 0);
          }
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
      return { skipPreQ };
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
    sessionCount,
    setSessionCount,  // for postQ session-count increment
    pastH_s,
    pastH_d,
    pastBits,
    pastDemonHits,
    pastDemonTrials,
    requireUid,
    loadParticipant,
  };
}
