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
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import jStat from 'jstat';
import { twoSidedP } from './stats';

// Statistical helper functions
function sampleVariance(arr) {
  const n = arr.length;
  if (n < 2) return 0;
  const mean = arr.reduce((s, v) => s + v, 0) / n;
  return arr.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (n - 1);
}

// Shannon entropy calculation (from MainApp.jsx)
function shannonEntropy(bits) {
  if (!bits.length) return 0;
  const ones = bits.reduce((sum, bit) => sum + bit, 0);
  const p = ones / bits.length;
  if (p === 0 || p === 1) return 0;
  return -p * Math.log2(p) - (1 - p) * Math.log2(1 - p);
}


// Analysis helper functions
function computeStatistics(sessions, mode = 'pooled', binauralFilter = 'all', primeFilter = 'all', mappingFilter = 'all') {
  if (!sessions.length) return null;

  let totalHits = 0;
  let totalTrials = 0;
  let totalGhostHits = 0;
  let sessionStats = [];

  // Collect ALL bits across ALL sessions for proper entropy calculation
  let allSubjectBits = [];
  let allGhostBits = [];

  sessions.forEach(session => {
    let sessionHits = 0;
    let sessionTrials = 0;
    let sessionGhostHits = 0;
    let sessionSubjectBits = [];
    let sessionGhostBits = [];

    // Use aggregates if available and no minute data loaded
    if (session.aggregates && (!session.minutes || session.minutes.length === 0)) {
      sessionHits = session.aggregates.totalHits || 0;
      sessionTrials = session.aggregates.totalTrials || 0;
      sessionGhostHits = session.aggregates.totalGhostHits || 0;
    } else {
      // Use detailed minute data (original behavior)
      (session.minutes || []).forEach(minute => {
      // Filter by mapping type at the block level
      if (mappingFilter === 'ring' && minute.mapping_type !== 'low_entropy') return;
      if (mappingFilter === 'mosaic' && minute.mapping_type !== 'high_entropy') return;

      sessionHits += minute.hits || 0;
      sessionTrials += minute.n || 0;
      sessionGhostHits += minute.demon_hits || 0;

      // Debug: Check what data is actually available
      if (sessions.length === 1 && sessionStats.length === 0) { // Only log once
        console.log('🔍 MINUTE DATA STRUCTURE:', {
          hasFields: {
            subjectBitSequence: !!minute.subjectBitSequence,
            ghostBitSequence: !!minute.ghostBitSequence,
            hits: !!minute.hits,
            n: !!minute.n,
            target: !!minute.target
          },
          sampleMinute: minute
        });
      }

      // Collect raw bit sequences for entropy calculation
      const subjectBits = minute.trial_data?.subject_bits;
      const demonBits = minute.trial_data?.demon_bits;

      if (subjectBits && Array.isArray(subjectBits)) {
        sessionSubjectBits.push(...subjectBits);
        allSubjectBits.push(...subjectBits);
      }

      if (demonBits && Array.isArray(demonBits)) {
        sessionGhostBits.push(...demonBits);
        allGhostBits.push(...demonBits);
      }
      });
    }

    const hitRate = sessionTrials > 0 ? sessionHits / sessionTrials : 0;
    const ghostHitRate = sessionTrials > 0 ? sessionGhostHits / sessionTrials : 0;

    // Calculate session-level entropy from raw bits
    const sessionSubjectEntropy = sessionSubjectBits.length > 0 ? shannonEntropy(sessionSubjectBits) : 0;
    const sessionGhostEntropy = sessionGhostBits.length > 0 ? shannonEntropy(sessionGhostBits) : 0;
    const sessionAvgEntropy = (sessionSubjectEntropy + sessionGhostEntropy) / 2;

    sessionStats.push({
      id: session.id,
      participant_id: session.participant_id,
      hits: sessionHits,
      trials: sessionTrials,
      ghostHits: sessionGhostHits,
      hitRate,
      ghostHitRate,
      entropyWindows: sessionSubjectBits.length > 0 ? 1 : 0, // Binary: has entropy data or not
      avgEntropy: sessionAvgEntropy,
      primeCond: session.prime_condition || 'unknown',
      binauralBeats: session.post_survey?.binaural_beats || 'No',
      completed: session.completed || false,
      createdAt: session.createdAt
    });

    totalHits += sessionHits;
    totalTrials += sessionTrials;
    totalGhostHits += sessionGhostHits;
  });

  // Calculate proper Shannon entropy from collected raw bit sequences
  // Calculate average block-level entropy for SUBJECT ONLY
  let totalSubjectEntropy = 0;
  let subjectEntropyCount = 0;

  sessions.forEach(session => {
    (session.minutes || []).forEach(minute => {
      const blockEntropySubj = minute.entropy?.block_entropy_subj;

      if (blockEntropySubj !== undefined) {
        totalSubjectEntropy += blockEntropySubj;
        subjectEntropyCount += 1;
      }
    });
  });

  const avgEntropy = subjectEntropyCount > 0 ? totalSubjectEntropy / subjectEntropyCount : 0;

  // Debug entropy calculation
  if (subjectEntropyCount > 0) {
    console.log('🔍 ENTROPY DEBUG:', {
      subjectBlocks: subjectEntropyCount,
      avgSubjectEntropy: avgEntropy.toFixed(4),
      note: 'Subject entropy only (focus condition)'
    });
  }

  const avgHitRate = totalTrials > 0 ? totalHits / totalTrials : 0;
  const avgGhostHitRate = totalTrials > 0 ? totalGhostHits / totalTrials : 0;

  // Count total entropy blocks across all sessions (each block = 150 bits)
  let totalEntropyWindows = 0;
  sessions.forEach(session => {
    (session.minutes || []).forEach(minute => {
      if (minute.entropy?.block_entropy_subj !== undefined) {
        totalEntropyWindows += 1; // Each 150-bit block = 1 entropy measurement
      }
    });
  });

  // Debug entropy calculation
  console.log('🔍 ENTROPY CALCULATION:', {
    sessionsAnalyzed: sessions.length,
    subjectBits: allSubjectBits.length,
    ghostBits: allGhostBits.length,
    avgEntropy,
    note: 'Using proper Shannon entropy from raw bit sequences'
  });

  // Session-level z-test for hit rate vs 50% (proper clustering analysis with weighted means)
  const validSessions = sessionStats.filter(s => !isNaN(s.hitRate) && s.trials > 0);
  const n = validSessions.length;

  let z = 0;
  let p = 1;

  if (n > 1) {
    // Weighted mean by number of trials per session (accounts for early dropouts)
    const totalTrials = validSessions.reduce((sum, s) => sum + s.trials, 0);
    const meanHitRate = validSessions.reduce((sum, s) => sum + s.hitRate * s.trials, 0) / totalTrials;

    // Unweighted variance for session-level clustering (conservative approach)
    const sessionHitRates = validSessions.map(s => s.hitRate);
    const sessionVariance = sessionHitRates.reduce((sum, rate) =>
      sum + Math.pow(rate - meanHitRate, 2), 0) / (n - 1);
    const standardError = Math.sqrt(sessionVariance / n);

    z = standardError > 0 ? (meanHitRate - 0.5) / standardError : 0;
    p = twoTailedTPvalue(z, n - 1);

    console.log('🔍 SESSION-LEVEL ANALYSIS:', {
      sessions: n,
      totalTrials: totalTrials,
      meanHitRate: meanHitRate.toFixed(4),
      sessionVariance: sessionVariance.toFixed(6),
      standardError: standardError.toFixed(6),
      zScore: z.toFixed(4),
      pValue: p.toFixed(6),
      note: 'Using weighted mean (by trials) with session-level clustering variance'
    });
  }

  return {
    totalSessions: sessions.length,
    totalTrials,
    totalHits,
    totalGhostHits,
    avgHitRate,
    avgGhostHitRate,
    avgEntropy,
    totalEntropyWindows,
    totalBitSequences: allSubjectBits.length > 0 ? sessions.length : 0,
    z,
    p,
    sessionLevelAnalysis: {
      sessions: n,
      sessionHitRates: validSessions.map(s => s.hitRate),
      meanSessionHitRate: n > 0 ? validSessions.reduce((sum, s) => sum + s.hitRate * s.trials, 0) / validSessions.reduce((sum, s) => sum + s.trials, 0) : 0,
      sessionLevelZ: z,
      sessionLevelP: p,
      note: 'Accounts for clustering within sessions with weighted means'
    },
    sessionStats,
    deltaPct: (avgHitRate - avgGhostHitRate) * 100
  };
}

// Simple normal CDF approximation
function normalCdf(x) {
  return 0.5 * (1 + erf(x / Math.sqrt(2)));
}

// Statistical test helper functions using jStat
function twoTailedTPvalue(t, df) {
  // Two-tailed p-value for Student's t distribution
  return 2 * (1 - jStat.studentt.cdf(Math.abs(t), df));
}

function chiSquarePvalue(chiSq, df) {
  // Upper tail probability for chi-square distribution
  return 1 - jStat.chisquare.cdf(chiSq, df);
}

// Temporal entropy analysis for consciousness research
function analyzeTemporalEntropy(sessions) {
  const k2_data = []; // Paired data for 2-window analysis
  const k3_data = []; // Data for 3-window repeated measures

  sessions.forEach(session => {
    const temporal = session.entropy?.temporal;
    if (!temporal || !temporal.entropy_k2 || !temporal.entropy_k3 || !temporal.ghost_entropy_k2 || !temporal.ghost_entropy_k3) return;

    const k2 = temporal.entropy_k2;
    const k3 = temporal.entropy_k3;
    const k2_ghost = temporal.ghost_entropy_k2;
    const k3_ghost = temporal.ghost_entropy_k3;

    // K=2 analysis: paired test on first vs second half
    if (k2.length === 2 && k2[0] !== null && k2[1] !== null && k2_ghost.length === 2 && k2_ghost[0] !== null && k2_ghost[1] !== null) {
      k2_data.push({
        sessionId: session.id,
        first_half: k2[0],
        second_half: k2[1],
        difference: k2[1] - k2[0], // Second - First
        ghost_first_half: k2_ghost[0],
        ghost_second_half: k2_ghost[1],
        ghost_difference: k2_ghost[1] - k2_ghost[0],
        participant: session.participant_id,
        prime_condition: session.prime_condition,
        bits_count: temporal.subj_bits_count
      });
    }

    // K=3 analysis: early, middle, late (including ghost data)
    if (k3.length === 3 && k3.every(v => v !== null) && k3_ghost.length === 3 && k3_ghost.every(v => v !== null)) {
      k3_data.push({
        sessionId: session.id,
        early: k3[0],
        middle: k3[1],
        late: k3[2],
        ghost_early: k3_ghost[0],
        ghost_middle: k3_ghost[1],
        ghost_late: k3_ghost[2],
        participant: session.participant_id,
        prime_condition: session.prime_condition,
        bits_count: temporal.subj_bits_count
      });
    }
  });

  // K=2 Analysis: Paired t-test on entropy differences
  let k2_analysis = null;
  if (k2_data.length > 0) {
    const differences = k2_data.map(d => d.difference);
    const n = differences.length;
    const meanDiff = differences.reduce((a, b) => a + b, 0) / n;
    const varDiff = differences.reduce((sum, d) => sum + Math.pow(d - meanDiff, 2), 0) / (n - 1);
    const seDiff = Math.sqrt(varDiff / n);
    const tStat = meanDiff / seDiff;
    const df = n - 1;
    const pValue = twoTailedTPvalue(tStat, df); // Two-tailed t-test

    // Bootstrap confidence interval for paired difference
    const bootstrapMeans = [];
    const numBootstrap = 1000;
    for (let i = 0; i < numBootstrap; i++) {
      const sample = [];
      for (let j = 0; j < n; j++) {
        const idx = Math.floor(Math.random() * n);
        sample.push(differences[idx]);
      }
      bootstrapMeans.push(sample.reduce((a, b) => a + b, 0) / n);
    }
    bootstrapMeans.sort((a, b) => a - b);
    const ci_lower = bootstrapMeans[Math.floor(0.025 * numBootstrap)];
    const ci_upper = bootstrapMeans[Math.floor(0.975 * numBootstrap)];

    // Permutation test for robustness check
    const numPermutations = 10000;
    let extremeCount = 0;
    const absMeanDiff = Math.abs(meanDiff);

    for (let i = 0; i < numPermutations; i++) {
      // Randomly flip signs of differences
      let permutedSum = 0;
      for (let j = 0; j < n; j++) {
        permutedSum += Math.random() < 0.5 ? differences[j] : -differences[j];
      }
      const permutedMean = permutedSum / n;
      if (Math.abs(permutedMean) >= absMeanDiff) {
        extremeCount++;
      }
    }
    const permutationPValue = extremeCount / numPermutations;

    k2_analysis = {
      n,
      meanDifference: meanDiff,
      stdError: seDiff,
      tStatistic: tStat,
      degreesOfFreedom: df,
      pValue,
      permutationPValue,
      significant: pValue < 0.05,
      ci95_lower: ci_lower,
      ci95_upper: ci_upper,
      interpretation: meanDiff > 0 ? 'Entropy increases over time' : 'Entropy decreases over time'
    };
  }

  // K=3 Analysis: Linear trend test
  let k3_analysis = null;
  if (k3_data.length > 0) {
    const n = k3_data.length;

    // Calculate means for each time point
    const earlyMean = k3_data.reduce((sum, d) => sum + d.early, 0) / n;
    const middleMean = k3_data.reduce((sum, d) => sum + d.middle, 0) / n;
    const lateMean = k3_data.reduce((sum, d) => sum + d.late, 0) / n;

    // Linear trend test using contrast weights [-1, 0, 1]
    const trendScores = k3_data.map(d => -1 * d.early + 0 * d.middle + 1 * d.late);
    const meanTrend = trendScores.reduce((a, b) => a + b, 0) / n;
    const varTrend = trendScores.reduce((sum, t) => sum + Math.pow(t - meanTrend, 2), 0) / (n - 1);
    const seTrend = Math.sqrt(varTrend / n);
    const tTrend = meanTrend / seTrend;
    const dfTrend = n - 1;
    const pTrend = twoTailedTPvalue(tTrend, dfTrend);

    // Pairwise contrasts with Bonferroni correction
    const contrasts = {
      early_vs_late: {
        difference: lateMean - earlyMean,
        pairs: k3_data.map(d => d.late - d.early)
      },
      early_vs_middle: {
        difference: middleMean - earlyMean,
        pairs: k3_data.map(d => d.middle - d.early)
      },
      middle_vs_late: {
        difference: lateMean - middleMean,
        pairs: k3_data.map(d => d.late - d.middle)
      }
    };

    // Calculate t-tests for each contrast
    const contrastKeys = Object.keys(contrasts);
    contrastKeys.forEach(key => {
      const pairs = contrasts[key].pairs;
      const meanPair = pairs.reduce((a, b) => a + b, 0) / n;
      const varPair = pairs.reduce((sum, p) => sum + Math.pow(p - meanPair, 2), 0) / (n - 1);
      const sePair = Math.sqrt(varPair / n);
      const tPair = meanPair / sePair;
      const pPair = twoTailedTPvalue(tPair, n - 1);

      contrasts[key].tStatistic = tPair;
      contrasts[key].pValue = pPair;
    });

    // Apply multiple comparison corrections
    const pValues = contrastKeys.map(key => contrasts[key].pValue);

    // Bonferroni correction (conservative)
    contrastKeys.forEach(key => {
      contrasts[key].pBonferroni = Math.min(1, contrasts[key].pValue * 3);
      contrasts[key].significantBonferroni = contrasts[key].pBonferroni < 0.05;
    });

    // FDR correction using Benjamini-Hochberg procedure (less conservative)
    const sortedIndices = pValues
      .map((p, i) => ({ p, i, key: contrastKeys[i] }))
      .sort((a, b) => a.p - b.p);

    let fdrThreshold = 0.05;
    sortedIndices.forEach((item, rank) => {
      const bh_threshold = ((rank + 1) / sortedIndices.length) * fdrThreshold;
      contrasts[item.key].pFDR = item.p; // Store original p-value
      contrasts[item.key].fdrRank = rank + 1;
      contrasts[item.key].fdrThreshold = bh_threshold;
      contrasts[item.key].significantFDR = item.p <= bh_threshold;
    });

    // NEW: Differential slope analysis (subject vs ghost)
    const subjectTrends = k3_data.map(d => {
      // Linear contrast [-1, 0, 1] for subject
      return -1 * d.early + 0 * d.middle + 1 * d.late;
    });

    const ghostTrends = k3_data.map(d => {
      // Linear contrast [-1, 0, 1] for ghost
      return -1 * d.ghost_early + 0 * d.ghost_middle + 1 * d.ghost_late;
    });

    // Paired t-test on the difference in slopes
    const trendDifferences = subjectTrends.map((st, i) => st - ghostTrends[i]);
    const meanDiff = trendDifferences.reduce((a, b) => a + b, 0) / n;
    const varDiff = trendDifferences.reduce((sum, d) => sum + Math.pow(d - meanDiff, 2), 0) / (n - 1);
    const seDiff = Math.sqrt(varDiff / n);
    const tDiff = meanDiff / seDiff;
    const pDiff = twoTailedTPvalue(tDiff, n - 1);

    const differentialSlope = {
      subjectMeanTrend: subjectTrends.reduce((a, b) => a + b, 0) / n,
      ghostMeanTrend: ghostTrends.reduce((a, b) => a + b, 0) / n,
      difference: meanDiff,
      tStatistic: tDiff,
      degreesOfFreedom: n - 1,
      pValue: pDiff,
      significant: pDiff < 0.05,
      interpretation: meanDiff > 0
        ? 'Subject entropy increases faster than ghost (differential thermalization)'
        : 'Ghost entropy increases faster than subject (unexpected pattern)'
    };

    k3_analysis = {
      n,
      means: { early: earlyMean, middle: middleMean, late: lateMean },
      linearTrend: {
        tStatistic: tTrend,
        degreesOfFreedom: dfTrend,
        pValue: pTrend,
        significant: pTrend < 0.05,
        interpretation: meanTrend > 0 ? 'Entropy increases linearly over time' : 'Entropy decreases linearly over time'
      },
      pairwiseContrasts: contrasts,
      differentialSlope: differentialSlope
    };
  }

  return {
    k2_available: k2_data.length,
    k3_available: k3_data.length,
    k2_pairedTest: k2_analysis,
    k3_temporalProgression: k3_analysis,
    rawData: { k2_data, k3_data }
  };
}

// PRIMARY ANALYSIS: Session-level comparisons with Holm-Bonferroni correction
// Pre-registered hypothesis: Human > AI > Baseline (chance)
// This is the ONLY analysis used for confirmatory inference
function computePrimaryAnalysis(sessions) {
  // Group sessions by type
  const humanSessions = sessions.filter(s => s.session_type === 'human' || (!s.session_type && s.mode === 'human'));
  const aiSessions = sessions.filter(s => s.session_type === 'ai_agent' || s.mode === 'ai');
  const baselineSessions = sessions.filter(s => s.session_type === 'baseline' || s.mode === 'baseline');

  // Calculate session-level hit rates (aggregate all blocks within each session)
  const getSessionHitRates = (sessionList) => {
    return sessionList.map(session => {
      const minutes = session.minutes || [];
      const totalHits = minutes.reduce((sum, m) => sum + (m.hits || 0), 0);
      const totalTrials = minutes.reduce((sum, m) => sum + (m.n || 0), 0);
      return totalTrials > 0 ? totalHits / totalTrials : null;
    }).filter(rate => rate !== null);
  };

  const humanRates = getSessionHitRates(humanSessions);
  const aiRates = getSessionHitRates(aiSessions);
  const baselineRates = getSessionHitRates(baselineSessions);

  // Calculate descriptive statistics
  const calcStats = (rates) => {
    if (rates.length === 0) return null;
    const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
    const variance = rates.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (rates.length - 1);
    const sd = Math.sqrt(variance);
    const se = sd / Math.sqrt(rates.length);
    return { n: rates.length, mean, sd, se, rates };
  };

  const humanStats = calcStats(humanRates);
  const aiStats = calcStats(aiRates);
  const baselineStats = calcStats(baselineRates);

  // Welch's t-test (unequal variances)
  const welchTTest = (stats1, stats2) => {
    if (!stats1 || !stats2) return null;
    const { mean: m1, sd: sd1, n: n1 } = stats1;
    const { mean: m2, sd: sd2, n: n2 } = stats2;

    const se1 = sd1 / Math.sqrt(n1);
    const se2 = sd2 / Math.sqrt(n2);
    const seDiff = Math.sqrt(se1 * se1 + se2 * se2);
    const t = (m1 - m2) / seDiff;

    // Welch-Satterthwaite degrees of freedom
    const df = Math.pow(se1 * se1 + se2 * se2, 2) /
               (Math.pow(se1, 4) / (n1 - 1) + Math.pow(se2, 4) / (n2 - 1));

    const pValue = twoTailedTPvalue(t, Math.floor(df));

    // Cohen's d effect size (using pooled SD for interpretation)
    const pooledSD = Math.sqrt(((n1 - 1) * sd1 * sd1 + (n2 - 1) * sd2 * sd2) / (n1 + n2 - 2));
    const cohensD = (m1 - m2) / pooledSD;

    return {
      difference: m1 - m2,
      differencePercent: (m1 - m2) * 100,
      t,
      df: Math.floor(df),
      pValue,
      cohensD,
      effectInterpretation: Math.abs(cohensD) < 0.2 ? 'negligible' :
                           Math.abs(cohensD) < 0.5 ? 'small' :
                           Math.abs(cohensD) < 0.8 ? 'medium' : 'large'
    };
  };

  // Run pairwise comparisons
  const comparisons = [
    { name: 'Human vs AI', label: 'Human−AI', stats1: humanStats, stats2: aiStats },
    { name: 'Human vs Baseline', label: 'Human−Baseline', stats1: humanStats, stats2: baselineStats },
    { name: 'AI vs Baseline', label: 'AI−Baseline', stats1: aiStats, stats2: baselineStats }
  ];

  const results = comparisons.map(comp => ({
    ...comp,
    result: welchTTest(comp.stats1, comp.stats2)
  })).filter(c => c.result !== null);

  // Apply Holm-Bonferroni correction (sequential rejection)
  // Sort p-values from smallest to largest
  const sortedResults = [...results].sort((a, b) => a.result.pValue - b.result.pValue);

  sortedResults.forEach((item, index) => {
    const k = results.length; // number of comparisons
    const rank = index + 1; // rank (1 = smallest p-value)
    const alpha = 0.05;
    const adjustedAlpha = alpha / (k - rank + 1); // Holm correction
    const pHolm = item.result.pValue * (k - rank + 1); // Adjusted p-value
    const pHolmCapped = Math.min(1, pHolm); // Cap at 1.0

    item.result.rank = rank;
    item.result.adjustedAlpha = adjustedAlpha;
    item.result.pHolm = pHolmCapped;
    item.result.significantHolm = item.result.pValue < adjustedAlpha;
  });

  // Power analysis: minimum detectable effect size given sample sizes
  const minDetectableEffect = (n1, n2, alpha = 0.05, power = 0.8) => {
    if (!n1 || !n2 || n1 < 2 || n2 < 2) return null;
    // Simplified calculation: for 80% power and α=0.05, MDE ≈ 2.8 / sqrt(n_harmonic)
    const nHarmonic = 2 / (1/n1 + 1/n2);
    return 2.8 / Math.sqrt(nHarmonic);
  };

  return {
    human: humanStats,
    ai: aiStats,
    baseline: baselineStats,
    comparisons: results,
    powerAnalysis: {
      humanVsAI: humanStats && aiStats ? minDetectableEffect(humanStats.n, aiStats.n) : null,
      humanVsBaseline: humanStats && baselineStats ? minDetectableEffect(humanStats.n, baselineStats.n) : null,
      aiVsBaseline: aiStats && baselineStats ? minDetectableEffect(aiStats.n, baselineStats.n) : null
    },
    interpretation: {
      hypothesis: 'Pre-registered: Human > AI > Baseline (chance)',
      correction: 'Holm-Bonferroni sequential rejection (controls family-wise error rate)',
      note: 'Only these session-level comparisons are used for confirmatory inference. All per-block p-values are exploratory.'
    }
  };
}

// T-distribution critical value lookup for alpha = 0.05
function tCritical(df, twoTailed = true) {
  // More accurate critical values for two-tailed tests (α = 0.05)
  const twoTailedValues = {
    1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571,
    6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
    11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145, 15: 2.131,
    16: 2.120, 17: 2.110, 18: 2.101, 19: 2.093, 20: 2.086,
    21: 2.080, 22: 2.074, 23: 2.069, 24: 2.064, 25: 2.060,
    26: 2.056, 27: 2.052, 28: 2.048, 29: 2.045, 30: 2.042
  };

  // One-tailed critical values for α = 0.05
  const oneTailedValues = {
    1: 6.314, 2: 2.920, 3: 2.353, 4: 2.132, 5: 2.015,
    6: 1.943, 7: 1.895, 8: 1.860, 9: 1.833, 10: 1.812,
    11: 1.796, 12: 1.782, 13: 1.771, 14: 1.761, 15: 1.753,
    16: 1.746, 17: 1.740, 18: 1.734, 19: 1.729, 20: 1.725,
    21: 1.721, 22: 1.717, 23: 1.714, 24: 1.711, 25: 1.708,
    26: 1.706, 27: 1.703, 28: 1.701, 29: 1.699, 30: 1.697
  };

  const values = twoTailed ? twoTailedValues : oneTailedValues;

  // Use exact value if available
  if (values[df]) return values[df];

  // For df > 30, use normal approximation
  if (df > 30) return twoTailed ? 1.96 : 1.645;

  // For intermediate values, use closest available
  const availableDf = Object.keys(values).map(Number).sort((a, b) => a - b);
  const closest = availableDf.reduce((prev, curr) =>
    Math.abs(curr - df) < Math.abs(prev - df) ? curr : prev
  );

  return values[closest];
}

function erf(x) {
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;
  const sign = x >= 0 ? 1 : -1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return sign * y;
}

// Advanced Analytics Functions
function computeAutocorrelation(series, lag) {
  if (series.length <= lag) return 0;

  const n = series.length;

  // Standard textbook formula: use mean of entire series
  const mean = series.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denominator = 0;

  // Calculate autocovariance at lag k
  for (let i = 0; i < n - lag; i++) {
    numerator += (series[i] - mean) * (series[i + lag] - mean);
  }

  // Calculate variance (lag 0 autocovariance)
  for (let i = 0; i < n; i++) {
    denominator += Math.pow(series[i] - mean, 2);
  }

  // Standard autocorrelation: r(k) = γ(k) / γ(0)
  return denominator === 0 ? 0 : numerator / denominator;
}


function computeRunsTest(series, threshold = 0.5) {
  if (series.length === 0) return { numRuns: 0, expected: 0, z: 0, p: 1 };

  // Standard Wald-Wolfowitz runs test
  // Convert to binary sequence based on threshold
  const binary = series.map(x => x >= threshold);

  // Count runs (consecutive sequences of same value)
  const runs = [];
  let currentRun = { value: binary[0], length: 1 };

  for (let i = 1; i < binary.length; i++) {
    if (binary[i] === currentRun.value) {
      currentRun.length++;
    } else {
      runs.push(currentRun);
      currentRun = { value: binary[i], length: 1 };
    }
  }
  runs.push(currentRun);

  const numRuns = runs.length;
  const n1 = binary.filter(x => x).length;  // count of true values
  const n2 = binary.length - n1;            // count of false values
  const n = n1 + n2;                        // total observations

  if (n1 === 0 || n2 === 0) return { numRuns, expected: 0, z: 0, p: 1 };

  // Standard formulas for runs test
  const expectedRuns = (2 * n1 * n2) / n + 1;
  const variance = (2 * n1 * n2 * (2 * n1 * n2 - n)) / (n * n * (n - 1));

  const z = variance > 0 ? (numRuns - expectedRuns) / Math.sqrt(variance) : 0;
  const p = 2 * (1 - normalCdf(Math.abs(z)));  // two-tailed test

  return { numRuns, expected: expectedRuns, z, p, runs };
}

// Trial-level temporal analysis functions
function computeTrialAutocorrelation(sessions, lag = 1) {
  const correlations = [];

  sessions.forEach(session => {
    // Combine all trial sequences from all blocks in this session
    const subjectSequence = [];
    const ghostSequence = [];

    session.minutes?.forEach(minute => {
      if (minute.subjectSequence && minute.subjectSequence.length > 0) {
        subjectSequence.push(...minute.subjectSequence);
        ghostSequence.push(...minute.ghostSequence);
      }
    });

    if (subjectSequence.length > lag) {
      const subjectCorr = computeAutocorrelation(subjectSequence, lag);
      const ghostCorr = computeAutocorrelation(ghostSequence, lag);

      if (isFinite(subjectCorr)) correlations.push({ type: 'subject', value: subjectCorr, sessionId: session.id });
      if (isFinite(ghostCorr)) correlations.push({ type: 'ghost', value: ghostCorr, sessionId: session.id });
    }
  });

  return correlations;
}

function computeTrialCrossCorrelation(sessions, lag = 0) {
  const crossCorrelations = [];

  sessions.forEach(session => {
    const subjectSequence = [];
    const ghostSequence = [];

    session.minutes?.forEach(minute => {
      if (minute.subjectSequence && minute.subjectSequence.length > 0) {
        subjectSequence.push(...minute.subjectSequence);
        ghostSequence.push(...minute.ghostSequence);
      }
    });

    if (subjectSequence.length > lag && ghostSequence.length > lag) {
      const crossCorr = computeCrossCorrelation(subjectSequence, ghostSequence, lag);
      if (isFinite(crossCorr)) {
        crossCorrelations.push({
          value: crossCorr,
          sessionId: session.id,
          trials: subjectSequence.length
        });
      }
    }
  });

  return crossCorrelations;
}

function computeCrossCorrelation(x, y, lag = 0) {
  if (x.length !== y.length || x.length === 0) return 0;

  const n = x.length;
  const eff = n - Math.abs(lag);
  if (eff <= 0) return 0;

  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;

  let num = 0, varX = 0, varY = 0;

  // Compute numerator and variances over the same effective points
  if (lag >= 0) {
    // Positive lag: y leads x
    for (let i = 0; i < eff; i++) {
      const xi = x[i] - meanX;
      const yi = y[i + lag] - meanY;
      num += xi * yi;
      varX += xi * xi;
      varY += yi * yi;
    }
  } else {
    // Negative lag: x leads y
    for (let i = 0; i < eff; i++) {
      const xi = x[i - lag] - meanX; // i - lag is i + abs(lag)
      const yi = y[i] - meanY;
      num += xi * yi;
      varX += xi * xi;
      varY += yi * yi;
    }
  }

  const denom = Math.sqrt(varX * varY);
  return denom > 0 ? num / denom : 0;
}

function computeTrialSpectralAnalysis(sessions) {
  const spectralResults = [];

  sessions.forEach(session => {
    const subjectSequence = [];

    session.minutes?.forEach(minute => {
      if (minute.subjectSequence && minute.subjectSequence.length > 0) {
        subjectSequence.push(...minute.subjectSequence.map(Number));
      }
    });

    if (subjectSequence.length >= 32) { // Minimum for meaningful spectral analysis
      // Use Welch's method for short sequences, Hann-windowed periodogram for long
      const useWelch = subjectSequence.length < 500;
      const spec = performSpectralAnalysis(subjectSequence, {
        useWindow: true,
        useWelch: useWelch,
        segmentLength: 64
      });

      spectralResults.push({
        sessionId: session.id,
        trials: subjectSequence.length,
        powerSpectrum: spec.powerSpectrum,
        dominantFrequency: spec.peakFrequency,
        totalPower: spec.totalPower,
        method: spec.method
      });
    }
  });

  return spectralResults;
}

function filterSessions(sessions, mode, binauralFilter, primeFilter, mappingFilter, sessionFilter = 'all', sessionTypeFilter = 'all') {
  let filtered = sessions;

  // Filter by session type (human, ai_agent, or baseline/auto-mode)
  if (sessionTypeFilter === 'human') {
    filtered = filtered.filter(s => s.session_type === 'human' || (!s.session_type && s.mode === 'human'));
  } else if (sessionTypeFilter === 'ai') {
    filtered = filtered.filter(s => s.session_type === 'ai_agent' || s.mode === 'ai');
  } else if (sessionTypeFilter === 'auto') {
    filtered = filtered.filter(s => s.session_type === 'baseline' || s.mode === 'baseline');
  }

  // Filter by completion status
  if (mode === 'completers') {
    filtered = filtered.filter(s => s.exitedEarly === false);
  } else if (mode === 'nonCompleters') {
    filtered = filtered.filter(s => s.exitedEarly === true);
  }

  // Filter by session count (first vs repeat sessions)
  if (sessionFilter === 'first' || sessionFilter === 'repeat') {
    // Group sessions by participant_id and find earliest timestamp
    const participantSessions = {};
    sessions.forEach(s => {
      const pid = s.participant_id;
      if (!pid) return; // Skip sessions without participant_id
      if (!participantSessions[pid]) {
        participantSessions[pid] = [];
      }
      participantSessions[pid].push(s);
    });

    // Sort each participant's sessions by timestamp and mark first session
    const firstSessionIds = new Set();
    Object.values(participantSessions).forEach(pSessions => {
      if (pSessions.length > 0) {
        // Sort by timestamp (earliest first)
        pSessions.sort((a, b) => {
          const aTime = a.timestamp?.toMillis?.() || a.timestamp || 0;
          const bTime = b.timestamp?.toMillis?.() || b.timestamp || 0;
          return aTime - bTime;
        });
        firstSessionIds.add(pSessions[0].id);
      }
    });

    if (sessionFilter === 'first') {
      filtered = filtered.filter(s => firstSessionIds.has(s.id));
    } else if (sessionFilter === 'repeat') {
      filtered = filtered.filter(s => !firstSessionIds.has(s.id) && s.participant_id);
    }
  }

  // Filter by binaural beats
  if (binauralFilter === 'yes') {
    filtered = filtered.filter(s => s.post_survey?.binaural_beats === 'Yes');
  } else if (binauralFilter === 'no') {
    filtered = filtered.filter(s => s.post_survey?.binaural_beats === 'No' || s.post_survey?.binaural_beats === 'What are binaural beats?');
  }

  // Filter by prime condition
  if (primeFilter === 'primed') {
    filtered = filtered.filter(s => s.prime_condition === 'prime');
  } else if (primeFilter === 'neutral') {
    filtered = filtered.filter(s => s.prime_condition === 'neutral');
  }

  // Mapping type filtering now happens at block level in computeStatistics()

  // All data is live now - no filtering needed by data type

  return filtered;
}

async function fetchAllRunsWithMinutes(includeTrials = true, aggregatesOnly = false) {
  try {
    // Fetch only from experiment3_ai_responses (contains all human, baseline, and ai_agent sessions)
    const runsSnap = await getDocs(
      query(collection(db, 'experiment3_ai_responses'), orderBy('createdAt', 'desc'))
    );
    const runs = runsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Fast mode: return only run documents with aggregates (no subcollections)
    if (aggregatesOnly) {
      console.log('📊 FAST MODE: Loaded', runs.length, 'sessions with aggregates only');
      return runs.map(r => ({
        ...r,
        minutes: [], // Empty array to avoid breaking existing code
        audits: [],
        blockCommits: []
      }));
    }

    const out = [];

    for (const r of runs) {
      try {
        const minsSnap = await getDocs(
          collection(db, 'experiment3_ai_responses', r.id, 'minutes')
        );
        const minutes = minsSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.idx ?? 0) - (b.idx ?? 0));

        // Fetch trial-level data for each minute/block if requested
        if (includeTrials) {
          for (let minute of minutes) {
            // Check if trial data is in new array format (efficient)
            // New format only: trial_data contains subject_bits, demon_bits arrays
            if (minute.trial_data && minute.trial_data.subject_bits) {
              const subjectBits = minute.trial_data.subject_bits;
              const ghostBits = minute.trial_data.demon_bits;
              const targetBit = minute.trial_data.target_bit;

              // Generate sequences from arrays
              minute.subjectBitSequence = subjectBits;
              minute.ghostBitSequence = ghostBits;
              minute.subjectSequence = subjectBits.map(bit => bit === targetBit ? 1 : 0);
              minute.ghostSequence = ghostBits.map(bit => bit === targetBit ? 1 : 0);
              minute.targetSequence = new Array(subjectBits.length).fill(targetBit);
              minute.trialTimestamps = [];
              minute.trials = [];
            }
          }
        }

        // Fetch audit data
        let audits = [];
        try {
          const auditsSnap = await getDocs(
            collection(db, 'experiment3_ai_responses', r.id, 'audits')
          );
          audits = auditsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        } catch (err) {
          console.warn(`Failed to fetch audits for run ${r.id}:`, err);
        }

        // STRATEGIC ABORT DETECTION: Fetch block_commits to detect timing attacks
        let blockCommits = [];
        let abortAnalysis = null;
        try {
          const commitsSnap = await getDocs(
            collection(db, 'experiment3_ai_responses', r.id, 'block_commits')
          );
          blockCommits = commitsSnap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (a.blockIdx ?? 0) - (b.blockIdx ?? 0));

          // Analyze aborts: blocks with commits but no processed minutes
          const abortedBlocks = [];
          for (const commit of blockCommits) {
            const processed = minutes.find(m => m.idx === commit.blockIdx);
            if (!processed) {
              // Calculate what score would have been
              const bits = commit.bits || '';
              const target = commit.target;
              const targetBit = target === 'BLUE' ? '1' : '0';

              // Use assignment bit (bit 0) to determine subject bits
              const assignmentBit = bits[0];
              const subjectBits = assignmentBit === '1'
                ? bits.slice(1, 151)
                : bits.slice(151, 301);

              const hits = subjectBits.split('').filter(b => b === targetBit).length;
              const score = (hits / 150 * 100);

              abortedBlocks.push({
                blockIdx: commit.blockIdx,
                hits,
                score,
                committedAt: commit.committedAt,
                auth: commit.auth
              });
            }
          }

          if (abortedBlocks.length > 0 || blockCommits.length !== minutes.length) {
            abortAnalysis = {
              totalCommits: blockCommits.length,
              totalProcessed: minutes.length,
              abortedCount: abortedBlocks.length,
              abortedBlocks,
              avgAbortedScore: abortedBlocks.length > 0
                ? abortedBlocks.reduce((sum, b) => sum + b.score, 0) / abortedBlocks.length
                : null
            };
          }
        } catch (err) {
          console.warn(`Failed to fetch block_commits for run ${r.id}:`, err);
        }

        out.push({ ...r, minutes, audits, blockCommits, abortAnalysis });
      } catch (err) {
        console.warn(`Failed to fetch minutes for run ${r.id}:`, err);
        out.push({ ...r, minutes: [], audits: [] });
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
function AnalyticsSection({ title, content, requiresDetailedData, onExpand, detailedDataLoaded, loadingDetailed }) {
  const [expanded, setExpanded] = useState(false);
  const [shouldExpandAfterLoad, setShouldExpandAfterLoad] = useState(false);

  // Auto-expand after data loads if user clicked while loading
  useEffect(() => {
    if (shouldExpandAfterLoad && detailedDataLoaded) {
      setExpanded(true);
      setShouldExpandAfterLoad(false);
    }
  }, [shouldExpandAfterLoad, detailedDataLoaded]);

  const handleToggle = () => {
    console.log('AnalyticsSection handleToggle:', {
      title,
      expanded,
      requiresDetailedData,
      detailedDataLoaded,
      loadingDetailed
    });

    if (!expanded && requiresDetailedData && !detailedDataLoaded) {
      // Trigger data load and mark to expand after
      console.log('Triggering data load for:', title);
      if (onExpand) {
        onExpand();
        setShouldExpandAfterLoad(true);
      }
    } else {
      console.log('Toggling expanded state for:', title);
      setExpanded(!expanded);
    }
  };

  return (
    <div style={{ marginBottom: 24, border: '1px solid #e5e7eb', borderRadius: 8 }}>
      <button
        onClick={handleToggle}
        disabled={loadingDetailed && requiresDetailedData && !detailedDataLoaded}
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
          cursor: (loadingDetailed && requiresDetailedData && !detailedDataLoaded) ? 'wait' : 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>
          {title}
          {loadingDetailed && requiresDetailedData && !detailedDataLoaded && (
            <span style={{ marginLeft: 8, fontSize: 14, color: '#9ca3af' }}>
              (Loading detailed data...)
            </span>
          )}
        </span>
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

// Simple Performance Summary - Just basic QA context
function PrimaryPerformanceMetrics({ sessions, stats }) {
  if (!stats) return null;

  return (
    <div>
      <h3 style={{ marginBottom: 16, color: '#374151' }}>Basic Performance Summary</h3>
      <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 16 }}>
        Simple hit rate overview for quality assurance context
      </div>

      {/* Minimal Key Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa' }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Overall Hit Rate</div>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: '#374151' }}>
            {(stats.avgHitRate * 100).toFixed(2)}%
          </div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
            {stats.totalHits.toLocaleString()} / {stats.totalTrials.toLocaleString()} trials
          </div>
        </div>

        <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa' }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Sessions Analyzed</div>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: '#374151' }}>
            {sessions.length}
          </div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
            {sessions.reduce((sum, s) => sum + (s.minutes?.length || 0), 0)} total blocks
          </div>
        </div>

        <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa' }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Z-Score vs Chance</div>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: stats.z > 0 ? '#059669' : '#dc2626' }}>
            {stats.z.toFixed(3)}
          </div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
            p = {stats.p.toFixed(4)}
          </div>
        </div>
      </div>
    </div>
  );
}

// Simple cumulative performance chart
// Unified Temporal & Control Analysis Component
function UnifiedTemporalControlAnalysis({ sessions }) {
  const temporalMetrics = useMemo(() => {
    // Block-to-block analysis for individual blocks (each minute = 150 trials = 1 block, 300 bits fetched per block)
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
        const variance = sampleVariance(correlations); // Use unbiased sample variance
        const se = Math.sqrt(variance / correlations.length);

        blockAutocorrelations[lag] = {
          mean,
          std: Math.sqrt(variance),
          count: correlations.length,
          // Test against null hypothesis of zero correlation
          tStat: se > 0 ? Math.abs(mean) / se : 0,
          significant: se > 0 ? Math.abs(mean) / se > 1.96 : false // p < 0.05
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

    // NEW: Trial-level temporal analysis
    let trialAnalysis = {};

    // Check if trial data is available
    const hasTrialData = sessions.some(session =>
      session.minutes?.some(minute => minute.subjectSequence && minute.subjectSequence.length > 0)
    );

    if (hasTrialData) {
      // Trial-level autocorrelation analysis (lags 1-10 for finer temporal structure)
      const trialAutocorrelations = {};
      const trialLags = [1, 2, 3, 5, 10];

      trialLags.forEach(lag => {
        const correlations = computeTrialAutocorrelation(sessions, lag);
        const subjectCorrs = correlations.filter(c => c.type === 'subject').map(c => c.value);
        const ghostCorrs = correlations.filter(c => c.type === 'ghost').map(c => c.value);

        if (subjectCorrs.length > 0) {
          const subjectMean = subjectCorrs.reduce((a, b) => a + b, 0) / subjectCorrs.length;
          const subjectVariance = subjectCorrs.reduce((sum, val) => sum + Math.pow(val - subjectMean, 2), 0) / subjectCorrs.length;

          trialAutocorrelations[lag] = {
            subject: {
              mean: subjectMean,
              std: Math.sqrt(subjectVariance),
              count: subjectCorrs.length,
              tStat: Math.abs(subjectMean) / Math.sqrt(subjectVariance / subjectCorrs.length),
              significant: Math.abs(subjectMean) / Math.sqrt(subjectVariance / subjectCorrs.length) > 1.96
            },
            ghost: ghostCorrs.length > 0 ? {
              mean: ghostCorrs.reduce((a, b) => a + b, 0) / ghostCorrs.length,
              std: Math.sqrt(ghostCorrs.reduce((sum, val) => sum + Math.pow(val - (ghostCorrs.reduce((a, b) => a + b, 0) / ghostCorrs.length), 2), 0) / ghostCorrs.length),
              count: ghostCorrs.length
            } : null
          };
        }
      });

      // Trial-level cross-correlation between subject and ghost
      const crossCorrelations = computeTrialCrossCorrelation(sessions, 0);
      const crossCorrMean = crossCorrelations.length > 0 ?
        crossCorrelations.reduce((sum, cc) => sum + cc.value, 0) / crossCorrelations.length : 0;
      const crossCorrVariance = crossCorrelations.length > 0 ?
        crossCorrelations.reduce((sum, cc) => sum + Math.pow(cc.value - crossCorrMean, 2), 0) / crossCorrelations.length : 0;

      // Trial-level spectral analysis
      const spectralResults = computeTrialSpectralAnalysis(sessions);

      // Trial-level runs test on complete sequences
      const allTrialSequences = sessions.map(session => {
        const sequence = [];
        session.minutes?.forEach(minute => {
          if (minute.subjectSequence) sequence.push(...minute.subjectSequence);
        });
        return sequence;
      }).filter(seq => seq.length > 10);

      const trialRunsTests = allTrialSequences.map(seq => computeRunsTest(seq));
      const avgTrialRunsTest = trialRunsTests.length > 0 ? {
        statistic: trialRunsTests.reduce((sum, rt) => sum + rt.z, 0) / trialRunsTests.length,
        pValue: trialRunsTests.reduce((sum, rt) => sum + rt.p, 0) / trialRunsTests.length,
        numRuns: trialRunsTests.reduce((sum, rt) => sum + rt.numRuns, 0) / trialRunsTests.length,
        expected: trialRunsTests.reduce((sum, rt) => sum + rt.expected, 0) / trialRunsTests.length
      } : null;

      trialAnalysis = {
        available: true,
        totalTrials: sessions.reduce((sum, session) => {
          return sum + session.minutes?.reduce((mSum, minute) => {
            return mSum + (minute.subjectSequence?.length || 0);
          }, 0);
        }, 0),
        autocorrelations: trialAutocorrelations,
        crossCorrelation: {
          mean: crossCorrMean,
          std: Math.sqrt(crossCorrVariance),
          count: crossCorrelations.length,
          tStat: crossCorrelations.length > 0 ? Math.abs(crossCorrMean) / Math.sqrt(crossCorrVariance / crossCorrelations.length) : 0,
          significant: crossCorrelations.length > 0 ? Math.abs(crossCorrMean) / Math.sqrt(crossCorrVariance / crossCorrelations.length) > 1.96 : false
        },
        spectralAnalysis: spectralResults.length > 0 ? {
          sessions: spectralResults.length,
          avgDominantFreq: spectralResults.reduce((sum, sr) => sum + sr.dominantFrequency.frequency, 0) / spectralResults.length,
          avgDominantPower: spectralResults.reduce((sum, sr) => sum + sr.dominantFrequency.power, 0) / spectralResults.length
        } : null,
        runsTest: avgTrialRunsTest
      };
    } else {
      trialAnalysis = { available: false, message: 'Trial-level data not available - using block-level analysis only' };
    }

    // GHOST VS SUBJECT COMPARISON (from GhostSubjectControlAnalysis)
    const ghostBlocks = [];
    const entropyComparisons = [];

    sessions.forEach(session => {
      (session.minutes || []).forEach(minute => {
        const subjectHitRate = minute.n > 0 ? minute.hits / minute.n : 0.5;
        const demonHitRate = minute.n > 0 ? (minute.demon_hits || 0) / minute.n : 0.5;

        ghostBlocks.push({
          sessionId: session.id,
          blockIndex: minute.idx || 0,
          hitRate: demonHitRate,
          hits: minute.demon_hits || 0,
          trials: minute.n || 0,
        });

        // Entropy comparisons for this block
        const entropyWindows = minute.entropy?.new_windows_subj || [];
        if (entropyWindows.length > 0) {
          const avgEntropy = entropyWindows.reduce((sum, w) => {
            if (typeof w === 'number') return sum + w;
            return sum + (w.entropy || 0);
          }, 0) / entropyWindows.length;
          entropyComparisons.push({
            sessionId: session.id,
            blockIndex: minute.idx || 0,
            subjectHitRate,
            ghostHitRate: demonHitRate,
            entropy: avgEntropy,
          });
        }
      });
    });

    // Ghost autocorrelation
    const ghostHitRates = ghostBlocks.map(b => b.hitRate);
    const ghostAutocorrelations = {};
    lags.forEach(lag => {
      const ghostAutocorr = computeAutocorrelation(ghostHitRates, lag);
      ghostAutocorrelations[lag] = isFinite(ghostAutocorr) ? ghostAutocorr : 0;
    });

    // Subject vs Ghost comparison
    const subjectMean = combinedHitRates.reduce((a, b) => a + b, 0) / combinedHitRates.length;
    const ghostMean = ghostHitRates.reduce((a, b) => a + b, 0) / ghostHitRates.length;
    const subjectVar = combinedHitRates.reduce((sum, val) => sum + Math.pow(val - subjectMean, 2), 0) / combinedHitRates.length;
    const ghostVar = ghostHitRates.reduce((sum, val) => sum + Math.pow(val - ghostMean, 2), 0) / ghostHitRates.length;

    const pooledVar = (subjectVar + ghostVar) / 2;
    const standardError = Math.sqrt(2 * pooledVar / combinedHitRates.length);
    const tStat = pooledVar > 0 ? (subjectMean - ghostMean) / standardError : 0;
    const degreesOfFreedom = 2 * combinedHitRates.length - 2;

    // Cross-correlation between subject and ghost
    const subjectGhostCrossCorr = calculateCrossCorrelation(combinedHitRates, ghostHitRates);
    const subjectGhostCorrelation = calculateCorrelation(combinedHitRates, ghostHitRates);

    // Spectral analysis comparison
    const subjectSpectral = performSpectralAnalysis(combinedHitRates, { useWindow: true });
    const ghostSpectral = performSpectralAnalysis(ghostHitRates, { useWindow: true });

    // Entropy correlations
    const entropyPerformanceCorr = entropyComparisons.length > 0 ?
      calculateCorrelation(
        entropyComparisons.map(e => e.entropy),
        entropyComparisons.map(e => e.subjectHitRate)
      ) : 0;

    const entropyAutocorr = entropyComparisons.length > 0 ?
      computeAutocorrelation(entropyComparisons.map(e => e.entropy), 1) : 0;

    const entropyPerformanceCrossCorr = entropyComparisons.length > 0 ?
      calculateCrossCorrelation(
        entropyComparisons.map(e => e.entropy),
        entropyComparisons.map(e => e.subjectHitRate)
      ) : null;

    // Helper functions for normal CDF
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
      const absX = Math.abs(x);

      const t = 1.0 / (1.0 + p * absX);
      const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);

      return sign * y;
    }

    // DATA QUALITY METRICS (from ControlValidations)
    let totalGhostHits = 0;
    let totalGhostTrials = 0;
    let dataMissingCount = 0;
    let totalMinutes = 0;
    const sessionHealthScores = [];

    sessions.forEach(session => {
      let sessionGhostHits = 0;
      let sessionGhostTrials = 0;
      let sessionMinutes = 0;
      let sessionMissingData = 0;

      (session.minutes || []).forEach(minute => {
        sessionMinutes++;
        totalMinutes++;

        const ghostHits = minute.ghost_hits || 0;
        const ghostTrials = minute.n || 0;
        sessionGhostHits += ghostHits;
        sessionGhostTrials += ghostTrials;
        totalGhostHits += ghostHits;
        totalGhostTrials += ghostTrials;

        if (!minute.hits || !minute.ghost_hits || minute.n === 0) {
          sessionMissingData++;
          dataMissingCount++;
        }
      });

      const sessionGhostRate = sessionGhostTrials > 0 ? sessionGhostHits / sessionGhostTrials : 0;
      const sessionSubjRate = session.minutes ?
        session.minutes.reduce((sum, m) => sum + (m.hits || 0), 0) /
        session.minutes.reduce((sum, m) => sum + (m.n || 0), 0) : 0;

      const ghostDeviation = Math.abs(sessionGhostRate - 0.5);
      const subjDeviation = Math.abs(sessionSubjRate - 0.5);
      const criticalRatio = sessionGhostTrials > 0 ? subjDeviation / Math.max(ghostDeviation, 0.001) : 0;

      const dataCompletion = sessionMinutes > 0 ? 1 - (sessionMissingData / sessionMinutes) : 0;
      const ghostProximityToChance = 1 - Math.abs(sessionGhostRate - 0.5) * 2;
      const healthScore = (dataCompletion * 0.6) + (ghostProximityToChance * 0.4);

      sessionHealthScores.push({
        sessionId: session.id,
        healthScore,
        dataCompletion,
        ghostRate: sessionGhostRate,
        subjRate: sessionSubjRate,
        criticalRatio,
      });
    });

    const overallGhostRate = totalGhostTrials > 0 ? totalGhostHits / totalGhostTrials : 0;
    const dataCompletionRate = totalMinutes > 0 ? 1 - (dataMissingCount / totalMinutes) : 0;
    const ghostZ = totalGhostTrials > 0 ?
      (overallGhostRate - 0.5) / Math.sqrt(0.25 / totalGhostTrials) : 0;
    const ghostP = 2 * (1 - cdf(Math.abs(ghostZ)));
    const avgHealthScore = sessionHealthScores.length > 0 ?
      sessionHealthScores.reduce((sum, s) => sum + s.healthScore, 0) / sessionHealthScores.length : 0;

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
      sessionAnalytics,
      trialAnalysis, // NEW: Include trial-level analysis
      // Ghost comparison
      ghostComparison: {
        subjectMean,
        ghostMean,
        performanceDifference: subjectMean - ghostMean,
        tStatistic: tStat,
        degreesOfFreedom,
        significant: Math.abs(tStat) > tCritical(degreesOfFreedom),
        ghostAutocorrelations,
        subjectGhostCrossCorrelation: {
          maxCorrelation: subjectGhostCrossCorr?.maxCorrelation || 0,
          maxLag: subjectGhostCrossCorr?.maxLag || 0,
          zeroLagCorrelation: subjectGhostCorrelation,
          interpretation: Math.abs(subjectGhostCorrelation) < 0.1 ? 'Independent halves (expected)' :
                         Math.abs(subjectGhostCorrelation) < 0.3 ? 'Weak correlation' : 'Strong correlation'
        },
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
      },
      // Data quality
      dataQuality: {
        overallGhostRate,
        ghostZ,
        ghostP,
        dataCompletionRate,
        avgHealthScore,
        sessionHealthScores,
        totalGhostTrials,
        totalMinutes
      }
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

      {/* NEW: Trial-Level Temporal Analysis Section */}
      {temporalMetrics.trialAnalysis && temporalMetrics.trialAnalysis.available && (
        <div style={{ marginTop: 32, padding: 20, border: '2px solid #059669', borderRadius: 8, background: '#f0fdf4' }}>
          <h4 style={{ marginBottom: 16, color: '#059669', fontWeight: 'bold' }}>
            High-Resolution Trial-Level Analysis ({temporalMetrics.trialAnalysis.totalTrials.toLocaleString()} total trials)
          </h4>

          {/* Trial Autocorrelation Analysis */}
          <div style={{ marginBottom: 20 }}>
            <h5 style={{ marginBottom: 12, color: '#374151' }}>Trial-to-Trial Autocorrelations</h5>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
              {Object.entries(temporalMetrics.trialAnalysis.autocorrelations).map(([lag, stats]) => (
                <div key={lag} style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 6, background: '#fff' }}>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Lag {lag} trials</div>
                  <div style={{ fontSize: 14, fontWeight: 'bold', color: stats.subject.significant ? '#059669' : '#374151' }}>
                    r = {stats.subject.mean.toFixed(3)}{stats.subject.significant && ' *'}
                  </div>
                  <div style={{ fontSize: 10, color: '#6b7280' }}>
                    t = {stats.subject.tStat.toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Cross-Correlation Analysis */}
          <div style={{ marginBottom: 20 }}>
            <h5 style={{ marginBottom: 12, color: '#374151' }}>Subject-Ghost Cross-Correlation</h5>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
              <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Cross-Correlation</div>
                <div style={{ fontSize: 18, fontWeight: 'bold', color: temporalMetrics.trialAnalysis.crossCorrelation.significant ? '#dc2626' : '#059669' }}>
                  r = {temporalMetrics.trialAnalysis.crossCorrelation.mean.toFixed(3)}
                  {temporalMetrics.trialAnalysis.crossCorrelation.significant && ' *'}
                </div>
                <div style={{ fontSize: 10, color: '#6b7280' }}>
                  t = {temporalMetrics.trialAnalysis.crossCorrelation.tStat.toFixed(2)}
                </div>
              </div>
              <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Standard Error</div>
                <div style={{ fontSize: 18, fontWeight: 'bold', color: '#374151' }}>
                  {temporalMetrics.trialAnalysis.crossCorrelation.std.toFixed(3)}
                </div>
              </div>
              <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Sessions</div>
                <div style={{ fontSize: 18, fontWeight: 'bold', color: '#374151' }}>
                  {temporalMetrics.trialAnalysis.crossCorrelation.count}
                </div>
              </div>
            </div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 8, fontStyle: 'italic' }}>
              Low correlation indicates proper independence between subject and ghost quantum streams
            </div>
          </div>

          {/* Spectral Analysis */}
          {temporalMetrics.trialAnalysis.spectralAnalysis && (
            <div style={{ marginBottom: 20 }}>
              <h5 style={{ marginBottom: 12, color: '#374151' }}>Spectral Analysis (Dominant Frequencies)</h5>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Sessions Analyzed</div>
                  <div style={{ fontSize: 18, fontWeight: 'bold', color: '#374151' }}>
                    {temporalMetrics.trialAnalysis.spectralAnalysis.sessions}
                  </div>
                </div>
                <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Avg Dominant Lag</div>
                  <div style={{ fontSize: 18, fontWeight: 'bold', color: '#374151' }}>
                    {temporalMetrics.trialAnalysis.spectralAnalysis.avgDominantFreq.toFixed(1)}
                  </div>
                </div>
                <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Avg Power</div>
                  <div style={{ fontSize: 18, fontWeight: 'bold', color: '#374151' }}>
                    {temporalMetrics.trialAnalysis.spectralAnalysis.avgDominantPower.toFixed(3)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Trial-Level Runs Test */}
          {temporalMetrics.trialAnalysis.runsTest && (
            <div style={{ marginBottom: 20 }}>
              <h5 style={{ marginBottom: 12, color: '#374151' }}>Trial-Level Randomness (Runs Test)</h5>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16 }}>
                <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Z-Statistic</div>
                  <div style={{ fontSize: 18, fontWeight: 'bold', color: '#374151' }}>
                    {temporalMetrics.trialAnalysis.runsTest.statistic.toFixed(3)}
                  </div>
                </div>
                <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>P-Value</div>
                  <div style={{ fontSize: 18, fontWeight: 'bold', color: '#374151' }}>
                    {temporalMetrics.trialAnalysis.runsTest.pValue.toFixed(4)}
                  </div>
                </div>
                <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Observed Runs</div>
                  <div style={{ fontSize: 18, fontWeight: 'bold', color: '#374151' }}>
                    {temporalMetrics.trialAnalysis.runsTest.numRuns.toFixed(1)}
                  </div>
                </div>
                <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Expected Runs</div>
                  <div style={{ fontSize: 18, fontWeight: 'bold', color: '#6b7280' }}>
                    {temporalMetrics.trialAnalysis.runsTest.expected.toFixed(1)}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {temporalMetrics.trialAnalysis && !temporalMetrics.trialAnalysis.available && (
        <div style={{ marginTop: 20, padding: 16, border: '1px solid #f59e0b', borderRadius: 8, background: '#fefbf3' }}>
          <div style={{ fontSize: 14, color: '#92400e', fontWeight: 'bold' }}>
            Trial-Level Analysis Unavailable
          </div>
          <div style={{ fontSize: 12, color: '#92400e', marginTop: 4 }}>
            {temporalMetrics.trialAnalysis.message}
          </div>
        </div>
      )}

      {/* GHOST VS SUBJECT COMPARISON SECTION */}
      <div style={{ marginTop: 48, padding: 24, border: '2px solid #0369a1', borderRadius: 8, background: '#f0f9ff' }}>
        <h3 style={{ marginBottom: 16, color: '#0369a1', fontWeight: 'bold' }}>Subject vs Ghost Control Comparison</h3>
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>
          Ghost stream serves as a matched control: uses the same quantum bits but offset in time. Subject-Ghost independence validates proper bit spacing.
        </div>

        {/* Performance Comparison */}
        <div style={{ marginBottom: 24 }}>
          <h4 style={{ marginBottom: 12, color: '#374151' }}>Overall Performance</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
              <div style={{ fontSize: 12, color: '#0369a1', marginBottom: 4 }}>Subject Mean</div>
              <div style={{ fontSize: 18, fontWeight: 'bold', color: '#0369a1' }}>
                {(temporalMetrics.ghostComparison.subjectMean * 100).toFixed(2)}%
              </div>
            </div>
            <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Ghost Mean</div>
              <div style={{ fontSize: 18, fontWeight: 'bold', color: '#6b7280' }}>
                {(temporalMetrics.ghostComparison.ghostMean * 100).toFixed(2)}%
              </div>
            </div>
            <div style={{
              padding: 16,
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              background: temporalMetrics.ghostComparison.significant ? '#fef3c7' : '#fff'
            }}>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Difference</div>
              <div style={{
                fontSize: 18,
                fontWeight: 'bold',
                color: temporalMetrics.ghostComparison.significant ? '#92400e' : '#374151'
              }}>
                {(temporalMetrics.ghostComparison.performanceDifference > 0 ? '+' : '')}
                {(temporalMetrics.ghostComparison.performanceDifference * 100).toFixed(2)}%
                {temporalMetrics.ghostComparison.significant && ' *'}
              </div>
              <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>
                t({temporalMetrics.ghostComparison.degreesOfFreedom}) = {temporalMetrics.ghostComparison.tStatistic.toFixed(2)}
              </div>
            </div>
          </div>
        </div>

        {/* Autocorrelation Comparison */}
        <div style={{ marginBottom: 24 }}>
          <h4 style={{ marginBottom: 12, color: '#374151' }}>Autocorrelation Comparison (Subject vs Ghost)</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            {Object.entries(temporalMetrics.blockAutocorrelations || {}).map(([lag, subjectStats]) => {
              const ghostAutocorr = temporalMetrics.ghostComparison.ghostAutocorrelations[lag] || 0;
              const difference = (subjectStats?.mean || 0) - ghostAutocorr;
              return (
                <div key={lag} style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 6, background: '#fff' }}>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>Lag {lag}</div>
                  <div style={{ fontSize: 11, color: '#0369a1', marginBottom: 2 }}>
                    Subject: {(subjectStats?.mean || 0).toFixed(4)}
                  </div>
                  <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 2 }}>
                    Ghost: {ghostAutocorr.toFixed(4)}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 'bold', color: '#374151' }}>
                    Δ: {(difference > 0 ? '+' : '')}{difference.toFixed(4)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Cross-Correlation */}
        <div style={{ marginBottom: 24 }}>
          <h4 style={{ marginBottom: 12, color: '#374151' }}>Subject-Ghost Stream Independence</h4>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 16 }}>
            Low correlation confirms proper randomization between subject/demon half assignments (from single 300-bit fetch per block).
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Zero-Lag Correlation</div>
              <div style={{ fontSize: 18, fontWeight: 'bold', color: '#374151' }}>
                {temporalMetrics.ghostComparison.subjectGhostCrossCorrelation.zeroLagCorrelation.toFixed(4)}
              </div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                {temporalMetrics.ghostComparison.subjectGhostCrossCorrelation.interpretation}
              </div>
            </div>

            <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Max Cross-Correlation</div>
              <div style={{ fontSize: 18, fontWeight: 'bold', color: '#374151' }}>
                {temporalMetrics.ghostComparison.subjectGhostCrossCorrelation.maxCorrelation.toFixed(4)}
              </div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                At lag {temporalMetrics.ghostComparison.subjectGhostCrossCorrelation.maxLag}
              </div>
            </div>

            <div style={{
              padding: 16,
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              background: Math.abs(temporalMetrics.ghostComparison.subjectGhostCrossCorrelation.zeroLagCorrelation) < 0.1 ? '#f0fdf4' : '#fef2f2'
            }}>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Stream Quality</div>
              <div style={{
                fontSize: 14,
                fontWeight: 'bold',
                color: Math.abs(temporalMetrics.ghostComparison.subjectGhostCrossCorrelation.zeroLagCorrelation) < 0.1 ? '#059669' : '#dc2626'
              }}>
                {Math.abs(temporalMetrics.ghostComparison.subjectGhostCrossCorrelation.zeroLagCorrelation) < 0.1 ? '✓ Independent' : '⚠ Correlated'}
              </div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                {Math.abs(temporalMetrics.ghostComparison.subjectGhostCrossCorrelation.zeroLagCorrelation) < 0.1
                  ? 'Bit spacing working correctly'
                  : 'Streams may still be correlated'}
              </div>
            </div>
          </div>
        </div>

        {/* Spectral Analysis Comparison */}
        <div style={{ marginBottom: 24 }}>
          <h4 style={{ marginBottom: 12, color: '#374151' }}>Spectral Analysis Comparison</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
              <div style={{ fontSize: 14, fontWeight: 'bold', color: '#0369a1', marginBottom: 8 }}>Subject</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
                Peak Freq: {temporalMetrics.ghostComparison.spectralComparison.subject.peakFrequency.frequency.toFixed(4)} cycles/block
              </div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                Total Power: {temporalMetrics.ghostComparison.spectralComparison.subject.totalPower.toFixed(3)}
              </div>
            </div>
            <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
              <div style={{ fontSize: 14, fontWeight: 'bold', color: '#6b7280', marginBottom: 8 }}>Ghost</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
                Peak Freq: {temporalMetrics.ghostComparison.spectralComparison.ghost.peakFrequency.frequency.toFixed(4)} cycles/block
              </div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                Total Power: {temporalMetrics.ghostComparison.spectralComparison.ghost.totalPower.toFixed(3)}
              </div>
            </div>
          </div>
        </div>

        {/* Entropy Correlations */}
        {temporalMetrics.ghostComparison.entropyAnalysis.totalEntropyBlocks > 0 && (
          <div style={{ marginBottom: 24 }}>
            <h4 style={{ marginBottom: 12, color: '#374151' }}>Entropy Correlations</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
              <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Entropy-Performance</div>
                <div style={{ fontSize: 16, fontWeight: 'bold', color: '#374151' }}>
                  r = {temporalMetrics.ghostComparison.entropyAnalysis.performanceCorrelation.toFixed(3)}
                </div>
                <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>
                  {temporalMetrics.ghostComparison.entropyAnalysis.totalEntropyBlocks} blocks
                </div>
              </div>
              <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Entropy Autocorr (Lag 1)</div>
                <div style={{ fontSize: 16, fontWeight: 'bold', color: '#374151' }}>
                  {isFinite(temporalMetrics.ghostComparison.entropyAnalysis.autocorrelation) ?
                    temporalMetrics.ghostComparison.entropyAnalysis.autocorrelation.toFixed(3) : 'N/A'}
                </div>
              </div>
              {temporalMetrics.ghostComparison.entropyAnalysis.crossCorrelation && (
                <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Cross-Correlation</div>
                  <div style={{ fontSize: 16, fontWeight: 'bold', color: '#374151' }}>
                    {temporalMetrics.ghostComparison.entropyAnalysis.crossCorrelation.maxCorr.toFixed(3)}
                  </div>
                  <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>
                    Lag: {temporalMetrics.ghostComparison.entropyAnalysis.crossCorrelation.maxLag}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>


      <div style={{ fontSize: 12, color: '#6b7280', fontStyle: 'italic', marginTop: 24 }}>
        * indicates statistical significance (p &lt; 0.05)
      </div>
    </div>
  );
}

// Entropy Signatures Component
function EntropySignatures({ sessions }) {
  const entropyMetrics = useMemo(() => {
    console.log('🔍 EntropySignatures: Processing', sessions.length, 'sessions');

    const entropyValues = [];
    const entropyBySession = [];

    const allWindows = []; // Store all windows with temporal info
    const subjectWindows = []; // Subject only
    const demonWindows = []; // Demon only
    const auditWindows = []; // Audit only

    sessions.forEach(session => {
      const sessionEntropy = [];
      const sessionWindows = [];

      (session.minutes || []).forEach((minute, blockIdx) => {
        // Use block-level entropy (150-bit blocks)
        const blockEntropySubj = minute.entropy?.block_entropy_subj;
        const blockEntropyDemon = minute.entropy?.block_entropy_demon;

        // Add subject entropy
        if (blockEntropySubj !== undefined && !isNaN(blockEntropySubj)) {
          entropyValues.push(blockEntropySubj);
          sessionEntropy.push(blockEntropySubj);
          const windowData = {
            entropy: blockEntropySubj,
            windowIndex: blockIdx,
            sessionId: session.id,
            type: 'subject'
          };
          allWindows.push(windowData);
          subjectWindows.push(windowData);
          sessionWindows.push({
            entropy: blockEntropySubj,
            windowIndex: blockIdx
          });
        }

        // Add demon entropy
        if (blockEntropyDemon !== undefined && !isNaN(blockEntropyDemon)) {
          entropyValues.push(blockEntropyDemon);
          sessionEntropy.push(blockEntropyDemon);
          const windowData = {
            entropy: blockEntropyDemon,
            windowIndex: blockIdx,
            sessionId: session.id,
            type: 'demon'
          };
          allWindows.push(windowData);
          demonWindows.push(windowData);
          sessionWindows.push({
            entropy: blockEntropyDemon,
            windowIndex: blockIdx
          });
        }
      });

      // Add audit entropy
      (session.audits || []).forEach(audit => {
        if (audit.entropy !== undefined && !isNaN(audit.entropy)) {
          entropyValues.push(audit.entropy);
          sessionEntropy.push(audit.entropy);
          const windowData = {
            entropy: audit.entropy,
            windowIndex: audit.blockAfter,
            sessionId: session.id,
            type: 'audit'
          };
          allWindows.push(windowData);
          auditWindows.push(windowData);
          sessionWindows.push({
            entropy: audit.entropy,
            windowIndex: audit.blockAfter
          });
        }
      });

      if (sessionEntropy.length > 0) {
        entropyBySession.push({
          sessionId: session.id,
          participantId: session.participant_id,
          condition: session.prime_condition,
          binaural: session.post_survey?.binaural_beats,
          entropies: sessionEntropy,
          meanEntropy: sessionEntropy.reduce((a, b) => a + b, 0) / sessionEntropy.length,
          stdEntropy: Math.sqrt(sessionEntropy.reduce((sum, val) => {
            const mean = sessionEntropy.reduce((a, b) => a + b, 0) / sessionEntropy.length;
            return sum + Math.pow(val - mean, 2);
          }, 0) / sessionEntropy.length),
        });
      }
    });

    console.log('📊 EntropySignatures Summary:', {
      totalEntropyValues: entropyValues.length,
      sessionsWithEntropy: entropyBySession.length,
      totalSessions: sessions.length
    });

    if (entropyValues.length === 0) {
      console.warn('⚠️ No entropy data found - returning message');
      return { message: 'No entropy data available for analysis' };
    }

    // Overall statistics
    const mean = entropyValues.reduce((a, b) => a + b, 0) / entropyValues.length;
    const std = Math.sqrt(entropyValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / entropyValues.length);
    const min = Math.min(...entropyValues);
    const max = Math.max(...entropyValues);

    // Distribution analysis (histogram bins) with temporal separation
    const bins = 20;
    const binWidth = (max - min) / bins;
    const histogram = new Array(bins).fill(0);
    const earlyHistogram = new Array(bins).fill(0);
    const lateHistogram = new Array(bins).fill(0);

    // Separate windows into early vs late within each session
    const sessionGroups = {};
    allWindows.forEach(window => {
      if (!sessionGroups[window.sessionId]) {
        sessionGroups[window.sessionId] = [];
      }
      sessionGroups[window.sessionId].push(window);
    });

    // Standard histogram for all entropy values (fallback)
    entropyValues.forEach(value => {
      const binIndex = Math.min(Math.floor((value - min) / binWidth), bins - 1);
      histogram[binIndex]++;
    });

    // Classify as early/late within each session and fill histograms
    Object.values(sessionGroups).forEach(sessionWindows => {
      // Sort by windowIndex and split into early/late halves
      const sorted = sessionWindows
        .filter(w => w.windowIndex !== null)
        .sort((a, b) => a.windowIndex - b.windowIndex);

      const midpoint = Math.floor(sorted.length / 2);

      sorted.forEach((window, idx) => {
        const binIndex = Math.min(Math.floor((window.entropy - min) / binWidth), bins - 1);

        if (idx < midpoint || sorted.length === 1) {
          earlyHistogram[binIndex]++;
        } else {
          lateHistogram[binIndex]++;
        }
      });
    });

    // Create separate histograms for subject, demon, and audit
    const subjectHistogram = new Array(bins).fill(0);
    const demonHistogram = new Array(bins).fill(0);
    const auditHistogram = new Array(bins).fill(0);

    subjectWindows.forEach(w => {
      const binIndex = Math.min(Math.floor((w.entropy - min) / binWidth), bins - 1);
      subjectHistogram[binIndex]++;
    });

    demonWindows.forEach(w => {
      const binIndex = Math.min(Math.floor((w.entropy - min) / binWidth), bins - 1);
      demonHistogram[binIndex]++;
    });

    auditWindows.forEach(w => {
      const binIndex = Math.min(Math.floor((w.entropy - min) / binWidth), bins - 1);
      auditHistogram[binIndex]++;
    });

    // TEST 1 (H1): Mean Entropy Comparison - Subject vs Ghost (Paired t-test)
    const sessionPairs = sessions.map(session => {
      const subjEntropies = (session.minutes || [])
        .map(m => m.entropy?.block_entropy_subj)
        .filter(e => e != null && isFinite(e));
      const ghostEntropies = (session.minutes || [])
        .map(m => m.entropy?.block_entropy_ghost)
        .filter(e => e != null && isFinite(e));

      if (subjEntropies.length === 0 || ghostEntropies.length === 0) return null;

      const subjMean = subjEntropies.reduce((a, b) => a + b, 0) / subjEntropies.length;
      const ghostMean = ghostEntropies.reduce((a, b) => a + b, 0) / ghostEntropies.length;

      return {
        sessionId: session.id,
        subjMean,
        ghostMean,
        diff: subjMean - ghostMean // Negative = subject < ghost (suppression)
      };
    }).filter(p => p !== null);

    let h1_entropySuppressionTest = null;
    if (sessionPairs.length > 1) {
      const diffs = sessionPairs.map(p => p.diff);
      const meanDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
      const sdDiff = Math.sqrt(
        diffs.reduce((sum, d) => sum + Math.pow(d - meanDiff, 2), 0) / (diffs.length - 1)
      );
      const t = (meanDiff * Math.sqrt(diffs.length)) / sdDiff;
      const df = diffs.length - 1;
      const p = twoSidedP(t); // Using existing helper

      h1_entropySuppressionTest = {
        n: diffs.length,
        meanDiff,
        sdDiff,
        t,
        df,
        p,
        significant: p < 0.05,
        interpretation: meanDiff < 0
          ? 'Subject entropy < Ghost entropy (suppression detected)'
          : 'Subject entropy ≥ Ghost entropy (no suppression)'
      };
    }

    // TEST 2 (H2): Entropy Window Autocorrelation with Permutation Test
    const computeEntropyWindowAutocorrelation = (entropyWindows, nPermutations = 10000) => {
      const values = entropyWindows.map(w => w.entropy).filter(e => isFinite(e));
      if (values.length < 2) return null;

      // Lag-1 correlation
      const lag1Corr = (arr) => {
        const pairs = arr.slice(0, -1).map((val, i) => [val, arr[i + 1]]);
        const n = pairs.length;
        if (n === 0) return 0;

        const meanX = pairs.reduce((s, [x]) => s + x, 0) / n;
        const meanY = pairs.reduce((s, [, y]) => s + y, 0) / n;

        let num = 0, denomX = 0, denomY = 0;
        pairs.forEach(([x, y]) => {
          num += (x - meanX) * (y - meanY);
          denomX += (x - meanX) ** 2;
          denomY += (y - meanY) ** 2;
        });

        return denomX === 0 || denomY === 0 ? 0 : num / Math.sqrt(denomX * denomY);
      };

      const observedR = lag1Corr(values);

      // Permutation test
      let countGreaterOrEqual = 0;
      for (let i = 0; i < nPermutations; i++) {
        const shuffled = [...values].sort(() => Math.random() - 0.5);
        const nullR = lag1Corr(shuffled);
        if (nullR >= observedR) countGreaterOrEqual++;
      }

      const p = countGreaterOrEqual / nPermutations;

      return {
        observedR,
        p,
        nPermutations,
        windowCount: values.length,
        significant: p < 0.05
      };
    };

    // Compute autocorrelation per session, then aggregate
    const h2_autocorrResults = sessions.map(session => {
      const windows = [];
      (session.minutes || []).forEach(minute => {
        const subjWindows = minute.entropy?.new_windows_subj || [];
        windows.push(...subjWindows);
      });

      if (windows.length < 2) return null;

      return {
        sessionId: session.id,
        ...computeEntropyWindowAutocorrelation(windows)
      };
    }).filter(r => r !== null);

    const h2_overallAutocorr = h2_autocorrResults.length > 0 ? {
      sessions: h2_autocorrResults.length,
      meanR: h2_autocorrResults.reduce((s, r) => s + r.observedR, 0) / h2_autocorrResults.length,
      significantSessions: h2_autocorrResults.filter(r => r.significant).length,
      interpretation: h2_autocorrResults.filter(r => r.significant).length > 0
        ? 'Positive autocorrelation detected (redundancy/feedback)'
        : 'No significant autocorrelation'
    } : null;

    // Condition comparison
    const primeEntropies = entropyBySession.filter(s => s.condition === 'prime').flatMap(s => s.entropies);
    const neutralEntropies = entropyBySession.filter(s => s.condition === 'neutral').flatMap(s => s.entropies);

    const primeMean = primeEntropies.length > 0 ? primeEntropies.reduce((a, b) => a + b, 0) / primeEntropies.length : 0;
    const neutralMean = neutralEntropies.length > 0 ? neutralEntropies.reduce((a, b) => a + b, 0) / neutralEntropies.length : 0;

    // NEW: Trial-level entropy analysis
    let trialLevelEntropy = {};

    // Check if trial data is available
    const hasTrialData = sessions.some(session =>
      session.minutes?.some(minute => minute.subjectBitSequence && minute.subjectBitSequence.length > 0)
    );

    if (hasTrialData) {
      const trialEntropyBySession = [];
      const performanceEntropyCorrelations = [];

      sessions.forEach(session => {
        const sessionTrialEntropies = [];
        const sessionPerformanceCorrelations = [];

        session.minutes?.forEach(minute => {
          if (minute.subjectBitSequence && minute.subjectSequence &&
              minute.subjectBitSequence.length > 0 && minute.subjectSequence.length > 0) {

            // Calculate entropy for this block
            const blockSubjectEntropy = shannonEntropy(minute.subjectBitSequence);
            const blockGhostEntropy = shannonEntropy(minute.ghostBitSequence || []);

            // Calculate performance for this block
            const blockPerformance = minute.subjectSequence.reduce((sum, outcome) => sum + outcome, 0) / minute.subjectSequence.length;

            sessionTrialEntropies.push({
              blockIdx: minute.idx,
              subjectEntropy: blockSubjectEntropy,
              ghostEntropy: blockGhostEntropy,
              performance: blockPerformance,
              trials: minute.subjectSequence.length
            });

            // Store correlation data
            if (isFinite(blockSubjectEntropy) && isFinite(blockPerformance)) {
              sessionPerformanceCorrelations.push({
                entropy: blockSubjectEntropy,
                performance: blockPerformance
              });
            }
          }
        });

        if (sessionTrialEntropies.length > 0) {
          const sessionAvgEntropy = sessionTrialEntropies.reduce((sum, block) => sum + block.subjectEntropy, 0) / sessionTrialEntropies.length;
          const sessionAvgPerformance = sessionTrialEntropies.reduce((sum, block) => sum + block.performance, 0) / sessionTrialEntropies.length;

          trialEntropyBySession.push({
            sessionId: session.id,
            condition: session.prime_condition,
            blocks: sessionTrialEntropies,
            avgEntropy: sessionAvgEntropy,
            avgPerformance: sessionAvgPerformance,
            entropyPerformanceCorr: sessionPerformanceCorrelations.length > 1 ?
              computeCrossCorrelation(
                sessionPerformanceCorrelations.map(c => c.entropy),
                sessionPerformanceCorrelations.map(c => c.performance),
                0
              ) : 0
          });

          performanceEntropyCorrelations.push(...sessionPerformanceCorrelations);
        }
      });

      // Overall entropy-performance correlation across all sessions
      const overallEntropyPerformanceCorr = performanceEntropyCorrelations.length > 1 ?
        computeCrossCorrelation(
          performanceEntropyCorrelations.map(c => c.entropy),
          performanceEntropyCorrelations.map(c => c.performance),
          0
        ) : 0;

      // Entropy distribution analysis for trial-level data
      const allTrialEntropies = trialEntropyBySession.flatMap(session => session.blocks.map(block => block.subjectEntropy));
      const trialEntropyMean = allTrialEntropies.length > 0 ?
        allTrialEntropies.reduce((a, b) => a + b, 0) / allTrialEntropies.length : 0;
      const trialEntropyStd = allTrialEntropies.length > 0 ?
        Math.sqrt(allTrialEntropies.reduce((sum, val) => sum + Math.pow(val - trialEntropyMean, 2), 0) / allTrialEntropies.length) : 0;
      const trialEntropyMin = allTrialEntropies.length > 0 ? Math.min(...allTrialEntropies) : 0;
      const trialEntropyMax = allTrialEntropies.length > 0 ? Math.max(...allTrialEntropies) : 0;

      // Condition comparison for trial-level entropy
      const primeTrialSessions = trialEntropyBySession.filter(s => s.condition === 'prime');
      const neutralTrialSessions = trialEntropyBySession.filter(s => s.condition === 'neutral');

      const primeTrialEntropyMean = primeTrialSessions.length > 0 ?
        primeTrialSessions.reduce((sum, s) => sum + s.avgEntropy, 0) / primeTrialSessions.length : 0;
      const neutralTrialEntropyMean = neutralTrialSessions.length > 0 ?
        neutralTrialSessions.reduce((sum, s) => sum + s.avgEntropy, 0) / neutralTrialSessions.length : 0;

      trialLevelEntropy = {
        available: true,
        sessions: trialEntropyBySession.length,
        totalBlocks: trialEntropyBySession.reduce((sum, s) => sum + s.blocks.length, 0),
        overallMean: trialEntropyMean,
        overallStd: trialEntropyStd,
        overallMin: trialEntropyMin,
        overallMax: trialEntropyMax,
        entropyPerformanceCorr: overallEntropyPerformanceCorr,
        primeConditionMean: primeTrialEntropyMean,
        neutralConditionMean: neutralTrialEntropyMean,
        conditionDifference: primeTrialEntropyMean - neutralTrialEntropyMean,
        sessionData: trialEntropyBySession
      };
    } else {
      trialLevelEntropy = { available: false };
    }

    return {
      totalWindows: entropyValues.length,
      totalSessions: entropyBySession.length,
      mean,
      std,
      min,
      max,
      histogram,
      earlyHistogram,
      lateHistogram,
      subjectHistogram,
      demonHistogram,
      auditHistogram,
      subjectCount: subjectWindows.length,
      demonCount: demonWindows.length,
      auditCount: auditWindows.length,
      binWidth,
      binStart: min,
      primeMean,
      neutralMean,
      conditionDiff: primeMean - neutralMean,
      entropyBySession,
      trialLevelEntropy, // Trial-level entropy analysis
      h1_entropySuppressionTest, // TEST 1: Subject vs Ghost paired t-test
      h2_autocorrResults, // TEST 2: Window autocorrelation (per session)
      h2_overallAutocorr // TEST 2: Aggregated autocorrelation stats
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

      {/* H1: Entropy Suppression Test (Subject vs Ghost Paired t-test) */}
      {entropyMetrics.h1_entropySuppressionTest && (
        <div style={{ marginTop: 24, padding: 20, border: '2px solid #dc2626', borderRadius: 8, background: '#fef2f2' }}>
          <h4 style={{ marginBottom: 12, color: '#dc2626', fontWeight: 'bold' }}>
            H1: Entropy Suppression Test (Subject vs Ghost)
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>Sessions (n)</div>
              <div style={{ fontSize: 18, fontWeight: 'bold' }}>{entropyMetrics.h1_entropySuppressionTest.n}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>Mean Diff (Subj - Ghost)</div>
              <div style={{ fontSize: 18, fontWeight: 'bold' }}>
                {entropyMetrics.h1_entropySuppressionTest.meanDiff.toFixed(6)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>t-statistic</div>
              <div style={{ fontSize: 18, fontWeight: 'bold' }}>
                {entropyMetrics.h1_entropySuppressionTest.t.toFixed(3)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>p-value</div>
              <div style={{ fontSize: 18, fontWeight: 'bold', color: entropyMetrics.h1_entropySuppressionTest.significant ? '#dc2626' : '#374151' }}>
                {entropyMetrics.h1_entropySuppressionTest.p.toFixed(4)}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 12, padding: 12, background: '#fff', borderRadius: 4, fontSize: 13 }}>
            <strong>Result:</strong> {entropyMetrics.h1_entropySuppressionTest.interpretation}
            {entropyMetrics.h1_entropySuppressionTest.significant && ' (p < 0.05)'}
          </div>
        </div>
      )}

      {/* H2: Entropy Window Autocorrelation Test */}
      {entropyMetrics.h2_overallAutocorr && (
        <div style={{ marginTop: 24, padding: 20, border: '2px solid #2563eb', borderRadius: 8, background: '#eff6ff' }}>
          <h4 style={{ marginBottom: 12, color: '#2563eb', fontWeight: 'bold' }}>
            H2: Entropy Window Autocorrelation (Lag-1 with Permutation Test)
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>Sessions Analyzed</div>
              <div style={{ fontSize: 18, fontWeight: 'bold' }}>{entropyMetrics.h2_overallAutocorr.sessions}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>Mean r (Lag-1)</div>
              <div style={{ fontSize: 18, fontWeight: 'bold' }}>
                {entropyMetrics.h2_overallAutocorr.meanR.toFixed(4)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>Significant Sessions</div>
              <div style={{ fontSize: 18, fontWeight: 'bold', color: entropyMetrics.h2_overallAutocorr.significantSessions > 0 ? '#2563eb' : '#374151' }}>
                {entropyMetrics.h2_overallAutocorr.significantSessions} / {entropyMetrics.h2_overallAutocorr.sessions}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 12, padding: 12, background: '#fff', borderRadius: 4, fontSize: 13 }}>
            <strong>Result:</strong> {entropyMetrics.h2_overallAutocorr.interpretation}
          </div>
        </div>
      )}

      {/* Trial-Level Entropy Analysis */}
      {entropyMetrics.trialLevelEntropy && entropyMetrics.trialLevelEntropy.available && (
        <div style={{ marginTop: 32, padding: 20, border: '2px solid #7c3aed', borderRadius: 8, background: '#faf5ff' }}>
          <h4 style={{ marginBottom: 16, color: '#7c3aed', fontWeight: 'bold' }}>
            Trial-Level Entropy Analysis ({entropyMetrics.trialLevelEntropy.totalBlocks} blocks across {entropyMetrics.trialLevelEntropy.sessions} sessions)
          </h4>

          {/* Trial-Level Entropy Statistics */}
          <div style={{ marginBottom: 20 }}>
            <h5 style={{ marginBottom: 12, color: '#374151' }}>Trial-Level Entropy Statistics</h5>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16 }}>
              <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Mean Entropy</div>
                <div style={{ fontSize: 18, fontWeight: 'bold', color: '#374151' }}>
                  {entropyMetrics.trialLevelEntropy.overallMean.toFixed(4)}
                </div>
              </div>
              <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Std Deviation</div>
                <div style={{ fontSize: 18, fontWeight: 'bold', color: '#374151' }}>
                  {entropyMetrics.trialLevelEntropy.overallStd.toFixed(4)}
                </div>
              </div>
              <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Range</div>
                <div style={{ fontSize: 16, fontWeight: 'bold', color: '#374151' }}>
                  {entropyMetrics.trialLevelEntropy.overallMin.toFixed(3)} - {entropyMetrics.trialLevelEntropy.overallMax.toFixed(3)}
                </div>
              </div>
              <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Entropy-Performance Correlation</div>
                <div style={{ fontSize: 18, fontWeight: 'bold', color: Math.abs(entropyMetrics.trialLevelEntropy.entropyPerformanceCorr) > 0.1 ? '#7c3aed' : '#374151' }}>
                  r = {entropyMetrics.trialLevelEntropy.entropyPerformanceCorr.toFixed(4)}
                </div>
                <div style={{ fontSize: 10, color: '#6b7280' }}>
                  High entropy → Performance?
                </div>
              </div>
            </div>
          </div>

          <div style={{ fontSize: 11, color: '#6b7280', fontStyle: 'italic' }}>
            Entropy-Performance Correlation measures the relationship between Shannon entropy (randomness) and hit rate. A negative correlation (r &lt; 0) means higher entropy (more random) leads to lower performance, while positive correlation (r &gt; 0) means higher entropy leads to higher performance. If consciousness organizes quantum bits, we'd expect negative correlation: lower entropy (more ordered) should correlate with better performance.
          </div>
        </div>
      )}

      {entropyMetrics.trialLevelEntropy && !entropyMetrics.trialLevelEntropy.available && (
        <div style={{ marginTop: 20, padding: 16, border: '1px solid #f59e0b', borderRadius: 8, background: '#fefbf3' }}>
          <div style={{ fontSize: 14, color: '#92400e', fontWeight: 'bold' }}>
            Trial-Level Entropy Analysis Unavailable
          </div>
          <div style={{ fontSize: 12, color: '#92400e', marginTop: 4 }}>
            Trial-level quantum bit data not found. Using aggregated entropy windows only.
          </div>
        </div>
      )}

      <h4 style={{ marginBottom: 12, color: '#374151' }}>Entropy Distribution Histogram</h4>
      {entropyMetrics.earlyHistogram && entropyMetrics.lateHistogram && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 16, height: 16, background: '#3b82f6', opacity: 0.8 }}></div>
            <span>Early entropy windows</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 16, height: 16, background: '#f97316', opacity: 0.8 }}></div>
            <span>Late entropy windows</span>
          </div>
        </div>
      )}
      <EntropyHistogram metrics={entropyMetrics} />

      {/* Separate histograms for Subject, Demon, and Audit */}
      {entropyMetrics.subjectHistogram && entropyMetrics.demonHistogram && (
        <div style={{ marginTop: 40 }}>
          <h4 style={{ marginBottom: 16, color: '#374151' }}>Entropy by Condition</h4>

          <div style={{ display: 'flex', gap: 16, marginBottom: 24, fontSize: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 16, height: 16, background: '#3b82f6', opacity: 0.8 }}></div>
              <span>Subject (focus, n={entropyMetrics.subjectCount})</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 16, height: 16, background: '#f97316', opacity: 0.8 }}></div>
              <span>Demon (control, n={entropyMetrics.demonCount})</span>
            </div>
            {entropyMetrics.auditCount > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 16, height: 16, background: '#10b981', opacity: 0.8 }}></div>
                <span>Audit (baseline, n={entropyMetrics.auditCount})</span>
              </div>
            )}
          </div>

          <ConditionEntropyHistogram metrics={entropyMetrics} />
        </div>
      )}
    </div>
  );
}

// Condition-specific histogram component (Subject vs Demon vs Audit)
function ConditionEntropyHistogram({ metrics }) {
  const maxCount = Math.max(
    ...metrics.subjectHistogram,
    ...metrics.demonHistogram,
    ...(metrics.auditHistogram || [])
  );
  const chartWidth = 600;
  const chartHeight = 200;
  const barWidth = (chartWidth - 100) / metrics.subjectHistogram.length;

  return (
    <div style={{ marginTop: 16 }}>
      <svg width={chartWidth} height={chartHeight} style={{ border: '1px solid #e5e7eb', borderRadius: 6, background: '#fff' }}>
        {/* X-axis */}
        <line x1={50} y1={160} x2={chartWidth - 10} y2={160} stroke="#374151" strokeWidth={1} />
        {/* Y-axis */}
        <line x1={50} y1={20} x2={50} y2={160} stroke="#374151" strokeWidth={1} />

        {/* Axis labels */}
        <text x={25} y={25} fontSize={10} fill="#6b7280" textAnchor="middle" transform="rotate(-90, 25, 25)">
          Count
        </text>
        <text x={chartWidth / 2} y={190} fontSize={12} fill="#374151" textAnchor="middle">
          Shannon Entropy
        </text>

        {/* Bars - three overlapping histograms */}
        {metrics.subjectHistogram.map((count, i) => {
          const x = 50 + i * barWidth;
          const subjectHeight = maxCount > 0 ? (count / maxCount) * 140 : 0;
          const demonHeight = maxCount > 0 ? (metrics.demonHistogram[i] / maxCount) * 140 : 0;
          const auditHeight = maxCount > 0 && metrics.auditHistogram ? (metrics.auditHistogram[i] / maxCount) * 140 : 0;

          return (
            <g key={i}>
              {/* Subject (blue, back layer) */}
              <rect
                x={x}
                y={160 - subjectHeight}
                width={barWidth * 0.9}
                height={subjectHeight}
                fill="#3b82f6"
                opacity={0.6}
              />
              {/* Demon (orange, middle layer) */}
              <rect
                x={x}
                y={160 - demonHeight}
                width={barWidth * 0.9}
                height={demonHeight}
                fill="#f97316"
                opacity={0.6}
              />
              {/* Audit (green, front layer) */}
              {metrics.auditHistogram && auditHeight > 0 && (
                <rect
                  x={x}
                  y={160 - auditHeight}
                  width={barWidth * 0.9}
                  height={auditHeight}
                  fill="#10b981"
                  opacity={0.6}
                />
              )}
            </g>
          );
        })}

        {/* X-axis tick labels */}
        {[0, metrics.subjectHistogram.length - 1].map(i => {
          const x = 50 + i * barWidth + barWidth / 2;
          const entropyValue = metrics.binStart + i * metrics.binWidth;
          return (
            <text key={i} x={x} y={175} fontSize={10} fill="#6b7280" textAnchor="middle">
              {entropyValue.toFixed(2)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

// Enhanced histogram component with temporal visualization
function EntropyHistogram({ metrics }) {
  const maxCount = Math.max(
    ...metrics.histogram,
    ...(metrics.earlyHistogram || []),
    ...(metrics.lateHistogram || [])
  );
  const chartWidth = 600;
  const chartHeight = 200;
  const barWidth = (chartWidth - 100) / metrics.histogram.length;
  const hasTemporalData = metrics.earlyHistogram && metrics.lateHistogram &&
    (metrics.earlyHistogram.some(v => v > 0) || metrics.lateHistogram.some(v => v > 0));

  console.log('🔍 HISTOGRAM DEBUG:', {
    histogramArray: metrics.histogram,
    earlyHistogram: metrics.earlyHistogram,
    lateHistogram: metrics.lateHistogram,
    maxCount,
    totalWindows: metrics.totalWindows,
    histogramSum: metrics.histogram.reduce((a, b) => a + b, 0),
    hasTemporalData
  });

  return (
    <div style={{
      border: '1px solid #e5e7eb',
      borderRadius: 6,
      padding: 16,
      background: '#fff',
      overflowX: 'auto'
    }}>
      <svg width={chartWidth} height={chartHeight} style={{ display: 'block' }}>
        {/* Bars - either combined or temporal split */}
        {hasTemporalData ? (
          // Render early/late bars side by side
          metrics.earlyHistogram.map((earlyCount, i) => {
            const lateCount = metrics.lateHistogram[i];
            const earlyHeight = maxCount > 0 ? (earlyCount / maxCount) * 140 : 0;
            const lateHeight = maxCount > 0 ? (lateCount / maxCount) * 140 : 0;
            const x = 50 + i * barWidth;
            const halfBarWidth = (barWidth * 0.8) / 2;

            return (
              <g key={i}>
                {/* Early window bar (blue) */}
                <rect
                  x={x}
                  y={160 - earlyHeight}
                  width={halfBarWidth}
                  height={earlyHeight}
                  fill="#3b82f6"
                  opacity={0.8}
                />
                {/* Late window bar (orange) */}
                <rect
                  x={x + halfBarWidth}
                  y={160 - lateHeight}
                  width={halfBarWidth}
                  height={lateHeight}
                  fill="#f97316"
                  opacity={0.8}
                />
              </g>
            );
          })
        ) : (
          // Fallback to combined histogram
          metrics.histogram.map((count, i) => {
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
          })
        )}

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

        {/* X-axis tick marks and labels */}
        {[0, 0.25, 0.5, 0.75, 1.0].map((frac, i) => {
          const binIndex = Math.floor(frac * (metrics.histogram.length - 1));
          const x = 50 + binIndex * barWidth + barWidth / 2;
          const value = metrics.min + (frac * (metrics.max - metrics.min));

          return (
            <g key={i}>
              <line x1={x} y1={160} x2={x} y2={165} stroke="#374151" strokeWidth={1} />
              <text x={x} y={178} fontSize={10} fill="#6b7280" textAnchor="middle">
                {value.toFixed(4)}
              </text>
            </g>
          );
        })}

        {/* Y-axis tick marks and labels */}
        {maxCount > 0 && [0, Math.ceil(maxCount/4), Math.ceil(maxCount/2), Math.ceil(3*maxCount/4), maxCount].map((count, i) => {
          const frac = count / maxCount;
          const y = 160 - (frac * 140);

          return (
            <g key={`y-${i}`}>
              <line x1={45} y1={y} x2={50} y2={y} stroke="#374151" strokeWidth={1} />
              <text x={40} y={y + 3} fontSize={10} fill="#6b7280" textAnchor="end">
                {count}
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
        // Use block-level entropy (150-bit subject blocks)
        const blockEntropySubj = minute.entropy?.block_entropy_subj;

        if (typeof blockEntropySubj === 'number' && !isNaN(blockEntropySubj)) {
          sessionEntropy += blockEntropySubj;
          sessionEntropyWindows++;
        }
      });

      participant.sessions.push({
        sessionId: session.id,
        hitRate: sessionTrials > 0 ? sessionHits / sessionTrials : 0,
        hits: sessionHits,
        trials: sessionTrials,
        avgEntropy: sessionEntropyWindows > 0 ? sessionEntropy / sessionEntropyWindows : 0,
        entropyWindows: sessionEntropyWindows,
        condition: session.prime_condition,
        binaural: session.post_survey?.binaural_beats,
        createdAt: session.createdAt,
      });

      participant.totalHits += sessionHits;
      participant.totalTrials += sessionTrials;
      participant.totalEntropy += sessionEntropy;
      participant.entropyWindows += sessionEntropyWindows;

      if (session.prime_condition) participant.conditions.add(session.prime_condition);
      if (session.post_survey?.binaural_beats) participant.binauralUse.add(session.post_survey?.binaural_beats);
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
function ControlValidations({ sessions, mappingFilter }) {
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
      let sessionMinutes = 0;
      let sessionMissingData = 0;

      (session.minutes || []).forEach(minute => {
        sessionMinutes++;
        totalMinutes++;

        // Demon (control) data - randomly split half
        const demonHits = minute.demon_hits || 0;
        const demonTrials = minute.n || 0;
        sessionGhostHits += demonHits;
        sessionGhostTrials += demonTrials;
        totalGhostHits += demonHits;
        totalGhostTrials += demonTrials;

        // System (control) data if available
        const systemHits = minute.system_hits || 0;
        const systemTrials = minute.n || 0;
        totalSystemHits += systemHits;
        totalSystemTrials += systemTrials;

        // Data quality checks
        if (!minute.hits || !minute.demon_hits || minute.n === 0) {
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

    // Helper functions for normal CDF
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
      const absX = Math.abs(x);

      const t = 1.0 / (1.0 + p * absX);
      const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);

      return sign * y;
    }

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

    // NEW: Trial-level control validation
    let trialLevelValidation = {};

    // Check if trial data is available
    const hasTrialData = sessions.some(session =>
      session.minutes?.some(minute => minute.subjectSequence && minute.subjectSequence.length > 0)
    );

    if (hasTrialData) {
      // Trial-level cross-correlation between subject and ghost
      const crossCorrelations = computeTrialCrossCorrelation(sessions, 0);

      // Trial-level entropy correlation
      const entropyCorrelations = [];
      sessions.forEach(session => {
        session.minutes?.forEach(minute => {
          if (minute.subjectBitSequence && minute.ghostBitSequence &&
              minute.subjectBitSequence.length > 0 && minute.ghostBitSequence.length > 0) {
            const subjectEntropy = shannonEntropy(minute.subjectBitSequence);
            const ghostEntropy = shannonEntropy(minute.ghostBitSequence);
            entropyCorrelations.push({ subject: subjectEntropy, ghost: ghostEntropy });
          }
        });
      });

      // Calculate entropy correlation if we have data
      let entropyCorrelation = 0;
      if (entropyCorrelations.length > 0) {
        const subjectEntropies = entropyCorrelations.map(ec => ec.subject);
        const ghostEntropies = entropyCorrelations.map(ec => ec.ghost);
        entropyCorrelation = computeCrossCorrelation(subjectEntropies, ghostEntropies, 0);
      }

      // Session-level bit pattern independence test (proper pooling to avoid multiple testing)
      const bitIndependenceTests = [];
      const pearsonCorrelations = [];

      // Helper function to calculate Pearson correlation coefficient
      const pearsonCorrelation = (arr1, arr2) => {
        if (arr1.length !== arr2.length || arr1.length < 2) return null;
        const n = arr1.length;
        const sum1 = arr1.reduce((a,b) => a+b, 0);
        const sum2 = arr2.reduce((a,b) => a+b, 0);
        const sum1Sq = arr1.reduce((a,b) => a + b*b, 0);
        const sum2Sq = arr2.reduce((a,b) => a + b*b, 0);
        const pSum = arr1.reduce((a,b,i) => a + b * arr2[i], 0);

        const num = pSum - (sum1 * sum2 / n);
        const den = Math.sqrt((sum1Sq - sum1*sum1/n) * (sum2Sq - sum2*sum2/n));

        return den === 0 ? 0 : num / den;
      };

      // Helper function to calculate chi-square for a contingency table
      const calculateChiSquare = (table, sampleSize) => {
        if (sampleSize < 50) return null; // Need reasonable sample size
        const expectedFreq = sampleSize / 4;
        let chiSquare = 0;
        Object.values(table).forEach(observed => {
          chiSquare += Math.pow(observed - expectedFreq, 2) / expectedFreq;
        });
        // Use proper chi-square CDF with df=1 (2×2 contingency table: (2-1)×(2-1) = 1)
        const pValue = chiSquarePvalue(chiSquare, 1);
        return { chiSquare, pValue };
      };

      sessions.forEach(session => {
        // Pool ALL trials across ALL minutes in this session
        let allSubjectBits = [];
        let allGhostBits = [];

        // Note: Using trial-level bit strategy (odd=alternating, even=independent)

        session.minutes?.forEach(minute => {
          // Filter by mapping type at the block level
          if (mappingFilter === 'ring' && minute.mapping_type !== 'low_entropy') return;
          if (mappingFilter === 'mosaic' && minute.mapping_type !== 'high_entropy') return;

          // Try to use byte data first (new format)
          const subjectBits = minute.trial_data?.subject_bits;
          const demonBits = minute.trial_data?.demon_bits;

          if (subjectBits && demonBits) {
            allSubjectBits.push(...subjectBits);
            allGhostBits.push(...demonBits);
          }
        });

        // Create contingency tables for each test type
        const createContingencyTable = (subjectBits, ghostBits) => {
          const table = { '00': 0, '01': 0, '10': 0, '11': 0 };
          for (let i = 0; i < subjectBits.length; i++) {
            const key = `${subjectBits[i]}${ghostBits[i]}`;
            table[key]++;
          }
          return table;
        };

        // Test 1: All trials pooled across minutes (~2700 trials)
        if (allSubjectBits.length >= 50) {
          const allTable = createContingencyTable(allSubjectBits, allGhostBits);
          const allResults = calculateChiSquare(allTable, allSubjectBits.length);

          if (allResults) {
            bitIndependenceTests.push({
              sessionId: session.id,
              testType: 'all',
              chiSquare: allResults.chiSquare,
              pValue: allResults.pValue,
              trials: allSubjectBits.length,
              significant: allResults.pValue < 0.05,
              contingencyTable: allTable,
              binauralBeats: session.post_survey?.binaural_beats || 'Unknown',
              primeCondition: session.prime_condition || 'unknown'
            });
          }
        }

        // No longer testing odd/even splits - removed for simplicity

        // Calculate Pearson correlation for this session
        if (allSubjectBits.length >= 50) {
          const r = pearsonCorrelation(allSubjectBits, allGhostBits);
          if (r !== null) {
            pearsonCorrelations.push({
              sessionId: session.id,
              r: r,
              trials: allSubjectBits.length,
              binauralBeats: session.post_survey?.binaural_beats || 'Unknown',
              primeCondition: session.prime_condition || 'unknown'
            });
            console.log('📈 PEARSON CORRELATION:', {
              sessionId: session.id,
              r: r.toFixed(4),
              trials: allSubjectBits.length
            });
          }
        }

      });

      // Test audit data independence (if available)
      sessions.forEach(session => {
        if (!session.audits || session.audits.length === 0) return;

        session.audits.forEach(audit => {
          // Audit data should have bits stored - need to split into two halves for independence test
          if (audit.auditBits && audit.auditBits.length >= 100) {
            const auditBitArray = audit.auditBits.split('').map(b => parseInt(b));

            // Split audit bits in half (like subject/demon split)
            const halfLen = Math.floor(auditBitArray.length / 2);
            const firstHalf = auditBitArray.slice(0, halfLen);
            const secondHalf = auditBitArray.slice(halfLen, halfLen * 2);

            // Create contingency table for audit halves
            const auditTable = { '00': 0, '01': 0, '10': 0, '11': 0 };
            for (let i = 0; i < firstHalf.length; i++) {
              const key = `${firstHalf[i]}${secondHalf[i]}`;
              auditTable[key]++;
            }

            const auditResults = calculateChiSquare(auditTable, firstHalf.length);

            if (auditResults) {
              bitIndependenceTests.push({
                sessionId: session.id,
                testType: 'audit',
                chiSquare: auditResults.chiSquare,
                pValue: auditResults.pValue,
                trials: firstHalf.length,
                significant: auditResults.pValue < 0.05,
                contingencyTable: auditTable,
                blockAfter: audit.blockAfter
              });
            }
          }
        });
      });

      trialLevelValidation = {
        available: true,
        crossCorrelation: {
          mean: crossCorrelations.length > 0 ?
            crossCorrelations.reduce((sum, cc) => sum + cc.value, 0) / crossCorrelations.length : 0,
          std: crossCorrelations.length > 0 ?
            Math.sqrt(crossCorrelations.reduce((sum, cc) => sum + Math.pow(cc.value -
              (crossCorrelations.reduce((s, c) => s + c.value, 0) / crossCorrelations.length), 2), 0) /
              crossCorrelations.length) : 0,
          count: crossCorrelations.length,
          sessions: crossCorrelations.length
        },
        entropyCorrelation: {
          correlation: entropyCorrelation,
          pairs: entropyCorrelations.length
        },
        pearsonCorrelation: pearsonCorrelations.length > 0 ? {
          sessions: pearsonCorrelations.length,
          avgR: pearsonCorrelations.reduce((sum, p) => sum + p.r, 0) / pearsonCorrelations.length,
          minR: Math.min(...pearsonCorrelations.map(p => p.r)),
          maxR: Math.max(...pearsonCorrelations.map(p => p.r)),
          bySession: pearsonCorrelations
        } : null,
        bitIndependence: bitIndependenceTests.length > 0 ? {
          // Overall stats for currently displayed filter
          tests: bitIndependenceTests.length,
          avgChiSquare: bitIndependenceTests.reduce((sum, test) => sum + test.chiSquare, 0) / bitIndependenceTests.length,
          avgPValue: bitIndependenceTests.reduce((sum, test) => sum + test.pValue, 0) / bitIndependenceTests.length,
          significantTests: bitIndependenceTests.filter(test => test.significant).length,

          // Breakdown by test type
          byTestType: {
            all: (() => {
              const allTests = bitIndependenceTests.filter(t => t.testType === 'all');
              if (allTests.length === 0) return null;

              // Aggregate contingency tables
              const aggregatedTable = { '00': 0, '01': 0, '10': 0, '11': 0 };
              let totalBits = 0;
              allTests.forEach(test => {
                if (test.contingencyTable) {
                  aggregatedTable['00'] += test.contingencyTable['00'];
                  aggregatedTable['01'] += test.contingencyTable['01'];
                  aggregatedTable['10'] += test.contingencyTable['10'];
                  aggregatedTable['11'] += test.contingencyTable['11'];
                  totalBits += test.trials;
                }
              });

              // Calculate percentages and max deviation
              const expectedPct = 25.0;
              const actualPcts = {
                '00': (aggregatedTable['00'] / totalBits * 100),
                '01': (aggregatedTable['01'] / totalBits * 100),
                '10': (aggregatedTable['10'] / totalBits * 100),
                '11': (aggregatedTable['11'] / totalBits * 100)
              };
              const deviations = {
                '00': actualPcts['00'] - expectedPct,
                '01': actualPcts['01'] - expectedPct,
                '10': actualPcts['10'] - expectedPct,
                '11': actualPcts['11'] - expectedPct
              };
              const maxDeviation = Math.max(
                Math.abs(deviations['00']),
                Math.abs(deviations['01']),
                Math.abs(deviations['10']),
                Math.abs(deviations['11'])
              );

              return {
                tests: allTests.length,
                avgChiSquare: allTests.reduce((sum, test) => sum + test.chiSquare, 0) / allTests.length,
                avgPValue: allTests.reduce((sum, test) => sum + test.pValue, 0) / allTests.length,
                significantTests: allTests.filter(test => test.significant).length,
                significantPct: (allTests.filter(test => test.significant).length / allTests.length * 100).toFixed(1),
                contingencyTable: aggregatedTable,
                actualPcts,
                deviations,
                maxDeviation
              };
            })(),
            audit: (() => {
              const auditTests = bitIndependenceTests.filter(t => t.testType === 'audit');
              if (auditTests.length === 0) return null;

              // Aggregate contingency tables
              const aggregatedTable = { '00': 0, '01': 0, '10': 0, '11': 0 };
              let totalBits = 0;
              auditTests.forEach(test => {
                if (test.contingencyTable) {
                  aggregatedTable['00'] += test.contingencyTable['00'];
                  aggregatedTable['01'] += test.contingencyTable['01'];
                  aggregatedTable['10'] += test.contingencyTable['10'];
                  aggregatedTable['11'] += test.contingencyTable['11'];
                  totalBits += test.trials;
                }
              });

              // Calculate percentages and max deviation
              const expectedPct = 25.0;
              const actualPcts = {
                '00': (aggregatedTable['00'] / totalBits * 100),
                '01': (aggregatedTable['01'] / totalBits * 100),
                '10': (aggregatedTable['10'] / totalBits * 100),
                '11': (aggregatedTable['11'] / totalBits * 100)
              };
              const deviations = {
                '00': actualPcts['00'] - expectedPct,
                '01': actualPcts['01'] - expectedPct,
                '10': actualPcts['10'] - expectedPct,
                '11': actualPcts['11'] - expectedPct
              };
              const maxDeviation = Math.max(
                Math.abs(deviations['00']),
                Math.abs(deviations['01']),
                Math.abs(deviations['10']),
                Math.abs(deviations['11'])
              );

              return {
                tests: auditTests.length,
                avgChiSquare: auditTests.reduce((sum, test) => sum + test.chiSquare, 0) / auditTests.length,
                avgPValue: auditTests.reduce((sum, test) => sum + test.pValue, 0) / auditTests.length,
                significantTests: auditTests.filter(test => test.significant).length,
                significantPct: (auditTests.filter(test => test.significant).length / auditTests.length * 100).toFixed(1),
                contingencyTable: aggregatedTable,
                actualPcts,
                deviations,
                maxDeviation
              };
            })()
          },
          significantPct: (bitIndependenceTests.filter(test => test.significant).length / bitIndependenceTests.length) * 100
        } : null
      };
    } else {
      trialLevelValidation = { available: false };
    }

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
      trialLevelValidation // NEW: Include trial-level validation metrics
    };
  }, [sessions, mappingFilter]);

  return (
    <div>
      <h3 style={{ marginBottom: 16, color: '#374151' }}>System Health Metrics</h3>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa' }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Demon Hit Rate</div>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: '#374151' }}>
            {controlMetrics.overallGhostRate != null ? (controlMetrics.overallGhostRate * 100).toFixed(2) : 'N/A'}%
          </div>
          <div style={{ fontSize: 10, color: '#6b7280' }}>
            Expected: 50.00%
          </div>
        </div>

        <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa' }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Data Completion</div>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: (controlMetrics.dataCompletionRate || 0) > 0.95 ? '#059669' : '#dc2626' }}>
            {controlMetrics.dataCompletionRate != null ? (controlMetrics.dataCompletionRate * 100).toFixed(1) : 'N/A'}%
          </div>
        </div>

        <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fafafa' }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Avg Health Score</div>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: (controlMetrics.avgHealthScore || 0) > 0.8 ? '#059669' : '#dc2626' }}>
            {controlMetrics.avgHealthScore != null ? controlMetrics.avgHealthScore.toFixed(3) : 'N/A'}
          </div>
        </div>

        <PBadge
          label="Demon vs Chance (50%)"
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
          Critical ratio measures subject deviation relative to demon deviation from chance.
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
                Demon Rate
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

      {/* NEW: Trial-Level Control Validation */}
      {controlMetrics.trialLevelValidation && controlMetrics.trialLevelValidation.available && (
        <div style={{ marginTop: 32, padding: 20, border: '2px solid #0369a1', borderRadius: 8, background: '#eff6ff' }}>
          <h4 style={{ marginBottom: 16, color: '#0369a1', fontWeight: 'bold' }}>
            Trial-Level Control Validation
          </h4>

          {/* Subject-Ghost Cross-Correlation */}
          <div style={{ marginBottom: 20 }}>
            <h5 style={{ marginBottom: 12, color: '#374151' }}>Subject-Ghost Independence Test</h5>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
              <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Cross-Correlation</div>
                <div style={{ fontSize: 18, fontWeight: 'bold', color: Math.abs(controlMetrics.trialLevelValidation.crossCorrelation.mean) < 0.1 ? '#059669' : '#dc2626' }}>
                  r = {controlMetrics.trialLevelValidation.crossCorrelation.mean.toFixed(4)}
                </div>
                <div style={{ fontSize: 10, color: '#6b7280' }}>
                  Close to 0 = Independent
                </div>
              </div>
              <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Standard Error</div>
                <div style={{ fontSize: 18, fontWeight: 'bold', color: '#374151' }}>
                  {controlMetrics.trialLevelValidation.crossCorrelation.std.toFixed(4)}
                </div>
              </div>
              <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Sessions</div>
                <div style={{ fontSize: 18, fontWeight: 'bold', color: '#374151' }}>
                  {controlMetrics.trialLevelValidation.crossCorrelation.sessions}
                </div>
              </div>
            </div>
          </div>

          {/* Entropy Correlation */}
          <div style={{ marginBottom: 20 }}>
            <h5 style={{ marginBottom: 12, color: '#374151' }}>Quantum Entropy Independence</h5>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Entropy Correlation</div>
                <div style={{ fontSize: 18, fontWeight: 'bold', color: Math.abs(controlMetrics.trialLevelValidation.entropyCorrelation.correlation) < 0.1 ? '#059669' : '#dc2626' }}>
                  r = {controlMetrics.trialLevelValidation.entropyCorrelation.correlation.toFixed(4)}
                </div>
                <div style={{ fontSize: 10, color: '#6b7280' }}>
                  Low correlation = Independent halves
                </div>
              </div>
              <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Block Pairs</div>
                <div style={{ fontSize: 18, fontWeight: 'bold', color: '#374151' }}>
                  {controlMetrics.trialLevelValidation.entropyCorrelation.pairs}
                </div>
              </div>
            </div>
          </div>

          {/* Pearson Correlation */}
          {controlMetrics.trialLevelValidation.pearsonCorrelation && (
            <div style={{ marginBottom: 20 }}>
              <h5 style={{ marginBottom: 12, color: '#374151' }}>Pearson Correlation (Subject-Ghost Bits)</h5>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16 }}>
                <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Average r</div>
                  <div style={{ fontSize: 18, fontWeight: 'bold', color: Math.abs(controlMetrics.trialLevelValidation.pearsonCorrelation.avgR) < 0.1 ? '#059669' : '#dc2626' }}>
                    {controlMetrics.trialLevelValidation.pearsonCorrelation.avgR.toFixed(4)}
                  </div>
                  <div style={{ fontSize: 10, color: '#6b7280' }}>
                    r ≈ 0 = Independent
                  </div>
                </div>
                <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Min r</div>
                  <div style={{ fontSize: 18, fontWeight: 'bold', color: '#374151' }}>
                    {controlMetrics.trialLevelValidation.pearsonCorrelation.minR.toFixed(4)}
                  </div>
                </div>
                <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Max r</div>
                  <div style={{ fontSize: 18, fontWeight: 'bold', color: '#374151' }}>
                    {controlMetrics.trialLevelValidation.pearsonCorrelation.maxR.toFixed(4)}
                  </div>
                </div>
                <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Sessions</div>
                  <div style={{ fontSize: 18, fontWeight: 'bold', color: '#374151' }}>
                    {controlMetrics.trialLevelValidation.pearsonCorrelation.sessions}
                  </div>
                </div>
              </div>

              {/* Per-session details */}
              <div style={{ marginTop: 12, fontSize: 12 }}>
                <details>
                  <summary style={{ cursor: 'pointer', color: '#0369a1', fontWeight: 'bold' }}>
                    View r values per session
                  </summary>
                  <div style={{ marginTop: 8, padding: 12, background: '#f9fafb', borderRadius: 6 }}>
                    {controlMetrics.trialLevelValidation.pearsonCorrelation.bySession.map(session => (
                      <div key={session.sessionId} style={{ padding: 4, borderBottom: '1px solid #e5e7eb' }}>
                        <span style={{ fontWeight: 'bold' }}>{session.sessionId}:</span> r = {session.r.toFixed(4)} ({session.trials} trials)
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            </div>
          )}

          {/* Bit Independence Tests */}
          {controlMetrics.trialLevelValidation.bitIndependence && (
            <div style={{ marginBottom: 20 }}>
              <h5 style={{ marginBottom: 12, color: '#374151' }}>Bit-Level Independence (Chi-Square Tests)</h5>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16 }}>
                <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Tests Performed</div>
                  <div style={{ fontSize: 18, fontWeight: 'bold', color: '#374151' }}>
                    {controlMetrics.trialLevelValidation.bitIndependence.tests}
                  </div>
                </div>
                <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Avg Chi-Square</div>
                  <div style={{ fontSize: 18, fontWeight: 'bold', color: '#374151' }}>
                    {controlMetrics.trialLevelValidation.bitIndependence.avgChiSquare.toFixed(3)}
                  </div>
                </div>
                <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Avg P-Value</div>
                  <div style={{ fontSize: 18, fontWeight: 'bold', color: '#374151' }}>
                    {controlMetrics.trialLevelValidation.bitIndependence.avgPValue.toFixed(4)}
                  </div>
                </div>
                <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Significant Tests</div>
                  <div style={{ fontSize: 18, fontWeight: 'bold', color: controlMetrics.trialLevelValidation.bitIndependence.significantPct < 10 ? '#059669' : '#dc2626' }}>
                    {controlMetrics.trialLevelValidation.bitIndependence.significantPct.toFixed(1)}%
                  </div>
                  <div style={{ fontSize: 10, color: '#6b7280' }}>
                    (&lt;5% expected by chance)
                  </div>
                </div>
              </div>

              {/* Test Type Breakdown */}
              <div style={{ marginTop: 16 }}>
                <h6 style={{ marginBottom: 12, color: '#374151', fontSize: 14 }}>Breakdown by Data Source</h6>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>

                  {/* Subject-Demon Tests */}
                  {controlMetrics.trialLevelValidation.bitIndependence.byTestType.all && (
                    <div style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 6, background: '#eff6ff' }}>
                      <div style={{ fontSize: 12, fontWeight: 'bold', color: '#374151', marginBottom: 8 }}>Subject-Demon Independence</div>
                      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>
                        Tests: {controlMetrics.trialLevelValidation.bitIndependence.byTestType.all.tests}
                      </div>
                      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>
                        Avg χ²: {controlMetrics.trialLevelValidation.bitIndependence.byTestType.all.avgChiSquare.toFixed(3)}
                      </div>
                      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>
                        Avg p: {controlMetrics.trialLevelValidation.bitIndependence.byTestType.all.avgPValue.toFixed(4)}
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 'bold', color: controlMetrics.trialLevelValidation.bitIndependence.byTestType.all.significantPct < 10 ? '#059669' : '#dc2626' }}>
                        {controlMetrics.trialLevelValidation.bitIndependence.byTestType.all.significantPct}% significant
                      </div>
                      {controlMetrics.trialLevelValidation.bitIndependence.byTestType.all.maxDeviation !== undefined && (
                        <div style={{ fontSize: 14, fontWeight: 'bold', marginTop: 4, color: controlMetrics.trialLevelValidation.bitIndependence.byTestType.all.maxDeviation >= 2.0 ? '#dc2626' : '#059669' }}>
                          Effect size: {controlMetrics.trialLevelValidation.bitIndependence.byTestType.all.maxDeviation.toFixed(2)}%
                        </div>
                      )}
                    </div>
                  )}

                  {/* Audit Tests */}
                  {controlMetrics.trialLevelValidation.bitIndependence.byTestType.audit ? (
                    <div style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 6, background: '#f0fdf4' }}>
                      <div style={{ fontSize: 12, fontWeight: 'bold', color: '#374151', marginBottom: 8 }}>Audit Baseline Independence</div>
                      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>
                        Tests: {controlMetrics.trialLevelValidation.bitIndependence.byTestType.audit.tests}
                      </div>
                      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>
                        Avg χ²: {controlMetrics.trialLevelValidation.bitIndependence.byTestType.audit.avgChiSquare.toFixed(3)}
                      </div>
                      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>
                        Avg p: {controlMetrics.trialLevelValidation.bitIndependence.byTestType.audit.avgPValue.toFixed(4)}
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 'bold', color: controlMetrics.trialLevelValidation.bitIndependence.byTestType.audit.significantPct < 10 ? '#059669' : '#dc2626' }}>
                        {controlMetrics.trialLevelValidation.bitIndependence.byTestType.audit.significantPct}% significant
                      </div>
                      {controlMetrics.trialLevelValidation.bitIndependence.byTestType.audit.maxDeviation !== undefined && (
                        <div style={{ fontSize: 14, fontWeight: 'bold', marginTop: 4, color: controlMetrics.trialLevelValidation.bitIndependence.byTestType.audit.maxDeviation >= 2.0 ? '#dc2626' : '#059669' }}>
                          Effect size: {controlMetrics.trialLevelValidation.bitIndependence.byTestType.audit.maxDeviation.toFixed(2)}%
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 6, background: '#fafafa' }}>
                      <div style={{ fontSize: 12, fontWeight: 'bold', color: '#6b7280', marginBottom: 8 }}>Audit Baseline Independence</div>
                      <div style={{ fontSize: 11, color: '#9ca3af', fontStyle: 'italic' }}>
                        No audit data available yet. Audits run every 5 blocks.
                      </div>
                    </div>
                  )}

                </div>
                <div style={{ fontSize: 10, color: '#6b7280', marginTop: 8, fontStyle: 'italic' }}>
                  Subject-Demon tests validate independence between the randomly split halves (150 subject + 150 demon). Audit tests validate independence of baseline QRNG fetches (1500 bits every 5 blocks, split in half for testing).
                </div>
              </div>
            </div>
          )}

          <div style={{ fontSize: 11, color: '#6b7280', fontStyle: 'italic' }}>
            Trial-level validation uses raw quantum trial data. Each block fetches 300 bits and randomly assigns first/second half to subject/demon.
            Low correlations and chi-square results near chance levels indicate proper experimental controls.
          </div>
        </div>
      )}

      {controlMetrics.trialLevelValidation && !controlMetrics.trialLevelValidation.available && (
        <div style={{ marginTop: 20, padding: 16, border: '1px solid #f59e0b', borderRadius: 8, background: '#fefbf3' }}>
          <div style={{ fontSize: 14, color: '#92400e', fontWeight: 'bold' }}>
            Trial-Level Validation Unavailable
          </div>
          <div style={{ fontSize: 12, color: '#92400e', marginTop: 4 }}>
            Trial-level data not found. Using block-level validation only.
          </div>
        </div>
      )}
    </div>
  );
}

// Exploratory Signatures Component (placeholder for advanced oscillation analysis)
// Exploratory Signatures Component - Advanced pattern detection including harmonic oscillations
function ExploratorySignatures({ sessions }) {
  // Temporal entropy windowing analysis (k=2 and k=3)
  const temporalEntropyAnalysis = useMemo(() => {
    return analyzeTemporalEntropy(sessions);
  }, [sessions]);

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
          const meanEntropy = windows.reduce((sum, w) => {
            if (typeof w === 'number') return sum + w;
            return sum + (w.entropy || 0);
          }, 0) / windows.length;
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
    // Use Hann window for long time series to suppress leakage
    const spectralAnalysis = performSpectralAnalysis(hitRateTimeSeries, { useWindow: true });
    const harmonicAnalysis = detectHarmonicOscillations(hitRateTimeSeries);
    const entropySpectral = entropyTimeSeries.length > 0 ?
      performSpectralAnalysis(entropyTimeSeries, { useWindow: true }) : null;

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
              Peak Frequency: {exploratoryMetrics.spectralAnalysis.peakFrequency.frequency.toFixed(4)} cycles/min (Power: {exploratoryMetrics.spectralAnalysis.peakFrequency.power.toFixed(3)})
            </div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>
              Total Power: {exploratoryMetrics.spectralAnalysis.totalPower.toFixed(3)}
            </div>
          </div>
          {exploratoryMetrics.entropySpectral && (
            <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
              <div style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 8 }}>Entropy Spectrum</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
                Peak Frequency: {exploratoryMetrics.entropySpectral.peakFrequency.frequency.toFixed(4)} cycles/min (Power: {exploratoryMetrics.entropySpectral.peakFrequency.power.toFixed(3)})
              </div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                Total Power: {exploratoryMetrics.entropySpectral.totalPower.toFixed(3)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Temporal Entropy Windowing Analysis */}
      {temporalEntropyAnalysis.k2_available > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ marginBottom: 8, color: '#111827', borderBottom: '2px solid #3b82f6', paddingBottom: 8 }}>
            Temporal Entropy Windowing Analysis (Exploratory)
          </h3>
          <div style={{ fontSize: 13, color: '#dc2626', marginBottom: 16, padding: 8, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 4 }}>
            ⚠️ <strong>Exploratory analysis:</strong> Temporal entropy patterns are analyzed for hypothesis generation. These tests include Bonferroni corrections for within-analysis comparisons (e.g., early vs middle vs late), but the overall temporal entropy investigation is exploratory. See PRIMARY ANALYSIS for confirmatory Human vs AI vs Baseline comparisons.
          </div>

          {/* K=2 Primary Analysis */}
          {temporalEntropyAnalysis.k2_pairedTest && (
            <div style={{ marginBottom: 24 }}>
              <h4 style={{ marginBottom: 12, color: '#374151' }}>
                Primary Test: First vs Second Half (k=2)
              </h4>
              <div style={{
                padding: 16,
                border: '2px solid #3b82f6',
                borderRadius: 8,
                background: temporalEntropyAnalysis.k2_pairedTest.significant ? '#eff6ff' : '#fff'
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Sessions</div>
                    <div style={{ fontSize: 20, fontWeight: 'bold', color: '#111827' }}>
                      {temporalEntropyAnalysis.k2_pairedTest.n}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Mean Difference</div>
                    <div style={{ fontSize: 20, fontWeight: 'bold', color: temporalEntropyAnalysis.k2_pairedTest.meanDifference > 0 ? '#059669' : '#dc2626' }}>
                      {temporalEntropyAnalysis.k2_pairedTest.meanDifference > 0 ? '+' : ''}{temporalEntropyAnalysis.k2_pairedTest.meanDifference.toFixed(4)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>t-statistic</div>
                    <div style={{ fontSize: 20, fontWeight: 'bold', color: '#111827' }}>
                      {temporalEntropyAnalysis.k2_pairedTest.tStatistic.toFixed(3)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>p-value (t-test)</div>
                    <div style={{ fontSize: 20, fontWeight: 'bold', color: temporalEntropyAnalysis.k2_pairedTest.significant ? '#059669' : '#6b7280' }}>
                      {temporalEntropyAnalysis.k2_pairedTest.pValue.toFixed(4)}
                      {temporalEntropyAnalysis.k2_pairedTest.significant && ' *'}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>p-value (perm)</div>
                    <div style={{ fontSize: 20, fontWeight: 'bold', color: temporalEntropyAnalysis.k2_pairedTest.permutationPValue < 0.05 ? '#059669' : '#6b7280' }}>
                      {temporalEntropyAnalysis.k2_pairedTest.permutationPValue.toFixed(4)}
                      {temporalEntropyAnalysis.k2_pairedTest.permutationPValue < 0.05 && ' *'}
                    </div>
                  </div>
                </div>
                <div style={{ padding: 12, background: '#f9fafb', borderRadius: 6, marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
                    95% Bootstrap CI
                  </div>
                  <div style={{ fontSize: 14, color: '#111827' }}>
                    [{temporalEntropyAnalysis.k2_pairedTest.ci95_lower.toFixed(4)}, {temporalEntropyAnalysis.k2_pairedTest.ci95_upper.toFixed(4)}]
                  </div>
                </div>
                <div style={{ fontSize: 12, color: '#6b7280', fontStyle: 'italic', marginBottom: 12 }}>
                  Permutation test: 10,000 random sign flips for robustness check
                </div>
                <div style={{ fontSize: 13, color: '#6b7280', fontStyle: 'italic' }}>
                  {temporalEntropyAnalysis.k2_pairedTest.interpretation}
                </div>
              </div>
            </div>
          )}

          {/* K=3 Exploratory Analysis */}
          {temporalEntropyAnalysis.k3_temporalProgression && (
            <div style={{ marginBottom: 24 }}>
              <h4 style={{ marginBottom: 12, color: '#374151' }}>
                Exploratory Test: Temporal Progression (k=3)
              </h4>

              {/* Mean values for early/mid/late */}
              <div style={{
                padding: 16,
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                background: '#fff',
                marginBottom: 16
              }}>
                <div style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 12, color: '#374151' }}>
                  Window Means (n={temporalEntropyAnalysis.k3_temporalProgression.n})
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
                  <div style={{ padding: 12, background: '#f9fafb', borderRadius: 6 }}>
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Early</div>
                    <div style={{ fontSize: 18, fontWeight: 'bold', color: '#111827' }}>
                      {temporalEntropyAnalysis.k3_temporalProgression.means.early.toFixed(4)}
                    </div>
                  </div>
                  <div style={{ padding: 12, background: '#f9fafb', borderRadius: 6 }}>
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Middle</div>
                    <div style={{ fontSize: 18, fontWeight: 'bold', color: '#111827' }}>
                      {temporalEntropyAnalysis.k3_temporalProgression.means.middle.toFixed(4)}
                    </div>
                  </div>
                  <div style={{ padding: 12, background: '#f9fafb', borderRadius: 6 }}>
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Late</div>
                    <div style={{ fontSize: 18, fontWeight: 'bold', color: '#111827' }}>
                      {temporalEntropyAnalysis.k3_temporalProgression.means.late.toFixed(4)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Linear trend test */}
              <div style={{
                padding: 16,
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                background: temporalEntropyAnalysis.k3_temporalProgression.linearTrend.significant ? '#fef3c7' : '#fff',
                marginBottom: 16
              }}>
                <div style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 12, color: '#374151' }}>
                  Linear Trend Test
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>t-statistic</div>
                    <div style={{ fontSize: 18, fontWeight: 'bold', color: '#111827' }}>
                      {temporalEntropyAnalysis.k3_temporalProgression.linearTrend.tStatistic.toFixed(3)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>p-value</div>
                    <div style={{ fontSize: 18, fontWeight: 'bold', color: temporalEntropyAnalysis.k3_temporalProgression.linearTrend.significant ? '#059669' : '#6b7280' }}>
                      {temporalEntropyAnalysis.k3_temporalProgression.linearTrend.pValue.toFixed(4)}
                      {temporalEntropyAnalysis.k3_temporalProgression.linearTrend.significant && ' *'}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>df</div>
                    <div style={{ fontSize: 18, fontWeight: 'bold', color: '#111827' }}>
                      {temporalEntropyAnalysis.k3_temporalProgression.linearTrend.degreesOfFreedom}
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 13, color: '#6b7280', fontStyle: 'italic' }}>
                  {temporalEntropyAnalysis.k3_temporalProgression.linearTrend.interpretation}
                </div>
              </div>

              {/* Pairwise contrasts with multiple comparison corrections */}
              <div style={{
                padding: 16,
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                background: '#fff'
              }}>
                <div style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 8, color: '#374151' }}>
                  Pairwise Contrasts (Multiple Comparison Corrections)
                </div>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
                  Bonferroni (conservative) and FDR/Benjamini-Hochberg (less conservative)
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {Object.entries(temporalEntropyAnalysis.k3_temporalProgression.pairwiseContrasts).map(([key, contrast]) => (
                    <div
                      key={key}
                      style={{
                        padding: 12,
                        background: contrast.significantFDR ? '#dcfce7' : '#f9fafb',
                        borderRadius: 6,
                        border: contrast.significantFDR ? '1px solid #059669' : '1px solid #e5e7eb'
                      }}
                    >
                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr 1fr', gap: 8, alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>
                            {key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: '#6b7280' }}>Diff</div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: contrast.difference > 0 ? '#059669' : '#dc2626' }}>
                            {contrast.difference > 0 ? '+' : ''}{contrast.difference.toFixed(4)}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: '#6b7280' }}>t-stat</div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>
                            {contrast.tStatistic.toFixed(3)}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: '#6b7280' }}>p (raw)</div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#6b7280' }}>
                            {contrast.pValue.toFixed(4)}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: '#6b7280' }}>p (Bonf)</div>
                          <div style={{ fontSize: 13, fontWeight: 'bold', color: contrast.significantBonferroni ? '#059669' : '#6b7280' }}>
                            {contrast.pBonferroni.toFixed(4)}
                            {contrast.significantBonferroni && ' *'}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: '#6b7280' }}>p (FDR)</div>
                          <div style={{ fontSize: 13, fontWeight: 'bold', color: contrast.significantFDR ? '#059669' : '#6b7280' }}>
                            {contrast.pFDR.toFixed(4)}
                            {contrast.significantFDR && ' *'}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* NEW: Differential Slope Analysis */}
              {temporalEntropyAnalysis.k3_temporalProgression?.differentialSlope && (
                <div style={{
                  padding: 16,
                  border: '2px solid #7c3aed',
                  borderRadius: 8,
                  background: temporalEntropyAnalysis.k3_temporalProgression.differentialSlope.significant
                    ? '#faf5ff' : '#fff',
                  marginTop: 16
                }}>
                  <div style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 12, color: '#374151' }}>
                    Differential Slope Test (Subject vs Ghost)
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
                    Tests whether subject entropy trajectory differs from ghost control
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
                    <div>
                      <div style={{ fontSize: 11, color: '#6b7280' }}>Subject Trend</div>
                      <div style={{ fontSize: 16, fontWeight: 600, color: '#7c3aed' }}>
                        {temporalEntropyAnalysis.k3_temporalProgression.differentialSlope.subjectMeanTrend.toFixed(4)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: '#6b7280' }}>Ghost Trend</div>
                      <div style={{ fontSize: 16, fontWeight: 600, color: '#6b7280' }}>
                        {temporalEntropyAnalysis.k3_temporalProgression.differentialSlope.ghostMeanTrend.toFixed(4)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: '#6b7280' }}>Difference</div>
                      <div style={{ fontSize: 16, fontWeight: 'bold', color: '#111827' }}>
                        {(temporalEntropyAnalysis.k3_temporalProgression.differentialSlope.difference > 0 ? '+' : '')}
                        {temporalEntropyAnalysis.k3_temporalProgression.differentialSlope.difference.toFixed(4)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: '#6b7280' }}>p-value</div>
                      <div style={{ fontSize: 16, fontWeight: 'bold',
                           color: temporalEntropyAnalysis.k3_temporalProgression.differentialSlope.significant
                             ? '#7c3aed' : '#6b7280' }}>
                        {temporalEntropyAnalysis.k3_temporalProgression.differentialSlope.pValue.toFixed(4)}
                        {temporalEntropyAnalysis.k3_temporalProgression.differentialSlope.significant && ' *'}
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: 13, color: '#6b7280', fontStyle: 'italic', marginTop: 12 }}>
                    {temporalEntropyAnalysis.k3_temporalProgression.differentialSlope.interpretation}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
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

function hannWindow(n) {
  const w = [];
  for (let i = 0; i < n; i++) {
    w.push(0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1))));
  }
  return w;
}

function performSpectralAnalysis(data, { useWindow = false, useWelch = false, segmentLength = 128 } = {}) {
  const n = data.length;
  if (n < 4) return { peakFrequency: { frequency: 0, power: 0 }, totalPower: 0, powerSpectrum: [] };

  // Remove DC component
  const mean = data.reduce((a, b) => a + b, 0) / n;
  const centeredData = data.map(x => x - mean);

  if (useWelch) {
    // Welch's method: Split into overlapping segments and average periodograms
    const step = Math.floor(segmentLength / 2); // 50% overlap
    const segments = [];
    for (let start = 0; start + segmentLength <= n; start += step) {
      segments.push(centeredData.slice(start, start + segmentLength));
    }

    if (segments.length === 0) {
      // Fallback to simple periodogram if not enough data for Welch
      useWelch = false;
    } else {
      // Average periodograms across segments
      const accumSpectrum = Array(Math.floor(segmentLength / 2)).fill(0);
      segments.forEach(seg => {
        const window = useWindow ? hannWindow(segmentLength) : Array(segmentLength).fill(1);
        const windowed = seg.map((x, i) => x * window[i]);
        for (let k = 1; k <= segmentLength / 2; k++) {
          let real = 0, imag = 0;
          for (let t = 0; t < segmentLength; t++) {
            const angle = -2 * Math.PI * k * t / segmentLength;
            real += windowed[t] * Math.cos(angle);
            imag += windowed[t] * Math.sin(angle);
          }
          const power = 2 * (real * real + imag * imag) / segmentLength;
          accumSpectrum[k - 1] += power;
        }
      });

      const averaged = accumSpectrum.map(v => v / segments.length);
      const powerSpectrum = averaged.map((p, i) => ({ frequency: (i + 1) / segmentLength, power: p }));
      const totalPower = averaged.reduce((a, b) => a + b, 0);
      const peakPower = Math.max(...averaged);
      const peakIndex = averaged.indexOf(peakPower);

      return {
        peakFrequency: { frequency: (peakIndex + 1) / segmentLength, power: peakPower },
        totalPower,
        powerSpectrum,
        method: 'welch'
      };
    }
  }

  // Simple one-shot periodogram (with optional Hann window)
  const window = useWindow ? hannWindow(n) : Array(n).fill(1);
  const windowed = centeredData.map((x, i) => x * window[i]);
  const powerSpectrum = [];
  const nyquist = Math.floor(n / 2);

  for (let k = 1; k <= nyquist; k++) {
    let real = 0, imag = 0;
    for (let t = 0; t < n; t++) {
      const angle = -2 * Math.PI * k * t / n;
      real += windowed[t] * Math.cos(angle);
      imag += windowed[t] * Math.sin(angle);
    }
    const power = 2 * (real * real + imag * imag) / n;
    powerSpectrum.push({ frequency: k / n, power });
  }

  const totalPower = powerSpectrum.reduce((sum, p) => sum + p.power, 0);
  const peakPower = Math.max(...powerSpectrum.map(p => p.power));
  const peakFreq = powerSpectrum.find(p => p.power === peakPower);

  return {
    peakFrequency: peakFreq || { frequency: 0, power: 0 },
    totalPower,
    powerSpectrum,
    method: useWindow ? 'periodogram-hann' : 'periodogram'
  };
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
    // Use the proper cross-correlation function
    const correlation = computeCrossCorrelation(series1, series2, lag);

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
  const [detailedDataLoaded, setDetailedDataLoaded] = useState(false);
  const [loadingDetailed, setLoadingDetailed] = useState(false);
  const [mode, setMode] = useState('pooled');
  const [binauralFilter, setBinauralFilter] = useState('all');
  const primeFilter = 'all'; // Everyone is primed now - no filter needed
  const [mappingFilter, setMappingFilter] = useState('all');
  const [sessionFilter, setSessionFilter] = useState('all'); // all, first, repeat
  const [sessionTypeFilter, setSessionTypeFilter] = useState('all'); // all, human, ai, auto
  // Removed dataTypeFilter - all data is live now
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

  // Load experiment data (use aggregates-only mode for fast initial load)
  useEffect(() => {
    (async () => {
      try {
        const loadedRuns = await fetchAllRunsWithMinutes(true, true); // includeTrials=true, aggregatesOnly=true
        console.log('QA Dashboard: Loaded runs (aggregates only):', loadedRuns.length, loadedRuns);
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

  // Load detailed data (minutes, audits, commits) for advanced analysis
  const loadDetailedData = async () => {
    if (detailedDataLoaded || loadingDetailed) return;

    setLoadingDetailed(true);
    try {
      const loadedRuns = await fetchAllRunsWithMinutes(true, false); // includeTrials=true, aggregatesOnly=false
      console.log('QA Dashboard: Loaded detailed data for', loadedRuns.length, 'sessions');
      setRuns(loadedRuns);
      setDetailedDataLoaded(true);
    } catch (err) {
      console.error('Failed to load detailed data:', err);
      alert(`Failed to load detailed data: ${err.message}`);
    } finally {
      setLoadingDetailed(false);
    }
  };

  const filteredSessions = useMemo(() => {
    console.log('QA Dashboard: Raw runs data:', runs.length, runs);
    const filtered = filterSessions(runs, mode, binauralFilter, primeFilter, mappingFilter, sessionFilter, sessionTypeFilter);
    console.log('QA Dashboard: Filtered sessions:', filtered.length, filtered);
    console.log('QA Dashboard: Filters:', { mode, binauralFilter, primeFilter, mappingFilter, sessionFilter });

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
  }, [runs, mode, binauralFilter, primeFilter, mappingFilter, sessionFilter, sessionTypeFilter]);

  const stats = useMemo(() => {
    return computeStatistics(filteredSessions, mode, binauralFilter, primeFilter, mappingFilter);
  }, [filteredSessions, mode, binauralFilter, primeFilter, mappingFilter]);

  // PRIMARY ANALYSIS: Session-level comparisons (Human vs AI vs Baseline)
  // This is computed on ALL completed runs (not filtered), as it's the confirmatory analysis
  const primaryAnalysis = useMemo(() => {
    const completedRuns = runs.filter(r => r.exitedEarly === false);
    return computePrimaryAnalysis(completedRuns);
  }, [runs]);

  const summary = useMemo(() => {
    const total = runs.length;
    const completers = runs.filter(r => r.exitedEarly === false).length;
    const nonCompleters = total - completers;

    // Count first vs repeat sessions
    const participantSessions = {};
    runs.forEach(s => {
      const pid = s.participant_id;
      if (!pid) return;
      if (!participantSessions[pid]) {
        participantSessions[pid] = [];
      }
      participantSessions[pid].push(s);
    });

    const firstSessionIds = new Set();
    Object.values(participantSessions).forEach(pSessions => {
      if (pSessions.length > 0) {
        pSessions.sort((a, b) => {
          const aTime = a.timestamp?.toMillis?.() || a.timestamp || 0;
          const bTime = b.timestamp?.toMillis?.() || b.timestamp || 0;
          return aTime - bTime;
        });
        firstSessionIds.add(pSessions[0].id);
      }
    });

    const firstSessions = runs.filter(r => firstSessionIds.has(r.id)).length;
    const repeatSessions = runs.filter(r => !firstSessionIds.has(r.id) && r.participant_id).length;

    return { total, completers, nonCompleters, firstSessions, repeatSessions };
  }, [runs]);

  // STRATEGIC ABORT ANALYSIS: Calculate abort statistics by mode
  const abortStats = useMemo(() => {
    const stats = {
      human: { total: 0, withAborts: 0, totalAborts: 0, below50: 0, at50: 0, above50: 0 },
      ai_agent: { total: 0, withAborts: 0, totalAborts: 0, below50: 0, at50: 0, above50: 0 },
      baseline: { total: 0, withAborts: 0, totalAborts: 0, below50: 0, at50: 0, above50: 0 }
    };

    runs.forEach(run => {
      const mode = run.mode || run.session_type || 'human';
      const modeKey = mode === 'ai' ? 'ai_agent' : mode;

      if (!stats[modeKey]) return;

      stats[modeKey].total++;

      if (run.abortAnalysis) {
        stats[modeKey].withAborts++;
        stats[modeKey].totalAborts += run.abortAnalysis.abortedCount;

        // Categorize aborted blocks by score
        run.abortAnalysis.abortedBlocks.forEach(block => {
          if (block.score < 50) stats[modeKey].below50++;
          else if (block.score === 50) stats[modeKey].at50++;
          else stats[modeKey].above50++;
        });
      }
    });

    return stats;
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

      {/* Row 3: Mapping type filter */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexWrap: 'wrap',
          marginTop: 8,
        }}
      >
        <span style={{ fontSize: 12, color: '#555' }}>Mapping type:</span>
        {[
          { id: 'all', label: 'All mappings' },
          { id: 'ring', label: 'Ring (low entropy)' },
          { id: 'mosaic', label: 'Mosaic (high entropy)' },
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
              background: mappingFilter === opt.id ? '#eef6ff' : '#fff',
              cursor: 'pointer',
            }}
          >
            <input
              type="radio"
              name="mapping"
              value={opt.id}
              checked={mappingFilter === opt.id}
              onChange={(e) => setMappingFilter(e.target.value)}
            />
            <span style={{ fontSize: 12 }}>{opt.label}</span>
          </label>
        ))}
      </div>

      {/* Row 4: Session count filter */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexWrap: 'wrap',
          marginTop: 8,
        }}
      >
        <span style={{ fontSize: 12, color: '#555' }}>Session type:</span>
        {[
          { id: 'all', label: 'All sessions' },
          { id: 'first', label: 'First session only' },
          { id: 'repeat', label: 'Repeat sessions only' },
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
              background: sessionFilter === opt.id ? '#eef6ff' : '#fff',
              cursor: 'pointer',
            }}
          >
            <input
              type="radio"
              name="sessionType"
              value={opt.id}
              checked={sessionFilter === opt.id}
              onChange={(e) => setSessionFilter(e.target.value)}
            />
            <span style={{ fontSize: 12 }}>{opt.label}</span>
          </label>
        ))}
      </div>

      {/* Row 5: Session source filter (Regular vs SessionRunner) */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexWrap: 'wrap',
          marginTop: 8,
        }}
      >
        <span style={{ fontSize: 12, color: '#555' }}>Data source:</span>
        {[
          { id: 'all', label: 'All data' },
          { id: 'human', label: 'Human' },
          { id: 'ai', label: 'AI Agent' },
          { id: 'auto', label: 'Auto-mode (Baseline)' },
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
              background: sessionTypeFilter === opt.id ? '#eef6ff' : '#fff',
              cursor: 'pointer',
            }}
          >
            <input
              type="radio"
              name="sessionSourceType"
              value={opt.id}
              checked={sessionTypeFilter === opt.id}
              onChange={(e) => setSessionTypeFilter(e.target.value)}
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
          <strong>First sessions:</strong> {summary.firstSessions}
        </div>
        <div>
          <strong>Repeat sessions:</strong> {summary.repeatSessions}
        </div>
        <div>
          <strong>Filtered sessions:</strong> {filteredSessions.length}
        </div>
      </div>
    </div>
  );

  // Strategic Abort Display Component
  const AbortAnalysisPanel = () => {
    const hasAborts = Object.values(abortStats).some(s => s.totalAborts > 0);
    if (!hasAborts) return null;

    return (
      <div style={{
        padding: 16,
        margin: '16px 0',
        border: '2px solid #ff6b6b',
        borderRadius: 8,
        background: '#fff5f5'
      }}>
        <h3 style={{ margin: '0 0 12px 0', color: '#c92a2a' }}>
          ⚠️ Strategic Abort Detection (Timing Attack Analysis)
        </h3>
        <div style={{ fontSize: 14, marginBottom: 12, color: '#555' }}>
          Sessions with committed QRNG bits but no processed trials (agent peeked and aborted)
        </div>

        {Object.entries(abortStats).map(([mode, stats]) => {
          if (stats.totalAborts === 0) return null;

          return (
            <div key={mode} style={{
              padding: 12,
              margin: '8px 0',
              background: '#fff',
              border: '1px solid #ddd',
              borderRadius: 6
            }}>
              <div style={{ fontWeight: 'bold', marginBottom: 8, textTransform: 'capitalize' }}>
                {mode === 'ai_agent' ? 'AI Agent' : mode}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 12, color: '#666' }}>Sessions with Aborts:</div>
                  <div style={{ fontSize: 18, fontWeight: 'bold' }}>
                    {stats.withAborts} / {stats.total}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: '#666' }}>Total Aborted Blocks:</div>
                  <div style={{ fontSize: 18, fontWeight: 'bold' }}>{stats.totalAborts}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: '#e03131' }}>Below 50%:</div>
                  <div style={{ fontSize: 18, fontWeight: 'bold', color: '#e03131' }}>{stats.below50}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: '#868e96' }}>At 50%:</div>
                  <div style={{ fontSize: 18, fontWeight: 'bold', color: '#868e96' }}>{stats.at50}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: '#2f9e44' }}>Above 50%:</div>
                  <div style={{ fontSize: 18, fontWeight: 'bold', color: '#2f9e44' }}>{stats.above50}</div>
                </div>
              </div>

              {stats.below50 > stats.above50 && stats.totalAborts > 5 && (
                <div style={{
                  marginTop: 12,
                  padding: 8,
                  background: '#ffe3e3',
                  border: '1px solid #ff6b6b',
                  borderRadius: 4,
                  fontSize: 13,
                  color: '#c92a2a'
                }}>
                  🚨 <strong>SUSPICIOUS PATTERN:</strong> More low-score aborts suggests selective completion
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div style={{ maxWidth: 980, margin: '40px auto', padding: 16 }}>
      <h1>Export & QA - Experiment 4</h1>

      <AbortAnalysisPanel />

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

      {/* Experimental Design Documentation */}
      <div style={{ marginTop: 24, padding: 20, border: '2px solid #3b82f6', borderRadius: 8, background: '#eff6ff' }}>
        <h2 style={{ margin: '0 0 16px', color: '#1e40af' }}>Experimental Design (Updated 2025-10-14)</h2>

        <div style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 'bold', marginBottom: 8, color: '#374151' }}>Session Structure:</h3>
          <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
            <li><strong>30 blocks per session</strong>, 150 trials per block = 4,500 total trials</li>
            <li><strong>Audit breaks every 5 blocks</strong> (after blocks 5, 10, 15, 20, 25)</li>
            <li><strong>Target randomization</strong> at each audit break</li>
          </ul>
        </div>

        <div style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 'bold', marginBottom: 8, color: '#374151' }}>QRNG Protocol (Random Half Assignment):</h3>
          <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
            <li><strong>Single 300-bit fetch</strong> per block from the QRNG</li>
            <li><strong>Random assignment:</strong> First/second half (150 bits each) → Subject/Demon</li>
            <li>Both conditions use bits from <strong>identical quantum source</strong>, ensuring matched baseline</li>
            <li>Subject sees results in real-time; Demon half serves as no-focus control</li>
          </ul>
        </div>

        <div style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 'bold', marginBottom: 8, color: '#374151' }}>Session Types:</h3>
          <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
            <li><strong>Human:</strong> Standard consciousness protocol with focused intention</li>
            <li><strong>Auto:</strong> Automated baseline (no consciousness, immediate auto-continue)</li>
            <li><strong>AI:</strong> GPT-4o-mini agent with persistent conversation throughout session</li>
          </ul>
        </div>

        <div style={{ padding: 12, background: '#fef3c7', borderRadius: 6, border: '1px solid #f59e0b' }}>
          <strong style={{ color: '#92400e' }}>⚠ Design Note:</strong>
          <p style={{ margin: '8px 0 0', fontSize: 14, color: '#78350f', lineHeight: 1.6 }}>
            All data uses the random half assignment protocol. Subject and Demon (control) conditions receive bits from the same 300-bit QRNG fetch, with random assignment of first/second half (150 bits each), ensuring perfectly matched quantum sources for fair comparison.
          </p>
        </div>
      </div>

      {/* PRIMARY ANALYSIS: Session-level comparisons */}
      {primaryAnalysis && (primaryAnalysis.human || primaryAnalysis.ai || primaryAnalysis.baseline) && (
        <div style={{ marginTop: 24, padding: 20, border: '3px solid #dc2626', borderRadius: 8, background: '#fef2f2' }}>
          <h2 style={{ margin: '0 0 8px', color: '#991b1b', fontSize: 20 }}>
            🎯 PRIMARY ANALYSIS: Human vs AI vs Baseline (Confirmatory)
          </h2>
          <div style={{ fontSize: 13, color: '#7f1d1d', marginBottom: 16, fontStyle: 'italic' }}>
            {primaryAnalysis.interpretation.hypothesis}
            <br />
            <strong>Statistical Method:</strong> {primaryAnalysis.interpretation.correction}
            <br />
            <strong>Note:</strong> {primaryAnalysis.interpretation.note}
          </div>

          {/* Summary statistics for each condition */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 20 }}>
            {primaryAnalysis.human && (
              <div style={{ padding: 16, background: '#fff', border: '2px solid #3b82f6', borderRadius: 8 }}>
                <div style={{ fontSize: 12, color: '#1e40af', fontWeight: 'bold', marginBottom: 4 }}>HUMAN</div>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: '#1e3a8a' }}>
                  {(primaryAnalysis.human.mean * 100).toFixed(2)}%
                </div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                  n = {primaryAnalysis.human.n} sessions
                  <br />
                  SD = {(primaryAnalysis.human.sd * 100).toFixed(2)}%
                  <br />
                  SE = {(primaryAnalysis.human.se * 100).toFixed(2)}%
                </div>
              </div>
            )}
            {primaryAnalysis.ai && (
              <div style={{ padding: 16, background: '#fff', border: '2px solid #8b5cf6', borderRadius: 8 }}>
                <div style={{ fontSize: 12, color: '#6d28d9', fontWeight: 'bold', marginBottom: 4 }}>AI AGENT</div>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: '#5b21b6' }}>
                  {(primaryAnalysis.ai.mean * 100).toFixed(2)}%
                </div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                  n = {primaryAnalysis.ai.n} sessions
                  <br />
                  SD = {(primaryAnalysis.ai.sd * 100).toFixed(2)}%
                  <br />
                  SE = {(primaryAnalysis.ai.se * 100).toFixed(2)}%
                </div>
              </div>
            )}
            {primaryAnalysis.baseline && (
              <div style={{ padding: 16, background: '#fff', border: '2px solid #6b7280', borderRadius: 8 }}>
                <div style={{ fontSize: 12, color: '#374151', fontWeight: 'bold', marginBottom: 4 }}>BASELINE (Auto)</div>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: '#1f2937' }}>
                  {(primaryAnalysis.baseline.mean * 100).toFixed(2)}%
                </div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                  n = {primaryAnalysis.baseline.n} sessions
                  <br />
                  SD = {(primaryAnalysis.baseline.sd * 100).toFixed(2)}%
                  <br />
                  SE = {(primaryAnalysis.baseline.se * 100).toFixed(2)}%
                </div>
              </div>
            )}
          </div>

          {/* Pairwise comparisons with Holm-Bonferroni correction */}
          <div style={{ marginTop: 20 }}>
            <h3 style={{ fontSize: 16, fontWeight: 'bold', marginBottom: 12, color: '#991b1b' }}>
              Pairwise Comparisons (Holm-Bonferroni Sequential Rejection)
            </h3>
            <div style={{ fontSize: 12, color: '#7f1d1d', marginBottom: 12 }}>
              Comparisons tested in order of smallest to largest p-value. Each test uses adjusted α threshold.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {primaryAnalysis.comparisons
                .sort((a, b) => a.result.rank - b.result.rank)
                .map((comp, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: 16,
                    background: comp.result.significantHolm ? '#dcfce7' : '#fff',
                    border: comp.result.significantHolm ? '2px solid #059669' : '1px solid #e5e7eb',
                    borderRadius: 8
                  }}
                >
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr', gap: 12, alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 'bold', color: '#111827' }}>
                        {comp.name}
                      </div>
                      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                        Rank {comp.result.rank} of {primaryAnalysis.comparisons.length}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: '#6b7280' }}>Difference</div>
                      <div style={{ fontSize: 14, fontWeight: 'bold', color: comp.result.difference > 0 ? '#059669' : '#dc2626' }}>
                        {comp.result.differencePercent > 0 ? '+' : ''}{comp.result.differencePercent.toFixed(3)}%
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: '#6b7280' }}>t-statistic</div>
                      <div style={{ fontSize: 14, fontWeight: 'bold', color: '#111827' }}>
                        {comp.result.t.toFixed(3)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: '#6b7280' }}>df</div>
                      <div style={{ fontSize: 14, color: '#6b7280' }}>
                        {comp.result.df}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: '#6b7280' }}>p (raw)</div>
                      <div style={{ fontSize: 13, color: '#6b7280' }}>
                        {comp.result.pValue.toFixed(4)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: '#6b7280' }}>p (Holm)</div>
                      <div style={{ fontSize: 14, fontWeight: 'bold', color: comp.result.significantHolm ? '#059669' : '#6b7280' }}>
                        {comp.result.pHolm.toFixed(4)}
                        {comp.result.significantHolm && ' ✓'}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: '#6b7280' }}>α threshold</div>
                      <div style={{ fontSize: 13, color: '#6b7280' }}>
                        {comp.result.adjustedAlpha.toFixed(4)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: '#6b7280' }}>Effect size</div>
                      <div style={{ fontSize: 13, fontWeight: 'bold', color: '#111827' }}>
                        d = {comp.result.cohensD.toFixed(3)}
                      </div>
                      <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>
                        ({comp.result.effectInterpretation})
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Power analysis */}
          <div style={{ marginTop: 20, padding: 16, background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 8 }}>
            <h3 style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 8, color: '#92400e' }}>
              Power Analysis: Minimum Detectable Effect (MDE)
            </h3>
            <div style={{ fontSize: 12, color: '#78350f', marginBottom: 8 }}>
              Given current sample sizes, what's the smallest Cohen's d we can reliably detect (80% power, α=0.05)?
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              {primaryAnalysis.powerAnalysis.humanVsAI && (
                <div>
                  <div style={{ fontSize: 11, color: '#92400e', fontWeight: 'bold' }}>Human vs AI</div>
                  <div style={{ fontSize: 16, fontWeight: 'bold', color: '#78350f' }}>
                    d ≥ {primaryAnalysis.powerAnalysis.humanVsAI.toFixed(3)}
                  </div>
                </div>
              )}
              {primaryAnalysis.powerAnalysis.humanVsBaseline && (
                <div>
                  <div style={{ fontSize: 11, color: '#92400e', fontWeight: 'bold' }}>Human vs Baseline</div>
                  <div style={{ fontSize: 16, fontWeight: 'bold', color: '#78350f' }}>
                    d ≥ {primaryAnalysis.powerAnalysis.humanVsBaseline.toFixed(3)}
                  </div>
                </div>
              )}
              {primaryAnalysis.powerAnalysis.aiVsBaseline && (
                <div>
                  <div style={{ fontSize: 11, color: '#92400e', fontWeight: 'bold' }}>AI vs Baseline</div>
                  <div style={{ fontSize: 16, fontWeight: 'bold', color: '#78350f' }}>
                    d ≥ {primaryAnalysis.powerAnalysis.aiVsBaseline.toFixed(3)}
                  </div>
                </div>
              )}
            </div>
            <div style={{ fontSize: 11, color: '#78350f', marginTop: 8, fontStyle: 'italic' }}>
              Effect sizes smaller than MDE may be real but undetectable with current sample sizes.
            </div>
          </div>
        </div>
      )}

      {/* Statistics section */}
      {stats && (
        <div style={{ marginTop: 24 }}>
          <h2 style={{ margin: '12px 0 8px' }}>Exploratory Statistics (Descriptive Only)</h2>
          <div style={{ fontSize: 13, color: '#dc2626', marginBottom: 12, padding: 8, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 4 }}>
            ⚠️ <strong>Not corrected for multiple comparisons.</strong> Per-block p-values below are for exploratory analysis only. See PRIMARY ANALYSIS above for confirmatory inference.
          </div>

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

          {/* Load Detailed Data Button */}
          {!detailedDataLoaded && (
            <div style={{
              marginBottom: 20,
              padding: 16,
              background: '#fef3c7',
              border: '1px solid #f59e0b',
              borderRadius: 8
            }}>
              <p style={{ marginBottom: 12, fontSize: 14 }}>
                <strong>⚡ Fast Mode:</strong> Currently showing summary statistics only (loaded {filteredSessions.length} sessions instantly).
              </p>
              <p style={{ marginBottom: 12, fontSize: 14 }}>
                To use advanced analytics (Temporal Structure, Entropy Analysis, etc.), click below to load detailed trial data.
              </p>
              <button
                onClick={loadDetailedData}
                disabled={loadingDetailed}
                style={{
                  padding: '10px 20px',
                  fontSize: 14,
                  fontWeight: 600,
                  background: loadingDetailed ? '#9ca3af' : '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: 6,
                  cursor: loadingDetailed ? 'wait' : 'pointer',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                }}
              >
                {loadingDetailed ? 'Loading detailed data...' : 'Load Detailed Data for Advanced Analytics'}
              </button>
            </div>
          )}

          {detailedDataLoaded && (
            <div style={{
              marginBottom: 20,
              padding: 12,
              background: '#d1fae5',
              border: '1px solid #10b981',
              borderRadius: 8,
              fontSize: 14
            }}>
              ✅ Detailed data loaded - all analytics features enabled
            </div>
          )}

          {/* Basic Performance Summary */}
          <AnalyticsSection
            title="Basic Performance Summary"
            content={<PrimaryPerformanceMetrics sessions={filteredSessions} stats={stats} />}
            requiresDetailedData={false}
            detailedDataLoaded={detailedDataLoaded}
            loadingDetailed={loadingDetailed}
          />

          {/* Unified Temporal & Control Analysis */}
          <AnalyticsSection
            title="Temporal Structure & Control Analysis"
            content={<UnifiedTemporalControlAnalysis sessions={filteredSessions} />}
            requiresDetailedData={true}
            onExpand={loadDetailedData}
            detailedDataLoaded={detailedDataLoaded}
            loadingDetailed={loadingDetailed}
          />

          {/* Entropy Signatures */}
          <AnalyticsSection
            title="Entropy Signatures"
            content={<EntropySignatures sessions={filteredSessions} />}
            requiresDetailedData={true}
            onExpand={loadDetailedData}
            detailedDataLoaded={detailedDataLoaded}
            loadingDetailed={loadingDetailed}
          />

          {/* Individual Difference Tracking */}
          <AnalyticsSection
            title="Individual Difference Tracking"
            content={<IndividualDifferenceTracking sessions={filteredSessions} />}
            requiresDetailedData={true}
            onExpand={loadDetailedData}
            detailedDataLoaded={detailedDataLoaded}
            loadingDetailed={loadingDetailed}
          />

          {/* Control Validations - Trial-Level Chi-Square Tests */}
          <AnalyticsSection
            title="Trial-Level Control Validations (Chi-Square Independence)"
            content={<ControlValidations sessions={filteredSessions} mappingFilter={mappingFilter} />}
            requiresDetailedData={true}
            onExpand={loadDetailedData}
            detailedDataLoaded={detailedDataLoaded}
            loadingDetailed={loadingDetailed}
          />

          {/* Exploratory Signatures */}
          <AnalyticsSection
            title="Exploratory Signatures"
            content={<ExploratorySignatures sessions={filteredSessions} />}
            requiresDetailedData={true}
            onExpand={loadDetailedData}
            detailedDataLoaded={detailedDataLoaded}
            loadingDetailed={loadingDetailed}
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
                  Blocks
                </th>
                <th style={{ border: '1px solid #d1d5db', padding: 8, textAlign: 'left' }}>
                  Hit Rate
                </th>
                <th style={{ border: '1px solid #d1d5db', padding: 8, textAlign: 'left' }}>
                  Binaural
                </th>
                <th style={{ border: '1px solid #d1d5db', padding: 8, textAlign: 'left' }}>
                  Data Type
                </th>
                <th style={{ border: '1px solid #d1d5db', padding: 8, textAlign: 'left' }}>
                  Source
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredSessions.map((session) => {
                const sessionStats = stats?.sessionStats.find(s => s.id === session.id);

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
                      {session.post_survey?.binaural_beats === 'Yes' ? '✅' : '❌'}
                    </td>
                    <td style={{ border: '1px solid #d1d5db', padding: 8 }}>
                      {session.session_type === 'baseline' || session.session_type === 'session_runner'
                        ? `Baseline (${session.mode || 'auto'})`
                        : `${(session.minutes || []).length} live`}
                    </td>
                    <td style={{ border: '1px solid #d1d5db', padding: 8 }}>
                      {session.session_type === 'ai_agent' ? '🤖 AI' :
                       session.session_type === 'baseline' || session.session_type === 'session_runner' ? '⚙️ Auto' :
                       '👤 Human'}
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

