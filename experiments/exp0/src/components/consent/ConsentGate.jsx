import React from 'react';
import { config } from '../../lib/config';

export default function ConsentGate({ onAgree, disabled }) {
  return (
    <div className="block-panel">
      <h1>Participant Agreement</h1>
      <p>Consent version: {config.CONSENT_VERSION}</p>
      {/* Put your consent text here (or load from a markdown file). */}
      <div style={{ marginTop: 12 }}>
        <button
          className="primary"
          onClick={onAgree}
          disabled={disabled}
        >
          I agree and am 18+
        </button>
      </div>
    </div>
  );
}
