import React, { useState } from 'react';
import { CONTACT_EMAIL } from './ConsentInfoPage.jsx';

/**
 * Shown once, right after consent, before the pre-questionnaire.
 * Displays the generated participant code and requires the participant to
 * retype it correctly before continuing -- catches the case where they
 * misread or didn't actually write it down.
 */
export default function ParticipantCodeScreen({ code, onConfirmed }) {
  const [typed, setTyped] = useState('');
  const [attempted, setAttempted] = useState(false);
  const matches = typed.trim().toLowerCase() === code.toLowerCase();

  const handleContinue = () => {
    setAttempted(true);
    if (matches) onConfirmed?.();
  };

  return (
    <div className="App" style={{ textAlign: 'center', maxWidth: 560 }}>
      <h1 style={{ marginTop: 0 }}>Your participant code</h1>
      <p style={{ fontSize: 16, lineHeight: 1.6 }}>
        Write this down or save it somewhere safe. You will need it to
        continue on your next session.
      </p>

      <div
        className="question-block"
        style={{
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: '0.02em',
          fontFamily: 'monospace',
        }}
        aria-label="Your participant code"
      >
        {code}
      </div>

      <p style={{ fontSize: 13.5, color: 'var(--muted)' }}>
        This code is what links your sessions together and lets you resume
        without redoing consent or the questionnaires. Entering it is
        required every time you return, even on this same device. If you
        lose it, contact the research team at{' '}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> — recovery
        is not automatic and may take some time, so it is best to save this
        code now.
      </p>

      <label
        htmlFor="participant-code-confirm"
        style={{ display: 'block', fontWeight: 600, marginTop: '1.5rem', marginBottom: 4, textAlign: 'left' }}
      >
        Type your code below to confirm you have saved it
      </label>
      <input
        id="participant-code-confirm"
        type="text"
        className="text-input"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder="e.g. falcon-otter-meadow"
        autoComplete="off"
        aria-required="true"
        aria-invalid={attempted && !matches ? 'true' : 'false'}
        aria-describedby={attempted && !matches ? 'participant-code-error' : undefined}
      />
      {attempted && !matches && (
        <div id="participant-code-error" className="field-hint" role="alert">
          That doesn't match your code above. Please check it and try again.
        </div>
      )}

      <button
        type="button"
        className={`primary-btn ${matches ? '' : 'looks-disabled'}`}
        aria-disabled={matches ? 'false' : 'true'}
        onClick={handleContinue}
      >
        I've saved my code — continue
      </button>
    </div>
  );
}
