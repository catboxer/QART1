// validate-lfdr-direct.js
// Fetch 50,000 bits directly from LFDR and run all validation tests including Test 5

const https = require('https');

// Configuration
const VALIDATION_BITS = 50000;
const CHUNK_SIZE = 1000; // LFDR can handle ~1000 bits per request

// Fetch QRNG bits directly from LFDR
async function fetchLFDRBits(nBits) {
  const nBytes = Math.ceil(nBits / 8);
  const url = `https://lfdr.de/qrng_api/qrng?length=${nBytes}&format=HEX`;

  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (!json || typeof json.qrn !== 'string') {
            reject(new Error('Invalid LFDR response format'));
            return;
          }

          // Convert hex to bits
          const hex = json.qrn.trim();
          let bits = '';
          for (let i = 0; i < hex.length; i += 2) {
            const byte = parseInt(hex.substr(i, 2), 16);
            bits += byte.toString(2).padStart(8, '0');
          }

          resolve(bits.slice(0, nBits));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', (e) => {
      reject(e);
    });
  });
}

// Fetch validation bits in chunks
async function fetchValidationBits(totalBits, chunkSize) {
  console.log(`\n🎲 Fetching ${totalBits} bits from LFDR in chunks of ${chunkSize}...`);
  let allBits = '';
  const numChunks = Math.ceil(totalBits / chunkSize);

  for (let i = 0; i < numChunks; i++) {
    const bitsToFetch = Math.min(chunkSize, totalBits - allBits.length);
    process.stdout.write(`\r  Chunk ${i + 1}/${numChunks} (${allBits.length}/${totalBits} bits)...`);

    const bits = await fetchLFDRBits(bitsToFetch);
    allBits += bits;

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log(`\n✅ Fetched ${allBits.length} bits\n`);
  return allBits;
}

// Statistical helper functions
function zScore(observed, expected, stdDev) {
  return (observed - expected) / stdDev;
}

function twoSidedP(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return 2 * p;
}

// Test 1: Proportion Test
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

  const pass = p > 0.01;
  console.log(`  Result: ${pass ? '✅ PASS' : '❌ FAIL'} (p ${pass ? '>' : '<'} 0.01)`);

  return { test: 'Proportion', pass, z, p, ones, zeros, proportion };
}

// Test 2: Runs Test
function testRuns(bits) {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('TEST 2: RUNS TEST (Alternation Patterns)');
  console.log('═══════════════════════════════════════════════════');

  const n = bits.length;
  const ones = bits.split('').filter(b => b === '1').length;

  let runs = 1;
  for (let i = 1; i < n; i++) {
    if (bits[i] !== bits[i - 1]) runs++;
  }

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

  const expectedMax = Math.log2(n);
  const tolerance = 5;

  console.log(`  Longest run: ${maxRun}`);
  console.log(`  Expected (log2(n)): ${expectedMax.toFixed(2)}`);
  console.log(`  Tolerance: ±${tolerance}`);

  const pass = Math.abs(maxRun - expectedMax) <= tolerance;
  console.log(`  Result: ${pass ? '✅ PASS' : '❌ FAIL'}`);

  return { test: 'LongestRun', pass, maxRun, expectedMax };
}

// Test 4: Positional Bias Test
function testPositionalBias(bits) {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('TEST 4: POSITIONAL BIAS TEST (Every Nth Bit)');
  console.log('═══════════════════════════════════════════════════');
  console.log('Testing positions 0-31 (would catch every-4th-bit bug)');

  const results = [];
  let anyFailed = false;

  for (let pos = 0; pos < 32; pos++) {
    let ones = 0;
    let count = 0;

    for (let i = pos; i < bits.length; i += 32) {
      if (bits[i] === '1') ones++;
      count++;
    }

    const proportion = ones / count;
    const expected = count / 2;
    const stdDev = Math.sqrt(count * 0.5 * 0.5);
    const z = zScore(ones, expected, stdDev);
    const p = twoSidedP(z);

    const pass = p > 0.01;

    if (!pass) {
      console.log(`  ❌ Position ${pos}: ${ones}/${count} (${(proportion * 100).toFixed(1)}%) - Z=${z.toFixed(2)}, p=${p.toFixed(4)}`);
      anyFailed = true;
    } else if (proportion < 0.45 || proportion > 0.55) {
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

// Test 5: Byte-Level Bit Position Test (catches LFDR-style bugs)
function testByteLevelBias(bits) {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('TEST 5: BYTE-LEVEL BIT POSITION TEST');
  console.log('═══════════════════════════════════════════════════');
  console.log('Testing bit positions 1-8 within each byte');
  console.log('(This catches bugs like LFDR\'s 4th/8th bit bug)\n');

  const numBytes = Math.floor(bits.length / 8);
  const results = [];
  let anyFailed = false;

  for (let bitPos = 0; bitPos < 8; bitPos++) {
    let ones = 0;
    let count = 0;

    for (let byteIdx = 0; byteIdx < numBytes; byteIdx++) {
      const bitIdx = byteIdx * 8 + bitPos;
      if (bits[bitIdx] === '1') ones++;
      count++;
    }

    const proportion = ones / count;
    const expected = count / 2;
    const stdDev = Math.sqrt(count * 0.5 * 0.5);
    const z = zScore(ones, expected, stdDev);
    const p = twoSidedP(z);

    const pass = p > 0.01;

    const status = !pass ? '❌ FAIL' : (Math.abs(proportion - 0.5) > 0.05 ? '⚠️  WARN' : '✅ PASS');
    console.log(`  Bit ${bitPos + 1}: ${ones.toString().padStart(5)}/${count} (${(proportion * 100).toFixed(2)}%) - Z=${z.toFixed(2).padStart(6)}, p=${p.toFixed(4)} ${status}`);

    if (!pass) {
      anyFailed = true;
    }

    results.push({ bitPos: bitPos + 1, ones, count, proportion, z, p, pass });
  }

  console.log(`\n  Result: ${!anyFailed ? '✅ PASS - All byte-level positions look random' : '❌ FAIL - Some positions show bias'}`);

  return { test: 'ByteLevelBias', pass: !anyFailed, positions: results };
}

// Test 6: Autocorrelation Test
function testAutocorrelation(bits, maxLag = 16) {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('TEST 6: AUTOCORRELATION TEST (Periodic Patterns)');
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
async function validateLFDR() {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║       LFDR QRNG DIRECT VALIDATION                 ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log(`\nValidating LFDR with ${VALIDATION_BITS} bits`);
  console.log(`Source: https://lfdr.de/qrng_api/qrng\n`);

  try {
    // Fetch bits
    const bits = await fetchValidationBits(VALIDATION_BITS, CHUNK_SIZE);

    // Run all tests
    const results = [];
    results.push(testProportion(bits));
    results.push(testRuns(bits));
    results.push(testLongestRun(bits));
    results.push(testPositionalBias(bits));
    results.push(testByteLevelBias(bits));
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
      console.log('  LFDR appears to be producing random data');
      console.log('  Safe to use for experiments');
    } else {
      console.log(`  ❌ SOME TESTS FAILED (${passed}/${total} passed)`);
      console.log('  ⚠️  WARNING: LFDR has systematic bias');
      console.log('  DO NOT USE for experiments until resolved');
    }

    console.log('═'.repeat(51) + '\n');

    // Save results to file
    const fs = require('fs');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `lfdr-validation-${timestamp}.json`;
    fs.writeFileSync(filename, JSON.stringify({
      timestamp: new Date().toISOString(),
      bits: VALIDATION_BITS,
      source: 'LFDR (https://lfdr.de/qrng_api/qrng)',
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
validateLFDR().then(() => {
  console.log('✅ Validation complete');
  process.exit(0);
}).catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
