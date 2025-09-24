// exp3/src/QAExport.jsx
import React, { useEffect, useState, useMemo } from 'react';
import { db, auth, signInWithEmailPassword } from './firebase';
import {
  collection,
  getDocs,
  query,
  orderBy,
  doc,
  getDoc,
  updateDoc,
} from 'firebase/firestore';
import { signInAnonymously, onAuthStateChanged, signOut } from 'firebase/auth';
import { config } from './config.js';
import { panels } from './exp-panels';

// Analysis helper functions
function computeStatistics(sessions, mode = 'pooled') {
  if (!sessions.length) return null;

  let totalHits = 0;
  let totalTrials = 0;
  let totalGhostHits = 0;
  let totalEntropyWindows = 0;
  let totalEntropySum = 0;
  let sessionStats = [];

  sessions.forEach(session => {
    let sessionHits = 0;
    let sessionTrials = 0;
    let sessionGhostHits = 0;
    let sessionEntropyWindows = 0;
    let sessionEntropySum = 0;

    (session.minutes || []).forEach(minute => {
      sessionHits += minute.hits || 0;
      sessionTrials += minute.n || 0;
      sessionGhostHits += minute.ghost_hits || 0;

      if (minute.entropy?.new_windows_subj?.length) {
        sessionEntropyWindows += minute.entropy.new_windows_subj.length;
        sessionEntropySum += minute.entropy.new_windows_subj.reduce((a, b) => a + b, 0);
      }
    });

    const hitRate = sessionTrials > 0 ? sessionHits / sessionTrials : 0;
    const ghostHitRate = sessionTrials > 0 ? sessionGhostHits / sessionTrials : 0;

    sessionStats.push({
      id: session.id,
      participant_id: session.participant_id,
      hits: sessionHits,
      trials: sessionTrials,
      ghostHits: sessionGhostHits,
      hitRate,
      ghostHitRate,
      entropyWindows: sessionEntropyWindows,
      avgEntropy: sessionEntropyWindows > 0 ? sessionEntropySum / sessionEntropyWindows : 0,
      primeCond: session.prime_condition || 'unknown',
      binauralBeats: session.binaural_beats || 'No',
      completed: session.completed || false,
      createdAt: session.createdAt
    });

    totalHits += sessionHits;
    totalTrials += sessionTrials;
    totalGhostHits += sessionGhostHits;
    totalEntropyWindows += sessionEntropyWindows;
    totalEntropySum += sessionEntropySum;
  });

  const avgHitRate = totalTrials > 0 ? totalHits / totalTrials : 0;
  const avgGhostHitRate = totalTrials > 0 ? totalGhostHits / totalTrials : 0;
  const avgEntropy = totalEntropyWindows > 0 ? totalEntropySum / totalEntropyWindows : 0;

  // Simple z-test for hit rate vs 50%
  const expectedRate = 0.5;
  const se = Math.sqrt(expectedRate * (1 - expectedRate) / totalTrials);
  const z = totalTrials > 0 ? (avgHitRate - expectedRate) / se : 0;
  const p = 2 * (1 - normalCdf(Math.abs(z)));

  return {
    totalSessions: sessions.length,
    totalTrials,
    totalHits,
    totalGhostHits,
    avgHitRate,
    avgGhostHitRate,
    avgEntropy,
    totalEntropyWindows,
    z,
    p,
    sessionStats,
    deltaPct: (avgHitRate - avgGhostHitRate) * 100
  };
}

// Simple normal CDF approximation
function normalCdf(x) {
  return 0.5 * (1 + erf(x / Math.sqrt(2)));
}

function erf(x) {
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

// Advanced Analytics Functions
function computeAutocorrelation(series, lag) {
  if (series.length <= lag) return 0;

  const n = series.length - lag;
  const mean = series.reduce((a, b) => a + b, 0) / series.length;

  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < n; i++) {
    numerator += (series[i] - mean) * (series[i + lag] - mean);
  }

  for (let i = 0; i < series.length; i++) {
    denominator += Math.pow(series[i] - mean, 2);
  }

  return denominator === 0 ? 0 : numerator / denominator;
}

function computeSpectralAnalysis(series) {
  // Simple power spectral density using periodogram
  const n = series.length;
  if (n < 4) return { frequencies: [], powers: [], dominantFreq: 0 };

  const frequencies = [];
  const powers = [];

  for (let k = 1; k < n/2; k++) {
    const freq = k / n;
    let real = 0, imag = 0;

    for (let t = 0; t < n; t++) {
      const angle = -2 * Math.PI * k * t / n;
      real += series[t] * Math.cos(angle);
      imag += series[t] * Math.sin(angle);
    }

    const power = (real * real + imag * imag) / n;
    frequencies.push(freq);
    powers.push(power);
  }

  const maxPowerIndex = powers.indexOf(Math.max(...powers));
  const dominantFreq = frequencies[maxPowerIndex] || 0;

  return { frequencies, powers, dominantFreq };
}

function computeRunsTest(series, threshold = 0.5) {
  const runs = [];
  let currentRun = { value: series[0] >= threshold, length: 1 };

  for (let i = 1; i < series.length; i++) {
    const current = series[i] >= threshold;
    if (current === currentRun.value) {
      currentRun.length++;
    } else {
      runs.push(currentRun);
      currentRun = { value: current, length: 1 };
    }
  }
  runs.push(currentRun);

  const numRuns = runs.length;
  const n1 = series.filter(x => x >= threshold).length;
  const n2 = series.length - n1;

  if (n1 === 0 || n2 === 0) return { numRuns, expected: 0, z: 0, p: 1 };

  const expectedRuns = (2 * n1 * n2) / (n1 + n2) + 1;
  const variance = (2 * n1 * n2 * (2 * n1 * n2 - n1 - n2)) /
                   ((n1 + n2) * (n1 + n2) * (n1 + n2 - 1));

  const z = variance > 0 ? (numRuns - expectedRuns) / Math.sqrt(variance) : 0;
  const p = 2 * (1 - normalCdf(Math.abs(z)));

  return { numRuns, expected: expectedRuns, z, p, runs };
}

function computeMutualInformation(x, y, bins = 5) {
  if (x.length !== y.length || x.length === 0) return 0;

  const n = x.length;
  const xMin = Math.min(...x), xMax = Math.max(...x);
  const yMin = Math.min(...y), yMax = Math.max(...y);

  if (xMax === xMin || yMax === yMin) return 0;

  // Discretize into bins
  const xBins = x.map(val => Math.min(bins - 1, Math.floor((val - xMin) / (xMax - xMin) * bins)));
  const yBins = y.map(val => Math.min(bins - 1, Math.floor((val - yMin) / (yMax - yMin) * bins)));

  // Count joint and marginal frequencies
  const joint = new Map();
  const marginalX = new Array(bins).fill(0);
  const marginalY = new Array(bins).fill(0);

  for (let i = 0; i < n; i++) {
    const key = `${xBins[i]},${yBins[i]}`;
    joint.set(key, (joint.get(key) || 0) + 1);
    marginalX[xBins[i]]++;
    marginalY[yBins[i]]++;
  }

  // Compute mutual information
  let mi = 0;
  for (const [key, jointCount] of joint) {
    const [xi, yi] = key.split(',').map(Number);
    const pXY = jointCount / n;
    const pX = marginalX[xi] / n;
    const pY = marginalY[yi] / n;

    if (pXY > 0 && pX > 0 && pY > 0) {
      mi += pXY * Math.log2(pXY / (pX * pY));
    }
  }

  return mi;
}

function filterSessions(sessions, mode, binauralFilter, primeFilter, dataTypeFilter) {
  let filtered = sessions;

  // Filter by completion status
  if (mode === 'completers') {
    filtered = filtered.filter(s => s.completed);
  } else if (mode === 'nonCompleters') {
    filtered = filtered.filter(s => !s.completed);
  }

  // Filter by binaural beats
  if (binauralFilter === 'yes') {
    filtered = filtered.filter(s => s.binaural_beats === 'Yes');
  } else if (binauralFilter === 'no') {
    filtered = filtered.filter(s => s.binaural_beats === 'No' || s.binaural_beats === 'What are binaural beats?');
  }

  // Filter by prime condition
  if (primeFilter === 'primed') {
    filtered = filtered.filter(s => s.prime_condition === 'prime');
  } else if (primeFilter === 'neutral') {
    filtered = filtered.filter(s => s.prime_condition === 'neutral');
  }

  // Filter by data type (all/live/retro)
  if (dataTypeFilter === 'live') {
    filtered = filtered.map(session => ({
      ...session,
      minutes: (session.minutes || []).filter(m => m.kind === 'live')
    })).filter(session => session.minutes.length > 0);
  } else if (dataTypeFilter === 'retro') {
    filtered = filtered.map(session => ({
      ...session,
      minutes: (session.minutes || []).filter(m => m.kind === 'retro')
    })).filter(session => session.minutes.length > 0);
  }

  return filtered;
}

async function fetchAllRunsWithMinutes() {
  try {
    const runsSnap = await getDocs(
      query(collection(db, 'experiment3_responses'), orderBy('createdAt', 'desc'))
    );
    const runs = runsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const out = [];

    for (const r of runs) {
      try {
        const minsSnap = await getDocs(
          collection(db, 'experiment3_responses', r.id, 'minutes')
        );
        const minutes = minsSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.idx ?? 0) - (b.idx ?? 0));
        out.push({ ...r, minutes });
      } catch (err) {
        console.warn(`Failed to fetch minutes for run ${r.id}:`, err);
        out.push({ ...r, minutes: [] });
      }
    }
    return out;
  } catch (err) {
    console.error('Failed to fetch runs:', err);
    return [];
  }
}

function DownloadButton({ data, filename = 'export.json' }) {
  return (
    <button
      onClick={() => {
        const blob = new Blob([JSON.stringify(data, null, 2)], {
          type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }}
      style={{
        padding: '6px 12px',
        border: '1px solid #16a34a',
        borderRadius: 4,
        background: '#16a34a',
        color: '#ffffff',
        cursor: 'pointer',
        fontSize: 12,
        marginRight: 8,
      }}
    >
      📥 {filename}
    </button>
  );
}

function PBadge({ label, p, style = {} }) {
  const getPColor = (p) => {
    if (p < 0.001) return '#dc2626'; // red-600
    if (p < 0.01) return '#ea580c';  // orange-600
    if (p < 0.05) return '#d97706';  // amber-600
    return '#6b7280';                // gray-500
  };

  return (
    <div
      style={{
        padding: '6px 10px',
        border: '1px solid #e5e7eb',
        borderRadius: 6,
        background: '#f9fafb',
        fontVariantNumeric: 'tabular-nums',
        fontSize: 12,
        textAlign: 'center',
        ...style,
      }}
    >
      <div style={{ color: '#6b7280', marginBottom: 2 }}>{label}</div>
      <div style={{ color: getPColor(p), fontWeight: 'bold' }}>
        p = {p < 0.001 ? '< 0.001' : p.toFixed(3)}
      </div>
    </div>
  );
}

// Expandable Analytics Section Component
function AnalyticsSection({ title, content }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ marginBottom: 24, border: '1px solid #e5e7eb', borderRadius: 8 }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%',
          padding: '12px 16px',
          background: '#f9fafb',
          border: 'none',
          borderRadius: expanded ? '8px 8px 0 0' : '8px',
          textAlign: 'left',
          fontSize: 16,
          fontWeight: 'bold',
          color: '#374151',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        {title}
        <span style={{ fontSize: 14, color: '#6b7280' }}>
          {expanded ? '▼' : '▶'}
        </span>
      </button>

      {expanded && (
        <div style={{ padding: 16, background: '#fff' }}>
          {content}
        </div>
      )}
    </div>
  );
}

// Primary Performance Metrics Component
function PrimaryPerformanceMetrics({ sessions, stats }) {
  const blockLevelStats = useMemo(() => {
    const blocks = [];
    let totalHits = 0;
    let totalTrials = 0;

    // Group by minute index to calculate averages across subjects
    const minuteGroups = {}; // { minuteIndex: [blocks...] }

    sessions.forEach(session => {
      (session.minutes || []).forEach(minute => {
        const minuteIndex = minute.idx || 0;

        // Add to overall blocks for other calculations
        blocks.push({
          sessionId: session.id,
          participantId: session.participant_id,
          blockIndex: minuteIndex,
          minuteIndex: minuteIndex,
          hits: minute.hits || 0,
          trials: minute.n || 0,
          condition: session.prime_condition || 'neutral',
          binaural: session.binaural_beats,
        });

        // Group by minute for averaging
        if (!minuteGroups[minuteIndex]) {
          minuteGroups[minuteIndex] = [];
        }
        minuteGroups[minuteIndex].push({
          hits: minute.hits || 0,
          trials: minute.n || 0,
          hitRate: (minute.n || 0) > 0 ? (minute.hits || 0) / (minute.n || 0) : 0,
          condition: session.prime_condition || 'neutral',
        });
      });
    });

    // Calculate block-level hit rates (for other stats)
    const blockHitRates = blocks.map(block => ({
      ...block,
      hitRate: block.trials > 0 ? block.hits / block.trials : 0,
    }));

    // Calculate average performance by minute across all subjects (both subject and ghost)
    const averageByMinute = [];
    const ghostAverageByMinute = [];

    for (let minute = 0; minute < 18; minute++) {
      const minuteBlocks = minuteGroups[minute] || [];
      if (minuteBlocks.length > 0) {
        const avgHitRate = minuteBlocks.reduce((sum, block) => sum + block.hitRate, 0) / minuteBlocks.length;
        const totalHitsThisMinute = minuteBlocks.reduce((sum, block) => sum + block.hits, 0);
        const totalTrialsThisMinute = minuteBlocks.reduce((sum, block) => sum + block.trials, 0);

        averageByMinute.push({
          minuteIndex: minute,
          avgHitRate,
          subjectCount: minuteBlocks.length,
          totalHits: totalHitsThisMinute,
          totalTrials: totalTrialsThisMinute,
        });

        // Calculate ghost average for this minute
        const ghostHitRates = minuteBlocks.map(block => {
          const ghostHits = sessions.find(s => s.minutes?.[minute])?.minutes?.[minute]?.ghost_hits || 0;
          const ghostTrials = block.trials; // Same number of trials
          return ghostTrials > 0 ? ghostHits / ghostTrials : 0.5;
        });

        const avgGhostHitRate = ghostHitRates.reduce((sum, rate) => sum + rate, 0) / ghostHitRates.length;

        ghostAverageByMinute.push({
          minuteIndex: minute,
          avgHitRate: avgGhostHitRate,
          subjectCount: minuteBlocks.length,
        });
      }
    }

    totalHits = blockHitRates.reduce((sum, block) => sum + block.hits, 0);
    totalTrials = blockHitRates.reduce((sum, block) => sum + block.trials, 0);

    // Condition comparisons
    const primeBlocks = blockHitRates.filter(b => b.condition === 'prime');
    const neutralBlocks = blockHitRates.filter(b => b.condition === 'neutral');

    // Debug: log what conditions we found
    const allConditions = [...new Set(blockHitRates.map(b => b.condition))];
    console.log('Analytics: Found conditions:', allConditions);
    console.log('Analytics: Prime blocks:', primeBlocks.length, 'Neutral blocks:', neutralBlocks.length);

    // Debug: log the actual block data to see what's wrong
    console.log('Analytics: First few blocks:', blockHitRates.slice(0, 3));
    console.log('Analytics: Total hits across all blocks:', totalHits);
    console.log('Analytics: Total trials across all blocks:', totalTrials);

    // Debug: log some raw minute data
    console.log('Analytics: Sample session minutes:', sessions[0]?.minutes?.slice(0, 2));

    // Debug: log all field names in the first minute to see what we're working with
    console.log('Analytics: Sessions with minutes data:', sessions.map(s => ({ id: s.id, minutesCount: s.minutes?.length })));

    if (sessions[0]?.minutes?.[0]) {
      console.log('Analytics: First minute field names:', Object.keys(sessions[0].minutes[0]));
      console.log('Analytics: First minute full data:', sessions[0].minutes[0]);
    } else {
      console.log('Analytics: No minute data found in first session');
      console.log('Analytics: First session structure:', sessions[0]);
    }

    const primeHitRate = primeBlocks.length > 0 ?
      primeBlocks.reduce((sum, b) => sum + b.hits, 0) / Math.max(1, primeBlocks.reduce((sum, b) => sum + b.trials, 0)) : 0;
    const neutralHitRate = neutralBlocks.length > 0 ?
      neutralBlocks.reduce((sum, b) => sum + b.hits, 0) / Math.max(1, neutralBlocks.reduce((sum, b) => sum + b.trials, 0)) : 0;

    // Z-score calculation for overall performance
    const overallHitRate = totalTrials > 0 ? totalHits / totalTrials : 0;
    const expectedHitRate = 0.5;
    const standardError = Math.sqrt((expectedHitRate * (1 - expectedHitRate)) / totalTrials);
    const zScore = standardError > 0 ? (overallHitRate - expectedHitRate) / standardError : 0;
    const pValue = 2 * (1 - cdf(Math.abs(zScore))); // Two-tailed test

    return {
      blockHitRates,
      averageByMinute, // New: average performance by minute across subjects
      ghostAverageByMinute, // New: ghost average performance by minute
      totalBlocks: blocks.length,
      primeHitRate,
      neutralHitRate,
      conditionDiff: primeHitRate - neutralHitRate,
      overallHitRate,
      zScore,
      pValue,
    };
  }, [sessions]);

  // Standard normal CDF approximation
  function cdf(z) {
    return 0.5 * (1 + erf(z / Math.sqrt(2)));
  }

  function erf(x) {
    // Abramowitz and Stegun approximation
    const a1 =  0.254829592;
    const a2 = -0.284496736;
    const a3 =  1.421413741;
    const a4 = -1.453152027;
    const a5 =  1.061405429;
    const p  =  0.3275911;

    const sign = x >= 0 ? 1 : -1;
    x = Math.abs(x);

    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

    return sign * y;
  }

  return (
    <div>
      <h3 style={{ marginBottom: 16, color: '#374151' }}>Block-Level Performance Analysis</h3>

      {/* Key Metrics Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa' }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Overall Hit Rate</div>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: '#374151' }}>
            {(blockLevelStats.overallHitRate * 100).toFixed(2)}%
          </div>
        </div>

        <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa' }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Z-Score vs Chance</div>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: blockLevelStats.zScore > 0 ? '#059669' : '#dc2626' }}>
            {blockLevelStats.zScore.toFixed(3)}
          </div>
        </div>

        <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa' }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Total Blocks Analyzed</div>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: '#374151' }}>
            {blockLevelStats.totalBlocks}
          </div>
        </div>

        <PBadge
          label="Block Performance vs Chance"
          p={blockLevelStats.pValue}
          style={{ padding: 16 }}
        />
      </div>

      {/* Condition Comparison */}
      <h4 style={{ marginBottom: 12, color: '#374151' }}>Condition Comparison</h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
        <div style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 6, background: '#fef3c7' }}>
          <div style={{ fontSize: 12, color: '#92400e', marginBottom: 4 }}>Prime Condition</div>
          <div style={{ fontSize: 18, fontWeight: 'bold', color: '#92400e' }}>
            {isNaN(blockLevelStats.primeHitRate) ? 'N/A' : (blockLevelStats.primeHitRate * 100).toFixed(2) + '%'}
          </div>
        </div>

        <div style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 6, background: '#e0f2fe' }}>
          <div style={{ fontSize: 12, color: '#0369a1', marginBottom: 4 }}>Neutral Condition</div>
          <div style={{ fontSize: 18, fontWeight: 'bold', color: '#0369a1' }}>
            {isNaN(blockLevelStats.neutralHitRate) ? 'N/A' : (blockLevelStats.neutralHitRate * 100).toFixed(2) + '%'}
          </div>
        </div>

        <div style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 6, background: '#f3e8ff' }}>
          <div style={{ fontSize: 12, color: '#7c3aed', marginBottom: 4 }}>Prime - Neutral</div>
          <div style={{ fontSize: 18, fontWeight: 'bold', color: blockLevelStats.conditionDiff > 0 ? '#059669' : '#dc2626' }}>
            {isNaN(blockLevelStats.conditionDiff) ? 'N/A' : (blockLevelStats.conditionDiff * 100).toFixed(2) + '%'}
          </div>
        </div>
      </div>

      {/* Average Performance by Minute Chart */}
      <h4 style={{ marginBottom: 12, color: '#374151' }}>Average Performance by Minute</h4>
      <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 8 }}>
        Average hit rate per minute across all sessions (learning/fatigue curve)
      </div>
      <AveragePerformanceChart
        averageData={blockLevelStats.averageByMinute}
        ghostData={blockLevelStats.ghostAverageByMinute}
      />
    </div>
  );
}

// Average performance by minute chart (learning/fatigue curve)
function AveragePerformanceChart({ averageData, ghostData }) {
  if (!averageData || averageData.length === 0) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: 6 }}>
        No minute-level data available
      </div>
    );
  }

  const chartWidth = Math.min(800, averageData.length * 40 + 100);
  const chartHeight = 200;

  return (
    <div style={{
      padding: 20,
      border: '1px solid #e5e7eb',
      borderRadius: 8,
      background: '#fafafa',
      overflowX: 'auto'
    }}>
      <svg width={chartWidth} height={chartHeight} style={{ background: 'white', borderRadius: 6 }}>
        {/* Grid lines */}
        {[0.4, 0.45, 0.5, 0.55, 0.6].map(rate => {
          const y = chartHeight - 40 - ((rate - 0.4) / 0.2) * (chartHeight - 80);
          return (
            <g key={rate}>
              <line x1={50} y1={y} x2={chartWidth - 20} y2={y} stroke="#e5e7eb" strokeWidth={1} />
              <text x={45} y={y + 4} textAnchor="end" fontSize={10} fill="#6b7280">
                {(rate * 100).toFixed(0)}%
              </text>
            </g>
          );
        })}

        {/* 50% chance line */}
        <line x1={50} y1={chartHeight - 40 - ((0.5 - 0.4) / 0.2) * (chartHeight - 80)}
              x2={chartWidth - 20} y2={chartHeight - 40 - ((0.5 - 0.4) / 0.2) * (chartHeight - 80)}
              stroke="#dc2626" strokeWidth={2} strokeDasharray="5,5" />

        {/* Subject data line */}
        <polyline
          fill="none"
          stroke="#0369a1"
          strokeWidth={2}
          points={averageData.map((point, index) => {
            const x = 50 + (index / (averageData.length - 1)) * (chartWidth - 70);
            const y = chartHeight - 40 - ((point.avgHitRate - 0.4) / 0.2) * (chartHeight - 80);
            return `${x},${Math.max(20, Math.min(chartHeight - 40, y))}`;
          }).join(' ')}
        />

        {/* Ghost data line */}
        {ghostData && ghostData.length > 0 && (
          <polyline
            fill="none"
            stroke="#dc2626"
            strokeWidth={2}
            strokeDasharray="3,3"
            points={ghostData.map((point, index) => {
              const x = 50 + (index / (ghostData.length - 1)) * (chartWidth - 70);
              const y = chartHeight - 40 - ((point.avgHitRate - 0.4) / 0.2) * (chartHeight - 80);
              return `${x},${Math.max(20, Math.min(chartHeight - 40, y))}`;
            }).join(' ')}
          />
        )}

        {/* Subject data points */}
        {averageData.map((point, index) => {
          const x = 50 + (index / (averageData.length - 1)) * (chartWidth - 70);
          const y = chartHeight - 40 - ((point.avgHitRate - 0.4) / 0.2) * (chartHeight - 80);
          const clampedY = Math.max(20, Math.min(chartHeight - 40, y));

          return (
            <g key={`subject-${index}`}>
              <circle cx={x} cy={clampedY} r={3} fill="#0369a1" />
              <text x={x} y={chartHeight - 10} textAnchor="middle" fontSize={10} fill="#6b7280">
                {point.minuteIndex + 1}
              </text>
            </g>
          );
        })}

        {/* Ghost data points */}
        {ghostData && ghostData.length > 0 && ghostData.map((point, index) => {
          const x = 50 + (index / (ghostData.length - 1)) * (chartWidth - 70);
          const y = chartHeight - 40 - ((point.avgHitRate - 0.4) / 0.2) * (chartHeight - 80);
          const clampedY = Math.max(20, Math.min(chartHeight - 40, y));

          return (
            <g key={`ghost-${index}`}>
              <circle cx={x} cy={clampedY} r={2} fill="#dc2626" />
            </g>
          );
        })}

        {/* Axis labels */}
        <text x={chartWidth / 2} y={chartHeight - 5} textAnchor="middle" fontSize={12} fill="#374151">
          Minute
        </text>
        <text x={15} y={chartHeight / 2} textAnchor="middle" fontSize={12} fill="#374151" transform={`rotate(-90, 15, ${chartHeight / 2})`}>
          Hit Rate
        </text>
      </svg>

      <div style={{ marginTop: 12, fontSize: 12, color: '#6b7280', textAlign: 'center' }}>
        Shows whether performance improves (learning) or declines (fatigue) over the 18-minute session
      </div>

      {/* Legend */}
      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'center', gap: 16, fontSize: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 12, height: 2, backgroundColor: '#0369a1' }}></div>
          <span style={{ color: '#374151' }}>Subject Performance</span>
        </div>
        {ghostData && ghostData.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 12, height: 2, backgroundColor: '#dc2626', borderTop: '2px dashed #dc2626' }}></div>
            <span style={{ color: '#374151' }}>Ghost Control</span>
          </div>
        )}
      </div>
    </div>
  );
}

// Simple cumulative performance chart
function CumulativeChart({ blocks }) {
  const cumulativeData = useMemo(() => {
    let cumulativeHits = 0;
    let cumulativeTrials = 0;

    return blocks.map((block, index) => {
      cumulativeHits += block.hits;
      cumulativeTrials += block.trials;
      return {
        blockIndex: index + 1,
        cumulativeHitRate: cumulativeTrials > 0 ? cumulativeHits / cumulativeTrials : 0,
      };
    });
  }, [blocks]);

  const maxBlocks = cumulativeData.length;
  const chartWidth = Math.min(800, maxBlocks * 20 + 100);
  const chartHeight = 200;

  if (maxBlocks === 0) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: 6 }}>
        No block data available
      </div>
    );
  }

  return (
    <div style={{
      border: '1px solid #e5e7eb',
      borderRadius: 6,
      padding: 16,
      background: '#fff',
      overflowX: 'auto'
    }}>
      <svg width={chartWidth} height={chartHeight} style={{ display: 'block' }}>
        {/* Grid lines */}
        <line x1={50} y1={20} x2={chartWidth - 20} y2={20} stroke="#e5e7eb" strokeWidth={1} />
        <line x1={50} y1={100} x2={chartWidth - 20} y2={100} stroke="#dc2626" strokeWidth={1} strokeDasharray="3,3" />
        <line x1={50} y1={180} x2={chartWidth - 20} y2={180} stroke="#e5e7eb" strokeWidth={1} />

        {/* Y-axis labels */}
        <text x={40} y={25} fontSize={10} fill="#6b7280" textAnchor="end">60%</text>
        <text x={40} y={105} fontSize={10} fill="#dc2626" textAnchor="end">50%</text>
        <text x={40} y={185} fontSize={10} fill="#6b7280" textAnchor="end">40%</text>

        {/* Performance line */}
        <polyline
          points={cumulativeData.map((d, i) => {
            const x = 50 + (i * (chartWidth - 70) / Math.max(1, maxBlocks - 1));
            const y = 180 - ((d.cumulativeHitRate - 0.4) / 0.2) * 160;
            return `${x},${Math.max(20, Math.min(180, y))}`;
          }).join(' ')}
          fill="none"
          stroke="#059669"
          strokeWidth={2}
        />

        {/* Data points */}
        {cumulativeData.map((d, i) => {
          const x = 50 + (i * (chartWidth - 70) / Math.max(1, maxBlocks - 1));
          const y = 180 - ((d.cumulativeHitRate - 0.4) / 0.2) * 160;
          return (
            <circle
              key={i}
              cx={x}
              cy={Math.max(20, Math.min(180, y))}
              r={3}
              fill="#059669"
            />
          );
        })}

        {/* X-axis label */}
        <text x={chartWidth / 2} y={chartHeight - 5} fontSize={12} fill="#374151" textAnchor="middle">
          Block Number
        </text>
      </svg>
    </div>
  );
}

// Temporal Structure Analysis Component
function TemporalStructureAnalysis({ sessions }) {
  const temporalMetrics = useMemo(() => {
    // Block-to-block analysis for individual blocks (each minute = ~150 trials = 1 block)
    const blockSequences = [];
    const sessionAnalytics = [];

    sessions.forEach(session => {
      const sessionBlocks = [];

      // Sort minutes by index to ensure proper temporal order
      const sortedMinutes = (session.minutes || []).sort((a, b) => (a.idx || 0) - (b.idx || 0));

      sortedMinutes.forEach(minute => {
        const hitRate = minute.n > 0 ? minute.hits / minute.n : 0.5;
        sessionBlocks.push({
          blockIndex: minute.idx || 0,
          hitRate,
          hits: minute.hits || 0,
          trials: minute.n || 0,
          condition: session.prime_condition || 'neutral'
        });
      });

      if (sessionBlocks.length >= 10) { // Need at least 10 blocks for meaningful analysis
        blockSequences.push(sessionBlocks);

        // Session-level analytics
        const hitRates = sessionBlocks.map(b => b.hitRate);
        const midpoint = Math.floor(hitRates.length / 2);
        const firstHalf = hitRates.slice(0, midpoint);
        const secondHalf = hitRates.slice(midpoint);

        sessionAnalytics.push({
          sessionId: session.id,
          participantId: session.participant_id,
          condition: session.prime_condition || 'neutral',
          totalBlocks: sessionBlocks.length,
          hitRates,
          firstHalfMean: firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length,
          secondHalfMean: secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length,
          overallMean: hitRates.reduce((a, b) => a + b, 0) / hitRates.length,
          turningPoints: countTurningPoints(hitRates),
          trend: calculateLinearTrend(hitRates)
        });
      }
    });

    if (blockSequences.length === 0) {
      return { message: 'Insufficient block-level data for temporal analysis' };
    }

    // Block-to-block autocorrelation analysis (lag 1-5)
    const blockAutocorrelations = {};
    const lags = [1, 2, 3, 4, 5];

    lags.forEach(lag => {
      const correlations = blockSequences.map(blocks => {
        const hitRates = blocks.map(b => b.hitRate);
        return computeAutocorrelation(hitRates, lag);
      }).filter(r => !isNaN(r) && isFinite(r));

      if (correlations.length > 0) {
        const mean = correlations.reduce((a, b) => a + b, 0) / correlations.length;
        const variance = correlations.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / correlations.length;

        blockAutocorrelations[lag] = {
          mean,
          std: Math.sqrt(variance),
          count: correlations.length,
          // Test against null hypothesis of zero correlation
          tStat: Math.abs(mean) / (Math.sqrt(variance / correlations.length)),
          significant: Math.abs(mean) / (Math.sqrt(variance / correlations.length)) > 1.96 // p < 0.05
        };
      }
    });

    // Sequential differences analysis
    const sequentialDiffs = blockSequences.map(blocks => {
      const hitRates = blocks.map(b => b.hitRate);
      const diffs = [];
      for (let i = 1; i < hitRates.length; i++) {
        diffs.push(hitRates[i] - hitRates[i - 1]);
      }
      return diffs;
    }).flat().filter(d => isFinite(d));

    const seqDiffMean = sequentialDiffs.length > 0 ?
      sequentialDiffs.reduce((a, b) => a + b, 0) / sequentialDiffs.length : 0;
    const seqDiffStd = sequentialDiffs.length > 0 ?
      Math.sqrt(sequentialDiffs.reduce((sum, val) => sum + Math.pow(val - seqDiffMean, 2), 0) / sequentialDiffs.length) : 0;

    // Comprehensive turning point analysis across all sessions
    const allTurningPointAnalyses = sessionAnalytics.map(s => analyzeTurningPoints(s.hitRates));
    const avgTurningPoints = allTurningPointAnalyses.length > 0 ? {
      totalPoints: allTurningPointAnalyses.reduce((sum, tp) => sum + tp.totalPoints, 0) / allTurningPointAnalyses.length,
      rate: allTurningPointAnalyses.reduce((sum, tp) => sum + tp.rate, 0) / allTurningPointAnalyses.length,
      expected: allTurningPointAnalyses.reduce((sum, tp) => sum + tp.expected, 0) / allTurningPointAnalyses.length,
      excess: allTurningPointAnalyses.reduce((sum, tp) => sum + tp.excess, 0) / allTurningPointAnalyses.length,
      excessPercent: allTurningPointAnalyses.reduce((sum, tp) => sum + tp.excessPercent, 0) / allTurningPointAnalyses.length,
      maxima: allTurningPointAnalyses.reduce((sum, tp) => sum + tp.maxima, 0) / allTurningPointAnalyses.length,
      minima: allTurningPointAnalyses.reduce((sum, tp) => sum + tp.minima, 0) / allTurningPointAnalyses.length,
      ratio: allTurningPointAnalyses.reduce((sum, tp) => sum + tp.ratio, 0) / allTurningPointAnalyses.length
    } : {
      totalPoints: 0, rate: 0, expected: 0, excess: 0, excessPercent: 0, maxima: 0, minima: 0, ratio: 0
    };

    const firstHalfPerf = sessionAnalytics.map(s => s.firstHalfMean);
    const secondHalfPerf = sessionAnalytics.map(s => s.secondHalfMean);
    const halfDifferences = sessionAnalytics.map(s => s.secondHalfMean - s.firstHalfMean);

    const avgFirstHalf = firstHalfPerf.length > 0 ?
      firstHalfPerf.reduce((a, b) => a + b, 0) / firstHalfPerf.length : 0;
    const avgSecondHalf = secondHalfPerf.length > 0 ?
      secondHalfPerf.reduce((a, b) => a + b, 0) / secondHalfPerf.length : 0;
    const avgHalfDiff = halfDifferences.length > 0 ?
      halfDifferences.reduce((a, b) => a + b, 0) / halfDifferences.length : 0;

    // t-test for first vs second half difference
    const halfDiffVariance = halfDifferences.length > 0 ?
      halfDifferences.reduce((sum, val) => sum + Math.pow(val - avgHalfDiff, 2), 0) / halfDifferences.length : 0;
    const halfDiffTStat = halfDifferences.length > 0 ?
      avgHalfDiff / Math.sqrt(halfDiffVariance / halfDifferences.length) : 0;

    // Combined sequence for runs test
    const combinedHitRates = blockSequences.flat().map(b => b.hitRate);
    const runsTestSequence = combinedHitRates.map(rate => rate > 0.5 ? 1 : 0);
    const runsTestRaw = runsTestSequence.length > 0 ? computeRunsTest(runsTestSequence) : null;
    const runsTest = runsTestRaw ? {
      statistic: runsTestRaw.z,
      pValue: runsTestRaw.p,
      expected: runsTestRaw.expected,
      numRuns: runsTestRaw.numRuns
    } : { statistic: 0, pValue: 1, expected: 0, numRuns: 0 };

    return {
      totalSessions: sessionAnalytics.length,
      totalBlocks: combinedHitRates.length,
      blockAutocorrelations,
      sequentialDifferences: {
        mean: seqDiffMean,
        std: seqDiffStd,
        count: sequentialDiffs.length
      },
      turningPoints: avgTurningPoints,
      firstVsSecondHalf: {
        firstHalfMean: avgFirstHalf,
        secondHalfMean: avgSecondHalf,
        difference: avgHalfDiff,
        tStatistic: halfDiffTStat,
        significant: Math.abs(halfDiffTStat) > 1.96,
        sessions: sessionAnalytics.length
      },
      runsTest,
      sessionAnalytics
    };
  }, [sessions]);

  if (temporalMetrics.message) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: '#6b7280' }}>
        {temporalMetrics.message}
      </div>
    );
  }

  return (
    <div>
      <h3 style={{ marginBottom: 16, color: '#374151' }}>Block-to-Block Temporal Analysis</h3>

      {/* Overview Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa' }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Sessions Analyzed</div>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: '#374151' }}>
            {temporalMetrics.totalSessions}
          </div>
        </div>
        <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa' }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Total Blocks</div>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: '#374151' }}>
            {temporalMetrics.totalBlocks}
          </div>
        </div>
        {/* Comprehensive Turning Point Analysis Card */}
        <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#f8f9fa', gridColumn: 'span 2' }}>
          <div style={{ fontSize: 14, fontWeight: 'bold', color: '#374151', marginBottom: 12 }}>Turning Point Analysis</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, fontSize: 12 }}>
            <div>
              <div style={{ color: '#6b7280', marginBottom: 2 }}>Total Points</div>
              <div style={{ fontSize: 16, fontWeight: 'bold', color: '#374151' }}>
                {temporalMetrics.turningPoints.totalPoints.toFixed(1)}
              </div>
            </div>
            <div>
              <div style={{ color: '#6b7280', marginBottom: 2 }}>Rate per Block</div>
              <div style={{ fontSize: 16, fontWeight: 'bold', color: '#374151' }}>
                {temporalMetrics.turningPoints.rate.toFixed(2)}
              </div>
            </div>
            <div>
              <div style={{ color: '#6b7280', marginBottom: 2 }}>Expected (Random)</div>
              <div style={{ fontSize: 16, fontWeight: 'bold', color: '#6b7280' }}>
                {temporalMetrics.turningPoints.expected.toFixed(1)}
              </div>
            </div>
            <div>
              <div style={{ color: '#6b7280', marginBottom: 2 }}>Excess vs Random</div>
              <div style={{ fontSize: 16, fontWeight: 'bold', color: temporalMetrics.turningPoints.excess > 0 ? '#059669' : '#dc2626' }}>
                {temporalMetrics.turningPoints.excess > 0 ? '+' : ''}{temporalMetrics.turningPoints.excess.toFixed(1)}
              </div>
            </div>
            <div>
              <div style={{ color: '#6b7280', marginBottom: 2 }}>% Above Random</div>
              <div style={{ fontSize: 16, fontWeight: 'bold', color: temporalMetrics.turningPoints.excessPercent > 0 ? '#059669' : '#dc2626' }}>
                {temporalMetrics.turningPoints.excessPercent > 0 ? '+' : ''}{temporalMetrics.turningPoints.excessPercent.toFixed(0)}%
              </div>
            </div>
            <div>
              <div style={{ color: '#6b7280', marginBottom: 2 }}>Max/Min Ratio</div>
              <div style={{ fontSize: 16, fontWeight: 'bold', color: '#374151' }}>
                {isFinite(temporalMetrics.turningPoints.ratio) ? temporalMetrics.turningPoints.ratio.toFixed(2) : 'N/A'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Block Autocorrelation (Lag 1-5) */}
      <div style={{ marginBottom: 24 }}>
        <h4 style={{ marginBottom: 12, color: '#374151' }}>Lag-1 to Lag-5 Autocorrelation of Block Performance</h4>
        <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 12 }}>
          Serial correlation between consecutive blocks (each block ≈ 150 trials)
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
          {Object.entries(temporalMetrics.blockAutocorrelations || {}).map(([lag, stats]) => (
            <div key={lag} style={{
              padding: 12,
              border: '1px solid #e5e7eb',
              borderRadius: 6,
              background: stats?.significant ? '#fef3c7' : '#fafafa'
            }}>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Lag {lag}</div>
              <div style={{ fontSize: 16, fontWeight: 'bold', color: stats?.significant ? '#92400e' : '#374151' }}>
                {stats?.mean?.toFixed(4) || 'N/A'}
                {stats?.significant && ' *'}
              </div>
              <div style={{ fontSize: 10, color: '#6b7280' }}>
                ±{stats?.std?.toFixed(4) || 'N/A'}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* First vs Second Half Analysis */}
      <div style={{ marginBottom: 24 }}>
        <h4 style={{ marginBottom: 12, color: '#374151' }}>First-Half vs Second-Half Performance Comparison Within Sessions</h4>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#f0f9ff' }}>
            <div style={{ fontSize: 12, color: '#0369a1', marginBottom: 4 }}>First Half Mean</div>
            <div style={{ fontSize: 18, fontWeight: 'bold', color: '#0369a1' }}>
              {(temporalMetrics.firstVsSecondHalf.firstHalfMean * 100).toFixed(2)}%
            </div>
          </div>
          <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#f0fdf4' }}>
            <div style={{ fontSize: 12, color: '#059669', marginBottom: 4 }}>Second Half Mean</div>
            <div style={{ fontSize: 18, fontWeight: 'bold', color: '#059669' }}>
              {(temporalMetrics.firstVsSecondHalf.secondHalfMean * 100).toFixed(2)}%
            </div>
          </div>
          <div style={{
            padding: 16,
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            background: temporalMetrics.firstVsSecondHalf.significant ? '#fef3c7' : '#f5f5f5'
          }}>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Difference</div>
            <div style={{
              fontSize: 18,
              fontWeight: 'bold',
              color: temporalMetrics.firstVsSecondHalf.significant ? '#92400e' : '#374151'
            }}>
              {(temporalMetrics.firstVsSecondHalf.difference > 0 ? '+' : '')}{(temporalMetrics.firstVsSecondHalf.difference * 100).toFixed(2)}%
              {temporalMetrics.firstVsSecondHalf.significant && ' *'}
            </div>
            <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>
              t = {temporalMetrics.firstVsSecondHalf.tStatistic.toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      {/* Sequential Changes */}
      <div style={{ marginBottom: 24 }}>
        <h4 style={{ marginBottom: 12, color: '#374151' }}>Sequential Differences Between Consecutive Blocks</h4>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa' }}>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Mean Change</div>
            <div style={{ fontSize: 18, fontWeight: 'bold', color: '#374151' }}>
              {(temporalMetrics.sequentialDifferences.mean * 100).toFixed(3)}%
            </div>
          </div>
          <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa' }}>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Std Deviation</div>
            <div style={{ fontSize: 18, fontWeight: 'bold', color: '#374151' }}>
              {(temporalMetrics.sequentialDifferences.std * 100).toFixed(3)}%
            </div>
          </div>
          <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa' }}>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Sample Size</div>
            <div style={{ fontSize: 18, fontWeight: 'bold', color: '#374151' }}>
              {temporalMetrics.sequentialDifferences.count}
            </div>
          </div>
        </div>
      </div>

      {/* Randomness Testing */}
      <div style={{ marginBottom: 24 }}>
        <h4 style={{ marginBottom: 12, color: '#374151' }}>Randomness Testing</h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa' }}>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Runs Test Statistic</div>
            <div style={{ fontSize: 20, fontWeight: 'bold', color: '#374151' }}>
              {temporalMetrics.runsTest?.statistic?.toFixed(3) || 'N/A'}
            </div>
          </div>

          <PBadge
            label="Runs Test (Randomness)"
            p={temporalMetrics.runsTest?.pValue || 1}
            style={{ padding: 16 }}
          />
        </div>
      </div>

      <div style={{ fontSize: 12, color: '#6b7280', fontStyle: 'italic' }}>
        * indicates statistical significance (p &lt; 0.05)
      </div>
    </div>
  );
}

// Entropy Signatures Component
function EntropySignatures({ sessions }) {
  const entropyMetrics = useMemo(() => {
    const entropyValues = [];
    const entropyBySession = [];

    sessions.forEach(session => {
      const sessionEntropy = [];
      (session.minutes || []).forEach(minute => {
        // Extract entropy windows from the new structure
        const subjWindows = minute.entropy?.new_windows_subj || [];
        subjWindows.forEach(window => {
          if (typeof window.entropy === 'number' && !isNaN(window.entropy)) {
            entropyValues.push(window.entropy);
            sessionEntropy.push(window.entropy);
          }
        });
      });

      if (sessionEntropy.length > 0) {
        entropyBySession.push({
          sessionId: session.id,
          participantId: session.participant_id,
          condition: session.prime_condition,
          binaural: session.binaural_beats,
          entropies: sessionEntropy,
          meanEntropy: sessionEntropy.reduce((a, b) => a + b, 0) / sessionEntropy.length,
          stdEntropy: Math.sqrt(sessionEntropy.reduce((sum, val) => {
            const mean = sessionEntropy.reduce((a, b) => a + b, 0) / sessionEntropy.length;
            return sum + Math.pow(val - mean, 2);
          }, 0) / sessionEntropy.length),
        });
      }
    });

    if (entropyValues.length === 0) {
      return { message: 'No entropy data available for analysis' };
    }

    // Overall statistics
    const mean = entropyValues.reduce((a, b) => a + b, 0) / entropyValues.length;
    const std = Math.sqrt(entropyValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / entropyValues.length);
    const min = Math.min(...entropyValues);
    const max = Math.max(...entropyValues);

    // Distribution analysis (histogram bins)
    const bins = 20;
    const binWidth = (max - min) / bins;
    const histogram = new Array(bins).fill(0);

    entropyValues.forEach(value => {
      const binIndex = Math.min(Math.floor((value - min) / binWidth), bins - 1);
      histogram[binIndex]++;
    });

    // Condition comparison
    const primeEntropies = entropyBySession.filter(s => s.condition === 'prime').flatMap(s => s.entropies);
    const neutralEntropies = entropyBySession.filter(s => s.condition === 'neutral').flatMap(s => s.entropies);

    const primeMean = primeEntropies.length > 0 ? primeEntropies.reduce((a, b) => a + b, 0) / primeEntropies.length : 0;
    const neutralMean = neutralEntropies.length > 0 ? neutralEntropies.reduce((a, b) => a + b, 0) / neutralEntropies.length : 0;

    return {
      totalWindows: entropyValues.length,
      totalSessions: entropyBySession.length,
      mean,
      std,
      min,
      max,
      histogram,
      binWidth,
      binStart: min,
      primeMean,
      neutralMean,
      conditionDiff: primeMean - neutralMean,
      entropyBySession,
    };
  }, [sessions]);

  if (entropyMetrics.message) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: '#6b7280' }}>
        {entropyMetrics.message}
      </div>
    );
  }

  return (
    <div>
      <h3 style={{ marginBottom: 16, color: '#374151' }}>Shannon Entropy Distribution</h3>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa' }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Mean Entropy</div>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: '#374151' }}>
            {entropyMetrics.mean.toFixed(4)}
          </div>
        </div>

        <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa' }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Std Deviation</div>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: '#374151' }}>
            {entropyMetrics.std.toFixed(4)}
          </div>
        </div>

        <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa' }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Range</div>
          <div style={{ fontSize: 16, fontWeight: 'bold', color: '#374151' }}>
            {entropyMetrics.min.toFixed(3)} - {entropyMetrics.max.toFixed(3)}
          </div>
        </div>

        <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa' }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Total Windows</div>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: '#374151' }}>
            {entropyMetrics.totalWindows.toLocaleString()}
          </div>
        </div>
      </div>

      <h4 style={{ marginBottom: 12, color: '#374151' }}>Entropy by Condition</h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
        <div style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 6, background: '#fef3c7' }}>
          <div style={{ fontSize: 12, color: '#92400e', marginBottom: 4 }}>Prime Condition</div>
          <div style={{ fontSize: 18, fontWeight: 'bold', color: '#92400e' }}>
            {entropyMetrics.primeMean.toFixed(4)}
          </div>
        </div>

        <div style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 6, background: '#e0f2fe' }}>
          <div style={{ fontSize: 12, color: '#0369a1', marginBottom: 4 }}>Neutral Condition</div>
          <div style={{ fontSize: 18, fontWeight: 'bold', color: '#0369a1' }}>
            {entropyMetrics.neutralMean.toFixed(4)}
          </div>
        </div>

        <div style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 6, background: '#f3e8ff' }}>
          <div style={{ fontSize: 12, color: '#7c3aed', marginBottom: 4 }}>Prime - Neutral</div>
          <div style={{ fontSize: 18, fontWeight: 'bold', color: entropyMetrics.conditionDiff > 0 ? '#059669' : '#dc2626' }}>
            {(entropyMetrics.conditionDiff > 0 ? '+' : '')}{entropyMetrics.conditionDiff.toFixed(4)}
          </div>
        </div>
      </div>

      <h4 style={{ marginBottom: 12, color: '#374151' }}>Entropy Distribution Histogram</h4>
      <EntropyHistogram metrics={entropyMetrics} />
    </div>
  );
}

// Simple histogram component for entropy distribution
function EntropyHistogram({ metrics }) {
  const maxCount = Math.max(...metrics.histogram);
  const chartWidth = 600;
  const chartHeight = 200;
  const barWidth = (chartWidth - 100) / metrics.histogram.length;

  return (
    <div style={{
      border: '1px solid #e5e7eb',
      borderRadius: 6,
      padding: 16,
      background: '#fff',
      overflowX: 'auto'
    }}>
      <svg width={chartWidth} height={chartHeight} style={{ display: 'block' }}>
        {/* Bars */}
        {metrics.histogram.map((count, i) => {
          const barHeight = maxCount > 0 ? (count / maxCount) * 140 : 0;
          const x = 50 + i * barWidth;
          const y = 160 - barHeight;

          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={barWidth * 0.8}
              height={barHeight}
              fill="#3b82f6"
              opacity={0.7}
            />
          );
        })}

        {/* X-axis */}
        <line x1={50} y1={160} x2={chartWidth - 20} y2={160} stroke="#374151" strokeWidth={1} />

        {/* Y-axis */}
        <line x1={50} y1={20} x2={50} y2={160} stroke="#374151" strokeWidth={1} />

        {/* Axis labels */}
        <text x={25} y={25} fontSize={10} fill="#6b7280" textAnchor="middle" transform="rotate(-90, 25, 25)">
          Count
        </text>
        <text x={chartWidth / 2} y={190} fontSize={12} fill="#374151" textAnchor="middle">
          Shannon Entropy
        </text>

        {/* Tick marks and labels */}
        {[0, 0.25, 0.5, 0.75, 1.0].map((frac, i) => {
          const binIndex = Math.floor(frac * (metrics.histogram.length - 1));
          const x = 50 + binIndex * barWidth + barWidth / 2;
          const value = metrics.binStart + binIndex * metrics.binWidth;

          return (
            <g key={i}>
              <line x1={x} y1={160} x2={x} y2={165} stroke="#374151" strokeWidth={1} />
              <text x={x} y={178} fontSize={10} fill="#6b7280" textAnchor="middle">
                {value.toFixed(2)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// Individual Difference Tracking Component
function IndividualDifferenceTracking({ sessions }) {
  const participantMetrics = useMemo(() => {
    const participantData = {};

    sessions.forEach(session => {
      const pid = session.participant_id;
      if (!participantData[pid]) {
        participantData[pid] = {
          participantId: pid,
          sessions: [],
          totalHits: 0,
          totalTrials: 0,
          totalEntropy: 0,
          entropyWindows: 0,
          conditions: new Set(),
          binauralUse: new Set(),
        };
      }

      const participant = participantData[pid];
      let sessionHits = 0;
      let sessionTrials = 0;
      let sessionEntropy = 0;
      let sessionEntropyWindows = 0;

      (session.minutes || []).forEach(minute => {
        sessionHits += minute.hits || 0;
        sessionTrials += minute.n || 0;

        // Extract entropy windows from the new structure
        const subjWindows = minute.entropy?.new_windows_subj || [];
        subjWindows.forEach(window => {
          if (typeof window.entropy === 'number' && !isNaN(window.entropy)) {
            sessionEntropy += window.entropy;
            sessionEntropyWindows++;
          }
        });
      });

      participant.sessions.push({
        sessionId: session.id,
        hitRate: sessionTrials > 0 ? sessionHits / sessionTrials : 0,
        hits: sessionHits,
        trials: sessionTrials,
        avgEntropy: sessionEntropyWindows > 0 ? sessionEntropy / sessionEntropyWindows : 0,
        entropyWindows: sessionEntropyWindows,
        condition: session.prime_condition,
        binaural: session.binaural_beats,
        createdAt: session.createdAt,
      });

      participant.totalHits += sessionHits;
      participant.totalTrials += sessionTrials;
      participant.totalEntropy += sessionEntropy;
      participant.entropyWindows += sessionEntropyWindows;

      if (session.prime_condition) participant.conditions.add(session.prime_condition);
      if (session.binaural_beats) participant.binauralUse.add(session.binaural_beats);
    });

    // Calculate overall metrics for each participant
    const participants = Object.values(participantData).map(p => ({
      ...p,
      overallHitRate: p.totalTrials > 0 ? p.totalHits / p.totalTrials : 0,
      avgEntropy: p.entropyWindows > 0 ? p.totalEntropy / p.entropyWindows : 0,
      sessionCount: p.sessions.length,
      conditions: Array.from(p.conditions),
      binauralUse: Array.from(p.binauralUse),
    }));

    // Sort by total trials (most active participants first)
    participants.sort((a, b) => b.totalTrials - a.totalTrials);

    // Calculate group statistics
    const hitRates = participants.map(p => p.overallHitRate).filter(hr => hr > 0);
    const meanHitRate = hitRates.length > 0 ? hitRates.reduce((a, b) => a + b, 0) / hitRates.length : 0;
    const stdHitRate = hitRates.length > 0 ? Math.sqrt(hitRates.reduce((sum, val) => sum + Math.pow(val - meanHitRate, 2), 0) / hitRates.length) : 0;

    return {
      participants,
      totalParticipants: participants.length,
      meanHitRate,
      stdHitRate,
      topPerformers: participants.filter(p => p.overallHitRate > meanHitRate + stdHitRate),
      lowPerformers: participants.filter(p => p.overallHitRate < meanHitRate - stdHitRate),
    };
  }, [sessions]);

  return (
    <div>
      <h3 style={{ marginBottom: 16, color: '#374151' }}>Participant Overview</h3>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa' }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Total Participants</div>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: '#374151' }}>
            {participantMetrics.totalParticipants}
          </div>
        </div>

        <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa' }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Mean Hit Rate</div>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: '#374151' }}>
            {(participantMetrics.meanHitRate * 100).toFixed(2)}%
          </div>
        </div>

        <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa' }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Hit Rate Std Dev</div>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: '#374151' }}>
            {(participantMetrics.stdHitRate * 100).toFixed(2)}%
          </div>
        </div>

        <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa' }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>High Performers</div>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: '#059669' }}>
            {participantMetrics.topPerformers.length}
          </div>
        </div>
      </div>

      <h4 style={{ marginBottom: 12, color: '#374151' }}>Top Participants by Activity</h4>
      <div style={{ maxHeight: 400, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 6 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ background: '#f9fafb', position: 'sticky', top: 0 }}>
            <tr>
              <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 12, color: '#374151', borderBottom: '1px solid #e5e7eb' }}>
                Participant
              </th>
              <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 12, color: '#374151', borderBottom: '1px solid #e5e7eb' }}>
                Sessions
              </th>
              <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 12, color: '#374151', borderBottom: '1px solid #e5e7eb' }}>
                Trials
              </th>
              <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 12, color: '#374151', borderBottom: '1px solid #e5e7eb' }}>
                Hit Rate
              </th>
              <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 12, color: '#374151', borderBottom: '1px solid #e5e7eb' }}>
                Avg Entropy
              </th>
              <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 12, color: '#374151', borderBottom: '1px solid #e5e7eb' }}>
                Conditions
              </th>
            </tr>
          </thead>
          <tbody>
            {participantMetrics.participants.slice(0, 20).map((participant, index) => (
              <tr key={participant.participantId} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '8px 12px', fontSize: 12, fontFamily: 'monospace' }}>
                  {participant.participantId.substring(0, 8)}...
                </td>
                <td style={{ padding: '8px 12px', fontSize: 12 }}>
                  {participant.sessionCount}
                </td>
                <td style={{ padding: '8px 12px', fontSize: 12 }}>
                  {participant.totalTrials.toLocaleString()}
                </td>
                <td style={{
                  padding: '8px 12px',
                  fontSize: 12,
                  fontWeight: 'bold',
                  color: participant.overallHitRate > participantMetrics.meanHitRate ? '#059669' : '#dc2626'
                }}>
                  {(participant.overallHitRate * 100).toFixed(1)}%
                </td>
                <td style={{ padding: '8px 12px', fontSize: 12 }}>
                  {participant.avgEntropy.toFixed(4)}
                </td>
                <td style={{ padding: '8px 12px', fontSize: 12 }}>
                  {participant.conditions.join(', ') || 'N/A'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Control Validations Component
function ControlValidations({ sessions, stats }) {
  const controlMetrics = useMemo(() => {
    let totalGhostHits = 0;
    let totalGhostTrials = 0;
    let totalSystemHits = 0;
    let totalSystemTrials = 0;
    let dataMissingCount = 0;
    let totalMinutes = 0;

    const criticalRatios = [];
    const sessionHealthScores = [];

    sessions.forEach(session => {
      let sessionGhostHits = 0;
      let sessionGhostTrials = 0;
      let sessionSystemHits = 0;
      let sessionSystemTrials = 0;
      let sessionMinutes = 0;
      let sessionMissingData = 0;

      (session.minutes || []).forEach(minute => {
        sessionMinutes++;
        totalMinutes++;

        // Ghost (control) data
        const ghostHits = minute.ghost_hits || 0;
        const ghostTrials = minute.n || 0;
        sessionGhostHits += ghostHits;
        sessionGhostTrials += ghostTrials;
        totalGhostHits += ghostHits;
        totalGhostTrials += ghostTrials;

        // System (control) data if available
        const systemHits = minute.system_hits || 0;
        const systemTrials = minute.n || 0;
        sessionSystemHits += systemHits;
        sessionSystemTrials += systemTrials;
        totalSystemHits += systemHits;
        totalSystemTrials += systemTrials;

        // Data quality checks
        if (!minute.hits || !minute.ghost_hits || minute.n === 0) {
          sessionMissingData++;
          dataMissingCount++;
        }
      });

      // Calculate session-level metrics
      const sessionGhostRate = sessionGhostTrials > 0 ? sessionGhostHits / sessionGhostTrials : 0;
      const sessionSubjRate = session.minutes ?
        session.minutes.reduce((sum, m) => sum + (m.hits || 0), 0) /
        session.minutes.reduce((sum, m) => sum + (m.n || 0), 0) : 0;

      // Critical ratio (how far from 50% both controls are)
      const ghostDeviation = Math.abs(sessionGhostRate - 0.5);
      const subjDeviation = Math.abs(sessionSubjRate - 0.5);
      const criticalRatio = sessionGhostTrials > 0 ? subjDeviation / Math.max(ghostDeviation, 0.001) : 0;

      criticalRatios.push(criticalRatio);

      // Session health score (lower is better)
      const dataCompletion = sessionMinutes > 0 ? 1 - (sessionMissingData / sessionMinutes) : 0;
      const ghostProximityToChance = 1 - Math.abs(sessionGhostRate - 0.5) * 2; // 1 = perfect 50%, 0 = extreme deviation
      const healthScore = (dataCompletion * 0.6) + (ghostProximityToChance * 0.4);

      sessionHealthScores.push({
        sessionId: session.id,
        participantId: session.participant_id,
        healthScore,
        dataCompletion,
        ghostRate: sessionGhostRate,
        subjRate: sessionSubjRate,
        criticalRatio,
      });
    });

    // Overall control statistics
    const overallGhostRate = totalGhostTrials > 0 ? totalGhostHits / totalGhostTrials : 0;
    const overallSystemRate = totalSystemTrials > 0 ? totalSystemHits / totalSystemTrials : 0;
    const dataCompletionRate = totalMinutes > 0 ? 1 - (dataMissingCount / totalMinutes) : 0;

    // Ghost deviation from expected 50%
    const ghostZ = totalGhostTrials > 0 ?
      (overallGhostRate - 0.5) / Math.sqrt(0.25 / totalGhostTrials) : 0;
    const ghostP = 2 * (1 - cdf(Math.abs(ghostZ)));

    // Average critical ratio
    const avgCriticalRatio = criticalRatios.length > 0 ?
      criticalRatios.reduce((a, b) => a + b, 0) / criticalRatios.length : 0;

    // Health score distribution
    const avgHealthScore = sessionHealthScores.length > 0 ?
      sessionHealthScores.reduce((sum, s) => sum + s.healthScore, 0) / sessionHealthScores.length : 0;

    return {
      overallGhostRate,
      overallSystemRate,
      ghostZ,
      ghostP,
      dataCompletionRate,
      avgCriticalRatio,
      avgHealthScore,
      totalGhostTrials,
      totalSystemTrials,
      sessionHealthScores: sessionHealthScores.sort((a, b) => a.healthScore - b.healthScore), // Lowest health first
    };
  }, [sessions, stats]);

  // Standard normal CDF approximation (reusing from above)
  function cdf(z) {
    return 0.5 * (1 + erf(z / Math.sqrt(2)));
  }

  function erf(x) {
    const a1 =  0.254829592;
    const a2 = -0.284496736;
    const a3 =  1.421413741;
    const a4 = -1.453152027;
    const a5 =  1.061405429;
    const p  =  0.3275911;

    const sign = x >= 0 ? 1 : -1;
    x = Math.abs(x);

    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

    return sign * y;
  }

  return (
    <div>
      <h3 style={{ marginBottom: 16, color: '#374151' }}>System Health Metrics</h3>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa' }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Ghost Hit Rate</div>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: '#374151' }}>
            {(controlMetrics.overallGhostRate * 100).toFixed(2)}%
          </div>
          <div style={{ fontSize: 10, color: '#6b7280' }}>
            Expected: 50.00%
          </div>
        </div>

        <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa' }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Data Completion</div>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: controlMetrics.dataCompletionRate > 0.95 ? '#059669' : '#dc2626' }}>
            {(controlMetrics.dataCompletionRate * 100).toFixed(1)}%
          </div>
        </div>

        <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa' }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Avg Health Score</div>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: controlMetrics.avgHealthScore > 0.8 ? '#059669' : '#dc2626' }}>
            {controlMetrics.avgHealthScore.toFixed(3)}
          </div>
        </div>

        <PBadge
          label="Ghost vs Chance (50%)"
          p={controlMetrics.ghostP}
          style={{ padding: 16 }}
        />
      </div>

      <h4 style={{ marginBottom: 12, color: '#374151' }}>Critical Ratio Analysis</h4>
      <div style={{ marginBottom: 24, padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#f9fafb' }}>
        <div style={{ fontSize: 14, color: '#374151', marginBottom: 8 }}>
          <strong>Average Critical Ratio:</strong> {controlMetrics.avgCriticalRatio.toFixed(3)}
        </div>
        <div style={{ fontSize: 12, color: '#6b7280' }}>
          Critical ratio measures subject deviation relative to ghost deviation from chance.
          Values &gt; 1.0 suggest subject performance exceeds random variation.
        </div>
      </div>

      <h4 style={{ marginBottom: 12, color: '#374151' }}>Session Health Overview</h4>
      <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 6 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ background: '#f9fafb', position: 'sticky', top: 0 }}>
            <tr>
              <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 12, color: '#374151', borderBottom: '1px solid #e5e7eb' }}>
                Session
              </th>
              <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 12, color: '#374151', borderBottom: '1px solid #e5e7eb' }}>
                Health Score
              </th>
              <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 12, color: '#374151', borderBottom: '1px solid #e5e7eb' }}>
                Ghost Rate
              </th>
              <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 12, color: '#374151', borderBottom: '1px solid #e5e7eb' }}>
                Subject Rate
              </th>
              <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 12, color: '#374151', borderBottom: '1px solid #e5e7eb' }}>
                Critical Ratio
              </th>
            </tr>
          </thead>
          <tbody>
            {controlMetrics.sessionHealthScores.slice(0, 15).map((session, index) => (
              <tr key={session.sessionId} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '8px 12px', fontSize: 12, fontFamily: 'monospace' }}>
                  {session.sessionId.substring(0, 8)}...
                </td>
                <td style={{
                  padding: '8px 12px',
                  fontSize: 12,
                  fontWeight: 'bold',
                  color: session.healthScore > 0.8 ? '#059669' : session.healthScore > 0.6 ? '#d97706' : '#dc2626'
                }}>
                  {session.healthScore.toFixed(3)}
                </td>
                <td style={{
                  padding: '8px 12px',
                  fontSize: 12,
                  color: Math.abs(session.ghostRate - 0.5) < 0.05 ? '#059669' : '#dc2626'
                }}>
                  {(session.ghostRate * 100).toFixed(1)}%
                </td>
                <td style={{ padding: '8px 12px', fontSize: 12 }}>
                  {(session.subjRate * 100).toFixed(1)}%
                </td>
                <td style={{
                  padding: '8px 12px',
                  fontSize: 12,
                  fontWeight: session.criticalRatio > 1.0 ? 'bold' : 'normal',
                  color: session.criticalRatio > 1.0 ? '#7c3aed' : '#6b7280'
                }}>
                  {session.criticalRatio.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Exploratory Signatures Component (placeholder for advanced oscillation analysis)
// Exploratory Signatures Component - Advanced pattern detection including harmonic oscillations
function ExploratorySignatures({ sessions }) {
  const exploratoryMetrics = useMemo(() => {
    // Aggregate all hit sequences across sessions for pattern analysis
    const allSequences = [];
    const hitRateTimeSeries = [];
    const entropyTimeSeries = [];
    const blockMetrics = [];

    sessions.forEach(session => {
      const sessionHits = [];
      const sessionEntropies = [];

      (session.minutes || []).forEach((minute, idx) => {
        const hits = minute.hits || 0;
        const trials = minute.n || 0;
        const hitRate = trials > 0 ? hits / trials : 0.5;

        hitRateTimeSeries.push(hitRate);
        sessionHits.push(hitRate);

        // Extract entropy from windows
        const windows = minute.entropy?.new_windows_subj || [];
        if (windows.length > 0) {
          const meanEntropy = windows.reduce((sum, w) => sum + (w.entropy || 0), 0) / windows.length;
          entropyTimeSeries.push(meanEntropy);
          sessionEntropies.push(meanEntropy);
        }
      });

      if (sessionHits.length > 0) {
        allSequences.push(sessionHits);
        blockMetrics.push({
          sessionId: session.id,
          participantId: session.participant_id,
          condition: session.prime_condition,
          hitRates: sessionHits,
          entropies: sessionEntropies,
          mean: sessionHits.reduce((a, b) => a + b, 0) / sessionHits.length,
          trend: calculateLinearTrend(sessionHits),
          oscillation: detectOscillation(sessionHits)
        });
      }
    });

    if (hitRateTimeSeries.length === 0) {
      return { message: 'No data available for exploratory analysis' };
    }

    // Perform spectral analysis on the aggregated hit rate time series
    const spectralAnalysis = performSpectralAnalysis(hitRateTimeSeries);
    const harmonicAnalysis = detectHarmonicOscillations(hitRateTimeSeries);
    const entropySpectral = entropyTimeSeries.length > 0 ? performSpectralAnalysis(entropyTimeSeries) : null;

    // Cross-correlation between hit rates and entropy
    const crossCorrelation = entropyTimeSeries.length > 0 ?
      calculateCrossCorrelation(hitRateTimeSeries, entropyTimeSeries) : null;

    // Detect dampened oscillator patterns
    const dampedOscillator = detectDampedOscillator(hitRateTimeSeries);

    return {
      totalDataPoints: hitRateTimeSeries.length,
      totalSessions: blockMetrics.length,
      spectralAnalysis,
      harmonicAnalysis,
      entropySpectral,
      crossCorrelation,
      dampedOscillator,
      blockMetrics,
      overallTrend: calculateLinearTrend(hitRateTimeSeries),
    };
  }, [sessions]);

  if (exploratoryMetrics.message) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: '#6b7280' }}>
        {exploratoryMetrics.message}
      </div>
    );
  }

  return (
    <div>
      <h3 style={{ marginBottom: 16, color: '#374151' }}>Oscillation Detection & Spectral Analysis</h3>

      {/* Overall Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa' }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Total Data Points</div>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: '#374151' }}>
            {exploratoryMetrics.totalDataPoints}
          </div>
        </div>
        <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa' }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Sessions Analyzed</div>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: '#374151' }}>
            {exploratoryMetrics.totalSessions}
          </div>
        </div>
        <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa' }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Overall Trend</div>
          <div style={{ fontSize: 16, fontWeight: 'bold', color: exploratoryMetrics.overallTrend.slope > 0 ? '#059669' : '#dc2626' }}>
            {exploratoryMetrics.overallTrend.slope > 0 ? 'Increasing' : 'Decreasing'}
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
              R² = {exploratoryMetrics.overallTrend.r2.toFixed(3)}
            </div>
          </div>
        </div>
      </div>

      {/* Harmonic Detection */}
      <div style={{ marginBottom: 24 }}>
        <h4 style={{ marginBottom: 12, color: '#374151' }}>Harmonic Oscillation Analysis</h4>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#f0f9ff' }}>
            <div style={{ fontSize: 14, fontWeight: 'bold', color: '#0369a1', marginBottom: 8 }}>
              Dominant Frequency
            </div>
            <div style={{ fontSize: 18, color: '#374151' }}>
              {exploratoryMetrics.harmonicAnalysis.dominantFreq.toFixed(4)} cycles/minute
            </div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
              Power: {exploratoryMetrics.harmonicAnalysis.dominantPower.toFixed(3)}
            </div>
          </div>
          <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#f0fdf4' }}>
            <div style={{ fontSize: 14, fontWeight: 'bold', color: '#059669', marginBottom: 8 }}>
              Oscillation Strength
            </div>
            <div style={{ fontSize: 18, color: '#374151' }}>
              {(exploratoryMetrics.harmonicAnalysis.oscillationStrength * 100).toFixed(1)}%
            </div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
              Coherence: {exploratoryMetrics.harmonicAnalysis.coherence.toFixed(3)}
            </div>
          </div>
        </div>
      </div>

      {/* Damped Oscillator Detection */}
      {exploratoryMetrics.dampedOscillator && (
        <div style={{ marginBottom: 24 }}>
          <h4 style={{ marginBottom: 12, color: '#374151' }}>Damped Harmonic Oscillator</h4>
          <div style={{ padding: 16, border: '1px solid #fef3c7', borderRadius: 8, background: '#fffbeb' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: '#92400e', marginBottom: 4 }}>Detected</div>
                <div style={{ fontSize: 16, fontWeight: 'bold', color: '#92400e' }}>
                  {exploratoryMetrics.dampedOscillator.detected ? 'YES' : 'NO'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#92400e', marginBottom: 4 }}>Damping Factor</div>
                <div style={{ fontSize: 16, fontWeight: 'bold', color: '#374151' }}>
                  {exploratoryMetrics.dampedOscillator.dampingFactor?.toFixed(4) || 'N/A'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#92400e', marginBottom: 4 }}>Natural Freq</div>
                <div style={{ fontSize: 16, fontWeight: 'bold', color: '#374151' }}>
                  {exploratoryMetrics.dampedOscillator.naturalFreq?.toFixed(4) || 'N/A'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#92400e', marginBottom: 4 }}>Fit Quality</div>
                <div style={{ fontSize: 16, fontWeight: 'bold', color: '#374151' }}>
                  {exploratoryMetrics.dampedOscillator.fitQuality?.toFixed(3) || 'N/A'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cross-correlation with Entropy */}
      {exploratoryMetrics.crossCorrelation && (
        <div style={{ marginBottom: 24 }}>
          <h4 style={{ marginBottom: 12, color: '#374151' }}>Hit Rate - Entropy Cross-Correlation</h4>
          <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#f5f5f5' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Max Correlation</div>
                <div style={{ fontSize: 16, fontWeight: 'bold', color: '#374151' }}>
                  {exploratoryMetrics.crossCorrelation.maxCorr.toFixed(3)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Lag (minutes)</div>
                <div style={{ fontSize: 16, fontWeight: 'bold', color: '#374151' }}>
                  {exploratoryMetrics.crossCorrelation.maxLag}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Significance</div>
                <div style={{ fontSize: 16, fontWeight: 'bold',
                     color: Math.abs(exploratoryMetrics.crossCorrelation.maxCorr) > 0.3 ? '#059669' : '#6b7280' }}>
                  {Math.abs(exploratoryMetrics.crossCorrelation.maxCorr) > 0.3 ? 'Strong' : 'Weak'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Spectral Power Distribution */}
      <div style={{ marginBottom: 24 }}>
        <h4 style={{ marginBottom: 12, color: '#374151' }}>Power Spectral Density</h4>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
            <div style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 8 }}>Hit Rate Spectrum</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
              Peak Frequency: {exploratoryMetrics.spectralAnalysis.peakFrequency.toFixed(4)} cycles/min
            </div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>
              Total Power: {exploratoryMetrics.spectralAnalysis.totalPower.toFixed(3)}
            </div>
          </div>
          {exploratoryMetrics.entropySpectral && (
            <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
              <div style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 8 }}>Entropy Spectrum</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
                Peak Frequency: {exploratoryMetrics.entropySpectral.peakFrequency.toFixed(4)} cycles/min
              </div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                Total Power: {exploratoryMetrics.entropySpectral.totalPower.toFixed(3)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Ghost vs Subject Control Analysis Component
function GhostSubjectControlAnalysis({ sessions, stats }) {
  const controlMetrics = useMemo(() => {
    // Ghost vs subject performance comparison
    const subjectBlocks = [];
    const ghostBlocks = [];
    const entropyComparisons = [];

    sessions.forEach(session => {
      (session.minutes || []).forEach(minute => {
        const subjectHitRate = minute.n > 0 ? minute.hits / minute.n : 0.5;
        const ghostHitRate = minute.n > 0 ? (minute.ghost_hits || 0) / minute.n : 0.5;

        subjectBlocks.push({
          sessionId: session.id,
          blockIndex: minute.idx || 0,
          hitRate: subjectHitRate,
          hits: minute.hits || 0,
          trials: minute.n || 0,
          condition: session.prime_condition || 'neutral'
        });

        ghostBlocks.push({
          sessionId: session.id,
          blockIndex: minute.idx || 0,
          hitRate: ghostHitRate,
          hits: minute.ghost_hits || 0,
          trials: minute.n || 0,
          condition: session.prime_condition || 'neutral'
        });

        // Entropy comparisons for this block
        const entropyWindows = minute.entropy?.new_windows_subj || [];
        if (entropyWindows.length > 0) {
          const avgEntropy = entropyWindows.reduce((sum, w) => sum + (w.entropy || 0), 0) / entropyWindows.length;
          entropyComparisons.push({
            sessionId: session.id,
            blockIndex: minute.idx || 0,
            subjectHitRate,
            ghostHitRate,
            entropy: avgEntropy,
            condition: session.prime_condition || 'neutral'
          });
        }
      });
    });

    if (subjectBlocks.length === 0) {
      return { message: 'No control data available for analysis' };
    }

    // Autocorrelation comparison (lag 1-5)
    const subjectHitRates = subjectBlocks.map(b => b.hitRate);
    const ghostHitRates = ghostBlocks.map(b => b.hitRate);

    const autocorrelationComparison = {};
    const lags = [1, 2, 3, 4, 5];

    lags.forEach(lag => {
      const subjectAutocorr = computeAutocorrelation(subjectHitRates, lag);
      const ghostAutocorr = computeAutocorrelation(ghostHitRates, lag);

      autocorrelationComparison[lag] = {
        subject: isFinite(subjectAutocorr) ? subjectAutocorr : 0,
        ghost: isFinite(ghostAutocorr) ? ghostAutocorr : 0,
        difference: isFinite(subjectAutocorr) && isFinite(ghostAutocorr) ?
          subjectAutocorr - ghostAutocorr : 0
      };
    });

    // Spectral analysis comparison
    const subjectSpectral = performSpectralAnalysis(subjectHitRates);
    const ghostSpectral = performSpectralAnalysis(ghostHitRates);

    // Entropy correlations
    const entropyPerformanceCorr = entropyComparisons.length > 0 ?
      calculateCorrelation(
        entropyComparisons.map(e => e.entropy),
        entropyComparisons.map(e => e.subjectHitRate)
      ) : 0;

    const entropyAutocorr = entropyComparisons.length > 0 ?
      computeAutocorrelation(entropyComparisons.map(e => e.entropy), 1) : 0;

    // Cross-correlation between entropy and performance with lags
    const entropyPerformanceCrossCorr = entropyComparisons.length > 0 ?
      calculateCrossCorrelation(
        entropyComparisons.map(e => e.entropy),
        entropyComparisons.map(e => e.subjectHitRate)
      ) : null;

    // Overall performance comparison
    const subjectMean = subjectHitRates.reduce((a, b) => a + b, 0) / subjectHitRates.length;
    const ghostMean = ghostHitRates.reduce((a, b) => a + b, 0) / ghostHitRates.length;
    const subjectVar = subjectHitRates.reduce((sum, val) => sum + Math.pow(val - subjectMean, 2), 0) / subjectHitRates.length;
    const ghostVar = ghostHitRates.reduce((sum, val) => sum + Math.pow(val - ghostMean, 2), 0) / ghostHitRates.length;

    // t-test for subject vs ghost performance
    const pooledVar = (subjectVar + ghostVar) / 2;
    const tStat = pooledVar > 0 ? (subjectMean - ghostMean) / Math.sqrt(2 * pooledVar / subjectHitRates.length) : 0;

    return {
      totalBlocks: subjectBlocks.length,
      subjectMean,
      ghostMean,
      performanceDifference: subjectMean - ghostMean,
      tStatistic: tStat,
      significant: Math.abs(tStat) > 1.96,
      autocorrelationComparison,
      spectralComparison: {
        subject: subjectSpectral,
        ghost: ghostSpectral
      },
      entropyAnalysis: {
        performanceCorrelation: entropyPerformanceCorr,
        autocorrelation: entropyAutocorr,
        crossCorrelation: entropyPerformanceCrossCorr,
        totalEntropyBlocks: entropyComparisons.length
      }
    };
  }, [sessions, stats]);

  if (controlMetrics.message) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: '#6b7280' }}>
        {controlMetrics.message}
      </div>
    );
  }

  return (
    <div>
      <h3 style={{ marginBottom: 16, color: '#374151' }}>Ghost vs Subject Control Analysis</h3>

      {/* Overall Performance Comparison */}
      <div style={{ marginBottom: 24 }}>
        <h4 style={{ marginBottom: 12, color: '#374151' }}>Performance Comparison</h4>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#f0f9ff' }}>
            <div style={{ fontSize: 12, color: '#0369a1', marginBottom: 4 }}>Subject Mean</div>
            <div style={{ fontSize: 18, fontWeight: 'bold', color: '#0369a1' }}>
              {(controlMetrics.subjectMean * 100).toFixed(2)}%
            </div>
          </div>
          <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#f5f5f5' }}>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Ghost Mean</div>
            <div style={{ fontSize: 18, fontWeight: 'bold', color: '#6b7280' }}>
              {(controlMetrics.ghostMean * 100).toFixed(2)}%
            </div>
          </div>
          <div style={{
            padding: 16,
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            background: controlMetrics.significant ? '#fef3c7' : '#f5f5f5'
          }}>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Difference</div>
            <div style={{
              fontSize: 18,
              fontWeight: 'bold',
              color: controlMetrics.significant ? '#92400e' : '#374151'
            }}>
              {(controlMetrics.performanceDifference > 0 ? '+' : '')}{(controlMetrics.performanceDifference * 100).toFixed(2)}%
              {controlMetrics.significant && ' *'}
            </div>
            <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>
              t = {controlMetrics.tStatistic.toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      {/* Autocorrelation Comparison */}
      <div style={{ marginBottom: 24 }}>
        <h4 style={{ marginBottom: 12, color: '#374151' }}>Autocorrelation Comparison (Lag 1-5)</h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          {Object.entries(controlMetrics.autocorrelationComparison).map(([lag, stats]) => (
            <div key={lag} style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 6, background: '#fafafa' }}>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>Lag {lag}</div>
              <div style={{ fontSize: 11, color: '#0369a1', marginBottom: 2 }}>
                Subject: {stats.subject.toFixed(4)}
              </div>
              <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 2 }}>
                Ghost: {stats.ghost.toFixed(4)}
              </div>
              <div style={{ fontSize: 12, fontWeight: 'bold', color: '#374151' }}>
                Δ: {(stats.difference > 0 ? '+' : '')}{stats.difference.toFixed(4)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Spectral Analysis Comparison */}
      <div style={{ marginBottom: 24 }}>
        <h4 style={{ marginBottom: 12, color: '#374151' }}>Spectral Analysis Comparison</h4>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#f0f9ff' }}>
            <div style={{ fontSize: 14, fontWeight: 'bold', color: '#0369a1', marginBottom: 8 }}>Subject</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
              Peak Freq: {controlMetrics.spectralComparison.subject.peakFrequency.toFixed(4)} cycles/block
            </div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>
              Total Power: {controlMetrics.spectralComparison.subject.totalPower.toFixed(3)}
            </div>
          </div>
          <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#f5f5f5' }}>
            <div style={{ fontSize: 14, fontWeight: 'bold', color: '#6b7280', marginBottom: 8 }}>Ghost</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
              Peak Freq: {controlMetrics.spectralComparison.ghost.peakFrequency.toFixed(4)} cycles/block
            </div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>
              Total Power: {controlMetrics.spectralComparison.ghost.totalPower.toFixed(3)}
            </div>
          </div>
        </div>
      </div>

      {/* Entropy Correlations */}
      {controlMetrics.entropyAnalysis.totalEntropyBlocks > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h4 style={{ marginBottom: 12, color: '#374151' }}>Entropy Correlations</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
            <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa' }}>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Entropy-Performance</div>
              <div style={{ fontSize: 16, fontWeight: 'bold', color: '#374151' }}>
                r = {controlMetrics.entropyAnalysis.performanceCorrelation.toFixed(3)}
              </div>
              <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>
                {controlMetrics.entropyAnalysis.totalEntropyBlocks} blocks
              </div>
            </div>
            <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa' }}>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Entropy Autocorr (Lag 1)</div>
              <div style={{ fontSize: 16, fontWeight: 'bold', color: '#374151' }}>
                {isFinite(controlMetrics.entropyAnalysis.autocorrelation) ?
                  controlMetrics.entropyAnalysis.autocorrelation.toFixed(3) : 'N/A'}
              </div>
            </div>
            {controlMetrics.entropyAnalysis.crossCorrelation && (
              <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa' }}>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Cross-Correlation</div>
                <div style={{ fontSize: 16, fontWeight: 'bold', color: '#374151' }}>
                  {controlMetrics.entropyAnalysis.crossCorrelation.maxCorr.toFixed(3)}
                </div>
                <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>
                  Lag: {controlMetrics.entropyAnalysis.crossCorrelation.maxLag}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ fontSize: 12, color: '#6b7280', fontStyle: 'italic' }}>
        * indicates statistical significance (p &lt; 0.05). Ghost data serves as control for systematic biases.
      </div>
    </div>
  );
}


// Helper function for calculating correlation
function calculateCorrelation(x, y) {
  if (x.length !== y.length || x.length < 2) return 0;

  const n = x.length;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denomX = 0;
  let denomY = 0;

  for (let i = 0; i < n; i++) {
    numerator += (x[i] - meanX) * (y[i] - meanY);
    denomX += Math.pow(x[i] - meanX, 2);
    denomY += Math.pow(y[i] - meanY, 2);
  }

  const denominator = Math.sqrt(denomX * denomY);
  return denominator !== 0 ? numerator / denominator : 0;
}


// Comprehensive turning point analysis
function analyzeTurningPoints(data) {
  if (data.length < 3) return {
    totalPoints: 0,
    rate: 0,
    expected: 0,
    excess: 0,
    excessPercent: 0,
    maxima: 0,
    minima: 0,
    ratio: 0
  };

  let maxima = 0;
  let minima = 0;

  // Count local maxima and minima separately
  for (let i = 1; i < data.length - 1; i++) {
    if (data[i] > data[i - 1] && data[i] > data[i + 1]) {
      maxima++;
    } else if (data[i] < data[i - 1] && data[i] < data[i + 1]) {
      minima++;
    }
  }

  const totalPoints = maxima + minima;
  const rate = data.length > 0 ? totalPoints / (data.length - 2) : 0; // Rate per potential turning point position

  // Expected turning points for random sequence
  // For a truly random sequence, each interior point has:
  // - 1/4 probability of being a local maximum
  // - 1/4 probability of being a local minimum
  // - 1/2 probability of being neither (monotonic)
  // So expected = (n-2) * (1/4 + 1/4) = (n-2) * 0.5
  const expected = (data.length - 2) * 0.5;
  const excess = totalPoints - expected;
  const excessPercent = expected > 0 ? (excess / expected) * 100 : 0;

  // Maxima vs Minima ratio (handle division by zero)
  const ratio = minima > 0 ? maxima / minima : (maxima > 0 ? Infinity : 1);

  return {
    totalPoints,
    rate,
    expected,
    excess,
    excessPercent,
    maxima,
    minima,
    ratio
  };
}

// Simple count for backward compatibility
function countTurningPoints(data) {
  return analyzeTurningPoints(data).totalPoints;
}

// Helper functions for spectral and oscillation analysis
function calculateLinearTrend(data) {
  const n = data.length;
  if (n < 2) return { slope: 0, intercept: 0, r2: 0 };

  const x = data.map((_, i) => i);
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = data.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (x[i] - meanX) * (data[i] - meanY);
    denominator += (x[i] - meanX) ** 2;
  }

  const slope = denominator !== 0 ? numerator / denominator : 0;
  const intercept = meanY - slope * meanX;

  // Calculate R²
  const ssRes = data.reduce((sum, y, i) => sum + (y - (slope * i + intercept)) ** 2, 0);
  const ssTot = data.reduce((sum, y) => sum + (y - meanY) ** 2, 0);
  const r2 = ssTot !== 0 ? 1 - (ssRes / ssTot) : 0;

  return { slope, intercept, r2 };
}

function performSpectralAnalysis(data) {
  // Simple spectral analysis using discrete Fourier transform concepts
  const n = data.length;
  if (n < 4) return { peakFrequency: 0, totalPower: 0, powerSpectrum: [] };

  // Calculate power at different frequencies using autocorrelation
  const powerSpectrum = [];
  const maxLag = Math.min(n / 4, 50);

  for (let freq = 1; freq <= maxLag; freq++) {
    let correlation = 0;
    let count = 0;

    for (let i = 0; i < n - freq; i++) {
      correlation += data[i] * data[i + freq];
      count++;
    }

    correlation = count > 0 ? correlation / count : 0;
    powerSpectrum.push({ frequency: freq / n, power: Math.abs(correlation) });
  }

  const totalPower = powerSpectrum.reduce((sum, p) => sum + p.power, 0);
  const peakPower = Math.max(...powerSpectrum.map(p => p.power));
  const peakFrequency = powerSpectrum.find(p => p.power === peakPower)?.frequency || 0;

  return { peakFrequency, totalPower, powerSpectrum };
}

function detectHarmonicOscillations(data) {
  const n = data.length;
  if (n < 10) return { dominantFreq: 0, dominantPower: 0, oscillationStrength: 0, coherence: 0 };

  // Look for periodic patterns
  let maxCorr = 0;
  let bestPeriod = 0;

  for (let period = 2; period <= n / 4; period++) {
    let correlation = 0;
    let count = 0;

    // Calculate correlation with shifted version
    for (let i = 0; i < n - period; i++) {
      correlation += data[i] * data[i + period];
      count++;
    }

    correlation = count > 0 ? Math.abs(correlation / count) : 0;

    if (correlation > maxCorr) {
      maxCorr = correlation;
      bestPeriod = period;
    }
  }

  // Calculate oscillation strength as variance in the signal
  const mean = data.reduce((a, b) => a + b, 0) / n;
  const variance = data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / n;
  const oscillationStrength = Math.min(1, variance * 4); // Normalize

  // Coherence measure - consistency of the oscillation
  const coherence = bestPeriod > 0 ? maxCorr : 0;

  return {
    dominantFreq: bestPeriod > 0 ? 1 / bestPeriod : 0,
    dominantPower: maxCorr,
    oscillationStrength,
    coherence
  };
}

function detectDampedOscillator(data) {
  const n = data.length;
  if (n < 20) return { detected: false };

  try {
    // Simple damped oscillator detection using envelope decay
    const peaks = [];
    const troughs = [];

    // Find local maxima and minima
    for (let i = 1; i < n - 1; i++) {
      if (data[i] > data[i - 1] && data[i] > data[i + 1]) {
        peaks.push({ index: i, value: data[i] });
      }
      if (data[i] < data[i - 1] && data[i] < data[i + 1]) {
        troughs.push({ index: i, value: data[i] });
      }
    }

    if (peaks.length < 3 || troughs.length < 3) {
      return { detected: false };
    }

    // Check for exponential decay in amplitude
    const peakValues = peaks.map(p => p.value);
    const peakIndices = peaks.map(p => p.index);

    // Try to fit exponential decay to peak amplitudes
    if (peakValues.length >= 3) {
      const trend = calculateLinearTrend(peakValues.map(Math.log));
      const dampingFactor = -trend.slope;
      const fitQuality = trend.r2;

      // Estimate natural frequency from peak spacing
      const avgSpacing = peakIndices.length > 1 ?
        (peakIndices[peakIndices.length - 1] - peakIndices[0]) / (peakIndices.length - 1) : 0;
      const naturalFreq = avgSpacing > 0 ? 1 / avgSpacing : 0;

      const detected = dampingFactor > 0.01 && fitQuality > 0.3 && naturalFreq > 0;

      return {
        detected,
        dampingFactor: detected ? dampingFactor : null,
        naturalFreq: detected ? naturalFreq : null,
        fitQuality: detected ? fitQuality : null
      };
    }

    return { detected: false };
  } catch (error) {
    return { detected: false };
  }
}

function detectOscillation(data) {
  // Simple oscillation detection for individual sessions
  if (data.length < 6) return { strength: 0, frequency: 0 };

  let crossings = 0;
  const mean = data.reduce((a, b) => a + b, 0) / data.length;

  for (let i = 1; i < data.length; i++) {
    if ((data[i - 1] < mean && data[i] >= mean) || (data[i - 1] >= mean && data[i] < mean)) {
      crossings++;
    }
  }

  const frequency = crossings / (data.length - 1);
  const variance = data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / data.length;
  const strength = Math.min(1, variance * 4);

  return { strength, frequency };
}

function calculateCrossCorrelation(series1, series2) {
  const n = Math.min(series1.length, series2.length);
  if (n < 10) return null;

  const maxLag = Math.min(20, n / 4);
  let maxCorr = 0;
  let maxLag_actual = 0;

  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let correlation = 0;
    let count = 0;

    for (let i = Math.max(0, lag); i < Math.min(n, n + lag); i++) {
      const idx1 = i - lag;
      const idx2 = i;

      if (idx1 >= 0 && idx1 < series1.length && idx2 >= 0 && idx2 < series2.length) {
        correlation += series1[idx1] * series2[idx2];
        count++;
      }
    }

    correlation = count > 0 ? correlation / count : 0;

    if (Math.abs(correlation) > Math.abs(maxCorr)) {
      maxCorr = correlation;
      maxLag_actual = lag;
    }
  }

  return {
    maxCorr,
    maxLag: maxLag_actual
  };
}

export default function QAExport() {
  const [loading, setLoading] = useState(true);
  const [runs, setRuns] = useState([]);
  const [mode, setMode] = useState('pooled');
  const [binauralFilter, setBinauralFilter] = useState('all');
  const [primeFilter, setPrimeFilter] = useState('all');
  const [dataTypeFilter, setDataTypeFilter] = useState('all');
  const [qaStatus, setQaStatus] = useState(null);
  const [canToggle, setCanToggle] = useState(false);
  const [authed, setAuthed] = useState(false);

  // Monitor auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setAuthed(!!user);
      if (!user) {
        signInAnonymously(auth);
      }
    });
    return unsub;
  }, []);

  // Load experiment data
  useEffect(() => {
    (async () => {
      try {
        const loadedRuns = await fetchAllRunsWithMinutes();
        console.log('QA Dashboard: Loaded runs:', loadedRuns.length, loadedRuns);
        setRuns(loadedRuns);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Load QA status and check permissions
  useEffect(() => {
    (async () => {
      try {
        const qaRef = doc(db, 'admin', 'qa');
        const snap = await getDoc(qaRef);
        if (!snap.exists()) {
          setQaStatus(null);
          setCanToggle(false);
          return;
        }
        const qa = snap.data();
        setQaStatus(qa);

        // Check if user can toggle QA
        const u = auth.currentUser;
        if (u) {
          const t = await u.getIdTokenResult();
          const provider = t.signInProvider;
          const email = u.email || '';
          const whitelisted = Array.isArray(qa.emails) && qa.emails.includes(email);
          setCanToggle(provider === 'password' && whitelisted);
        } else {
          setCanToggle(false);
        }
      } catch (err) {
        console.warn('QA status check failed:', err);
        setCanToggle(false);
      }
    })();
  }, [authed]);

  // Auto sign out when window closes if QA is off (security feature) - DISABLED for now
  // useEffect(() => {
  //   const handleBeforeUnload = () => {
  //     if (qaStatus && !qaStatus.enabled && auth.currentUser) {
  //       console.log('QA Dashboard: Auto-logout on window close (QA is off)');
  //       signOut(auth).catch(console.error);
  //     }
  //   };

  //   window.addEventListener('beforeunload', handleBeforeUnload);
  //   return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  // }, [qaStatus]);

  // Sign in with Email/Password
  const handleEmailSignIn = async () => {
    const e = prompt('Email:');
    const p = prompt('Password:');
    if (!e || !p) return;
    try {
      await signInWithEmailPassword(e, p);
      alert('Signed in!');
      window.location.reload();
    } catch (err) {
      alert(`Sign-in failed: ${err.message}`);
    }
  };

  // Toggle QA mode
  const toggleQA = async () => {
    if (!qaStatus) return;
    try {
      console.log('QA Dashboard: Toggling QA from', qaStatus.enabled, 'to', !qaStatus.enabled);
      const qaRef = doc(db, 'admin', 'qa');
      await updateDoc(qaRef, { enabled: !qaStatus.enabled });
      const newStatus = { ...qaStatus, enabled: !qaStatus.enabled };
      setQaStatus(newStatus);
      console.log('QA Dashboard: QA toggle successful, new status:', newStatus);
    } catch (err) {
      console.error('QA Dashboard: Toggle failed:', err);
      alert(`Toggle failed: ${err.message}`);
    }
  };

  const filteredSessions = useMemo(() => {
    console.log('QA Dashboard: Raw runs data:', runs.length, runs);
    const filtered = filterSessions(runs, mode, binauralFilter, primeFilter, dataTypeFilter);
    console.log('QA Dashboard: Filtered sessions:', filtered.length, filtered);
    console.log('QA Dashboard: Filters:', { mode, binauralFilter, primeFilter, dataTypeFilter });

    // Debug individual runs
    runs.forEach((run, index) => {
      console.log(`Run ${index}:`, {
        id: run.id,
        participant_id: run.participant_id,
        completed: run.completed,
        prime_condition: run.prime_condition,
        binaural_beats: run.binaural_beats,
        minutes: run.minutes?.length || 0,
        createdAt: run.createdAt
      });
    });

    return filtered;
  }, [runs, mode, binauralFilter, primeFilter, dataTypeFilter]);

  const stats = useMemo(() => {
    return computeStatistics(filteredSessions, mode);
  }, [filteredSessions, mode]);

  const summary = useMemo(() => {
    const total = runs.length;
    const completers = runs.filter(r => r.completed).length;
    const nonCompleters = total - completers;
    return { total, completers, nonCompleters };
  }, [runs]);

  if (loading) return <div style={{ padding: 24 }}>Loading experiment data…</div>;

  const uid = auth.currentUser?.uid;
  const email = auth.currentUser?.email;

  const ModeToggle = () => (
    <div style={{ margin: '8px 0 12px', display: 'grid', gap: 8 }}>
      {/* Row 1: Mode */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: 12, color: '#555' }}>Mode:</span>
        {[
          { id: 'pooled', label: 'All sessions (pooled)' },
          { id: 'completers', label: 'Completers only' },
          { id: 'nonCompleters', label: 'Early exits only' },
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

      {/* Row 2: Binaural filter */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexWrap: 'wrap',
          marginTop: 8,
        }}
      >
        <span style={{ fontSize: 12, color: '#555' }}>Binaural beats:</span>
        {[
          { id: 'all', label: 'All sessions' },
          { id: 'yes', label: 'Used binaural beats' },
          { id: 'no', label: 'No binaural beats' },
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
              background: binauralFilter === opt.id ? '#eef6ff' : '#fff',
              cursor: 'pointer',
            }}
          >
            <input
              type="radio"
              name="binaural"
              value={opt.id}
              checked={binauralFilter === opt.id}
              onChange={(e) => setBinauralFilter(e.target.value)}
            />
            <span style={{ fontSize: 12 }}>{opt.label}</span>
          </label>
        ))}
      </div>

      {/* Row 3: Prime condition filter */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexWrap: 'wrap',
          marginTop: 8,
        }}
      >
        <span style={{ fontSize: 12, color: '#555' }}>Prime condition:</span>
        {[
          { id: 'all', label: 'All conditions' },
          { id: 'primed', label: 'Primed' },
          { id: 'neutral', label: 'Neutral' },
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
              background: primeFilter === opt.id ? '#eef6ff' : '#fff',
              cursor: 'pointer',
            }}
          >
            <input
              type="radio"
              name="prime"
              value={opt.id}
              checked={primeFilter === opt.id}
              onChange={(e) => setPrimeFilter(e.target.value)}
            />
            <span style={{ fontSize: 12 }}>{opt.label}</span>
          </label>
        ))}
      </div>

      {/* Row 4: Data type filter */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexWrap: 'wrap',
          marginTop: 8,
        }}
      >
        <span style={{ fontSize: 12, color: '#555' }}>Data type:</span>
        {[
          { id: 'all', label: 'All data (Live + Retro)' },
          { id: 'live', label: 'Live quantum data only' },
          { id: 'retro', label: 'Retro tape replays only' },
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
              background: dataTypeFilter === opt.id ? '#eef6ff' : '#fff',
              cursor: 'pointer',
            }}
          >
            <input
              type="radio"
              name="dataType"
              value={opt.id}
              checked={dataTypeFilter === opt.id}
              onChange={(e) => setDataTypeFilter(e.target.value)}
            />
            <span style={{ fontSize: 12 }}>{opt.label}</span>
          </label>
        ))}
      </div>
    </div>
  );

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
          <strong>Early exits:</strong> {summary.nonCompleters} (
          {summary.total
            ? ((100 * summary.nonCompleters) / summary.total).toFixed(1)
            : '0.0'}
          %)
        </div>
        <div>
          <strong>Filtered sessions:</strong> {filteredSessions.length}
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: 980, margin: '40px auto', padding: 16 }}>
      <h1>Export & QA - Experiment 3</h1>

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
          <strong>QA mode: {qaStatus.enabled ? 'ON ✅' : 'OFF ❌'}</strong>
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
                </>
              ) : (
                ' (anonymous)'
              )}
            </small>
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            {canToggle ? (
              <button
                onClick={toggleQA}
                style={{
                  padding: '4px 8px',
                  fontSize: 12,
                  border: '1px solid #16a34a',
                  borderRadius: 4,
                  background: '#16a34a',
                  color: '#ffffff',
                  cursor: 'pointer',
                }}
              >
                Toggle QA {qaStatus.enabled ? 'OFF' : 'ON'}
              </button>
            ) : (
              <button
                onClick={handleEmailSignIn}
                style={{
                  padding: '4px 8px',
                  fontSize: 12,
                  border: '1px solid #16a34a',
                  borderRadius: 4,
                  background: '#16a34a',
                  color: '#ffffff',
                  cursor: 'pointer',
                }}
              >
                Sign in with Email/Password
              </button>
            )}
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '4px 8px',
                fontSize: 12,
                border: '1px solid #2563eb',
                borderRadius: 4,
                background: '#2563eb',
                color: '#ffffff',
                cursor: 'pointer',
              }}
            >
              🔄 Refresh Data
            </button>
          </div>
        </div>
      ) : (
        <div
          style={{
            padding: '8px 12px',
            border: '1px solid #ddd',
            borderRadius: 6,
            background: '#fff3cd',
            marginBottom: 12,
          }}
        >
          <strong>QA Status: Unknown</strong>
          <div>
            <small>No admin/qa document found. QA controls unavailable.</small>
          </div>
        </div>
      )}

      {/* Mode toggles */}
      <ModeToggle />
      <SummaryCard />

      {/* Download buttons */}
      <div style={{ marginBottom: 20, marginTop: 16 }}>
        {canToggle ? (
          <>
            <DownloadButton data={filteredSessions} filename="Sessions.json" />
            <DownloadButton
              data={filteredSessions.flatMap((r) => r.minutes || [])}
              filename="Sessions + Trials.json"
            />
          </>
        ) : (
          <>
            <button
              disabled
              style={{
                padding: '6px 12px',
                border: '1px solid #ccc',
                borderRadius: 4,
                background: '#f5f5f5',
                color: '#999',
                cursor: 'not-allowed',
                fontSize: 12,
                marginRight: 8,
              }}
            >
              📥 Sessions.json (Sign in required)
            </button>
            <button
              disabled
              style={{
                padding: '6px 12px',
                border: '1px solid #ccc',
                borderRadius: 4,
                background: '#f5f5f5',
                color: '#999',
                cursor: 'not-allowed',
                fontSize: 12,
                marginRight: 8,
              }}
            >
              📥 Sessions + Trials.json (Sign in required)
            </button>
          </>
        )}
      </div>

      {/* Statistics section */}
      {stats && (
        <div style={{ marginTop: 24 }}>
          <h2 style={{ margin: '12px 0 8px' }}>Statistical Summary</h2>

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
                Subject Hit Rate
              </div>
              <div style={{ fontSize: 20 }}>
                {(stats.avgHitRate * 100).toFixed(2)}%
              </div>
            </div>

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
                Ghost Hit Rate
              </div>
              <div style={{ fontSize: 20 }}>
                {(stats.avgGhostHitRate * 100).toFixed(2)}%
              </div>
            </div>

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
                Δ (Subject − Ghost)
              </div>
              <div style={{ fontSize: 20 }}>
                {stats.deltaPct.toFixed(2)}%
              </div>
            </div>

            <PBadge
              label="Subject vs chance (50%)"
              p={stats.p}
            />
          </div>

          <div style={{ marginTop: 16, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <strong>Total sessions:</strong> {stats.totalSessions}
            </div>
            <div>
              <strong>Total trials:</strong> {stats.totalTrials.toLocaleString()}
            </div>
            <div>
              <strong>Entropy windows:</strong> {stats.totalEntropyWindows}
            </div>
            <div>
              <strong>Avg entropy:</strong> {stats.avgEntropy.toFixed(4)}
            </div>
          </div>
        </div>
      )}

      {/* Advanced Research Analytics */}
      {stats && filteredSessions.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <h2 style={{ margin: '12px 0 16px', fontSize: 24, color: '#1f2937' }}>
            Research Analytics Suite
          </h2>

          {/* Primary Performance Metrics */}
          <AnalyticsSection
            title="Primary Performance Metrics"
            content={<PrimaryPerformanceMetrics sessions={filteredSessions} stats={stats} />}
          />

          {/* Temporal Structure Analysis */}
          <AnalyticsSection
            title="Temporal Structure Analysis"
            content={<TemporalStructureAnalysis sessions={filteredSessions} />}
          />

          {/* Entropy Signatures */}
          <AnalyticsSection
            title="Entropy Signatures"
            content={<EntropySignatures sessions={filteredSessions} />}
          />

          {/* Individual Difference Tracking */}
          <AnalyticsSection
            title="Individual Difference Tracking"
            content={<IndividualDifferenceTracking sessions={filteredSessions} />}
          />

          {/* Control Validations */}
          <AnalyticsSection
            title="Control Validations"
            content={<ControlValidations sessions={filteredSessions} stats={stats} />}
          />

          {/* Exploratory Signatures */}
          <AnalyticsSection
            title="Exploratory Signatures"
            content={<ExploratorySignatures sessions={filteredSessions} />}
          />
        </div>
      )}

      {/* Sessions table */}
      <h2 style={{ margin: '32px 0 16px 0', fontSize: 24, color: '#1f2937' }}>
        Sessions ({filteredSessions.length})
      </h2>

      {filteredSessions.length === 0 ? (
        runs.length === 0 ? (
          <div style={{
            padding: '16px',
            background: '#fef3c7',
            border: '1px solid #f59e0b',
            borderRadius: 6,
            marginBottom: 16
          }}>
            <strong>No data available</strong>
            <p>Please sign in with your email/password to access experiment data. If you're already signed in, try refreshing the data.</p>
          </div>
        ) : (
          <p>No sessions match the current filters.</p>
        )
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                <th style={{ border: '1px solid #d1d5db', padding: 8, textAlign: 'left' }}>
                  Session ID
                </th>
                <th style={{ border: '1px solid #d1d5db', padding: 8, textAlign: 'left' }}>
                  Created
                </th>
                <th style={{ border: '1px solid #d1d5db', padding: 8, textAlign: 'left' }}>
                  Participant
                </th>
                <th style={{ border: '1px solid #d1d5db', padding: 8, textAlign: 'left' }}>
                  Status
                </th>
                <th style={{ border: '1px solid #d1d5db', padding: 8, textAlign: 'left' }}>
                  Minutes
                </th>
                <th style={{ border: '1px solid #d1d5db', padding: 8, textAlign: 'left' }}>
                  Hit Rate
                </th>
                <th style={{ border: '1px solid #d1d5db', padding: 8, textAlign: 'left' }}>
                  Prime
                </th>
                <th style={{ border: '1px solid #d1d5db', padding: 8, textAlign: 'left' }}>
                  Binaural
                </th>
                <th style={{ border: '1px solid #d1d5db', padding: 8, textAlign: 'left' }}>
                  Data Type
                </th>
                <th style={{ border: '1px solid #d1d5db', padding: 8, textAlign: 'left' }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredSessions.map((session) => {
                const sessionStats = stats?.sessionStats.find(s => s.id === session.id);
                const Panel = panels.pk;

                return (
                  <tr key={session.id}>
                    <td style={{ border: '1px solid #d1d5db', padding: 8 }}>
                      <code style={{ fontSize: 11 }}>{session.id.slice(-8)}</code>
                    </td>
                    <td style={{ border: '1px solid #d1d5db', padding: 8 }}>
                      {session.createdAt?.toDate?.()?.toLocaleDateString() || '—'}
                    </td>
                    <td style={{ border: '1px solid #d1d5db', padding: 8 }}>
                      <code style={{ fontSize: 11 }}>
                        {session.participant_id?.slice(-8) || '—'}
                      </code>
                    </td>
                    <td style={{ border: '1px solid #d1d5db', padding: 8 }}>
                      {session.completed ? '✅ Complete' : '⏳ In Progress'}
                    </td>
                    <td style={{ border: '1px solid #d1d5db', padding: 8 }}>
                      {session.minutes?.length || 0}
                    </td>
                    <td style={{ border: '1px solid #d1d5db', padding: 8 }}>
                      {sessionStats
                        ? `${(sessionStats.hitRate * 100).toFixed(1)}%`
                        : '—'
                      }
                    </td>
                    <td style={{ border: '1px solid #d1d5db', padding: 8 }}>
                      {session.prime_condition || '—'}
                    </td>
                    <td style={{ border: '1px solid #d1d5db', padding: 8 }}>
                      {session.binaural_beats === 'Yes' ? '✅' : '❌'}
                    </td>
                    <td style={{ border: '1px solid #d1d5db', padding: 8 }}>
                      {(() => {
                        const liveCount = (session.minutes || []).filter(m => m.kind === 'live').length;
                        const retroCount = (session.minutes || []).filter(m => m.kind === 'retro').length;
                        if (dataTypeFilter === 'live') return `Live: ${liveCount}`;
                        if (dataTypeFilter === 'retro') return `Retro: ${retroCount}`;
                        return `${liveCount}L / ${retroCount}R`;
                      })()}
                    </td>
                    <td style={{ border: '1px solid #d1d5db', padding: 8 }}>
                      <details>
                        <summary style={{ cursor: 'pointer', fontSize: 12 }}>
                          Details
                        </summary>
                        <div style={{ marginTop: 8, padding: 8, background: '#f9f9f9', maxWidth: '400px' }}>
                          {Panel && <Panel run={session} />}
                        </div>
                      </details>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}