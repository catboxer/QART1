import { markPaymentRequested } from './database.js';

/**
 * "Request payment now": records the request on the participant's profile
 * (the real record) and sends a Netlify Forms submission so the study team
 * gets an email alert. Neither step may block the participant: failures are
 * logged and swallowed. The alert carries the payment code from the
 * participant's link, never their email address.
 *
 * The Netlify form only exists on the deployed site (not under `netlify dev`).
 */
export async function recordPaymentRequest({
  participantHash,
  tremendousCode,
  sessionsCompleted,
}) {
  const tasks = [];

  if (participantHash) {
    tasks.push(markPaymentRequested(participantHash));
  }

  const body = new URLSearchParams({
    'form-name': 'payment-request',
    'bot-field': '',
    tremendous_code: tremendousCode || '(no code)',
    participant_key: participantHash || '',
    sessions_completed: String(sessionsCompleted ?? ''),
  });
  tasks.push(
    fetch('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    }),
  );

  const results = await Promise.allSettled(tasks);
  results.forEach((r) => {
    if (r.status === 'rejected') console.error('Payment request step failed:', r.reason);
  });
}
