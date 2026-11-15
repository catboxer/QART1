import { useState, useEffect, useCallback } from 'react';
import {
  ensureSignedIn,
  getParticipantProfile,
  createProfileAlias,
  getUidSessionCount,
  listCompletedSessionsForUid,
} from '../lib/database.js';
import { buildParticipantHistory } from '../lib/sessionHistory.js';
import { normalizeUserId } from '../lib/userId.js';

// ── identifier → truncated SHA-256 hex ───────────────────────────────────────
// Emails hash as-is; Prolific IDs get a prefix so the two can never collide.
async function hashIdentifier(value) {
  const encoded = new TextEncoder().encode(value.toLowerCase().trim());
  const buf = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

/**
 * Find a participant's profile from the identifiers they supplied (read-only).
 * Candidate keys are tried in order (email first, then Prolific ID); the canonical key is the
 * first candidate that already has a profile, following an `alias_of` pointer if that
 * candidate is only an alias. If none exists yet, it is the first candidate.
 * -> { hash, profile (data or null), candidates, existsByCandidate }
 */
async function resolveProfile(emailClean, prolificClean, userIdClean = '') {
  const candidates = [];
  if (emailClean) candidates.push(await hashIdentifier(emailClean));
  if (prolificClean)
    candidates.push(await hashIdentifier(`prolific:${prolificClean}`));
  // Volunteers who give no email use a generated four-word user ID; only a one-way
  // code made from it is ever stored.
  if (userIdClean)
    candidates.push(await hashIdentifier(`volunteer-id:${userIdClean}`));

  let hash = candidates[0];
  let foundDoc = null;
  const existsByCandidate = {};
  for (const cand of candidates) {
    const found = await getParticipantProfile(cand);
    existsByCandidate[cand] = found.exists;
    if (found.exists && !foundDoc) {
      hash = found.data.alias_of || cand;
      foundDoc = found.data.alias_of ? await getParticipantProfile(hash) : found;
    }
  }
  return {
    hash,
    profile: foundDoc && foundDoc.exists ? foundDoc.data : null,
    candidates,
    existsByCandidate,
  };
}

/**
 * Owns Firebase sign-in, participant profile load, and session history.
 *
 * loadParticipant(email) — call from ConsentGate.onAgree.
 *   Sets all participant state, returns { skipPreQ }.
 *
 * requireUid() — async; throws if auth fails (use before Firestore writes).
 *
 * @param {{ C }} options
 */
export function useParticipantProfile({ C }) {
  const [userReady, setUserReady] = useState(false);
  const [checkedReturning, setCheckedReturning] = useState(false);
  const [uid, setUid] = useState(null);

  // Multi-session accumulation (populated by loadParticipant)
  const [participantHash, setParticipantHash] = useState(null);
  const [participantProfile, setParticipantProfile] = useState(null);
  const [emailPlaintext, setEmailPlaintext] = useState('');
  const [prolificId, setProlificId] = useState('');
  const [sessionCount, setSessionCount] = useState(0);
  const [usableSessionCount, setUsableSessionCount] = useState(0);
  const [pastH_s, setPastH_s] = useState([]);
  const [pastH_d, setPastH_d] = useState([]);
  const [pastBits, setPastBits] = useState([]);
  const [pastDemonBits, setPastDemonBits] = useState([]);
  const [pastSubjectHits, setPastSubjectHits] = useState(0);
  const [pastDemonHits, setPastDemonHits] = useState(0);
  const [pastDemonTrials, setPastDemonTrials] = useState(0);

  // ── sign-in effect (runs once at mount) ─────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const u = await ensureSignedIn();
        setUid(u?.uid || null);
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

  // ── setCumulativeHistory — update in-memory past-session arrays between auto/AI sessions ──
  const setCumulativeHistory = useCallback(({ h_s, h_d, bits, dBits, subjectHits, dHits, dTrials, count, usableCount }) => {
    setPastH_s(h_s);
    setPastH_d(h_d);
    setPastBits(bits);
    setPastDemonBits(dBits);
    setPastSubjectHits(subjectHits ?? 0);
    setPastDemonHits(dHits);
    setPastDemonTrials(dTrials);
    setSessionCount(count);
    setUsableSessionCount(usableCount);
  }, []);

  // ── loadAutoParticipant — called once at mount for auto/AI modes ─────────────
  // Uses uid as participantHash; queries by participant_id (not participant_hash,
  // since existing auto/AI session docs have participant_hash: null).
  const loadAutoParticipant = useCallback(async () => {
    if (!uid) return { usableCount: 0 };
    setParticipantHash(uid);
    try {
      const sessionDocs = await listCompletedSessionsForUid(uid);
      const {
        sessionCount: sc,
        usableSessionCount: usc,
        pastH_s: h_s,
        pastH_d: h_d,
        pastBits: bits,
        pastDemonBits: dBits,
        pastSubjectHits: sHits,
        pastDemonHits: dHits,
        pastDemonTrials: dTrials,
      } = buildParticipantHistory(sessionDocs, C, { includeAllTypes: true });
      setPastH_s(h_s);
      setPastH_d(h_d);
      setPastBits(bits);
      setPastDemonBits(dBits);
      setPastSubjectHits(sHits);
      setPastDemonHits(dHits);
      setPastDemonTrials(dTrials);
      setSessionCount(sc);
      setUsableSessionCount(usc);
      return { usableCount: usc };
    } catch (err) {
      console.error('Auto participant history load failed (non-blocking):', err);
      return { usableCount: 0 };
    }
  }, [C, uid]);

  // ── loadParticipant — called from ConsentGate.onAgree ───────────────────────
  // Returns { skipPreQ, usableCount } so the caller can navigate (and gate on max sessions).
  const loadParticipant = useCallback(
    async (email, prolificIdInput, userIdInput) => {
      let profile = null;
      let usableCount = 0;
      let resolvedHash = null;
      const emailClean = (email || '').trim();
      const prolificClean = (prolificIdInput || '').trim();
      const userIdClean = normalizeUserId(userIdInput);
      if (emailClean || prolificClean || userIdClean) {
        setEmailPlaintext(emailClean);
        setProlificId(prolificClean);
        try {
          const { hash, profile: foundProfile, candidates, existsByCandidate } =
            await resolveProfile(emailClean, prolificClean, userIdClean);
          setParticipantHash(hash);
          resolvedHash = hash;
          profile = foundProfile;

          // Link any other identifier the participant supplied to the same
          // profile, so a later visit with only that identifier finds it.
          for (const cand of candidates) {
            if (cand !== hash && !existsByCandidate[cand]) {
              createProfileAlias(cand, hash).catch((err) =>
                console.error('Alias save failed:', err),
              );
            }
          }
          setParticipantProfile(profile);

          // Session number comes from the counter on the participant profile
          // (incremented once per completed session), not from listing past
          // sessions -- the session collection is not publicly listable.
          const sc = profile?.session_count ?? 0;
          usableCount = sc;
          setSessionCount(sc);
          setUsableSessionCount(sc);
          // Running totals for the cumulative average shown on the results screen.
          setPastSubjectHits(profile?.total_hits ?? 0);
          setPastDemonTrials(profile?.total_trials ?? 0);
        } catch (err) {
          console.error('Profile load error (non-blocking):', err);
        }
      } else if (uid) {
        // Fallback: UID → exp5-specific counter on participants/{uid}
        // (scoped to this experiment so it doesn't collide with other studies)
        try {
          const uidCount = await getUidSessionCount(uid);
          if (uidCount !== null) setSessionCount(uidCount);
        } catch (err) {
          console.error('UID session count load failed (non-blocking):', err);
        }
      }

      // preQ is skipped only if THIS participant's profile says it was
      // submitted (not a device-wide flag, which would leak across people
      // sharing a browser). A Prolific wave number overrides this.
      const skipPreQ = !!profile?.pre_q_completed;
      return {
        skipPreQ,
        usableCount,
        participantHash: resolvedHash,
        profileSessionCount: profile?.session_count ?? 0,
        paymentRequested: !!profile?.payment_requested,
      };
    },
    [uid],
  );

  // ── peekParticipant — read-only lookup used BEFORE consent to see whether a
  // returning participant can skip it. Sets no state and writes nothing.
  // Give an email, Prolific ID and/or user ID, or an already-known participant `key`.
  // -> { hash, profile (data or null) }
  const peekParticipant = useCallback(async ({ email, prolificId: pid, userId, key } = {}) => {
    if (key) {
      const found = await getParticipantProfile(key);
      return { hash: key, profile: found.exists ? found.data : null };
    }
    const { hash, profile } = await resolveProfile(
      (email || '').trim(),
      (pid || '').trim(),
      normalizeUserId(userId),
    );
    return { hash, profile };
  }, []);

  // ── loadParticipantByKey — like loadParticipant, for a returning participant
  // identified by a known key (their payment-code claim) instead of an email.
  const loadParticipantByKey = useCallback(async (key) => {
    let profile = null;
    let usableCount = 0;
    try {
      setParticipantHash(key);
      const found = await getParticipantProfile(key);
      profile = found.exists ? found.data : null;
      setParticipantProfile(profile);
      const sc = profile?.session_count ?? 0;
      usableCount = sc;
      setSessionCount(sc);
      setUsableSessionCount(sc);
      setPastSubjectHits(profile?.total_hits ?? 0);
      setPastDemonTrials(profile?.total_trials ?? 0);
    } catch (err) {
      console.error('Profile load error (non-blocking):', err);
    }
    return {
      skipPreQ: !!profile?.pre_q_completed,
      usableCount,
      participantHash: key,
      profileSessionCount: profile?.session_count ?? 0,
      paymentRequested: !!profile?.payment_requested,
    };
  }, []);

  return {
    loading: !userReady || !checkedReturning,
    uid,
    participantHash,
    participantProfile,
    emailPlaintext,
    prolificId,
    sessionCount,        // all completed human sessions — display + profile write
    setSessionCount,     // for postQ session-count increment
    usableSessionCount,  // sessions with full reconstructable data — analysis gate
    pastH_s,
    pastH_d,
    pastBits,
    pastDemonBits,
    pastSubjectHits,
    pastDemonHits,
    pastDemonTrials,
    requireUid,
    loadParticipant,
    loadParticipantByKey,
    peekParticipant,
    loadAutoParticipant,
    setCumulativeHistory,
  };
}
