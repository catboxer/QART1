// netlify/functions/quantis.js
// Quantis QRNG (qpsy.de) provider endpoint, matching the same response
// shape as qrng-race.js so it plugs directly into fetchQRNGBits.js's
// existing chunking / bit-slicing logic with no changes to that logic.
//
// Requires env var: QUANTIS_API_KEY
//   (Netlify site config -> Environment variables, or root .env for `netlify dev`)
//
// Usage (same contract as qrng-race):
//   GET /.netlify/functions/quantis?n=<bytes>   (1 <= n <= 1024)
//
// Success response:
//   { success: true, source: "quantis", bytes: [ <n integers 0-255> ], server_time }
// Failure response (HTTP 503):
//   { success: false, error: "quantis_unavailable", detail: "...", server_time }
//
// Default: no fallback to another provider. If Quantis fails, the caller
// (your fetchQRNGBits retry loop) sees a real failure and retries/surfaces it,
// rather than silently getting trial data from an unvalidated source.
//
// Opt-in fallback: GET ...?n=<bytes>&fallback=lfdr tries LFDR (lfdr.de) if
// Quantis fails. The response's `source` is then "lfdr" (not "quantis"), so
// the caller can see, and the data records, which provider produced the bits.
// Only callers that pass fallback=lfdr are affected (Study 1c does not).

const { guard } = require('../lib/guard.js');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, X-Requested-With',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
};

const QUANTIS_TIMEOUT_MS = 3000;
const LFDR_TIMEOUT_MS = 6000;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS };
  }

  // Only pages on this site may call this, and not too often (protects the paid API quota).
  const blocked = guard(event, 'quantis', { max: 240, windowMs: 60 * 1000 });
  if (blocked) return { ...blocked, headers: CORS };

  const qs = event.queryStringParameters || {};
  let n = 2;
  if (qs.n) {
    const parsed = parseInt(qs.n, 10);
    if (!Number.isNaN(parsed)) n = parsed;
  }
  n = Math.max(1, Math.min(1024, n)); // same clamp as qrng-race

  try {
    let result;
    try {
      result = await fromQuantis(n, QUANTIS_TIMEOUT_MS);
    } catch (quantisErr) {
      if (qs.fallback !== 'lfdr') throw quantisErr;
      console.error('quantis failed, falling back to lfdr:', quantisErr);
      try {
        result = await fromLFDR(n, LFDR_TIMEOUT_MS);
      } catch (lfdrErr) {
        throw new Error(
          `${quantisErr?.message || quantisErr}; ${lfdrErr?.message || lfdrErr}`,
        );
      }
    }
    const { bytes, source } = result;
    return ok({
      success: true,
      source,
      bytes, // length n
      server_time: new Date().toISOString(),
    });
  } catch (err) {
    return fail({
      success: false,
      error: 'quantis_unavailable',
      detail: String(err?.message || err),
      server_time: new Date().toISOString(),
    });
  }
};

// ---------------- utils ----------------

function ok(body) {
  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify(body),
  };
}
function fail(body) {
  return {
    statusCode: 503,
    headers: CORS,
    body: JSON.stringify(body),
  };
}

const fetchWithTimeout = (url, opts = {}, ms = 1000) =>
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

// ---------------- LFDR (lfdr.de), opt-in fallback ----------------

async function fromLFDR(n, timeoutMs) {
  const url = `https://lfdr.de/qrng_api/qrng?length=${n}&format=HEX`;
  const res = await fetchWithTimeout(url, {}, timeoutMs);
  if (!res.ok) throw new Error(`lfdr_http_${res.status}`);
  const j = await res.json();
  if (!j || typeof j.qrn !== 'string') throw new Error('lfdr_bad_shape');
  const bytes = hexToBytes(j.qrn);
  if (!Array.isArray(bytes)) throw new Error('lfdr_hex_parse');
  if (bytes.length < n)
    throw new Error(`lfdr_short_${bytes.length}_need_${n}`);
  return { source: 'lfdr', bytes: bytes.slice(0, n) };
}

// ---------------- Quantis (qpsy.de) ----------------

async function fromQuantis(n, timeoutMs) {
  const apiKey = process.env.QUANTIS_API_KEY;
  if (!apiKey) throw new Error('quantis_no_key');

  const url = `https://qpsy.de/quantis/random/bytes?length=${n}`;

  const res = await fetchWithTimeout(
    url,
    { headers: { 'X-API-Key': apiKey } },
    timeoutMs,
  );

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`quantis_http_${res.status}: ${errorText}`);
  }

  const j = await res.json();
  if (typeof j?.data !== 'string')
    throw new Error('quantis_bad_shape');

  const bytes = hexToBytes(j.data);
  if (bytes.length < n)
    throw new Error(`quantis_short_${bytes.length}_need_${n}`);

  return { source: 'quantis', bytes: bytes.slice(0, n) };
}
