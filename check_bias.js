// Check for RNG bias patterns in the data
const fs = require('fs');

console.log('🎯 Checking for RNG bias patterns...\n');

try {
  const data = JSON.parse(fs.readFileSync('/Users/meow/Downloads/sessions_with_trials_and_reveal.json', 'utf8'));

  // Aggregate trials by RNG source and block type
  const sourceStats = {};

  data.forEach(session => {
    ['full_stack', 'spoon_love', 'client_local'].forEach(blockType => {
      const block = session[blockType];
      if (!block || !block.trialResults) return;

      block.trialResults.forEach(trial => {
        const source = trial.rng_source;
        const key = `${source}_${blockType}`;

        if (!sourceStats[key]) {
          sourceStats[key] = {
            source,
            blockType,
            trials: 0,
            subjectHits: 0,
            demonHits: 0,
            totalSubject: 0,
            totalDemon: 0
          };
        }

        const stats = sourceStats[key];
        stats.trials++;

        if (typeof trial.subject_hit === 'number') {
          stats.totalSubject++;
          stats.subjectHits += trial.subject_hit;
        }

        if (typeof trial.demon_hit === 'number') {
          stats.totalDemon++;
          stats.demonHits += trial.demon_hit;
        }
      });
    });
  });

  console.log('📊 Performance by RNG Source and Block Type:\n');

  Object.entries(sourceStats)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([key, stats]) => {
      const subjectPct = stats.totalSubject > 0 ? (100 * stats.subjectHits / stats.totalSubject) : 0;
      const demonPct = stats.totalDemon > 0 ? (100 * stats.demonHits / stats.totalDemon) : 0;
      const delta = subjectPct - demonPct;

      console.log(`${stats.source} (${stats.blockType}):`);
      console.log(`  Trials: ${stats.trials}`);
      console.log(`  Subject: ${subjectPct.toFixed(1)}% (${stats.subjectHits}/${stats.totalSubject})`);
      console.log(`  Demon: ${demonPct.toFixed(1)}% (${stats.demonHits}/${stats.totalDemon})`);
      console.log(`  Delta: ${delta.toFixed(1)}%`);

      // Flag potential bias
      if (demonPct > 25) {
        console.log(`  🚨 HIGH DEMON BIAS: ${demonPct.toFixed(1)}% (expected ~20%)`);
      } else if (demonPct < 15) {
        console.log(`  ⚠️  Low demon performance: ${demonPct.toFixed(1)}%`);
      } else {
        console.log(`  ✅ Normal demon performance`);
      }
      console.log('');
    });

  // Check for quantum-specific issues
  console.log('🔬 Quantum Block Analysis:');
  const quantumTrials = [];
  data.forEach(session => {
    const block = session.spoon_love;
    if (block && block.trialResults) {
      quantumTrials.push(...block.trialResults);
    }
  });

  if (quantumTrials.length > 0) {
    const outshiftTrials = quantumTrials.filter(t => t.rng_source === 'outshift');
    const randomOrgTrials = quantumTrials.filter(t => t.rng_source === 'random_org');

    console.log(`  Total quantum trials: ${quantumTrials.length}`);
    console.log(`  Outshift: ${outshiftTrials.length}`);
    console.log(`  Random.org: ${randomOrgTrials.length}`);

    if (randomOrgTrials.length > 0) {
      console.log(`  ℹ️  Note: Some quantum trials used Random.org (likely during testing)`);
    }
  }

} catch (error) {
  console.error('❌ Error:', error.message);
}