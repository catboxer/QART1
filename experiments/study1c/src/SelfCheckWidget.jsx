// src/SelfCheckWidget.jsx
import React, { useMemo, useState } from 'react';

/** SelfCheckWidget
 *  One-sided binomial test vs 50% (pre-committed to RIGHT).
 *  Subjects paste their session results (percentages or hits),
 *  and it reports p-value and significance.
 *
 *  Props:
 *    - trialsPerSession: default 100
 *    - defaultInput: optional initial string like "52,52,55,60"
 */

// ---------- math helpers (exact binomial tail using safe logs) ----------
function logGamma(z) {
  // Lanczos approximation (suitable for our range)
  const g = 7;
  const C = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    // reflection formula
    return (
      Math.log(Math.PI) -
      Math.log(Math.sin(Math.PI * z)) -
      logGamma(1 - z)
    );
  }
  z -= 1;
  let x = C[0];
  for (let i = 1; i < C.length; i++) x += C[i] / (z + i);
  const t = z + g + 0.5;
  return (
    0.5 * Math.log(2 * Math.PI) +
    (z + 0.5) * Math.log(t) -
    t +
    Math.log(x)
  );
}
function logChoose(n, k) {
  if (k < 0 || k > n) return -Infinity;
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}
/** log pmf of Binomial(n,p) at k */
function logBinomPMF(k, n, p) {
  if (p <= 0) return k === 0 ? 0 : -Infinity;
  if (p >= 1) return k === n ? 0 : -Infinity;
  return (
    logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p)
  );
}
/** One-sided (upper-tail) p-value: P[X >= k] for X~Binomial(n, 0.5) */
function binomOneSidedP(k, n, p = 0.5) {
  if (k <= 0) return 1;
  if (k > n) return 0;
  // Start at k, sum upward using stable recurrence
  const logPk = logBinomPMF(k, n, p);
  let term = Math.exp(logPk); // P(X=k)
  let sum = term;
  for (let i = k; i < n; i++) {
    // P(X=i+1) = P(X=i) * ((n-i)/(i+1)) * (p/(1-p))
    term = term * ((n - i) / (i + 1)) * (p / (1 - p));
    if (term === 0) break;
    sum += term;
  }
  // guard against rounding drift
  return Math.min(1, Math.max(0, sum));
}

/** Minimal hits needed for alpha (one-sided) at n trials */
function neededHitsOneSided(n, alpha = 0.05, p = 0.5) {
  // start from ceil(n*p) and move up until tail <= alpha
  let k = Math.ceil(n * p);
  // ensure strictly greater than chance when n is even
  if (n % 2 === 0 && k === n / 2) k = n / 2 + 1;
  let best = null;
  for (; k <= n; k++) {
    const pval = binomOneSidedP(k, n, p);
    if (pval <= alpha) {
      best = k;
      break;
    }
  }
  return best ?? Infinity; // Infinity = impossible (shouldn't happen for p=0.5)
}

// ---------- parsing helpers ----------
/** Accepts entries like "52", "60%", "61/100", "58 hits", etc. */
function parseEntry(s, trialsPerSession = 100) {
  const t = String(s).trim();
  if (!t) return null;
  // "x/y"
  const frac = t.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) {
    const num = parseInt(frac[1], 10);
    const den = parseInt(frac[2], 10);
    if (Number.isFinite(num) && Number.isFinite(den) && den > 0) {
      return { hits: num, trials: den };
    }
  }
  // "55%" or "55"
  const pct = t.replace('%', '');
  if (/^\d+(\.\d+)?$/.test(pct)) {
    const p = parseFloat(pct);
    const hits = Math.round((p / 100) * trialsPerSession);
    return { hits, trials: trialsPerSession };
  }
  // "55 hits"
  const hitsOnly = t.match(/^(\d+)\s*(hits?)?$/i);
  if (hitsOnly) {
    const num = parseInt(hitsOnly[1], 10);
    return { hits: num, trials: trialsPerSession };
  }
  return null;
}

export default function SelfCheckWidget({
  trialsPerSession = 100,
  defaultInput = '52,52,55,60',
}) {
  const [input, setInput] = useState(defaultInput);
  const [alpha, setAlpha] = useState(0.05);

  const parsed = useMemo(() => {
    const parts = String(input)
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const rows = parts
      .map((p) => parseEntry(p, trialsPerSession))
      .filter(Boolean);
    const K = rows.reduce((a, r) => a + r.hits, 0);
    const N = rows.reduce((a, r) => a + r.trials, 0);
    return { rows, K, N };
  }, [input, trialsPerSession]);

  const result = useMemo(() => {
    const { K, N } = parsed;
    if (!N) return null;
    const pval = binomOneSidedP(K, N, 0.5);
    const need = neededHitsOneSided(N, alpha, 0.5);
    const pct = (100 * K) / N;
    return {
      K,
      N,
      pct,
      pval,
      need,
      shortfall: Math.max(0, need - K),
    };
  }, [parsed, alpha]);

  const table = useMemo(() => {
    // Show a small guidance table for 1..10 sessions (configurable)
    const out = [];
    for (let m = 1; m <= 10; m++) {
      const n = m * trialsPerSession;
      const need = neededHitsOneSided(n, alpha, 0.5);
      out.push({ m, n, need, pct: (100 * need) / n });
    }
    return out;
  }, [trialsPerSession, alpha]);

  return (
    <section
      style={{
        border: '1px solid #eee',
        borderRadius: 8,
        padding: 16,
        marginTop: 16,
      }}
    >
      <h2 style={{ marginTop: 0 }}>
        Check your own result (one-sided vs 50%)
      </h2>

      <div style={{ display: 'grid', gap: 8, maxWidth: 640 }}>
        <label>
          <div style={{ fontSize: 12, color: '#555' }}>
            Enter your sessions (comma or newline separated):
            examples: <code>52,52,55,60</code> or <code>59/100</code>
          </div>
          <textarea
            rows={3}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g., 59, 58, 60 or 60/100;58/100"
            style={{ width: '100%' }}
          />
        </label>

        <div
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <label>
            <span style={{ fontSize: 12, color: '#555' }}>
              Trials per session
            </span>
            <br />
            <input
              type="number"
              min={1}
              value={trialsPerSession}
              onChange={() => {}}
              disabled
              style={{ width: 100 }}
              title="Configured by the study (100)"
            />
          </label>
          <label>
            <span style={{ fontSize: 12, color: '#555' }}>
              Alpha (significance level)
            </span>
            <br />
            <select
              value={alpha}
              onChange={(e) => setAlpha(parseFloat(e.target.value))}
            >
              <option value={0.05}>0.05</option>
              <option value={0.01}>0.01</option>
              <option value={0.001}>0.001</option>
            </select>
          </label>
        </div>

        {result && (
          <div
            style={{
              marginTop: 8,
              padding: 12,
              background: '#fafafa',
              border: '1px solid #eee',
              borderRadius: 6,
            }}
          >
            <div>
              <strong>Total:</strong> {result.K} hits out of{' '}
              {result.N} trials ({result.pct.toFixed(2)}%)
            </div>
            <div>
              <strong>One-sided p-value vs 50%:</strong>{' '}
              {result.pval < 1e-6 ? '< 1e-6' : result.pval.toFixed(6)}
            </div>
            <div>
              <strong>Threshold for p &lt; {alpha}:</strong> need ≥{' '}
              {result.need} hits (
              {((100 * result.need) / result.N).toFixed(2)}%)
              {result.shortfall > 0 ? (
                <span style={{ marginLeft: 6, color: '#a00' }}>
                  ({result.shortfall} more needed)
                </span>
              ) : (
                <span style={{ marginLeft: 6, color: '#186a3b' }}>
                  (passed)
                </span>
              )}
            </div>
            <div
              style={{ marginTop: 8, fontSize: 12, color: '#555' }}
            >
              Pre-commitment to “RIGHT” assumed. This is a one-sided
              binomial test against 50%.
            </div>
          </div>
        )}

        <details style={{ marginTop: 8 }}>
          <summary>How many sessions do I need?</summary>
          <div style={{ marginTop: 8, overflowX: 'auto' }}>
            <table
              style={{ borderCollapse: 'collapse', minWidth: 420 }}
            >
              <thead>
                <tr>
                  <th style={th}>Sessions</th>
                  <th style={th}>Total trials</th>
                  <th style={th}>Need ≥ hits</th>
                  <th style={th}>Or ≥ average %</th>
                </tr>
              </thead>
              <tbody>
                {table.map((r) => (
                  <tr key={r.m}>
                    <td style={td}>{r.m}</td>
                    <td style={td}>{r.n}</td>
                    <td style={td}>
                      <strong>{r.need}</strong>
                    </td>
                    <td style={td}>{r.pct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </section>
  );
}

const th = {
  border: '1px solid #eee',
  padding: '6px 8px',
  textAlign: 'left',
  background: '#f6f6f6',
};
const td = { border: '1px solid #eee', padding: '6px 8px' };
