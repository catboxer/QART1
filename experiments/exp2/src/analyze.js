#!/usr/bin/env node
// analyze.js — QRNG integrity + stats checks (no dependencies)

const fs = require('fs');

if (process.argv.length < 3) {
  console.error('Usage: node analyze.js sessions.json');
  process.exit(1);
}

const dataPath = process.argv[2];
const sessions = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

// ---------- math helpers (no deps) ----------
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const sd = (xs) => {
  if (xs.length <= 1) return 0;
  const m = mean(xs);
  const v =
    xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
};
// Given detailsDoc (details/trialDetails) return one point if present
export function extractBoostPoint(detailsDoc) {
  const rows = detailsDoc?.full_stack_trials || [];
  if (!rows.length) return null;

  const last = rows[rows.length - 1];
  if (!last || !last.block_summary) return null;

  const base = Number(last.fs_base_percent);
  const boost = Number(last.fs_boost_amount);
  const displayed = Number(last.fs_displayed_percent);
  const boosted = !!last.fs_boosted;

  if (!Number.isFinite(base) || !Number.isFinite(boost)) return null;

  return { base, boost, displayed, boosted };
}

// Normal CDF approximation (for two-sided p-values)
function normalCdf(z) {
  return 0.5 * (1 + Math.erf(z / Math.SQRT2));
}
function twoSidedPFromZ(z) {
  const pOne = 1 - normalCdf(Math.abs(z));
  return Math.max(0, Math.min(1, 2 * pOne));
}
// Binomial normal-approx z = (k - N*0.5) / sqrt(N*0.25)
function binomZAgainstHalf(k, N) {
  if (N === 0) return 0;
  const p0 = 0.5;
  const se = Math.sqrt(N * p0 * (1 - p0));
  return (k - N * p0) / se;
}
// Two-proportion z-test
function twoPropZ(k1, n1, k2, n2) {
  const pPool = (k1 + k2) / (n1 + n2);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / n1 + 1 / n2));
  if (se === 0) return 0;
  return (k1 / n1 - k2 / n2) / se;
}
// One-sample t-test on deltas vs 0
function oneSampleT(xs) {
  const m = mean(xs);
  const s = sd(xs);
  const n = xs.length;
  const t = s === 0 ? 0 : m / (s / Math.sqrt(n));
  // For quick reporting we’ll approximate p with normal (fine for n>30)
  const p = twoSidedPFromZ(Math.abs(t));
  return { t, df: n - 1, p, mean: m, sd: s, n };
}

// ---------- per-session parsing ----------
function summarizeSession(doc, idx) {
  const sl = doc.spoon_love || {};
  const trials = Array.isArray(sl.trialResults)
    ? sl.trialResults
    : [];

  const N = trials.length;
  let hitsPrimary = 0;
  let hitsGhost = 0;
  let n10 = 0; // primary=RIGHT, ghost=LEFT
  let n01 = 0; // primary=LEFT, ghost=RIGHT
  let alternatingOK = true;
  let qrngOK = true;

  let lastPos = null;
  let mismatchesComputed = 0;

  // Filter to only complete trials (both primary and ghost have valid data)
  const validTrials = trials.filter(t => {
    return typeof t.primary_is_right === 'number' &&
           typeof t.ghost_is_right === 'number';
  });

  const validN = validTrials.length;

  for (let i = 0; i < validN; i++) {
    const t = validTrials[i];
    const p = Number(t.primary_is_right) === 1 ? 1 : 0;
    const g = Number(t.ghost_is_right) === 1 ? 1 : 0;
    hitsPrimary += p;
    hitsGhost += g;

    if (p !== g) mismatchesComputed += 1;
    if (p === 1 && g === 0) n10 += 1;
    if (p === 0 && g === 1) n01 += 1;

    const pos = t.primary_pos;
    if (pos !== 1 && pos !== 2) alternatingOK = false;
    if (lastPos != null && pos === lastPos) alternatingOK = false;
    lastPos = pos;

    const qc = t.qrng_code;
    if (qc !== 1 && qc !== 2) qrngOK = false;
  }

  const pctPrimary = validN ? (100 * hitsPrimary) / validN : null;
  const pctGhost = validN ? (100 * hitsGhost) / validN : null;
  const delta =
    pctPrimary != null && pctGhost != null
      ? pctPrimary - pctGhost
      : null;

  // pull summary if present (for cross-checks)
  const s = sl.summary || {};
  const summary = {
    trials: s.trials ?? validN,  // Use valid trial count
    total_logged_trials: N,      // Track original count for debugging
    hits_primary_right: s.hits_primary_right ?? hitsPrimary,
    hits_ghost_right: s.hits_ghost_right ?? hitsGhost,
    percent_primary_right:
      s.percent_primary_right ??
      (pctPrimary != null ? +pctPrimary.toFixed(1) : null),
    percent_ghost_right:
      s.percent_ghost_right ??
      (pctGhost != null ? +pctGhost.toFixed(1) : null),
    delta_vs_ghost:
      s.delta_vs_ghost ?? (delta != null ? +delta.toFixed(1) : null),
    n10: s.n10 ?? n10,
    n01: s.n01 ?? n01,
  };

  // integrity warnings
  const warnings = [];
  const within = (x, lo, hi) => x == null || (x >= lo && x <= hi);
  if (!within(summary.percent_primary_right, 0, 100))
    warnings.push('primary % out of range');
  if (!within(summary.percent_ghost_right, 0, 100))
    warnings.push('ghost % out of range');
  if (summary.hits_primary_right > summary.trials)
    warnings.push('primary hits > trials');
  if (summary.hits_ghost_right > summary.trials)
    warnings.push('ghost hits > trials');
  if (
    !Number.isInteger(summary.n10) ||
    !Number.isInteger(summary.n01) ||
    summary.n10 < 0 ||
    summary.n01 < 0
  ) {
    warnings.push('n10/n01 invalid');
  }
  const deltaRecalc =
    summary.percent_primary_right != null &&
    summary.percent_ghost_right != null
      ? +(
          summary.percent_primary_right - summary.percent_ghost_right
        ).toFixed(1)
      : null;
  if (
    summary.delta_vs_ghost != null &&
    deltaRecalc != null &&
    Math.abs(deltaRecalc - summary.delta_vs_ghost) > 0.1
  ) {
    warnings.push('delta mismatch');
  }
  if (!alternatingOK) warnings.push('primary_pos alternation broken');
  if (!qrngOK) warnings.push('qrng_code invalid values');

  return {
    session_id: doc.session_id ?? `row_${idx}`,
    N,
    hitsPrimary,
    hitsGhost,
    pctPrimary,
    pctGhost,
    delta,
    n10,
    n01,
    alternatingOK,
    qrngOK,
    mismatchesComputed,
    summary,
    warnings,
  };
}

// ---------- run ----------
const per = sessions.map(summarizeSession);

// Print per-session quick table
console.log('Per-session (first 10 shown):');
console.table(
  per.slice(0, 10).map((x) => ({
    session: x.session_id,
    N: x.N,
    primary_pct: x.pctPrimary?.toFixed(1),
    ghost_pct: x.pctGhost?.toFixed(1),
    delta: x.delta?.toFixed(1),
    n10: x.n10,
    n01: x.n01,
    altOK: x.alternatingOK,
    qrngOK: x.qrngOK,
    warnings: x.warnings.join('; '),
  }))
);

// Aggregate totals
const NtotPrimary = per.reduce((a, r) => a + r.N, 0);
const NtotGhost = NtotPrimary; // same N
const KtotPrimary = per.reduce((a, r) => a + r.hitsPrimary, 0);
const KtotGhost = per.reduce((a, r) => a + r.hitsGhost, 0);
const pctPrimaryTot = NtotPrimary
  ? (100 * KtotPrimary) / NtotPrimary
  : null;
const pctGhostTot = NtotGhost ? (100 * KtotGhost) / NtotGhost : null;
const deltaTot =
  pctPrimaryTot != null && pctGhostTot != null
    ? pctPrimaryTot - pctGhostTot
    : null;

console.log('\n=== Aggregates ===');
console.log(`Total trials: ${NtotPrimary}`);
console.log(
  `Primary RIGHT: ${KtotPrimary} (${pctPrimaryTot?.toFixed(2)}%)`
);
console.log(
  `Ghost   RIGHT: ${KtotGhost} (${pctGhostTot?.toFixed(2)}%)`
);
console.log(`Delta (Primary - Ghost): ${deltaTot?.toFixed(2)}%`);

// Stats:
// 1) RNG bias test using GHOST vs 50%
if (NtotGhost > 0) {
  const zGhost = binomZAgainstHalf(KtotGhost, NtotGhost);
  const pGhost = twoSidedPFromZ(zGhost);
  console.log('\n[RNG bias test using GHOST]');
  console.log(
    `z = ${zGhost.toFixed(3)}, p ≈ ${pGhost.toExponential(
      2
    )} (null: p=0.5)`
  );
}

// 2) Participant effect: two-proportion z-test Primary vs Ghost
if (NtotPrimary > 0 && NtotGhost > 0) {
  const zPP = twoPropZ(
    KtotPrimary,
    NtotPrimary,
    KtotGhost,
    NtotGhost
  );
  const pPP = twoSidedPFromZ(zPP);
  console.log('\n[Primary vs Ghost two-proportion test]');
  console.log(
    `z = ${zPP.toFixed(3)}, p ≈ ${pPP.toExponential(
      2
    )} (null: equal rates)`
  );
}

// 3) Per-session delta t-test vs 0 (good if you have many sessions)
const deltas = per.filter((r) => r.delta != null).map((r) => r.delta);
if (deltas.length >= 2) {
  const tt = oneSampleT(deltas);
  console.log('\n[Per-session delta t-test vs 0]');
  console.log(
    `n = ${tt.n}, meanΔ = ${tt.mean.toFixed(
      2
    )}%, sd = ${tt.sd.toFixed(2)}%`
  );
  console.log(
    `t(${tt.df}) = ${tt.t.toFixed(3)}, p ≈ ${tt.p.toExponential(2)}`
  );
}

// 4) Symmetry check n10 vs n01 (binomial approx)
const n10sum = per.reduce((a, r) => a + r.n10, 0);
const n01sum = per.reduce((a, r) => a + r.n01, 0);
const mismatches = n10sum + n01sum;
if (mismatches > 0) {
  const zSym = (n10sum - mismatches / 2) / Math.sqrt(mismatches / 4);
  const pSym = twoSidedPFromZ(zSym);
  console.log('\n[Symmetry n10 vs n01]');
  console.log(
    `n10=${n10sum}, n01=${n01sum}, z = ${zSym.toFixed(
      3
    )}, p ≈ ${pSym.toExponential(2)} (null: equal)`
  );
}

// 5) Integrity summary
const withWarnings = per.filter((r) => r.warnings.length > 0);
console.log('\n=== Integrity warnings ===');
if (withWarnings.length === 0) {
  console.log('None 🎉');
} else {
  withWarnings.forEach((r) => {
    console.log(`• ${r.session_id}: ${r.warnings.join('; ')}`);
  });
}
