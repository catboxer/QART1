export function erf(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592,
    a2 = -0.284496736,
    a3 = 1.421413741,
    a4 = -1.453152027,
    a5 = 1.061405429,
    p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y =
    1 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) *
      t *
      Math.exp(-x * x);
  return sign * y;
}
export function zFromBinom(k, n, p0 = 0.5) {
  if (!n) return 0;
  const mu = n * p0,
    sd = Math.sqrt(n * p0 * (1 - p0)) || 1;
  return (k - mu) / sd;
}
// Two-sided p-value from z
export function twoSidedP(z) {
  const phi = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
  return Math.max(0, Math.min(1, 2 * (1 - phi(Math.abs(z)))));
}
