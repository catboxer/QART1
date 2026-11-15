import React, { useState } from 'react';
import { CONTACT_EMAIL, FRIENDLY_TITLE } from './ConsentInfoPage.jsx';
import { looksLikeUserId } from '../lib/userId.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * First page for people who arrive on the plain study link (volunteers).
 * Nothing is read or saved until they choose "Yes" and give their email.
 *
 * onNew()          -> they have not taken part before: go to the consent page
 * onLookup(value)  -> async; `value` is what they typed: an email address or a four-word
 *                     user ID. Resolves { found: true } when the app takes over (so this
 *                     page goes away), or { found: false } to show "not found" here.
 */
export default function ReturningParticipantGate({ onNew, onLookup }) {
  const [step, setStep] = useState('ask'); // 'ask' | 'email'
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [failed, setFailed] = useState(false);

  const valid = EMAIL_RE.test(email.trim()) || looksLikeUserId(email);

  const submit = async (e) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setNotFound(false);
    setFailed(false);
    try {
      const result = await onLookup(email.trim());
      if (!result?.found) setNotFound(true);
    } catch (err) {
      console.error('Returning participant lookup failed:', err);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="App" style={{ textAlign: 'center', maxWidth: 520 }}>
      <h1 style={{ marginTop: 0 }}>{FRIENDLY_TITLE}</h1>

      {step === 'ask' && (
        <>
          <p style={{ fontSize: 18, lineHeight: 1.6 }}>
            Have you already taken part in this study?
          </p>
          <div
            style={{
              display: 'flex',
              gap: 16,
              justifyContent: 'center',
              flexWrap: 'wrap',
              marginTop: '1.25rem',
            }}
          >
            <button type="button" className="secondary-btn" onClick={onNew}>
              No, this is my first time
            </button>
            <button
              type="button"
              className="primary-btn"
              onClick={() => setStep('email')}
            >
              Yes, I have
            </button>
          </div>
        </>
      )}

      {step === 'email' && (
        <form onSubmit={submit} style={{ textAlign: 'left' }}>
          <label
            htmlFor="returning-email"
            style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}
          >
            Please enter the email address or user ID you used before
          </label>
          <input
            id="returning-email"
            type="text"
            className="text-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com, or word-word-word-word"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
          />
          {notFound && (
            <div className="field-hint" role="alert" style={{ marginTop: 8 }}>
              We could not find that email address or user ID. Please check the spelling,
              or go back and choose "No, this is my first time".
            </div>
          )}
          {failed && (
            <div className="field-hint" role="alert" style={{ marginTop: 8 }}>
              Something went wrong. Please try again, or contact{' '}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
            </div>
          )}
          <div
            style={{
              display: 'flex',
              gap: 16,
              justifyContent: 'center',
              flexWrap: 'wrap',
              marginTop: '1.25rem',
            }}
          >
            <button
              type="button"
              className="secondary-btn"
              onClick={() => {
                setStep('ask');
                setNotFound(false);
                setFailed(false);
              }}
            >
              Back
            </button>
            <button
              type="submit"
              className={`primary-btn ${valid && !busy ? '' : 'looks-disabled'}`}
              aria-disabled={valid && !busy ? 'false' : 'true'}
            >
              {busy ? 'Checking…' : 'Continue'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
