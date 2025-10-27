// validate-qrng.mjs
// Deep validation script for QRNG quality testing
// Run this once with new QRNG provider and periodically to confirm randomness

import fetchQRNGBits from './src/fetchQRNGBits.js';
import fs from 'fs';

// Configuration
const VALIDATION_BITS = 50000; // 50k bits for thorough testing (uses 50% of daily quota)
const CHUNK_SIZE = 1000; // Fetch in 1000-bit chunks to avoid timeout

// Statistical helper functions
function zScore(observed, expected, stdDev) {
  return (observed - expected) / stdDev;
}

function twoSidedP(z) {
  // Approximation of two-tailed p-value from z-score
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return 2 * p;
}

async function fetchValidationBits(totalBits, chunkSize) {
  console.log(`\n🎲 Fetching ${totalBits} bits in chunks of ${chunkSize}...`);
  let allBits = '';
  const numChunks = Math.ceil(totalBits / chunkSize);

  for (let i = 0; i < numChunks; i++) {
    const bitsToFetch = Math.min(chunkSize, totalBits - allBits.length);
    process.stdout.write(`\r  Chunk ${i + 1}/${numChunks} (${allBits.length}/${totalBits} bits)...`);

    const bits = await fetchQRNGBits(bitsToFetch);
    allBits += bits;

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log(`\n✅ Fetched ${allBits.length} bits\n`);
  return allBits;
}

// Test 1: Proportion Test (ones vs zeros)
function testProportion(bits) {
  console.log('═══════════════════════════════════════════════════');
  console.log('TEST 1: PROPORTION TEST (Ones vs Zeros)');
  console.log('═══════════════════════════════════════════════════');

  const n = bits.length;
  const ones = bits.split('').filter(b => b === '1').length;
  const zeros = n - ones;
  const proportion = ones / n;

  const expected = n / 2;
  const stdDev = Math.sqrt(n * 0.5 * 0.5);
  const z = zScore(ones, expected, stdDev);
  const p = twoSidedP(z);

  console.log(`  Total bits: ${n}`);
  console.log(`  Ones: ${ones} (${(proportion * 100).toFixed(2)}%)`);
  console.log(`  Zeros: ${zeros} (${((1 - proportion) * 100).toFixed(2)}%)`);
  console.log(`  Expected: ${expected} (50%)`);
  console.log(`  Z-score: ${z.toFixed(4)}`);
  console.log(`  P-value: ${p.toFixed(6)}`);

  const pass = p > 0.01; // 99% confidence
  console.log(`  Result: ${pass ? '✅ PASS' : '❌ FAIL'} (p ${pass ? '>' : '<'} 0.01)`);

  return { test: 'Proportion', pass, z, p, ones, zeros, proportion };
}

// Test 2: Runs Test (alternation patterns)
function testRuns(bits) {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('TEST 2: RUNS TEST (Alternation Patterns)');
  console.log('═══════════════════════════════════════════════════');

  const n = bits.length;
  const ones = bits.split('').filter(b => b === '1').length;

  // Count runs (consecutive sequences of same bit)
  let runs = 1;
  for (let i = 1; i < n; i++) {
    if (bits[i] !== bits[i - 1]) runs++;
  }

  // Expected runs and standard deviation
  const expectedRuns = (2 * ones * (n - ones)) / n + 1;
  const runsStdDev = Math.sqrt((2 * ones * (n - ones) * (2 * ones * (n - ones) - n)) / (n * n * (n - 1)));
  const z = zScore(runs, expectedRuns, runsStdDev);
  const p = twoSidedP(z);

  console.log(`  Total runs: ${runs}`);
  console.log(`  Expected runs: ${expectedRuns.toFixed(2)}`);
  console.log(`  Z-score: ${z.toFixed(4)}`);
  console.log(`  P-value: ${p.toFixed(6)}`);

  const pass = p > 0.01;
  console.log(`  Result: ${pass ? '✅ PASS' : '❌ FAIL'} (p ${pass ? '>' : '<'} 0.01)`);

  return { test: 'Runs', pass, z, p, runs, expectedRuns };
}

// Test 3: Longest Run Test
function testLongestRun(bits) {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('TEST 3: LONGEST RUN TEST');
  console.log('═══════════════════════════════════════════════════');

  const n = bits.length;

  let maxRun = 1;
  let currentRun = 1;
  for (let i = 1; i < n; i++) {
    if (bits[i] === bits[i - 1]) {
      currentRun++;
      maxRun = Math.max(maxRun, currentRun);
    } else {
      currentRun = 1;
    }
  }

  // Expected longest run is approximately log2(n)
  const expectedMax = Math.log2(n);
  const tolerance = 5; // ±5 from expected is reasonable

  console.log(`  Longest run: ${maxRun}`);
  console.log(`  Expected (log2(n)): ${expectedMax.toFixed(2)}`);
  console.log(`  Tolerance: ±${tolerance}`);

  const pass = Math.abs(maxRun - expectedMax) <= tolerance;
  console.log(`  Result: ${pass ? '✅ PASS' : '❌ FAIL'}`);

  return { test: 'LongestRun', pass, maxRun, expectedMax };
}

// Test 4: Positional Bias Test (the one that caught the old QRNG bug!)
function testPositionalBias(bits) {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('TEST 4: POSITIONAL BIAS TEST (Every Nth Bit)');
  console.log('═══════════════════════════════════════════════════');
  console.log('Testing positions 0-31 (would catch every-4th-bit bug)');

  const results = [];
  let anyFailed = false;

  // Test every position from 0 to 31
  for (let pos = 0; pos < 32; pos++) {
    let ones = 0;
    let count = 0;

    // Extract every bit at this position
    for (let i = pos; i < bits.length; i += 32) {
      if (bits[i] === '1') ones++;
      count++;
    }

    const proportion = ones / count;
    const expected = count / 2;
    const stdDev = Math.sqrt(count * 0.5 * 0.5);
    const z = zScore(ones, expected, stdDev);
    const p = twoSidedP(z);

    const pass = p > 0.01; // 99% confidence

    if (!pass) {
      console.log(`  ❌ Position ${pos}: ${ones}/${count} (${(proportion * 100).toFixed(1)}%) - Z=${z.toFixed(2)}, p=${p.toFixed(4)}`);
      anyFailed = true;
    } else if (proportion < 0.45 || proportion > 0.55) {
      // Show positions with notable bias even if they pass
      console.log(`  ⚠️  Position ${pos}: ${ones}/${count} (${(proportion * 100).toFixed(1)}%) - Z=${z.toFixed(2)}, p=${p.toFixed(4)}`);
    }

    results.push({ pos, ones, count, proportion, z, p, pass });
  }

  if (!anyFailed) {
    console.log('  ✅ All 32 positions PASS');
  }

  console.log(`  Result: ${!anyFailed ? '✅ PASS' : '❌ FAIL'}`);

  return { test: 'PositionalBias', pass: !anyFailed, positions: results };
}

// Test 5: Autocorrelation Test (check for periodic patterns)
function testAutocorrelation(bits, maxLag = 16) {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('TEST 5: AUTOCORRELATION TEST (Periodic Patterns)');
  console.log('═══════════════════════════════════════════════════');
  console.log(`Testing lags 1-${maxLag}`);

  const n = bits.length;
  const bitsArray = bits.split('').map(b => parseInt(b));
  const mean = bitsArray.reduce((a, b) => a + b, 0) / n;

  let anyFailed = false;
  const results = [];

  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < n - lag; i++) {
      sum += (bitsArray[i] - mean) * (bitsArray[i + lag] - mean);
    }

    const correlation = sum / (n - lag);

    // For random data, autocorrelation should be near 0
    // With n bits, standard error is approximately 1/sqrt(n)
    const se = 1 / Math.sqrt(n - lag);
    const z = correlation / se;
    const p = twoSidedP(z);

    const pass = p > 0.01;

    if (!pass) {
      console.log(`  ❌ Lag ${lag}: r=${correlation.toFixed(6)}, Z=${z.toFixed(2)}, p=${p.toFixed(4)}`);
      anyFailed = true;
    } else if (Math.abs(correlation) > 0.01) {
      console.log(`  ⚠️  Lag ${lag}: r=${correlation.toFixed(6)}, Z=${z.toFixed(2)}, p=${p.toFixed(4)}`);
    }

    results.push({ lag, correlation, z, p, pass });
  }

  if (!anyFailed) {
    console.log('  ✅ All lags PASS');
  }

  console.log(`  Result: ${!anyFailed ? '✅ PASS' : '❌ FAIL'}`);

  return { test: 'Autocorrelation', pass: !anyFailed, lags: results };
}

// Main validation function
async function validateQRNG() {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║       QRNG DEEP VALIDATION SCRIPT                 ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log(`\nValidating with ${VALIDATION_BITS} bits`);
  console.log(`This will use ~${VALIDATION_BITS.toLocaleString()} of your 100k daily quota\n`);

  try {
    // Fetch bits
    const bits = await fetchValidationBits(VALIDATION_BITS, CHUNK_SIZE);

    // Run all tests
    const results = [];
    results.push(testProportion(bits));
    results.push(testRuns(bits));
    results.push(testLongestRun(bits));
    results.push(testPositionalBias(bits));
    results.push(testAutocorrelation(bits));

    // Summary
    console.log('\n╔═══════════════════════════════════════════════════╗');
    console.log('║                 VALIDATION SUMMARY                ║');
    console.log('╚═══════════════════════════════════════════════════╝\n');

    const passed = results.filter(r => r.pass).length;
    const total = results.length;

    results.forEach(r => {
      console.log(`  ${r.pass ? '✅' : '❌'} ${r.test}`);
    });

    console.log('\n' + '═'.repeat(51));

    if (passed === total) {
      console.log(`  ✅ ALL TESTS PASSED (${passed}/${total})`);
      console.log('  QRNG appears to be producing random data');
      console.log('  Safe to use for experiments');
    } else {
      console.log(`  ❌ SOME TESTS FAILED (${passed}/${total} passed)`);
      console.log('  ⚠️  WARNING: QRNG may have systematic bias');
      console.log('  DO NOT USE for experiments until resolved');
    }

    console.log('═'.repeat(51) + '\n');

    // Save results to file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `qrng-validation-${timestamp}.json`;
    fs.writeFileSync(filename, JSON.stringify({
      timestamp: new Date().toISOString(),
      bits: VALIDATION_BITS,
      results: results,
      passed: passed === total
    }, null, 2));

    console.log(`📁 Full results saved to: ${filename}\n`);

  } catch (error) {
    console.error('❌ Validation failed:', error.message);
    process.exit(1);
  }
}

// Run validation
validateQRNG().then(() => {
  console.log('✅ Validation complete');
  process.exit(0);
}).catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
