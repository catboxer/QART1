// netlify/functions/envelopes-batch.js
// One server call returns ALL envelopes for a block.
// Baseline (full_stack) → Random.org
// Quantum (spoon_love) → Outshift/LFDR race (no ANU).
//
// Requires env:
//   RANDOM_ORG_API_KEY         (for baseline)
//   QRNG_OUTSHIFT_API_KEY      (for Outshift; if missing we still try LFDR)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, X-Requested-With',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS };
  }
  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'method_not_allowed' });
  }

  let body = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch (_) {
    return respond(400, { error: 'bad_json' });
  }

  const sessionId =
    String(body.sessionId || '').slice(0, 200) || null;
  const block = (
    body.blockId ||
    body.block ||
    'full_stack'
  ).toString();

  // Decide how many trials to allocate (1..100). You can override with env.
  const DEF_FULL = toInt(process.env.EXP1_TRIALS_FULL_STACK, 18);
  const DEF_SPOON = toInt(process.env.EXP1_TRIALS_SPOON_LOVE, 36);
  let total = toInt(body.total, null);
  if (!Number.isFinite(total))
    total = block === 'spoon_love' ? DEF_SPOON : DEF_FULL;
  total = clamp(total, 1, 100);

  const need = total * 2; // Subject + Demon byte per trial
  const nowISO = new Date().toISOString();
  const batch_id = `${block}-${nowISO}`;

  try {
    let bytes, rng_source;

    if (block === 'spoon_love') {
      // --- Quantum: race Outshift vs LFDR ---
      const { bytes: got, source } = await qrngRace(need);
      bytes = got;
      rng_source = source; // 'outshift' or 'lfdr'
    } else {
      // --- Baseline: Random.org ---
      const API_KEY = process.env.RANDOM_ORG_API_KEY;
      if (!API_KEY)
        return respond(500, { error: 'Missing RANDOM_ORG_API_KEY' });
      bytes = await getRandomOrgBytes(API_KEY, need);
      rng_source = 'random_org';
    }

    if (!Array.isArray(bytes) || bytes.length < need) {
      return respond(503, {
        error: 'rng_short',
        have: bytes?.length || 0,
        need,
      });
    }

    // Subject = first N, Demon = next N (domain-separated)
    const subject = bytes.slice(0, total);
    const demon = bytes.slice(total, 2 * total);

    const envelopes = Array.from({ length: total }, (_, i) => ({
      trial_index: i + 1, // 1-based index
      raw_byte: subject[i] >>> 0, // Subject stream
      ghost_raw_byte: demon[i] >>> 0, // Demon stream
      // convenience: map Subject parity to your side codes (1=LEFT, 2=RIGHT)
      qrng_code: (subject[i] & 1) === 1 ? 2 : 1,
    }));

    return respond(200, {
      success: true,
      batch_id,
      session_id: sessionId,
      block,
      rng_source,
      server_time: nowISO,
      total,
      envelopes,
    });
  } catch (e) {
    return respond(503, {
      success: false,
      error: 'rng_fetch_failed',
      detail: String(e?.message || e),
      server_time: nowISO,
    });
  }
};

// ---------- helpers ----------
function respond(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}
function clamp(n, lo, hi) {
  n = Number(n);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
function toInt(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

// ----- Random.org (baseline) -----
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

// ----- QRNG race: Outshift vs LFDR -----
const OUTSHIFT_TIMEOUT_MS = 1200;
const LFDR_TIMEOUT_MS = 1200;

async function qrngRace(n) {
  const canOutshift = !!process.env.QRNG_OUTSHIFT_API_KEY;

  // Use sequential fallback to avoid racing-induced correlations
  // Try Outshift first (usually faster), then LFDR
  if (canOutshift) {
    try {
      const r = await fromOutshift(n, OUTSHIFT_TIMEOUT_MS);
      return { source: 'outshift', bytes: r.bytes };
    } catch (e) {
      console.warn('Outshift failed, falling back to LFDR:', e.message);
    }
  }

  // Fallback to LFDR
  const r = await fromLFDR(n, LFDR_TIMEOUT_MS);
  return { source: 'lfdr', bytes: r.bytes };
}

function fetchWithTimeout(url, opts = {}, ms = 1200) {
  return new Promise((resolve, reject) => {
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
}

// Outshift provider (supports multiple response shapes)
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
        'x-id-api-key': apiKey, // some deployments expect this
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

  // Preferred shape: { random_numbers: [ { decimal: "NDI=" }, ... ] }
  if (Array.isArray(j?.random_numbers)) {
    const decode = (b64) => {
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
    if (decimals.length < n)
      throw new Error(`outshift_short_${decimals.length}_need_${n}`);
    const bytes = decimals.slice(0, n).map(decode);
    return { bytes };
  }

  // Fallback/legacy shapes
  let arr =
    j?.data?.decimal ??
    j?.data?.numbers?.decimal ??
    j?.random_numbers?.decimal ??
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
  return { bytes };
}

// LFDR provider (HEX → bytes)
async function fromLFDR(n, timeoutMs) {
  const url = `https://lfdr.de/qrng_api/qrng?length=${n}&format=HEX`;
  const res = await fetchWithTimeout(url, {}, timeoutMs);
  if (!res.ok) throw new Error(`lfdr_http_${res.status}`);
  const j = await res.json();
  if (!j || typeof j.qrn !== 'string')
    throw new Error('lfdr_bad_shape');
  const bytes = hexToBytes(j.qrn);
  if (bytes.length < n)
    throw new Error(`lfdr_short_${bytes.length}_need_${n}`);
  return { bytes: bytes.slice(0, n) };
}

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
