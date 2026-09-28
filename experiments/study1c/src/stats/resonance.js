// Resonance: lag-1 autocorrelation (on ±1 mapping)
export function lag1Autocorr(bits) {
  const n = bits.length;
  if (n < 3) return 0;
  const x = bits.map((b) => (b ? 1 : -1));
  const mean = x.reduce((a, b) => a + b, 0) / n;
  let num = 0,
    den = 0;
  for (let i = 0; i < n; i++) {
    const d = x[i] - mean;
    den += d * d;
    if (i > 0) num += (x[i - 1] - mean) * (x[i] - mean);
  }
  return den ? num / den : 0;
}
