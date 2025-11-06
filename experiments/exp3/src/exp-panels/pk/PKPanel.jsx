// exp3/src/exp-panels/pk/PKPanel.jsx
import React from 'react';
import { zFromBinom, twoSidedP } from '../../stats/binomial.js';

// --- MI helper ---
function mutualInformationFromCounts(n00, n01, n10, n11) {
  const n = n00 + n01 + n10 + n11;
  if (!n) return 0;
  const p = (x) => x / n;
  const px0 = p(n00 + n01),
    px1 = p(n10 + n11);
  const py0 = p(n00 + n10),
    py1 = p(n01 + n11);
  const terms = [
    [n00, px0, py0],
    [n01, px0, py1],
    [n10, px1, py0],
    [n11, px1, py1],
  ];
  let I = 0;
  for (const [nij, px, py] of terms) {
    if (nij > 0) {
      const pij = p(nij);
      I += pij * Math.log2(pij / (px * py));
    }
  }
  return I; // bits
}

export default function PKPanel({ runs }) {
  let liveN = 0,
    liveK = 0,
    liveGhostK = 0;

  // 2×2 counts for MI by arm
  let live_n00 = 0,
    live_n01 = 0,
    live_n10 = 0,
    live_n11 = 0;

  // optional coherence/resonance avgs if present in docs
  let liveC = 0,
    liveH = 0,
    liveAC1 = 0,
    liveCount = 0;

  // entropy windows tracking
  let totalSubjWindows = 0,
    totalGhostWindows = 0,
    subjEntropySum = 0,
    ghostEntropySum = 0,
    entropyCount = 0;

  for (const r of runs) {
    const g = r.target_side === 'RED' ? 1 : 0; // goal bit for this run
    for (const m of r.minutes || []) {
      const n = m.n || 0,
        k = m.hits || 0;
      if (m.kind === 'live') {
        liveN += n;
        liveK += k;
        liveGhostK += m.ghost_hits || 0;
        // minute-level MI counts: hits contribute to (g,1), misses to (g,0)
        if (g === 1) {
          live_n11 += k;
          live_n10 += n - k;
        } else {
          live_n01 += k;
          live_n00 += n - k;
        }

        if (m.coherence?.cumRange != null) {
          liveC += m.coherence.cumRange;
          liveCount++;
        }
        if (m.coherence?.hurst != null) {
          liveH += m.coherence.hurst;
        }
        if (m.resonance?.ac1 != null) {
          liveAC1 += m.resonance.ac1;
        }

        // Collect entropy windows data
        if (m.entropy?.cumulative) {
          totalSubjWindows += m.entropy.cumulative.subj_count || 0;
          totalGhostWindows += m.entropy.cumulative.ghost_count || 0;
        }
        if (m.entropy?.new_windows_subj?.length) {
          for (const window of m.entropy.new_windows_subj) {
            // Handle both old format (number) and new format (object with .entropy)
            const entropyValue = typeof window === 'number' ? window : window.entropy;
            if (typeof entropyValue === 'number' && !isNaN(entropyValue)) {
              subjEntropySum += entropyValue;
              entropyCount++;
            }
          }
        }
        if (m.entropy?.new_windows_ghost?.length) {
          for (const window of m.entropy.new_windows_ghost) {
            // Handle both old format (number) and new format (object with .entropy)
            const entropyValue = typeof window === 'number' ? window : window.entropy;
            if (typeof entropyValue === 'number' && !isNaN(entropyValue)) {
              ghostEntropySum += entropyValue;
            }
          }
        }
      }
      // Note: All blocks are now 'live' - retro mode was removed
    }
  }

  const zLive = zFromBinom(liveK, liveN, 0.5),
    pLive = twoSidedP(zLive);
  const ghostPHat = liveN ? liveGhostK / liveN : 0;

  // MI from counts (minute-level)
  const I_live = mutualInformationFromCounts(
    live_n00,
    live_n01,
    live_n10,
    live_n11
  );

  const avg = (sum, count, def = '—') =>
    count ? (sum / count).toFixed(3) : def;

  // Entropy calculations
  const avgSubjEntropy = entropyCount ? (subjEntropySum / entropyCount).toFixed(4) : '—';
  const avgGhostEntropy = entropyCount ? (ghostEntropySum / entropyCount).toFixed(4) : '—';

  const Tile = ({ title, children }) => (
    <div
      style={{
        padding: 12,
        border: '1px solid #ddd',
        borderRadius: 8,
        minWidth: 240,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{title}</div>
      <div>{children}</div>
    </div>
  );

  return (
    <div style={{ marginTop: 16 }}>
      <h3>PK Pilot (Live QRNG)</h3>
      <div
        style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px,1fr))',
        }}
      >
        <Tile title="All Live">
          <div>n = {liveN}</div>
          <div>hits = {liveK}</div>
          <div>
            z = {zLive.toFixed(2)} (p = {pLive.toExponential(2)})
          </div>
          <div>ghost p̂ = {ghostPHat.toFixed(3)}</div>
          <div>MI(G;H) ≈ {I_live.toFixed(4)} bits</div>
        </Tile>
        <Tile title="Coherence (avg)">
          <div>Range ≈ {avg(liveC, liveCount)}</div>
          <div>Hurst ≈ {avg(liveH, liveCount)}</div>
        </Tile>
        <Tile title="Resonance (AC₁, avg)">
          <div>AC₁ ≈ {avg(liveAC1, liveCount)}</div>
        </Tile>
        <Tile title="Entropy Windows (1000-bit)">
          <div>Total subj windows: {totalSubjWindows}</div>
          <div>Total ghost windows: {totalGhostWindows}</div>
          <div>Avg subj entropy: {avgSubjEntropy}</div>
          <div>Avg ghost entropy: {avgGhostEntropy}</div>
        </Tile>
      </div>
    </div>
  );
}
