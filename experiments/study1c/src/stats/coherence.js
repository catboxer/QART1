// Coherence: cumulative ±1 walk range
export function cumulativeRange(bits /* 0/1 */) {
  let pos = 0,
    minPos = 0,
    maxPos = 0;
  for (const b of bits) {
    pos += b ? 1 : -1;
    if (pos < minPos) minPos = pos;
    if (pos > maxPos) maxPos = pos;
  }
  return maxPos - minPos;
}
// Rough Hurst via R/S on ±1 mapping
export function hurstApprox(bits) {
  const n = bits.length;
  if (n < 20) return 0.5;
  const x = bits.map((b) => (b ? 1 : -1));
  const mean = x.reduce((a, b) => a + b, 0) / n;
  let y = 0,
    minY = 0,
    maxY = 0,
    s2 = 0;
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
