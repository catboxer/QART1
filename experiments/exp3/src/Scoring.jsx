// src/Scoring.jsx
import React from 'react';

/**
 * BlockScoreboard
 * Show the last block's score and total-to-date while the next block prepares.
 */
export function BlockScoreboard({
  last = { k: 0, n: 0, z: 0, pTwo: 1, kg: 0, ng: 0, zg: 0, pg: 1, kind: '?' },
  totals = { k: 0, n: 0 },
  targetSide = 'RED',
  hideGhost = false,
  hideBlockType = false,
}) {
  const pct = last.n ? Math.round((last.k / last.n) * 100) : 50;
  const totPct = totals.n ? Math.round((totals.k / totals.n) * 100) : 50;

  return (
    <div style={{ maxWidth: 760, margin: '16px auto', textAlign: 'center' }}>
      {!hideBlockType && (
        <div style={{ fontSize: 18, marginBottom: 8 }}>
          Last block ({last.kind?.toUpperCase?.() || last.kind})
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        <MiniGauge label={`Toward ${targetSide}`} value={last.n ? last.k / last.n : 0.5} />
        {!hideGhost && (
          <MiniGauge label="Ghost control" value={last.ng ? last.kg / last.ng : 0.5} muted />
        )}
      </div>

      <div style={{ fontSize: 14, opacity: 0.9, marginTop: 8 }}>
        <div>
          <b>{last.k}/{last.n}</b> hits → {pct}% · z={last.z?.toFixed?.(2)} · p={fmtP(last.pTwo)}
        </div>
        {!hideGhost && (
          <div style={{ opacity: 0.8 }}>
            ghost: {last.kg}/{last.ng} → {last.ng ? Math.round((100 * last.kg) / last.ng) : 50}% · z={last.zg?.toFixed?.(2)} · p={fmtP(last.pg)}
          </div>
        )}
      </div>

      <hr style={{ margin: '16px auto', maxWidth: 380 }} />

      <div style={{ fontSize: 16 }}>
        Totals so far: <b>{totals.k} hits/{totals.n} trials</b> → {totPct}%
      </div>
    </div>
  );
}

function fmtP(p) {
  if (p == null) return '—';
  if (p < 0.001) return '<0.001';
  return Number.isFinite(p) ? p.toFixed(3) : '—';
}

function MiniGauge({ value = 0.5, label = 'Score', width = 220, muted = false }) {
  const r = Math.round((width * 0.72) / 2);
  const cx = width / 2;
  const cy = r + 16;
  const halfLen = Math.PI * r;
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);

  const d = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const dashArray = `${halfLen} ${halfLen}`;
  const dashOffset = halfLen * (1 - Math.max(0, Math.min(1, value)));

  return (
    <svg
      width={width}
      height={r + 60}
      viewBox={`0 0 ${width} ${r + 60}`}
      style={{ opacity: muted ? 0.7 : 1, background: '#fff', border: '1px solid #eee', borderRadius: 12, padding: 8 }}
    >
      <path d={d} stroke="#e6e6e6" strokeWidth="14" fill="none" />
      <path
        d={d}
        stroke="#222"
        strokeWidth="14"
        fill="none"
        strokeLinecap="round"
        style={{ strokeDasharray: dashArray, strokeDashoffset: dashOffset, transition: 'stroke-dashoffset 120ms linear' }}
      />
      <text x={cx} y={cy - 10} textAnchor="middle" fontSize="22" fill="#222" fontWeight="700">
        {pct}%
      </text>
      <text x={cx} y={cy + 24} textAnchor="middle" fontSize="12" fill="#444">
        {label}
      </text>
    </svg>
  );
}

/**
 * SessionSummary
 * Final screen: show grand totals and an optional breakdown table.
 */
export function SessionSummary({ totals = { k: 0, n: 0 }, blocks = [] }) {
  const pct = totals && totals.n ? Math.round((100 * totals.k) / totals.n) : 50;
  const th = { textAlign: 'left', borderBottom: '1px solid #eee', padding: '6px 8px', fontWeight: 600 };
  const td = { borderBottom: '1px solid #f3f3f3', padding: '6px 8px' };

  return (
    <div style={{ padding: 24, maxWidth: 860, margin: '0 auto', textAlign: 'center' }}>
      <h2>Session Results</h2>
      <div style={{ fontSize: 18, marginBottom: 8 }}>
        Total: <b>{totals.k}/{totals.n}</b> → {pct}%
      </div>

      <div style={{ overflowX: 'auto', marginTop: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Block</th>
              <th style={th}>Kind</th>
              <th style={th}>Hits / N</th>
              <th style={th}>z</th>
              <th style={th}>p</th>
              <th style={th}>Ghost</th>
            </tr>
          </thead>
          <tbody>
            {blocks.map((b, i) => (
              <tr key={i}>
                <td style={td}>{i + 1}</td>
                <td style={td}>{b.kind}</td>
                <td style={td}>
                  {b.k}/{b.n} ({b.n ? Math.round((100 * b.k) / b.n) : 0}%)
                </td>
                <td style={td}>{b.z?.toFixed?.(2)}</td>
                <td style={td}>{fmtP(b.pTwo)}</td>
                <td style={td}>
                  {b.kg}/{b.ng} ({b.ng ? Math.round((100 * b.kg) / b.ng) : 0}%)
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
