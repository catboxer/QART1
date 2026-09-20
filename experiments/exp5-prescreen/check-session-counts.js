// experiments/exp5-prescreen/check-session-counts.js
// Prints completed session counts by session_type (baseline / ai_agent / human)
// from prescreen_sessions_exp5. Read-only against Firestore.
//
// Run with: node experiments/exp5-prescreen/check-session-counts.js
// Used periodically by run-unattended-loop.sh to log real progress toward a
// session-count target, since the loop's own CYCLES counter only tracks
// attempted sessions, not how many actually completed.

const path = require('path');
const admin = require('firebase-admin');

const serviceAccountPath = path.join(__dirname, '../../serviceAccountKey.json');
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(require(serviceAccountPath)) });
}
const db = admin.firestore();
const COLLECTION = 'prescreen_sessions_exp5';

async function main() {
  const types = ['baseline', 'ai_agent', 'human'];
  const counts = {};
  for (const t of types) {
    const snap = await db.collection(COLLECTION).where('session_type', '==', t).get();
    let completed = 0;
    snap.forEach((d) => {
      if (d.data().completed === true) completed++;
    });
    counts[t] = { total: snap.size, completed };
  }
  console.log(
    `[session-count ${new Date().toISOString()}] ` +
      `baseline: ${counts.baseline.completed} completed / ${counts.baseline.total} total | ` +
      `ai_agent: ${counts.ai_agent.completed} completed / ${counts.ai_agent.total} total`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('session-count check failed:', e.message);
    process.exit(0); // never fail the calling loop over a check-only script
  });
