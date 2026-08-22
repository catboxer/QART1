import React, { useState } from 'react';
import { pkConfig as C } from '../config.js';

/**
 * Fully visible consent page (no expander).
 * Button becomes active only when BOTH checkboxes are checked.
 */
export default function ConsentGate({
  onAgree,
  title = 'Consent to Participate',
  contactEmail = 'a.campbell@lmu.de',
  version = C?.CONSENT_VERSION || 'v1',
  bullets = [], // Accept bullets as props
  studyDescription = null, // Optional override for the main description
  showBlindingNote = true, // Set false when study purpose is already disclosed
}) {
  const [isAdult, setIsAdult] = useState(false);
  const [consent, setConsent] = useState(false);
  const [emailValue, setEmailValue] = useState('');
  const [emailOptIn, setEmailOptIn] = useState(null); // null | true | false

  const ready = isAdult && consent;

  const handleContinue = () => {
    if (!ready) return;
    onAgree?.({ email: emailValue.trim(), emailOptIn });
  };

  // Default study description if none provided
  const defaultDescription = "This study evaluates whether focused attention can influence random symbol selection patterns. You will complete multiple short trials and brief questionnaires at the beginning and end (approximately 5 minutes).";

  return (
    <div className="App" style={{ textAlign: 'left' }}>
      <h1 style={{ marginTop: 0 }}>{title}</h1>

      <p>
        {studyDescription || defaultDescription}
      </p>

      {showBlindingNote && (
        <p>
          <strong>Important:</strong> To preserve the scientific validity of the study, some details cannot be fully explained
          until after participation. A full explanation will be provided after data collection for the entire study is
          complete.
        </p>
      )}

      {/* Render bullets if provided, otherwise show default list */}
      {bullets && bullets.length > 0 ? (
        <ul>
          {bullets.map((bullet, index) => (
            <li key={index}>{bullet}</li>
          ))}
          <li>
            Contact: <a href={`mailto:${contactEmail}`}>{contactEmail}</a> with any questions or concerns.
          </li>
        </ul>
      ) : (
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
      )}

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
          I consent to participate in this study. I understand that I may withdraw at any time by closing my browser tab, and that I may request deletion of my data at any time by emailing a request.
        </label>
      </div>

      {/* Email for session linking */}
      <div style={{ marginTop: '1rem' }}>
        <label style={{ display: 'block', fontSize: 14, marginBottom: 4 }}>
          <strong>Your email</strong>
          <span style={{ color: '#374151', fontWeight: 400 }}> — needed to link your sessions for prescreening. Please use the same email every time you participate.</span>
        </label>
        <input
          type="email"
          value={emailValue}
          onChange={e => setEmailValue(e.target.value)}
          placeholder="you@example.com"
          style={{ width: '100%', padding: '8px 10px', fontSize: 14, borderRadius: 6, border: '1px solid #d1d5db', boxSizing: 'border-box' }}
        />
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
          Without an email, your sessions won't be linked and each will be scored independently.
        </div>
      </div>

      {/* Contact permission — only relevant if they've given an email */}
      {emailValue.trim() && (
        <div style={{ marginTop: 12, fontSize: 14 }}>
          <div style={{ marginBottom: 4 }}>
            May we email you about your results?
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
            <input
              type="radio"
              name="emailOptIn"
              checked={emailOptIn === true}
              onChange={() => setEmailOptIn(true)}
            />
            Yes — you may email me about my results.
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="radio"
              name="emailOptIn"
              checked={emailOptIn === false}
              onChange={() => setEmailOptIn(false)}
            />
            No — please do not email me about my results.
          </label>
        </div>
      )}

      {/* hint line, visible until all are checked */}
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