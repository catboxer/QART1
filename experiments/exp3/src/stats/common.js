// Core shared helpers

// Fast erf approximation (Abramowitz & Stegun 7.1.26)
export function erfApprox(x) {
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

// Standard normal CDF Φ(x)
export function normalCdf(x) {
  return 0.5 * (1 + erfApprox(x / Math.SQRT2));
}

// Pooled two-proportion z (kept for compatibility)
export function twoPropZ(p1, n1, p2, n2) {
  const n1s = Math.max(1, n1 | 0),
    n2s = Math.max(1, n2 | 0);
  const p = (p1 * n1s + p2 * n2s) / (n1s + n2s);
  const se = Math.sqrt(p * (1 - p) * (1 / n1s + 1 / n2s)) || 1;
  return (p1 - p2) / se;
}

// Binary Shannon entropy (in bits per symbol, 0..1)
export function shannonEntropy(bits) {
  const n = bits.length;
  if (n === 0) return null;
  const ones = bits.reduce((a, b) => a + b, 0);
  const p = ones / n;
  if (p === 0 || p === 1) return 0;
  return -p * Math.log2(p) - (1 - p) * Math.log2(1 - p);
}
