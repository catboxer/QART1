// src/stats/thresholds.js

// Inverse normal CDF (Acklam) – tiny, dependency-free
export function invNorm(p) {
  if (p <= 0 || p >= 1) throw new Error('invNorm requires 0<p<1');
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
    1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
    6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
  -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
    3.754408661907416e+00];
  const pl = 0.02425, ph = 1 - pl;
  let q, r;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (ph < p) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Needed proportion (>0.5) to exceed one-sided zCrit vs p0=0.5 */
export function neededPropVsHalf(n, zCrit) {
  if (!n || n <= 0) return 1;
  // SE for p0=0.5 is sqrt(0.25/n)
  return 0.5 + zCrit * Math.sqrt(0.25 / n);
}

/** Needed percent (rounded 0–100) for session significance at alpha one-sided */
export function sessionNeededPct(n, alpha = 0.01) {
  const zCrit = invNorm(1 - alpha);
  return Math.round(neededPropVsHalf(n, zCrit) * 100);
}

/** Needed hit count k (integer) for session significance */
export function requiredHits(n, alpha = 0.01) {
  const pct = sessionNeededPct(n, alpha);
  return Math.ceil((pct / 100) * n);
}

/** Pass/fail helper using the same approximation */
export function isSessionSignificant(k, n, alpha = 0.01) {
  if (!n || n <= 0) return false;
  const pct = Math.round((100 * k) / n);
  return pct >= sessionNeededPct(n, alpha);
}
