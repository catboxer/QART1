import React, { useEffect, useState, useMemo } from 'react';
import { db, auth, signInWithEmailPassword } from './firebase';
import {
  collection,
  getDocs,
  query,
  orderBy,
  startAfter,
  doc,
  getDoc,
  updateDoc,
  limit,
} from 'firebase/firestore';
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { twoPropZ, twoSidedP, normalCdf } from './stats';
import { config } from './config.js';


/* ---------------- CIR²S Analysis Functions ---------------- */
// Helper functions
function computeEntropy(bytes) {
  if (bytes.length === 0) return 0;
  const counts = new Array(256).fill(0);
  bytes.forEach(b => counts[b]++);
  const total = bytes.length;
  let entropy = 0;
  for (const count of counts) {
    if (count > 0) {
      const p = count / total;
      entropy -= p * Math.log2(p);
    }
  }
  return entropy;
}

function computeAutocorrelation(bytes, maxLag = 10) {
  const n = bytes.length;
  if (n <= 1) return [];
  const mean = bytes.reduce((a, b) => a + b, 0) / n;
  const autocorr = [];

  for (let lag = 0; lag <= maxLag; lag++) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < n - lag; i++) {
      sum += (bytes[i] - mean) * (bytes[i + lag] - mean);
      count++;
    }
    const correlation = count > 0 ? sum / count : 0;
    autocorr.push({ lag, correlation, count });
  }
  return autocorr;
}

// 4. Coherence by Redundancy Analysis
function analyzeCoherenceByRedundancy(trials) {
  const redundant = trials.filter(t => t.redundancy_mode === 'redundant');
  const single = trials.filter(t => t.redundancy_mode === 'single');

  const analyzeGroup = (group, label) => {
    if (group.length === 0) return null;

    const bytes = group.map(t => t.raw_byte).filter(b => Number.isFinite(b));
    const hits = group.reduce((a, t) => a + (t.subject_hit === 1 ? 1 : 0), 0);

    return {
      label,
      count: group.length,
      hit_rate: hits / group.length,
      entropy: computeEntropy(bytes),
      autocorr: computeAutocorrelation(bytes, 5),
      mean_byte: bytes.length > 0 ? bytes.reduce((a, b) => a + b, 0) / bytes.length : 0
    };
  };

  return {
    redundant: analyzeGroup(redundant, 'Redundant'),
    single: analyzeGroup(single, 'Single')
  };
}

// 5. RNG Source Analysis
function analyzeByRNGSource(trials) {
  const sourceMap = new Map();

  trials.forEach(t => {
    const source = t.rng_source || 'unknown';
    if (!sourceMap.has(source)) {
      sourceMap.set(source, []);
    }
    sourceMap.get(source).push(t);
  });

  const results = Array.from(sourceMap.entries()).map(([source, trials]) => {
    const bytes = trials.map(t => t.raw_byte).filter(b => Number.isFinite(b));
    const hits = trials.reduce((a, t) => a + (t.subject_hit === 1 ? 1 : 0), 0);

    return {
      source,
      count: trials.length,
      hit_rate: hits / trials.length,
      entropy: computeEntropy(bytes),
      autocorr: computeAutocorrelation(bytes, 5),
      variance: bytes.length > 0 ? computeVariance(bytes) : 0
    };
  });

  return results.sort((a, b) => b.count - a.count);
}

function computeVariance(values) {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
}

// 6. Sequential Dependency Analysis
function analyzeSequentialDependency(trials) {
  const maxLag = 5;
  const results = [];

  for (let lag = 1; lag <= maxLag; lag++) {
    let correlations = 0;
    let count = 0;

    for (let i = 0; i < trials.length - lag; i++) {
      const current = trials[i].subject_hit === 1 ? 1 : 0;
      const future = trials[i + lag].subject_hit === 1 ? 1 : 0;

      correlations += current * future;
      count++;
    }

    const correlation = count > 0 ? correlations / count : 0;
    const expected = 0.04; // 20% * 20% for independent trials

    results.push({
      lag,
      correlation,
      expected,
      deviation: correlation - expected,
      count
    });
  }

  return results;
}

// 7. Target Selection Bias Analysis
function analyzeTargetSelectionBias(trials) {
  const symbolCounts = {};
  const totalTrials = trials.length;

  trials.forEach(t => {
    if (t.target_symbol_id) {
      symbolCounts[t.target_symbol_id] = (symbolCounts[t.target_symbol_id] || 0) + 1;
    }
  });

  const expected = totalTrials / 5; // 20% each for 5 symbols
  const results = Object.entries(symbolCounts).map(([symbol, count]) => ({
    symbol,
    count,
    percentage: (count / totalTrials) * 100,
    expected_percentage: 20,
    deviation: ((count / totalTrials) * 100) - 20,
    z_score: (count - expected) / Math.sqrt(expected * 0.8) // binomial z-score
  }));

  return results.sort((a, b) => b.deviation - a.deviation);
}

// 8. Hit Clustering Analysis
function analyzeHitClustering(trials) {
  const hits = trials.map(t => t.subject_hit === 1 ? 1 : 0);
  const streaks = [];
  let currentStreak = 0;
  let currentType = null;

  hits.forEach(hit => {
    if (hit === currentType) {
      currentStreak++;
    } else {
      if (currentStreak > 0) {
        streaks.push({ type: currentType, length: currentStreak });
      }
      currentType = hit;
      currentStreak = 1;
    }
  });

  if (currentStreak > 0) {
    streaks.push({ type: currentType, length: currentStreak });
  }

  const hitStreaks = streaks.filter(s => s.type === 1);
  const missStreaks = streaks.filter(s => s.type === 0);

  const longestHitStreak = hitStreaks.length > 0 ? Math.max(...hitStreaks.map(s => s.length)) : 0;
  const longestMissStreak = missStreaks.length > 0 ? Math.max(...missStreaks.map(s => s.length)) : 0;

  return {
    hit_streaks: hitStreaks,
    miss_streaks: missStreaks,
    longest_hit_streak: longestHitStreak,
    longest_miss_streak: longestMissStreak,
    avg_hit_streak: hitStreaks.length > 0 ? hitStreaks.reduce((a, s) => a + s.length, 0) / hitStreaks.length : 0,
    avg_miss_streak: missStreaks.length > 0 ? missStreaks.reduce((a, s) => a + s.length, 0) / missStreaks.length : 0,
    total_streaks: streaks.length
  };
}

// Binaural Beats Effect Analysis
function analyzeBinauralBeatsEffect(rows) {
  // Group sessions by binaural beats usage
  const sessions = rows.reduce((acc, row) => {
    if (!row.session_id) return acc;
    if (!acc[row.session_id]) {
      acc[row.session_id] = {
        trials: [],
        binaural_beats: row.binaural_beats || 'No'
      };
    }
    acc[row.session_id].trials.push(row);
    return acc;
  }, {});

  // Categorize sessions
  const withBeats = [];
  const withoutBeats = [];

  Object.values(sessions).forEach(session => {
    const trials = session.trials.filter(t => t.subject_hit !== null);
    if (trials.length === 0) return;

    const hits = trials.reduce((sum, t) => sum + (t.subject_hit || 0), 0);
    const hitRate = hits / trials.length;

    const sessionData = {
      trials: trials.length,
      hits,
      hitRate,
      binaural: session.binaural_beats
    };

    if (session.binaural_beats === 'No' || session.binaural_beats === 'What are binaural beats?') {
      withoutBeats.push(sessionData);
    } else {
      withBeats.push(sessionData);
    }
  });

  // Calculate statistics
  const calcStats = (group) => {
    if (group.length === 0) return { count: 0, avgHitRate: 0, totalTrials: 0, totalHits: 0 };
    const totalTrials = group.reduce((sum, s) => sum + s.trials, 0);
    const totalHits = group.reduce((sum, s) => sum + s.hits, 0);
    return {
      count: group.length,
      avgHitRate: totalHits / totalTrials,
      totalTrials,
      totalHits
    };
  };

  const beatsStats = calcStats(withBeats);
  const noBeatsStats = calcStats(withoutBeats);

  // Calculate significance if both groups have data
  let zScore = null;
  let pValue = null;
  if (beatsStats.count > 0 && noBeatsStats.count > 0) {
    if (beatsStats.totalTrials > 0 && noBeatsStats.totalTrials > 0) {
      zScore = twoPropZ(beatsStats.totalHits, beatsStats.totalTrials, noBeatsStats.totalHits, noBeatsStats.totalTrials);
      pValue = twoSidedP(zScore);
    }
  }

  return {
    withBeats: beatsStats,
    withoutBeats: noBeatsStats,
    difference: beatsStats.avgHitRate - noBeatsStats.avgHitRate,
    zScore,
    pValue
  };
}

// Enhanced Response Time vs Accuracy Analysis
function analyzeResponseTimeAccuracy(trials) {
  const timingData = trials
    .filter(t => Number.isFinite(t.response_time_ms) && t.subject_hit !== null)
    .map(t => ({
      responseTime: t.response_time_ms,
      hit: t.subject_hit === 1 ? 1 : 0
    }));

  if (timingData.length === 0) {
    return { error: 'No timing data available' };
  }

  // Split into fast/medium/slow terciles
  const sorted = [...timingData].sort((a, b) => a.responseTime - b.responseTime);
  const tercileSize = Math.floor(sorted.length / 3);

  const fast = sorted.slice(0, tercileSize);
  const medium = sorted.slice(tercileSize, tercileSize * 2);
  const slow = sorted.slice(tercileSize * 2);

  const calcTercileStats = (group, label) => {
    const hits = group.reduce((sum, t) => sum + t.hit, 0);
    const hitRate = hits / group.length;
    const avgTime = group.reduce((sum, t) => sum + t.responseTime, 0) / group.length;
    return {
      label,
      count: group.length,
      hits,
      hitRate: hitRate,
      hitRatePct: (hitRate * 100).toFixed(1),
      avgTime: Math.round(avgTime)
    };
  };

  const results = {
    fast: calcTercileStats(fast, 'Fast'),
    medium: calcTercileStats(medium, 'Medium'),
    slow: calcTercileStats(slow, 'Slow'),
    totalTrials: timingData.length
  };

  // Calculate correlation coefficient
  const n = timingData.length;
  const sumTime = timingData.reduce((sum, t) => sum + t.responseTime, 0);
  const sumHit = timingData.reduce((sum, t) => sum + t.hit, 0);
  const sumTimeHit = timingData.reduce((sum, t) => sum + (t.responseTime * t.hit), 0);
  const sumTimeSq = timingData.reduce((sum, t) => sum + (t.responseTime * t.responseTime), 0);
  const sumHitSq = timingData.reduce((sum, t) => sum + (t.hit * t.hit), 0);

  const numerator = n * sumTimeHit - sumTime * sumHit;
  const denominator = Math.sqrt((n * sumTimeSq - sumTime * sumTime) * (n * sumHitSq - sumHit * sumHit));

  results.correlation = denominator !== 0 ? numerator / denominator : 0;
  results.correlationDirection = results.correlation > 0 ? 'positive' : results.correlation < 0 ? 'negative' : 'none';

  return results;
}

// 9. Response Timing vs Outcome Analysis
function analyzeTimingOutcome(trials) {
  const timingData = trials
    .filter(t => Number.isFinite(t.response_time_ms))
    .map(t => ({
      bucket: Math.floor(t.response_time_ms / 100) * 100, // 100ms buckets
      hit: t.subject_hit === 1 ? 1 : 0
    }));

  const bucketMap = new Map();
  timingData.forEach(t => {
    if (!bucketMap.has(t.bucket)) {
      bucketMap.set(t.bucket, { hits: 0, total: 0 });
    }
    const data = bucketMap.get(t.bucket);
    data.hits += t.hit;
    data.total += 1;
  });

  const results = Array.from(bucketMap.entries())
    .map(([bucket, data]) => ({
      bucket_ms: bucket,
      hit_rate: data.hits / data.total,
      count: data.total,
      hits: data.hits
    }))
    .sort((a, b) => a.bucket_ms - b.bucket_ms);

  return results;
}

// 10. Trial Position Effects Analysis
function analyzeTrialPositionEffects(trials) {
  const totalTrials = trials.length;
  const binSize = Math.max(5, Math.floor(totalTrials / 10)); // 10 bins minimum
  const results = [];

  for (let i = 0; i < totalTrials; i += binSize) {
    const binTrials = trials.slice(i, i + binSize);
    const hits = binTrials.reduce((a, t) => a + (t.subject_hit === 1 ? 1 : 0), 0);

    results.push({
      position_start: i + 1,
      position_end: Math.min(i + binSize, totalTrials),
      hit_rate: hits / binTrials.length,
      count: binTrials.length,
      hits
    });
  }

  return results;
}

// Block-Specific Analysis Panel Component
function BlockSpecificAnalysisPanel({ trials, title = 'Block-Specific Analysis' }) {
  if (!Array.isArray(trials) || trials.length === 0) return null;

  const hits = trials.filter(t => t.matched === 1).length;
  const total = trials.length;
  const hitRate = total > 0 ? hits / total : 0;

  // Basic block statistics only
  const redundant = trials.filter(t => t.redundancy_mode === 'redundant');
  const single = trials.filter(t => t.redundancy_mode === 'single');

  const redundantHits = redundant.filter(t => t.matched === 1).length;
  const singleHits = single.filter(t => t.matched === 1).length;

  const redundantRate = redundant.length > 0 ? redundantHits / redundant.length : 0;
  const singleRate = single.length > 0 ? singleHits / single.length : 0;

  // Debug output
  const blockTypes = [...new Set(trials.map(t => t.block_type))];

  return (
    <div style={{ border: '1px solid #ddd', padding: 16, marginTop: 16, borderRadius: 8, background: '#f9f9f9' }}>
      <h4 style={{ marginTop: 0 }}>{title}</h4>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
        Block types in data: {blockTypes.join(', ')} | Sessions: {trials.length > 0 ? [...new Set(trials.map(t => t.session_id))].length : 0}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <div><strong>Overall Performance:</strong></div>
          <div>Trials: {total}</div>
          <div>Hits: {hits}</div>
          <div>Hit Rate: {(hitRate * 100).toFixed(1)}%</div>
        </div>
        <div>
          <div><strong>By Condition:</strong></div>
          <div>Single: {singleHits}/{single.length} ({(singleRate * 100).toFixed(1)}%)</div>
          <div>Redundant: {redundantHits}/{redundant.length} ({(redundantRate * 100).toFixed(1)}%)</div>
        </div>
      </div>
    </div>
  );
}

// Complete Analysis Panel Component
function CompletePSIAnalysisPanel({ trials, title = 'Complete PSI Signatures' }) {
  if (!Array.isArray(trials) || trials.length === 0) return null;

  const coherenceAnalysis = analyzeCoherenceByRedundancy(trials);
  const sourceAnalysis = analyzeByRNGSource(trials);
  const sequentialAnalysis = analyzeSequentialDependency(trials);
  const targetBiasAnalysis = analyzeTargetSelectionBias(trials);
  const clusteringAnalysis = analyzeHitClustering(trials);
  const timingAnalysis = analyzeTimingOutcome(trials);
  const positionAnalysis = analyzeTrialPositionEffects(trials);
  const binauralAnalysis = analyzeBinauralBeatsEffect(trials);
  const responseTimeAnalysis = analyzeResponseTimeAccuracy(trials);

  return (
    <details style={{ marginTop: 12 }}>
      <summary>{title}</summary>

      <div style={{ marginTop: 8, display: 'grid', gap: 16 }}>

        {/* Coherence by Redundancy */}
        <div>
          <h4>Redundancy vs Single Flash Analysis</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
            {[coherenceAnalysis.single, coherenceAnalysis.redundant].filter(Boolean).map(group => (
              <div key={group.label} style={{ border: '1px solid #eee', padding: 12, borderRadius: 4, background: '#fafafa' }}>
                <div style={{ fontWeight: 'bold', marginBottom: 4 }}>{group.label}</div>
                <div style={{ fontSize: 13, lineHeight: 1.4 }}>
                  <div>Trials: {group.count}</div>
                  <div>Hit Rate: {(group.hit_rate * 100).toFixed(1)}%</div>
                  <div>Entropy: {group.entropy.toFixed(3)} bits</div>
                  <div>Autocorr(1): {group.autocorr[1]?.correlation.toFixed(4) || 'N/A'}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* RNG Source Comparison */}
        <div>
          <h4>RNG Source Analysis</h4>
          {sourceAnalysis.length > 0 ? (
            <table style={{ borderCollapse: 'collapse', marginTop: 4 }}>
              <thead>
                <tr>
                  <th style={{ padding: '4px 8px', textAlign: 'left', borderBottom: '1px solid #eee' }}>Source</th>
                  <th style={{ padding: '4px 8px', textAlign: 'right', borderBottom: '1px solid #eee' }}>Count</th>
                  <th style={{ padding: '4px 8px', textAlign: 'right', borderBottom: '1px solid #eee' }}>Hit Rate</th>
                  <th style={{ padding: '4px 8px', textAlign: 'right', borderBottom: '1px solid #eee' }}>Entropy</th>
                </tr>
              </thead>
              <tbody>
                {sourceAnalysis.map(row => (
                  <tr key={row.source}>
                    <td style={{ padding: '4px 8px' }}>{row.source}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right' }}>{row.count}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right' }}>{(row.hit_rate * 100).toFixed(1)}%</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right' }}>{row.entropy.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ color: '#666' }}>No RNG source data available</div>
          )}
        </div>

        {/* Sequential Dependencies */}
        <div>
          <h4>Sequential Dependencies (Trial-to-Trial Correlations)</h4>
          <table style={{ borderCollapse: 'collapse', marginTop: 4 }}>
            <thead>
              <tr>
                <th style={{ padding: '4px 8px', textAlign: 'left', borderBottom: '1px solid #eee' }}>Lag</th>
                <th style={{ padding: '4px 8px', textAlign: 'right', borderBottom: '1px solid #eee' }}>Correlation</th>
                <th style={{ padding: '4px 8px', textAlign: 'right', borderBottom: '1px solid #eee' }}>Expected</th>
                <th style={{ padding: '4px 8px', textAlign: 'right', borderBottom: '1px solid #eee' }}>Deviation</th>
              </tr>
            </thead>
            <tbody>
              {sequentialAnalysis.map(row => (
                <tr key={row.lag}>
                  <td style={{ padding: '4px 8px' }}>{row.lag}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right' }}>{row.correlation.toFixed(4)}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right' }}>{row.expected.toFixed(4)}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right' }}>{row.deviation.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Target Selection Bias */}
        <div>
          <h4>Target Selection Bias</h4>
          <table style={{ borderCollapse: 'collapse', marginTop: 4 }}>
            <thead>
              <tr>
                <th style={{ padding: '4px 8px', textAlign: 'left', borderBottom: '1px solid #eee' }}>Symbol</th>
                <th style={{ padding: '4px 8px', textAlign: 'right', borderBottom: '1px solid #eee' }}>Count</th>
                <th style={{ padding: '4px 8px', textAlign: 'right', borderBottom: '1px solid #eee' }}>Percentage</th>
                <th style={{ padding: '4px 8px', textAlign: 'right', borderBottom: '1px solid #eee' }}>Deviation</th>
              </tr>
            </thead>
            <tbody>
              {targetBiasAnalysis.map(row => (
                <tr key={row.symbol}>
                  <td style={{ padding: '4px 8px' }}>{row.symbol}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right' }}>{row.count}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right' }}>{row.percentage.toFixed(1)}%</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right' }}>{row.deviation.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Hit Clustering */}
        <div>
          <h4>Hit Clustering Analysis</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <strong>Hit Streaks:</strong>
              <div>Longest: {clusteringAnalysis.longest_hit_streak}</div>
              <div>Average: {clusteringAnalysis.avg_hit_streak.toFixed(1)}</div>
              <div>Count: {clusteringAnalysis.hit_streaks.length}</div>
            </div>
            <div>
              <strong>Miss Streaks:</strong>
              <div>Longest: {clusteringAnalysis.longest_miss_streak}</div>
              <div>Average: {clusteringAnalysis.avg_miss_streak.toFixed(1)}</div>
              <div>Count: {clusteringAnalysis.miss_streaks.length}</div>
            </div>
          </div>
        </div>

        {/* Timing vs Outcome */}
        <div>
          <h4>Response Timing vs Hit Rate</h4>
          {timingAnalysis.length > 0 ? (
            <table style={{ borderCollapse: 'collapse', marginTop: 4 }}>
              <thead>
                <tr>
                  <th style={{ padding: '4px 8px', textAlign: 'left', borderBottom: '1px solid #eee' }}>Timing (ms)</th>
                  <th style={{ padding: '4px 8px', textAlign: 'right', borderBottom: '1px solid #eee' }}>Count</th>
                  <th style={{ padding: '4px 8px', textAlign: 'right', borderBottom: '1px solid #eee' }}>Hit Rate</th>
                </tr>
              </thead>
              <tbody>
                {timingAnalysis.slice(0, 10).map(row => (
                  <tr key={row.bucket_ms}>
                    <td style={{ padding: '4px 8px' }}>{row.bucket_ms}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right' }}>{row.count}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right' }}>{(row.hit_rate * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ color: '#666' }}>No timing data available</div>
          )}
        </div>

        {/* Trial Position Effects */}
        <div>
          <h4>Trial Position Effects</h4>
          <table style={{ borderCollapse: 'collapse', marginTop: 4 }}>
            <thead>
              <tr>
                <th style={{ padding: '4px 8px', textAlign: 'left', borderBottom: '1px solid #eee' }}>Position</th>
                <th style={{ padding: '4px 8px', textAlign: 'right', borderBottom: '1px solid #eee' }}>Count</th>
                <th style={{ padding: '4px 8px', textAlign: 'right', borderBottom: '1px solid #eee' }}>Hit Rate</th>
              </tr>
            </thead>
            <tbody>
              {positionAnalysis.map((row, idx) => (
                <tr key={idx}>
                  <td style={{ padding: '4px 8px' }}>{row.position_start}-{row.position_end}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right' }}>{row.count}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right' }}>{(row.hit_rate * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Binaural Beats Effect Analysis */}
        <div>
          <h4>Binaural Beats Effect Analysis</h4>
          {binauralAnalysis.withBeats.count > 0 || binauralAnalysis.withoutBeats.count > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
              <div>
                <strong>With Binaural Beats:</strong>
                <div>Sessions: {binauralAnalysis.withBeats.count}</div>
                <div>Trials: {binauralAnalysis.withBeats.totalTrials}</div>
                <div>Hit Rate: {(binauralAnalysis.withBeats.avgHitRate * 100).toFixed(1)}%</div>
              </div>
              <div>
                <strong>Without Binaural Beats:</strong>
                <div>Sessions: {binauralAnalysis.withoutBeats.count}</div>
                <div>Trials: {binauralAnalysis.withoutBeats.totalTrials}</div>
                <div>Hit Rate: {(binauralAnalysis.withoutBeats.avgHitRate * 100).toFixed(1)}%</div>
              </div>
            </div>
          ) : (
            <div style={{ color: '#666' }}>No binaural beats data available</div>
          )}
          {binauralAnalysis.pValue !== null && (
            <div style={{ marginTop: 8, fontSize: 13 }}>
              <strong>Difference:</strong> {(binauralAnalysis.difference * 100).toFixed(1)}%
              {binauralAnalysis.pValue !== null && (
                <span> (p = {binauralAnalysis.pValue.toFixed(4)})</span>
              )}
            </div>
          )}
        </div>

        {/* Response Time vs Accuracy Analysis */}
        <div>
          <h4>Response Time vs Accuracy</h4>
          {!responseTimeAnalysis.error ? (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 8 }}>
                <div>
                  <strong>{responseTimeAnalysis.fast.label} Responders:</strong>
                  <div>Count: {responseTimeAnalysis.fast.count}</div>
                  <div>Avg Time: {responseTimeAnalysis.fast.avgTime}ms</div>
                  <div>Hit Rate: {responseTimeAnalysis.fast.hitRatePct}%</div>
                </div>
                <div>
                  <strong>{responseTimeAnalysis.medium.label} Responders:</strong>
                  <div>Count: {responseTimeAnalysis.medium.count}</div>
                  <div>Avg Time: {responseTimeAnalysis.medium.avgTime}ms</div>
                  <div>Hit Rate: {responseTimeAnalysis.medium.hitRatePct}%</div>
                </div>
                <div>
                  <strong>{responseTimeAnalysis.slow.label} Responders:</strong>
                  <div>Count: {responseTimeAnalysis.slow.count}</div>
                  <div>Avg Time: {responseTimeAnalysis.slow.avgTime}ms</div>
                  <div>Hit Rate: {responseTimeAnalysis.slow.hitRatePct}%</div>
                </div>
              </div>
              <div style={{ marginTop: 8, fontSize: 13 }}>
                <strong>Correlation:</strong> {responseTimeAnalysis.correlation.toFixed(3)}
                ({responseTimeAnalysis.correlationDirection} correlation between response time and accuracy)
              </div>
            </div>
          ) : (
            <div style={{ color: '#666' }}>{responseTimeAnalysis.error}</div>
          )}
        </div>

      </div>
    </details>
  );
}
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

/* ---- Tiny histogram (no libs) ---- */
function buildHistogram(values, binSize = 2) {
  const clean = values.filter((v) => Number.isFinite(v));
  if (!clean.length) return [];
  const bins = new Map(); // key = binStart e.g. 24, 26, ...
  for (const v of clean) {
    const clamped = Math.max(0, Math.min(100, v));
    const k = Math.floor(clamped / binSize) * binSize;
    bins.set(k, (bins.get(k) || 0) + 1);
  }
  return Array.from(bins.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([start, count]) => ({
      start,
      end: start + binSize,
      count,
    }));
}

function Histogram({
  title = 'Accuracy per run',
  values,
  bin = 2,
  width = 520,
  height = 200,
}) {
  const data = buildHistogram(values || [], bin);
  if (!data.length) return null;

  const padL = 32,
    padB = 24,
    padR = 8,
    padT = 24;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const maxCount = Math.max(...data.map((d) => d.count));
  const xStep = plotW / data.length;

  const barW = Math.max(1, xStep * 0.9);
  const yTo = (c) => padT + plotH - (plotH * c) / (maxCount || 1);

  return (
    <figure style={{ margin: '12px 0' }}>
      <figcaption style={{ marginBottom: 4 }}>{title}</figcaption>
      <svg width={width} height={height} aria-label={title}>
        {/* axes */}
        <line
          x1={padL}
          y1={padT}
          x2={padL}
          y2={padT + plotH}
          stroke="#999"
        />
        <line
          x1={padL}
          y1={padT + plotH}
          x2={padL + plotW}
          y2={padT + plotH}
          stroke="#999"
        />

        {/* bars */}
        {data.map((d, i) => {
          const x = padL + i * xStep + (xStep - barW) / 2;
          const y = yTo(d.count);
          const h = padT + plotH - y;
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={barW}
              height={h}
              fill="#4c78a8"
            />
          );
        })}

        {/* simple x ticks at 0, 20, 40, 60, 80, 100 */}
        {[0, 20, 40, 60, 80, 100].map((t) => {
          const x = padL + (t / 100) * plotW;
          return (
            <g key={t}>
              <line
                x1={x}
                y1={padT + plotH}
                x2={x}
                y2={padT + plotH + 4}
                stroke="#999"
              />
              <text
                x={x}
                y={padT + plotH + 14}
                textAnchor="middle"
                fontSize="10"
              >
                {t}
              </text>
            </g>
          );
        })}

        {/* y max label */}
        <text
          x={padL - 6}
          y={padT + 8}
          textAnchor="end"
          fontSize="10"
        >
          {maxCount}
        </text>
      </svg>
    </figure>
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

/* ---------------- small math helpers ---------------- */

// Generic binomial Z against any p0 in (0,1)
const binomZAgainst = (p0, k, n) =>
  n ? (k - n * p0) / Math.sqrt(n * p0 * (1 - p0)) : 0;

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
function runRngSanityTest() {
  const N = 10000,
    k = 5;
  const pick = () => Math.floor(Math.random() * k);
  const pct = (x) => ((100 * x) / N).toFixed(2) + '%';

  let physHits = 0,
    qFixedHits = 0,
    qBugHits = 0;

  for (let i = 0; i < N; i++) {
    const remapR = pick();
    const targetP = (pick() + remapR) % k;
    const demonP = (pick() + remapR) % k;
    if (demonP === targetP) physHits++;
  }
  for (let i = 0; i < N; i++) {
    const remapR = pick();
    const target = (pick() + remapR) % k;
    const demon = (pick() + remapR) % k;
    if (demon === target) qFixedHits++;
  }
  for (let i = 0; i < N; i++) {
    const remapR = pick();
    const s = pick(),
      g = pick();
    const target = (s + remapR) % k;
    const rPrime = (remapR + (g % k)) % k; // old buggy extra rotation
    const demon = (g + rPrime) % k;
    if (demon === target) qBugHits++;
  }

}

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

    // Helper function to get demon hit value (same logic as MainApp getDemonHit)
    const getDemonHit = (r) => {
      // Check for ghost_hit field first
      if (typeof r.ghost_hit === 'number') return r.ghost_hit;

      // Use ghost_index_0based and selected_index to calculate ghost hit
      if (
        typeof r.selected_index === 'number' &&
        typeof r.ghost_index_0based === 'number'
      ) {
        return r.selected_index === r.ghost_index_0based ? 1 : 0;
      }

      // Fallback to old logic
      if (
        typeof r.selected_index === 'number' &&
        typeof r.ghost_is_right === 'number'
      ) {
        const ghostIndex = r.ghost_is_right ? 1 : 0;
        return r.selected_index === ghostIndex ? 1 : 0;
      }
      return null;
    };

    for (let i = 0; i < N; i++) {
      const t = trials[i] || {};
      const p = Number(t.subject_hit) === 1 ? 1 : 0;
      const ghostHitValue = getDemonHit(t);
      const g = Number(ghostHitValue) === 1 ? 1 : 0;

      // Debug: log first few trials to see actual values (remove when debugging complete)
      if (i < 3) {
      }

      hp += p;
      hg += g;

      if (p === 1 && g === 0) n10++;
      if (p === 0 && g === 1) n01++;

      const pos = t.primary_pos;
      if (pos === 1 || pos === 2) {
        if (lastPos != null && pos === lastPos) altOK = false;
        lastPos = pos;
      }

      const qc = t.qrng_code;
      if (qc != null && qc !== 1 && qc !== 2) qrngOK = false;
    }

    const pctP = (100 * hp) / N;
    const pctG = (100 * hg) / N;

    // Debug logging for demon percentage investigation

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
  const p0 = 0.2; // 5-choice chance
  const zGhost = binomZAgainst(p0, Kg, Ntot);
  const pGhost = twoSidedP(zGhost);
  const zPrimaryP0 = binomZAgainst(p0, Kp, Ntot);
  const pPrimaryP0 = twoSidedP(zPrimaryP0);

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
      primaryVsChance: { z: zPrimaryP0, p: pPrimaryP0, p0 },
      primaryVsGhost: {
        z: zPP,
        p: pPP,
        method: 'two-proportion z (pooled)',
      },
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
  const p0 = 0.2;
  const chancePct = 100 * p0;
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
      const p = Number(t.subject_hit) === 1 ? 1 : 0;
      const g = Number(t.ghost_hit) === 1 ? 1 : 0;

      hp += p;
      hg += g;
      if (p === 1 && g === 0) n10++;
      if (p === 0 && g === 1) n01++;
      const pos = t.primary_pos;
      if (pos === 1 || pos === 2) {
        if (lastPos != null && pos === lastPos) altOK = false;
        lastPos = pos;
      }
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
  const tGhostVsChance = gSE ? (meanG - chancePct) / gSE : 0;
  const pGhostVsChance = tTwoSidedP_fromNormalApprox(
    tGhostVsChance,
    Math.max(1, n - 1)
  );
  const pVar = variance(pctPrimaryArr, meanP);
  const pSE = n > 1 ? Math.sqrt(pVar / n) : 0;
  const tPrimaryVsChance = pSE ? (meanP - chancePct) / pSE : 0;
  const pPrimaryVsChance = tTwoSidedP_fromNormalApprox(
    tPrimaryVsChance,
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
        t: tGhostVsChance,
        p: pGhostVsChance,
        df: Math.max(1, n - 1),
        type: 'one-sample t (approx)',
        p0,
      },
      primaryVsChance: {
        t: tPrimaryVsChance,
        p: pPrimaryVsChance,
        df: Math.max(1, n - 1),
        type: 'one-sample t (approx)',
        p0,
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

/* ==== NEW: early-exit helpers (DYNAMIC from config.trialsPerBlock) ==== */
const getBaselineTrials = (doc) =>
  (doc?.full_stack?.trialResults || []).length;
const getQuantumTrials = (doc) =>
  (doc?.spoon_love?.trialResults || []).length;
const getClientLocalTrials = (doc) =>
  (doc?.client_local?.trialResults || []).length;

// Pull straight from config.trialsPerBlock, with simple numeric fallbacks
const MIN_FULL_STACK = Number(
  config?.completerMin?.full_stack ??
  config?.trialsPerBlock?.full_stack ??
  20
);
const MIN_SPOON_LOVE = Number(
  config?.completerMin?.spoon_love ??
  config?.trialsPerBlock?.spoon_love ??
  20
);
const MIN_CLIENT_LOCAL = Number(
  config?.completerMin?.client_local ??
  config?.trialsPerBlock?.client_local ??
  20
);

function isCompleter(doc) {
  return (
    getBaselineTrials(doc) >= MIN_FULL_STACK &&
    getQuantumTrials(doc) >= MIN_SPOON_LOVE &&
    getClientLocalTrials(doc) >= MIN_CLIENT_LOCAL
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

/*-----------------------PATTERNS------------------------*/

function PatternsPanel({ trials, title = 'Patterns' }) {
  // ---------- Helpers (scoped to this component) ----------
  const firstInt = (row, keys) => {
    for (const k of keys) {
      const v = row?.[k];
      if (Number.isInteger(v)) return v;
    }
    return null;
  };
  const firstVal = (row, keys) => {
    for (const k of keys) {
      const v = row?.[k];
      if (v != null) return v;
    }
    return null;
  };
  const listFrom = (row) => {
    for (const k of [
      'options',
      'display_order',
      'symbols',
      'choices',
      'stimulus_ids',
      'buttons',
      'ids',
    ]) {
      if (Array.isArray(row?.[k])) return row[k];
    }
    return null;
  };
  const getIndexFromIdAndList = (id, list) => {
    if (!list) return null;
    for (let idx = 0; idx < list.length; idx++) {
      const v = list[idx];
      if (v === id) return idx; // array of ids like ["A","B",...]
      if (v && typeof v === 'object') {
        if (
          v.id === id ||
          v._id === id ||
          v.key === id ||
          v.value === id
        )
          return idx;
      }
    }
    return null;
  };
  const getPick = (row) => {
    const idx = firstInt(row, [
      'selected_index',
      'subject_index_0based',
      'subject_index',
      'choice_index',
      'response_index',
      'pressed_index',
      'button_index',
      'subject_choice_index',
      'subjectSelectedIndex',
      'selectedIdx',
    ]);
    if (idx != null) return idx;
    const id = firstVal(row, [
      'selected_id',
      'subject_id',
      'choice_id',
      'answer_id',
      'picked_id',
      'clicked_id',
    ]);
    if (id != null) {
      const j = getIndexFromIdAndList(id, listFrom(row));
      if (Number.isInteger(j)) return j;
    }
    return null;
  };
  const getTgt = (row) => {
    const idx = firstInt(row, [
      'target_index_0based',
      'target_index',
      'correct_index',
    ]);
    if (idx != null) return idx;
    const id = firstVal(row, [
      'target_id',
      'target',
      'correct_id',
      'answer_id',
      'answer_index',
      'correct_position',
    ]);
    if (id != null) {
      const j = getIndexFromIdAndList(id, listFrom(row));
      if (Number.isInteger(j)) return j;
    }
    return null;
  };

  if (!Array.isArray(trials) || trials.length === 0) return null;
  // DEBUG coverage counts
  const _dbg = { total: trials.length, pickOK: 0, tgtOK: 0 };
  for (const r of trials) {
    if (Number.isInteger(getPick(r))) _dbg.pickOK++;
    if (Number.isInteger(getTgt(r))) _dbg.tgtOK++;
  }

  // ---------- 1) Position bias ----------
  const posCounts = Array(5).fill(0);
  let validPickCount = 0;
  for (const r of trials) {
    const i = getPick(r);
    if (Number.isInteger(i) && i >= 0 && i < 5) {
      posCounts[i]++;
      validPickCount++;
    }
  }
  const posPct = posCounts.map((n) =>
    validPickCount ? ((100 * n) / validPickCount).toFixed(1) : '0.0'
  );

  // ---------- 2) Streakiness (skip null picks) ----------
  const runLengths = [];
  let prevPick = null;
  let run = 0;
  for (const r of trials) {
    const pick = getPick(r);
    if (!Number.isInteger(pick)) continue;
    if (prevPick === null) {
      prevPick = pick;
      run = 1;
    } else if (pick === prevPick) {
      run++;
    } else {
      runLengths.push(run);
      prevPick = pick;
      run = 1;
    }
  }
  if (run > 0) runLengths.push(run);

  // ---------- 3) Lag-k alignment ----------
  const lagRows = [];
  for (let k = 1; k <= 5; k++) {
    let n = 0,
      hit = 0;
    for (let t = 0; t + k < trials.length; t++) {
      const pick = getPick(trials[t]);
      const tgt = getTgt(trials[t + k]);
      if (Number.isInteger(pick) && Number.isInteger(tgt)) {
        n++;
        if (pick === tgt) hit++;
      }
    }
    lagRows.push({
      k,
      n,
      pct: n ? ((100 * hit) / n).toFixed(1) : '—',
    });
  }

  // ---------- 4) Timing vs accuracy (optional) ----------
  const withBuckets = trials.filter((r) =>
    Number.isFinite(r.response_time_ms)
  );
  let timingLine = null;
  if (withBuckets.length) {
    const sorted = [...withBuckets].sort(
      (a, b) => a.response_time_ms - b.response_time_ms
    );
    const median =
      sorted[Math.floor(sorted.length / 2)].response_time_ms;
    const acc = (arr) => {
      const n = arr.length;
      const k = arr.reduce(
        (a, t) => a + (Number(t.subject_hit) === 1 ? 1 : 0),
        0
      );
      return n ? ((100 * k) / n).toFixed(1) : '—';
    };
    const fast = withBuckets.filter(
      (t) => t.response_time_ms <= median
    );
    const slow = withBuckets.filter(
      (t) => t.response_time_ms > median
    );
    timingLine = `Fast: ${acc(fast)}%  |  Slow: ${acc(slow)}% (N=${withBuckets.length
      })`;
  }

  return (
    <details style={{ marginTop: 12 }}>
      <summary>{title}</summary>
      <small style={{ color: '#666', marginLeft: 8 }}>
        N={_dbg.total}, picks={_dbg.pickOK}, tgts={_dbg.tgtOK}
      </small>

      <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
        <div>
          <strong>Position bias</strong>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            {posPct.map((p, i) => (
              <span
                key={i}
                style={{ display: 'inline-block', minWidth: 54 }}
              >
                {`Pos ${i}: ${p}%`}
              </span>
            ))}
          </div>
        </div>

        <div>
          <strong>Streakiness</strong>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            {runLengths.length
              ? `Run lengths: ${runLengths.join(', ')}`
              : 'No valid picks'}
          </div>
        </div>

        <div>
          <strong>Lag-k alignment</strong>
          <table style={{ borderCollapse: 'collapse', marginTop: 4 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '2px 8px' }}>
                  k
                </th>
                <th
                  style={{ textAlign: 'right', padding: '2px 8px' }}
                >
                  N
                </th>
                <th
                  style={{ textAlign: 'right', padding: '2px 8px' }}
                >
                  % equal
                </th>
              </tr>
            </thead>
            <tbody>
              {lagRows.map((r) => (
                <tr key={r.k}>
                  <td style={{ padding: '2px 8px' }}>{r.k}</td>
                  <td
                    style={{ padding: '2px 8px', textAlign: 'right' }}
                  >
                    {r.n}
                  </td>
                  <td
                    style={{ padding: '2px 8px', textAlign: 'right' }}
                  >
                    {r.pct}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {timingLine && (
          <div>
            <strong>Timing vs accuracy</strong>
            <div style={{ fontSize: 13, marginTop: 4 }}>
              {timingLine}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
// ADD THESE THREE COMPONENTS RIGHT BEFORE "export default function QAExport() {"

// Main Results Summary Component
const MainResultsSummary = ({ reportPRNG, reportQRNG, reportCL }) => {
  if (!reportPRNG || !reportQRNG || !reportCL ||
      !reportPRNG.totals || !reportQRNG.totals || !reportCL.totals ||
      reportPRNG.totals.pctPrimary == null || reportQRNG.totals.pctPrimary == null || reportCL.totals.pctPrimary == null) {
    return (
      <div style={{
        marginTop: 16,
        padding: '16px 20px',
        border: '2px solid #e5e7eb',
        borderRadius: 12,
        background: '#f9fafb',
        marginBottom: 24,
        textAlign: 'center'
      }}>
        <h2 style={{ margin: '0 0 16px 0', fontSize: 24, color: '#1f2937' }}>
          🎯 EXPERIMENT RESULTS SUMMARY
        </h2>
        <div style={{ fontSize: 16, color: '#6b7280' }}>
          No data available
        </div>
      </div>
    );
  }

  const getStatus = (report) => {
    const pValue = report.tests.primaryVsChance.p;
    const rate = report.totals.pctPrimary;

    if (pValue < 0.05 && rate > 20) return { icon: '✓', color: '#22c55e', text: 'Significant' };
    if (pValue < 0.05 && rate < 20) return { icon: '✗', color: '#ef4444', text: 'Significant Below' };
    return { icon: '⚪', color: '#eab308', text: 'Not significant' };
  };

  const physicalStatus = getStatus(reportPRNG);
  const quantumStatus = getStatus(reportQRNG);
  const localStatus = getStatus(reportCL);

  const bestPerformance = [
    { name: 'Physical', rate: reportPRNG.totals.pctPrimary, significant: physicalStatus.icon === '✓' },
    { name: 'Quantum', rate: reportQRNG.totals.pctPrimary, significant: quantumStatus.icon === '✓' },
    { name: 'Local', rate: reportCL.totals.pctPrimary, significant: localStatus.icon === '✓' }
  ].reduce((best, current) => current.rate > best.rate ? current : best);

  const totalTrials = reportPRNG.totals.trials + reportQRNG.totals.trials + reportCL.totals.trials;

  return (
    <div style={{
      marginTop: 16,
      padding: '16px 20px',
      border: '2px solid #e5e7eb',
      borderRadius: 12,
      background: '#f9fafb',
      marginBottom: 24
    }}>
      <h2 style={{ margin: '0 0 16px 0', fontSize: 24, color: '#1f2937' }}>
        🎯 EXPERIMENT RESULTS SUMMARY
      </h2>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div style={{
          padding: 12,
          border: '1px solid #d1d5db',
          borderRadius: 8,
          background: '#fff',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 4 }}>Physical RNG</div>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: physicalStatus.color }}>
            {physicalStatus.icon} {reportPRNG.totals.pctPrimary.toFixed(1)}%
          </div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            vs 20% chance (p={reportPRNG.tests.primaryVsChance.p.toFixed(3)})
          </div>
        </div>

        <div style={{
          padding: 12,
          border: '1px solid #d1d5db',
          borderRadius: 8,
          background: '#fff',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 4 }}>Quantum RNG</div>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: quantumStatus.color }}>
            {quantumStatus.icon} {reportQRNG.totals.pctPrimary.toFixed(1)}%
          </div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            vs 20% chance (p={reportQRNG.tests.primaryVsChance.p.toFixed(3)})
          </div>
        </div>

        <div style={{
          padding: 12,
          border: '1px solid #d1d5db',
          borderRadius: 8,
          background: '#fff',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 4 }}>Local RNG</div>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: localStatus.color }}>
            {localStatus.icon} {reportCL.totals.pctPrimary.toFixed(1)}%
          </div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            vs 20% chance (p={reportCL.tests.primaryVsChance.p.toFixed(3)})
          </div>
        </div>
      </div>

      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '12px 16px',
        background: '#e0f2fe',
        borderRadius: 8,
        border: '1px solid #0891b2'
      }}>
        <div>
          <strong>📊 BEST PERFORMANCE:</strong> {bestPerformance.name} RNG
          (+{(bestPerformance.rate - 20).toFixed(1)}% above chance)
        </div>
        <div>
          <strong>🔬 TOTAL TRIALS:</strong> {totalTrials.toLocaleString()}
        </div>
      </div>
    </div>
  );
};

// RNG Validation Summary Component
const RNGValidationSummary = ({ reportPRNG, reportQRNG, reportCL }) => {
  const getValidationStatus = (report) => {
    if (!report || !report.totals || !report.tests) {
      return { icon: '⏳', status: 'No data available', color: '#6b7280' };
    }

    const demonRate = report.totals.pctGhost;
    const demonP = report.tests.rngBiasGhost.p;

    if (demonP < 0.05 && demonRate > 25) return { icon: '⚠️', status: 'WARNING: Demon unusually high', color: '#f59e0b' };
    if (demonP < 0.05 && demonRate < 15) return { icon: '⚠️', status: 'WARNING: Demon unusually low', color: '#f59e0b' };
    return { icon: '✓', status: 'RNG functioning normally', color: '#22c55e' };
  };

  const physicalStatus = getValidationStatus(reportPRNG);
  const quantumStatus = getValidationStatus(reportQRNG);
  const localStatus = getValidationStatus(reportCL);

  const redFlags = [];
  if (physicalStatus.icon === '⚠️') redFlags.push(`Physical: ${physicalStatus.status}`);
  if (quantumStatus.icon === '⚠️') redFlags.push(`Quantum: ${quantumStatus.status}`);
  if (localStatus.icon === '⚠️') redFlags.push(`Local: ${localStatus.status}`);

  return (
    <div style={{ marginTop: 16, marginBottom: 16 }}>
      <h3 style={{ margin: '0 0 12px 0', fontSize: 18 }}>🔧 RNG SOURCE VALIDATION</h3>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div style={{
          padding: 10,
          border: `1px solid ${physicalStatus.color}`,
          borderRadius: 6,
          background: '#fff'
        }}>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Physical RNG</div>
          <div style={{ fontSize: 14, color: physicalStatus.color }}>
            {physicalStatus.icon} Control: {reportPRNG?.totals?.pctGhost?.toFixed(1) ?? 'N/A'}%
          </div>
        </div>

        <div style={{
          padding: 10,
          border: `1px solid ${quantumStatus.color}`,
          borderRadius: 6,
          background: '#fff'
        }}>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Quantum RNG</div>
          <div style={{ fontSize: 14, color: quantumStatus.color }}>
            {quantumStatus.icon} Control: {reportQRNG?.totals?.pctGhost?.toFixed(1) ?? 'N/A'}%
          </div>
        </div>

        <div style={{
          padding: 10,
          border: `1px solid ${localStatus.color}`,
          borderRadius: 6,
          background: '#fff'
        }}>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Local RNG</div>
          <div style={{ fontSize: 14, color: localStatus.color }}>
            {localStatus.icon} Control: {reportCL?.totals?.pctGhost?.toFixed(1) ?? 'N/A'}%
          </div>
        </div>
      </div>

      {redFlags.length > 0 && (
        <div style={{
          padding: '8px 12px',
          background: '#fef3c7',
          border: '1px solid #f59e0b',
          borderRadius: 6,
          marginBottom: 8
        }}>
          <strong>⚠️ RED FLAGS DETECTED:</strong>
          <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
            {redFlags.map((flag, i) => <li key={i}>{flag}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
};

// Metric Explanations Component
const MetricExplanations = () => (
  <details style={{ marginTop: 8, marginBottom: 16 }}>
    <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>
      📖 What Each Metric Means
    </summary>
    <div style={{ marginTop: 8, padding: 12, background: '#f9fafb', borderRadius: 6 }}>
      <div style={{ display: 'grid', gap: 8 }}>
        <div>
          <strong>Hit Rate:</strong> % of correct guesses (expecting 20% by chance in 5-choice task)
        </div>
        <div>
          <strong>P-value vs chance:</strong> Probability this result happened by luck (want &lt;0.05 for significance)
        </div>
        <div>
          <strong>P-value vs control:</strong> Whether subject beat the control condition significantly
        </div>
        <div>
          <strong>Control performance:</strong> How the "demon" (random baseline) performed - should be ~20%
        </div>
        <div>
          <strong>Position bias:</strong> Whether certain card positions are picked more often than others
        </div>
        <div>
          <strong>Streakiness:</strong> Whether hits/misses cluster together unnaturally
        </div>
      </div>

      <div style={{ marginTop: 12, padding: 8, background: '#fee2e2', borderRadius: 4 }}>
        <strong>🚨 Red Flags to Watch For:</strong>
        <ul style={{ margin: '4px 0 0 16px', fontSize: 14 }}>
          <li>Control performing much better or worse than 20%</li>
          <li>Extreme position bias (&gt;40% in any position)</li>
          <li>Very long streaks of hits/misses</li>
          <li>P-values that flip dramatically with small data changes</li>
        </ul>
      </div>
    </div>
  </details>
);

/* ---------------------- COMPONENT ---------------------- */
export default function QAExport() {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [reportPRNG, setReportPRNG] = useState(null); // full_stack (Physical)
  const [reportQRNG, setReportQRNG] = useState(null); // spoon_love (Quantum)
  const [reportCL, setReportCL] = useState(null); // client_local (Local)
  const [reportALL, setReportALL] = useState(null); // pooled across blocks
  const [error, setError] = useState('');
  const [authed, setAuthed] = useState(false);
  const [canToggle, setCanToggle] = useState(false);
  const [uid, setUid] = useState('');
  const [qaStatus, setQaStatus] = useState(null);
  const [toggling, setToggling] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [qaDebug, setQaDebug] = useState(null);

  /* ==== NEW: mode/summary state ==== */
  const [mode, setMode] = useState('pooled'); // 'pooled' | 'completers' | 'sessionWeighted'
  const [binauralFilter, setBinauralFilter] = useState('all'); // 'all' | 'yes' | 'no'
  const [summary, setSummary] = useState({
    total: 0,
    completers: 0,
    nonCompleters: 0,
    exitBreakdown: [],
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
  // ✅ Determine if current user is allowed to toggle QA
  useEffect(() => {
    (async () => {
      try {
        const u = auth.currentUser;
        if (!u) {
          setCanToggle(false);
          return;
        }

        const t = await u.getIdTokenResult();
        const provider = t.signInProvider; // must be "password"
        const email = u.email || '';

        const snap = await getDoc(doc(db, 'admin', 'qa'));
        const qa = snap.exists() ? snap.data() : {};
        const whitelisted =
          Array.isArray(qa.emails) && qa.emails.includes(email);

        setCanToggle(provider === 'password' && whitelisted);
      } catch {
        setCanToggle(false);
      }
    })();
  }, [authed, qaStatus]); // recompute when auth or QA doc changes

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
  // 🔀 Toggle QA enabled (allowed only for whitelisted email+password users)
  // 🔀 Toggle QA enabled (allowed only for whitelisted email+password users)
  const toggleQA = async () => {
    if (!qaStatus) return;
    if (!canToggle) {
      setError(
        'Sign in with email+password and be on admin/qa.emails to toggle QA.'
      );
      return;
    }
    try {
      setToggling(true);
      const qaRef = doc(db, 'admin', 'qa');
      await updateDoc(qaRef, { enabled: !qaStatus.enabled });
      await reloadQaStatus(); // UI state comes from Firestore
      setError('');
    } catch (err) {
      console.error('Error toggling QA:', err);
      setError(`Denied: ${err?.code || ''} ${err?.message || err}`);
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
  }, [mode, binauralFilter]);
  // If trial arrays are not in the main doc, fetch them from the subcollection
  const hydrateTrialDetails = async (rows) => {
    const jobs = rows.map(async (d) => {
      const hasFs =
        Array.isArray(d?.full_stack?.trialResults) &&
        d.full_stack.trialResults.length;
      const hasSl =
        Array.isArray(d?.spoon_love?.trialResults) &&
        d.spoon_love.trialResults.length;
      const hasCl =
        Array.isArray(d?.client_local?.trialResults) &&
        d.client_local.trialResults.length;

      if (hasFs && hasSl && hasCl) return d;
      if (!d.id) return d;

      try {
        const ref = doc(
          db,
          'experiment1_responses',
          d.id,
          'details',
          'trialDetails'
        );
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const det = snap.data() || {};
          d.full_stack = d.full_stack || {};
          d.spoon_love = d.spoon_love || {};
          d.client_local = d.client_local || {};

          if (!hasFs && Array.isArray(det.full_stack_trials))
            d.full_stack.trialResults = det.full_stack_trials;

          if (!hasSl && Array.isArray(det.spoon_love_trials))
            d.spoon_love.trialResults = det.spoon_love_trials;


          if (!hasCl && Array.isArray(det.client_local_trials))
            d.client_local.trialResults = det.client_local_trials;
        }

        // No longer needed: trialDetails now contains complete data including redundancy_mode
        // All trial data comes from the /details/trialDetails subcollection
      } catch (_) {
        // ignore hydration errors for a single doc
      }
      return d;
    });

    await Promise.all(jobs);
    return rows;
  };

  // Fetch commit–reveal artifacts (hash, salt, tapes) for one run
  const fetchRevealForRun = async (runId) => {
    try {
      const snap = await getDocs(
        collection(db, 'experiment1_responses', runId, 'reveal')
      );
      return snap.docs.map((d) => {
        const r = d.data() || {};
        const revealed_at = r.revealed_at?.toDate
          ? r.revealed_at.toDate().toISOString()
          : r.revealed_at ?? null;
        return {
          id: d.id,
          block_type: r.block_type ?? null,
          commit_algo: r.commit_algo ?? 'SHA-256',
          commit_hash_hex: r.commit_hash_hex ?? null,
          salt_hex: r.salt_hex ?? null,
          tape_pairs_b64: r.tape_pairs_b64 ?? null,
          bytes_per_trial: r.bytes_per_trial ?? null,
          tape_length_trials: r.tape_length_trials ?? null,
          revealed_at,
          created_iso: r.created_iso ?? null,
          rng_source: r.rng_source ?? null,
        };
      });
    } catch (_) {
      return [];
    }
  };

  // 📦 Fetch all sessions and build reports + priming A/B p-values
  const fetchAll = async () => {
    setBusy(true);
    setError('');
    setReportPRNG(null);
    setReportQRNG(null);
    setReportCL(null);
    setReportALL(null);

    const coll = collection(db, 'experiment1_responses');
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

    // Helper to check binaural usage
    const sessionBinaural = (d) => {
      const response = d?.postResponses?.binaural_beats || '';
      if (response === 'No' || response === 'What are binaural beats?') return 'no';
      if (response.includes('Yes')) return 'yes';
      return 'unknown';
    };

    // session filter per mode + binaural
    const baseSessionFilter =
      mode === 'completers' ? (d) => isCompleter(d) : () => true;
    const passesBinauralFilter =
      binauralFilter === 'all'
        ? () => true
        : (d) => sessionBinaural(d) === binauralFilter;
    const combinedFilter = (d) =>
      baseSessionFilter(d) && passesBinauralFilter(d);

    // trial extractors for each block
    const getPRNG = (doc) => {
      const all = doc?.full_stack?.trialResults || [];
      const valid = all.filter(
        (t) => t.target_index_0based !== null && t.target_index_0based !== undefined &&
               t.selected_index !== null && t.selected_index !== undefined &&
               t.ghost_index_0based !== null && t.ghost_index_0based !== undefined
      );
      return all; // Return unfiltered for now
    };
    const getQRNG = (doc) => {
      const all = doc?.spoon_love?.trialResults || [];
      const valid = all.filter(
        (t) => t.target_index_0based !== null && t.target_index_0based !== undefined &&
               t.selected_index !== null && t.selected_index !== undefined &&
               t.ghost_index_0based !== null && t.ghost_index_0based !== undefined
      );
      return all; // Return unfiltered for now
    };
    const getCL = (doc) => {
      const all = doc?.client_local?.trialResults || [];
      const valid = all.filter(
        (t) => t.target_index_0based !== null && t.target_index_0based !== undefined &&
               t.selected_index !== null && t.selected_index !== undefined &&
               t.ghost_index_0based !== null && t.ghost_index_0based !== undefined
      );
      return all; // Return unfiltered for now
    };
    let rPRNG, rQRNG, rCL;
    if (mode === 'sessionWeighted') {
      rPRNG = computeStatsSessionWeighted(
        all,
        getPRNG,
        combinedFilter
      );
      rQRNG = computeStatsSessionWeighted(
        all,
        getQRNG,
        combinedFilter
      );
      rCL = computeStatsSessionWeighted(all, getCL, combinedFilter);
    } else {
      rPRNG = computeStats(all, getPRNG, combinedFilter);
      rQRNG = computeStats(all, getQRNG, combinedFilter);
      rCL = computeStats(all, getCL, combinedFilter);
    }

    // Build pooled (ALL) report by concatenating trials from all blocks
    const getALL = (doc) => [
      ...(doc?.full_stack?.trialResults || []),
      ...(doc?.spoon_love?.trialResults || []),
      ...(doc?.client_local?.trialResults || []),
    ];

    let rALL;
    if (mode === 'sessionWeighted') {
      rALL = computeStatsSessionWeighted(all, getALL, combinedFilter);
    } else {
      rALL = computeStats(all, getALL, combinedFilter);
    }

    setReportPRNG(rPRNG);
    setReportQRNG(rQRNG);
    setReportCL(rCL);
    setReportALL(rALL);
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
  // Download sessions INCLUDING details/trialDetails AND commit–reveal artifacts
  const downloadJSONWithTrialsAndReveal = async () => {
    try {
      setBusy(true);
      // Ensure trial arrays exist on every row
      const complete = await hydrateTrialDetails(
        rows.map((r) => ({ ...r }))
      );

      // Attach commit–reveal artifacts to each session
      const payload = await Promise.all(
        complete.map(async (d) => {
          const reveal = d.id ? await fetchRevealForRun(d.id) : [];
          return {
            id: d.id,
            ...d,
            full_stack: {
              ...(d.full_stack || {}),
              trialResults:
                d.full_stack?.trialResults ||
                d.full_stack_trials ||
                [],
            },
            spoon_love: {
              ...(d.spoon_love || {}),
              trialResults:
                d.spoon_love?.trialResults ||
                d.spoon_love_trials ||
                [],
            },
            client_local: {
              ...(d.client_local || {}),
              trialResults:
                d.client_local?.trialResults ||
                d.client_local_trials || // fallback if ever present flat
                [],
            },
            // Commit–reveal artifacts for cryptographic audit
            reveal,
          };
        })
      );

      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sessions_with_trials_and_reveal.json';
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

  const firstTenPRNG = useMemo(
    () => makeFirstTen(reportPRNG),
    [reportPRNG]
  );
  const firstTenQRNG = useMemo(
    () => makeFirstTen(reportQRNG),
    [reportQRNG]
  );
  const firstTenCL = useMemo(
    () => makeFirstTen(reportCL),
    [reportCL]
  );
  const firstTenALL = useMemo(
    () => makeFirstTen(reportALL),
    [reportALL]
  );
  const completerDebugRows = useMemo(() => {
    return rows.slice(0, 20).map((d) => ({
      id: d.id || d.session_id || '(no id)',
      fs: (d?.full_stack?.trialResults || []).length,
      sl: (d?.spoon_love?.trialResults || []).length,
      cl: (d?.client_local?.trialResults || []).length,
      min_fs: MIN_FULL_STACK,
      min_sl: MIN_SPOON_LOVE,
      min_cl: MIN_CLIENT_LOCAL,
      completer: isCompleter(d),
    }));
  }, [rows]);

  // Removed histogram calculations - not providing useful info
  // RNG randomness (ghost/demon vs 20%) by RNG source
  // Flatten trials across all sessions for each block (for PatternsPanel)
  // Apply the same filtering logic as the statistical reports
  const trialsFSAll = useMemo(() => {
    const sessionBinaural = (d) => {
      const response = d?.postResponses?.binaural_beats || '';
      if (response === 'No' || response === 'What are binaural beats?') return 'no';
      if (response.includes('Yes')) return 'yes';
      return 'unknown';
    };

    const baseSessionFilter = mode === 'completers' ? (d) => isCompleter(d) : () => true;
    const passesBinauralFilter = binauralFilter === 'all' ? () => true : (d) => sessionBinaural(d) === binauralFilter;
    const combinedFilter = (d) => baseSessionFilter(d) && passesBinauralFilter(d);

    return rows.filter(combinedFilter).flatMap((d) => d?.full_stack?.trialResults || []);
  }, [rows, mode, binauralFilter]);

  const trialsSLAll = useMemo(() => {
    const sessionBinaural = (d) => {
      const response = d?.postResponses?.binaural_beats || '';
      if (response === 'No' || response === 'What are binaural beats?') return 'no';
      if (response.includes('Yes')) return 'yes';
      return 'unknown';
    };

    const baseSessionFilter = mode === 'completers' ? (d) => isCompleter(d) : () => true;
    const passesBinauralFilter = binauralFilter === 'all' ? () => true : (d) => sessionBinaural(d) === binauralFilter;
    const combinedFilter = (d) => baseSessionFilter(d) && passesBinauralFilter(d);

    return rows.filter(combinedFilter).flatMap((d) => d?.spoon_love?.trialResults || []);
  }, [rows, mode, binauralFilter]);

  const trialsCLAll = useMemo(() => {
    const sessionBinaural = (d) => {
      const response = d?.postResponses?.binaural_beats || '';
      if (response === 'No' || response === 'What are binaural beats?') return 'no';
      if (response.includes('Yes')) return 'yes';
      return 'unknown';
    };

    const baseSessionFilter = mode === 'completers' ? (d) => isCompleter(d) : () => true;
    const passesBinauralFilter = binauralFilter === 'all' ? () => true : (d) => sessionBinaural(d) === binauralFilter;
    const combinedFilter = (d) => baseSessionFilter(d) && passesBinauralFilter(d);

    return rows.filter(combinedFilter).flatMap((d) => d?.client_local?.trialResults || []);
  }, [rows, mode, binauralFilter]);

  const qrngGhostBySource = useMemo(() => {
    // Quantum block
    if (!reportQRNG) return [];
    const m = new Map();
    for (const t of rows.flatMap(
      (d) => d?.spoon_love?.trialResults || []
    )) {
      const src = String(t?.rng_source ?? 'unknown');
      const g = Number(t?.ghost_hit) === 1 ? 1 : 0;
      const row = m.get(src) || { source: src, n: 0, k: 0 };
      row.n += 1;
      row.k += g;
      m.set(src, row);
    }
    return Array.from(m.values())
      .map((r) => ({
        source: r.source,
        n: r.n,
        pct: r.n ? (100 * r.k) / r.n : null,
        p: twoSidedP(binomZAgainst(0.2, r.k, r.n)),
      }))
      .sort((a, b) => b.n - a.n);
  }, [rows, reportQRNG]);

  const prngGhostBySource = useMemo(() => {
    // Full Stack block
    if (!reportPRNG) return [];
    const m = new Map();
    for (const t of rows.flatMap(
      (d) => d?.full_stack?.trialResults || []
    )) {
      const src = String(t?.rng_source ?? 'unknown');
      const g = Number(t?.ghost_hit) === 1 ? 1 : 0;

      const row = m.get(src) || { source: src, n: 0, k: 0 };
      row.n += 1;
      row.k += g;
      m.set(src, row);
    }
    return Array.from(m.values())
      .map((r) => ({
        source: r.source,
        n: r.n,
        pct: r.n ? (100 * r.k) / r.n : null,
        p: twoSidedP(binomZAgainst(0.2, r.k, r.n)),
      }))
      .sort((a, b) => b.n - a.n);
  }, [rows, reportPRNG]);

  /* ===== Block-by-block deltas per participant ===== */
  function pctFromTrials(trials) {
    if (!Array.isArray(trials) || !trials.length) return null;
    const hits = trials.reduce(
      (a, t) =>
        a + (Number(t.subject_hit ?? t.matched) === 1 ? 1 : 0),
      0
    );
    return (100 * hits) / trials.length;
  }
  function firstBy(map, key, seed) {
    return map.get(key) ?? (map.set(key, seed), seed);
  }

  const deltasPerParticipant = useMemo(() => {
    // Group sessions by participant_id
    const byPid = new Map();
    for (const d of rows) {
      const pid = d?.participant_id || 'unknown';
      const list = firstBy(byPid, pid, []);
      list.push(d);
    }

    // Pick first session for each participant (policy: first)
    const out = [];
    for (const [pid, sessions] of byPid.entries()) {
      const s0 = sessions[0] || {};
      const fsPct = pctFromTrials(s0?.full_stack?.trialResults);
      const slPct = pctFromTrials(s0?.spoon_love?.trialResults);
      const clPct = pctFromTrials(s0?.client_local?.trialResults);

      const deltaSLvsFS =
        Number.isFinite(slPct) && Number.isFinite(fsPct)
          ? slPct - fsPct
          : null;
      const deltaCLvsFS =
        Number.isFinite(clPct) && Number.isFinite(fsPct)
          ? clPct - fsPct
          : null;

      out.push({
        participant_id: pid,
        fsPct,
        slPct,
        clPct,
        deltaSLvsFS,
        deltaCLvsFS,
      });
    }
    // Sort for readability: largest SL boost first
    out.sort(
      (a, b) =>
        (b.deltaSLvsFS ?? -Infinity) - (a.deltaSLvsFS ?? -Infinity)
    );
    return out;
  }, [rows]);

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
                label="Session-weighted: Demon vs chance (p₀=20%)"
                p={report.tests.rngBiasGhost.p}
              />
              <PBadge
                label="Session-weighted: Subject vs Demon (paired t)"
                p={report.tests.primaryVsGhost.p}
              />
              <PBadge
                label="Session-weighted: Subject vs chance (p₀=20%)"
                p={report.tests.primaryVsChance.p}
              />
            </>
          ) : (
            <>
              <PBadge
                label="RNG bias (demon vs chance, p₀=20%)"
                p={report.tests.rngBiasGhost.p}
              />

              <PBadge
                label="Subject vs Demon"
                p={report.tests.primaryVsGhost.p}
              />
              <PBadge
                label="Subject vs chance (p₀=20%)"
                p={report.tests.primaryVsChance.p}
              />
            </>
          )}
          <PBadge
            label="n10 vs n01 symmetry (Subject↔︎Demon)"
            p={report.tests.symmetryN10vsN01.p}
          />

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
                  RNG
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

  /* ==== Reference For Labels UI (5-choice, no priming) ==== */
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
                RNG bias (demon vs 20%)
              </td>
              <td style={{ padding: '6px 8px' }}>
                Is the demon’s accuracy different from chance (p₀ =
                20%)?
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
                subject-only wins (<code>n10</code>) different from
                demon-only wins (<code>n01</code>)?
              </td>
            </tr>
            <tr>
              <td style={{ padding: '6px 8px' }}>Subject vs 20%</td>
              <td style={{ padding: '6px 8px' }}>
                Is the <strong>subject’s</strong> accuracy different
                from chance (p₀ = 20%)?
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  );

  /* ==== Trial columns cheat-sheet (5-choice, no legacy) ==== */
  const TrialColumnsHelp = () => (
    <details style={{ marginTop: 8 }}>
      <summary>What does each trial field mean?</summary>
      <div style={{ overflowX: 'auto', marginTop: 6 }}>
        <table style={{ borderCollapse: 'collapse', minWidth: 820 }}>
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
            {/* Core correctness flags (5-choice) */}
            <tr>
              <td style={{ padding: '6px 8px' }}>
                <code>subject_hit</code>
              </td>
              <td style={{ padding: '6px 8px' }}>Subject</td>
              <td style={{ padding: '6px 8px' }}>0/1</td>
              <td style={{ padding: '6px 8px' }}>
                1 if the subject’s choice matched the target on this
                trial.
              </td>
            </tr>
            <tr>
              <td style={{ padding: '6px 8px' }}>
                <code>ghost_hit</code>
              </td>
              <td style={{ padding: '6px 8px' }}>Demon</td>
              <td style={{ padding: '6px 8px' }}>0/1</td>
              <td style={{ padding: '6px 8px' }}>
                1 if the demon’s choice matched the target on this
                trial.
              </td>
            </tr>

            {/* Indices (reconstruction / audits) */}
            <tr>
              <td style={{ padding: '6px 8px' }}>
                <code>target_index</code>
              </td>
              <td style={{ padding: '6px 8px' }}>Allocation</td>
              <td style={{ padding: '6px 8px' }}>0–4</td>
              <td style={{ padding: '6px 8px' }}>
                Target’s index within the 5 displayed symbols.
              </td>
            </tr>
            <tr>
              <td style={{ padding: '6px 8px' }}>
                <code>subject_index</code>
              </td>
              <td style={{ padding: '6px 8px' }}>Subject</td>
              <td style={{ padding: '6px 8px' }}>0–4</td>
              <td style={{ padding: '6px 8px' }}>
                Subject’s chosen index within the 5 displayed symbols.
              </td>
            </tr>
            <tr>
              <td style={{ padding: '6px 8px' }}>
                <code>demon_index</code>
              </td>
              <td style={{ padding: '6px 8px' }}>Demon</td>
              <td style={{ padding: '6px 8px' }}>0–4</td>
              <td style={{ padding: '6px 8px' }}>
                Demon’s chosen index within the 5 displayed symbols.
              </td>
            </tr>
            <tr>
              <td style={{ padding: '6px 8px' }}>
                <code>display_order</code>
              </td>
              <td style={{ padding: '6px 8px' }}>UI</td>
              <td style={{ padding: '6px 8px' }}>array[5]</td>
              <td style={{ padding: '6px 8px' }}>
                IDs for the 5 symbols in the order shown (for
                reproducibility/audits).
              </td>
            </tr>

            {/* RNG provenance */}
            <tr>
              <td style={{ padding: '6px 8px' }}>
                <code>subject_raw_byte</code>
              </td>
              <td style={{ padding: '6px 8px' }}>
                RNG (subject stream)
              </td>
              <td style={{ padding: '6px 8px' }}>0–255</td>
              <td style={{ padding: '6px 8px' }}>
                Underlying random byte used for the subject/target
                selection.
              </td>
            </tr>
            <tr>
              <td style={{ padding: '6px 8px' }}>
                <code>demon_raw_byte</code>
              </td>
              <td style={{ padding: '6px 8px' }}>
                RNG (demon stream)
              </td>
              <td style={{ padding: '6px 8px' }}>0–255</td>
              <td style={{ padding: '6px 8px' }}>
                Underlying random byte used for the demon selection.
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
              <td style={{ padding: '6px 8px' }}>
                small int / string
              </td>
              <td style={{ padding: '6px 8px' }}>
                Quality/status code for QRNG fetch (expected “1”/“2”
                when present).
              </td>
            </tr>

            {/* Server rotation proof (for 5-choice mapping) */}
            <tr>
              <td style={{ padding: '6px 8px' }}>
                <code>remap_r</code>
              </td>
              <td style={{ padding: '6px 8px' }}>Server</td>
              <td style={{ padding: '6px 8px' }}>0–4</td>
              <td style={{ padding: '6px 8px' }}>
                Server rotation applied to map raw bytes to the
                on-screen indices.
              </td>
            </tr>
            <tr>
              <td style={{ padding: '6px 8px' }}>
                <code>remap_proof</code>
              </td>
              <td style={{ padding: '6px 8px' }}>Server</td>
              <td style={{ padding: '6px 8px' }}>string</td>
              <td style={{ padding: '6px 8px' }}>
                Proof/HMAC for the rotation (for integrity/audits).
              </td>
            </tr>

            {/* Trial/session bookkeeping */}
            <tr>
              <td style={{ padding: '6px 8px' }}>
                <code>block</code>
              </td>
              <td style={{ padding: '6px 8px' }}>Session</td>
              <td style={{ padding: '6px 8px' }}>string</td>
              <td style={{ padding: '6px 8px' }}>
                Block name (e.g., <code>full_stack-Physical</code>,{' '}
                <code>spoon_love-Quantum</code>,{' '}
                <code>client_local-Local</code>).
              </td>
            </tr>
            <tr>
              <td style={{ padding: '6px 8px' }}>
                <code>trial_index</code>
              </td>
              <td style={{ padding: '6px 8px' }}>Trial</td>
              <td style={{ padding: '6px 8px' }}>0-based int</td>
              <td style={{ padding: '6px 8px' }}>
                Index of the trial within its block.
              </td>
            </tr>
            <tr>
              <td style={{ padding: '6px 8px' }}>
                <code>response_time_ms</code>
              </td>
              <td style={{ padding: '6px 8px' }}>Timing</td>
              <td style={{ padding: '6px 8px' }}>int</td>
              <td style={{ padding: '6px 8px' }}>
                Response time in milliseconds from trial start to button press.
              </td>
            </tr>
            <tr>
              <td style={{ padding: '6px 8px' }}>
                <code>session_id</code>
              </td>
              <td style={{ padding: '6px 8px' }}>Session</td>
              <td style={{ padding: '6px 8px' }}>string</td>
              <td style={{ padding: '6px 8px' }}>
                Opaque session identifier linking trials to a run.
              </td>
            </tr>
            <tr>
              <td style={{ padding: '6px 8px' }}>
                <code>participant_id</code>
              </td>
              <td style={{ padding: '6px 8px' }}>Participant</td>
              <td style={{ padding: '6px 8px' }}>string</td>
              <td style={{ padding: '6px 8px' }}>
                Anonymized participant identifier.
              </td>
            </tr>
            <tr>
              <td style={{ padding: '6px 8px' }}>
                <code>created_at</code>
              </td>
              <td style={{ padding: '6px 8px' }}>Firestore</td>
              <td style={{ padding: '6px 8px' }}>Timestamp</td>
              <td style={{ padding: '6px 8px' }}>
                When this trial row was written (server time).
              </td>
            </tr>
          </tbody>
        </table>

        <p style={{ marginTop: 8, color: '#555' }}>
          Tip: the parent session/run document also stores{' '}
          <code>timestamp</code> (server time),{' '}
          <code>created_at</code>, <code>updated_at</code>, and{' '}
          <code>exit_reason</code> (e.g., <em>complete</em>).
        </p>
      </div>
    </details>
  );

  /* ==== NEW: small pill toggle UI ==== */
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
          { id: 'pooled', label: 'All trials (pooled)' },
          {
            id: 'completers',
            label: `Completers only (≥${MIN_FULL_STACK} baseline, ≥${MIN_SPOON_LOVE} quantum, ≥${MIN_CLIENT_LOCAL} local)`,
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
              background:
                binauralFilter === opt.id ? '#eef6ff' : '#fff',
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
      <details style={{ marginTop: 8 }}>
        <summary>Completer debug (first 20 runs)</summary>
        <table style={{ borderCollapse: 'collapse', marginTop: 6 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '4px 8px' }}>
                Run
              </th>
              <th style={{ textAlign: 'right', padding: '4px 8px' }}>
                FS
              </th>
              <th style={{ textAlign: 'right', padding: '4px 8px' }}>
                SL
              </th>
              <th style={{ textAlign: 'right', padding: '4px 8px' }}>
                CL
              </th>
              <th style={{ textAlign: 'right', padding: '4px 8px' }}>
                Need
              </th>
              <th style={{ textAlign: 'center', padding: '4px 8px' }}>
                Completer
              </th>
            </tr>
          </thead>
          <tbody>
            {completerDebugRows.map((r) => (
              <tr key={r.id}>
                <td style={{ padding: '4px 8px' }}>
                  <code>{r.id.slice(0, 8)}…</code>
                </td>
                <td
                  style={{ padding: '4px 8px', textAlign: 'right' }}
                >
                  {r.fs}
                </td>
                <td
                  style={{ padding: '4px 8px', textAlign: 'right' }}
                >
                  {r.sl}
                </td>
                <td
                  style={{ padding: '4px 8px', textAlign: 'right' }}
                >
                  {r.cl}
                </td>
                <td
                  style={{ padding: '4px 8px', textAlign: 'right' }}
                >
                  {r.min_fs}/{r.min_sl}/{r.min_cl}
                </td>
                <td
                  style={{ padding: '4px 8px', textAlign: 'center' }}
                >
                  {r.completer ? '✅' : '❌'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

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
            <button
              onClick={toggleQA}
              disabled={!canToggle || toggling}
              title={
                !canToggle
                  ? 'Sign in with email+password and be whitelisted to toggle'
                  : ''
              }
            >
              {toggling
                ? 'Working…'
                : qaStatus.enabled
                  ? 'Disable QA'
                  : 'Enable QA'}
            </button>
            {!canToggle && (
              <small style={{ color: '#666' }}>
                Sign in with email+password and ensure your email is
                listed in admin/qa.emails.
              </small>
            )}

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
      <button onClick={runRngSanityTest}>
        Run RNG Sanity Test - check console log for results
      </button>

      {/* ==== NEW: mode toggle & summary ==== */}
      <ModeToggle />
      <ReferenceMatrix />
      <TrialColumnsHelp />
      <SummaryCard />

      <p>
        This page fetches <code>experiment1_responses</code>, lets you
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
            onClick={downloadJSONWithTrialsAndReveal}
            style={{ marginLeft: 8 }}
            title="Includes details/trialDetails AND commit–reveal (hash, salt, base64 tapes)"
          >
            Download sessions_with_trials_and_reveal.json
          </button>
        </p>
      ) : null}



      {/* Main Results Summary at the top */}
      <MainResultsSummary
        reportPRNG={reportPRNG}
        reportQRNG={reportQRNG}
        reportCL={reportCL}
      />

      {/* RNG Validation Summary */}
      <RNGValidationSummary
        reportPRNG={reportPRNG}
        reportQRNG={reportQRNG}
        reportCL={reportCL}
      />

      {/* Metric explanations */}
      <MetricExplanations />

      {/* REORGANIZED DETAILED SECTIONS - Group by RNG type */}

      {/* Physical RNG Section */}
      <div style={{ marginTop: 32 }}>
        <h2 style={{
          fontSize: 24,
          margin: '0 0 16px 0',
          padding: '8px 12px',
          background: '#f3f4f6',
          borderRadius: 6,
          borderLeft: '4px solid #3b82f6'
        }}>
          Physical RNG (Baseline)
        </h2>

        <Section
          title="Statistical Results"
          report={reportPRNG}
          firstTen={firstTenPRNG}
        />

        <PatternsPanel
          trials={trialsFSAll}
          title="Pattern Analysis"
        />

        <BlockSpecificAnalysisPanel
          trials={trialsFSAll}
          title="Physical RNG Block Analysis"
        />
      </div>

      {/* Quantum RNG Section */}
      <div style={{ marginTop: 32 }}>
        <h2 style={{
          fontSize: 24,
          margin: '0 0 16px 0',
          padding: '8px 12px',
          background: '#f3f4f6',
          borderRadius: 6,
          borderLeft: '4px solid #8b5cf6'
        }}>
          Quantum RNG
        </h2>

        <Section
          title="Statistical Results"
          report={reportQRNG}
          firstTen={firstTenQRNG}
        />

        <PatternsPanel
          trials={trialsSLAll}
          title="Pattern Analysis"
        />

        <BlockSpecificAnalysisPanel
          trials={trialsSLAll}
          title="Quantum RNG Block Analysis"
        />

        <button
          onClick={() => {
            const arr = rows.flatMap(
              (d) => d?.spoon_love?.trialResults || []
            );
            alert(
              'Opened console: View QUANTUM trial field names there.'
            );
          }}
          style={{ margin: '6px 0' }}
        >
          Debug Quantum trial fields (console)
        </button>
      </div>

      {/* Local RNG Section */}
      <div style={{ marginTop: 32 }}>
        <h2 style={{
          fontSize: 24,
          margin: '0 0 16px 0',
          padding: '8px 12px',
          background: '#f3f4f6',
          borderRadius: 6,
          borderLeft: '4px solid #10b981'
        }}>
          Local RNG
        </h2>

        <Section
          title="Statistical Results"
          report={reportCL}
          firstTen={firstTenCL}
        />

        <PatternsPanel
          trials={trialsCLAll}
          title="Pattern Analysis"
        />

        <BlockSpecificAnalysisPanel
          trials={trialsCLAll}
          title="Local RNG Block Analysis"
        />

        <button
          onClick={() => {
            const arr = rows.flatMap(
              (d) => d?.client_local?.trialResults || []
            );
            alert(
              'Opened console: View LOCAL trial field names there.'
            );
          }}
          style={{ margin: '6px 0' }}
        >
          Debug Local trial fields (console)
        </button>
      </div>

      {/* Combined Analysis - Move to bottom */}
      <div style={{ marginTop: 32 }}>
        <h2 style={{
          fontSize: 24,
          margin: '0 0 16px 0',
          padding: '8px 12px',
          background: '#f3f4f6',
          borderRadius: 6,
          borderLeft: '4px solid #f59e0b'
        }}>
          All Blocks Combined
        </h2>

        <Section
          title="Pooled Statistical Results"
          report={reportALL}
          firstTen={firstTenALL}
        />

        <CompletePSIAnalysisPanel
          trials={[...trialsFSAll, ...trialsSLAll, ...trialsCLAll]}
          title="Complete Technical Analysis - Pooled Across All Blocks"
        />
      </div>

      {/* Move detailed analysis to collapsible sections at the bottom */}
      <details style={{ marginTop: 24 }}>
        <summary style={{ fontSize: 18, fontWeight: 'bold', cursor: 'pointer' }}>
          Additional Analysis & Diagnostics
        </summary>

        {/* RNG randomness (ghost/demon vs 20%) by RNG source */}
        <details style={{ marginTop: 12 }}>
          <summary>
            Randomness checks — ghost vs chance (p₀=20%) by RNG
          </summary>
          <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
            <div>
              <h4 style={{ margin: '6px 0' }}>Quantum</h4>
              {qrngGhostBySource.length ? (
                <table style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th
                        style={{
                          textAlign: 'left',
                          padding: '4px 8px',
                        }}
                      >
                        RNG source
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
                      <th
                        style={{
                          textAlign: 'right',
                          padding: '4px 8px',
                        }}
                      >
                        p vs 20%
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {qrngGhostBySource.map((r) => (
                      <tr key={`sl_${r.source}`}>
                        <td style={{ padding: '4px 8px' }}>
                          {r.source}
                        </td>
                        <td
                          style={{
                            padding: '4px 8px',
                            textAlign: 'right',
                          }}
                        >
                          {r.pct != null ? r.pct.toFixed(2) : '—'}%
                        </td>
                        <td
                          style={{
                            padding: '4px 8px',
                            textAlign: 'right',
                          }}
                        >
                          {r.n}
                        </td>
                        <td
                          style={{
                            padding: '4px 8px',
                            textAlign: 'right',
                          }}
                        >
                          {Number.isFinite(r.p)
                            ? r.p.toExponential(2)
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p style={{ color: '#666' }}>No QRNG trials found.</p>
              )}
            </div>

            <div>
              <h4 style={{ margin: '6px 0' }}>Physical — Full Stack</h4>
              {prngGhostBySource.length ? (
                <table style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th
                        style={{
                          textAlign: 'left',
                          padding: '4px 8px',
                        }}
                      >
                        RNG source
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
                      <th
                        style={{
                          textAlign: 'right',
                          padding: '4px 8px',
                        }}
                      >
                        p vs 20%
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {prngGhostBySource.map((r) => (
                      <tr key={`fs_${r.source}`}>
                        <td style={{ padding: '4px 8px' }}>
                          {r.source}
                        </td>
                        <td
                          style={{
                            padding: '4px 8px',
                            textAlign: 'right',
                          }}
                        >
                          {r.pct != null ? r.pct.toFixed(2) : '—'}%
                        </td>
                        <td
                          style={{
                            padding: '4px 8px',
                            textAlign: 'right',
                          }}
                        >
                          {r.n}
                        </td>
                        <td
                          style={{
                            padding: '4px 8px',
                            textAlign: 'right',
                          }}
                        >
                          {Number.isFinite(r.p)
                            ? r.p.toExponential(2)
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p style={{ color: '#666' }}>
                  No Full Stack trials found.
                </p>
              )}
            </div>
          </div>
        </details>

        {/* Removed histograms - they don't provide useful info */}

        {/* Block-by-block deltas per participant */}
        <details style={{ marginTop: 12 }}>
          <summary>Block-by-block deltas per participant</summary>
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table
              style={{
                borderCollapse: 'collapse',
                minWidth: 720,
                width: '100%',
              }}
            >
              <thead>
                <tr style={{ background: '#fafafa' }}>
                  <th
                    style={{
                      textAlign: 'left',
                      padding: '6px 8px',
                      borderBottom: '1px solid #eee',
                    }}
                  >
                    Participant
                  </th>
                  <th
                    style={{
                      textAlign: 'right',
                      padding: '6px 8px',
                      borderBottom: '1px solid #eee',
                    }}
                  >
                    Physical %
                  </th>
                  <th
                    style={{
                      textAlign: 'right',
                      padding: '6px 8px',
                      borderBottom: '1px solid #eee',
                    }}
                  >
                    Quantum %
                  </th>
                  <th
                    style={{
                      textAlign: 'right',
                      padding: '6px 8px',
                      borderBottom: '1px solid #eee',
                    }}
                  >
                    Local %
                  </th>
                  <th
                    style={{
                      textAlign: 'right',
                      padding: '6px 8px',
                      borderBottom: '1px solid #eee',
                    }}
                  >
                    Δ SL − FS (pp)
                  </th>
                  <th
                    style={{
                      textAlign: 'right',
                      padding: '6px 8px',
                      borderBottom: '1px solid #eee',
                    }}
                  >
                    Δ CL − FS (pp)
                  </th>
                </tr>
              </thead>
              <tbody>
                {deltasPerParticipant.map((r) => (
                  <tr key={r.participant_id}>
                    <td
                      style={{
                        padding: '6px 8px',
                        borderBottom: '1px solid #f5f5f5',
                      }}
                    >
                      <code>{r.participant_id}</code>
                    </td>
                    <td
                      style={{
                        padding: '6px 8px',
                        borderBottom: '1px solid #f5f5f5',
                        textAlign: 'right',
                      }}
                    >
                      {Number.isFinite(r.fsPct)
                        ? r.fsPct.toFixed(1)
                        : '—'}
                      %
                    </td>
                    <td
                      style={{
                        padding: '6px 8px',
                        borderBottom: '1px solid #f5f5f5',
                        textAlign: 'right',
                      }}
                    >
                      {Number.isFinite(r.slPct)
                        ? r.slPct.toFixed(1)
                        : '—'}
                      %
                    </td>
                    <td
                      style={{
                        padding: '6px 8px',
                        borderBottom: '1px solid #f5f5f5',
                        textAlign: 'right',
                      }}
                    >
                      {Number.isFinite(r.clPct)
                        ? r.clPct.toFixed(1)
                        : '—'}
                      %
                    </td>
                    <td
                      style={{
                        padding: '6px 8px',
                        borderBottom: '1px solid #f5f5f5',
                        textAlign: 'right',
                      }}
                    >
                      {Number.isFinite(r.deltaSLvsFS)
                        ? r.deltaSLvsFS.toFixed(1)
                        : '—'}
                    </td>
                    <td
                      style={{
                        padding: '6px 8px',
                        borderBottom: '1px solid #f5f5f5',
                        textAlign: 'right',
                      }}
                    >
                      {Number.isFinite(r.deltaCLvsFS)
                        ? r.deltaCLvsFS.toFixed(1)
                        : '—'}
                    </td>
                  </tr>
                ))}
                {deltasPerParticipant.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      style={{ padding: 8, color: '#666' }}
                    >
                      No participants found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </details>
      </details>
    </div>
  );
}