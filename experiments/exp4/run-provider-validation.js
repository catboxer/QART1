// run-provider-validation.js
//
// Standalone provider-validation collector. See PROVIDER_VALIDATION_PRESPEC.md for the
// design this implements. Does NOT touch the React app, does NOT touch any live Netlify
// function, and does NOT write to experiment3_ai_responses. Writes only to the isolated
// Firestore collection `exp4_artificial_injection`, tagged condition: 'provider_validation'.
//
// Run with: node experiments/exp4/run-provider-validation.js [--batch-size 40] [--outshift-budget 20] [--label "evening sitting"]

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const admin = require('firebase-admin');

// ---- .env (repo root) ----
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// ---- constants mirrored from src/config.js pkConfig — must match production ----
const BITS_PER_BLOCK = 301;     // 1 assignment bit + 150 + 150
const TRIALS_PER_BLOCK = 150;
const BYTES_PER_BLOCK = Math.ceil(BITS_PER_BLOCK / 8); // 38

const OUTSHIFT_TIMEOUT_MS = 3000;
const LFDR_TIMEOUT_MS = 6000;
const MAX_RETRIES_TRANSIENT = 2;

// ---- CLI args ----
function parseArgs(argv) {
  const out = { batchSize: 30, outshiftBudget: 15, label: null }; // 30 blocks/sitting matches a real Exp4 session length (pkConfig.BLOCKS_TOTAL)
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--batch-size') out.batchSize = parseInt(argv[++i], 10);
    else if (argv[i] === '--outshift-budget') out.outshiftBudget = parseInt(argv[++i], 10);
    else if (argv[i] === '--label') out.label = argv[++i];
  }
  if (out.batchSize % 2 !== 0) throw new Error('--batch-size must be even (equal split between providers)');
  if (out.outshiftBudget > out.batchSize / 2) {
    throw new Error('--outshift-budget cannot exceed half the batch size');
  }
  return out;
}

// ---- Firestore (admin) ----
const serviceAccountPath = path.join(__dirname, '../../serviceAccountKey.json');
if (!fs.existsSync(serviceAccountPath)) {
  console.error('ERROR: serviceAccountKey.json not found at repo root.');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(require(serviceAccountPath)) });
const db = admin.firestore();
const COLLECTION = 'exp4_artificial_injection';

// ---- provider fetchers (ported from netlify/functions/qrng-race.js) ----

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
  for (let i = 0; i < s.length; i += 2) {
    out.push(parseInt(s.slice(i, i + 2), 16) & 255);
  }
  return out;
}

async function fromOutshift(n) {
  const apiKey = process.env.QRNG_OUTSHIFT_API_KEY;
  if (!apiKey) throw new Error('outshift_no_key');

  const res = await fetchWithTimeout(
    'https://api.qrng.outshift.com/api/v1/random_numbers',
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
        bits_per_block: 8,
        number_of_blocks: n,
      }),
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
      if (isQuotaError(e)) throw e; // never retry quota errors — surface immediately
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

// ---- acquisition mechanics ported verbatim from src/MainApp.jsx processTrials ----
function splitBlock(quantumBits, targetBit) {
  if (quantumBits.length !== BITS_PER_BLOCK) {
    throw new Error(`Expected ${BITS_PER_BLOCK} bits, got ${quantumBits.length}`);
  }
  const assignmentBit = parseInt(quantumBits[0], 10);
  const subjectGetsFirstHalf = assignmentBit === 1;

  const n = TRIALS_PER_BLOCK;
  const halfA = quantumBits.slice(1, 1 + n);
  const halfB = quantumBits.slice(1 + n, 1 + 2 * n);

  const subjectBits = subjectGetsFirstHalf ? halfA : halfB;
  const demonBits = subjectGetsFirstHalf ? halfB : halfA;

  let hits = 0, demonHits = 0;
  for (let i = 0; i < n; i++) if (parseInt(subjectBits[i], 10) === targetBit) hits++;
  for (let i = 0; i < n; i++) if (parseInt(demonBits[i], 10) === targetBit) demonHits++;

  return { assignmentBit, subjectGetsFirstHalf, hits, demonHits, n };
}

// ---- Fisher-Yates shuffle for the balanced provider sequence ----
function buildRandomizedSequence(batchSize, outshiftBudget) {
  const seq = [];
  for (let i = 0; i < outshiftBudget; i++) seq.push('outshift');
  for (let i = 0; i < batchSize - outshiftBudget; i++) seq.push('lfdr');
  for (let i = seq.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [seq[i], seq[j]] = [seq[j], seq[i]];
  }
  return seq;
}

async function runSitting({ batchSize, outshiftBudget, label }) {
  const sittingId = `pv_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const startedAt = new Date().toISOString();
  const plannedSequence = buildRandomizedSequence(batchSize, outshiftBudget);

  const randomByte = crypto.randomBytes(1)[0];
  const target = randomByte & 1 ? 'BLUE' : 'ORANGE';
  const targetBit = target === 'BLUE' ? 1 : 0;

  const sittingRef = db.collection(COLLECTION).doc(sittingId);
  await sittingRef.set({
    sitting_id: sittingId,
    condition: 'provider_validation',
    started_at: startedAt,
    label: label || null,
    batch_size: batchSize,
    outshift_budget: outshiftBudget,
    lfdr_budget: batchSize - outshiftBudget,
    planned_sequence: plannedSequence,
    target,
    status: 'in_progress',
  });

  console.log(`\n[sitting ${sittingId}] target=${target} planned=${plannedSequence.join(',')}\n`);

  let completed = 0;
  let outshiftDone = 0, lfdrDone = 0;
  let endedReason = 'completed';

  for (let i = 0; i < plannedSequence.length; i++) {
    const providerRequested = plannedSequence[i];
    const callTimestamp = new Date().toISOString();

    let result;
    try {
      result = await fetchProviderBits(providerRequested, BITS_PER_BLOCK);
    } catch (e) {
      const quota = isQuotaError(e);
      console.error(`[sitting ${sittingId}] block ${i} FAILED (${providerRequested}): ${e.message} (quota=${quota})`);
      await sittingRef.collection('blocks').doc(String(i)).set({
        block_idx: i,
        sitting_id: sittingId,
        condition: 'provider_validation',
        provider_requested: providerRequested,
        provider_actual: null,
        error: String(e.message || e),
        is_quota_error: quota,
        call_timestamp: callTimestamp,
      });
      endedReason = quota ? 'outshift_exhausted' : 'fetch_error';
      break; // halt sitting — do not substitute, do not continue with a reshaped sequence
    }

    if (result.actualSource !== providerRequested) {
      console.warn(`[sitting ${sittingId}] block ${i} PROVIDER MISMATCH: requested=${providerRequested} actual=${result.actualSource}`);
    }

    const { assignmentBit, subjectGetsFirstHalf, hits, demonHits, n } = splitBlock(result.bits, targetBit);

    await sittingRef.collection('blocks').doc(String(i)).set({
      block_idx: i,
      sitting_id: sittingId,
      condition: 'provider_validation',
      provider_requested: providerRequested,
      provider_actual: result.actualSource,
      provider_mismatch: result.actualSource !== providerRequested,
      bits: result.bits,
      hash: sha256Hex(result.bits),
      bit_count: result.bits.length,
      assignment_bit: assignmentBit,
      subject_gets_first_half: subjectGetsFirstHalf,
      target,
      hits,
      demon_hits: demonHits,
      n,
      fetch_latency_ms: result.latencyMs,
      fetch_attempts: result.attempts,
      call_timestamp: callTimestamp,
      committed_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    completed++;
    if (providerRequested === 'outshift') outshiftDone++; else lfdrDone++;
    console.log(`[sitting ${sittingId}] block ${i}/${plannedSequence.length - 1} ok provider=${result.actualSource} hits=${hits}/${n} latency=${result.latencyMs}ms`);
  }

  const endedAt = new Date().toISOString();
  await sittingRef.set({
    status: 'done',
    ended_reason: endedReason,
    ended_at: endedAt,
    blocks_completed: completed,
    outshift_completed: outshiftDone,
    lfdr_completed: lfdrDone,
  }, { merge: true });

  console.log(`\n[sitting ${sittingId}] ended_reason=${endedReason} completed=${completed}/${plannedSequence.length} (outshift=${outshiftDone} lfdr=${lfdrDone})\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Starting provider-validation sitting: batchSize=${args.batchSize} outshiftBudget=${args.outshiftBudget} label=${args.label || '(none)'}`);
  console.log(`Writing to Firestore collection: ${COLLECTION} (isolated from experiment3_ai_responses)`);
  await runSitting(args);
  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
