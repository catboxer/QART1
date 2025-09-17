// HighScoreEmailGate.jsx
import React, { useMemo, useEffect, useState } from "react";
import HighScoreEmailPrompt from "./HighScoreEmailPrompt";

/**
 * Drop-in gate that shows HighScoreEmailPrompt when the final % >= cutoff.
 *
 * Props:
 * - experiment: "exp0" | "exp1" | "exp2" | "exp3" (affects default cutoff)
 * - step: parent UI step; prompt opens only when step === "done"
 * - sessionId, participantId: optional, passed to the prompt
 * - finalPercent: optional number — if you already have a final % var
 * - spoonLoveStats, fullStackStats: optional objects with { userPercent } (strings or numbers)
 * - cutoffOverride: optional number to override per-experiment cutoff (in percent)
 */
export default function HighScoreEmailGate({
  experiment = "exp2",
  step,
  sessionId,
  participantId,
  finalPercent,
  spoonLoveStats,
  fullStackStats,
  cutoffOverride,
}) {
  // Default percent cutoffs per experiment; tweak once here for all apps
  const CUTOFFS = {
    exp0: 90,
    exp1: 26.7, // Restored from testing
    exp2: 58,   // ≥58/100 for 1-of-2
    exp3: 55,   // placeholder, change if needed
    default: 90,
  };

  // Decide the % to use:
  // 1) explicit finalPercent prop
  // 2) spoonLoveStats.userPercent
  // 3) fullStackStats.userPercent
  const percent = useMemo(() => {
    const asNum = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    return (
      asNum(finalPercent) ??
      asNum(spoonLoveStats?.userPercent) ??
      asNum(fullStackStats?.userPercent)
    );
  }, [finalPercent, spoonLoveStats, fullStackStats]);

  const cutoff =
    typeof cutoffOverride === "number"
      ? cutoffOverride
      : CUTOFFS[experiment] ?? CUTOFFS.default;

  const [show, setShow] = useState(false);

  useEffect(() => {
    console.log('🚪 HighScoreEmailGate useEffect:', {
      step,
      percent,
      cutoff,
      experiment,
      finalPercent,
      spoonLoveStats: spoonLoveStats?.userPercent,
      fullStackStats: fullStackStats?.userPercent
    });

    const shouldTrigger = (step === "done" || step === "final-results");
    if (shouldTrigger && typeof percent === "number" && percent >= cutoff) {
      console.log('✅ Should show email modal: percent', percent, '>=', cutoff);
      setShow(true);
    } else if (!shouldTrigger) {
      setShow(false);
    } else {
      console.log('❌ Not showing email modal:', {
        stepShouldTrigger: shouldTrigger,
        stepValue: step,
        percentIsNumber: typeof percent === "number",
        percentValue: percent,
        cutoffValue: cutoff,
        meetsThreshold: typeof percent === "number" && percent >= cutoff
      });
    }
  }, [step, percent, cutoff]);

  if (!show) return null;

  return (
    <HighScoreEmailPrompt
      experiment={experiment}
      scorePct={typeof percent === "number" ? percent / 100 : undefined}
      sessionId={sessionId}
      participantId={participantId}
      onClose={() => setShow(false)}
    />
  );
}
