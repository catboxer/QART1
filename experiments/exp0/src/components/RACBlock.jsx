import React, { useRef, useState } from 'react';
import {
  getBit,
  getBits,
  getSaltHexCrypto,
} from '../lib/stats/qrngBits';

async function sha256Hex(s) {
  const enc = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const PQ = Math.cos(Math.PI / 8) ** 2; // ≈ 0.853553

// Draw Bernoulli(p) using ~10 QRNG bits (thresholding on 0..1023)
async function qrngBernoulli(p) {
  const bits = await getBits(8);
  let x = 0;
  for (let i = 0; i < 8; i++) x = (x << 1) | bits[i];
  return x < Math.floor(p * 256);
}

/**
 * Props:
 *  - mode: "RAC_CLASSICAL" | "RAC_QUANTUM_SIM"
 *  - trials: number
 *  - onTrial(record)
 *  - onDone()
 */
export default function RACBlock({
  mode = 'RAC_QUANTUM_SIM',
  trials,
  onTrial,
  onDone,
}) {
  const [trial, setTrial] = useState(1);
  const [commit, setCommit] = useState('');
  const [armed, setArmed] = useState(false);
  const [done, setDone] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const hidden = useRef({
    a0: null,
    a1: null,
    salt: null,
    tStart: null,
  });
  const rtStart = useRef(0);

  async function arm() {
    const a0 = await getBit();
    const a1 = await getBit();
    const salt = getSaltHexCrypto(8);
    const c = await sha256Hex(`${salt}|${trial}|${a0}|${a1}|${mode}`);
    hidden.current = {
      a0,
      a1,
      salt,
      tStart: new Date().toISOString(),
    };
    setCommit(c);
    setArmed(true);
    setFeedback(null);
    rtStart.current = performance.now();
  }

  async function requestBit(y) {
    if (!armed) return;
    const { a0, a1, salt, tStart } = hidden.current;
    const target = y === 0 ? a0 : a1;

    let b,
      strategy = null;
    if (mode === 'RAC_CLASSICAL') {
      // Simple classical strategy m = a0; Bob outputs b = m
      strategy = 'm=a0';
      b = a0; // averages to 0.75 across uniform (a0,a1,y)
    } else {
      const success = await qrngBernoulli(PQ);
      b = success ? target : 1 - target;
    }

    const rec = {
      block_type: mode,
      trial_id: trial,
      commit,
      a0,
      a1,
      salt,
      y,
      b,
      success: Number(b === target),
      strategy,
      t_start_iso: tStart,
      t_reveal_iso: new Date().toISOString(),
      rt_ms: Math.round(performance.now() - rtStart.current),
    };
    onTrial(rec);

    setFeedback(rec.success ? 'Got it right' : 'Miss');
    setArmed(false);

    if (trial >= trials) {
      setDone(true);
      return;
    }
    setTrial(trial + 1);
  }

  return (
    <div className="block-panel">
      <h2>
        Block B — Random Access Code (
        {mode === 'RAC_CLASSICAL'
          ? 'Classical (≤75%)'
          : 'Quantum Sim (≈85%)'}
        )
      </h2>
      <p>
        Choose which hidden bit to retrieve (a₀ or a₁). We compare
        performance to known ceilings.
      </p>

      <div className="commit-card">
        <div>
          <strong>Trial:</strong> {trial}/{trials}
        </div>
        <div>
          <strong>Commit:</strong> <code>{commit || '—'}</code>
        </div>
      </div>

      {!armed ? (
        <button onClick={arm} disabled={done}>
          Arm Trial
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button onClick={() => requestBit(0)}>Request a₀</button>
          <button onClick={() => requestBit(1)}>Request a₁</button>
        </div>
      )}

      {feedback && <p style={{ marginTop: 12 }}>{feedback}</p>}
      {done && (
        <button style={{ marginTop: 12 }} onClick={onDone}>
          Continue
        </button>
      )}
    </div>
  );
}
