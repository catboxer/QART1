import React from 'react';
import { CONTACT_EMAIL, FRIENDLY_TITLE } from './ConsentInfoPage.jsx';

/**
 * Shown to a returning participant who has already consented to the current version of the
 * consent text. A reminder only: no questions are asked here.
 */
export default function WelcomeBackPage({ onContinue, busy = false }) {
  return (
    <div className="App" style={{ textAlign: 'center', maxWidth: 560 }}>
      <h1 style={{ marginTop: 0 }}>Welcome back</h1>
      <p style={{ fontSize: 15, color: 'var(--muted)', marginTop: -8 }}>
        {FRIENDLY_TITLE}
      </p>

      <div
        className="question-block"
        style={{ textAlign: 'left', fontSize: 15, lineHeight: 1.65 }}
      >
        <p style={{ marginTop: 0 }}>
          You have already agreed to take part, and your consent covers up to
          five sessions, so there is no need to consent again.
        </p>
        <p style={{ marginBottom: 0 }}>
          Taking part is voluntary and you can stop at any time. If you have
          questions, or would like to withdraw, please contact{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </div>

      <button
        type="button"
        className={`primary-btn ${busy ? 'looks-disabled' : ''}`}
        aria-disabled={busy ? 'true' : 'false'}
        onClick={() => !busy && onContinue?.()}
        style={{ marginTop: '1.25rem' }}
      >
        {busy ? 'Please wait…' : 'Continue to the study'}
      </button>
    </div>
  );
}
