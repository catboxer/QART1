// netlify/functions/qrng-race.js
// Requires: QRNG_OUTSHIFT_API_KEY, ANU_API_KEY in env (Netlify or root .env for `netlify dev`)

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

// timeouts & retry tuning (ms)
const OUTSHIFT_TIMEOUT_MS = 3000;
const LFDR_TIMEOUT_MS = 6000;
const ANU_TIMEOUT_MS = 3000;
const RETRY_DELAY_MS = 200;

// circuit breaker
const CB_FAIL_THRESHOLD = 3;
const CB_OPEN_MS = 30_000;
const crypto = require('crypto');

// warm-instance memory
const circuits = {
  outshift: { fail: 0, openUntil: 0 },
  lfdr: { fail: 0, openUntil: 0 },
  anu: { fail: 0, openUntil: 0 },
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS };
  }

  const qs = event.queryStringParameters || {};

  // --- quick env/debug check (safe: never returns the key) ---
  if (qs.debug === '1') {
    const outshiftKey = process.env.QRNG_OUTSHIFT_API_KEY || '';
    const anuKey = process.env.ANU_API_KEY || '';
    return ok({
      hasOutshiftKey: Boolean(outshiftKey),
      outshiftKeyLength: outshiftKey ? outshiftKey.length : 0,
      hasAnuKey: Boolean(anuKey),
      anuKeyLength: anuKey ? anuKey.length : 0,
      nodeVersion: process.version,
      when: new Date().toISOString(),
    });
  }

  // --- optional server-side probe: ?probe=1000 (number of pairs)
  if (qs.probe) {
    const pairs = Math.max(
      1,
      Math.min(10000, parseInt(qs.probe, 10) || 1000)
    );
    try {
      const res = await serverProbe(pairs);
      return ok({
        success: true,
        probe: res,
        server_time: new Date().toISOString(),
      });
    } catch (e) {
      return fail({
        success: false,
        error: 'probe_failed',
        detail: String(e?.message || e),
        server_time: new Date().toISOString(),
      });
    }
  }

  // --- force a specific provider for testing: ?provider=outshift|lfdr|anu ---
  if (qs.provider) {
    const n = 2;
    const map = {
      outshift: fromOutshift,
      lfdr: fromLFDR,
      anu: fromANU,
    };
    const tag = String(qs.provider).toLowerCase();
    const fn = map[tag];
    const t0 = Date.now();
    try {
      if (!fn) throw new Error('bad_provider');
      const r =
        tag === 'outshift'
          ? await fn(n, OUTSHIFT_TIMEOUT_MS)
          : tag === 'lfdr'
          ? await fn(n, LFDR_TIMEOUT_MS)
          : await fn(n, ANU_TIMEOUT_MS);
      return ok({
        success: true,
        forced: tag,
        source: r.source,
        bytes: r.bytes,
        ms: Date.now() - t0,
        server_time: new Date().toISOString(),
      });
    } catch (e) {
      return fail({
        success: false,
        forced: tag,
        error: String(e?.message || e),
        ms: Date.now() - t0,
        server_time: new Date().toISOString(),
      });
    }
  }
  // ---- normal path: return N bytes (default 2, clamp sane) ----
  let n = 2;
  if (qs.n) {
    const parsed = parseInt(qs.n, 10);
    if (!Number.isNaN(parsed)) n = parsed;
  } else if (qs.pair) {
    // legacy flag from the client: ?pair=1 means "give me 2"
    n = 2;
  }
  n = Math.max(1, Math.min(1024, n)); // clamp to provider limits

  try {
    const result = await raceFirstThenFallback(n);
    return ok({
      success: true,
      source: result.source,
      bytes: result.bytes, // length N
      server_time: new Date().toISOString(),
    });
  } catch (err) {
    console.error('qrng-race error:', err);
    return fail({
      success: false,
      error: 'qrng_unavailable',
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// ---------------- providers (return { source, bytes }) ----------------

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
        // send both; different deployments accept one or the other
        'x-api-key': apiKey,
        'x-id-api-key': apiKey,
      },
      body: JSON.stringify({
        // per docs: results come base64-encoded
        encoding: 'base64',
        // ask for decimal
        format: 'decimal',
        bits_per_block: 8,
        number_of_blocks: n,
      }),
    },
    timeoutMs
  );

  if (!res.ok) {
    const errorText = await res.text();
    console.error(`Outshift error ${res.status}:`, errorText);
    throw new Error(`outshift_http_${res.status}: ${errorText}`);
  }

  // Try to parse; if non-JSON, throw
  const j = await res.json();

  // --- New: documented shape ---
  // { encoding: "base64", random_numbers: [ { decimal: "NDI=", ... }, ... ] }
  if (Array.isArray(j?.random_numbers)) {
    const decodeB64ToInt = (b64) => {
      const txt = Buffer.from(String(b64 || ''), 'base64').toString(
        'utf8'
      );
      const v = parseInt(txt, 10);
      if (Number.isNaN(v))
        throw new Error('outshift_b64_decimal_parse');
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

  // --- Legacy / fallback shapes (your previous logic) ---
  let arr =
    j?.data?.decimal ??
    j?.data?.numbers?.decimal ??
    j?.random_numbers?.decimal ?? // just in case
    j?.numbers?.decimal ??
    j?.decimal ??
    j?.result?.decimal ??
    null;

  if (!Array.isArray(arr)) {
    const hex =
      j?.data?.hex ??
      j?.numbers?.hex ??
      j?.random_numbers?.hex ??
      j?.hex ??
      null;
    const bin =
      j?.data?.binary ??
      j?.numbers?.binary ??
      j?.random_numbers?.binary ??
      j?.binary ??
      null;
    if (Array.isArray(hex)) {
      arr = hex.map((h) =>
        parseInt(String(h).replace(/^0x/i, ''), 16)
      );
    } else if (Array.isArray(bin)) {
      arr = bin.map((b) => parseInt(String(b), 2));
    }
  }

  if (!Array.isArray(arr)) throw new Error('outshift_bad_shape');
  if (arr.length < n)
    throw new Error(`outshift_short_${arr.length}_need_${n}`);

  const bytes = arr.slice(0, n).map((x) => (x >>> 0) & 255);
  return { source: 'outshift', bytes };
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
  const apiKey = process.env.ANU_API_KEY;
  if (!apiKey) throw new Error('anu_no_key');

  const url = `https://api.quantumnumbers.anu.edu.au/?length=${n}&type=uint8`;
  const res = await fetchWithTimeout(
    url,
    {
      headers: {
        'x-api-key': apiKey,
      },
    },
    timeoutMs
  );
  if (!res.ok) throw new Error(`anu_http_${res.status}`);
  const j = await res.json();
  if (!Array.isArray(j?.data)) throw new Error('anu_bad_shape');
  if (j.data.length < n)
    throw new Error(`anu_short_${j.data.length}_need_${n}`);
  const bytes = j.data.slice(0, n).map((x) => (x >>> 0) & 255);
  return { source: 'anu', bytes };
}

// ---------------- sequential fallback with one retry & circuit breaker ----------------
async function sequentialFallback(n) {
  const errors = [];

  const tryProvider = async (tag, fn, timeoutMs, retries = 1) => {
    const now = Date.now();
    const circ = circuits[tag];
    if (now < circ.openUntil) {
      errors.push(`${tag}:circuit_open`);
      return null;
    }

    for (
      let attempt = 0;
      attempt < 1 + Math.max(0, retries);
      attempt++
    ) {
      try {
        const out = await fn(n, timeoutMs);
        circ.fail = 0;
        circ.openUntil = 0;
        return out;
      } catch (e) {
        const errMsg = String(e?.message || e);

        // For 429 rate limit errors, immediately fail without retry
        // Quota exhausted, so switch to next provider immediately
        if (errMsg.includes('_429')) {
          errors.push(`${tag}:${errMsg}`);
          return null; // Skip to next provider
        }

        circ.fail += 1;
        if (circ.fail >= CB_FAIL_THRESHOLD) {
          circ.openUntil = Date.now() + CB_OPEN_MS;
        }
        errors.push(`${tag}:${errMsg}`);
        if (attempt < retries) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
      }
    }
    return null;
  };

  // Prefer Outshift (if key present), then LFDR, then ANU
  if (process.env.QRNG_OUTSHIFT_API_KEY) {
    const r1 = await tryProvider(
      'outshift',
      fromOutshift,
      OUTSHIFT_TIMEOUT_MS,
      1
    );
    if (r1) return r1;
  }

  // Fall back to LFDR (validated and passing all tests as of 2025-10-27)
  const r2 = await tryProvider('lfdr', fromLFDR, LFDR_TIMEOUT_MS, 1);
  if (r2) return r2;

  // Fall back to ANU
  const r3 = await tryProvider('anu', fromANU, ANU_TIMEOUT_MS, 0);
  if (r3) return r3;

  throw new Error(errors.join('; '));
}
// ---- Sequential fallback to eliminate racing-induced correlations ----
async function raceFirstThenFallback(n) {
  // Use deterministic sequential order to avoid bias from racing
  // Try Outshift first (usually faster), then LFDR, then ANU
  return sequentialFallback(n);
}

// ---------------- server-side probe ----------------

async function serverProbe(pairs) {
  const neededBytes = pairs * 2; // 2 bytes per pair (Primary, Ghost)
  const MAX_CHUNK = 1024; // our function clamps to 1024 already
  const bytes = [];

  // pull in chunks to avoid timeouts
  let remaining = neededBytes;
  while (remaining > 0) {
    const chunk = Math.min(MAX_CHUNK, remaining);
    const { bytes: got } = await sequentialFallback(chunk);
    // safety check
    if (!Array.isArray(got) || got.length !== chunk) {
      throw new Error(
        `probe_chunk_short_${got?.length ?? 0}_need_${chunk}`
      );
    }
    bytes.push(...got);
    remaining -= chunk;
  }

  // stats over the pairs
  let oddP = 0,
    oddG = 0,
    sameByte = 0;
  let a = 0,
    b = 0,
    c = 0,
    d = 0; // 2x2 parity table

  for (let i = 0; i < pairs; i++) {
    const b0 = (bytes[2 * i] >>> 0) & 255;
    const b1 = (bytes[2 * i + 1] >>> 0) & 255;
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

// χ² independence p for 2x2 using z^2 equivalence (df=1)
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
  // df=1 → p ≈ two-sided normal tail of sqrt(chi)
  return twoSidedP(Math.sqrt(chi));
}

// normal helpers for p-value
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
const twoSidedP = (z) => {
  const pOne = 1 - normalCdf(Math.abs(z));
  return Math.max(0, Math.min(1, 2 * pOne));
};
