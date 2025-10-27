// experiments/exp3/generate-ghost-tapes.js
// One-time script to generate 6 validated ghost tapes and save to Firebase

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, setDoc } from 'firebase/firestore';

// Import the fetch function (you'll need to adapt this for Node)
async function fetchQRNGBits(nBits) {
  const nBytes = Math.ceil(nBits / 8);
  const response = await fetch(`http://localhost:8888/.netlify/functions/qrng-race?n=${nBytes}`);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  if (!data.success || !Array.isArray(data.bytes)) {
    throw new Error(`Invalid response`);
  }

  let allBits = '';
  for (const byte of data.bytes) {
    allBits += (byte >>> 0).toString(2).padStart(8, '0');
  }

  return allBits.slice(0, nBits);
}

function validateRandomness(bits) {
  const n = bits.length;
  const ones = bits.split('').filter(b => b === '1').length;
  const onesRatio = ones / n;

  // Test 1: Proportion test
  const expectedOnes = n / 2;
  const stdDev = Math.sqrt(n * 0.5 * 0.5);
  const zScore = Math.abs((ones - expectedOnes) / stdDev);
  const proportionPass = zScore < 3;

  // Test 2: Runs test
  let runs = 1;
  for (let i = 1; i < n; i++) {
    if (bits[i] !== bits[i-1]) runs++;
  }
  const expectedRuns = (2 * ones * (n - ones)) / n + 1;
  const runsStdDev = Math.sqrt((2 * ones * (n - ones) * (2 * ones * (n - ones) - n)) / (n * n * (n - 1)));
  const runsZ = Math.abs((runs - expectedRuns) / runsStdDev);
  const runsPass = runsZ < 3;

  // Test 3: Longest run
  let maxRun = 1, currentRun = 1;
  for (let i = 1; i < n; i++) {
    if (bits[i] === bits[i-1]) {
      currentRun++;
      maxRun = Math.max(maxRun, currentRun);
    } else {
      currentRun = 1;
    }
  }
  const expectedMaxRun = Math.log2(n);
  const maxRunPass = maxRun < expectedMaxRun * 3;

  const isRandom = proportionPass && runsPass && maxRunPass;

  return {
    isRandom,
    stats: {
      length: n,
      ones,
      onesRatio: onesRatio.toFixed(4),
      zScore: zScore.toFixed(3),
      proportionPass,
      runs,
      expectedRuns: expectedRuns.toFixed(1),
      runsZ: runsZ.toFixed(3),
      runsPass,
      maxRun,
      expectedMaxRun: expectedMaxRun.toFixed(1),
      maxRunPass
    }
  };
}

async function generateGhostTapes() {
  console.log('🎲 Generating 6 validated ghost tapes...\n');

  // Initialize Firebase (use your config)
  const firebaseConfig = {
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.VITE_FIREBASE_APP_ID
  };

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  const GHOST_BITS = 4800; // 160 trials × 30 blocks
  const tapes = [];

  for (let i = 1; i <= 6; i++) {
    console.log(`\n📡 Fetching ghost tape ${i}/6...`);

    let bits;
    let attempts = 0;

    // Keep trying until we get a validated random sequence
    while (attempts < 10) {
      attempts++;
      bits = await fetchQRNGBits(GHOST_BITS);
      const validation = validateRandomness(bits);

      console.log(`   Attempt ${attempts} validation:`, validation.stats);

      if (validation.isRandom) {
        console.log(`   ✅ Tape ${i} validated!`);
        break;
      } else {
        console.log(`   ⚠️ Failed validation, retrying...`);
      }
    }

    if (attempts >= 10) {
      throw new Error(`Failed to generate valid tape ${i} after 10 attempts`);
    }

    tapes.push({ id: `tape${i}`, bits, createdAt: new Date().toISOString() });
  }

  console.log('\n💾 Saving tapes to Firebase...');

  for (const tape of tapes) {
    await setDoc(doc(db, 'ghostTapes', tape.id), {
      bits: tape.bits,
      length: tape.bits.length,
      createdAt: tape.createdAt,
      validated: true
    });
    console.log(`   ✅ Saved ${tape.id}`);
  }

  console.log('\n🎉 All 6 ghost tapes generated and saved to Firebase!');
  console.log('   Collection: ghostTapes');
  console.log('   Documents: tape1, tape2, tape3, tape4, tape5, tape6');
}

generateGhostTapes().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
