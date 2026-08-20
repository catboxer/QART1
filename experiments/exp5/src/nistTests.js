// NIST SP 800-22 Randomness Tests
// Subset of tests optimized for 1000-bit sequences
// Reference: https://csrc.nist.gov/publications/detail/sp/800-22/rev-1a/final

/**
 * Calculate complementary error function (erfc)
 * Used for converting test statistics to p-values
 */
function erfc(x) {
  const z = Math.abs(x);
  const t = 1 / (1 + z / 2);
  const r = t * Math.exp(-z * z - 1.26551223 +
    t * (1.00002368 +
    t * (0.37409196 +
    t * (0.09678418 +
    t * (-0.18628806 +
    t * (0.27886807 +
    t * (-1.13520398 +
    t * (1.48851587 +
    t * (-0.82215223 +
    t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

/**
 * NIST Test 1: Frequency (Monobit) Test
 *
 * Purpose: Determine whether the number of ones and zeros in a sequence
 * are approximately the same as would be expected for a truly random sequence.
 *
 * @param {string} bits - Binary string
 * @returns {object} - { statistic, pValue, pass }
 */
export function frequencyTest(bits) {
  const n = bits.length;

  // Count ones
  const ones = bits.split('').filter(b => b === '1').length;

  // Convert to +1/-1
  const S_n = ones - (n - ones); // Same as: 2*ones - n

  // Calculate test statistic
  const s_obs = Math.abs(S_n) / Math.sqrt(n);

  // Calculate p-value using complementary error function
  const pValue = erfc(s_obs / Math.sqrt(2));

  // Pass if p-value >= 0.01 (NIST standard significance level)
  const pass = pValue >= 0.01;

  return {
    testName: 'Frequency (Monobit)',
    statistic: s_obs,
    pValue,
    pass,
    interpretation: pass ? 'Sequence is random' : 'Sequence is non-random'
  };
}

/**
 * NIST Test 2: Runs Test
 *
 * Purpose: Determine whether the number of runs of ones and zeros of various
 * lengths is as expected for a random sequence.
 *
 * A "run" is an uninterrupted sequence of identical bits.
 *
 * @param {string} bits - Binary string
 * @returns {object} - { statistic, pValue, pass }
 */
export function runsTest(bits) {
  const n = bits.length;

  // Pre-test: proportion of ones must be in acceptable range
  const ones = bits.split('').filter(b => b === '1').length;
  const pi = ones / n;
  const tau = 2 / Math.sqrt(n); // Threshold for pre-test

  if (Math.abs(pi - 0.5) >= tau) {
    return {
      testName: 'Runs',
      statistic: null,
      pValue: 0,
      pass: false,
      interpretation: 'Failed pre-test: proportion of ones too far from 0.5'
    };
  }

  // Count runs (transitions between 0 and 1)
  let V_n = 1; // Start with 1 run
  for (let i = 0; i < n - 1; i++) {
    if (bits[i] !== bits[i + 1]) {
      V_n++;
    }
  }

  // Calculate test statistic
  const numerator = Math.abs(V_n - 2 * n * pi * (1 - pi));
  const denominator = 2 * Math.sqrt(2 * n) * pi * (1 - pi);
  const statistic = numerator / denominator;

  // Calculate p-value
  const pValue = erfc(statistic / Math.sqrt(2));

  // Pass if p-value >= 0.01
  const pass = pValue >= 0.01;

  return {
    testName: 'Runs',
    statistic,
    pValue,
    pass,
    runsObserved: V_n,
    interpretation: pass ? 'Oscillation is as expected' : 'Too many or too few runs'
  };
}

/**
 * NIST Test 3: Longest Run of Ones Test
 *
 * Purpose: Determine whether the length of the longest run of ones within
 * the tested sequence is consistent with the length of the longest run of
 * ones that would be expected in a random sequence.
 *
 * For n=1000 bits (M=10 blocks of 100 bits each, K=4 categories)
 *
 * @param {string} bits - Binary string
 * @returns {object} - { statistic, pValue, pass }
 */
export function longestRunTest(bits) {
  const n = bits.length;

  // NIST parameters for different sequence lengths
  let M, K, v_thresholds, pi_expected;

  if (n < 128) {
    return {
      testName: 'Longest Run',
      statistic: null,
      pValue: null,
      pass: false,
      interpretation: 'Sequence too short (need ≥128 bits)'
    };
  } else if (n < 6272) {
    // For 128 ≤ n < 6272: M=8, K=3
    M = 8;
    K = 3;
    v_thresholds = [1, 2, 3, 4]; // [0-1, 2, 3, ≥4]
    pi_expected = [0.2148, 0.3672, 0.2305, 0.1875];
  } else if (n < 750000) {
    // For 6272 ≤ n < 750000: M=128, K=5
    M = 128;
    K = 5;
    v_thresholds = [4, 5, 6, 7, 8, 9]; // [0-4, 5, 6, 7, 8, ≥9]
    pi_expected = [0.1174, 0.2430, 0.2493, 0.1752, 0.1027, 0.1124];
  } else {
    // For n ≥ 750000: M=10000, K=6
    M = 10000;
    K = 6;
    v_thresholds = [10, 11, 12, 13, 14, 15, 16]; // [0-10, 11, 12, 13, 14, 15, ≥16]
    pi_expected = [0.0882, 0.2092, 0.2483, 0.1933, 0.1208, 0.0675, 0.0727];
  }

  // For n=1000, we use M=8, K=3 parameters
  const N = Math.floor(n / M); // Number of blocks

  // Count longest runs in each block
  const v = new Array(K + 1).fill(0);

  for (let i = 0; i < N; i++) {
    const block = bits.slice(i * M, (i + 1) * M);

    // Find longest run of ones in this block
    let maxRun = 0;
    let currentRun = 0;

    for (let j = 0; j < block.length; j++) {
      if (block[j] === '1') {
        currentRun++;
        maxRun = Math.max(maxRun, currentRun);
      } else {
        currentRun = 0;
      }
    }

    // Categorize longest run
    let category = K; // Default to last category (≥ threshold)
    for (let k = 0; k < v_thresholds.length - 1; k++) {
      if (maxRun <= v_thresholds[k]) {
        category = k;
        break;
      }
    }

    v[category]++;
  }

  // Calculate chi-squared statistic
  let chi_squared = 0;
  for (let i = 0; i <= K; i++) {
    const expected = N * pi_expected[i];
    chi_squared += Math.pow(v[i] - expected, 2) / expected;
  }

  // Calculate p-value using incomplete gamma function approximation
  // For chi-squared with K degrees of freedom
  const pValue = igamc(K / 2, chi_squared / 2);

  // Pass if p-value >= 0.01
  const pass = pValue >= 0.01;

  return {
    testName: 'Longest Run of Ones',
    statistic: chi_squared,
    degreesOfFreedom: K,
    pValue,
    pass,
    blocks: N,
    blockSize: M,
    categories: v,
    interpretation: pass ? 'Longest runs are as expected' : 'Longest runs are unusual'
  };
}

/**
 * Incomplete gamma function (upper)
 * Used for chi-squared p-value calculation
 */
function igamc(a, x) {
  if (x < 0 || a <= 0) return NaN;
  if (x === 0) return 1;
  if (x < a + 1) {
    // Use series representation
    return 1 - igam(a, x);
  }

  // Use continued fraction representation
  let ax = a * Math.log(x) - x - lgamma(a);
  if (ax < -709.78271289338399) return 0; // Underflow

  ax = Math.exp(ax);

  let y = 1 - a;
  let z = x + y + 1;
  let c = 0;
  let pkm2 = 1;
  let qkm2 = x;
  let pkm1 = x + 1;
  let qkm1 = z * x;
  let ans = pkm1 / qkm1;

  let t, r, pk, qk;
  for (let i = 0; i < 100; i++) {
    c++;
    y++;
    z += 2;
    let yc = y * c;
    pk = pkm1 * z - pkm2 * yc;
    qk = qkm1 * z - qkm2 * yc;

    if (qk !== 0) {
      r = pk / qk;
      t = Math.abs((ans - r) / r);
      ans = r;
    } else {
      t = 1;
    }

    pkm2 = pkm1;
    pkm1 = pk;
    qkm2 = qkm1;
    qkm1 = qk;

    if (Math.abs(pk) > 1e30) {
      pkm2 /= 1e30;
      pkm1 /= 1e30;
      qkm2 /= 1e30;
      qkm1 /= 1e30;
    }

    if (t < 1e-15) break;
  }

  return ans * ax;
}

/**
 * Incomplete gamma function (lower)
 */
function igam(a, x) {
  if (x < 0 || a <= 0) return NaN;
  if (x === 0) return 0;
  if (x > a + 1) {
    return 1 - igamc(a, x);
  }

  let ax = a * Math.log(x) - x - lgamma(a);
  if (ax < -709.78271289338399) return 0;

  ax = Math.exp(ax);

  let r = a;
  let c = 1;
  let ans = 1;

  for (let i = 0; i < 100; i++) {
    r++;
    c *= x / r;
    ans += c;
    if (c / ans < 1e-15) break;
  }

  return ans * ax / a;
}

/**
 * Log gamma function
 */
function lgamma(x) {
  const cof = [
    76.18009172947146,
    -86.50532032941677,
    24.01409824083091,
    -1.231739572450155,
    0.001208650973866179,
    -0.000005395239384953
  ];

  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;

  for (let j = 0; j < 6; j++) {
    ser += cof[j] / ++y;
  }

  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

/**
 * Run complete NIST audit battery
 * Returns results from all three tests
 *
 * @param {string} bits - Binary string (recommended: 1000 bits)
 * @returns {object} - Complete audit results
 */
export function runNISTAudit(bits) {
  const frequencyResult = frequencyTest(bits);
  const runsResult = runsTest(bits);
  const longestRunResult = longestRunTest(bits);

  // Overall pass: all tests must pass
  const allPass = frequencyResult.pass && runsResult.pass && longestRunResult.pass;

  return {
    bitLength: bits.length,
    allTestsPass: allPass,
    tests: {
      frequency: frequencyResult,
      runs: runsResult,
      longestRun: longestRunResult
    },
    summary: allPass
      ? 'QRNG output passes all NIST randomness tests'
      : 'QRNG output fails one or more NIST tests',
    reference: 'NIST SP 800-22 Rev. 1a (https://csrc.nist.gov/publications/detail/sp/800-22/rev-1a/final)'
  };
}
