import React from 'react';
import SelfCheckWidget from './SelfCheckWidget';

export default function FoldedSelfCheck() {
  return (
    <details className="expander" style={{ marginTop: '0.75rem' }}>
      <summary>Check your own result (tap to expand)</summary>
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <p
          style={{
            display: 'inline-block',
            textAlign: 'left',
            maxWidth: '600px',
            width: '100%',
          }}
        >
          Some people are curious whether their results are{' '}
          <strong>above chance</strong>. We’re <em>not</em> claiming
          this test detects any special ability; it may not. This is
          just a standard way to summarize your results.
        </p>

        <h4>How to check (step-by-step)</h4>
        <ol style={{ textAlign: 'left' }}>
          <li>
            Decide your number of runs in advance. Avoid “peeking and
            stopping” when it looks good — that inflates false
            positives. <strong>3 Runs - Sure</strong>,{' '}
            <strong>5 Runs - More Sure</strong>, or{' '}
            <strong>10 Runs - Really Sure</strong>.
            <br />
            (Each run = 100 trials.)
          </li>
          <li>
            Make sure to write down your results after every run.
          </li>
          <li>
            On the last trial in your plan enter your scores into our
            handy app below. PASS in green means it was signficant at
            the level you selected.
          </li>
          <li>
            If you only wrote down percentages, 55% of 100 =&nbsp;
            <strong>55 hits</strong>, etc.
          </li>
          <li>
            {' '}
            Take breaks if you’re tired; you can come back tomorrow.
          </li>
          <li>
            <strong>Interpret cautiously.</strong> Clearing a
            threshold suggests results consistent with above chance in
            this experiment, but it is not evidence of an inherent
            ability. Failing to clear it can be due to normal
            statistical noise.
          </li>
        </ol>

        {/* The interactive checker */}
        <div style={{ marginTop: 12 }}>
          <SelfCheckWidget trialsPerSession={100} />
        </div>
      </div>
    </details>
  );
}
