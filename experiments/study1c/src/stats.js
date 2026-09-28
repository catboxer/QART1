// src/stats.js
export function twoPropZ(k1, n1, k2, n2) {
  if (!n1 || !n2) return 0;
  const p1 = k1 / n1;
  const p2 = k2 / n2;
  const p = (k1 + k2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  return se ? (p1 - p2) / se : 0;
}

// optional helpers if you need them in that file too:
export function erfApprox(z) {
  const sign = z < 0 ? -1 : 1;
  z = Math.abs(z);
  const a1 = 0.254829592,
    a2 = -0.284496736,
    a3 = 1.421413741,
    a4 = -1.453152027,
    a5 = 1.061405429,
    p = 0.3275911;
  const t = 1 / (1 + p * z);
  const y =
    1 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) *
      t *
      Math.exp(-z * z);
  return sign * y;
}
export const normalCdf = (z) => 0.5 * (1 + erfApprox(z / Math.SQRT2));
export const twoSidedP = (z) => {
  const pOne = 1 - normalCdf(Math.abs(z));
  return Math.max(0, Math.min(1, 2 * pOne));
};
