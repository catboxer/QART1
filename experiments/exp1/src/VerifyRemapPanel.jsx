// experiments/exp1/src/VerifyRemapPanel.jsx
import React, { useState } from 'react';

// Must match app ordering
const ZENER = ['circle', 'plus', 'waves', 'square', 'star'];

async function hmacHex(secret, msg) {
  // Web Crypto HMAC-SHA-256 (browser-safe)
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: { name: 'SHA-256' } },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(msg)
  );
  const bytes = new Uint8Array(sig);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function flattenTrialsFromSessions(sessions) {
  const out = [];
  for (const s of sessions) {
    const blocks = [
      ...(s.full_stack_trials || []),
      ...(s.spoon_love_trials || []),
      ...(s.client_local_trials || []),
      ...(s.details?.trialDetails?.full_stack_trials || []),
      ...(s.details?.trialDetails?.spoon_love_trials || []),
      ...(s.details?.trialDetails?.client_local_trials || []),
    ];
    if (blocks.length) out.push(...blocks);
    if (s.block_type && s.trial_index) out.push(s); // already a flat trial row
  }
  return out;
}

export default function VerifyRemapPanel() {
  const [hmacSecret, setHmacSecret] = useState('');
  const [proofSecret, setProofSecret] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const json = JSON.parse(text);
      setResult({
        ok: false,
        message: 'File loaded. Click "Verify".',
        rows: Array.isArray(json) ? json.length : 1,
        data: json,
      });
    } catch {
      setResult({
        ok: false,
        message: 'Not valid JSON.',
        rows: 0,
        data: null,
      });
    }
  }

  async function verify() {
    if (!result?.data) return;
    if (!hmacSecret || !proofSecret) {
      setResult((r) => ({
        ...r,
        ok: false,
        message: 'Please paste both secrets.',
      }));
      return;
    }
    setBusy(true);
    try {
      const rows = Array.isArray(result.data)
        ? flattenTrialsFromSessions(result.data)
        : flattenTrialsFromSessions([result.data]);
      const spoonRows = rows.filter(
        (r) => (r.block_type || '').toLowerCase() === 'spoon_love'
      );

      let pass = 0,
        fail = 0;
      const failures = [];

      for (const row of spoonRows) {
        const msg = [
          row.sealed_envelope_id,
          row.server_time,
          row.press_start_ts,
          row.session_id,
          String(row.trial_index),
        ].join('|');

        const h = await hmacHex(hmacSecret, msg);
        const r = parseInt(h.slice(0, 2), 16) % 5;

        const proofMsg = msg + `|r=${r}`;
        const proof = await hmacHex(proofSecret, proofMsg);

        const options = row.options || [];
        const subjectSym = ZENER[(Number(row.raw_byte) >>> 0) % 5];
        const ghostSym =
          ZENER[(Number(row.ghost_raw_byte) >>> 0) % 5];

        const baseIdx = options.indexOf(subjectSym);
        const ghostBase = options.indexOf(ghostSym);
        const rGhost =
          (r + ((Number(row.ghost_raw_byte) >>> 0) % 5)) % 5;

        const targetIdx = (baseIdx + r) % 5;
        const ghostIdx = (ghostBase + rGhost) % 5;

        const proofOk =
          String(row.remap_proof || '').toLowerCase() ===
          proof.toLowerCase();
        const idxOk =
          Number(row.target_index_0based) === targetIdx &&
          Number(row.ghost_index_0based) === ghostIdx;

        if (proofOk && idxOk) pass++;
        else {
          fail++;
          failures.push({
            sealed_envelope_id: row.sealed_envelope_id,
            trial_index: row.trial_index,
            r,
            targetIdx,
            ghostIdx,
            proofOk,
            idxOk,
          });
        }
      }

      setResult((r) => ({
        ...r,
        ok: fail === 0,
        message: `Verified ${spoonRows.length} spoon_love trials — Pass: ${pass}, Fail: ${fail}`,
        failures,
      }));
    } catch (err) {
      setResult((r) => ({
        ...r,
        ok: false,
        message: 'Verification error: ' + (err?.message || err),
      }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      style={{
        padding: 12,
        border: '1px solid #ddd',
        borderRadius: 6,
        marginTop: 12,
      }}
    >
      <h3>Verify QRNG Remap Proofs (Block 2)</h3>
      <p style={{ marginTop: 0 }}>
        Paste secrets (used locally in your browser), load your{' '}
        <code>sessions_with_trials_and_reveal.json</code>, then click
        Verify.
      </p>
      <div style={{ display: 'grid', gap: 8, maxWidth: 600 }}>
        <label>
          REMAP_HMAC_SECRET
          <input
            type="password"
            value={hmacSecret}
            onChange={(e) => setHmacSecret(e.target.value)}
            style={{ width: '100%' }}
          />
        </label>
        <label>
          REMAP_PROOF_SECRET
          <input
            type="password"
            value={proofSecret}
            onChange={(e) => setProofSecret(e.target.value)}
            style={{ width: '100%' }}
          />
        </label>
        <label>
          Export JSON
          <input
            type="file"
            accept="application/json"
            onChange={onFile}
          />
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="primary-btn"
            onClick={verify}
            disabled={busy || !result?.data}
          >
            {busy ? 'Verifying…' : 'Verify'}
          </button>
          {result?.message && (
            <span style={{ alignSelf: 'center' }}>
              {result.message}
            </span>
          )}
        </div>
        {result?.failures?.length ? (
          <details>
            <summary>
              Show failures ({result.failures.length})
            </summary>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
              {JSON.stringify(result.failures.slice(0, 50), null, 2)}
            </pre>
          </details>
        ) : null}
      </div>
    </section>
  );
}
