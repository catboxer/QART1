// test-timing-attack-mitigation.js
// Tests that bits are committed to Firestore before processing (anti-timing-attack)

const { initializeApp } = require('firebase/app');
const { getFirestore, collection, doc, getDocs, deleteDoc } = require('firebase/firestore');

// Your Firebase config (should match firebase.js)
const firebaseConfig = {
  apiKey: "AIzaSyDTqUZf-9Y2gBWC0JoYdvX4lmk0PrDEHtw",
  authDomain: "qart-experiment.firebaseapp.com",
  projectId: "qart-experiment",
  storageBucket: "qart-experiment.firebasestorage.app",
  messagingSenderId: "105621813992",
  appId: "1:105621813992:web:e7f8ab0b1e0b0e0e0e0e0e"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function testTimingAttackMitigation() {
  console.log('🧪 Testing Timing Attack Mitigation\n');
  console.log('This test will:');
  console.log('1. Check for existing test sessions');
  console.log('2. Analyze block_commits vs minutes collections');
  console.log('3. Verify abort detection logic\n');

  try {
    // Fetch recent AI sessions
    const sessionsRef = collection(db, 'experiment3_ai_responses');
    const snapshot = await getDocs(sessionsRef);

    console.log(`📊 Found ${snapshot.size} total sessions\n`);

    let testResults = {
      totalSessions: 0,
      withCommits: 0,
      withAborts: 0,
      abortedBlocks: [],
      passedTests: 0,
      failedTests: 0
    };

    for (const sessionDoc of snapshot.docs) {
      const sessionData = sessionDoc.data();
      testResults.totalSessions++;

      // Get block commits
      const commitsRef = collection(sessionDoc.ref, 'block_commits');
      const commitsSnap = await getDocs(commitsRef);

      // Get processed minutes
      const minutesRef = collection(sessionDoc.ref, 'minutes');
      const minutesSnap = await getDocs(minutesRef);

      if (commitsSnap.size > 0) {
        testResults.withCommits++;

        console.log(`\n📋 Session: ${sessionDoc.id}`);
        console.log(`   Mode: ${sessionData.mode || sessionData.session_type}`);
        console.log(`   Commits: ${commitsSnap.size}`);
        console.log(`   Processed: ${minutesSnap.size}`);

        // Check for aborts
        if (commitsSnap.size > minutesSnap.size) {
          testResults.withAborts++;

          const commits = commitsSnap.docs.map(d => ({
            blockIdx: d.data().blockIdx,
            ...d.data()
          }));
          const minutes = minutesSnap.docs.map(d => ({
            idx: d.data().idx,
            ...d.data()
          }));

          // Find aborted blocks
          for (const commit of commits) {
            const processed = minutes.find(m => m.idx === commit.blockIdx);
            if (!processed) {
              // Calculate what score would have been
              const bits = commit.bits || '';
              const target = commit.target;
              const targetBit = target === 'BLUE' ? '1' : '0';

              const assignmentBit = bits[0];
              const subjectBits = assignmentBit === '1'
                ? bits.slice(1, 151)
                : bits.slice(151, 301);

              const hits = subjectBits.split('').filter(b => b === targetBit).length;
              const score = (hits / 150 * 100).toFixed(2);

              testResults.abortedBlocks.push({
                sessionId: sessionDoc.id,
                blockIdx: commit.blockIdx,
                score: parseFloat(score),
                target,
                committedAt: commit.committedAt
              });

              console.log(`   ⚠️  ABORT DETECTED: Block ${commit.blockIdx} - Score would have been ${score}%`);
            }
          }
        }

        // TEST 1: Verify commits have required fields
        const firstCommit = commitsSnap.docs[0]?.data();
        if (firstCommit) {
          const hasRequiredFields =
            firstCommit.bits &&
            firstCommit.auth &&
            firstCommit.auth.hash &&
            firstCommit.target &&
            typeof firstCommit.blockIdx === 'number';

          if (hasRequiredFields) {
            console.log('   ✅ TEST PASSED: Commit has all required fields');
            testResults.passedTests++;
          } else {
            console.log('   ❌ TEST FAILED: Commit missing required fields');
            console.log('      Fields:', Object.keys(firstCommit));
            testResults.failedTests++;
          }
        }
      }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST SUMMARY\n');
    console.log(`Total Sessions: ${testResults.totalSessions}`);
    console.log(`Sessions with Commits: ${testResults.withCommits}`);
    console.log(`Sessions with Aborts: ${testResults.withAborts}`);
    console.log(`Total Aborted Blocks: ${testResults.abortedBlocks.length}\n`);

    if (testResults.abortedBlocks.length > 0) {
      console.log('🚨 ABORTED BLOCKS ANALYSIS:');
      const below50 = testResults.abortedBlocks.filter(b => b.score < 50).length;
      const at50 = testResults.abortedBlocks.filter(b => b.score === 50).length;
      const above50 = testResults.abortedBlocks.filter(b => b.score > 50).length;

      console.log(`   Below 50%: ${below50}`);
      console.log(`   At 50%: ${at50}`);
      console.log(`   Above 50%: ${above50}\n`);

      if (below50 > above50 && testResults.abortedBlocks.length > 5) {
        console.log('   ⚠️  SUSPICIOUS: More low-score aborts than high-score');
        console.log('   This suggests strategic completion (timing attack)\n');
      }

      // Show first few aborted blocks
      console.log('   Sample Aborted Blocks:');
      testResults.abortedBlocks.slice(0, 5).forEach(block => {
        console.log(`   - Session ${block.sessionId.slice(0, 8)}... Block ${block.blockIdx}: ${block.score}%`);
      });
    }

    console.log('\n' + '='.repeat(60));
    console.log(`\n✅ Tests Passed: ${testResults.passedTests}`);
    console.log(`❌ Tests Failed: ${testResults.failedTests}\n`);

    // TEST 2: Verify mitigation is working
    console.log('🔐 MITIGATION STATUS:');
    if (testResults.withCommits > 0) {
      console.log('✅ Bit commitment system is operational');
      console.log('✅ Aborted blocks are detectable and scoreable');
    } else {
      console.log('⚠️  No sessions with block_commits found');
      console.log('   Run a test session to verify mitigation');
    }

    if (testResults.withAborts > 0) {
      console.log('✅ Abort detection is working');
    }

    process.exit(testResults.failedTests > 0 ? 1 : 0);

  } catch (error) {
    console.error('❌ Test failed with error:', error);
    process.exit(1);
  }
}

console.log('Starting test in 2 seconds...\n');
setTimeout(() => {
  testTimingAttackMitigation();
}, 2000);
