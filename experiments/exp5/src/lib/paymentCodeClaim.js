import { getPaymentCodeClaimOwner, createPaymentCodeClaim } from './database.js';

/**
 * Personal payment codes (?TREMENDOUS=<code>) work for one participant only.
 *
 * 1. The code must be genuine: checked by the verify-payment-code Netlify
 *    function (HMAC with a server-side secret).
 * 2. The first participant to use a code claims it; the claim is keyed by the
 *    code and stores that participant's key. The same participant may return for
 *    later sessions; anyone else is refused. The database allows the claim to be
 *    created once and never changed.
 *
 * -> { ok: true } | { ok: false, reason: 'invalid_code' | 'code_used' }
 *    (anything unexpected throws; the caller should fail closed)
 */
export async function claimPaymentCode(code, participantHash) {
  const res = await fetch(
    `/.netlify/functions/verify-payment-code?code=${encodeURIComponent(code)}`,
  );
  if (!res.ok) throw new Error(`verify-payment-code HTTP ${res.status}`);
  const { valid } = await res.json();
  if (!valid) return { ok: false, reason: 'invalid_code' };

  const normalized = code.trim().toUpperCase();
  const owner = await getPaymentCodeClaimOwner(normalized);
  if (owner) {
    return owner === participantHash
      ? { ok: true }
      : { ok: false, reason: 'code_used' };
  }
  try {
    await createPaymentCodeClaim(normalized, participantHash);
  } catch (err) {
    // Lost a race with another participant claiming the same code.
    if (err?.code === 'permission-denied') {
      return { ok: false, reason: 'code_used' };
    }
    throw err;
  }
  return { ok: true };
}

/**
 * Read-only: is this a genuine code, and which participant (if any) has claimed it?
 * -> { valid: boolean, owner: string|null }. Throws on network/server failure.
 */
export async function lookupPaymentCodeOwner(code) {
  const res = await fetch(
    `/.netlify/functions/verify-payment-code?code=${encodeURIComponent(code)}`,
  );
  if (!res.ok) throw new Error(`verify-payment-code HTTP ${res.status}`);
  const { valid } = await res.json();
  if (!valid) return { valid: false, owner: null };
  return { valid: true, owner: await getPaymentCodeClaimOwner(code.trim().toUpperCase()) };
}
