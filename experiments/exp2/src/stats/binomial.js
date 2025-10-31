// Exact binomial functions for statistical significance testing

function logFactorial(n) {
  let s = 0;
  for (let i = 2; i <= n; i++) s += Math.log(i);
  return s;
}

function logChoose(n, k) {
  if (k < 0 || k > n) return -Infinity;
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

export function binomPMF(n, k, p) {
  const logp =
    logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p);
  return Math.exp(logp);
}

export function binomPValueOneSidedAtOrAbove(hits, n, p0) {
  // P(X >= hits | Binomial(n, p0))
  let tail = 0;
  for (let k = hits; k <= n; k++) tail += binomPMF(n, k, p0);
  // numeric safety
  if (!Number.isFinite(tail)) return 0;
  return Math.min(1, Math.max(0, tail));
}

// Utility for formatting p-values
export function formatP(p) {
  if (p < 1e-4) return '<0.0001';
  if (p > 0.9999) return '≈1.0000';
  return Number.isFinite(p) ? p.toFixed(4) : '—';
}