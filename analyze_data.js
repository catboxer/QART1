// Quick data integrity analysis
const fs = require('fs');

console.log('🔍 Analyzing experimental data for integrity issues...\n');

try {
  const data = JSON.parse(fs.readFileSync('/Users/meow/Downloads/sessions_with_trials_and_reveal.json', 'utf8'));

  console.log(`📊 Total sessions: ${data.length}`);

  let totalTrials = 0;
  let blockStats = { full_stack: 0, spoon_love: 0, client_local: 0 };
  let rngSources = {};
  let issuesFound = [];

  // Check each session
  data.forEach((session, sessionIdx) => {
    const sessionId = session.id || session.session_id || `session_${sessionIdx}`;

    // Check each block type
    ['full_stack', 'spoon_love', 'client_local'].forEach(blockType => {
      const block = session[blockType];
      if (!block || !block.trialResults) return;

      const trials = block.trialResults;
      totalTrials += trials.length;
      blockStats[blockType] += trials.length;

      // Check each trial in this block
      trials.forEach((trial, trialIdx) => {
        // Check RNG source consistency
        const rngSource = trial.rng_source;
        if (rngSource) {
          rngSources[rngSource] = (rngSources[rngSource] || 0) + 1;
        }

        // Check for missing critical fields
        if (trial.block_type !== blockType) {
          issuesFound.push(`${sessionId}: Trial ${trialIdx} block_type mismatch: expected ${blockType}, got ${trial.block_type}`);
        }

        if (typeof trial.subject_hit !== 'number') {
          issuesFound.push(`${sessionId}: Trial ${trialIdx} missing subject_hit`);
        }

        if (typeof trial.demon_hit !== 'number') {
          issuesFound.push(`${sessionId}: Trial ${trialIdx} missing demon_hit`);
        }

        if (!trial.raw_byte && trial.raw_byte !== 0) {
          issuesFound.push(`${sessionId}: Trial ${trialIdx} missing raw_byte`);
        }

        if (!trial.ghost_raw_byte && trial.ghost_raw_byte !== 0) {
          issuesFound.push(`${sessionId}: Trial ${trialIdx} missing ghost_raw_byte`);
        }

        // Check for quantum block specific issues
        if (blockType === 'spoon_love') {
          if (!['outshift', 'lfdr', 'random_org', 'random_org_quantum'].includes(rngSource)) {
            issuesFound.push(`${sessionId}: Quantum trial ${trialIdx} unexpected RNG source: ${rngSource}`);
          }
        }

        // Check for physical block specific issues
        if (blockType === 'full_stack') {
          if (!['random_org', 'outshift', 'lfdr'].includes(rngSource)) {
            issuesFound.push(`${sessionId}: Physical trial ${trialIdx} unexpected RNG source: ${rngSource}`);
          }
        }

        // Check target/ghost index ranges
        if (trial.target_index_0based < 0 || trial.target_index_0based > 4) {
          issuesFound.push(`${sessionId}: Trial ${trialIdx} invalid target_index_0based: ${trial.target_index_0based}`);
        }

        if (trial.ghost_index_0based < 0 || trial.ghost_index_0based > 4) {
          issuesFound.push(`${sessionId}: Trial ${trialIdx} invalid ghost_index_0based: ${trial.ghost_index_0based}`);
        }
      });
    });
  });

  console.log(`\n📈 Trial Distribution:`);
  console.log(`  Physical (full_stack): ${blockStats.full_stack}`);
  console.log(`  Quantum (spoon_love): ${blockStats.spoon_love}`);
  console.log(`  Local (client_local): ${blockStats.client_local}`);
  console.log(`  Total trials: ${totalTrials}`);

  console.log(`\n🎲 RNG Source Distribution:`);
  Object.entries(rngSources)
    .sort(([,a], [,b]) => b - a)
    .forEach(([source, count]) => {
      console.log(`  ${source}: ${count} trials (${(100*count/totalTrials).toFixed(1)}%)`);
    });

  console.log(`\n🚨 Issues Found: ${issuesFound.length}`);
  if (issuesFound.length > 0) {
    issuesFound.slice(0, 10).forEach(issue => console.log(`  ❌ ${issue}`));
    if (issuesFound.length > 10) {
      console.log(`  ... and ${issuesFound.length - 10} more issues`);
    }
  } else {
    console.log(`  ✅ No data integrity issues found!`);
  }

} catch (error) {
  console.error('❌ Error analyzing data:', error.message);
}