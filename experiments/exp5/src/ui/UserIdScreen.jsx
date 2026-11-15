import React, { useState } from 'react';
import { normalizeUserId } from '../lib/userId.js';
import { FRIENDLY_TITLE } from './ConsentInfoPage.jsx';

/**
 * Shows a volunteer their new user ID once, and asks them to type it back so we know they have
 * saved it. The ID is the only way to link their later sessions (there is no email), and
 * nobody can recover it for them.
 */
export default function UserIdScreen({ userId, onConfirmed }) {
  const [typed, setTyped] = useState('');
  const matches = normalizeUserId(typed) === normalizeUserId(userId);

  return (
    <div className="App" style={{ textAlign: 'center', maxWidth: 540 }}>
      <h1 style={{ marginTop: 0 }}>Your user ID</h1>
      <p style={{ fontSize: 15, color: 'var(--muted)', marginTop: -8 }}>
        {FRIENDLY_TITLE}
      </p>

      <p style={{ fontSize: 16, lineHeight: 1.6 }}>
        Please write this down or save it somewhere safe. You will need it to
        continue with your next session.
      </p>

      <div
        className="question-block"
        style={{
          fontFamily: 'monospace',
          fontSize: 26,
          fontWeight: 700,
          letterSpacing: '0.02em',
          padding: '18px 12px',
          wordBreak: 'break-word',
        }}
        data-testid="user-id"
      >
        {userId}
      </div>

      <p style={{ fontSize: 14, lineHeight: 1.6, textAlign: 'left' }}>
        This ID is what links your sessions together. Because you chose not to
        give an email address, the research team cannot look it up or send it
        to you again. If you lose it, you can still take part, but your next
        session will count as a new start.
      </p>

      <div style={{ textAlign: 'left', marginTop: '1rem' }}>
        <label htmlFor="user-id-confirm" style={{ fontWeight: 600 }}>
          Type your user ID below to confirm you have saved it
        </label>
        <input
          id="user-id-confirm"
          type="text"
          className="text-input"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="word-word-word-word"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />
      </div>

      <button
        type="button"
        className={`primary-btn ${matches ? '' : 'looks-disabled'}`}
        aria-disabled={matches ? 'false' : 'true'}
        onClick={() => matches && onConfirmed?.()}
        style={{ marginTop: '1.25rem' }}
      >
        I've saved my ID — continue
      </button>
    </div>
  );
}
