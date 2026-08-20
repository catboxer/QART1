#!/usr/bin/env node
// Regression test: verify exp5 hurstApprox + splitBlockBits match frozen pilot data.
// Functions are inlined verbatim from src/stats/coherence.js and src/lib/trialBlock.js
// to avoid CJS/ESM import issues.

import { readFileSync } from 'fs';

// ---- Verbatim from src/stats/coherence.js ----
function cumulativeRange(bits) {
  let pos = 0, minPos = 0, maxPos = 0;
  for (const b of bits) {
    pos += b ? 1 : -1;
    if (pos < minPos) minPos = pos;
    if (pos > maxPos) maxPos = pos;
  }
  return maxPos - minPos;
}

function hurstApprox(bits) {
  const n = bits.length;
  if (n < 20) return 0.5;
  const x = bits.map((b) => (b ? 1 : -1));
  const mean = x.reduce((a, b) => a + b, 0) / n;
  let y = 0, minY = 0, maxY = 0, s2 = 0;
  for (let i = 0; i < n; i++) {
    const d = x[i] - mean;
    y += d;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    s2 += d * d;
  }
  const R = maxY - minY;
  const S = Math.sqrt(s2 / n) || 1;
  return Math.max(0, Math.min(1, Math.log(R / S || 1) / Math.log(n)));
}

// ---- Verbatim from src/lib/trialBlock.js ----
function splitBlockBits(rawBitString, trialsPerBlock) {
  const n = trialsPerBlock;
  const assignmentBit = parseInt(rawBitString[0], 10);
  const subjectGetsFirstHalf = assignmentBit === 1;
  const halfA = rawBitString.slice(1, 1 + n);
  const halfB = rawBitString.slice(1 + n, 1 + 2 * n);
  const subjectStr = subjectGetsFirstHalf ? halfA : halfB;
  const demonStr   = subjectGetsFirstHalf ? halfB : halfA;
  const parsedSubjectBits = Array.from(subjectStr, (c) => parseInt(c, 10));
  const parsedDemonBits   = Array.from(demonStr,   (c) => parseInt(c, 10));
  return { assignmentBit, subjectGetsFirstHalf, parsedSubjectBits, parsedDemonBits };
}

// ---- CSV parsing ----
const CSV_PATH = './notebooks/Frozen_Blocks_2026-02-10_195735.csv';
const TOLERANCE = 1e-12;
const MAX_ROWS = 99999;

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i+1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      result.push(current); current = '';
    } else {
      current += c;
    }
  }
  result.push(current);
  return result;
}

function parseCSV(text) {
  const lines = text.split('\n').filter(l => l.trim());
  const headers = parseCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length && rows.length < MAX_ROWS; i++) {
    const vals = parseCSVLine(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => obj[h] = vals[idx] || '');
    rows.push(obj);
  }
  return rows;
}

function parsePyDict(s) {
  if (!s || s === '') return null;
  let j = s
    .replace(/'/g, '"')
    .replace(/\bTrue\b/g, 'true')
    .replace(/\bFalse\b/g, 'false')
    .replace(/\bNone\b/g, 'null');
  try { return JSON.parse(j); } catch { return null; }
}

// ---- Main ----
const csv = readFileSync(CSV_PATH, 'utf8');
const rows = parseCSV(csv);
console.log(`Loaded ${rows.length} blocks from frozen data.\n`);

let hurstPass = 0, hurstFail = 0, hurstSkip = 0;
let cumRangePass = 0, cumRangeFail = 0;
let pcsHurstPass = 0, pcsHurstFail = 0, pcsHurstSkip = 0;
let splitPass = 0, splitFail = 0, splitSkip = 0;
const failures = [];

for (let i = 0; i < rows.length; i++) {
  const row = rows[i];
  const trialData = parsePyDict(row.trial_data);
  const coherence = parsePyDict(row.coherence);
  const demonMetrics = parsePyDict(row.demon_metrics);

  if (!trialData || !trialData.subject_bits || !trialData.demon_bits) { hurstSkip++; pcsHurstSkip++; splitSkip++; continue; }

  const subjBits = trialData.subject_bits;
  const demonBits = trialData.demon_bits;

  // --- Test 1: Subject Hurst ---
  if (coherence && typeof coherence.hurst === 'number') {
    const computed = hurstApprox(subjBits);
    const stored = coherence.hurst;
    if (Math.abs(computed - stored) <= TOLERANCE) {
      hurstPass++;
    } else {
      hurstFail++;
      failures.push(`Row ${i} subj hurst: computed=${computed}, stored=${stored}, diff=${Math.abs(computed-stored)}`);
    }
  } else { hurstSkip++; }

  // --- Test 1b: Subject cumRange ---
  if (coherence && typeof coherence.cumRange === 'number') {
    const computed = cumulativeRange(subjBits);
    const stored = coherence.cumRange;
    if (computed === stored) { cumRangePass++; }
    else {
      cumRangeFail++;
      failures.push(`Row ${i} subj cumRange: computed=${computed}, stored=${stored}`);
    }
  }

  // --- Test 2: PCS (demon) Hurst ---
  if (demonMetrics && demonMetrics.coherence && typeof demonMetrics.coherence.hurst === 'number') {
    const computed = hurstApprox(demonBits);
    const stored = demonMetrics.coherence.hurst;
    if (Math.abs(computed - stored) <= TOLERANCE) {
      pcsHurstPass++;
    } else {
      pcsHurstFail++;
      failures.push(`Row ${i} PCS hurst: computed=${computed}, stored=${stored}, diff=${Math.abs(computed-stored)}`);
    }
  } else { pcsHurstSkip++; }

  // --- Test 3: Bit-splitting round-trip ---
  if (subjBits.length === 150 && demonBits.length === 150) {
    let matched = false;
    for (const assignBit of [0, 1]) {
      const subjectGetsFirst = assignBit === 1;
      const halfA = subjectGetsFirst ? subjBits : demonBits;
      const halfB = subjectGetsFirst ? demonBits : subjBits;
      const raw = String(assignBit) + halfA.join('') + halfB.join('');

      const result = splitBlockBits(raw, 150);
      const subjMatch = result.parsedSubjectBits.every((b, idx) => b === subjBits[idx]);
      const demonMatch = result.parsedDemonBits.every((b, idx) => b === demonBits[idx]);

      if (subjMatch && demonMatch) {
        matched = true;
        splitPass++;
        break;
      }
    }
    if (!matched) {
      splitFail++;
      failures.push(`Row ${i} split: neither assignmentBit=0 nor =1 reproduces stored bits`);
    }
  } else { splitSkip++; }
}

// ---- Report ----
console.log('=== Subject Hurst (hurstApprox) ===');
console.log(`  PASS: ${hurstPass}  FAIL: ${hurstFail}  SKIP: ${hurstSkip}`);

console.log('\n=== Subject cumRange ===');
console.log(`  PASS: ${cumRangePass}  FAIL: ${cumRangeFail}`);

console.log('\n=== PCS/Demon Hurst ===');
console.log(`  PASS: ${pcsHurstPass}  FAIL: ${pcsHurstFail}  SKIP: ${pcsHurstSkip}`);

console.log('\n=== Bit-splitting round-trip ===');
console.log(`  PASS: ${splitPass}  FAIL: ${splitFail}  SKIP: ${splitSkip}`);

if (failures.length > 0) {
  console.log(`\n=== FAILURES (first 20) ===`);
  failures.slice(0, 20).forEach(f => console.log(`  ${f}`));
}

const totalFail = hurstFail + pcsHurstFail + splitFail + cumRangeFail;
console.log(`\n${totalFail === 0 ? 'ALL TESTS PASSED' : `${totalFail} FAILURES`}`);
process.exit(totalFail === 0 ? 0 : 1);
