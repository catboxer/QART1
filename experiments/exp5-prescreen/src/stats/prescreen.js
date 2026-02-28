// Prescreen session analysis
// Tests whether a participant's ΔH distribution reflects genuine temporal structure
// vs a simple mean-shift in bit frequency.
//
// Logic:
//   1. KS test: H_subject distribution vs H_demon distribution (original)
//   2. Shuffle test: shuffle bits within every block, recompute H_subject, re-run KS
//      - If first KS significant AND D collapses after shuffle → temporal structure (PASS)
//      - If first KS significant AND D survives shuffle → mean-shift only (FAIL)
//   3. PCS quality note (informational only, not a gate): flag if demon stream had
//      anomalous blocks — prompts researcher to check QRNG audit, does not affect eligibility

import { hurstApprox } from './coherence.js';

// ── KS distance (two-sample) ──────────────────────────────────────────────────
function ksDist(a, b) {
  if (!a.length || !b.length) return 0;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  const na = sa.length, nb = sb.length;
  let ia = 0, ib = 0, maxD = 0;
  while (ia < na || ib < nb) {
    const va = ia < na ? sa[ia] : Infinity;
    const vb = ib < nb ? sb[ib] : Infinity;
    const v = Math.min(va, vb);
    while (ia < na && sa[ia] <= v) ia++;
    while (ib < nb && sb[ib] <= v) ib++;
    maxD = Math.max(maxD, Math.abs(ia / na - ib / nb));
  }
  return maxD;
}

// ── Two-sample KS p-value (Kolmogorov series approximation) ──────────────────
function ksPValue(D, n1, n2) {
  if (!Number.isFinite(D) || D <= 0) return 1;
  if (!n1 || !n2 || n1 + n2 === 0) return 1;
  const nEff = Math.sqrt((n1 * n2) / (n1 + n2));
  if (!Number.isFinite(nEff) || nEff <= 0) return 1;
  const lambda = D * nEff;
  let q = 0;
  for (let j = 1; j <= 40; j++) {
    q += 2 * (j % 2 === 1 ? 1 : -1) * Math.exp(-2 * j * j * lambda * lambda);
  }
  return Number.isFinite(q) ? Math.max(0, Math.min(1, q)) : 1;
}

// ── Fisher-Yates shuffle (returns new array) ──────────────────────────────────
function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Standard normal CDF (Abramowitz & Stegun approximation) ──────────────────
function normCDF(z) {
  const a1 =  0.254829592, a2 = -0.284496736, a3 =  1.421413741;
  const a4 = -1.453152027, a5 =  1.061405429, p  =  0.3275911;
  const sign = z < 0 ? -1 : 1;
  z = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + p * z);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}

// ── Cliff's delta (non-parametric effect size) ───────────────────────────────
// Compares raw distributions: P(X > Y) - P(X < Y), bounded [-1, 1].
// Positive δ means values in `a` tend to exceed values in `b`.
// Interpretation: |δ| < 0.147 negligible, < 0.33 small, < 0.474 medium, else large.
// Note: This compares unpaired distributions (like KS), not paired differences.
function cliffsD(a, b) {
  if (!a.length || !b.length) return 0;
  let greater = 0, less = 0;
  for (const x of a) {
    for (const y of b) {
      if (x > y) greater++;
      else if (x < y) less++;
    }
  }
  return (greater - less) / (a.length * b.length);
}

// ── Wasserstein distance (1D, L1 / Earth Mover's Distance) ───────────────────
// For equal-length samples: mean of |sorted_a[i] - sorted_b[i]|.
// Interpretation: average "work" to transform one distribution into the other,
// in the same units as the input (Hurst exponent units here).
function wasserstein1D(a, b) {
  if (!a.length || !b.length) return 0;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  const n = Math.min(sa.length, sb.length);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += Math.abs(sa[i] - sb[i]);
  }
  return sum / n;
}

// ── Pearson r (diagnostic only — not used in any gate) ───────────────────────
function pearsonR(a, b) {
  const n = a.length;
  if (n < 2) return 0;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const ai = a[i] - ma, bi = b[i] - mb;
    num += ai * bi;
    da += ai * ai;
    db += bi * bi;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

// ── Main session analysis ─────────────────────────────────────────────────────
// subjectBitsHistory : Array<Array<0|1>>  — raw bits per block (for shuffle test)
// hurstSubjectHistory: Array<number>      — H_subject per block
// hurstDemonHistory  : Array<number>      — H_demon per block
// nullHurst          : { mean, sd }       — finite-sample null from config
// nShuffles          : number             — permutations for empirical p-value
// totalDemonHits     : number|null        — cumulative demon bit matches (for ghostZ)
// totalDemonTrials   : number|null        — cumulative demon trial count (for ghostZ)
export function computeSessionAnalysis(
  subjectBitsHistory,
  hurstSubjectHistory,
  hurstDemonHistory,
  nullHurst,
  nShuffles = 200,
  totalDemonHits = null,
  totalDemonTrials = null,
) {
  const nBlocks = hurstSubjectHistory.length;
  if (nBlocks === 0) return null;

  // 1. Original KS test: H_subject vs H_demon
  const originalD = ksDist(hurstSubjectHistory, hurstDemonHistory);
  const originalP = ksPValue(originalD, nBlocks, nBlocks);

  // 2. Shuffle test: for each iteration shuffle bits within every block,
  //    recompute H_subject, re-run KS against the same H_demon
  let nGreater = 0;
  let totalShuffledD = 0;

  for (let s = 0; s < nShuffles; s++) {
    const hSubjShuffled = subjectBitsHistory.map(bits => hurstApprox(shuffled(bits)));
    const d = ksDist(hSubjShuffled, hurstDemonHistory);
    totalShuffledD += d;
    if (d >= originalD) nGreater++;
  }

  const meanShuffledD = totalShuffledD / nShuffles;
  // collapseP = Pr(D_shuffled >= D_original): small → original D anomalously large → collapse confirmed
  // +1 correction avoids collapseP = 0.0 (overconfident with small shuffle counts)
  const collapseP = (nGreater + 1) / (nShuffles + 1);
  // dDrop: relative collapse magnitude
  const dDrop = originalD > 0 ? (originalD - meanShuffledD) / originalD : 0;

  // 3. PCS quality diagnostics (informational — none are gates)
  // nullZ: how far did the demon stream's mean Hurst drift from null?
  //   SE = null_SD / sqrt(nBlocks). ~13% false-positive rate at |Z| > 1.5.
  const demonMean = hurstDemonHistory.reduce((a, b) => a + b, 0) / nBlocks;
  const demonSD = Math.sqrt(
    hurstDemonHistory.reduce((s, v) => s + (v - demonMean) ** 2, 0) / nBlocks
  );
  const nullZ = (demonMean - nullHurst.mean) / (nullHurst.sd / Math.sqrt(nBlocks));

  // sdRatio: demon Hurst SD inflation vs null. >1.5 suggests over-dispersion.
  const sdRatio = nullHurst.sd > 0 ? demonSD / nullHurst.sd : null;

  // ghostZ: demon bit hit-rate Z vs 0.5 (frequency bias in PCS stream).
  //   null when totalDemonHits/Trials not provided.
  let ghostZ = null;
  if (totalDemonHits !== null && totalDemonTrials > 0) {
    const ghostRate = totalDemonHits / totalDemonTrials;
    ghostZ = (ghostRate - 0.5) / (0.5 / Math.sqrt(totalDemonTrials));
  }

  // crossCorr: Pearson r between H_subject and H_demon per block.
  //   Expected ~0.35 due to within-fetch QRNG adjacency — diagnostic only.
  const crossCorr = pearsonR(hurstSubjectHistory, hurstDemonHistory);

  // 4. ΔH distribution analysis (paired differences per block)
  //    Used by evaluatePrescreen to assign Tier 1/2/3 within eligible ranks.
  const deltaHList = hurstSubjectHistory.map((h, i) => h - hurstDemonHistory[i]);
  const meanDeltaH = deltaHList.reduce((a, b) => a + b, 0) / nBlocks;
  const varDeltaH  = deltaHList.reduce((s, v) => s + (v - meanDeltaH) ** 2, 0) / nBlocks;
  const seDeltaH   = nBlocks > 1 ? Math.sqrt(varDeltaH) / Math.sqrt(nBlocks) : 0;

  // Sign test: fraction of blocks where ΔH > 0 (subject beat demon)
  // Under null, ~50%. Binomial test for systematic bias.
  const nPositive = deltaHList.filter(d => d > 0).length;
  const signRate  = nPositive / nBlocks;
  // Two-tailed binomial p-value: P(|X - n/2| >= |nPositive - n/2|) under p=0.5
  // Using normal approximation for large n: Z = (nPositive - n/2) / sqrt(n/4)
  const signZ = (nPositive - nBlocks / 2) / Math.sqrt(nBlocks / 4);
  const signP = 2 * (1 - normCDF(Math.abs(signZ)));

  // 5. Effect size diagnostics (metadata only — not used in any gate)
  //    Cliff's δ: compares raw H distributions, P(H_subj > H_demon) - P(H_subj < H_demon).
  //    Wasserstein: EMD in Hurst units, captures distribution shift magnitude.
  const cliffsDelta = cliffsD(hurstSubjectHistory, hurstDemonHistory);
  const wassersteinDist = wasserstein1D(hurstSubjectHistory, hurstDemonHistory);

  return {
    nBlocks,
    ks: { originalD, originalP },
    effectSize: { cliffsDelta, wassersteinDist },
    shuffle: { collapseP, meanShuffledD, dDrop, nShuffles },
    pcs: { demonMean, demonSD, nullZ, ghostZ, sdRatio, crossCorr },
    deltaH: { meanDeltaH, seDeltaH, signRate, signP },
  };
}

// ── Eligibility evaluation ────────────────────────────────────────────────────
// Single source of truth for all gating and ranking decisions.
// Takes a computeSessionAnalysis result and the pkConfig constants.
//
// Returns:
//   ksGate       — Layer 1: KS anomaly detected
//   collapseGate — Layer 2: temporal ordering confirmed (OR logic)
//   eligible     — both gates pass → show invite form
//   rank         — 'gold' | 'silver' | 'candidate' | null
//   pcsWarning   — informational amber flag (any PCS metric anomalous)
//   pcsFlags     — { nullZ, ghostZ, sdRatio } — which metrics triggered
//
// Gold:      eligible + dDrop > 0.30  (high-confidence structural influencer)
// Silver:    eligible + dDrop ≤ 0.30  (includes collapseP-only signals; still invited)
// Candidate: ksGate && !collapseGate — tag for manual review, no invite
// pcsWarning never blocks eligibility or changes rank

export function evaluatePrescreen(analysis, C) {
  const { ks, shuffle, pcs, deltaH } = analysis;

  // Layer 1 — KS anomaly gate
  const ksGate = ks.originalP < C.PRESCREEN_KS_ALPHA;

  // Layer 2 — Shuffle collapse gate (OR: probability OR magnitude)
  const collapseGate =
    shuffle.collapseP < C.PRESCREEN_COLLAPSE_ALPHA ||
    shuffle.dDrop     >= C.PRESCREEN_DDROP_MIN;

  const eligible = ksGate && collapseGate;

  // Database rank (first-match, strictest first)
  // Candidate is exactly: ksGate passes but collapseGate fails — no other conditions
  // Gold: strong evidence via probability (collapseP) OR magnitude (dDrop)
  let rank = 'none';
  if (eligible) {
    const isGold = shuffle.collapseP < C.PRESCREEN_COLLAPSE_GOLD || shuffle.dDrop >= C.PRESCREEN_DDROP_GOLD;
    rank = isGold ? 'gold' : 'silver';
  } else if (ksGate && !collapseGate) {
    rank = 'candidate'; // signal without confirmed temporal structure — manual review
  }

  // Intensity tier — Gold and Silver only, null otherwise
  // Tier 3 (strongest): |mean ΔH| ≥ T3 × SE
  // Tier 2 (moderate):  T2 × SE ≤ |mean ΔH| < T3 × SE
  // Tier 1 (subtle):    |mean ΔH| < T2 × SE  (collapseP carried the vote)
  let intensityTier = null;
  if (eligible && deltaH.seDeltaH > 0) {
    const t = Math.abs(deltaH.meanDeltaH) / deltaH.seDeltaH;
    intensityTier = t >= C.PRESCREEN_INTENSITY_T3 ? 3
                  : t >= C.PRESCREEN_INTENSITY_T2 ? 2
                  : 1;
  }

  // PCS quality flags — informational only, never affect eligibility or rank
  const nullZFlag   = Math.abs(pcs.nullZ) > C.PRESCREEN_PCS_NULLZ_WARN;
  const ghostZFlag  = pcs.ghostZ !== null && Math.abs(pcs.ghostZ) > C.PRESCREEN_PCS_NULLZ_WARN;
  const sdRatioFlag = pcs.sdRatio !== null && pcs.sdRatio > C.PRESCREEN_PCS_SD_RATIO_WARN;
  const pcsWarning  = nullZFlag || ghostZFlag || sdRatioFlag;
  const pcsFlags    = { nullZFlag, ghostZFlag, sdRatioFlag };

  return { ksGate, collapseGate, eligible, rank, intensityTier, pcsWarning, pcsFlags };
}
