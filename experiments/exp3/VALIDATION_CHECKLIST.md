# Experiment Validation Checklist

Run through these checks to verify your experiment is working correctly:

## 1. Quantum Source Verification (2 minutes)

**Test:** Start a block and check browser console

✅ **Expected:**
- "🔌 Connecting to quantum stream: /live?dur=90000"
- "📦 Received bits: {source: 'lfdr', bitCount: 2400}"
- Queue size increasing

❌ **If not:** Quantum stream isn't connecting

---

## 2. Trial Counter Verification (30 seconds)

**Test:** Watch the trial counter during a block

✅ **Expected:**
- Counts from 1 → 150 exactly
- Stops at 150
- Never goes above 150

❌ **If not:** Trial loop is broken (we just fixed this!)

---

## 3. Target Randomization (2 minutes)

**Test:** Complete 3 sessions in a row, check console for "🎯 Target Assignment:"

✅ **Expected:**
- Should see mix of BLUE and ORANGE
- Random byte changes each session
- LSB determines target (1=BLUE, 0=ORANGE)

❌ **If not:** Target assignment is stuck

---

## 4. Bit Extraction Verification (30 seconds)

**Test:** Complete one block, check console for "📊 Block Diagnostic:"

✅ **Expected:**
```
lsbDistribution: ~50.0% (between 40-60% is normal for 150 trials)
bitDistribution: ~50.0%
hitRate: ~50.0% (if no PK effect)
```

❌ **If not:** Positional bias detected (we're checking for this)

---

## 5. AC1 Calculation Verification (1 minute)

**Test:** Check QA dashboard after completing session

✅ **Expected:**
- "Feedback Amplification (AC1 on Hit Indicators)" section appears
- Shows values for subject AC1 and ghost AC1
- Both should be close to 0 (between -0.3 and +0.3 for baseline)
- P-value shown

❌ **If not:** AC1 calculation broken

---

## 6. Data Storage Verification (1 minute)

**Test:** Go to Firestore console, open latest session → minutes → minute 0

✅ **Expected:**
```
resonance: {
  ac1: <number between -1 and 1>
  ac1_hits: <number between -1 and 1>
}
ghost_metrics: {
  resonance: {
    ac1: <number>
    ac1_hits: <number>
  }
}
trial_data: {
  subject_bytes: [array of 150 numbers 0-255]
  ghost_bytes: [array of 150 numbers 0-255]
}
```

❌ **If not:** Data not being saved correctly

---

## 7. Core Hypothesis Test (Valid?)

**Your hypothesis:** "After I see my target, am I more likely to see it again?"

**What you're measuring:** AC1 on aligned outcomes (hit indicators)

**Is this the right test?** ✅ YES
- AC1 (autocorrelation lag-1) measures exactly this
- Positive AC1 = clustering (hits followed by hits)
- Negative AC1 = alternation (hits followed by misses)
- Zero AC1 = random (no pattern)

**Statistical validity:** ✅ YES
- Permutation testing is gold standard for this
- 10,000 iterations gives p-value resolution of 0.0001
- Comparing subject vs ghost is proper control

---

## What To Do If Tests Fail

1. **Quantum source fails:** Check Netlify terminal for LFDR errors
2. **Trial counter broken:** Check browser console for multiple "Clearing existing tick timer" warnings
3. **Target stuck:** Hard refresh browser (Cmd+Shift+R)
4. **LSB bias detected:** We have diagnostic in place, will switch to XOR if needed
5. **AC1 calculation wrong:** Check if aligned arrays have correct length (should be 150)

---

## Bottom Line

**Is this experiment valid?** YES - if the 7 checks above pass

**Can you trust AI to build this?** You're NOT just blindly trusting - you're VALIDATING each component

**Next step:** Run through this checklist systematically and tell me which checks FAIL
