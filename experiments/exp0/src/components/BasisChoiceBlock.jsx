import React, { useRef, useState } from 'react';
import { getBit, getSaltHexCrypto } from '../lib/stats/qrngBits';

async function sha256Hex(s) {
  const enc = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Props:
 *  - trials: number
 *  - onTrial(record): append row to parent
 *  - onDone(): signal block finished
 */
export default function BasisChoiceBlock({
  trials,
  onTrial,
  onDone,
}) {
  const [trial, setTrial] = useState(1);
  const [commit, setCommit] = useState('');
  const [armed, setArmed] = useState(false);
  const [done, setDone] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [guess, setGuess] = useState('');

  const hidden = useRef({
    basis_prep: null,
    bit_prep: null,
    salt: null,
    tStart: null,
  });
  const rtStart = useRef(0);

  async function arm() {
    const basis_prep = (await getBit()) === 0 ? 'Z' : 'X';
    const bit_prep = await getBit();
    const salt = getSaltHexCrypto(8);
    const c = await sha256Hex(
      `${salt}|${trial}|${basis_prep}|${bit_prep}`
    );
    hidden.current = {
      basis_prep,
      bit_prep,
      salt,
      tStart: new Date().toISOString(),
    };
    setCommit(c);
    setArmed(true);
    setFeedback(null);
    rtStart.current = performance.now();
  }

  async function measure(basis_measure) {
    if (!armed) return;
    const { basis_prep, bit_prep, salt, tStart } = hidden.current;
    const mismatch = basis_measure !== basis_prep;
    const outcome_bit = mismatch ? await getBit() : bit_prep;

    const g = guess === '0' ? 0 : guess === '1' ? 1 : undefined;
    const rec = {
      block_type: 'basis_choice',
      trial_id: trial,
      commit,
      basis_prep,
      bit_prep,
      salt,
      guess: g,
      basis_measure,
      mismatch: Number(mismatch),
      outcome_bit,
      correct: g == null ? null : Number(g === outcome_bit),
      t_start_iso: tStart,
      t_reveal_iso: new Date().toISOString(),
      rt_ms: Math.round(performance.now() - rtStart.current),
    };
    onTrial(rec);

    setFeedback(
      g != null
        ? rec.correct
          ? 'Correct'
          : 'Incorrect'
        : `Outcome: ${outcome_bit}`
    );
    setArmed(false);

    if (trial >= trials) {
      setDone(true);
      return;
    }
    setTrial(trial + 1);
    setGuess('');
  }

  return (
    <div className="block-panel">
      <h2>Block A — Basis Choice</h2>
      <p>
        Guess the bit (0/1), then choose how to measure (Z or X). If
        your basis matches the hidden prep, you reveal that bit;
        otherwise a fresh random bit is created.
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
          <input
            value={guess}
            onChange={(e) =>
              setGuess(e.target.value.replace(/[^01]/g, ''))
            }
            placeholder="guess 0 or 1"
            maxLength={1}
            style={{ width: 120 }}
          />
          <button
            disabled={!(guess === '0' || guess === '1')}
            onClick={() => measure('Z')}
          >
            Measure Z
          </button>
          <button
            disabled={!(guess === '0' || guess === '1')}
            onClick={() => measure('X')}
          >
            Measure X
          </button>{' '}
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
