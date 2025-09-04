// src/TimingArmsPanel.jsx
import React from 'react';

/** -----------------------------------------------------------------------
 *  TimingArmsPanel
 *  Props:
 *    - trials: Array of trial rows with these fields per row:
 *        timing_arm: 'open'|'scramble'|'synced'|'blind'
 *        agent: 'human'|'robot' (or anything; 'robot' means robot)
 *        hold_duration_ms: number|null
 *        primary_is_right: 1|0
 *        ghost_is_right: 1|0
 *  ----------------------------------------------------------------------*/

// ---------- tiny math helpers (self-contained) ----------
function twoSidedP_fromZ(z) {
  if (!isFinite(z)) return 1;
  // Normal approx
  const abs = Math.abs(z);
  const cdf = 0.5 * (1 + erf(abs / Math.SQRT2));
  return Math.max(0, Math.min(1, 2 * (1 - cdf)));
}
function erf(x) {
  // Abramowitz/Stegun approximation
  const sign = Math.sign(x) || 1;
  const a1 = 0.254829592,
    a2 = -0.284496736,
    a3 = 1.421413741,
    a4 = -1.453152027,
    a5 = 1.061405429,
    p = 0.3275911;
  const t = 1 / (1 + p * Math.abs(x));
  const y =
    1 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) *
      t *
      Math.exp(-x * x);
  return sign * y;
}
function twoPropZ(k1, n1, k2, n2) {
  if (!n1 || !n2) return 0;
  const p1 = k1 / n1;
  const p2 = k2 / n2;
  const p = (k1 + k2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  return se ? (p1 - p2) / se : 0;
}
function pDiff(k1, n1, k2, n2) {
  return twoSidedP_fromZ(twoPropZ(k1, n1, k2, n2));
}

// ---------- data helpers ----------
const ARMS = ['open', 'scramble', 'synced', 'blind'];

const byArm = (trials, arm) =>
  (trials || []).filter((t) => (t?.timing_arm || 'open') === arm);

const byAgent = (trials, robot) =>
  (trials || []).filter(
    (t) =>
      String(t?.agent || '').toLowerCase() ===
      (robot ? 'robot' : 'human')
  );

function countRight(trials, field) {
  let k = 0,
    n = 0;
  for (const t of trials || []) {
    const v = Number(t?.[field]);
    if (v === 1 || v === 0) {
      n += 1;
      k += v;
    }
  }
  return { k, n, pct: n ? (100 * k) / n : 0 };
}

function quickTrialReport(trials) {
  const subj = countRight(trials, 'primary_is_right');
  const dem = countRight(trials, 'ghost_is_right');

  // McNemar-ish symmetry on n10 vs n01 (only when both subject+ghost present)
  let n10 = 0,
    n01 = 0;
  for (const t of trials || []) {
    const p = Number(t?.primary_is_right) === 1 ? 1 : 0;
    const g = Number(t?.ghost_is_right) === 1 ? 1 : 0;
    if (p === 1 && g === 0) n10++;
    else if (p === 0 && g === 1) n01++;
  }
  const mismatches = n10 + n01;
  const zSym = mismatches
    ? (n10 - mismatches / 2) / Math.sqrt(mismatches / 4)
    : 0;
  const pSym = twoSidedP_fromZ(zSym);

  return {
    n: subj.n,
    pctSubj: subj.pct,
    pctGhost: dem.pct,
    delta: subj.pct - dem.pct,
    tests: {
      subjVsGhost: pDiff(subj.k, subj.n, dem.k, dem.n),
      symmetry: pSym,
    },
  };
}

function armAB(trialsA, trialsB) {
  const aSubj = countRight(trialsA, 'primary_is_right');
  const bSubj = countRight(trialsB, 'primary_is_right');
  const aDem = countRight(trialsA, 'ghost_is_right');
  const bDem = countRight(trialsB, 'ghost_is_right');

  const pSubj = pDiff(aSubj.k, aSubj.n, bSubj.k, bSubj.n);
  const pDem = pDiff(aDem.k, aDem.n, bDem.k, bDem.n);

  // diff-of-diff: (Subj-Dem)_A vs (Subj-Dem)_B
  const dA = aSubj.k / aSubj.n - aDem.k / aDem.n;
  const dB = bSubj.k / bSubj.n - bDem.k / bDem.n;
  // pooled SE for difference of proportions on the *gap*
  const pool =
    (aSubj.k - aDem.k + bSubj.k - bDem.k) /
    (aSubj.n + aDem.n + bSubj.n + bDem.n);
  const se = Math.sqrt(
    pool *
      (1 - pool) *
      (1 / aSubj.n + 1 / aDem.n + 1 / bSubj.n + 1 / bDem.n)
  );
  const z = se ? (dA - dB) / se : 0;
  const pDiffDiff = twoSidedP_fromZ(z);

  return {
    pSubj,
    pDem,
    pDiffDiff,
    sizes: { a: aSubj.n, b: bSubj.n },
    gaps: { a: dA, b: dB, diff: dA - dB },
  };
}

// Phase-bin report for synced arm
function phaseBin(ms, T = 1000 / 60, bins = 12) {
  if (!isFinite(ms)) return null;
  const phase = ((ms % T) + T) % T; // [0,T)
  return Math.min(bins - 1, Math.floor((phase / T) * bins));
}
function computePhaseReport(
  trials,
  rightField = 'primary_is_right',
  bins = 12
) {
  const buckets = Array.from({ length: bins }, () => ({
    n: 0,
    k: 0,
  }));
  for (const t of trials || []) {
    const b = phaseBin(Number(t?.hold_duration_ms), 1000 / 60, bins);
    const r = Number(t?.[rightField]) === 1 ? 1 : 0;
    if (b == null) continue;
    buckets[b].n += 1;
    buckets[b].k += r;
  }
  return buckets.map((b, i) => ({
    label: `φ${i + 1}`,
    value: b.n ? (100 * b.k) / b.n : 0,
    n: b.n,
  }));
}

// ---------- tiny UI bits (self-contained, no chart libs) ----------
function PBadge({ label, p }) {
  const txt = p == null ? '—' : p < 0.0001 ? '< 1e-4' : p.toFixed(4);
  const shade = p < 0.05 ? '#186a3b' : '#666';
  return (
    <span
      style={{
        display: 'inline-flex',
        gap: 6,
        alignItems: 'center',
        border: '1px solid #ddd',
        borderRadius: 999,
        padding: '3px 8px',
        fontSize: 12,
        color: shade,
      }}
    >
      <strong>{label}</strong> p={txt}
    </span>
  );
}

function BarPair({ aLabel = 'Subject', a, bLabel = 'Demon', b }) {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <Bar label={aLabel} value={a} />
      <Bar label={bLabel} value={b} />
    </div>
  );
}
function Bar({ label, value }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 12,
          marginBottom: 2,
        }}
      >
        <span>{label}</span>
        <span>{v.toFixed(1)}%</span>
      </div>
      <div
        style={{
          height: 10,
          background: '#eee',
          borderRadius: 6,
          overflow: 'hidden',
        }}
      >
        <div style={{ width: `${v}%`, height: '100%' }} />
      </div>
    </div>
  );
}

// ---------- main panel ----------
export default function TimingArmsPanel({ trials }) {
  const tAll = Array.isArray(trials) ? trials : [];

  // group by arm
  const perArm = Object.fromEntries(
    ARMS.map((a) => [a, byArm(tAll, a)])
  );
  const perArmReport = Object.fromEntries(
    ARMS.map((a) => [a, quickTrialReport(perArm[a])])
  );

  const abVsOpen = {
    scramble: armAB(perArm.scramble, perArm.open),
    synced: armAB(perArm.synced, perArm.open),
    blind: armAB(perArm.blind, perArm.open),
  };

  const robotAll = byAgent(tAll, true);
  const humanAll = byAgent(tAll, false);
  const robotVsHumanAll = armAB(robotAll, humanAll);

  const robotVsHumanByArm = Object.fromEntries(
    ARMS.map((a) => {
      const r = armAB(
        byAgent(perArm[a], true),
        byAgent(perArm[a], false)
      );
      return [a, r];
    })
  );

  // synced phase chart
  const syncedPhase = computePhaseReport(
    perArm.synced,
    'primary_is_right',
    12
  );

  return (
    <section style={{ marginTop: 24 }}>
      <h2 style={{ margin: '0 0 8px' }}>
        Timing arms — effects & diagnostics
      </h2>

      {/* Per-arm accuracy */}
      {ARMS.map((a) => {
        const rep = perArmReport[a];
        if (!rep?.n) return null;
        return (
          <div
            key={a}
            style={{
              margin: '14px 0',
              padding: '10px 12px',
              border: '1px solid #eee',
              borderRadius: 8,
            }}
          >
            <h3 style={{ margin: '0 0 6px' }}>
              {a} · n={rep.n}
            </h3>
            <BarPair a={rep.pctSubj} b={rep.pctGhost} />
            <div
              style={{
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
                marginTop: 8,
              }}
            >
              <PBadge
                label="Subject vs Demon"
                p={rep.tests.subjVsGhost}
              />
              <PBadge
                label="n10 vs n01 symmetry"
                p={rep.tests.symmetry}
              />
            </div>
          </div>
        );
      })}

      {/* Arm A/B vs OPEN */}
      <div style={{ marginTop: 16 }}>
        <h3 style={{ margin: '0 0 6px' }}>A/B vs OPEN</h3>
        {['scramble', 'synced', 'blind'].map((a) => {
          const ab = abVsOpen[a];
          if (!ab?.sizes?.a && !ab?.sizes?.b) return null;
          return (
            <div key={a} style={{ margin: '8px 0' }}>
              <strong>{a} vs open</strong>{' '}
              <span style={{ color: '#666', fontSize: 12 }}>
                (n={ab?.sizes?.a || 0} vs {ab?.sizes?.b || 0})
              </span>
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  flexWrap: 'wrap',
                  marginTop: 6,
                }}
              >
                <PBadge label="Subject rate" p={ab.pSubj} />
                <PBadge label="Demon rate" p={ab.pDem} />
                <PBadge label="Δ diff-of-diff" p={ab.pDiffDiff} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Robot vs Human */}
      <div style={{ marginTop: 16 }}>
        <h3 style={{ margin: '0 0 6px' }}>Robot vs Human</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <PBadge
            label="All arms — Subject"
            p={robotVsHumanAll.pSubj}
          />
          <PBadge label="All arms — Demon" p={robotVsHumanAll.pDem} />
          <PBadge
            label="All arms — Δ diff-of-diff"
            p={robotVsHumanAll.pDiffDiff}
          />
        </div>
        <div style={{ marginTop: 8 }}>
          {ARMS.map((a) => {
            const ab = robotVsHumanByArm[a];
            return (
              <div key={a} style={{ margin: '4px 0' }}>
                <em>{a}</em>{' '}
                <span style={{ marginLeft: 8 }}>
                  <PBadge label="Subject" p={ab.pSubj} />{' '}
                  <PBadge label="Demon" p={ab.pDem} />{' '}
                  <PBadge label="Δ diff-of-diff" p={ab.pDiffDiff} />
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Synced phase bins */}
      {syncedPhase?.reduce((s, b) => s + b.n, 0) > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ margin: '0 0 6px' }}>
            Synced arm — % RIGHT by 60 Hz phase bin
          </h3>
          <div style={{ display: 'grid', gap: 6 }}>
            {syncedPhase.map((b, i) => (
              <div key={i}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 12,
                  }}
                >
                  <span>
                    {b.label} (n={b.n})
                  </span>
                  <span>{b.value.toFixed(1)}%</span>
                </div>
                <div
                  style={{
                    height: 8,
                    background: '#eee',
                    borderRadius: 6,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${Math.max(
                        0,
                        Math.min(100, b.value)
                      )}%`,
                      height: '100%',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <p style={{ color: '#666', fontSize: 12, marginTop: 6 }}>
            Flat ≈ no phase effect; ripples can indicate alignment
            with the 60 Hz sampling grid.
          </p>
        </div>
      )}
    </section>
  );
}
