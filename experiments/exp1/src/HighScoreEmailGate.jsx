// HighScoreEmailGate.jsx
import React, { useMemo, useEffect, useState } from "react";
import HighScoreEmailPrompt from "./HighScoreEmailPrompt";
import { config } from './config.js';

/**
 * Drop-in gate that shows HighScoreEmailPrompt when the final % >= cutoff.
 *
 * Props:
 * - experiment: "exp0" | "exp1" | "exp2" | "exp3" (affects triggering logic)
 * - step: parent UI step; prompt opens only when step === "done" or "final-results"
 * - sessionId, participantId: optional, passed to the prompt
 * - finalPercent: optional number — if you already have a final % var
 * - spoonLoveStats, fullStackStats: optional objects with { userPercent } (strings or numbers)
 * - cutoffOverride: optional number to override per-experiment cutoff (in percent)
 * - pValue: optional number — for exp1/exp2/exp3, triggers on statistical significance (p ≤ 0.05)
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
  pValue,
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
    const shouldTrigger = (step === "done" || step === "final-results");

    // Use statistical significance for this experiment
    const threshold = config.emailSignificanceThreshold || 0.05;
    const isSignificant = typeof pValue === "number" && pValue <= threshold;
    const meetsThreshold = isSignificant || (typeof percent === "number" && percent >= cutoff);

    if (shouldTrigger && meetsThreshold) {
      setShow(true);
    } else if (!shouldTrigger) {
      setShow(false);
    }
  }, [step, percent, cutoff, pValue, experiment, finalPercent, spoonLoveStats, fullStackStats]);

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
