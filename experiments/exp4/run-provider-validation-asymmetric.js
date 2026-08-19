// run-provider-validation-asymmetric.js
//
// Stream-specific (asymmetric) companion to run-provider-validation.js. See
// PROVIDER_VALIDATION_PRESPEC.md §7 for the design this implements. Where the common-mode
// script has both paired streams share a single 301-bit call (so a provider artifact hits
// both identically), this script deliberately fetches the two streams from DIFFERENT
// providers per block — testing whether paired-delta preserves a genuinely stream-specific
// artifact instead of the common-mode case. Does NOT touch the React app, any live Netlify
// function, or experiment3_ai_responses. Writes only to exp4_artificial_injection, tagged
// condition: 'provider_validation_asymmetric'.
//
// Run with: node experiments/exp4/run-provider-validation-asymmetric.js [--batch-size 40] [--label "evening sitting"]
// (No --outshift-budget flag: every block costs exactly one Outshift call by construction,
// so batch-size alone determines Outshift usage — see §7.2.)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const admin = require('firebase-admin');

require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const TRIALS_PER_BLOCK = 150; // per stream
const OUTSHIFT_TIMEOUT_MS = 3000;
const LFDR_TIMEOUT_MS = 6000;
const MAX_RETRIES_TRANSIENT = 2;

function parseArgs(argv) {
  const out = { batchSize: 40, label: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--batch-size') out.batchSize = parseInt(argv[++i], 10);
    else if (argv[i] === '--label') out.label = argv[++i];
  }
  if (out.batchSize % 2 !== 0) throw new Error('--batch-size must be even (equal split between which provider feeds stream1)');
  return out;
}

const serviceAccountPath = path.join(__dirname, '../../serviceAccountKey.json');
if (!fs.existsSync(serviceAccountPath)) {
  console.error('ERROR: serviceAccountKey.json not found at repo root.');
  process.exit(1);
}
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(require(serviceAccountPath)) });
}
const db = admin.firestore();
const COLLECTION = 'exp4_artificial_injection';

// ---- provider fetchers (identical to run-provider-validation.js) ----

async function fetchWithTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

function hexToBytes(hex) {
  const s = (hex || '').trim();
  if (!s || s.length % 2 !== 0) throw new Error('hex_length');
  const out = [];
  for (let i = 0; i < s.length; i += 2) out.push(parseInt(s.slice(i, i + 2), 16) & 255);
  return out;
}

async function fromOutshift(n) {
  const apiKey = process.env.QRNG_OUTSHIFT_API_KEY;
  if (!apiKey) throw new Error('outshift_no_key');

  const res = await fetchWithTimeout(
    'https://api.qrng.outshift.com/api/v1/random_numbers',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'x-id-api-key': apiKey },
      body: JSON.stringify({ encoding: 'base64', format: 'decimal', bits_per_block: 8, number_of_blocks: n }),
    },
    OUTSHIFT_TIMEOUT_MS
  );

  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`outshift_http_${res.status}: ${text}`);
    err.isQuota = res.status === 429;
    throw err;
  }

  const j = await res.json();
  if (!Array.isArray(j?.random_numbers)) throw new Error('outshift_bad_shape');
  const decodeB64ToInt = (b64) => {
    const txt = Buffer.from(String(b64 || ''), 'base64').toString('utf8');
    const v = parseInt(txt, 10);
    if (Number.isNaN(v)) throw new Error('outshift_b64_decimal_parse');
    return v & 255;
  };
  const decimals = j.random_numbers.map((row) => row && row.decimal).filter((d) => d != null);
  if (decimals.length < n) throw new Error(`outshift_short_${decimals.length}_need_${n}`);
  return { source: 'outshift', bytes: decimals.slice(0, n).map(decodeB64ToInt) };
}

async function fromLFDR(n) {
  const url = `https://lfdr.de/qrng_api/qrng?length=${n}&format=HEX`;
  const res = await fetchWithTimeout(url, {}, LFDR_TIMEOUT_MS);
  if (!res.ok) throw new Error(`lfdr_http_${res.status}`);
  const j = await res.json();
  if (!j || typeof j.qrn !== 'string') throw new Error('lfdr_bad_shape');
  const bytes = hexToBytes(j.qrn);
  if (bytes.length < n) throw new Error(`lfdr_short_${bytes.length}_need_${n}`);
  return { source: 'lfdr', bytes: bytes.slice(0, n) };
}

const PROVIDER_FN = { outshift: fromOutshift, lfdr: fromLFDR };
const OTHER = { outshift: 'lfdr', lfdr: 'outshift' };

function isQuotaError(e) {
  const msg = String(e?.message || e);
  return e?.isQuota || msg.includes('_429') || /quota|rate.limit|insufficient/i.test(msg);
}

async function fetchProviderBits(providerTag, nBits) {
  const nBytes = Math.ceil(nBits / 8);
  let lastErr;
  for (let attempt = 1; attempt <= 1 + MAX_RETRIES_TRANSIENT; attempt++) {
    try {
      const t0 = Date.now();
      const { source, bytes } = await PROVIDER_FN[providerTag](nBytes);
      let bits = '';
      for (const b of bytes) bits += (b >>> 0).toString(2).padStart(8, '0');
      bits = bits.slice(0, nBits);
      return { bits, actualSource: source, latencyMs: Date.now() - t0, attempts: attempt };
    } catch (e) {
      lastErr = e;
      if (isQuotaError(e)) throw e;
      if (attempt <= MAX_RETRIES_TRANSIENT) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
        continue;
      }
    }
  }
  throw lastErr;
}

function sha256Hex(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function scoreStream(bits, targetBit) {
  let hits = 0;
  for (let i = 0; i < bits.length; i++) if (parseInt(bits[i], 10) === targetBit) hits++;
  return hits;
}

// balanced shuffle: which provider feeds stream1 for each block (stream2 always gets the other)
function buildRandomizedSequence(batchSize) {
  const seq = [];
  for (let i = 0; i < batchSize / 2; i++) seq.push('outshift');
  for (let i = 0; i < batchSize / 2; i++) seq.push('lfdr');
  for (let i = seq.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [seq[i], seq[j]] = [seq[j], seq[i]];
  }
  return seq;
}

async function runSitting({ batchSize, label }) {
  const sittingId = `pva_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const startedAt = new Date().toISOString();
  const plannedStream1Providers = buildRandomizedSequence(batchSize);

  const randomByte = crypto.randomBytes(1)[0];
  const target = randomByte & 1 ? 'BLUE' : 'ORANGE';
  const targetBit = target === 'BLUE' ? 1 : 0;

  const sittingRef = db.collection(COLLECTION).doc(sittingId);
  await sittingRef.set({
    sitting_id: sittingId,
    condition: 'provider_validation_asymmetric',
    started_at: startedAt,
    label: label || null,
    batch_size: batchSize,
    outshift_budget: batchSize, // one Outshift call per block regardless of stream role
    planned_stream1_providers: plannedStream1Providers,
    target,
    status: 'in_progress',
  });

  console.log(`\n[sitting ${sittingId}] target=${target} planned stream1 providers=${plannedStream1Providers.join(',')}\n`);

  let completed = 0;
  let endedReason = 'completed';

  for (let i = 0; i < plannedStream1Providers.length; i++) {
    const stream1Provider = plannedStream1Providers[i];
    const stream2Provider = OTHER[stream1Provider];
    const callTimestamp = new Date().toISOString();

    let r1, r2;
    try {
      r1 = await fetchProviderBits(stream1Provider, TRIALS_PER_BLOCK);
    } catch (e) {
      const quota = isQuotaError(e);
      console.error(`[sitting ${sittingId}] block ${i} FAILED on stream1 (${stream1Provider}): ${e.message} (quota=${quota})`);
      await sittingRef.collection('blocks').doc(String(i)).set({
        block_idx: i, sitting_id: sittingId, condition: 'provider_validation_asymmetric',
        stream1_provider_requested: stream1Provider, stream2_provider_requested: stream2Provider,
        error: `stream1: ${String(e.message || e)}`, is_quota_error: quota, call_timestamp: callTimestamp,
      });
      endedReason = quota ? 'outshift_exhausted' : 'fetch_error';
      break;
    }

    try {
      r2 = await fetchProviderBits(stream2Provider, TRIALS_PER_BLOCK);
    } catch (e) {
      const quota = isQuotaError(e);
      console.error(`[sitting ${sittingId}] block ${i} FAILED on stream2 (${stream2Provider}): ${e.message} (quota=${quota})`);
      await sittingRef.collection('blocks').doc(String(i)).set({
        block_idx: i, sitting_id: sittingId, condition: 'provider_validation_asymmetric',
        stream1_provider_requested: stream1Provider, stream1_provider_actual: r1.actualSource,
        stream1_bits: r1.bits, stream2_provider_requested: stream2Provider,
        error: `stream2: ${String(e.message || e)}`, is_quota_error: quota, call_timestamp: callTimestamp,
      });
      endedReason = quota ? 'outshift_exhausted' : 'fetch_error';
      break;
    }

    if (r1.actualSource !== stream1Provider || r2.actualSource !== stream2Provider) {
      console.warn(`[sitting ${sittingId}] block ${i} PROVIDER MISMATCH: requested=(${stream1Provider},${stream2Provider}) actual=(${r1.actualSource},${r2.actualSource})`);
    }

    const stream1Hits = scoreStream(r1.bits, targetBit);
    const stream2Hits = scoreStream(r2.bits, targetBit);

    await sittingRef.collection('blocks').doc(String(i)).set({
      block_idx: i,
      sitting_id: sittingId,
      condition: 'provider_validation_asymmetric',
      stream1_provider_requested: stream1Provider,
      stream1_provider_actual: r1.actualSource,
      stream1_bits: r1.bits,
      stream1_hash: sha256Hex(r1.bits),
      stream1_hits: stream1Hits,
      stream2_provider_requested: stream2Provider,
      stream2_provider_actual: r2.actualSource,
      stream2_bits: r2.bits,
      stream2_hash: sha256Hex(r2.bits),
      stream2_hits: stream2Hits,
      paired_delta: stream1Hits - stream2Hits,
      n: TRIALS_PER_BLOCK,
      target,
      fetch_latency_ms: { stream1: r1.latencyMs, stream2: r2.latencyMs },
      call_timestamp: callTimestamp,
      committed_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    completed++;
    console.log(`[sitting ${sittingId}] block ${i}/${plannedStream1Providers.length - 1} ok stream1=${r1.actualSource}(${stream1Hits}/${TRIALS_PER_BLOCK}) stream2=${r2.actualSource}(${stream2Hits}/${TRIALS_PER_BLOCK}) delta=${stream1Hits - stream2Hits}`);
  }

  const endedAt = new Date().toISOString();
  await sittingRef.set({
    status: 'done',
    ended_reason: endedReason,
    ended_at: endedAt,
    blocks_completed: completed,
  }, { merge: true });

  console.log(`\n[sitting ${sittingId}] ended_reason=${endedReason} completed=${completed}/${plannedStream1Providers.length}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Starting asymmetric provider-validation sitting: batchSize=${args.batchSize} label=${args.label || '(none)'}`);
  console.log(`Writing to Firestore collection: ${COLLECTION} (isolated from experiment3_ai_responses)`);
  await runSitting(args);
  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
