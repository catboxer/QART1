// netlify/functions/qrng-validate.js
// Validation-specific endpoint with longer timeouts for deep testing
// DO NOT use this for experiments - use qrng-race.js instead

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

// Longer timeouts for validation testing
const LFDR_TIMEOUT_MS = 10000; // 10 seconds for validation
const ANU_TIMEOUT_MS = 10000;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS };
  }

  const qs = event.queryStringParameters || {};
  const n = Math.max(1, Math.min(1024, parseInt(qs.n, 10) || 125)); // clamp to safe limits

  try {
    // Try Outshift first (testing production QRNG)
    const result = await fromOutshift(n, 10000);
    return respond(200, {
      success: true,
      source: result.source,
      bytes: result.bytes,
      server_time: new Date().toISOString(),
    });
  } catch (outshiftError) {
    console.error('Outshift failed:', outshiftError);

    // Fallback to ANU if Outshift fails
    try {
      const result = await fromANU(n, ANU_TIMEOUT_MS);
      return respond(200, {
        success: true,
        source: result.source,
        bytes: result.bytes,
        server_time: new Date().toISOString(),
      });
    } catch (anuError) {
      console.error('ANU failed:', anuError);

      return respond(503, {
        success: false,
        error: 'qrng_unavailable',
        detail: `outshift:${outshiftError.message}; anu:${anuError.message}`,
        server_time: new Date().toISOString(),
      });
    }
  }
};

function respond(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

const fetchWithTimeout = (url, opts = {}, ms = 10000) =>
  new Promise((resolve, reject) => {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), ms);
    fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: {
        'Cache-Control': 'no-store',
        ...(opts.headers || {}),
      },
    })
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(id));
  });

function hexToBytes(hex) {
  const s = (hex || '').trim();
  if (!s || s.length % 2 !== 0) throw new Error('hex_length');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < s.length; i += 2) {
    const b = parseInt(s.slice(i, i + 2), 16);
    if (Number.isNaN(b)) throw new Error('hex_parse');
    out[i / 2] = b & 255;
  }
  return Array.from(out);
}

async function fromRandomOrg(n, timeoutMs) {
  const apiKey = process.env.RANDOM_ORG_API_KEY;
  if (!apiKey) throw new Error('randomorg_no_key');

  const url = 'https://api.random.org/json-rpc/4/invoke';

  const res = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'generateIntegers',
        params: { apiKey, n, min: 0, max: 255, replacement: true },
        id: Date.now(),
      }),
    },
    timeoutMs
  );

  if (!res.ok) throw new Error(`randomorg_http_${res.status}`);

  const j = await res.json();
  const data = j?.result?.random?.data;
  if (!Array.isArray(data) || data.length < n) {
    throw new Error(`randomorg_short_${data?.length ?? 0}_need_${n}`);
  }

  const bytes = data.slice(0, n).map((x) => (x >>> 0) & 255);
  return { source: 'random_org', bytes };
}

async function fromOutshift(n, timeoutMs) {
  const apiKey = process.env.QRNG_OUTSHIFT_API_KEY;
  if (!apiKey) throw new Error('outshift_no_key');

  const url = 'https://api.qrng.outshift.com/api/v1/random_numbers';

  const res = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'x-id-api-key': apiKey,
      },
      body: JSON.stringify({
        encoding: 'base64',
        format: 'decimal',
        formats: ['decimal'],
        bits_per_block: 8,
        number_of_blocks: n,
      }),
    },
    timeoutMs
  );

  if (!res.ok) throw new Error(`outshift_http_${res.status}`);

  const j = await res.json();

  if (Array.isArray(j?.random_numbers)) {
    const decodeB64ToInt = (b64) => {
      const txt = Buffer.from(String(b64 || ''), 'base64').toString('utf8');
      const v = parseInt(txt, 10);
      if (Number.isNaN(v)) throw new Error('outshift_b64_decimal_parse');
      return (v >>> 0) & 255;
    };
    const decimals = j.random_numbers
      .map((row) => row && row.decimal)
      .filter((d) => d != null);
    if (decimals.length < n) {
      throw new Error(`outshift_short_${decimals.length}_need_${n}`);
    }
    const bytes = decimals.slice(0, n).map(decodeB64ToInt);
    return { source: 'outshift', bytes };
  }

  throw new Error('outshift_bad_shape');
}

async function fromLFDR(n, timeoutMs) {
  const url = `https://lfdr.de/qrng_api/qrng?length=${n}&format=HEX`;
  const res = await fetchWithTimeout(url, {}, timeoutMs);
  if (!res.ok) throw new Error(`lfdr_http_${res.status}`);
  const j = await res.json();
  if (!j || typeof j.qrn !== 'string')
    throw new Error('lfdr_bad_shape');
  const bytes = hexToBytes(j.qrn);
  if (!Array.isArray(bytes)) throw new Error('lfdr_hex_parse');
  if (bytes.length < n)
    throw new Error(`lfdr_short_${bytes.length}_need_${n}`);
  return { source: 'lfdr', bytes: bytes.slice(0, n) };
}

async function fromANU(n, timeoutMs) {
  const url = `https://qrng.anu.edu.au/API/jsonI.php?length=${n}&type=uint8`;
  const res = await fetchWithTimeout(url, {}, timeoutMs);
  if (!res.ok) throw new Error(`anu_http_${res.status}`);
  const j = await res.json();
  if (!Array.isArray(j?.data)) throw new Error('anu_bad_shape');
  if (j.data.length < n)
    throw new Error(`anu_short_${j.data.length}_need_${n}`);
  const bytes = j.data.slice(0, n).map((x) => (x >>> 0) & 255);
  return { source: 'anu', bytes };
}
