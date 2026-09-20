import React, { useState } from 'react';

/**
 * ResumeWithCodeScreen
 *
 * MOCKUP ONLY -- not wired to any backend yet. Built for screenshots /
 * ethics-review documentation of the intended flow. A returning participant
 * enters their existing participant code here to verify their consent and
 * skip straight past consent and the pre-questionnaire into the next
 * session. `onSubmit` and `onNoCode` are no-op placeholder props; wire them
 * up once the actual lookup exists.
 */
export default function ResumeWithCodeScreen({ onSubmit, onNoCode }) {
  const [code, setCode] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit?.(code.trim());
  };

  return (
    <div className="App" style={{ textAlign: 'center', maxWidth: 480 }}>
      <h1 style={{ marginTop: 0 }}>Welcome back</h1>

      <p style={{ fontSize: 15, lineHeight: 1.6 }}>
        Enter your participant code to verify your existing consent and
        continue with your next session. You will not need to go through
        consent or the questionnaire again.
      </p>

      <form onSubmit={handleSubmit} style={{ textAlign: 'left' }}>
        <label
          htmlFor="resume-code"
          style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}
        >
          Participant code
        </label>
        <input
          id="resume-code"
          type="text"
          className="text-input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="e.g. falcon-otter-meadow"
          autoComplete="off"
          required
        />
        <div style={{ textAlign: 'center' }}>
          <button type="submit" className="primary-btn">
            Continue
          </button>
        </div>
      </form>

      <button
        type="button"
        className="ghost-btn"
        onClick={() => onNoCode?.()}
        style={{ marginTop: '1rem' }}
      >
        I don't have my code
      </button>

      <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: '1.5rem' }}>
        Participation in this study remains voluntary. You may stop at any
        time without penalty.
      </p>
    </div>
  );
}
