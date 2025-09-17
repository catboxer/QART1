// Tests the (byte % 5) distribution that the experiment actually uses
// Usage: /.netlify/functions/symbol-distribution-test?source=quantum&samples=1000
// Usage: /.netlify/functions/symbol-distribution-test?source=random&samples=1000

exports.handler = async (event) => {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS };
  }

  const qs = event.queryStringParameters || {};
  const source = qs.source || 'quantum'; // 'quantum' or 'random'
  const samples = Math.max(100, Math.min(5000, parseInt(qs.samples, 10) || 1000));

  try {
    let bytes = [];
    let rngSource = '';

    if (source === 'random') {
      // Get bytes from Random.org
      const API_KEY = process.env.RANDOM_ORG_API_KEY;
      if (!API_KEY) {
        return fail('Missing RANDOM_ORG_API_KEY');
      }
      bytes = await getRandomOrgBytes(API_KEY, samples * 2); // subject + ghost
      rngSource = 'random_org';
    } else {
      // Get bytes from quantum race
      const result = await getQuantumBytes(samples * 2);
      bytes = result.bytes;
      rngSource = result.source;
    }

    if (!Array.isArray(bytes) || bytes.length < samples * 2) {
      return fail(`Insufficient bytes: got ${bytes?.length || 0}, needed ${samples * 2}`);
    }

    // Analyze the (byte % 5) distribution
    const analysis = analyzeSymbolDistribution(bytes, samples);

    return ok({
      success: true,
      source: rngSource,
      samples,
      analysis,
      server_time: new Date().toISOString(),
    });

  } catch (e) {
    return fail(`Error: ${e.message}`);
  }
};

function analyzeSymbolDistribution(bytes, pairs) {
  const subjectSymbols = [0, 0, 0, 0, 0]; // counts for symbols 0-4
  const ghostSymbols = [0, 0, 0, 0, 0];
  let sameSymbol = 0;
  let correlation = { same: 0, adjacent: 0, opposite: 0 };

  for (let i = 0; i < pairs; i++) {
    const subjectByte = bytes[i * 2] >>> 0;
    const ghostByte = bytes[i * 2 + 1] >>> 0;

    const subjectSym = subjectByte % 5;
    const ghostSym = ghostByte % 5;

    subjectSymbols[subjectSym]++;
    ghostSymbols[ghostSym]++;

    if (subjectSym === ghostSym) {
      sameSymbol++;
      correlation.same++;
    }

    // Check for adjacent symbols (circular: 0-1, 1-2, 2-3, 3-4, 4-0)
    const diff = Math.abs(subjectSym - ghostSym);
    if (diff === 1 || diff === 4) {
      correlation.adjacent++;
    }

    // Check for opposite symbols (0-2, 1-3, 2-4, 3-0, 4-1)
    if (diff === 2 || diff === 3) {
      correlation.opposite++;
    }
  }

  const expectedPerSymbol = pairs / 5; // 20% each
  const expectedSameSymbol = pairs / 5; // 20% should match

  // Calculate chi-square for subject symbols
  const subjectChiSq = subjectSymbols.reduce((sum, observed) => {
    const diff = observed - expectedPerSymbol;
    return sum + (diff * diff) / expectedPerSymbol;
  }, 0);

  // Calculate chi-square for ghost symbols
  const ghostChiSq = ghostSymbols.reduce((sum, observed) => {
    const diff = observed - expectedPerSymbol;
    return sum + (diff * diff) / expectedPerSymbol;
  }, 0);

  return {
    pairs,
    subjectDistribution: {
      counts: subjectSymbols,
      percentages: subjectSymbols.map(c => (100 * c) / pairs),
      chiSquare: subjectChiSq,
      expected: expectedPerSymbol,
    },
    ghostDistribution: {
      counts: ghostSymbols,
      percentages: ghostSymbols.map(c => (100 * c) / pairs),
      chiSquare: ghostChiSq,
      expected: expectedPerSymbol,
    },
    correlation: {
      sameSymbol: {
        count: sameSymbol,
        percentage: (100 * sameSymbol) / pairs,
        expected: 20, // should be 20%
      },
      patterns: {
        same: correlation.same,
        adjacent: correlation.adjacent,
        opposite: correlation.opposite,
      }
    }
  };
}

// Get quantum bytes using simplified quantum logic
async function getQuantumBytes(count) {
  // Simple quantum fallback using outshift
  const API_KEY = process.env.QRNG_OUTSHIFT_API_KEY;
  if (!API_KEY) {
    throw new Error('Missing QRNG_OUTSHIFT_API_KEY');
  }

  const response = await fetch('https://outshift.ca/api/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: API_KEY,
      type: 'byte',
      count: count,
      format: 'dec'
    }),
    timeout: 5000
  });

  if (!response.ok) {
    throw new Error(`Outshift API failed: ${response.status}`);
  }

  const data = await response.json();
  if (!data.success || !Array.isArray(data.data)) {
    throw new Error('Outshift API returned invalid data');
  }

  return {
    bytes: data.data.map(x => (x >>> 0) & 0xff),
    source: 'outshift'
  };
}

// Get Random.org bytes
async function getRandomOrgBytes(apiKey, count) {
  const body = {
    jsonrpc: '2.0',
    method: 'generateIntegers',
    params: {
      apiKey,
      n: count,
      min: 0,
      max: 255,
      replacement: true
    },
    id: Date.now()
  };

  const response = await fetch('https://api.random.org/json-rpc/4/invoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await response.json();
  if (!response.ok || data?.error) {
    throw new Error(`Random.org API failed: ${JSON.stringify(data?.error || {})}`);
  }

  return data.result.random.data.map(x => (x >>> 0) & 0xff);
}

function ok(obj) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(obj, null, 2)
  };
}

function fail(message) {
  return ok({
    success: false,
    error: message,
    server_time: new Date().toISOString()
  });
}