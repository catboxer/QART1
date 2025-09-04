import React from 'react';
import TimingArmsPanel from '../timing/TimingArmsPanel';
import FoldedSelfCheck from '../selfcheck/FoldedSelfCheck';

export default function ResultsDashboard({
  session,
  pooled,
  perSession,
  holdReport,
}) {
  return (
    <div className="block-panel">
      <h2>Results</h2>
      {/* Slot your existing summary rows + charts here (moved from QAExport.jsx) */}
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

      <TimingArmsPanel trials={session?.trials || []} />
      <FoldedSelfCheck />
      {/* Add your pooled/per-session charts as needed */}
    </div>
  );
}
