// src/ConsentGate.jsx
import React, { useState } from 'react';
import { pkConfig as C } from '../config.js'; // for CONSENT_VERSION (optional)

/**
 * Fully visible consent page (no expander).
 * Button becomes active only when BOTH checkboxes are checked.
 */
export default function ConsentGate({
  onAgree,
  title = 'Consent to Participate (pilot study)',
  contactEmail = 'h@whatthequark.com',
  version = C?.CONSENT_VERSION || 'v1',
}) {
  const [isAdult, setIsAdult] = useState(false);
  const [consent, setConsent] = useState(false);

  const ready = isAdult && consent;

  const handleContinue = () => {
    if (!ready) return;
    onAgree?.();
  };

  return (
    <div className="App" style={{ textAlign: 'left' }}>
      <h1 style={{ marginTop: 0 }}>{title}</h1>

      <p>
        This study evaluates whether selection accuracy for a preselected symbol exceeds chance levels.
        You will complete multiple short trials and brief questionnaires at the beginning, midpoint, and end
        (approximately 15–20 minutes).
      </p>

      <p>
        <b>Important:</b> To preserve the scientific validity of the study, some details cannot be fully explained
        until after participation. A full explanation will be provided after data collection for the entire study is
        complete.
      </p>

      <ul>
        <li>Participation is voluntary; you may stop at any time.</li>
        <li>We store anonymous trial data and questionnaire answers in Google Firestore (USA).</li>
        <li>
          We store responses indefinitely for research replication. Hosting providers may log IPs for security;
          we do not add IPs to the study database.
        </li>
        <li>
          Contact: <a href={`mailto:${contactEmail}`}>{contactEmail}</a> with any questions or concerns.
        </li>
      </ul>

      <div className="question-block" style={{ marginTop: '1rem' }}>
        <label
          className="question-label"
          style={{ display: 'flex', gap: 10, alignItems: 'center', margin: 0 }}
        >
          <input
            type="checkbox"
            checked={isAdult}
            onChange={(e) => setIsAdult(e.target.checked)}
          />
          I am 18 years or older.
        </label>
      </div>

      <div className="question-block" style={{ marginTop: '0.6rem' }}>
        <label
          className="question-label"
          style={{ display: 'flex', gap: 10, alignItems: 'center', margin: 0 }}
        >
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          I consent to participate and understand some details will be explained after participation.
        </label>
      </div>

      {/* hint line, visible until both are checked */}
      {!ready && (
        <div
          className="field-hint"
          style={{ textAlign: 'center', marginTop: '0.75rem' }}
        >
          Check both boxes to continue.
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button
          className={`primary-btn ${ready ? '' : 'looks-disabled'}`}
          aria-disabled={ready ? 'false' : 'true'}
          onClick={handleContinue}
          style={{ marginTop: '1.25rem' }}
        >
          I Agree, Continue
        </button>
      </div>

      <div style={{ marginTop: '1.25rem', fontSize: 12, color: '#777' }}>
        Consent {version.replace('v', 'v')}-{new Date().toISOString().slice(0, 10)}
      </div>
    </div>
  );
}
