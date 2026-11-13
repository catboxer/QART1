import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

/**
 * Personal payment codes (?TREMENDOUS=<code>) work for one participant only.
 *
 * 1. The code must be genuine: checked by the verify-payment-code Netlify
 *    function (HMAC with a server-side secret).
 * 2. The first participant to use a code claims it; the claim document is
 *    keyed by the code and stores that participant's hash. The same
 *    participant may return for later sessions; anyone else is refused.
 *    Firestore rules allow the claim to be created once and never changed.
 *
 * -> { ok: true } | { ok: false, reason: 'invalid_code' | 'code_used' }
 *    (anything unexpected throws; the caller should fail closed)
 */
export async function claimPaymentCode(db, collectionName, code, participantHash) {
  const res = await fetch(
    `/.netlify/functions/verify-payment-code?code=${encodeURIComponent(code)}`,
  );
  if (!res.ok) throw new Error(`verify-payment-code HTTP ${res.status}`);
  const { valid } = await res.json();
  if (!valid) return { ok: false, reason: 'invalid_code' };

  const normalized = code.trim().toUpperCase();
  const ref = doc(db, collectionName, normalized);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    return snap.data().participant_hash === participantHash
      ? { ok: true }
      : { ok: false, reason: 'code_used' };
  }
  try {
    await setDoc(ref, {
      participant_hash: participantHash,
      created_at: serverTimestamp(),
    });
  } catch (err) {
    // Lost a race with another participant claiming the same code.
    if (err?.code === 'permission-denied') {
      return { ok: false, reason: 'code_used' };
    }
    throw err;
  }
  return { ok: true };
}
