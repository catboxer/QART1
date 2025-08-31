#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const crypto = require('crypto');

const ZENER = ['circle', 'plus', 'waves', 'square', 'star'];

function hmacHex(secret, msg) {
  return crypto
    .createHmac('sha256', secret)
    .update(msg)
    .digest('hex');
}

function toArray(maybe) {
  if (!maybe) return [];
  return Array.isArray(maybe) ? maybe : [maybe];
}

function flattenTrialsFromSessions(sessions) {
  // Accept either a flat array of trials or sessions that contain trials arrays
  const out = [];
  for (const s of sessions) {
    // common shapes: top-level arrays on session doc or details/trialDetails
    const blocks = [
      ...toArray(s.full_stack_trials || []),
      ...toArray(s.spoon_love_trials || []),
      ...toArray(s.client_local_trials || []),
      ...toArray(s.details?.trialDetails?.full_stack_trials || []),
      ...toArray(s.details?.trialDetails?.spoon_love_trials || []),
      ...toArray(s.details?.trialDetails?.client_local_trials || []),
    ];
    if (blocks.length) out.push(...blocks);
    // also accept flat trial rows
    if (s.block_type && s.trial_index) out.push(s);
  }
  return out;
}

function computeR(row, hmacSecret) {
  const msg = [
    row.sealed_envelope_id,
    row.server_time,
    row.press_start_ts,
    row.session_id,
    String(row.trial_index),
  ].join('|');
  const h = hmacHex(hmacSecret, msg);
  return parseInt(h.slice(0, 2), 16) % 5;
}

function verifyRow(row, hmacSecret, proofSecret) {
  const r = computeR(row, hmacSecret);
  const proofMsg =
    [
      row.sealed_envelope_id,
      row.server_time,
      row.press_start_ts,
      row.session_id,
      String(row.trial_index),
    ].join('|') + `|r=${r}`;
  const proof = hmacHex(proofSecret, proofMsg);

  const options = row.options || row.option_ids || [];
  if (!Array.isArray(options) || options.length !== 5) {
    return { ok: false, reason: 'bad_options', r };
  }

  const subjectSym = ZENER[(Number(row.raw_byte) >>> 0) % 5];
  const ghostSym = ZENER[(Number(row.ghost_raw_byte) >>> 0) % 5];

  const baseIdx = options.indexOf(subjectSym);
  const ghostBase = options.indexOf(ghostSym);
  if (baseIdx < 0 || ghostBase < 0)
    return { ok: false, reason: 'symbol_not_in_options', r };

  const rGhost = (r + ((Number(row.ghost_raw_byte) >>> 0) % 5)) % 5;
  const targetIdx = (baseIdx + r) % 5;
  const ghostIdx = (ghostBase + rGhost) % 5;

  const proofOk =
    String(row.remap_proof || '').toLowerCase() ===
    proof.toLowerCase();
  const idxOk =
    Number(row.target_index_0based) === targetIdx &&
    Number(row.ghost_index_0based) === ghostIdx;

  return {
    ok: proofOk && idxOk,
    r,
    proofOk,
    idxOk,
    targetIdx,
    ghostIdx,
  };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opt = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') opt.json = args[++i];
    else if (a === '--csv') opt.csv = args[++i];
    else if (a === '--hmac') opt.hmac = args[++i];
    else if (a === '--proof') opt.proof = args[++i];
  }
  if (!opt.hmac || !opt.proof) {
    console.error(
      'Usage: --json file.json| --csv file.csv --hmac SECRET --proof SECRET'
    );
    process.exit(1);
  }
  return opt;
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines
    .shift()
    .split(',')
    .map((s) => s.trim());
  return lines.map((line) => {
    const cells = line.split(',').map((s) => s.trim());
    const row = {};
    header.forEach((h, i) => (row[h] = cells[i]));
    // try to JSON.parse options if it looks like an array
    if (row.options && row.options.startsWith('[')) {
      try {
        row.options = JSON.parse(row.options);
      } catch {}
    }
    return row;
  });
}

(async function main() {
  const { json, csv, hmac, proof } = parseArgs();

  let rows = [];
  if (json) {
    const data = JSON.parse(fs.readFileSync(json, 'utf8'));
    rows = Array.isArray(data)
      ? flattenTrialsFromSessions(data)
      : flattenTrialsFromSessions([data]);
  } else if (csv) {
    rows = parseCSV(fs.readFileSync(csv, 'utf8'));
  }

  // Only spoon_love trials matter for this audit
  const spoonRows = rows.filter(
    (r) => (r.block_type || '').toLowerCase() === 'spoon_love'
  );

  let pass = 0,
    fail = 0;
  const failures = [];
  for (const r of spoonRows) {
    const v = verifyRow(r, hmac, proof);
    if (v.ok) pass++;
    else {
      fail++;
      failures.push({
        trial_index: r.trial_index,
        sealed_envelope_id: r.sealed_envelope_id,
        ...v,
      });
    }
  }

  console.log(`Spoon Love trials audited: ${spoonRows.length}`);
  console.log(`Pass: ${pass}  Fail: ${fail}`);
  if (failures.length) {
    console.log('First few failures:');
    console.log(failures.slice(0, 10));
    process.exitCode = 2;
  } else {
    process.exitCode = 0;
  }
})();
