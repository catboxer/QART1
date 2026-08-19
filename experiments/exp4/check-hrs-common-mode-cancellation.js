// check-hrs-common-mode-cancellation.js
//
// Resolves the Section 6 open item in the injection preregistration:
// "Whether the paired-delta transform... exactly cancels a whole-call-constant
// additive disturbance for the single-scale Hurst/R-S estimator, given that the
// estimator is nonlinear. This is known to hold for hit rate (a linear/mean
// statistic) but has not been separately confirmed for the R/S estimator."
//
// Method: simulate large numbers of clean i.i.d.-Bernoulli(0.5) 150-bit stream
// pairs (Subject, PCS), apply the same two disturbance mechanisms described in
// manuscript Section 3.3.1/3.3.2 (literal-bit bias, persistence), under both
// synchronized-mask and independent-position implementations, at the same
// largest-tested doses, and directly measure the mean and CI of the paired
// HRS delta (Subject − PCS). Two negative controls (unequal-half persistence,
// Subject-only literal shift) confirm the check has power to detect a residual
// when one genuinely exists, so a clean result on the symmetric conditions
// isn't just an underpowered simulation.
//
// hurstApprox is copied verbatim from experiments/exp4/src/stats/coherence.js
// (confirmed identical to experiments/exp4/src/stats/coherence.js) so this checks
// the actual estimator, not a reimplementation that could silently diverge.
//
// Not a substitute for review — flagged in the preregistration as
// "do not resolve by assertion." This is a numeric check, to be read alongside
// that flag, not in place of it.

const crypto = require('crypto');

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

function hitRate(bits, target) {
  let k = 0;
  for (const b of bits) if (b === target) k++;
  return k / bits.length;
}

// crypto-backed uniform(0,1)
function u01() {
  return crypto.randomInt(0, 1_000_000_000) / 1_000_000_000;
}

function cleanBits(n) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = u01() < 0.5 ? 1 : 0;
  return out;
}

// literal-bit composition bias: each selected position replaced by literalValue
function applyLiteralBias(bits, dose, literalValue, sharedPositions) {
  const out = bits.slice();
  for (let i = 0; i < out.length; i++) {
    const selected = sharedPositions ? sharedPositions[i] : u01() < dose;
    if (selected) out[i] = literalValue;
  }
  return out;
}

// persistence: each selected position repeats the (possibly already-updated) preceding bit
function applyPersistence(bits, dose, sharedPositions) {
  const out = bits.slice();
  for (let i = 1; i < out.length; i++) {
    const selected = sharedPositions ? sharedPositions[i] : u01() < dose;
    if (selected) out[i] = out[i - 1];
  }
  return out;
}

function makeSharedPositions(n, dose) {
  const pos = new Array(n);
  for (let i = 0; i < n; i++) pos[i] = u01() < dose;
  return pos;
}

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function sd(arr) {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1));
}
function summarize(deltas, label) {
  const m = mean(deltas);
  const s = sd(deltas);
  const se = s / Math.sqrt(deltas.length);
  const ci = [m - 1.96 * se, m + 1.96 * se];
  const includesZero = ci[0] <= 0 && ci[1] >= 0;
  const withinDelta002 = ci[0] >= -0.002 && ci[1] <= 0.002;
  console.log(
    `${label.padEnd(48)} mean=${m.toFixed(5)}  95%CI=[${ci[0].toFixed(5)}, ${ci[1].toFixed(5)}]` +
    `  includesZero=${includesZero}  within±0.002=${withinDelta002}`
  );
  return { mean: m, sd: s, ci, includesZero, withinDelta002 };
}

const N_BITS = 150;
const N_REALIZATIONS = 5000;

console.log(`\nSimulation: N=${N_REALIZATIONS} realizations, ${N_BITS}-bit streams, hurstApprox from src/stats/coherence.js\n`);

// ---------- Symmetric (whole-call-constant) conditions: should cancel ----------
console.log('--- Symmetric disturbance (same type + dose, both streams) — expect cancellation ---\n');

function runSymmetric(mechanism, dose, syncMask, extra) {
  const deltaHrs = [];
  const deltaHit = [];
  for (let r = 0; r < N_REALIZATIONS; r++) {
    const cleanA = cleanBits(N_BITS);
    const cleanB = cleanBits(N_BITS);
    let a, b;
    if (mechanism === 'literal') {
      const literalValue = u01() < 0.5 ? 1 : 0; // per-call random direction, as in the manuscript
      const sharedPos = syncMask ? makeSharedPositions(N_BITS, dose) : null;
      a = applyLiteralBias(cleanA, dose, literalValue, sharedPos);
      b = applyLiteralBias(cleanB, dose, literalValue, sharedPos);
    } else {
      const sharedPos = syncMask ? makeSharedPositions(N_BITS, dose) : null;
      a = applyPersistence(cleanA, dose, sharedPos);
      b = applyPersistence(cleanB, dose, sharedPos);
    }
    deltaHrs.push(hurstApprox(a) - hurstApprox(b));
    deltaHit.push(hitRate(a, 1) - hitRate(b, 1));
  }
  const label = `${mechanism} dose=${dose} ${syncMask ? 'synchronized' : 'independent-pos'}`;
  summarize(deltaHrs, `HRS  ${label}`);
  summarize(deltaHit, `hit  ${label}`);
  console.log('');
}

runSymmetric('literal', 0.20, true);
runSymmetric('literal', 0.20, false);
runSymmetric('persistence', 0.35, true);
runSymmetric('persistence', 0.35, false);

// ---------- Negative controls: asymmetric disturbance — should NOT cancel ----------
console.log('--- Negative controls: asymmetric disturbance — expect NO cancellation (sanity check) ---\n');

function runUnequalHalfPersistence(doseA, doseB) {
  const deltaHrs = [];
  for (let r = 0; r < N_REALIZATIONS; r++) {
    const cleanA = cleanBits(N_BITS);
    const cleanB = cleanBits(N_BITS);
    const a = applyPersistence(cleanA, doseA, null);
    const b = applyPersistence(cleanB, doseB, null);
    deltaHrs.push(hurstApprox(a) - hurstApprox(b));
  }
  summarize(deltaHrs, `HRS  persistence unequal-half A=${doseA} B=${doseB}`);
}

function runSubjectOnlyLiteral(dose) {
  const deltaHrs = [];
  const deltaHit = [];
  for (let r = 0; r < N_REALIZATIONS; r++) {
    const cleanA = cleanBits(N_BITS);
    const cleanB = cleanBits(N_BITS);
    const literalValue = 1;
    const a = applyLiteralBias(cleanA, dose, literalValue, null); // Subject only
    const b = cleanB; // PCS untouched
    deltaHrs.push(hurstApprox(a) - hurstApprox(b));
    deltaHit.push(hitRate(a, 1) - hitRate(b, 1));
  }
  summarize(deltaHrs, `HRS  subject-only literal dose=${dose}`);
  summarize(deltaHit, `hit  subject-only literal dose=${dose}`);
}

runUnequalHalfPersistence(0.35, 0.10);
runSubjectOnlyLiteral(0.20);

console.log('\nDone.\n');
