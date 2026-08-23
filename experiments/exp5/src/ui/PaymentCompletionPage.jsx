import React from 'react';

/**
 * PaymentCompletionPage
 *
 * Shown at the end of every session. Accrued-balance model: payment is not
 * issued per session -- it's tracked as a running total and only actually
 * paid out when a trigger condition is reached (session 5 complete,
 * participant asks to finish early, 14 days inactive, study closes/
 * withdrawal). Requesting payment early does not end participation --
 * additional sessions completed later accrue toward a second payment.
 * This screen is pure UI: `onFinishAndRequestPayment` and `onReturnLater`
 * are the only hooks into whatever payout logic exists.
 */
export default function PaymentCompletionPage({
  sessionsCompleted,
  totalSessions = 5,
  amountPerSession = 5,
  onReturnLater,
  onFinishAndRequestPayment,
}) {
  const amountEarned = sessionsCompleted * amountPerSession;
  const isLastSession = sessionsCompleted >= totalSessions;

  return (
    <div className="App" style={{ textAlign: 'center', maxWidth: 560 }}>
      <h1 style={{ marginTop: 0 }}>Session completed</h1>

      <div
        className="question-block"
        style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}
      >
        <div style={{ fontSize: 17 }}>
          Sessions completed: {sessionsCompleted} of {totalSessions}
        </div>
        <div style={{ fontSize: 28, fontWeight: 700 }}>
          Compensation earned: €{amountEarned}
        </div>
      </div>

      <p style={{ fontSize: 15, lineHeight: 1.6 }}>
        Payment will be issued after you complete all {totalSessions}{' '}
        sessions, request an earlier payout, or have been inactive for 14
        days. You will not lose
        compensation earned for completed sessions. Eligible payments will
        normally be processed within 7–14 days.
      </p>

      <div
        className="question-block"
        style={{ textAlign: 'left', fontSize: 13.5, color: 'var(--muted)' }}
      >
        Payment is handled separately from your questionnaire responses and
        experimental results. The payment service will receive only the
        information required to issue your payment and satisfy applicable
        financial-record requirements.
      </div>

      <div
        style={{
          display: 'flex',
          gap: 16,
          justifyContent: 'center',
          flexWrap: 'wrap',
          marginTop: '1rem',
        }}
      >
        {!isLastSession && (
          <button
            type="button"
            className="secondary-btn"
            onClick={() => onReturnLater?.()}
          >
            Continue later
          </button>
        )}
        <button
          type="button"
          className="primary-btn"
          onClick={() => onFinishAndRequestPayment?.()}
        >
          Request payment now
        </button>
      </div>

      {!isLastSession && (
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8 }}>
          You may still complete additional sessions later. Any additional
          compensation earned will be paid separately.
        </p>
      )}
    </div>
  );
}
