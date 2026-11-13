import React from 'react';

/**
 * PaymentCompletionPage
 *
 * Shown at the end of every session. Accrued-balance model: payment is not
 * issued per session -- it's tracked as a running total and only actually
 * paid out when a trigger condition is reached (session 5 complete,
 * participant asks to finish early, or two weeks after the study closes).
 * Requesting payment early ends participation (per the Study 2 consent
 * text); that rule is NOT enforced in code yet.
 * This screen is pure UI: `onFinishAndRequestPayment` and `onReturnLater`
 * are the only hooks into whatever payout logic exists.
 */
export default function PaymentCompletionPage({
  sessionsCompleted,
  totalSessions = 5,
  amountPerSession = 5,
  onReturnLater,
  onFinishAndRequestPayment,
  isProlific = false,
}) {
  const amountEarned = sessionsCompleted * amountPerSession;
  const isLastSession = sessionsCompleted >= totalSessions;

  // Prolific-recruited participants are paid by Prolific after each session,
  // so there is no balance, payout request, or early-exit choice to show.
  if (isProlific) {
    return (
      <div className="App" style={{ textAlign: 'center', maxWidth: 560 }}>
        <h1 style={{ marginTop: 0 }}>Session completed</h1>
        <div className="question-block">
          <div style={{ fontSize: 17 }}>
            Sessions completed: {sessionsCompleted} of {totalSessions}
          </div>
        </div>
        <p style={{ fontSize: 15, lineHeight: 1.6 }}>
          Thank you. Payment for this session is handled through Prolific.
        </p>
        <button
          type="button"
          className="primary-btn"
          onClick={() => onReturnLater?.()}
        >
          Continue
        </button>
      </div>
    );
  }

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
        sessions, request an earlier payout, or two weeks after the study
        has closed. If you request payment before completing all{' '}
        {totalSessions} sessions, your participation will end and you will
        not be able to complete additional sessions. You will
        receive €5 for each session you have already completed. Eligible payments will
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
        <button
          type="button"
          className={isLastSession ? 'primary-btn' : 'secondary-btn'}
          onClick={() => onFinishAndRequestPayment?.()}
        >
          Request payment now
        </button>
        {!isLastSession && (
          <button
            type="button"
            className="primary-btn"
            onClick={() => onReturnLater?.()}
          >
            Continue
          </button>
        )}
      </div>

      {!isLastSession && (
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8 }}>
          If you choose "Continue" you can complete additional sessions.
          Choosing "Request payment now" ends your participation.
        </p>
      )}
    </div>
  );
}
