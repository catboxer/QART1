# QA Dashboard Statistical Analysis Documentation

## Overview

This document explains every number and statistical test on the QA Dashboard in plain language. The experiment tests three hypotheses about whether human consciousness can influence quantum randomness:

**Our Three Hypotheses:**

1. **H1: Entropy Suppression** - Consciousness reduces the randomness (entropy) of quantum bits
2. **H2: Autocorrelation** - Consciousness creates patterns/feedback in quantum bit sequences
3. **H3: Temporal Progression** - Physics dampens the entropy-reducing effect over time, returning it to random equilibrium (early sessions show lower entropy, later sessions return to randomness)

**What We're Testing:**
- **Hit Rate**: Does the user match the target more than 50% chance? (measures if randomness tilts)
- **Entropy**: Are the quantum bits less random than expected? (measures patterns/predictability)

These measure different things! You can have bias without patterns (high hit rate, normal entropy) or patterns without bias (normal hit rate, low entropy). We need both tests.

---

## Basic Performance Summary

**What This Section Shows:** Simple overview of how well participants are doing overall - this is our basic quality check.

### Overall Hit Rate

**What It Is:** The percentage of trials where the participant's quantum bit matched the target

**How It's Calculated:**
```
Hit Rate = (Number of Matches / Total Trials) × 100
Example: 2,405 matches out of 4,768 trials = 50.44%
```

**What We're Measuring:** Whether participants can influence quantum bits to match a predetermined target more than random chance

**Why We're Measuring It:** This is the simplest test of our hypothesis - if consciousness can influence quantum randomness, we should see >50% hit rate

**What We Expect If Our Hypothesis Is Correct:**
- **Subject Hit Rate:** ≥51.8% for significance (p < 0.05 with ~3000 trials)
- **The higher above 50%, the stronger the evidence**

---

### Sessions Analyzed

**What It Is:** How many complete experimental sessions are included in this analysis

**How It's Calculated:** Simple count of sessions (each session = 20 blocks of 150 trials)

**Example:** "2" means 2 sessions × 20 blocks × 150 trials = 6,000 possible trials total

---

### Z-Score vs Chance

**What It Is:** How many "standard deviations" the hit rate is away from pure chance (50%)

**How It's Calculated:**
```
Z = (Observed Hits - Expected Hits) / Standard Error
Where:
  Expected Hits = 50% of trials
  Standard Error = sqrt(trials × 0.5 × 0.5)

Example: Z = 1.049 means 1.049 standard deviations above chance
```

**What We're Measuring:** Statistical strength of the deviation from chance

**Why We're Measuring It:** The Z-score tells us if the hit rate is "surprisingly high" or just normal random variation

**What We Expect If Our Hypothesis Is Correct:**
- **Z-score:** Above +1.96 (for p < 0.05 significance)
- **p-value:** Less than 0.05 (meaning <5% chance this happened randomly)
- **Example:** Z = 2.5, p = 0.012 would be strong evidence

**Interpreting the p-value:**
- p = 0.4849 means "48.49% chance this result happened by luck"
- We need p < 0.05 (less than 5% chance) to claim statistical significance
- Higher p-values mean the result is consistent with pure chance

---

## Block-to-Block Temporal Analysis

**What This Section Shows:** How performance changes and fluctuates across consecutive blocks of trials (each block ≈ 150 trials)

### Sessions Analyzed / Total Blocks

**What It Is:**
- Sessions Analyzed: Number of complete sessions
- Total Blocks: Total 150-trial blocks (each session has 20 blocks)

**Example:** 2 sessions × 20 blocks = 40 total blocks

---

### Turning Point Analysis

**What This Section Shows:** How often performance "switches direction" (goes from improving to declining or vice versa) - helps detect oscillations or patterns

#### Total Points

**What It Is:** Number of times the hit rate trend reverses direction across blocks

**How It's Calculated:**
```
For blocks 1, 2, 3, 4, 5...
If block 2 > block 1 AND block 3 < block 2: that's a turning point
Count all such reversals
```

**Example:** 11.5 turning points across 40 blocks

---

#### Rate per Block

**What It Is:** Average number of turning points per block

**How It's Calculated:**
```
Rate = Total Turning Points / Total Blocks
Example: 11.5 / 40 = 0.29 per block
```

---

#### Expected (Random)

**What It Is:** How many turning points we'd expect if performance was completely random

**How It's Calculated:** Statistical expectation based on random walk theory (approximately 1/3 of blocks)

---

#### Excess vs Random

**What It Is:** How many MORE (or fewer) turning points we observed compared to random

**How It's Calculated:**
```
Excess = Observed Turning Points - Expected Turning Points
Example: 11.5 - 9.0 = +2.5
```

**What We're Measuring:** Whether performance oscillates more or less than random chance

**Why We're Measuring It:**
- **More turning points than random:** Suggests unstable/oscillating performance
- **Fewer turning points than random:** Suggests sustained streaks (positive or negative)

**What We Expect If Our Hypothesis Is Correct:**
- **Excess near 0 or negative:** Sustained above-chance performance (fewer reversals)
- **Excess strongly positive:** Unstable effect that switches on/off (H2: autocorrelation)

---

#### % Above Random

**What It Is:** Percentage by which turning points exceed random expectation

**How It's Calculated:**
```
% Above = (Excess / Expected) × 100
Example: (2.5 / 9.0) × 100 = +28%
```

**Interpretation:** +28% means 28% more oscillations than pure randomness would predict

---

#### Max/Min Ratio

**What It Is:** Ratio of highest block hit rate to lowest block hit rate

**How It's Calculated:**
```
Ratio = Max Block Hit Rate / Min Block Hit Rate
Example: 0.93 means max is only 93% of min (unusual - suggests very stable performance)
```

**What We're Measuring:** How much performance varies between best and worst blocks

**Why We're Measuring It:**
- **Ratio near 1.0:** Very stable performance (low variance)
- **Ratio > 1.5:** High variability between blocks

---

### Lag-1 to Lag-5 Autocorrelation of Block Performance

**What This Section Shows:** Whether a block's performance predicts the next block's performance (tests H2: autocorrelation hypothesis)

**What Autocorrelation Is:** How much each block's hit rate correlates with the previous block's hit rate

**How It's Calculated:**
```
Lag-1: Correlation between block[i] and block[i+1] (immediate next block)
Lag-2: Correlation between block[i] and block[i+2] (2 blocks later)
...
Lag-5: Correlation between block[i] and block[i+5] (5 blocks later)

Correlation formula (Pearson r):
r = covariance(X, Y) / (std_dev(X) × std_dev(Y))
```

**Values Shown:**
- **r value (e.g., -0.0050):** Correlation coefficient
  - r = +1.0: Perfect positive correlation (high → high)
  - r = 0: No correlation
  - r = -1.0: Perfect negative correlation (high → low)
- **± value (e.g., ±0.0020):** Standard error (uncertainty in the estimate)
- **\* asterisk:** Statistically significant (p < 0.05)

**What We're Measuring:** Feedback loops or sustained streaks in performance

**Why We're Measuring It (H2: Autocorrelation Hypothesis):**
- **Positive r:** "Success breeds success" - high-performing blocks followed by more high-performing blocks
- **Negative r:** "Correction effect" - high-performing blocks followed by low-performing blocks
- **r ≈ 0:** Each block is independent (no feedback)

**What We Expect If H2 Is Correct:**
- **Positive autocorrelation at Lag-1:** r > 0.2 (current block predicts next block)
- **Decaying correlation:** Lag-1 > Lag-2 > Lag-3 (effect weakens over time)
- **Statistical significance:** Marked with * (p < 0.05)

**Example Interpretation:**
```
Lag 1: -0.0050 ± 0.0020
```
- Near-zero negative correlation
- No evidence of feedback between consecutive blocks
- Does NOT support H2

---

### First-Half vs Second-Half Performance Comparison Within Sessions

**What This Section Shows:** Whether participants improve or decline as the session progresses (tests H3: temporal progression)

#### First Half Mean / Second Half Mean

**What It Is:** Average hit rate for first 10 blocks vs last 10 blocks of each session

**How It's Calculated:**
```
First Half Mean = Average hit rate of blocks 1-10
Second Half Mean = Average hit rate of blocks 11-20
```

---

#### Difference

**What It Is:** How much performance changed from first to second half

**How It's Calculated:**
```
Difference = Second Half Mean - First Half Mean
Example: 50.07% - 50.10% = -0.03%
```

**What We're Measuring:** Learning curve or fatigue effect within sessions

**Why We're Measuring It (H3: Temporal Progression Hypothesis):**
- If consciousness influence works early but physics dampens it, first half should be higher
- If the effect persists, performance should stay stable or increase

**What We Expect If H3 Is Correct:**
- **Negative difference:** Small decline (first half > second half as physics dampens effect)
- **Significant t-test:** t < -2.0, p < 0.05
- **Pattern:** Entropy should INCREASE from early to late (returns to randomness as dampening occurs)

**Example Interpretation:**
```
Difference: -0.03%, t = -0.01
```
- Essentially no change between halves
- Does NOT support H3 (no temporal progression)

---

#### t-statistic

**What It Is:** Statistical test of whether the difference is meaningful or just noise

**How It's Calculated:**
```
t = Difference / Standard Error
Where Standard Error accounts for variability between sessions
```

**Interpretation:**
- **|t| > 2.0:** Significant difference (p < 0.05)
- **|t| < 2.0:** Difference is within normal random variation

---

### Sequential Differences Between Consecutive Blocks

**What This Section Shows:** How much performance jumps around from block to block

#### Mean Change

**What It Is:** Average difference between consecutive blocks

**How It's Calculated:**
```
For each pair of blocks:
  Change[i] = Block[i+1] - Block[i]
Mean Change = Average of all changes
Example: 0.158% average change per block
```

**What We're Measuring:** Stability vs volatility of performance

---

#### Std Deviation

**What It Is:** How much the block-to-block changes vary

**How It's Calculated:** Standard deviation of all consecutive differences

**Interpretation:**
- **Low StdDev (< 3%):** Stable performance
- **High StdDev (> 8%):** Volatile, erratic performance
- **Example: 5.956%** - Moderate variability (typical for random data)

---

#### Sample Size

**What It Is:** Number of block-to-block transitions analyzed

**How It's Calculated:**
```
Sample Size = Total Blocks - 1
Example: 40 blocks → 38 transitions
```

---

### Randomness Testing

**What This Section Shows:** Whether the sequence of hits/misses follows a random pattern or shows structure

#### Runs Test Statistic

**What It Is:** A statistical test that detects non-random patterns by counting "runs" (consecutive sequences of hits or misses)

**How It's Calculated:**
```
Run = uninterrupted sequence of same outcome
Example: HHH-MM-H-MMM has 4 runs

Z = (Observed Runs - Expected Runs) / Standard Error

Expected Runs for random sequence ≈ (n/2) where n = number of transitions
```

**What We're Measuring:** Whether hits and misses are randomly distributed or clumped together

**Why We're Measuring It:** Non-random clustering could indicate patterns in how the effect works

**Interpretation:**
- **Z > +2.0:** Too many runs (alternating pattern: HMHMHM)
- **Z < -2.0:** Too few runs (clumping pattern: HHHMMM)
- **-2 < Z < +2:** Random distribution

---

#### Runs Test (Randomness) p-value

**What It Is:** Probability that the observed pattern occurred by chance

**Example:** p = 0.205 means 20.5% chance this pattern is random (not significant)

**Interpretation:**
- **p > 0.05:** Pattern is consistent with randomness ✓
- **p < 0.05:** Pattern is non-random (either meaningful or data quality issue)

---

## High-Resolution Trial-Level Analysis

**What This Section Shows:** Ultra-detailed analysis of individual trials (all 4,768 trials) rather than aggregating into blocks

### Trial-to-Trial Autocorrelations

**What This Section Shows:** Whether individual trial outcomes predict the next trial's outcome

**How It's Calculated:**
```
Lag 1: Correlation between trial[i] and trial[i+1]
Lag 2: Correlation between trial[i] and trial[i+2]
etc.

Each trial coded as: 1 = hit, 0 = miss
Calculate Pearson correlation across all trials
```

**Values Shown:**
- **r value:** Correlation coefficient
- **t value:** Statistical significance test
- **\* asterisk:** Significant correlation (p < 0.05)

**What We're Measuring:** Whether hits/misses form patterns at the individual trial level

**Why We're Measuring It:** Detects micro-scale autocorrelation (H2 hypothesis at finest resolution)

**What We Expect If H2 Is Correct:**
- **Positive r at Lag-1:** Hits followed by hits more often than chance
- **Significance:** t > 2.0, marked with *

**Example Interpretation:**
```
Lag 1 trials: r = -0.034 *, t = 6.24
```
- Small negative correlation (hits followed by misses slightly more often)
- Statistically significant but tiny effect size
- Opposite of H2 prediction

---

### Subject-Ghost Cross-Correlation

**What This Section Shows:** Whether subject and ghost outcomes are related (they shouldn't be)

#### Cross-Correlation

**What It Is:** Correlation between subject hits and ghost hits across trials

**How It's Calculated:**
```
r = correlation(subject_trials, ghost_trials)
Where each trial is coded as 1 = hit, 0 = miss
```

**What We're Measuring:** Independence of subject and ghost quantum streams

**Why We're Measuring It:** Ghost is our control - if subject and ghost are correlated, it means:
- Either the quantum source is biased
- Or the bit spacing is too close (bits aren't independent)

**What We Expect (Data Quality Check):**
- **r near 0:** Independent streams ✓
- **|r| > 0.1:** Potential data quality issue ⚠

**Example Interpretation:**
```
r = 0.017, t = 0.82
```
- Near-zero correlation ✓
- Streams are properly independent
- Ghost is a valid control

---

#### Standard Error

**What It Is:** Uncertainty in the correlation estimate

**Interpretation:** Smaller SE = more precise estimate

---

### Spectral Analysis (Dominant Frequencies)

**What This Section Shows:** Whether performance oscillates at regular intervals (detects rhythmic patterns)

#### Sessions Analyzed

**What It Is:** Number of sessions included in frequency analysis

---

#### Avg Dominant Lag

**What It Is:** The most common "cycle length" in performance oscillations

**How It's Calculated:**
```
1. Convert block performance to frequency spectrum (Fourier transform)
2. Find the frequency with highest power
3. Convert back to lag: Lag = 1 / Frequency
```

**Example:** Avg Dominant Lag = 0.2 means oscillations happen every 5 blocks (1/0.2 = 5)

**What We're Measuring:** Rhythmic patterns in performance

**Why We're Measuring It:** Regular oscillations might indicate physiological rhythms (attention cycles, fatigue)

**Interpretation:**
- **Lag = 0.2:** 5-block cycles (not meaningful for most hypotheses)
- **Lag = 1.0:** Block-to-block oscillation (would support feedback mechanism)

---

#### Avg Power

**What It Is:** Strength of the dominant frequency

**Interpretation:**
- **High power:** Strong rhythmic component
- **Low power (< 2):** Mostly random fluctuation

---

### Trial-Level Randomness (Runs Test)

**What This Section Shows:** Same as block-level runs test but at individual trial resolution

#### Z-Statistic

**What It Is:** How many standard deviations the number of runs differs from random expectation

**Example:** Z = 1.620 means 1.62 SD above expected (more runs than random = more alternation)

---

#### P-Value

**What It Is:** Probability this pattern occurred by chance

**Example:** p = 0.1212 means 12.12% chance (not significant)

**Interpretation:**
- **p > 0.05:** Consistent with randomness ✓
- **p < 0.05:** Non-random pattern detected

---

#### Observed Runs / Expected Runs

**What It Is:** Actual count of runs vs statistical expectation

**Example:**
- Observed: 1232 runs
- Expected: 1192.8 runs
- Difference: +39.2 runs (slightly more alternation than expected, but not significant)

---

## Subject vs Ghost Control Comparison

**What This Section Shows:** Side-by-side comparison of subject stream (influenced by participant) vs ghost stream (control) - this is CRITICAL for proving the effect is real and not a data artifact

### Overall Performance

**What This Section Shows:** Basic hit rate comparison

#### Subject Mean / Ghost Mean

**What It Is:** Average hit rate across all blocks for each stream

**How It's Calculated:**
```
Subject Mean = Average of all subject block hit rates
Ghost Mean = Average of all ghost block hit rates
```

**What We're Measuring:** Whether subject performs better than ghost control

**Why We're Measuring It:**
- Subject above Ghost = evidence for PK effect
- Subject ≈ Ghost = no effect
- Both above 50% = biased quantum source (data quality issue)

**What We Expect If Our Hypothesis Is Correct:**
- **Subject Mean:** ≥51.8% (above chance, p < 0.05)
- **Ghost Mean:** ~50% (at chance)
- **Difference:** Positive, favoring subject

---

#### Difference

**What It Is:** Subject Mean - Ghost Mean

**Example:** 50.08% - 51.54% = -1.46%

**Interpretation:** Negative value means ghost performed better (opposite of hypothesis)

---

#### t-statistic

**What It Is:** Statistical test of whether the difference is meaningful

**How It's Calculated:**
```
t = Difference / Standard Error
Degrees of freedom (df) = sample size - 2

Example: t(78) = -1.48 means:
  t-value: -1.48
  df: 78 (likely 40 blocks × 2 streams - 2)
```

**Interpretation:**
- **|t| > 2.0:** Significant difference (p < 0.05)
- **|t| < 2.0:** Difference is within random variation
- **Example: t = -1.48** → Not significant, difference could be chance

---

### Autocorrelation Comparison (Subject vs Ghost)

**What This Section Shows:** Whether subject shows different autocorrelation patterns than ghost (tests if consciousness creates feedback loops)

**How It's Calculated:**
```
For each stream:
  Calculate Lag-1 to Lag-5 autocorrelation (see earlier section)

Δ (Delta) = Subject r - Ghost r
```

**What We're Measuring:** Whether subject stream has more autocorrelation than ghost

**Why We're Measuring It (H2 Hypothesis):**
- If consciousness creates feedback, subject should have HIGHER autocorrelation than ghost
- Ghost should stay near zero (random)

**What We Expect If H2 Is Correct:**
- **Subject Lag-1:** r > 0.2 (positive autocorrelation)
- **Ghost Lag-1:** r ≈ 0 (no autocorrelation)
- **Δ:** Positive values (subject > ghost)

**Example Interpretation:**
```
Lag 1
Subject: -0.0050
Ghost: -0.3433
Δ: +0.3383
```
- Subject has LESS negative autocorrelation than ghost
- Δ is positive, but both values are near zero or negative
- Does NOT support H2 (no positive autocorrelation in subject)

**Key Point:** We're looking for subject to have positive autocorrelation while ghost stays at zero. Both being negative/near-zero suggests no feedback mechanism.

---

### Subject-Ghost Stream Independence

**What This Section Shows:** Validates that subject and ghost quantum streams are truly independent (critical data quality check)

#### Zero-Lag Correlation

**What It Is:** Correlation between subject and ghost at the same time point

**How It's Calculated:**
```
r = correlation(subject_block[i], ghost_block[i]) across all blocks
```

**What We're Measuring:** Whether subject and ghost outcomes are related

**Why We're Measuring It:**
- They MUST be independent (using different quantum bits)
- Correlation would indicate data quality issue

**What We Expect:**
- **r near 0:** ✓ Independent streams
- **|r| > 0.3:** ⚠ Streams are correlated (data problem)

**Example:** r = -0.0235 ✓ Very low correlation, streams are independent

---

#### Max Cross-Correlation / At lag

**What It Is:** Highest correlation found when shifting one stream relative to the other

**How It's Calculated:**
```
Test correlations at:
  Lag -5: ghost[i] vs subject[i-5]
  Lag -4: ghost[i] vs subject[i-4]
  ...
  Lag +5: ghost[i] vs subject[i+5]

Report: Max correlation and which lag it occurred at
```

**What We're Measuring:** Whether streams are correlated at any time offset

**Example:** Max = 0.0000 at lag -5 means even with time shifting, no correlation found ✓

---

#### Stream Quality

**What It Is:** Overall assessment of independence

**Values:**
- **✓ Independent:** Streams properly separated
- **⚠ Correlated:** Potential bit spacing issue

---

### Spectral Analysis Comparison

**What This Section Shows:** Frequency analysis comparison between subject and ghost

#### Subject / Ghost Spectrums

**What Each Shows:**
- **Peak Frequency:** Most dominant oscillation rate (in cycles per block)
- **Total Power:** Overall strength of all frequency components

**Example:**
```
Subject: Peak Freq = 0.2000 cycles/block, Power = 0.023
Ghost: Peak Freq = 0.4750 cycles/block, Power = 0.028
```

**What We're Measuring:** Whether subject and ghost have different oscillatory patterns

**Interpretation:**
- Different peak frequencies = streams have different rhythms (expected if independent)
- Similar power levels = both have comparable signal strength
- Low total power (< 0.1) = mostly random, minimal oscillations

---

### Entropy Correlations

**What This Section Shows:** Whether entropy (randomness quality) predicts performance

#### Entropy-Performance

**What It Is:** Correlation between block entropy and block hit rate

**How It's Calculated:**
```
For each block:
  Calculate Shannon entropy of quantum bits
  Calculate hit rate

r = correlation(entropy, hit_rate) across blocks
```

**What We're Measuring:** Whether randomness quality affects outcomes

**Why We're Measuring It:**
- If r ≈ 0: Performance is independent of data quality ✓
- If |r| > 0.3: Outcomes depend on randomness quality ⚠

**Example:** r = -0.009 (4 blocks) → Near zero, no relationship between entropy and performance ✓

---

#### Entropy Autocorr (Lag 1)

**What It Is:** Correlation between consecutive block entropy values

**What We're Measuring:** Whether randomness quality is stable or fluctuates

**Interpretation:**
- **r near 0:** Entropy varies randomly block-to-block
- **High r:** Entropy is autocorrelated (quality drifts over time)

**Example:** -0.184 → Slight negative autocorrelation, entropy fluctuates somewhat

---

## Data Quality Validation

**What This Section Shows:** Critical quality checks - if these fail, the experiment data is unreliable

### Ghost Control Performance

**What This Section Shows:** Whether the ghost control stream behaves as expected (should be at 50% chance)

#### Ghost Hit Rate

**What It Is:** Overall ghost stream hit rate

**What We're Measuring:** Whether the quantum source is biased

**Why We're Measuring It:**
- Ghost has NO participant influence
- Should stay at 50% ± small random variation
- If ghost ≠ 50%, the quantum source itself is biased

**What We Expect:**
- **49-51%:** ✓ Unbiased quantum source
- **< 49% or > 51%:** ⚠ Systematic bias in quantum source

**Example:** 51.53% (4,768 trials) → Slightly above 50%, need to check significance...

---

#### Ghost Deviation from 50% (p-value)

**What It Is:** Statistical test of whether ghost differs from 50% chance

**How It's Calculated:**
```
Binomial test:
  Null hypothesis: Ghost hit rate = 50%
  Alternative: Ghost hit rate ≠ 50%

Z-score = (Observed - Expected) / Standard Error
P-value = probability of observing this Z by chance
```

**What We Expect:**
- **p > 0.05:** ✓ Ghost is consistent with 50% (good)
- **p < 0.05:** ⚠ Ghost is significantly different from 50% (bias detected)

**Example:** p = 0.034 ⚠
- Ghost is significantly above 50%
- Suggests mild bias in quantum source OR statistical fluke
- Need to monitor this - if persistent, indicates data quality issue

---

#### Z-Score

**What It Is:** How many standard deviations ghost is from 50%

**Example:** Z = 2.114
- Ghost is 2.11 standard deviations above 50%
- Just crosses significance threshold (Z > 1.96 for p < 0.05)

---

### Session Health Metrics

**What This Section Shows:** Overall data quality indicators

#### Data Completion Rate

**What It Is:** Percentage of expected trials that were successfully recorded

**How It's Calculated:**
```
Completion Rate = (Trials Recorded / Trials Expected) × 100
Example: 100.0% means all expected trials are present
```

**What We Expect:**
- **100%:** ✓ Perfect data capture
- **< 95%:** ⚠ Missing data, possible technical issues

---

#### Avg Health Score

**What It Is:** Composite metric combining multiple quality indicators

**How It's Calculated:**
```
Health Score combines:
  - Data completeness
  - Timing consistency
  - System responsiveness
  - Error rates

Average across all sessions
```

**What We Expect:**
- **> 95%:** ✓ High-quality data
- **< 90%:** ⚠ Data quality concerns

**Example:** 98.8% ✓ Excellent data quality

---

## Entropy Signatures

**What This Section Shows:** Deep dive into quantum randomness quality - tests H1 (entropy suppression) and measures randomness of quantum bits

### Shannon Entropy Distribution

**What This Section Shows:** Overall randomness quality of quantum bit sequences

#### Mean Entropy / Std Deviation / Range

**What Entropy Is:**
Shannon entropy measures how random a sequence of bits is:
- **H = 1.0:** Perfectly random (50% ones, 50% zeros, no patterns)
- **H = 0.0:** Perfectly predictable (all ones or all zeros)

**How It's Calculated:**
```
For a window of bits:
  p = proportion of 1s
  H = -p·log₂(p) - (1-p)·log₂(1-p)

Example:
  If 50% ones: H = 1.0 (perfect randomness)
  If 60% ones: H ≈ 0.97 (slightly biased but still mostly random)
  If 90% ones: H ≈ 0.47 (very predictable)
```

**Values Shown:**
- **Mean Entropy:** Average entropy across all windows analyzed
- **Std Deviation:** How much entropy varies between windows
- **Range:** Min and max entropy values observed

**What We're Measuring:** Quality of quantum random number generation

**Why We're Measuring It:**
- High entropy (≈ 1.0) confirms high-quality randomness
- Low entropy (< 0.9) suggests biased or patterned quantum source

**What We Expect:**
- **Mean:** 0.95 - 1.0 (high-quality quantum source)
- **Std Dev:** < 0.01 (consistent quality)

**Example:**
- Mean = 0.9998 ✓ Excellent randomness
- Std = 0.0003 ✓ Very stable
- Range = 0.999 - 1.000 ✓ Consistently high quality

---

#### Total Windows

**What It Is:** Number of entropy windows analyzed

**How It's Calculated:**
```
Each window = 1000-bit segment
Total Windows = Number of 1000-bit segments across all sessions
```

**Example:** 4 windows (suggests limited data - likely only 2 sessions)

---

### H1: Entropy Suppression Test (Subject vs Ghost)

**What This Section Shows:** **PRIMARY TEST OF H1 HYPOTHESIS** - Does consciousness reduce quantum randomness?

**The H1 Hypothesis:**
If consciousness influences quantum bits by reducing randomness:
- **Subject entropy** should be LOWER than ghost entropy
- **Ghost entropy** should stay at 1.0 (perfectly random)
- The difference indicates how much consciousness "orders" the quantum field

#### Sessions (n)

**What It Is:** Number of sessions included in this test

---

#### Mean Diff (Subj - Ghost)

**What It Is:** Average difference in entropy between subject and ghost streams

**How It's Calculated:**
```
For each 1000-bit window:
  subject_entropy = H(subject bits)
  ghost_entropy = H(ghost bits)
  diff = subject_entropy - ghost_entropy

Mean Diff = average of all diffs
```

**What We're Measuring:** Whether subject bits are less random than ghost bits

**Why We're Measuring It:** Core test of H1 - consciousness should REDUCE entropy

**What We Expect If H1 Is Correct:**
- **Mean Diff:** NEGATIVE (subject < ghost)
- **Magnitude:** -0.001 to -0.01 (small but consistent reduction)
- **Example of support:** Mean Diff = -0.005 (subject is less random)

**Example Interpretation:**
```
Mean Diff = +0.002081
```
- **POSITIVE** value means subject entropy > ghost entropy
- **OPPOSITE** of H1 prediction
- Subject bits are MORE random than ghost, not less
- **Does NOT support H1**

---

#### t-statistic / p-value

**What It Is:** Statistical test of whether the entropy difference is meaningful

**How It's Calculated:**
```
Paired t-test:
  t = Mean Diff / (Std Error of differences)
  p = probability of observing this t-value by chance
```

**Interpretation:**
- **t > 2 or t < -2:** Significant difference (p < 0.05)
- **Positive t:** Subject > Ghost
- **Negative t:** Subject < Ghost

**Example:**
```
t = 25.155, p = 0.0000
```
- Highly significant difference
- BUT the difference is in the WRONG direction (subject > ghost)
- Result: Subject entropy SIGNIFICANTLY HIGHER than ghost (opposite of H1)

---

#### Result Statement

**What It Is:** Plain-language interpretation of the test

**Example:** "Result: Subject entropy ≥ Ghost entropy (no suppression) (p < 0.05)"

**Translation:**
- Subject did NOT show reduced entropy
- H1 is NOT supported by this data
- If anything, subject showed INCREASED entropy (unexpected)

---

### H2: Entropy Window Autocorrelation (Lag-1 with Permutation Test)

**What This Section Shows:** **PRIMARY TEST OF H2 HYPOTHESIS** - Does consciousness create patterns in quantum randomness over time?

**The H2 Hypothesis:**
If consciousness creates feedback/redundancy:
- **Entropy should be autocorrelated:** High entropy window followed by high entropy window
- **Positive Lag-1 correlation:** Current window predicts next window
- **This indicates "memory" in the quantum field**

#### Sessions Analyzed

**What It Is:** Number of sessions tested for autocorrelation

---

#### Mean r (Lag-1)

**What It Is:** Average correlation between consecutive entropy windows

**How It's Calculated:**
```
For each session:
  entropy[1], entropy[2], entropy[3], ...
  r = correlation(entropy[i], entropy[i+1])

Mean r = average r across sessions
```

**What We're Measuring:** Whether entropy values are correlated over time

**Why We're Measuring It (H2 Hypothesis):**
- **Positive r:** High entropy → high entropy (patterns/feedback)
- **r ≈ 0:** Each window is independent
- **Negative r:** High entropy → low entropy (oscillation)

**What We Expect If H2 Is Correct:**
- **Mean r:** > 0.2 (positive autocorrelation)
- **Significant sessions:** Most or all sessions show positive r

**Example Interpretation:**
```
Mean r = 0.0000
```
- Zero autocorrelation
- No evidence of feedback or patterns
- **Does NOT support H2**

---

#### Significant Sessions

**What It Is:** Number of sessions showing statistically significant autocorrelation

**How It's Calculated:**
```
Permutation test for each session:
  1. Shuffle window order 10,000 times
  2. Calculate r for each shuffle
  3. Compare observed r to null distribution
  4. If observed r is in top/bottom 5%, mark as significant

Count sessions with p < 0.05
```

**Example:** 0 / 2 sessions significant
- Neither session showed meaningful autocorrelation
- **Does NOT support H2**

---

#### Result Statement

**Example:** "Result: No significant autocorrelation"

**Translation:**
- Entropy windows are independent
- No evidence of feedback loops
- H2 is NOT supported

---

### Trial-Level Entropy Analysis

**What This Section Shows:** Entropy calculated at block level (150 trials) instead of 1000-bit windows - different resolution, same concept

#### Trial-Level Entropy Statistics

**What It Is:** Summary of entropy values calculated for each 150-trial block

**How It's Calculated:**
```
For each block:
  Extract all 150 quantum bits (LSB of each byte)
  Calculate Shannon entropy: H = -p·log₂(p) - (1-p)·log₂(1-p)

Statistics:
  Mean = average entropy across blocks
  Std Deviation = variability in entropy
```

**Values:**
- **Mean Entropy:** 0.9951 (very high randomness)
- **Std Deviation:** 0.0074 (very stable)

**Interpretation:** Block-level entropy is consistently high and stable ✓

---

#### Entropy-Performance Correlation

**What It Is:** Correlation between block entropy and block hit rate

**How It's Calculated:**
```
For each block:
  entropy[i] = Shannon entropy of block i's bits
  hit_rate[i] = hit rate of block i

r = correlation(entropy, hit_rate)
```

**What We're Measuring:** Whether randomness quality affects performance

**Why We're Measuring It:**
- **If r > 0:** Higher randomness → better performance (weird)
- **If r < 0:** Lower randomness → better performance (supports H1!)
- **If r ≈ 0:** No relationship (entropy doesn't affect outcomes)

**What We Expect If H1 Is Correct:**
- **r should be NEGATIVE:** Lower entropy → higher hit rate
- **This would mean better performance happens when bits are less random**

**Example Interpretation:**
```
r = 0.3497
```
- Positive correlation
- Higher entropy → higher performance
- **OPPOSITE of H1 prediction**
- Suggests better performance when bits are MORE random (unexpected)

---

### Conditional Entropy Analysis: High vs Low Performance Blocks

**What This Section Shows:** **CRITICAL TEST** - Compares entropy of quantum bits between high-performing and low-performing blocks to test if PK works through entropy reduction

**The Core PK Hypothesis:**
If consciousness reduces quantum randomness:
- **High-performance blocks (≥52% hits):** Should have LOWER entropy (more ordered)
- **Low-performance blocks (≤48% hits):** Should have HIGHER entropy (more random)
- **Ghost stream:** Should show NO such pattern (validates it's not data artifact)

#### Subject Stream (Target of PK)

**High Performance (≥52%)**

**What It Is:** Average entropy of blocks where hit rate was ≥52%

**How It's Calculated:**
```
1. Filter blocks where hit_rate ≥ 0.52 (78+ hits out of 150)
2. Calculate entropy for each block's quantum bits
3. Average entropy across high-performance blocks
```

**Example:** 0.9945 (n=15)
- 15 blocks qualified as high-performance
- Their average entropy was 0.9945

---

**Low Performance (≤48%)**

**What It Is:** Average entropy of blocks where hit rate was ≤48%

**Example:** 0.9899 (n=11)
- 11 blocks qualified as low-performance
- Their average entropy was 0.9899

---

**Difference (Low - High)**

**What It Is:** How much entropy differs between low and high performance blocks

**How It's Calculated:**
```
Difference = Low Performance Entropy - High Performance Entropy
```

**What We're Measuring:** Whether high performance is associated with lower entropy

**Why We're Measuring It:**
- **Negative difference:** High perf has LOWER entropy (supports H1!)
- **Positive difference:** High perf has HIGHER entropy (opposite of H1)
- **Zero difference:** No relationship

**What We Expect If H1 Is Correct:**
- **Difference should be POSITIVE:** Low entropy happens during high performance
- **OR equivalently: High perf entropy < Low perf entropy**

**Example Interpretation:**
```
Difference = -0.0046
✓ High perf has lower entropy!
```
- **WAIT - this is NEGATIVE, which means:**
  - High perf entropy (0.9945) > Low perf entropy (0.9899)
  - High performance blocks have HIGHER entropy, not lower
- The checkmark is MISLEADING - this actually goes AGAINST H1
- **Does NOT support entropy suppression hypothesis**

*Note: There may be a calculation error in the dashboard display - the checkmark suggests support, but the negative value indicates the opposite*

---

#### Ghost Stream (Control)

**What It Shows:** Same analysis for ghost stream (should show no pattern if effect is real)

**High Performance (≥52%):** 0.9892 (n=19)

**Low Performance (≤48%):** 0.9919 (n=9)

**Difference (Low - High):** +0.0026

**What We're Measuring:** Whether ghost shows the same entropy pattern as subject

**Why We're Measuring It:**
- If subject AND ghost both show same pattern: Data artifact, not real effect
- If subject shows pattern but ghost doesn't: Real effect specific to subject stream
- If they show OPPOSITE patterns: Very strong evidence for real effect

**Example Interpretation:**
```
Ghost Difference = +0.0026
Subject Difference = -0.0046
```
- **Subject and ghost go in OPPOSITE directions**
- This is actually GOOD evidence that something different is happening in subject vs ghost
- However, BOTH patterns contradict H1:
  - Subject: High perf has higher entropy (opposite of H1)
  - Ghost: Low perf has higher entropy (expected if random)
- The divergence is meaningful, but not in the predicted direction

---

### Trial-level entropy analysis uses...

**What This Explanation Box Says:**
"Trial-level entropy analysis uses individual quantum bit sequences from each 150-trial block. Correlation with performance reveals whether quantum randomness quality affects consciousness research outcomes."

**Plain Language:**
We calculate how random the quantum bits are for each block, then check if randomness quality correlates with how well participants perform. This helps us understand if performance depends on having high-quality random numbers, or if consciousness genuinely influences the bits.

---

### Entropy Distribution Histogram

**What This Section Shows:** Visual representation of entropy values, split by early vs late windows (tests H3: temporal progression)

**How to Read It:**
- **X-axis:** Shannon entropy values
- **Y-axis:** Count of windows with that entropy
- **Two distributions:**
  - Early entropy windows (first third of session)
  - Late entropy windows (last third of session)

**What We're Measuring (H3 Hypothesis):**
If consciousness influence strengthens over time:
- **Early windows:** Should have HIGHER entropy (more random)
- **Late windows:** Should have LOWER entropy (more ordered)
- **Distribution shift:** Late should shift LEFT (lower entropy)

**What We Expect If H3 Is Correct:**
- Late entropy distribution shifted to lower values
- Visible separation between early and late

**Example Interpretation:**
```
Both distributions clustered around 0.9995-1.0000
No visible separation
```
- **Does NOT support H3** (no temporal progression in entropy)

---

## Individual Difference Tracking

**What This Section Shows:** Performance broken down by individual participants (useful when you have multiple participants)

### Participant Overview

**Total Participants:** Number of unique participants in dataset

**Mean Hit Rate:** Average hit rate across all participants

**Hit Rate Std Dev:** How much participants vary in performance

**High Performers:** Number of participants above a threshold (e.g., >52%)

---

### Top Participants by Activity

**What It Shows:** Table of individual participant stats

**Columns:**
- **Participant:** Anonymized ID
- **Sessions:** Number of sessions completed
- **Trials:** Total trials completed
- **Hit Rate:** Individual hit rate
- **Avg Entropy:** Average entropy of their quantum bits
- **Conditions:** Experimental conditions they completed

**Why We Track This:**
- Identify high performers vs low performers
- Check if specific participants drive the overall effect
- Detect individual differences in PK ability

---

## Trial-Level Control Validations (Chi-Square Independence)

**What This Section Shows:** The gold-standard statistical tests for whether consciousness influences quantum bits - these are your PRIMARY hypothesis tests

### System Health Metrics

**What This Shows:** Quick summary of control metrics

#### Ghost Hit Rate / Expected

**What It Is:** Ghost control hit rate vs theoretical 50% chance

**What We Expect:**
- Ghost: 49-51% (at chance)
- Subject: >51% (above chance if PK works)

**Example:** Ghost = 51.53%, Expected = 50.00%
- Ghost is 1.53% above chance (check if significant...)

---

#### Data Completion / Avg Health Score

**What They Are:** Data quality metrics (see earlier sections)

---

#### Ghost vs Chance (50%)

**What It Is:** Statistical test of whether ghost differs from 50%

**Example:** p = 0.034 ⚠
- Ghost is significantly above 50% (borderline)
- Suggests slight bias OR statistical fluctuation
- Monitor this - persistent bias indicates data quality issue

---

### Critical Ratio Analysis

**What This Section Shows:** How much subject deviates from chance RELATIVE to how much ghost deviates

#### Average Critical Ratio

**What It Is:**
```
Critical Ratio = (Subject deviation from 50%) / (Ghost deviation from 50%)
```

**How It's Calculated:**
```
Subject deviation = |Subject Hit Rate - 50%|
Ghost deviation = |Ghost Hit Rate - 50%|

Critical Ratio = Subject deviation / Ghost deviation
```

**What We're Measuring:** Whether subject's deviation is larger than ghost's

**Why We're Measuring It:**
- **CR > 1.0:** Subject deviates more than ghost (supports PK)
- **CR ≈ 1.0:** Subject and ghost deviate equally (no effect)
- **CR < 1.0:** Ghost deviates more than subject (unexpected)

**What We Expect If Hypothesis Is Correct:**
- **CR > 1.5:** Strong evidence (subject deviates 50% more than ghost)
- **CR > 2.0:** Very strong evidence

**Example Interpretation:**
```
Average Critical Ratio: 0.275
```
- Subject deviates only 27.5% as much as ghost
- **Well below 1.0** - subject is actually CLOSER to chance than ghost
- **Does NOT support PK hypothesis**

---

#### Session Health Overview (Table)

**What It Shows:** Critical ratio broken down by session

**Columns:**
- **Session:** Anonymized session ID
- **Health Score:** Data quality metric (see earlier)
- **Ghost Rate:** Ghost hit rate for this session
- **Subject Rate:** Subject hit rate for this session
- **Critical Ratio:** Session-specific critical ratio

**Example:**
```
Session FUEf6y90: CR = 0.51 (subject deviates half as much as ghost)
Session 40aDdgMe: CR = 0.04 (subject barely deviates from chance)
```

**Interpretation:** Both sessions show CR < 1.0, no evidence for PK effect

---

### Trial-Level Control Validation

**What This Section Shows:** Multiple independent tests of whether subject and ghost streams are truly independent

#### Subject-Ghost Independence Test

**What It Is:** Cross-correlation between subject and ghost trials

**How It's Calculated:**
```
For all trials:
  subject[i] = 1 if hit, 0 if miss
  ghost[i] = 1 if hit, 0 if miss

r = correlation(subject, ghost)
```

**Cross-Correlation:** r = 0.0174
- Near-zero correlation ✓
- Streams are independent (good data quality)

**Standard Error:** ±0.0302
- Uncertainty in the correlation estimate
- r is well within ±2 SE of zero (not significant)

**Interpretation:** "Close to 0 = Independent" ✓

---

#### Quantum Entropy Independence

**What It Is:** Correlation between subject entropy and ghost entropy across blocks

**How It's Calculated:**
```
For each block:
  subject_entropy[i] = entropy of subject's quantum bits
  ghost_entropy[i] = entropy of ghost's quantum bits

r = correlation(subject_entropy, ghost_entropy)
```

**Entropy Correlation:** r = 0.1609

**What We're Measuring:** Whether subject and ghost have correlated randomness quality

**What We Expect:**
- **r near 0:** Independent entropy ✓
- **r > 0.5:** Correlated entropy (same source variations)

**Example:** r = 0.16
- Low correlation (good independence)
- Block pairs: 40

**Interpretation:** "Low correlation = Independent streams" ✓

---

#### Pearson Correlation (Subject-Ghost Bits)

**What It Is:** Bit-level correlation between subject and ghost quantum bits

**How It's Calculated:**
```
For each session:
  Extract all subject bits and ghost bits
  r = correlation(subject_bits, ghost_bits)

Average r across sessions
```

**Values:**
- **Average r:** -0.0086 (near zero ✓)
- **Min r:** -0.0148
- **Max r:** -0.0024
- **Sessions:** 2

**What We're Measuring:** Whether the quantum bits themselves are correlated

**Why We're Measuring It:**
- Subject uses bits [0, 2, 4, 6...] from quantum stream
- Ghost uses bits [1, 3, 5, 7...] from same stream
- They MUST be independent despite coming from same source

**What We Expect:**
- **r ≈ 0:** Bits are independent ✓
- **|r| > 0.1:** Bit spacing too close (data quality issue)

**Example:** r ≈ -0.009 ✓
- Excellent independence
- "r ≈ 0 = Independent" ✓

---

#### Bit-Level Independence (Chi-Square Tests)

**What This Section Shows:** **PRIMARY STATISTICAL TESTS** for whether subject bits match target more than ghost bits

**How Chi-Square Works:**
```
Create 2×2 table:
                Hit  |  Miss
Subject          a   |   b
Ghost            c   |   d

Chi-square = N × (ad - bc)² / [(a+b)(c+d)(a+c)(b+d)]

If subject hits more than ghost: χ² will be large, p will be small
```

**Three Tests:**
1. **All Tests Combined:** Every trial
2. **Alternating Bits (Odd Trials):** Subject uses bit[0], ghost uses bit[1]
3. **Alternating Bits (Even Trials):** Subject uses bit[1], ghost uses bit[0]

**Why Three Tests:**
- Validates that effect is consistent across bit positions
- Protects against artifacts from how bits are assigned
- Requires consistency for strong evidence

---

**Tests Performed:** Total number of chi-square tests run

**Avg Chi-Square:** Average χ² value
- **Higher χ²:** Larger difference between subject and ghost

**Avg P-Value:** Average probability that difference occurred by chance
- **p < 0.05:** Significant difference (strong evidence)
- **p > 0.05:** Difference is within random variation

**Significant Tests:** Percentage with p < 0.05
- **Expected by chance:** <5%
- **> 50%:** Suggests real effect OR data issue

**Effect Size:** Magnitude of difference (as percentage)

---

**Breakdown by Test Type - Example:**

```
All Tests Combined
Tests: 2
Avg χ²: 3.501
Avg p: 0.0645
50.0% significant
Effect size: 0.39%
```

**Interpretation:**
- χ² = 3.501 is moderate (threshold for significance ≈ 3.84)
- p = 0.0645 is JUST above significance threshold (p < 0.05)
- 50% significant means 1 out of 2 tests was significant
- Effect size 0.39% is small (subject hits 0.39% more than ghost)

**Does NOT clearly support PK hypothesis** (borderline result, needs more data)

---

```
Alternating Bits (Odd Trials)
Tests: 2
Avg χ²: 4.709
Avg p: 0.0311
100.0% significant
Effect size: 0.28%
```

**Interpretation:**
- χ² = 4.709 exceeds threshold ✓
- p = 0.0311 is significant (p < 0.05) ✓
- 100% of tests significant ✓
- Effect size 0.28% is small but consistent

**Odd trials DO show significant effect** - potential evidence for PK

---

```
Alternating Bits (Even Trials)
Tests: 2
Avg χ²: 3.299
Avg p: 0.1015
50.0% significant
Effect size: 0.53%
```

**Interpretation:**
- χ² = 3.299 below significance threshold
- p = 0.1015 not significant (p > 0.05)
- Only 50% significant (1 out of 2)
- Effect size 0.53% larger than odd trials, but not significant

**Even trials do NOT show significant effect**

---

**Overall Interpretation of Bit-Level Tests:**

**What We Expect If PK Hypothesis Is Correct:**
- **All three tests significant:** p < 0.05 across the board
- **Consistent effect sizes:** Similar magnitude in all three tests
- **χ² > 3.84:** Exceeds significance threshold

**Observed Results:**
- **Mixed:** Odd trials significant, even trials not significant
- **Inconsistent:** Effect not stable across bit positions
- **Borderline overall:** Some evidence but not robust

**Conclusion:** Weak/inconsistent evidence - needs more data to confirm

---

**Explanation Box:**

"Alternating bits test temporal correlation (bits 1,2 then 3,4...). Independent bits test statistical independence (separate QRNG calls)."

**Plain Language:**
- **Alternating bits:** Tests odd vs even trials separately to check if bit position matters
- **Purpose:** If only odd trials show effect, suggests artifact from how bits are assigned
- **Ideal:** Both odd and even should show same pattern

---

## Exploratory Signatures

**What This Section Shows:** Advanced pattern detection - looking for rhythms, oscillations, and other signatures not part of main hypotheses

### Oscillation Detection & Spectral Analysis

**What This Section Shows:** Whether performance oscillates at regular intervals (like a wave pattern)

#### Total Data Points / Sessions Analyzed

**What It Is:**
- Data Points: Number of blocks analyzed
- Sessions: Number of sessions

**Example:** 40 data points from 2 sessions = 20 blocks per session

---

#### Overall Trend

**What It Is:** Long-term direction of performance (increasing, decreasing, or flat)

**How It's Calculated:**
```
Linear regression: Hit Rate = m × Block + b
Where:
  m = slope (positive = increasing)
  R² = goodness of fit (1.0 = perfect fit)
```

**Values:**
- **Trend:** Increasing/Decreasing/Flat
- **R²:** How well the trend fits (0-1)

**Example:**
- Trend: Increasing
- R² = 0.001 (essentially no trend - only 0.1% of variance explained)

**Interpretation:** "Increasing" is misleading - R² = 0.001 means performance is essentially flat

---

#### Harmonic Oscillation Analysis

**What This Section Shows:** Whether performance oscillates like a sine wave

**Dominant Frequency**

**What It Is:** The most prominent oscillation rate

**How It's Calculated:**
```
1. Convert block performance to frequency spectrum (Fourier transform)
2. Find peak frequency
3. Units: cycles per block OR cycles per minute
```

**Example:** 0.2500 cycles/minute
- Completes one cycle every 4 minutes (1 / 0.25 = 4)
- Power: 0.251 (strength of this oscillation)

---

**Oscillation Strength**

**What It Is:** How much of the performance variation is due to oscillation

**How It's Calculated:**
```
Strength = (Power of dominant frequency / Total power) × 100
```

**Example:** 0.7%
- Only 0.7% of performance variance is oscillatory
- 99.3% is random fluctuation

**Coherence:** How stable the oscillation is over time

**Interpretation:** 0.7% strength means essentially no meaningful oscillation

---

#### Damped Harmonic Oscillator

**What This Section Shows:** Whether performance oscillates with decreasing amplitude (like a bouncing ball that eventually stops)

**Detected:** YES or NO

**Values if detected:**
- **Damping Factor:** How quickly oscillation decays
- **Natural Freq:** Frequency of oscillation
- **Fit Quality:** How well damped oscillator model fits data

**Example:** Detected = NO
- No evidence of damped oscillation pattern

---

#### Power Spectral Density

**What This Section Shows:** Visual representation of all frequency components in performance

**Hit Rate Spectrum**

**What It Shows:**
- **Peak Frequency:** Dominant oscillation in hit rate
- **Total Power:** Overall signal strength

**Example:**
- Peak: 0.2000 cycles/min (Power: 0.003)
- Total Power: 0.023

**Interpretation:** Very low power (< 0.1) means mostly random, no strong rhythms

---

**Entropy Spectrum**

**What It Shows:** Same analysis for entropy values

**Example:**
- Peak: 0.2500 cycles/min (Power: 0.000)
- Total Power: 0.000

**Interpretation:** Near-zero power means entropy is stable, no oscillations

---

**Overall Interpretation of Exploratory Signatures:**
- **No strong oscillations detected** in either hit rate or entropy
- **No rhythmic patterns** that would suggest physiological cycles
- **Performance is mostly random fluctuation** around mean

---

## Summary: What Do All These Numbers Tell Us?

### Evidence FOR PK Hypothesis:
✓ **Odd trials show significant effect** (p = 0.031, χ² = 4.709)
✓ **Subject-ghost independence validated** (proper experimental controls)
✓ **High-quality randomness** (entropy ≈ 1.0 confirms good quantum source)

### Evidence AGAINST PK Hypothesis:
✗ **Overall hit rate at chance** (50.44%, p = 0.48)
✗ **Ghost performs better than subject** (51.53% vs 50.08%)
✗ **Critical ratio < 1.0** (subject deviates less than ghost)
✗ **No entropy suppression** (H1 not supported - subject entropy ≥ ghost)
✗ **No autocorrelation** (H2 not supported - no feedback patterns)
✗ **No temporal progression** (H3 not supported - no improvement over time)
✗ **Even trials not significant** (inconsistent effect across bit positions)

### Data Quality:
✓ **Excellent data completeness** (100%)
✓ **High health scores** (98.8%)
⚠ **Ghost slightly above 50%** (p = 0.034 - borderline bias in quantum source)

### Overall Conclusion:
**Weak/inconsistent evidence** - Some indicators (odd trials) show promise, but overall pattern does not strongly support PK hypothesis. More data needed to determine if odd-trial effect is real or statistical fluctuation.

---

*Last updated: 2025-10-06*
*Experiment: exp3 (PK Live Pilot v1)*
