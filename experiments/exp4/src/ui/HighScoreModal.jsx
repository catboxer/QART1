// src/HighScoreModal.jsx
import React, { useState } from 'react';

export default function HighScoreModal({
  open,
  pct,
  needPct,
  k,
  n,
  askEmail = true,
  onSubmitEmail,   // async(email)
  onClose,
}) {
  const [email, setEmail] = useState('');
  if (!open) return null;

  const valid = /\S+@\S+\.\S+/.test(email);

  return (
    <div
      role="dialog" aria-modal="true"
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'grid', placeItems: 'center',
        zIndex: 9999
      }}
    >
      <div style={{
        width: 'min(560px, 92vw)',
        background: '#fff',
        borderRadius: 12,
        padding: 18,
        boxShadow: '0 12px 40px rgba(0,0,0,0.25)'
      }}>
        <h2 style={{ margin: '0 0 6px' }}>Great session!</h2>
        <p style={{ marginTop: 0 }}>
          <b>{pct}%</b>{typeof k === 'number' && typeof n === 'number' ? <> ({k}/{n})</> : null}
          {typeof needPct === 'number' ? <> — threshold: <b>{needPct}%</b></> : null}
        </p>

        {askEmail && (
          <>
            <p>If you’d like a follow-up, drop your email:</p>
            <input
              type="email"
              className="text-input"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ width: '100%', margin: '6px 0 12px' }}
            />
          </>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="secondary-btn" onClick={onClose}>Close</button>
          {askEmail && (
            <button
              className={`primary-btn ${valid ? '' : 'looks-disabled'}`}
              aria-disabled={!valid}
              onClick={async () => {
                if (!valid) return;
                try {
                  await onSubmitEmail?.(email);
                } finally {
                  onClose?.();
                }
              }}
            >
              Submit
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
