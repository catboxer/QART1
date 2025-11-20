// backfill-aggregates.js
// One-time script to add aggregates to all existing sessions
// Run with: node experiments/exp4/backfill-aggregates.js

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Initialize Firebase Admin
const serviceAccountPath = path.join(__dirname, '../../serviceAccountKey.json');

if (!fs.existsSync(serviceAccountPath)) {
  console.error('❌ ERROR: serviceAccountKey.json not found at:', serviceAccountPath);
  console.error('Please download your Firebase service account key and place it in the project root.');
  process.exit(1);
}

const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function backfillAggregates() {
  console.log('🔄 Starting aggregate backfill...\n');

  try {
    // Fetch all sessions
    const runsSnapshot = await db.collection('experiment3_ai_responses')
      .orderBy('createdAt', 'desc')
      .get();

    console.log(`📊 Found ${runsSnapshot.size} total sessions\n`);

    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const runDoc of runsSnapshot.docs) {
      const runId = runDoc.id;
      const runData = runDoc.data();

      // Skip if aggregates already exist
      if (runData.aggregates) {
        skipped++;
        continue;
      }

      try {
        // Fetch minutes subcollection
        const minutesSnapshot = await db.collection('experiment3_ai_responses')
          .doc(runId)
          .collection('minutes')
          .get();

        // Calculate aggregates
        let totalHits = 0;
        let totalTrials = 0;
        let totalGhostHits = 0;
        let blocksCompleted = 0;

        minutesSnapshot.forEach(minuteDoc => {
          const minute = minuteDoc.data();
          totalHits += minute.hits || 0;
          totalTrials += minute.n || 0;
          totalGhostHits += minute.demon_hits || 0;
          blocksCompleted++;
        });

        const hitRate = totalTrials > 0 ? totalHits / totalTrials : 0.5;
        const ghostHitRate = totalTrials > 0 ? totalGhostHits / totalTrials : 0.5;

        // Save aggregates
        const aggregates = {
          totalHits,
          totalTrials,
          totalGhostHits,
          hitRate,
          ghostHitRate,
          blocksCompleted,
          blocksPlanned: 30, // Default from config
          sessionComplete: runData.completed || false,
          target: runData.target_side || 'UNKNOWN',
          lastUpdated: new Date().toISOString(),
          backfilled: true // Mark as backfilled for tracking
        };

        await db.collection('experiment3_ai_responses')
          .doc(runId)
          .set({ aggregates }, { merge: true });

        updated++;
        console.log(`✅ ${updated}. Updated session ${runId}: ${totalHits}/${totalTrials} (${(hitRate * 100).toFixed(1)}%), ${blocksCompleted} blocks`);

      } catch (error) {
        errors++;
        console.error(`❌ Error processing session ${runId}:`, error.message);
      }
    }

    console.log('\n📈 Backfill Summary:');
    console.log(`   ✅ Updated: ${updated} sessions`);
    console.log(`   ⏭️  Skipped: ${skipped} sessions (already have aggregates)`);
    console.log(`   ❌ Errors: ${errors} sessions`);
    console.log('\n✨ Backfill complete!\n');

  } catch (error) {
    console.error('❌ Fatal error during backfill:', error);
    process.exit(1);
  }

  process.exit(0);
}

// Run the backfill
backfillAggregates();
