// netlify/functions/random-org-proxy.js
const crypto = require('crypto');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS };
  }

  const API_KEY = process.env.RANDOM_ORG_API_KEY;
  if (!API_KEY) {
    return respond(500, {
      success: false,
      error: 'Missing RANDOM_ORG_API_KEY',
    });
  }

  const qs = event.queryStringParameters || {};

  // ---- PROBE: ?probe=1000  (server-side parity/independence check) ----
  if (qs.probe) {
    const pairs = clampInt(qs.probe, 1, 10000) || 1000;
    try {
      const nBytes = pairs * 2;
      const bytes = await getRandomOrgBytes(API_KEY, nBytes);
      if (!Array.isArray(bytes) || bytes.length !== nBytes) {
        throw new Error(
          `probe_short_${bytes?.length ?? 0}_need_${nBytes}`
        );
      }
      const stats = analyzePairs(bytes);
      return respond(200, {
        success: true,
        probe: stats,
        server_time: new Date().toISOString(),
      });
    } catch (e) {
      return respond(503, {
        success: false,
        error: 'probe_failed',
        detail: String(e?.message || e),
        server_time: new Date().toISOString(),
      });
    }
  }

  // ---- NORMAL: return N bytes (default 1; you will call n=2) ----
  const n = clampInt(qs.n, 1, 1024) || 1;

  try {
    const bytes = await getRandomOrgBytes(API_KEY, n);

    return respond(200, {
      success: true,
      source: 'random_org',
      bytes, // NEW: unified field (like qrng-race)
      data: bytes, // backward compatibility with existing client
      server_time: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Random.org proxy error:', err);
    const fb = crypto.randomBytes(n); // strong fallback
    const bytes = Array.from(fb, (b) => b & 255);
    return respond(200, {
      success: false,
      source: 'fallback_prng',
      bytes,
      data: bytes,
      fallback: true,
      server_time: new Date().toISOString(),
    });
  }
};

// ---- helpers ----
function respond(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}
function clampInt(v, min, max) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return null;
  return Math.max(min, Math.min(max, n));
}

async function getRandomOrgBytes(apiKey, n) {
  const res = await fetch(
    'https://api.random.org/json-rpc/4/invoke',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'generateIntegers',
        params: { apiKey, n, min: 0, max: 255, replacement: true },
        id: Date.now(),
      }),
    }
  );
  if (!res.ok) throw new Error(`randomorg_http_${res.status}`);
  const j = await res.json();
  const data = j?.result?.random?.data;
  if (!Array.isArray(data) || data.length < n)
    throw new Error('randomorg_bad_shape');
  return data.slice(0, n).map((x) => (x >>> 0) & 255);
}

// identical to qrng-race’s probe math
function analyzePairs(bytes) {
  const pairs = Math.floor(bytes.length / 2);
  let oddP = 0,
    oddG = 0,
    sameByte = 0;
  let a = 0,
    b = 0,
    c = 0,
    d = 0; // 2x2 parity table

  for (let i = 0; i < pairs; i++) {
    const b0 = bytes[2 * i] & 255;
    const b1 = bytes[2 * i + 1] & 255;
    const pOdd = (b0 & 1) === 1;
    const gOdd = (b1 & 1) === 1;
    if (pOdd) oddP++;
    if (gOdd) oddG++;
    if (b0 === b1) sameByte++;
    if (pOdd && gOdd) a++;
    else if (pOdd && !gOdd) b++;
    else if (!pOdd && gOdd) c++;
    else d++;
  }

  const n = pairs;
  const pctOddP = (100 * oddP) / n;
  const pctOddG = (100 * oddG) / n;
  const pctSameByte = (100 * sameByte) / n;
  const expectedSameBytePct = 100 / 256;
  const pParityIndep = chiSquareP_2x2(a, b, c, d);

  return {
    n,
    pctOddP,
    pctOddG,
    pctSameByte,
    expectedSameBytePct,
    parityTable: { a, b, c, d },
    pParityIndep,
  };
}

function chiSquareP_2x2(a, b, c, d) {
  const n = a + b + c + d;
  const r1 = a + b,
    r2 = c + d,
    c1 = a + c,
    c2 = b + d;
  const eA = (r1 * c1) / n,
    eB = (r1 * c2) / n,
    eC = (r2 * c1) / n,
    eD = (r2 * c2) / n;
  const chi =
    (a - eA) ** 2 / eA +
    (b - eB) ** 2 / eB +
    (c - eC) ** 2 / eC +
    (d - eD) ** 2 / eD;
  return twoSidedP(Math.sqrt(chi));
}
function erfApprox(z) {
  const sign = z < 0 ? -1 : 1;
  z = Math.abs(z);
  const a1 = 0.254829592,
    a2 = -0.284496736,
    a3 = 1.421413741,
    a4 = -1.453152027,
    a5 = 1.061405429,
    p = 0.3275911;
  const t = 1 / (1 + p * z);
  const y =
    1 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) *
      t *
      Math.exp(-z * z);
  return sign * y;
}
const normalCdf = (z) => 0.5 * (1 + erfApprox(z / Math.SQRT2));
function twoSidedP(z) {
  const pOne = 1 - normalCdf(Math.abs(z));
  return Math.max(0, Math.min(1, 2 * pOne));
}
