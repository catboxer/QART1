import React, { useState } from 'react';

/**
 * RecoverCodeScreen
 *
 * MOCKUP ONLY -- not wired to any backend yet. Built for screenshots /
 * ethics-review documentation of the intended flow. `onSubmit` is a no-op
 * placeholder prop; wire it up once the actual lookup exists.
 */
export default function RecoverCodeScreen({ onSubmit, onBack }) {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    setSubmitted(true);
    onSubmit?.(email.trim());
  };

  return (
    <div className="App" style={{ textAlign: 'center', maxWidth: 480 }}>
      <h1 style={{ marginTop: 0 }}>Recover your participant code</h1>

      <p style={{ fontSize: 15, lineHeight: 1.6 }}>
        Enter the email address you provided when you consented. If it
        matches our records, we will send your participant code to that
        address.
      </p>

      {submitted ? (
        <div
          className="question-block"
          style={{ fontSize: 15, lineHeight: 1.6 }}
        >
          If this email address matches our records, your participant code
          will be sent shortly. Please check your spam folder.
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ textAlign: 'left' }}>
          <label
            htmlFor="recover-email"
            style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}
          >
            Email address
          </label>
          <input
            id="recover-email"
            type="email"
            className="text-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />
          <div style={{ textAlign: 'center' }}>
            <button type="submit" className="primary-btn">
              Send my code
            </button>
          </div>
        </form>
      )}

      <button
        type="button"
        className="ghost-btn"
        onClick={() => onBack?.()}
        style={{ marginTop: '1rem' }}
      >
        Back
      </button>
    </div>
  );
}
