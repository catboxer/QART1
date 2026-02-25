// src/Scoring.jsx
import React from 'react';
import { pkConfig as C } from './config.js';

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
  // const totPct = totals.n ? Math.round((totals.k / totals.n) * 100) : 50;

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
        Totals so far: <b>{totals.k} hits/{totals.n} trials</b> 

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

// σ for single-scale R/S Hurst — derived from config null distribution for current TRIALS_PER_BLOCK
const SIGMA = C.NULL_HURST_SD;

// Session mean needle uses SE scaling: multiply meanDeltaH by √blockCount before mapping
// through toX. This converts to "how many null-distribution SEs has the session accumulated?"
// — a standard-normal-scaled t-statistic. Random sessions stay near centre regardless of
// block count; genuine persistent signal builds up and enters the coloured zones over time.
// Entry to first coloured zone (1σ) requires meanDeltaH ≥ SIGMA/√blockCount, e.g. ≥0.005
// at 80 blocks — which is an honestly detectable single-session effect.
// (Pilot group effects of 0.002–0.004 are below single-session detection threshold; they
//  required group aggregation, so the gauge correctly keeps them in grey.)

// Normal CDF (Abramowitz & Stegun approximation) — used for probability-proportional bar scale
// function normCDF(z) {
//   const t = 1 / (1 + 0.2316419 * Math.abs(z));
//   const d = 0.3989423 * Math.exp(-z * z / 2);
//   const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
//   return z > 0 ? 1 - p : p;
// }

// Positive direction tiers — The Flow (persistence / clustering)
const FLOW_TIERS = [
  { label: 'Emerging Flow', sigma:  1, from: SIGMA * 1, to: SIGMA * 2, bg: '#fef9c3', fg: '#854d0e', occurrence: '~1 in 6 blocks'       },
  { label: 'Coherent',      sigma:  2, from: SIGMA * 2, to: SIGMA * 3, bg: '#fed7aa', fg: '#c2410c', occurrence: '~1 in 44 blocks'      },
  { label: 'Ordered',       sigma:  3, from: SIGMA * 3, to: SIGMA * 4, bg: '#bbf7d0', fg: '#15803d', occurrence: '~1 in 740 blocks'     },
  { label: 'Crystalline',   sigma:  4, from: SIGMA * 4, to: SIGMA * 5, bg: '#bfdbfe', fg: '#1d4ed8', occurrence: '~1 in 31,500 blocks'  },
  { label: 'Pure Flow',     sigma:  5, from: SIGMA * 5, to:  Infinity, bg: '#e9d5ff', fg: '#7e22ce', occurrence: '~1 in 3.5M blocks'    },
];

// Negative direction tiers — The Pulse (anti-persistence / alternation)
const PULSE_TIERS = [
  { label: 'Emerging Pulse', sigma: -1, from: -SIGMA * 2, to: -SIGMA * 1, bg: '#fef9c3', fg: '#854d0e', occurrence: '~1 in 6 blocks'       },
  { label: 'Rhythmic',       sigma: -2, from: -SIGMA * 3, to: -SIGMA * 2, bg: '#fed7aa', fg: '#c2410c', occurrence: '~1 in 44 blocks'      },
  { label: 'Synchronized',   sigma: -3, from: -SIGMA * 4, to: -SIGMA * 3, bg: '#bbf7d0', fg: '#15803d', occurrence: '~1 in 740 blocks'     },
  { label: 'Resonant',       sigma: -4, from: -SIGMA * 5, to: -SIGMA * 4, bg: '#bfdbfe', fg: '#1d4ed8', occurrence: '~1 in 31,500 blocks'  },
  { label: 'Pure Pulse',     sigma: -5, from:  -Infinity, to: -SIGMA * 5, bg: '#e9d5ff', fg: '#7e22ce', occurrence: '~1 in 3.5M blocks'    },
];

// Center zone
const NOISE_FLOOR = {
  label: 'Noise Floor', sigma: 0,
  from: -SIGMA, to: SIGMA,
  bg: '#f3f4f6', fg: '#6b7280',
  occurrence: 'Within expected variation',
};

// All zones ordered left → right for rendering
const ALL_ZONES = [
  ...PULSE_TIERS.slice().reverse(), // most-negative first → least-negative
  NOISE_FLOOR,
  ...FLOW_TIERS,
];

function getTier(deltaH) {
  if (deltaH >= SIGMA) {
    return FLOW_TIERS.find(t => deltaH >= t.from && deltaH < t.to) ?? FLOW_TIERS[FLOW_TIERS.length - 1];
  }
  if (deltaH <= -SIGMA) {
    return PULSE_TIERS.find(t => deltaH >= t.from && deltaH < t.to) ?? PULSE_TIERS[PULSE_TIERS.length - 1];
  }
  return NOISE_FLOOR;
}

// Legacy export alias so any future code can import DELTA_TIERS if needed
const DELTA_TIERS = ALL_ZONES;

/**
 * HurstDeltaGauge
 * Bidirectional linear gauge showing running mean ΔH.
 * Left = The Pulse (anti-persistence), Right = The Flow (persistence).
 * Tier zones are colour-coded; no numeric labels on the bar.
 */
export function HurstDeltaGauge({ meanDeltaH = 0, blockDeltaH = null, blockCount = 0 }) {
  const W    = 520;
  const barY = 28;
  const barH = 20;
  const svgH = 60;

  // Piecewise linear scale.
  // Gray center = W/2 (50% of bar). Each non-gray side = W/4 (25%).
  // Non-gray side split: light 5/8 · medium 2/8 · darker 3/32 · darkest 1/32
  const sideW = W / 4; // 130px each side
  const f1 = (5 / 8)  * sideW; // ~81px  light green
  const f2 = (2 / 8)  * sideW; // ~33px  medium green
  const f3 = (3 / 32) * sideW; // ~12px  darker green
  const f4 = (1 / 32) * sideW; //  ~4px  darkest green

  // Breakpoints: [sigmaMultiple, xPixel]
  const BP = [
    [-5, 0                        ],
    [-4, f4                       ],
    [-3, f4 + f3                  ],
    [-2, f4 + f3 + f2             ],
    [-1, W / 4                    ], // = sideW
    [ 0, W / 2                    ],
    [ 1, W * 3 / 4                ],
    [ 2, W * 3 / 4 + f1           ],
    [ 3, W * 3 / 4 + f1 + f2      ],
    [ 4, W * 3 / 4 + f1 + f2 + f3 ],
    [ 5, W                        ],
  ];

  const toX = v => {
    const s = Math.max(-5, Math.min(5, v / SIGMA));
    for (let i = 1; i < BP.length; i++) {
      if (s <= BP[i][0]) {
        const [s0, x0] = BP[i - 1];
        const [s1, x1] = BP[i];
        return x0 + ((s - s0) / (s1 - s0)) * (x1 - x0);
      }
    }
    return BP[BP.length - 1][1];
  };

  // SE scaling: multiply by √blockCount so the needle shows accumulated evidence (t-statistic)
  const meanDeltaHScaled = meanDeltaH * Math.sqrt(Math.max(1, blockCount));
  const sessionTier = getTier(meanDeltaHScaled);
  const blockTier   = blockDeltaH != null ? getTier(blockDeltaH) : null;

  const GREEN_ZONES = [
    { from: SIGMA * 1, to: SIGMA * 2, fill: '#bbf7d0' },
    { from: SIGMA * 2, to: SIGMA * 3, fill: '#86efac' },
    { from: SIGMA * 3, to: SIGMA * 4, fill: '#4ade80' },
    { from: SIGMA * 4, to: SIGMA * 5, fill: '#16a34a' },
  ];

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '12px 0' }}>

      {/* Marker legend */}
      <div style={{ display: 'flex', gap: 20, justifyContent: 'center', marginBottom: 6, fontSize: 11, color: '#6b7280' }}>
        {blockDeltaH != null && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width={18} height={14} style={{ overflow: 'visible' }}>
              <line x1={9} y1={0} x2={9} y2={14} stroke="#1e40af" strokeWidth={2.5} strokeLinecap="round" />
              <circle cx={9} cy={0} r={4} fill="#1e40af" />
            </svg>
            Current block
          </span>
        )}
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <svg width={18} height={14} style={{ overflow: 'visible' }}>
            <line x1={9} y1={0} x2={9} y2={14} stroke="#7c3aed" strokeWidth={2} strokeDasharray="3,2" />
          </svg>
          Session average
        </span>
      </div>

      {/* Direction labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 0 4px', fontSize: 11, color: '#9ca3af', maxWidth: W, margin: '0 auto' }}>
        <span>← The Pulse</span>
        <span>The Flow →</span>
      </div>

      <svg width={W} height={svgH} style={{ display: 'block', margin: '0 auto', overflow: 'visible' }}>

        {/* Gray noise floor center */}
        <rect x={toX(-SIGMA)} y={barY} width={toX(SIGMA) - toX(-SIGMA)} height={barH} fill="#f3f4f6" />

        {/* Graduated green zones — mirrored on both sides */}
        {GREEN_ZONES.map(z => (
          <React.Fragment key={z.from}>
            <rect x={toX(-z.to)}   y={barY} width={toX(-z.from) - toX(-z.to)}  height={barH} fill={z.fill} />
            <rect x={toX( z.from)} y={barY} width={toX( z.to)   - toX( z.from)} height={barH} fill={z.fill} />
          </React.Fragment>
        ))}

        {/* Center divider at 0 */}
        <line x1={toX(0)} y1={barY} x2={toX(0)} y2={barY + barH} stroke="#9ca3af" strokeWidth={1} strokeDasharray="3,2" />

        {/* Session mean needle — pilot-scale (×SESSION_SCALE), dashed purple, drawn first (behind current block) */}
        <line
          x1={toX(meanDeltaHScaled)} y1={barY - 3}
          x2={toX(meanDeltaHScaled)} y2={barY + barH + 3}
          stroke="#7c3aed" strokeWidth={2} strokeDasharray="3,2"
        />

        {/* Current block marker — solid blue with dot on top, drawn on top */}
        {blockDeltaH != null && (
          <>
            <line
              x1={toX(blockDeltaH)} y1={barY - 7}
              x2={toX(blockDeltaH)} y2={barY + barH + 5}
              stroke="#1e40af" strokeWidth={2.5} strokeLinecap="round"
            />
            <circle cx={toX(blockDeltaH)} cy={barY - 9} r={4} fill="#1e40af" />
          </>
        )}

      </svg>

      {/* Session mean readout */}
      <div style={{ textAlign: 'center', marginTop: 4, fontWeight: 700, fontSize: 20, color: sessionTier.fg }}>
        {blockCount > 0 ? `Session: ${sessionTier.label}` : '—'}
      </div>

      {/* Per-block tier badge */}
      {blockDeltaH != null && blockTier && (
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <span style={{
            display: 'inline-block', padding: '5px 14px', borderRadius: 20,
            background: blockTier.bg, color: blockTier.fg, fontWeight: 600, fontSize: 13,
            border: `1px solid ${blockTier.fg}44`,
          }}>
            This block: {blockTier.label}
            &nbsp;<span style={{ fontWeight: 400, fontSize: 11 }}>({blockTier.occurrence})</span>
          </span>
        </div>
      )}
    </div>
  );
}

export { DELTA_TIERS, getTier };

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
