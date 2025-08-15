import React, { useEffect, useState, useMemo } from 'react';
import { db, auth, signInWithEmailPassword } from './firebase';
import {
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  startAfter,
  doc,
  getDoc,
  updateDoc,
} from 'firebase/firestore';
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import TimingArmsPanel from './TimingArmsPanel';
/* ---------------- tiny chart helpers (no libs) ---------------- */
function PBadge({ label, p }) {
  let tone = '#888';
  if (p < 0.001) tone = '#8b0000';
  else if (p < 0.01) tone = '#c0392b';
  else if (p < 0.05) tone = '#e67e22';
  else tone = '#2e8b57';
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        marginRight: 12,
      }}
    >
      <span style={{ minWidth: 210 }}>{label}</span>
      <span
        style={{
          padding: '4px 8px',
          borderRadius: 6,
          background: tone,
          color: '#fff',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        p = {Number.isFinite(p) ? p.toExponential(2) : '—'}
      </span>
    </div>
  );
}
function BoostScatter({
  points,
  width = 520,
  height = 240,
  title = 'PRNG — Boost vs Base%',
}) {
  if (!points || points.length === 0) return null;

  // axes
  const padL = 40,
    padB = 30,
    padR = 10,
    padT = 20;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const xMin = 0,
    xMax = 100; // base % always clamped 0–100
  const yMin = Math.min(0, ...points.map((p) => p.boost));
  const yMax = Math.max(0, ...points.map((p) => p.boost));
  const xTo = (x) => padL + ((x - xMin) / (xMax - xMin)) * plotW;
  const yTo = (y) =>
    padT + (1 - (y - yMin) / (yMax - yMin || 1)) * plotH;

  // simple grid ticks
  const xTicks = [0, 20, 40, 60, 80, 100];
  const yStep = Math.max(1, Math.ceil((yMax - yMin) / 6));
  const yTicks = [];
  for (let v = Math.floor(yMin); v <= Math.ceil(yMax); v += yStep)
    yTicks.push(v);

  return (
    <div style={{ margin: '8px 0 16px' }}>
      <h3 style={{ margin: '8px 0' }}>{title}</h3>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={title}
      >
        {/* axes */}
        <line
          x1={padL}
          y1={padT}
          x2={padL}
          y2={padT + plotH}
          stroke="#ccc"
        />
        <line
          x1={padL}
          y1={padT + plotH}
          x2={padL + plotW}
          y2={padT + plotH}
          stroke="#ccc"
        />

        {/* grid + labels */}
        {xTicks.map((t) => (
          <g key={'x' + t}>
            <line
              x1={xTo(t)}
              x2={xTo(t)}
              y1={padT}
              y2={padT + plotH}
              stroke="#f1f1f1"
            />
            <text
              x={xTo(t)}
              y={padT + plotH + 16}
              fontSize="10"
              textAnchor="middle"
            >
              {t}
            </text>
          </g>
        ))}
        {yTicks.map((t) => (
          <g key={'y' + t}>
            <line
              x1={padL}
              x2={padL + plotW}
              y1={yTo(t)}
              y2={yTo(t)}
              stroke="#f1f1f1"
            />
            <text
              x={padL - 6}
              y={yTo(t) + 3}
              fontSize="10"
              textAnchor="end"
            >
              {t}
            </text>
          </g>
        ))}

        {/* axis titles */}
        <text
          x={padL + plotW / 2}
          y={height - 4}
          fontSize="11"
          textAnchor="middle"
        >
          Base (unboosted) %
        </text>
        <text
          transform={`translate(12, ${padT + plotH / 2}) rotate(-90)`}
          fontSize="11"
          textAnchor="middle"
        >
          Boost amount (points)
        </text>

        {/* zero line for Y=0 */}
        {yMin < 0 && yMax > 0 && (
          <line
            x1={padL}
            x2={padL + plotW}
            y1={yTo(0)}
            y2={yTo(0)}
            stroke="#ddd"
          />
        )}

        {/* points */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={xTo(p.base)}
            cy={yTo(p.boost)}
            r={3}
            // color: boosted vs not (keeps B/W-ish theme)
            fill={p.boosted ? '#333' : '#aaa'}
            opacity="0.9"
          >
            <title>{`base ${p.base.toFixed(1)} → +${
              p.boost
            } = ${p.displayed.toFixed(1)}${
              p.boosted ? ' (boosted)' : ''
            }`}</title>
          </circle>
        ))}
      </svg>
      <div style={{ fontSize: 12, color: '#666', marginTop: 6 }}>
        Each dot = one session’s baseline block (last trial row). Dark
        = boosted, light = not boosted.
      </div>
    </div>
  );
}

function BarChart({ data, width = 520, height = 180, title = '' }) {
  const max = 100;
  const pad = 24;
  const barW = (width - pad * 2) / data.length - 20;
  const baselineY = height - pad;
  return (
    <div style={{ margin: '8px 0 16px' }}>
      {title && <h3 style={{ margin: '8px 0' }}>{title}</h3>}
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={title}
      >
        {[0, 25, 50, 75, 100].map((tick) => {
          const y = baselineY - (tick / max) * (height - pad * 2);
          return (
            <g key={tick}>
              <line
                x1={pad}
                x2={width - pad}
                y1={y}
                y2={y}
                stroke="#eee"
              />
              <text x={8} y={y + 4} fontSize="10" fill="#666">
                {tick}%
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const h = (d.value / max) * (height - pad * 2);
          const x = pad + i * ((width - pad * 2) / data.length) + 10;
          const y = baselineY - h;
          return (
            <g key={d.label}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={h}
                rx="4"
                ry="4"
              />
              <text
                x={x + barW / 2}
                y={baselineY + 14}
                fontSize="12"
                textAnchor="middle"
              >
                {d.label}
              </text>
              <text
                x={x + barW / 2}
                y={y - 6}
                fontSize="12"
                textAnchor="middle"
                fill="#333"
              >
                {d.value.toFixed(1)}%
              </text>
            </g>
          );
        })}
        {data.length === 2 && (
          <text x={width - 120} y={20} fontSize="12" fill="#333">
            Δ = {(data[0].value - data[1].value).toFixed(1)}%
          </text>
        )}
      </svg>
    </div>
  );
}

function MiniBars({ pctPrimary, pctGhost }) {
  const rowW = 180,
    rowH = 10;
  const wP = Math.max(0, Math.min(100, pctPrimary ?? 0));
  const wG = Math.max(0, Math.min(100, pctGhost ?? 0));
  return (
    <svg width={rowW} height={rowH}>
      <rect
        x="0"
        y="0"
        width={(rowW * wG) / 100}
        height={rowH}
        opacity="0.35"
      />
      <rect x="0" y="0" width={(rowW * wP) / 100} height={rowH} />
    </svg>
  );
}

/* ==== NEW: tiny helpers for hold charts ==== */
function RBadge({ label, r }) {
  const tone = '#555';
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        marginRight: 12,
      }}
    >
      <span style={{ minWidth: 210 }}>{label}</span>
      <span
        style={{
          padding: '4px 8px',
          borderRadius: 6,
          background: tone,
          color: '#fff',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        r = {Number.isFinite(r) ? r.toFixed(3) : '—'}
      </span>
    </div>
  );
}

function HoldQuartileChart({ title, holdReport }) {
  if (!holdReport) return null;
  const data = (holdReport.quartiles || []).map((q) => ({
    label: q.label,
    value: q.pct ?? 0,
  }));
  return (
    <div>
      <BarChart title={title} data={data} />
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <PBadge
          label="Hi vs Lo (Q4 vs Q1) — two-prop"
          p={holdReport.hiVsLo?.p ?? NaN}
        />
        <RBadge
          label="Pearson r (ms ↔ right)"
          r={holdReport.pearson}
        />
        <div
          style={{
            padding: '6px 10px',
            border: '1px solid #eee',
            borderRadius: 6,
            background: '#fafafa',
            fontSize: 12,
          }}
          title="Quartile cutoffs for hold_duration_ms"
        >
          n={holdReport.nTrials} &nbsp;|&nbsp; cutoffs ms:&nbsp; Q1≤
          {Math.round(holdReport.qCutoffsMs.q1)},&nbsp; Q2≤
          {Math.round(holdReport.qCutoffsMs.q2)},&nbsp; Q3≤
          {Math.round(holdReport.qCutoffsMs.q3)}
        </div>
      </div>
    </div>
  );
}

/* ---------------- small math helpers ---------------- */
function pearsonR(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  let sx = 0,
    sy = 0,
    sxx = 0,
    syy = 0,
    sxy = 0,
    k = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i],
      y = ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
    k++;
  }
  if (k < 3) return null;
  const cov = sxy - (sx * sy) / k;
  const vx = sxx - (sx * sx) / k;
  const vy = syy - (sy * sy) / k;
  const denom = Math.sqrt(vx * vy);
  return denom ? cov / denom : null;
}

function erfApprox(z) {
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
const normalCdf = (z) => 0.5 * (1 + erfApprox(z / Math.SQRT2));
const twoSidedP = (z) => {
  const pOne = 1 - normalCdf(Math.abs(z));
  return Math.max(0, Math.min(1, 2 * pOne));
};
const binomZAgainstHalf = (k, n) =>
  n ? (k - n * 0.5) / Math.sqrt(n * 0.25) : 0;
const twoPropZ = (k1, n1, k2, n2) => {
  const pPool = (k1 + k2) / (n1 + n2);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / n1 + 1 / n2));
  return se ? (k1 / n1 - k2 / n2) / se : 0;
};
const twoSidedP_fromCounts = (k1, n1, k2, n2) =>
  twoSidedP(twoPropZ(k1, n1, k2, n2));

/* ==== NEW: lightweight t-tests (p-values via normal approx) ==== */
function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}
function variance(arr, m) {
  if (arr.length < 2) return 0;
  let s = 0;
  for (const x of arr) {
    const d = x - m;
    s += d * d;
  }
  return s / (arr.length - 1);
}
function tTwoSidedP_fromNormalApprox(t, df) {
  const z = Math.abs(t);
  return Math.max(0, Math.min(1, 2 * (1 - normalCdf(z))));
}

/* ---------------- general stats over sessions (pooled) ---------------- */
/* ---------------- general stats over sessions (pooled) ---------------- */
function computeStats(sessions, getTrials, sessionFilter) {
  const per = [];
  let n10sum = 0,
    n01sum = 0,
    Ntot = 0,
    Kp = 0,
    Kg = 0;

  for (const [idx, doc] of sessions.entries()) {
    if (sessionFilter && !sessionFilter(doc)) continue;
    const trials = Array.isArray(getTrials(doc))
      ? getTrials(doc)
      : [];
    const N = trials.length;
    if (!N) continue;

    let hp = 0,
      hg = 0,
      altOK = true,
      qrngOK = true,
      lastPos = null;
    let n10 = 0,
      n01 = 0;

    for (let i = 0; i < N; i++) {
      const t = trials[i] || {};
      const p = Number(t.primary_is_right) === 1 ? 1 : 0;
      const g = Number(t.ghost_is_right) === 1 ? 1 : 0;
      hp += p;
      hg += g;

      if (p === 1 && g === 0) n10++;
      if (p === 0 && g === 1) n01++;

      const pos = t.primary_pos;
      if (pos !== 1 && pos !== 2) altOK = false;
      if (lastPos != null && pos === lastPos) altOK = false;
      lastPos = pos;

      const qc = t.qrng_code;
      if (qc != null && qc !== 1 && qc !== 2) qrngOK = false;
    }

    const pctP = (100 * hp) / N;
    const pctG = (100 * hg) / N;

    per.push({
      session_id: doc.session_id || `row_${idx}`,
      N,
      hitsPrimary: hp,
      hitsGhost: hg,
      pctPrimary: pctP,
      pctGhost: pctG,
      delta: pctP - pctG,
      n10,
      n01,
      alternatingOK: altOK,
      qrngOK,
      warnings: [],
    });

    n10sum += n10;
    n01sum += n01;
    Ntot += N;
    Kp += hp;
    Kg += hg;
  }

  const pctPooledP = Ntot ? (100 * Kp) / Ntot : null;
  const pctPooledG = Ntot ? (100 * Kg) / Ntot : null;
  const deltaTot =
    pctPooledP != null && pctPooledG != null
      ? pctPooledP - pctPooledG
      : null;

  const zGhost = binomZAgainstHalf(Kg, Ntot);
  const pGhost = twoSidedP(zGhost);
  const zPrimary50 = binomZAgainstHalf(Kp, Ntot);
  const pPrimary50 = twoSidedP(zPrimary50);

  const zPP = twoPropZ(Kp, Ntot, Kg, Ntot);
  const pPP = twoSidedP(zPP);
  const mismatches = n10sum + n01sum;
  const zSym = mismatches
    ? (n10sum - mismatches / 2) / Math.sqrt(mismatches / 4)
    : 0;
  const pSym = twoSidedP(zSym);

  // aggregate warnings from per-rows
  const warnings = per
    .filter((r) => !r.alternatingOK || !r.qrngOK)
    .map((r) => ({
      session: r.session_id ?? 'unknown',
      warnings: [
        ...(!r.alternatingOK
          ? ['primary_pos alternation broken']
          : []),
        ...(!r.qrngOK ? ['qrng_code invalid values'] : []),
      ],
    }));

  return {
    per,
    totals: {
      trials: Ntot,
      primaryRight: Kp,
      ghostRight: Kg,
      pctPrimary: pctPooledP,
      pctGhost: pctPooledG,
      deltaPct: deltaTot,
    },
    tests: {
      rngBiasGhost: { z: zGhost, p: pGhost },
      primaryVs50: { z: zPrimary50, p: pPrimary50 },
      primaryVsGhost: { z: zPP, p: pPP },
      symmetryN10vsN01: {
        z: zSym,
        p: pSym,
        n10: n10sum,
        n01: n01sum,
      },
      _mode: 'pooled',
    },
    warnings,
  };
}

/* ==== NEW: session-weighted stats + t-tests (FIRST session per participant) ==== */
function computeStatsSessionWeighted(
  sessions,
  getTrials,
  sessionFilter
) {
  // Build map of earliest (first) session per participant
  const firstByPerson = new Map();
  const toTime = (d) => {
    const t =
      d?.timestamp ??
      d?.created_at ??
      d?.server_time ??
      d?.started_at ??
      d?.session_start ??
      null;
    if (typeof t === 'number') return t;
    if (typeof t === 'string') {
      const p = Date.parse(t);
      return Number.isFinite(p) ? p : null;
    }
    // Firestore Timestamp?
    if (t && typeof t.toDate === 'function') return +t.toDate();
    return null;
  };

  for (const doc of sessions) {
    if (sessionFilter && !sessionFilter(doc)) continue;
    const trials = Array.isArray(getTrials(doc))
      ? getTrials(doc)
      : [];
    if (!trials.length) continue;
    const pid = doc?.participant_id ?? doc?.uid ?? 'UNKNOWN';

    const prev = firstByPerson.get(pid);
    if (!prev) {
      firstByPerson.set(pid, doc);
      continue;
    }
    const tPrev = toTime(prev);
    const tCurr = toTime(doc);
    if (tPrev == null || tCurr == null) continue;
    if (tCurr < tPrev) firstByPerson.set(pid, doc);
  }

  // Per-participant rows (using FIRST session only)
  const per = [];
  let n10sum = 0,
    n01sum = 0,
    totalTrials = 0,
    totalPrimaryHits = 0,
    totalGhostHits = 0;

  for (const [pid, doc] of firstByPerson.entries()) {
    const trials = Array.isArray(getTrials(doc))
      ? getTrials(doc)
      : [];
    const N = trials.length;
    if (!N) continue;

    let hp = 0,
      hg = 0,
      altOK = true,
      qrngOK = true,
      lastPos = null;
    let n10 = 0,
      n01 = 0;

    for (let i = 0; i < N; i++) {
      const t = trials[i] || {};
      const p = Number(t.primary_is_right) === 1 ? 1 : 0;
      const g = Number(t.ghost_is_right) === 1 ? 1 : 0;
      hp += p;
      hg += g;
      if (p === 1 && g === 0) n10++;
      if (p === 0 && g === 1) n01++;
      const pos = t.primary_pos;
      if (pos !== 1 && pos !== 2) altOK = false;
      if (lastPos != null && pos === lastPos) altOK = false;
      lastPos = pos;
      const qc = t.qrng_code;
      if (qc != null && qc !== 1 && qc !== 2) qrngOK = false;
    }

    const pctP = (100 * hp) / N;
    const pctG = (100 * hg) / N;

    per.push({
      participant_id: pid,
      N,
      hitsPrimary: hp,
      hitsGhost: hg,
      pctPrimary: pctP,
      pctGhost: pctG,
      delta: pctP - pctG,
      n10,
      n01,
      alternatingOK: altOK,
      qrngOK,
      warnings: [],
    });

    n10sum += n10;
    n01sum += n01;
    totalTrials += N;
    totalPrimaryHits += hp;
    totalGhostHits += hg;
  }

  // Arrays for t-approx across persons
  const pctPrimaryArr = per.map((r) => r.pctPrimary);
  const pctGhostArr = per.map((r) => r.pctGhost);
  const deltaArr = per.map((r) => r.delta);
  const n = per.length;

  const meanP = mean(pctPrimaryArr);
  const meanG = mean(pctGhostArr);
  const meanDelta = mean(deltaArr);

  const dMean = meanDelta;
  const dVar = variance(deltaArr, dMean);
  const dSE = n > 1 ? Math.sqrt(dVar / n) : 0;
  const tPaired = dSE ? dMean / dSE : 0;
  const pPaired = tTwoSidedP_fromNormalApprox(
    tPaired,
    Math.max(1, n - 1)
  );

  const gVar = variance(pctGhostArr, meanG);
  const gSE = n > 1 ? Math.sqrt(gVar / n) : 0;
  const tGhostVs50 = gSE ? (meanG - 50) / gSE : 0;
  const pGhostVs50 = tTwoSidedP_fromNormalApprox(
    tGhostVs50,
    Math.max(1, n - 1)
  );

  const pVar = variance(pctPrimaryArr, meanP);
  const pSE = n > 1 ? Math.sqrt(pVar / n) : 0;
  const tPrimaryVs50 = pSE ? (meanP - 50) / pSE : 0;
  const pPrimaryVs50 = tTwoSidedP_fromNormalApprox(
    tPrimaryVs50,
    Math.max(1, n - 1)
  );

  const mismatches = n10sum + n01sum;
  const zSym = mismatches
    ? (n10sum - mismatches / 2) / Math.sqrt(mismatches / 4)
    : 0;
  const pSym = twoSidedP(zSym);

  // aggregate warnings from per-rows
  const warnings = per
    .filter((r) => !r.alternatingOK || !r.qrngOK)
    .map((r) => ({
      session: r.participant_id ?? 'unknown',
      warnings: [
        ...(!r.alternatingOK
          ? ['primary_pos alternation broken']
          : []),
        ...(!r.qrngOK ? ['qrng_code invalid values'] : []),
      ],
    }));

  return {
    per,
    totals: {
      trials: totalTrials,
      primaryRight: totalPrimaryHits,
      ghostRight: totalGhostHits,
      pctPrimary: meanP,
      pctGhost: meanG,
      deltaPct: meanDelta,
    },
    tests: {
      rngBiasGhost: {
        t: tGhostVs50,
        p: pGhostVs50,
        df: Math.max(1, n - 1),
        type: 'one-sample t (approx)',
      },
      primaryVs50: {
        t: tPrimaryVs50,
        p: pPrimaryVs50,
        df: Math.max(1, n - 1),
        type: 'one-sample t (approx)',
      },
      primaryVsGhost: {
        t: tPaired,
        p: pPaired,
        df: Math.max(1, n - 1),
        type: 'paired t (approx)',
      },
      symmetryN10vsN01: {
        z: zSym,
        p: pSym,
        n10: n10sum,
        n01: n01sum,
      },
      _mode: 'sessionWeighted',
    },
    warnings,
  };
}

/* ---------------- priming A/B p-values + new diff-of-diff ---------------- */
function primingABPvals(qrngPrimedReport, qrngUnprimedReport) {
  if (!qrngPrimedReport || !qrngUnprimedReport) return null;

  const k1P = qrngPrimedReport.totals.primaryRight;
  const n1 = qrngPrimedReport.totals.trials;
  const k1G = qrngPrimedReport.totals.ghostRight;

  const k0P = qrngUnprimedReport.totals.primaryRight;
  const n0 = qrngUnprimedReport.totals.trials;
  const k0G = qrngUnprimedReport.totals.ghostRight;

  // A/B on rates
  const primaryRateP = twoSidedP_fromCounts(k1P, n1, k0P, n0);
  const ghostRateP = twoSidedP_fromCounts(k1G, n1, k0G, n0);

  // Difference-in-differences
  const deltaPrimed = k1P / n1 - k1G / n1;
  const deltaUnprimed = k0P / n0 - k0G / n0;
  const diffDiff = deltaPrimed - deltaUnprimed;

  const pPool = (k1P - k1G + (k0P - k0G)) / (n1 + n0);
  const seDiffDiff = Math.sqrt(
    pPool * (1 - pPool) * (1 / n1 + 1 / n0)
  );
  const zDiffDiff = seDiffDiff ? diffDiff / seDiffDiff : 0;
  const pDiffDiff = twoSidedP(zDiffDiff);

  return {
    primaryRate: { p: primaryRateP },
    ghostRate: { p: ghostRateP },
    diffOfDiff: {
      p: pDiffDiff,
      deltaPrimed,
      deltaUnprimed,
      diffDiff,
    },
  };
}

/* ---------------- Diagnostics helpers ---------------- */
function breakdownBy(trials, key, rightField) {
  const map = new Map();
  for (const t of trials) {
    if (!t) continue;
    const k = t[key];
    const r = Number(t[rightField]) === 1 ? 1 : 0;
    if (!map.has(k)) map.set(k, { n: 0, hits: 0 });
    const row = map.get(k);
    row.n += 1;
    row.hits += r;
  }
  return Array.from(map.entries()).map(([k, { n, hits }]) => ({
    key: String(k),
    n,
    pct: n ? (100 * hits) / n : null,
  }));
}
function parityPct(trials, rawField) {
  let n = 0,
    odd = 0;
  for (const t of trials) {
    const b = t?.[rawField];
    if (typeof b === 'number') {
      n += 1;
      if ((b & 1) === 1) odd += 1;
    }
  }
  return { n, pctOdd: n ? (100 * odd) / n : null };
}
/* ==== NEW: hold-duration vs accuracy helpers ==== */
function quantile(sortedNums, q) {
  if (!sortedNums.length) return null;
  const pos = (sortedNums.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sortedNums[base + 1] !== undefined) {
    return (
      sortedNums[base] +
      rest * (sortedNums[base + 1] - sortedNums[base])
    );
  } else {
    return sortedNums[base];
  }
}

// Simple Pearson r on raw arrays (0/1 right vs ms)
function pearsonR_num(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  let sx = 0,
    sy = 0,
    sxx = 0,
    syy = 0,
    sxy = 0,
    k = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i],
      y = ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
    k++;
  }
  if (k < 3) return null;
  const cov = sxy - (sx * sy) / k;
  const vx = sxx - (sx * sx) / k;
  const vy = syy - (sy * sy) / k;
  const denom = Math.sqrt(vx * vy);
  return denom ? cov / denom : null;
}

function computeHoldReport(
  trials,
  {
    holdField = 'hold_duration_ms',
    rightField = 'primary_is_right',
  } = {}
) {
  const rows = [];
  for (const t of trials || []) {
    const ms = Number(t?.[holdField]);
    const right = Number(t?.[rightField]) === 1 ? 1 : 0;
    if (Number.isFinite(ms) && (right === 0 || right === 1)) {
      rows.push({ ms, right });
    }
  }
  if (rows.length < 20) return null; // need some data

  // Quartile cutoffs
  const holdsSorted = rows.map((r) => r.ms).sort((a, b) => a - b);
  const q1 = quantile(holdsSorted, 0.25);
  const q2 = quantile(holdsSorted, 0.5);
  const q3 = quantile(holdsSorted, 0.75);

  const bins = [
    { label: 'Q1 (fastest)', hits: 0, n: 0, pred: (ms) => ms <= q1 },
    { label: 'Q2', hits: 0, n: 0, pred: (ms) => ms > q1 && ms <= q2 },
    { label: 'Q3', hits: 0, n: 0, pred: (ms) => ms > q2 && ms <= q3 },
    { label: 'Q4 (slowest)', hits: 0, n: 0, pred: (ms) => ms > q3 },
  ];
  for (const r of rows) {
    for (const b of bins)
      if (b.pred(r.ms)) {
        b.n++;
        b.hits += r.right;
        break;
      }
  }
  const quartiles = bins.map((b) => ({
    label: b.label,
    n: b.n,
    pct: b.n ? (100 * b.hits) / b.n : null,
  }));

  // Hi vs Lo (top vs bottom quartile), 2-prop test
  const hi = bins[3]; // Q4
  const lo = bins[0]; // Q1
  const pHiLo = twoSidedP_fromCounts(hi.hits, hi.n, lo.hits, lo.n);

  // Pearson r between ms and right (0/1)
  const xs = rows.map((r) => r.ms);
  const ys = rows.map((r) => r.right);
  const r = pearsonR_num(xs, ys);

  return {
    quartiles,
    hiVsLo: {
      kHi: hi.hits,
      nHi: hi.n,
      kLo: lo.hits,
      nLo: lo.n,
      p: pHiLo,
    },
    pearson: r,
    nTrials: rows.length,
    qCutoffsMs: { q1, q2, q3 },
  };
}

/* ==== NEW: early-exit helpers ==== */
const getBaselineTrials = (doc) =>
  (doc?.full_stack?.trialResults || []).length;
const getQuantumTrials = (doc) =>
  (doc?.spoon_love?.trialResults || []).length;
const COMPLETER_BASELINE_MIN = 20;
const COMPLETER_QUANTUM_MIN = 50;

function isCompleter(doc) {
  return (
    getBaselineTrials(doc) >= COMPLETER_BASELINE_MIN &&
    getQuantumTrials(doc) >= COMPLETER_QUANTUM_MIN
  );
}

// Try common places to find an exit reason, normalize to short labels
function getExitReasonRaw(doc) {
  return (
    doc?.exit_reason ??
    doc?.exitReason ??
    doc?.exit?.reason ??
    doc?.meta?.exit_reason ??
    doc?.meta?.exitReason ??
    doc?.survey?.exit_reason ??
    doc?.assignment?.exit_reason ??
    doc?.assignment?.exitReason ??
    null
  );
}
function normalizeExitReason(reason) {
  if (!reason) return null;
  const s = String(reason).trim().toLowerCase();
  if (!s) return null;
  if (s.includes('timeout') || s.includes('time out'))
    return 'timeout';
  if (s.includes('broke') || s.includes('bug') || s.includes('error'))
    return 'technical';
  if (
    s.includes('no consent') ||
    s.includes('decline') ||
    s.includes('consent')
  )
    return 'no consent';
  if (s.includes('attention') || s.includes('check'))
    return 'attention check fail';
  if (s.includes('quit') || s.includes('exit') || s.includes('left'))
    return 'quit';
  if (s.includes('mobile') || s.includes('device')) return 'device';
  if (s.includes('duplicate') || s.includes('repeat'))
    return 'duplicate';
  return s.length > 40 ? s.slice(0, 40) + '…' : s;
}

/* ---------------------- COMPONENT ---------------------- */
export default function QAExport() {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [reportPRNGPrimed, setReportPRNGPrimed] = useState(null);
  const [reportPRNGUnprimed, setReportPRNGUnprimed] = useState(null);
  const [reportQRNG, setReportQRNG] = useState(null); // Spoon Love (all)
  const [reportQRNGPrimed, setReportQRNGPrimed] = useState(null); // primed
  const [reportQRNGUnprimed, setReportQRNGUnprimed] = useState(null); // unprimed
  const [abPvals, setAbPvals] = useState(null);
  const [abPvalsPRNG, setAbPvalsPRNG] = useState(null);
  const [boostPoints, setBoostPoints] = useState([]);
  const [error, setError] = useState('');
  const [authed, setAuthed] = useState(false);
  const [uid, setUid] = useState('');
  const [qaStatus, setQaStatus] = useState(null);
  const [toggling, setToggling] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [qaDebug, setQaDebug] = useState(null);

  /* ==== NEW: mode/summary state ==== */
  const [mode, setMode] = useState('pooled'); // 'pooled' | 'completers' | 'sessionWeighted'
  const [summary, setSummary] = useState({
    total: 0,
    completers: 0,
    nonCompleters: 0,
    exitBreakdown: [],
  });
  // Hold-duration analyses (QRNG): { primary, ghost }
  const [holdQRNG, setHoldQRNG] = useState({
    primary: null,
    ghost: null,
  });

  // 🔐 Sign in anonymously
  useEffect(() => {
    setError('');
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        setAuthed(true);
        setUid(user.uid);
      } else {
        signInAnonymously(auth).catch((err) => {
          console.error(err);
          setError(
            'Anonymous sign-in failed: ' + (err?.message || err)
          );
        });
      }
    });
    return () => unsub();
  }, []);
  // 🔑 Sign in with Email/Password (prompts), then refresh QA status and data
  const handleEmailSignIn = async () => {
    try {
      const e = window.prompt('Enter email for QA access:');
      if (!e) return;
      const p = window.prompt('Enter password:');
      if (p == null) return;
      const user = await signInWithEmailPassword(e, p);
      setUid(user.uid);
      setEmail(user.email || '');
      setDisplayName(user.displayName || '');
      setError('');
      // Refresh QA banner and data (if your email is allowed in admin/qa.emails)
      await reloadQaStatus();
      await fetchAll();
    } catch (err) {
      console.error(err);
      setError('Email sign-in failed: ' + (err?.message || err));
    }
  };
  // 🧪 QA debug: read admin/qa and show why access passes/fails
  const runQaDebug = async () => {
    try {
      const u = auth.currentUser;
      const qaRef = doc(db, 'admin', 'qa');
      const snap = await getDoc(qaRef);
      if (!snap.exists()) {
        setQaDebug({
          ok: false,
          reason: 'admin/qa document not found',
          user: u ? { uid: u.uid, email: u.email || null } : null,
          qa: null,
        });
        return;
      }
      const qa = snap.data();
      const now = Date.now();
      const untilMs = qa?.until?.toDate
        ? qa.until.toDate().getTime()
        : null;
      const untilOk = !untilMs || untilMs > now;

      const uidAllowed =
        Array.isArray(qa?.uids) && u?.uid
          ? qa.uids.includes(u.uid)
          : false;
      const emailAllowed =
        Array.isArray(qa?.emails) && u?.email
          ? qa.emails.includes(u.email)
          : false;

      const ok =
        !!qa?.enabled && untilOk && (uidAllowed || emailAllowed);

      setQaDebug({
        ok,
        reason: ok
          ? 'QA gate PASSED'
          : !qa?.enabled
          ? 'QA disabled (admin/qa.enabled == false)'
          : !untilOk
          ? 'QA expired (admin/qa.until is in the past)'
          : uidAllowed || emailAllowed
          ? 'Unknown – should be OK'
          : u?.email
          ? `Your email ${u.email} is not in admin/qa.emails`
          : u?.uid
          ? `Your UID ${u.uid} is not in admin/qa.uids and no email present`
          : 'Not signed in',
        user: u ? { uid: u.uid, email: u.email || null } : null,
        qa: {
          enabled: !!qa?.enabled,
          uids: qa?.uids || [],
          emails: qa?.emails || [],
          until: qa?.until || null,
          untilOk,
        },
        hint: 'Ensure admin/qa.enabled=true, add your exact email to admin/qa.emails (array), and remove/extend until. Then reload and sign in again.',
      });
    } catch (e) {
      setQaDebug({
        ok: false,
        reason: 'Error reading admin/qa: ' + (e?.message || e),
        user: auth.currentUser
          ? {
              uid: auth.currentUser.uid,
              email: auth.currentUser.email || null,
            }
          : null,
        qa: null,
      });
    }
  };

  // 📥 Fetch QA status doc
  const reloadQaStatus = async () => {
    try {
      const qaRef = doc(db, 'admin', 'qa');
      const snap = await getDoc(qaRef);
      if (snap.exists()) {
        setQaStatus(snap.data());
      } else {
        setQaStatus({ enabled: false });
      }
    } catch (err) {
      console.error('Error fetching QA status:', err);
      setQaStatus({ enabled: false, error: err.message });
    }
  };

  // 🔀 Toggle QA enabled (requires rules allowing your UID)
  const toggleQA = async () => {
    if (!qaStatus) return;
    if (!authed) {
      setError('Not signed in yet. Try again in a moment.');
      return;
    }
    try {
      setToggling(true);
      const qaRef = doc(db, 'admin', 'qa');
      await updateDoc(qaRef, { enabled: !qaStatus.enabled });
      await reloadQaStatus();
      setError('');
    } catch (err) {
      console.error('Error toggling QA:', err);
      setError(
        `Toggle failed: ${err?.code || ''} ${err?.message || err}. ` +
          `If this says permission-denied, confirm your rules allow email admins to update admin/qa ` +
          `and that your email is in admin/qa.emails.`
      );
    } finally {
      setToggling(false);
    }
  };

  // ▶️ After auth, load status + data
  useEffect(() => {
    if (!authed) return;
    (async () => {
      await reloadQaStatus();
      await fetchAll();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  // 🔄 Re-fetch when QA mode flips ON
  useEffect(() => {
    if (authed && qaStatus?.enabled) {
      setError('');
      fetchAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, qaStatus?.enabled]);

  // ==== NEW: recompute reports when mode changes (without refetch) ====
  useEffect(() => {
    if (rows.length) buildReports(rows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
  // If trial arrays are not in the main doc, fetch them from the subcollection
  const hydrateTrialDetails = async (rows) => {
    const jobs = rows.map(async (d) => {
      const hasFs =
        Array.isArray(d?.full_stack?.trialResults) &&
        d.full_stack.trialResults.length;
      const hasSl =
        Array.isArray(d?.spoon_love?.trialResults) &&
        d.spoon_love.trialResults.length;
      if (hasFs && hasSl) return d;
      if (!d.id) return d;
      try {
        const ref = doc(
          db,
          'experiment2_responses',
          d.id,
          'details',
          'trialDetails'
        );
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const det = snap.data();
          d.full_stack = d.full_stack || {};
          d.spoon_love = d.spoon_love || {};
          if (!hasFs && Array.isArray(det.full_stack_trials))
            d.full_stack.trialResults = det.full_stack_trials;
          if (!hasSl && Array.isArray(det.spoon_love_trials))
            d.spoon_love.trialResults = det.spoon_love_trials;
        }
      } catch (_) {}
      return d;
    });
    await Promise.all(jobs);
    return rows;
  };

  // 📦 Fetch all sessions and build reports + priming A/B p-values
  const fetchAll = async () => {
    setBusy(true);
    setError('');
    setReportPRNGPrimed(null);
    setReportPRNGUnprimed(null);
    setReportQRNG(null);
    setReportQRNGPrimed(null);
    setReportQRNGUnprimed(null);
    setAbPvals(null);
    setAbPvalsPRNG(null);

    const coll = collection(db, 'experiment2_responses');
    const pageSize = 500;
    let qRef = query(coll, orderBy('timestamp'), limit(pageSize));
    let all = [];
    let lastDoc = null;

    try {
      while (true) {
        const snap = await getDocs(qRef);
        const batch = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
        all = all.concat(batch);
        if (snap.docs.length < pageSize) break;
        lastDoc = snap.docs[snap.docs.length - 1];
        qRef = query(
          coll,
          orderBy('timestamp'),
          startAfter(lastDoc),
          limit(pageSize)
        );
      }
      all = await hydrateTrialDetails(all);
      setRows(all);
      setLastUpdated(new Date());
      buildReports(all);
    } catch (e) {
      console.error(e);
      setError(`Fetch failed: ${e?.code || ''} ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  /* ==== NEW: build reports for current mode + summary/exit breakdown ==== */
  const buildReports = (all) => {
    // summary + exit reasons
    const total = all.length;
    let completers = 0;
    const exitMap = new Map();
    for (const d of all) {
      if (isCompleter(d)) {
        completers += 1;
        continue;
      }
      const reason =
        normalizeExitReason(getExitReasonRaw(d)) || 'unknown';
      exitMap.set(reason, (exitMap.get(reason) || 0) + 1);
    }
    const nonCompleters = total - completers;
    const exitBreakdown = Array.from(exitMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => ({
        reason,
        count,
        pctOfAll: total ? (100 * count) / total : 0,
        pctOfNonCompleters: nonCompleters
          ? (100 * count) / nonCompleters
          : 0,
      }));
    setSummary({ total, completers, nonCompleters, exitBreakdown });

    // session filter per mode
    const filterCompleters = (d) => isCompleter(d);
    const sessionFilter =
      mode === 'completers' ? filterCompleters : null;
    const allow = sessionFilter ?? (() => true);

    // trial extractors + flags
    const getPRNG = (doc) => doc?.full_stack?.trialResults || [];
    const getQRNG = (doc) => doc?.spoon_love?.trialResults || [];
    const isPrimed = (doc) => !!doc?.assignment?.primed;

    let rQRNG, rPrimed, rUnprimed;
    let rPRNGPrimed, rPRNGUnprimed;

    if (mode === 'sessionWeighted') {
      rPRNGPrimed = computeStatsSessionWeighted(
        all,
        getPRNG,
        (d) => allow(d) && isPrimed(d)
      );
      rPRNGUnprimed = computeStatsSessionWeighted(
        all,
        getPRNG,
        (d) => allow(d) && !isPrimed(d)
      );
      rQRNG = computeStatsSessionWeighted(
        all,
        getQRNG,
        sessionFilter
      );
      rPrimed = computeStatsSessionWeighted(
        all,
        getQRNG,
        (d) => allow(d) && isPrimed(d)
      );
      rUnprimed = computeStatsSessionWeighted(
        all,
        getQRNG,
        (d) => allow(d) && !isPrimed(d)
      );
    } else {
      rPRNGPrimed = computeStats(
        all,
        getPRNG,
        (d) => allow(d) && isPrimed(d)
      );
      rPRNGUnprimed = computeStats(
        all,
        getPRNG,
        (d) => allow(d) && !isPrimed(d)
      );
      rQRNG = computeStats(all, getQRNG, sessionFilter);
      rPrimed = computeStats(
        all,
        getQRNG,
        (d) => allow(d) && isPrimed(d)
      );
      rUnprimed = computeStats(
        all,
        getQRNG,
        (d) => allow(d) && !isPrimed(d)
      );
    }

    setReportPRNGPrimed(rPRNGPrimed);
    setReportPRNGUnprimed(rPRNGUnprimed);
    setReportQRNG(rQRNG);
    setReportQRNGPrimed(rPrimed);
    setReportQRNGUnprimed(rUnprimed);
    setAbPvals(primingABPvals(rPrimed, rUnprimed));
    setAbPvalsPRNG(primingABPvals(rPRNGPrimed, rPRNGUnprimed));

    // --- Correlation: mean hold (ms) vs % RIGHT per session (QRNG) ---
    try {
      const rowsForCorr = [];
      for (const d of all) {
        const trials = (d?.spoon_love?.trialResults || []).filter(
          Boolean
        );
        if (!trials.length) continue;

        const rights = trials.reduce(
          (a, t) => a + (Number(t?.primary_is_right) === 1 ? 1 : 0),
          0
        );
        const pctRight = (100 * rights) / trials.length;

        const holds = trials
          .map((t) => Number(t?.hold_duration_ms))
          .filter(Number.isFinite);

        if (!holds.length) continue;
        const meanHold =
          holds.reduce((a, b) => a + b, 0) / holds.length;

        rowsForCorr.push({ meanHold, pctRight });
      }
      const xs = rowsForCorr.map((r) => r.meanHold);
      const ys = rowsForCorr.map((r) => r.pctRight);
      const rHoldVsScore = pearsonR(xs, ys);

      // Keep it in qaDebug and log it
      setQaDebug((prev) => ({ ...(prev || {}), rHoldVsScore }));
      if (rHoldVsScore != null) {
        console.log(
          '[QA] Corr(mean hold ms, %RIGHT) =',
          rHoldVsScore.toFixed(3)
        );
      }
    } catch (e) {
      console.warn('Hold-vs-score correlation failed:', e);
    }

    // --- NEW: trial-level hold-duration vs accuracy (QRNG) ---
    try {
      const allQRNGTrials = all
        .flatMap((d) => d?.spoon_love?.trialResults || [])
        .filter(Boolean);

      const primaryHold = computeHoldReport(allQRNGTrials, {
        holdField: 'hold_duration_ms',
        rightField: 'primary_is_right',
      });
      const ghostHold = computeHoldReport(allQRNGTrials, {
        holdField: 'hold_duration_ms',
        rightField: 'ghost_is_right',
      });

      setHoldQRNG({ primary: primaryHold, ghost: ghostHold });
    } catch (e) {
      console.warn('Hold report build failed:', e);
      setHoldQRNG({ primary: null, ghost: null });
    }

    // --- Build PRNG boost points (one per session: last baseline trial) ---
    try {
      const pts = [];
      for (const d of all) {
        // prefer hydrated trials under full_stack.trialResults; fall back to details payload if present
        const fs = (
          d?.full_stack?.trialResults ||
          d?.details?.full_stack_trials ||
          []
        ).filter(Boolean);
        if (!fs.length) continue;

        const last = fs[fs.length - 1];
        // Only consider rows marked as the block summary
        if (!last || !last.block_summary) continue;

        const base = Number(last.fs_base_percent);
        const boost = Number(last.fs_boost_amount);
        const displayed = Number(last.fs_displayed_percent);
        const boosted = !!last.fs_boosted;

        if (Number.isFinite(base) && Number.isFinite(boost)) {
          pts.push({ base, boost, displayed, boosted });
        }
      }
      setBoostPoints(pts);
    } catch (e) {
      console.warn('Boost points build failed:', e);
      setBoostPoints([]);
    }
  };

  const downloadJSON = () => {
    const blob = new Blob([JSON.stringify(rows, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sessions.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
  // NEW: Download sessions INCLUDING subcollection trial arrays (details/trialDetails)
  // NEW: Download sessions INCLUDING subcollection trial arrays (details/trialDetails)
  const downloadJSONWithTrials = async () => {
    try {
      setBusy(true);
      // Ensure all rows have trial arrays by hydrating details/trialDetails
      const complete = await hydrateTrialDetails(
        rows.map((r) => ({ ...r }))
      );

      const payload = complete.map((d) => ({
        id: d.id,
        ...d,
        full_stack: {
          ...(d.full_stack || {}),
          trialResults:
            d.full_stack?.trialResults || d.full_stack_trials || [],
        },
        spoon_love: {
          ...(d.spoon_love || {}),
          trialResults:
            d.spoon_love?.trialResults || d.spoon_love_trials || [],
        },
      }));

      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sessions_with_trials.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError('Download failed: ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  // helper: build first-10 table rows from a report
  const makeFirstTen = (report) =>
    !report
      ? []
      : report.per.slice(0, 10).map((r) => ({
          session: r.session_id || r.participant_id || '',
          N: r.N,
          primary_pct: r.pctPrimary ?? null,
          ghost_pct: r.pctGhost ?? null,
          delta: r.delta ?? null,
          n10: r.n10,
          n01: r.n01,
          altOK: r.alternatingOK,
          qrngOK: r.qrngOK,
          warnings: r.warnings,
        }));

  const firstTenPRNGPrimed = useMemo(
    () => makeFirstTen(reportPRNGPrimed),
    [reportPRNGPrimed]
  );
  const firstTenPRNGUnprimed = useMemo(
    () => makeFirstTen(reportPRNGUnprimed),
    [reportPRNGUnprimed]
  );
  const firstTenQRNG = useMemo(
    () => makeFirstTen(reportQRNG),
    [reportQRNG]
  );
  const firstTenPrimed = useMemo(
    () => makeFirstTen(reportQRNGPrimed),
    [reportQRNGPrimed]
  );
  const firstTenUnprimed = useMemo(
    () => makeFirstTen(reportQRNGUnprimed),
    [reportQRNGUnprimed]
  );

  // --- Diagnostics inputs for QRNG (all)
  const allQRNGTrials = useMemo(
    () =>
      reportQRNG
        ? rows.flatMap((d) => d?.spoon_love?.trialResults || [])
        : [],
    [rows, reportQRNG]
  );
  const ghostByPos = useMemo(
    () => breakdownBy(allQRNGTrials, 'primary_pos', 'ghost_is_right'),
    [allQRNGTrials]
  );
  const ghostBySource = useMemo(
    () => breakdownBy(allQRNGTrials, 'rng_source', 'ghost_is_right'),
    [allQRNGTrials]
  );
  const parityPrimary = useMemo(
    () => parityPct(allQRNGTrials, 'raw_byte'),
    [allQRNGTrials]
  );
  const parityGhost = useMemo(
    () => parityPct(allQRNGTrials, 'ghost_raw_byte'),
    [allQRNGTrials]
  );

  const FactsCard = ({ report }) => {
    if (!report) return null;
    const t = report.totals;
    return (
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'stretch',
          flexWrap: 'wrap',
          marginTop: 4,
          marginBottom: 8,
        }}
      >
        {qaDebug?.rHoldVsScore != null && (
          <div
            style={{
              margin: '8px 0',
              padding: '8px 12px',
              border: '1px solid #ddd',
              borderRadius: 8,
            }}
          >
            <strong>Corr(mean hold ms, % RIGHT, QRNG):</strong>{' '}
            {qaDebug.rHoldVsScore.toFixed(3)}
          </div>
        )}

        <div
          style={{
            padding: '8px 12px',
            border: '1px solid #eee',
            borderRadius: 8,
            background: '#fafafa',
          }}
        >
          <div style={{ fontSize: 12, color: '#555' }}>Subject %</div>
          <div style={{ fontSize: 18 }}>
            {(t.pctPrimary ?? 0).toFixed(2)}%
            <span
              style={{ fontSize: 12, color: '#666', marginLeft: 6 }}
            >
              ({t.primaryRight}/{t.trials})
            </span>
          </div>
        </div>
        <div
          style={{
            padding: '8px 12px',
            border: '1px solid #eee',
            borderRadius: 8,
            background: '#fafafa',
          }}
        >
          <div style={{ fontSize: 12, color: '#555' }}>Demon %</div>
          <div style={{ fontSize: 18 }}>
            {(t.pctGhost ?? 0).toFixed(2)}%
            <span
              style={{ fontSize: 12, color: '#666', marginLeft: 6 }}
            >
              ({t.ghostRight}/{t.trials})
            </span>
          </div>
        </div>
        <div
          style={{
            padding: '8px 12px',
            border: '1px solid #eee',
            borderRadius: 8,
            background: '#fafafa',
          }}
        >
          <div style={{ fontSize: 12, color: '#555' }}>
            Δ (Subject − Demon)
          </div>
          <div style={{ fontSize: 18 }}>
            {(t.deltaPct ?? 0).toFixed(2)}%
          </div>
        </div>
      </div>
    );
  };

  const Section = ({
    title,
    report,
    firstTen,
    extraBadges,
    diagnostics,
  }) => {
    if (!report) return null;
    const usingSessionWeighted =
      report?.tests?._mode === 'sessionWeighted';
    return (
      <div style={{ marginTop: 24 }}>
        <h2 style={{ margin: '12px 0 8px' }}>{title}</h2>

        <BarChart
          title="Right Rate: Subject vs Demon"
          data={[
            {
              label: 'Subject',
              value: report.totals.pctPrimary ?? 0,
            },
            { label: 'Demon', value: report.totals.pctGhost ?? 0 },
          ]}
        />

        {/* p-value badges */}
        <div
          style={{
            display: 'flex',
            gap: 16,
            alignItems: 'center',
            flexWrap: 'wrap',
            marginBottom: 12,
            marginTop: 4,
          }}
        >
          <div
            style={{
              padding: '10px 14px',
              border: '1px solid #eee',
              borderRadius: 8,
              fontVariantNumeric: 'tabular-nums',
              background: '#fafafa',
            }}
          >
            <div style={{ fontSize: 12, color: '#555' }}>
              Δ (Subject − Demon)
            </div>
            <div style={{ fontSize: 20 }}>
              {(report.totals.deltaPct ?? 0).toFixed(2)}%
            </div>
          </div>

          {usingSessionWeighted ? (
            <>
              <PBadge
                label="Session-weighted: Demon vs 50% (t)"
                p={report.tests.rngBiasGhost.p}
              />
              <PBadge
                label="Session-weighted: Subject vs Demon (paired t)"
                p={report.tests.primaryVsGhost.p}
              />
              <PBadge
                label="Session-weighted: Subject vs 50% (t)"
                p={report.tests.primaryVs50.p}
              />
            </>
          ) : (
            <>
              <PBadge
                label="RNG bias (demon vs 50%)"
                p={report.tests.rngBiasGhost.p}
              />
              <PBadge
                label="Subject vs Demon"
                p={report.tests.primaryVsGhost.p}
              />
              <PBadge
                label="Subject vs 50%"
                p={report.tests.primaryVs50.p}
              />
            </>
          )}
          <PBadge
            label="n10 vs n01 symmetry (Subject↔︎Demon)"
            p={report.tests.symmetryN10vsN01.p}
          />
          {qaDebug?.rHoldVsScore != null && (
            <PBadge
              label="Corr(mean hold ms, %RIGHT) — QRNG"
              p={Math.abs(qaDebug.rHoldVsScore)}
            />
          )}
          {extraBadges}
        </div>

        {/* Quick facts (percentages + counts) */}
        <FactsCard report={report} />

        {/* Diagnostics (optional) */}
        {diagnostics}

        <details style={{ margin: '8px 0 16px' }}>
          <summary>Show raw JSON</summary>
          <pre>
            {JSON.stringify(
              { totals: report.totals, tests: report.tests },
              null,
              2
            )}
          </pre>
        </details>

        <h3 style={{ marginTop: 16 }}>
          {usingSessionWeighted
            ? 'First 10 participants'
            : 'First 10 sessions'}
        </h3>
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              borderCollapse: 'collapse',
              width: '100%',
              minWidth: 720,
            }}
          >
            <thead>
              <tr style={{ background: '#fafafa' }}>
                <th
                  style={{
                    textAlign: 'left',
                    padding: 8,
                    borderBottom: '1px solid #eee',
                  }}
                >
                  Session
                </th>
                <th
                  style={{
                    textAlign: 'right',
                    padding: 8,
                    borderBottom: '1px solid #eee',
                  }}
                >
                  N
                </th>
                <th
                  style={{
                    textAlign: 'center',
                    padding: 8,
                    borderBottom: '1px solid #eee',
                  }}
                >
                  Bars
                </th>
                <th
                  style={{
                    textAlign: 'right',
                    padding: 8,
                    borderBottom: '1px solid #eee',
                  }}
                >
                  Subject %
                </th>
                <th
                  style={{
                    textAlign: 'right',
                    padding: 8,
                    borderBottom: '1px solid #eee',
                  }}
                >
                  Demon %
                </th>
                <th
                  style={{
                    textAlign: 'right',
                    padding: 8,
                    borderBottom: '1px solid #eee',
                  }}
                >
                  Δ%
                </th>
                <th
                  style={{
                    textAlign: 'center',
                    padding: 8,
                    borderBottom: '1px solid #eee',
                  }}
                >
                  Alt OK
                </th>
                <th
                  style={{
                    textAlign: 'center',
                    padding: 8,
                    borderBottom: '1px solid #eee',
                  }}
                >
                  QRNG OK
                </th>
                <th
                  style={{
                    textAlign: 'left',
                    padding: 8,
                    borderBottom: '1px solid #eee',
                  }}
                >
                  Warnings
                </th>
              </tr>
            </thead>
            <tbody>
              {firstTen.map((r) => (
                <tr key={r.session}>
                  <td
                    style={{
                      padding: 8,
                      borderBottom: '1px solid #f1f1f1',
                    }}
                  >
                    <code style={{ fontSize: 12 }}>
                      {r.session.slice(0, 8)}…
                    </code>
                  </td>
                  <td
                    style={{
                      padding: 8,
                      textAlign: 'right',
                      borderBottom: '1px solid #f1f1f1',
                    }}
                  >
                    {r.N}
                  </td>
                  <td
                    style={{
                      padding: 8,
                      textAlign: 'center',
                      borderBottom: '1px solid #f1f1f1',
                    }}
                  >
                    <MiniBars
                      pctPrimary={r.primary_pct}
                      pctGhost={r.ghost_pct}
                    />
                  </td>
                  <td
                    style={{
                      padding: 8,
                      textAlign: 'right',
                      borderBottom: '1px solid #f1f1f1',
                    }}
                  >
                    {r.primary_pct != null
                      ? r.primary_pct.toFixed(1)
                      : '—'}
                    %
                  </td>
                  <td
                    style={{
                      padding: 8,
                      textAlign: 'right',
                      borderBottom: '1px solid #f1f1f1',
                    }}
                  >
                    {r.ghost_pct != null
                      ? r.ghost_pct.toFixed(1)
                      : '—'}
                    %
                  </td>
                  <td
                    style={{
                      padding: 8,
                      textAlign: 'right',
                      borderBottom: '1px solid #f1f1f1',
                    }}
                  >
                    {r.delta != null ? r.delta.toFixed(1) : '—'}%
                  </td>
                  <td
                    style={{
                      padding: 8,
                      textAlign: 'center',
                      borderBottom: '1px solid #f1f1f1',
                    }}
                  >
                    {r.altOK ? '✓' : '✗'}
                  </td>
                  <td
                    style={{
                      padding: 8,
                      textAlign: 'center',
                      borderBottom: '1px solid #f1f1f1',
                    }}
                  >
                    {r.qrngOK ? '✓' : '✗'}
                  </td>
                  <td
                    style={{
                      padding: 8,
                      borderBottom: '1px solid #f1f1f1',
                    }}
                  >
                    {r.warnings.length ? r.warnings.join(', ') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 style={{ marginTop: 16 }}>Integrity warnings</h3>
        {report.warnings?.length === 0 ? (
          <p>None 🎉</p>
        ) : (
          <pre>
            {JSON.stringify(
              report.warnings.map((w) => ({
                session: w.session,
                warnings: w.warnings,
              })),
              null,
              2
            )}
          </pre>
        )}
      </div>
    );
  };

  /* ==== NEW: Reference For Labels UI ==== */
  const ReferenceMatrix = () => (
    <details style={{ marginTop: 8 }}>
      <summary>What do these labels mean?</summary>
      <div style={{ overflowX: 'auto', marginTop: 6 }}>
        <table style={{ borderCollapse: 'collapse', minWidth: 680 }}>
          <thead>
            <tr style={{ background: '#fff' }}>
              <th
                style={{
                  textAlign: 'left',
                  padding: '6px 8px',
                  borderBottom: '1px solid #eee',
                }}
              >
                Label shown
              </th>
              <th
                style={{
                  textAlign: 'left',
                  padding: '6px 8px',
                  borderBottom: '1px solid #eee',
                }}
              >
                Question it answers
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: '6px 8px' }}>
                Δ (Subject − Demon)
              </td>
              <td style={{ padding: '6px 8px' }}>
                By how many percentage points did the{' '}
                <strong>subject</strong> outperform (or underperform)
                the <strong>demon</strong>?
              </td>
            </tr>
            <tr>
              <td style={{ padding: '6px 8px' }}>
                RNG bias (demon vs 50%)
              </td>
              <td style={{ padding: '6px 8px' }}>
                Is the demon’s accuracy different from 50% (chance)?
              </td>
            </tr>
            <tr>
              <td style={{ padding: '6px 8px' }}>Subject vs Demon</td>
              <td style={{ padding: '6px 8px' }}>
                Is the <strong>subject’s</strong> accuracy different
                from the <strong>demon’s</strong> accuracy?
              </td>
            </tr>
            <tr>
              <td style={{ padding: '6px 8px' }}>
                n10 vs n01 symmetry
              </td>
              <td style={{ padding: '6px 8px' }}>
                When subject and demon disagree, is the number of
                subject-only wins different from demon-only wins?
              </td>
            </tr>
            <tr>
              <td style={{ padding: '6px 8px' }}>Subject vs 50%</td>
              <td style={{ padding: '6px 8px' }}>
                Is the <strong>subject’s</strong> accuracy different
                from chance?
              </td>
            </tr>
            <tr>
              <td style={{ padding: '6px 8px' }}>
                Primed vs Not — Subject rate
              </td>
              <td style={{ padding: '6px 8px' }}>
                Is the <strong>subject’s</strong> accuracy different
                between the primed and unprimed groups?
              </td>
            </tr>
            <tr>
              <td style={{ padding: '6px 8px' }}>
                Primed vs Not — Demon rate
              </td>
              <td style={{ padding: '6px 8px' }}>
                Is the <strong>demon’s</strong> accuracy different
                between the primed and unprimed groups?
              </td>
            </tr>
            <tr>
              <td style={{ padding: '6px 8px' }}>
                Participant-weighted t-tests
              </td>
              <td style={{ padding: '6px 8px' }}>
                Treats each participant as one unit by using their
                first session only, then runs t-tests across
                participants.
              </td>
            </tr>
            <tr>
              <td style={{ padding: '6px 8px' }}>
                Diff-of-diff (gap bigger in primed?)
              </td>
              <td style={{ padding: '6px 8px' }}>
                Does priming change the size of the{' '}
                <strong>subject − demon</strong> accuracy gap?
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  );

  /* ==== NEW: Trial columns cheat-sheet ==== */
  const TrialColumnsHelp = () => (
    <details style={{ marginTop: 8 }}>
      <summary>What does each trial field mean?</summary>
      <div style={{ overflowX: 'auto', marginTop: 6 }}>
        <table style={{ borderCollapse: 'collapse', minWidth: 760 }}>
          <thead>
            <tr style={{ background: '#fff' }}>
              <th
                style={{
                  textAlign: 'left',
                  padding: '6px 8px',
                  borderBottom: '1px solid #eee',
                }}
              >
                Field
              </th>
              <th
                style={{
                  textAlign: 'left',
                  padding: '6px 8px',
                  borderBottom: '1px solid #eee',
                }}
              >
                Who/What
              </th>
              <th
                style={{
                  textAlign: 'left',
                  padding: '6px 8px',
                  borderBottom: '1px solid #eee',
                }}
              >
                Type
              </th>
              <th
                style={{
                  textAlign: 'left',
                  padding: '6px 8px',
                  borderBottom: '1px solid #eee',
                }}
              >
                Meaning
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: '6px 8px' }}>
                <code>primary_is_right</code>
              </td>
              <td style={{ padding: '6px 8px' }}>Subject</td>
              <td style={{ padding: '6px 8px' }}>0/1</td>
              <td style={{ padding: '6px 8px' }}>
                1 if the subject’s answer was correct on this trial.
              </td>
            </tr>
            <tr>
              <td style={{ padding: '6px 8px' }}>
                <code>ghost_is_right</code>
              </td>
              <td style={{ padding: '6px 8px' }}>Demon</td>
              <td style={{ padding: '6px 8px' }}>0/1</td>
              <td style={{ padding: '6px 8px' }}>
                1 if the demon’s answer was correct on this trial.
              </td>
            </tr>
            <tr>
              <td style={{ padding: '6px 8px' }}>
                <code>primary_pos</code>
              </td>
              <td style={{ padding: '6px 8px' }}>Allocation</td>
              <td style={{ padding: '6px 8px' }}>1 or 2</td>
              <td style={{ padding: '6px 8px' }}>
                Which slot the subject’s target was assigned to
                (should alternate 1,2,1,2,…).
              </td>
            </tr>
            <tr>
              <td style={{ padding: '6px 8px' }}>
                <code>raw_byte</code>
              </td>
              <td style={{ padding: '6px 8px' }}>
                Allocation (subject stream)
              </td>
              <td style={{ padding: '6px 8px' }}>integer (0–255)</td>
              <td style={{ padding: '6px 8px' }}>
                Underlying random byte for the subject stream; parity
                often maps to the side.
              </td>
            </tr>
            <tr>
              <td style={{ padding: '6px 8px' }}>
                <code>ghost_raw_byte</code>
              </td>
              <td style={{ padding: '6px 8px' }}>
                Allocation (demon stream)
              </td>
              <td style={{ padding: '6px 8px' }}>integer (0–255)</td>
              <td style={{ padding: '6px 8px' }}>
                Underlying random byte for the demon stream; parity
                likewise maps to its side.
              </td>
            </tr>
            <tr>
              <td style={{ padding: '6px 8px' }}>
                <code>rng_source</code>
              </td>
              <td style={{ padding: '6px 8px' }}>Metadata</td>
              <td style={{ padding: '6px 8px' }}>string</td>
              <td style={{ padding: '6px 8px' }}>
                Which RNG produced the bytes (e.g., <em>qrng_api</em>,{' '}
                <em>webcrypto</em>).
              </td>
            </tr>
            <tr>
              <td style={{ padding: '6px 8px' }}>
                <code>qrng_code</code>
              </td>
              <td style={{ padding: '6px 8px' }}>Integrity</td>
              <td style={{ padding: '6px 8px' }}>1 or 2</td>
              <td style={{ padding: '6px 8px' }}>
                Quality code for QRNG fetch (expected 1 or 2 when
                present). Other values trigger a warning.
              </td>
            </tr>
            <tr>
              <td style={{ padding: '6px 8px' }}>
                <code>n10 / n01</code> (derived)
              </td>
              <td style={{ padding: '6px 8px' }}>Comparison</td>
              <td style={{ padding: '6px 8px' }}>counts</td>
              <td style={{ padding: '6px 8px' }}>
                <code>n10</code> increments when subject is right &
                demon is wrong; <code>n01</code> increments when
                subject is wrong & demon is right.
              </td>
            </tr>
          </tbody>
        </table>
        <p style={{ marginTop: 8, color: '#555' }}>
          Note: backend field names keep <code>ghost_*</code> for
          compatibility; the UI shows them as “demon.”
        </p>
      </div>
    </details>
  );

  /* ==== NEW: small pill toggle UI ==== */
  const ModeToggle = () => (
    <div
      style={{
        margin: '8px 0 12px',
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
    >
      <span style={{ fontSize: 12, color: '#555' }}>Mode:</span>
      {[
        { id: 'pooled', label: 'All trials (pooled)' },
        {
          id: 'completers',
          label: 'Completers only (≥20 baseline, ≥50 quantum)',
        },
        {
          id: 'sessionWeighted',
          label: 'First session per participant (t-tests)',
        },
      ].map((opt) => (
        <label
          key={opt.id}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 8px',
            border: '1px solid #ddd',
            borderRadius: 16,
            background: mode === opt.id ? '#eef6ff' : '#fff',
            cursor: 'pointer',
          }}
        >
          <input
            type="radio"
            name="mode"
            value={opt.id}
            checked={mode === opt.id}
            onChange={(e) => setMode(e.target.value)}
          />
          <span style={{ fontSize: 12 }}>{opt.label}</span>
        </label>
      ))}
    </div>
  );

  /* ==== NEW: summary + exit breakdown UI ==== */
  const SummaryCard = () => (
    <div
      style={{
        marginTop: 8,
        padding: '8px 12px',
        border: '1px solid #ddd',
        borderRadius: 6,
        background: '#fafafa',
      }}
    >
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <strong>Total sessions:</strong> {summary.total}
        </div>
        <div>
          <strong>Completers:</strong> {summary.completers} (
          {summary.total
            ? ((100 * summary.completers) / summary.total).toFixed(1)
            : '0.0'}
          %)
        </div>
        <div>
          <strong>Early exits / non-completers:</strong>{' '}
          {summary.nonCompleters} (
          {summary.total
            ? ((100 * summary.nonCompleters) / summary.total).toFixed(
                1
              )
            : '0.0'}
          %)
        </div>
      </div>

      <details style={{ marginTop: 6 }}>
        <summary>Exit reasons (counts & percentages)</summary>
        <div style={{ overflowX: 'auto', marginTop: 6 }}>
          <table
            style={{ borderCollapse: 'collapse', minWidth: 520 }}
          >
            <thead>
              <tr style={{ background: '#fff' }}>
                <th
                  style={{
                    textAlign: 'left',
                    padding: '4px 8px',
                    borderBottom: '1px solid #eee',
                  }}
                >
                  Reason
                </th>
                <th
                  style={{
                    textAlign: 'right',
                    padding: '4px 8px',
                    borderBottom: '1px solid #eee',
                  }}
                >
                  Count
                </th>
                <th
                  style={{
                    textAlign: 'right',
                    padding: '4px 8px',
                    borderBottom: '1px solid #eee',
                  }}
                >
                  % of all
                </th>
                <th
                  style={{
                    textAlign: 'right',
                    padding: '4px 8px',
                    borderBottom: '1px solid #eee',
                  }}
                >
                  % of non-completers
                </th>
              </tr>
            </thead>
            <tbody>
              {summary.exitBreakdown.map((r) => (
                <tr key={r.reason}>
                  <td
                    style={{
                      padding: '4px 8px',
                      borderBottom: '1px solid #f5f5f5',
                    }}
                  >
                    {r.reason}
                  </td>
                  <td
                    style={{
                      padding: '4px 8px',
                      textAlign: 'right',
                      borderBottom: '1px solid #f5f5f5',
                    }}
                  >
                    {r.count}
                  </td>
                  <td
                    style={{
                      padding: '4px 8px',
                      textAlign: 'right',
                      borderBottom: '1px solid #f5f5f5',
                    }}
                  >
                    {r.pctOfAll.toFixed(1)}%
                  </td>
                  <td
                    style={{
                      padding: '4px 8px',
                      textAlign: 'right',
                      borderBottom: '1px solid #f5f5f5',
                    }}
                  >
                    {r.pctOfNonCompleters.toFixed(1)}%
                  </td>
                </tr>
              ))}
              {summary.exitBreakdown.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    style={{ padding: '6px 8px', color: '#666' }}
                  >
                    No early exits detected.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );

  return (
    <div style={{ maxWidth: 980, margin: '40px auto', padding: 16 }}>
      <h1>Export & QA</h1>

      {/* QA status banner + toggle */}
      {qaStatus ? (
        <div
          style={{
            padding: '8px 12px',
            border: '1px solid #ddd',
            borderRadius: 6,
            background: qaStatus.enabled ? '#e6ffed' : '#ffecec',
            marginBottom: 12,
          }}
        >
          <strong>
            QA mode: {qaStatus.enabled ? 'ON ✅' : 'OFF ❌'}
          </strong>
          {qaStatus.until && (
            <div>
              <small>
                Until:{' '}
                {qaStatus.until.toDate
                  ? qaStatus.until.toDate().toLocaleString()
                  : String(qaStatus.until)}
              </small>
            </div>
          )}
          <div style={{ marginTop: 6 }}>
            <small>
              Signed in as UID: <code>{uid || '—'}</code>
              {email ? (
                <>
                  {' '}
                  | Email: <code>{email}</code>
                  {displayName ? ` (${displayName})` : ''}
                </>
              ) : (
                <>
                  {' '}
                  | Email: <em>anonymous</em>
                </>
              )}
            </small>
          </div>

          <div style={{ marginTop: 8 }}>
            <button onClick={handleEmailSignIn}>
              Sign in with Email
            </button>
            {/* <small style={{ marginLeft: 8, color: '#666' }}>
              (Use your email+password or UI so QA reads work via
              email allowlist.)
            </small> */}
          </div>

          {/* {qaStatus.uids && (
            <div>
              <small>Allowed UIDs: {qaStatus.uids.join(', ')}</small>
            </div>
          )} */}

          <div
            style={{
              marginTop: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <button onClick={toggleQA} disabled={toggling}>
              {toggling
                ? 'Working…'
                : qaStatus.enabled
                ? 'Disable QA'
                : 'Enable QA'}
            </button>

            {/* Refresh status + data */}
            <button
              onClick={async () => {
                await reloadQaStatus();
                await fetchAll();
              }}
              disabled={busy}
              title="Fetch latest sessions (and refresh status banner)"
            >
              {busy ? 'Refreshing…' : 'Refresh status & data'}
            </button>

            {lastUpdated && (
              <small style={{ color: '#666' }}>
                Last updated: {lastUpdated.toLocaleString()}
              </small>
            )}
          </div>

          {qaStatus.error && (
            <div style={{ color: 'crimson', marginTop: 6 }}>
              <small>Error: {qaStatus.error}</small>
            </div>
          )}
        </div>
      ) : null}
      <div
        style={{
          marginTop: 8,
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <button onClick={runQaDebug}>Run QA Debug</button>
      </div>
      {qaDebug && (
        <div
          style={{
            marginTop: 8,
            padding: '8px 12px',
            border: '1px dashed #bbb',
            borderRadius: 6,
            background: qaDebug.ok ? '#e8fff0' : '#fff6f6',
            fontSize: 13,
          }}
        >
          <div>
            <strong>{qaDebug.reason}</strong>
          </div>
          <div style={{ marginTop: 6 }}>
            <details>
              <summary>Show details</summary>
              <pre style={{ whiteSpace: 'pre-wrap' }}>
                {JSON.stringify(qaDebug, null, 2)}
              </pre>
            </details>
          </div>
        </div>
      )}

      {/* ==== NEW: mode toggle & summary ==== */}
      <ModeToggle />
      <ReferenceMatrix />
      <TrialColumnsHelp />
      <SummaryCard />

      <p>
        This page fetches <code>experiment2_responses</code>, lets you
        download JSON, and runs QA checks in-browser.
      </p>

      {!authed ? <p>Signing in anonymously…</p> : null}
      {busy ? <p>Loading…</p> : null}
      {error ? <p style={{ color: 'crimson' }}>{error}</p> : null}

      {/* Loaded count + download */}
      {rows.length > 0 ? (
        <p>
          <strong>{rows.length}</strong> session document(s) loaded.
          <button onClick={downloadJSON} style={{ marginLeft: 8 }}>
            Download sessions.json
          </button>
          <button
            onClick={downloadJSONWithTrials}
            style={{ marginLeft: 8 }}
            title="Includes details/trialDetails subdoc arrays"
          >
            Download sessions_with_trials.json
          </button>
        </p>
      ) : null}

      {/* Sections */}

      {/* PRNG — show A/B badges so abPvalsPRNG is used */}
      <Section
        title="PRNG — Full Stack (Primed only)"
        report={reportPRNGPrimed}
        firstTen={firstTenPRNGPrimed}
        extraBadges={
          abPvalsPRNG ? (
            <>
              <PBadge
                label="Primed vs Unprimed — Subject rate"
                p={abPvalsPRNG.primaryRate.p}
              />
              <PBadge
                label="Primed vs Unprimed — Demon rate"
                p={abPvalsPRNG.ghostRate.p}
              />
              <PBadge
                label="Diff-of-diff (gap bigger in primed?)"
                p={abPvalsPRNG.diffOfDiff.p}
              />
            </>
          ) : null
        }
      />
      {/* PRNG — Boost vs Base scatter */}
      {boostPoints && boostPoints.length > 0 ? (
        <BoostScatter points={boostPoints} />
      ) : (
        <p style={{ color: '#666' }}>
          (No boost analytics found yet — run baseline blocks that
          save fs_base_percent/fs_boost_amount.)
        </p>
      )}

      <Section
        title="PRNG — Full Stack (Not primed)"
        report={reportPRNGUnprimed}
        firstTen={firstTenPRNGUnprimed}
      />

      <Section
        title="QRNG — Spoon Love (all)"
        report={reportQRNG}
        firstTen={firstTenQRNG}
        extraBadges={
          abPvals ? (
            <>
              <PBadge
                label="Primed vs Not — Subject rate"
                p={abPvals.primaryRate.p}
              />
              <PBadge
                label="Primed vs Not — Demon rate"
                p={abPvals.ghostRate.p}
              />
              <PBadge
                label="Diff-of-diff (gap bigger in primed?)"
                p={abPvals.diffOfDiff.p}
              />
            </>
          ) : null
        }
        diagnostics={
          <details style={{ marginTop: 8 }}>
            <summary>Diagnostics</summary>
            <div
              style={{
                display: 'flex',
                gap: 16,
                flexWrap: 'wrap',
                marginTop: 8,
              }}
            >
              <div>
                <h4 style={{ margin: '6px 0' }}>
                  Demon % by primary_pos
                </h4>
                <table style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th
                        style={{
                          textAlign: 'left',
                          padding: '4px 8px',
                        }}
                      >
                        pos
                      </th>
                      <th
                        style={{
                          textAlign: 'right',
                          padding: '4px 8px',
                        }}
                      >
                        Demon %
                      </th>
                      <th
                        style={{
                          textAlign: 'right',
                          padding: '4px 8px',
                        }}
                      >
                        N
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {ghostByPos.map((g) => (
                      <tr key={g.key}>
                        <td style={{ padding: '4px 8px' }}>
                          {g.key}
                        </td>
                        <td
                          style={{
                            padding: '4px 8px',
                            textAlign: 'right',
                          }}
                        >
                          {g.pct?.toFixed(2) ?? '—'}%
                        </td>
                        <td
                          style={{
                            padding: '4px 8px',
                            textAlign: 'right',
                          }}
                        >
                          {g.n}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <h4 style={{ margin: '6px 0' }}>
                  Demon % by rng_source
                </h4>
                <table style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th
                        style={{
                          textAlign: 'left',
                          padding: '4px 8px',
                        }}
                      >
                        source
                      </th>
                      <th
                        style={{
                          textAlign: 'right',
                          padding: '4px 8px',
                        }}
                      >
                        Demon %
                      </th>
                      <th
                        style={{
                          textAlign: 'right',
                          padding: '4px 8px',
                        }}
                      >
                        N
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {ghostBySource.map((g) => (
                      <tr key={g.key}>
                        <td style={{ padding: '4px 8px' }}>
                          {g.key}
                        </td>
                        <td
                          style={{
                            padding: '4px 8px',
                            textAlign: 'right',
                          }}
                        >
                          {g.pct?.toFixed(2) ?? '—'}%
                        </td>
                        <td
                          style={{
                            padding: '4px 8px',
                            textAlign: 'right',
                          }}
                        >
                          {g.n}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <h4 style={{ margin: '6px 0' }}>
                  Parity (odd = RIGHT) from raw bytes
                </h4>
                <table style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th
                        style={{
                          textAlign: 'left',
                          padding: '4px 8px',
                        }}
                      >
                        stream
                      </th>
                      <th
                        style={{
                          textAlign: 'right',
                          padding: '4px 8px',
                        }}
                      >
                        % odd
                      </th>
                      <th
                        style={{
                          textAlign: 'right',
                          padding: '4px 8px',
                        }}
                      >
                        N bytes
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ padding: '4px 8px' }}>
                        Subject raw_byte
                      </td>
                      <td
                        style={{
                          padding: '4px 8px',
                          textAlign: 'right',
                        }}
                      >
                        {parityPrimary.pctOdd != null
                          ? parityPrimary.pctOdd.toFixed(2)
                          : '—'}
                        %
                      </td>
                      <td
                        style={{
                          padding: '4px 8px',
                          textAlign: 'right',
                        }}
                      >
                        {parityPrimary.n}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 8px' }}>
                        Demon ghost_raw_byte
                      </td>
                      <td
                        style={{
                          padding: '4px 8px',
                          textAlign: 'right',
                        }}
                      >
                        {parityGhost.pctOdd != null
                          ? parityGhost.pctOdd.toFixed(2)
                          : '—'}
                        %
                      </td>
                      <td
                        style={{
                          padding: '4px 8px',
                          textAlign: 'right',
                        }}
                      >
                        {parityGhost.n}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* NEW: Hold-duration vs accuracy */}
            <div style={{ marginTop: 16 }}>
              <h4 style={{ margin: '6px 0' }}>
                Hold duration vs accuracy
              </h4>
              {!holdQRNG?.primary && !holdQRNG?.ghost ? (
                <p style={{ color: '#666' }}>
                  Not enough hold-duration data to compute quartiles
                  (need ≥20 trials).
                </p>
              ) : (
                <>
                  <HoldQuartileChart
                    title="Subject accuracy by hold-duration quartile"
                    holdReport={holdQRNG?.primary}
                  />
                  <HoldQuartileChart
                    title="Demon accuracy by hold-duration quartile"
                    holdReport={holdQRNG?.ghost}
                  />
                </>
              )}
            </div>
          </details>
        }
      />
      {/* === Timing arms panel (QRNG) ===================================== */}
      {(() => {
        // Pull ALL QRNG trials from the loaded session rows.
        // We look in the hydrated spoon_love.trialResults first (preferred),
        // and fall back to details.spoon_love_trials if needed.
        const qrngTrials = (rows || [])
          .flatMap(
            (d) =>
              d?.spoon_love?.trialResults ||
              d?.details?.spoon_love_trials ||
              []
          )
          .filter(Boolean);

        if (!qrngTrials.length) {
          return (
            <p style={{ color: '#666' }}>
              (No QRNG trials found yet to analyze timing arms.)
            </p>
          );
        }

        return <TimingArmsPanel trials={qrngTrials} />;
      })()}

      <Section
        title="QRNG — Spoon Love (Primed only)"
        report={reportQRNGPrimed}
        firstTen={firstTenPrimed}
      />
      <Section
        title="QRNG — Spoon Love (Not primed)"
        report={reportQRNGUnprimed}
        firstTen={firstTenUnprimed}
      />
    </div>
  );
}
