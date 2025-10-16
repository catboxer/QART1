// fetchQRNGBits.js
// Utility to fetch quantum bits on-demand using qrng-race or random-org endpoint
import { config } from './config.js';

/**
 * Test if a bit string passes basic randomness checks
 * @param {string} bits - String of '0' and '1' characters
 * @returns {object} - {isRandom: boolean, stats: {...}}
 */
function validateRandomness(bits) {
  const n = bits.length;
  const ones = bits.split('').filter(b => b === '1').length;
  const onesRatio = ones / n;

  // Test 1: Proportion test (should be close to 0.5)
  const expectedOnes = n / 2;
  const stdDev = Math.sqrt(n * 0.5 * 0.5);
  const zScore = Math.abs((ones - expectedOnes) / stdDev);
  const proportionPass = zScore < 3; // Within 3 standard deviations

  // Test 2: Runs test (alternations between 0 and 1)
  let runs = 1;
  for (let i = 1; i < n; i++) {
    if (bits[i] !== bits[i-1]) runs++;
  }
  const expectedRuns = (2 * ones * (n - ones)) / n + 1;
  const runsStdDev = Math.sqrt((2 * ones * (n - ones) * (2 * ones * (n - ones) - n)) / (n * n * (n - 1)));
  const runsZ = Math.abs((runs - expectedRuns) / runsStdDev);
  const runsPass = runsZ < 3;

  // Test 3: Longest run check (shouldn't have extremely long runs of same bit)
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
  const maxRunPass = maxRun < expectedMaxRun * 3; // Conservative threshold

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

/**
 * Fetch n bits from QRNG using the qrng-race endpoint
 * @param {number} nBits - Number of bits to fetch
 * @param {number} retries - Number of retry attempts (default 3)
 * @param {boolean} validateGhost - If true, validate randomness for ghost tape (default false)
 * @returns {Promise<string>} - String of '0' and '1' characters
 */
export async function fetchQRNGBits(nBits, retries = 3, validateGhost = false) {
  const source = config.QRNG_SOURCE || 'qrng-race';
  const endpoint = source === 'random-org' ? 'random-org-proxy' : 'qrng-race';

  console.log(`🎲 Fetching ${nBits} bits from ${source}...`);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const nBytes = Math.ceil(nBits / 8);
      const MAX_CHUNK = 1024; // max bytes per request
      let allBits = '';

      // Fetch in chunks if needed
      let remaining = nBytes;
      while (remaining > 0) {
        const chunk = Math.min(MAX_CHUNK, remaining);
        console.log(`📡 Fetching chunk: ${chunk} bytes (${remaining} bytes remaining) [Attempt ${attempt}/${retries}] via ${endpoint}`);

        const response = await fetch(`/.netlify/functions/${endpoint}?n=${chunk}`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        // Reject fallback PRNG - we need true QRNG for valid data
        if (data.success === false || data.fallback === true || data.source === 'fallback_prng') {
          const reason = data.error || data.message || data.reason || 'unknown reason';
          throw new Error(`QRNG unavailable (${reason}) - fallback PRNG rejected for data integrity`);
        }

        if (!Array.isArray(data.bytes)) {
          throw new Error(`Invalid response: ${JSON.stringify(data)}`);
        }

        // Convert bytes to bits
        for (const byte of data.bytes) {
          allBits += (byte >>> 0).toString(2).padStart(8, '0');
        }

        remaining -= chunk;
      }

      const result = allBits.slice(0, nBits);

      // Validate randomness if requested (for ghost tape)
      if (validateGhost && nBits > 1000) {
        const validation = validateRandomness(result);
        console.log('🔬 Randomness validation:', validation.stats);

        if (!validation.isRandom) {
          console.warn('⚠️ Ghost tape failed randomness tests - refetching...');
          throw new Error('Failed randomness validation');
        }

        console.log('✅ Ghost tape passed randomness validation');
      }

      console.log(`✅ Successfully fetched ${result.length} bits from QRNG (source: ${nBytes > MAX_CHUNK ? 'chunked' : 'single'})`);
      return result;
    } catch (error) {
      console.error(`❌ Attempt ${attempt}/${retries} failed:`, error);

      if (attempt === retries) {
        // Final attempt failed
        console.error('❌ All retry attempts exhausted');
        throw error;
      }

      // Wait before retrying (exponential backoff)
      const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      console.log(`⏳ Retrying in ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}
