import { useEffect, useRef, useState } from "react";

/**
 * MinuteConductor (with live-buffer guardrails)
 * - Alternates Live Stream (LS) and Pre-Recorded (PR) minutes.
 * - 5 Hz ticks (every 200 ms).
 * - Ends a minute when flashesShown >= 300 OR elapsed >= 90s (safety).
 * - LS pulls bits from /live?dur=90000 (Edge SSE), with small rolling buffer.
 * - PR pulls from the tapeBits string you provide.
 *
 * Live buffer policy (Option 1):
 *   - Warm-up: don't start a live minute until buffer ≥ 12 bits (≈2.4 s @5 Hz) or 1.5 s timeout.
 *   - During the minute:
 *       • Pause if buffer < 3 bits; resume when buffer ≥ 10 bits.
 *       • Invalidate/restart the minute if ANY:
 *           pauseCount > 3  OR  totalPausedTime > 1000 ms  OR  longestSinglePause > 600 ms.
 *
 * Props:
 *   totalMinutes: number (e.g., 14)
 *   tapeBits: string of "0"/"1" (≥ 320 bits recommended per PR minute)
 *   startWith: "live" | "pr"  (default "live")
 *   onTick?: (ctx) => void           // called every 200 ms with {minuteIndex, phase, bit, flashesShown, elapsedMs}
 *   onMinuteDone?: (ctx) => void     // called when a minute completes with stats
 *   onBufferingChange?: (isBuffering:boolean) => void // optional: notify parent
 */
export default function MinuteConductor({
  totalMinutes = 14,
  tapeBits = "0101".repeat(200), // ~800 bits default: safe for one PR minute
  startWith = "live",
  onTick,
  onMinuteDone,
  onBufferingChange,
}) {
  // timing
  const TICK_MS = 200;            // 5 Hz
  const TARGET_FLASHES = 300;     // must show at least 300 flashes
  const HARD_CAP_MS = 90_000;     // safety wall per minute
  const LS_DURATION_MS = 90_000;  // ask server for 90s stream

  // live buffer guardrails (auto-scale with TICK_MS if you ever change ISI)
  const WARMUP_BITS_START = 12;                 // need ≥12 bits to start (~2.4s @5Hz) or timeout
  const PAUSE_THRESHOLD_LT = 3;                 // pause if buffer < 3 bits (~0.6s)
  const RESUME_THRESHOLD_GTE = 10;              // resume when buffer ≥ 10 bits (~2.0s)
  const MAX_PAUSES = 3;                         // invalidate if > 3 pauses
  const MAX_TOTAL_PAUSE_MS = 5 * TICK_MS;       // invalidate if total paused > ~1s
  const MAX_SINGLE_PAUSE_MS = 3 * TICK_MS;      // invalidate if any pause ≥ ~600ms
  const WARMUP_TIMEOUT_MS = 1500;               // give the stream up to 1.5s to reach warmup depth

  // state
  const [minuteIndex, setMinuteIndex] = useState(0);  // 0-based, display as +1
  const [phase, setPhase] = useState("idle");         // "idle" | "live" | "pr" | "done"
  const [flashesShown, setFlashesShown] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [lastBit, setLastBit] = useState(null);
  const [lastSource, setLastSource] = useState(null);
  const [isBuffering, setIsBuffering] = useState(false); // overlay flag for live pauses

  // internals (refs avoid stale closures inside the 5 Hz interval)
  const esRef = useRef(null);           // EventSource for LS
  const liveQ = useRef([]);             // FIFO queue of bits from LS (numbers 0/1)
  const tapeIdx = useRef(0);            // index into tapeBits (resets each PR minute)
  const tickTimer = useRef(null);       // 5 Hz interval
  const minuteStart = useRef(0);        // ms timestamp for current minute
  const lastBitRef = useRef(0);         // last emitted bit when we must hold
  const nextPhaseRef = useRef(startWith === "pr" ? "pr" : "live");
  const phaseRef = useRef("idle");
  const flashesRef = useRef(0);

  // live minute underrun tracking
  const pauseCountRef = useRef(0);
  const totalPausedMsRef = useRef(0);
  const longestPauseMsRef = useRef(0);
  const pauseStartedAtRef = useRef(0);

  // helpers
  const stopLS = () => {
    try { esRef.current?.close?.(); } catch { /* no-op */ }
    esRef.current = null;
  };

  const startLS = () => {
    stopLS();
    liveQ.current = [];
    const es = new EventSource(`/live?dur=${LS_DURATION_MS}`);
    esRef.current = es;

    es.addEventListener("bits", (evt) => {
      // Expecting { ts, source, bits }, where bits is a string like "010110..."
      try {
        const data = JSON.parse(evt.data);
        if (data?.source) setLastSource(data.source);
        const bits = (data?.bits || "");
        for (let i = 0; i < bits.length; i++) {
          const ch = bits[i];
          if (ch === "0" || ch === "1") liveQ.current.push(ch === "1" ? 1 : 0);
        }
      } catch {
        // ignore malformed chunk
      }
    });

    // If server ends early, we still keep ticking from what we buffered.
    es.addEventListener("done", () => stopLS());
    es.onerror = () => stopLS();
  };

  // wait until predicate true or until timeout ms elapse
  const waitFor = (pred, timeoutMs) =>
    new Promise((resolve) => {
      const start = performance.now();
      const id = setInterval(() => {
        if (pred() || (performance.now() - start) >= timeoutMs) {
          clearInterval(id);
          resolve();
        }
      }, 25);
    });

  const resetLivePauseCounters = () => {
    pauseCountRef.current = 0;
    totalPausedMsRef.current = 0;
    longestPauseMsRef.current = 0;
    pauseStartedAtRef.current = 0;
    setIsBuffering(false);
  };

  const startMinute = async (kind) => {
    // reset counters for this minute
    setPhase(kind);
    phaseRef.current = kind;
    setFlashesShown(0);
    flashesRef.current = 0;
    setElapsedSec(0);
    setLastBit(null);
    lastBitRef.current = 0;

    if (kind === "live") {
      resetLivePauseCounters();
      startLS();
      // small live warm-up (keeps it clearly "live", not prefetched)
      await waitFor(() => liveQ.current.length >= WARMUP_BITS_START, WARMUP_TIMEOUT_MS);
    } else {
      stopLS();
      tapeIdx.current = 0;
    }
    minuteStart.current = Date.now();
  };

  const endMinute = (reason = "target-or-cap", opts = { restartSameKind: false }) => {
    const ctx = {
      minuteIndex,
      phase,
      flashesShown: flashesRef.current,
      elapsedMs: Date.now() - minuteStart.current,
      reason,
      lastSource,
      liveBuffer: {
        pauseCount: pauseCountRef.current,
        totalPausedMs: totalPausedMsRef.current,
        longestSinglePauseMs: longestPauseMsRef.current,
      },
    };
    stopLS();
    if (onMinuteDone) onMinuteDone(ctx);

    // Decide next minute
    const nextMinute = minuteIndex + 1;

    // If we invalidated a live minute, restart the SAME kind (live) and do NOT advance the index.
    if (opts.restartSameKind) {
      setPhase("idle");
      setTimeout(() => startMinute(phaseRef.current), 500);
      return;
    }

    if (nextMinute >= totalMinutes) {
      setPhase("done");
      clearInterval(tickTimer.current);
      return;
    }

    // Alternate LS <-> PR
    const nextKind = (phaseRef.current === "live") ? "pr" : "live";
    setMinuteIndex(nextMinute);
    setPhase("idle"); // transient while we switch
    setTimeout(() => startMinute(nextKind), 0);
  };

  // choose next bit for PR; live is handled inline to enforce pause policy
  const chooseBitPR = () => {
    if (tapeIdx.current < tapeBits.length) return tapeBits[tapeIdx.current++] === "1" ? 1 : 0;
    return 0; // pad with zeros if tape too short
  };

  // pause/resume helpers (live only)
  const maybePause = (now) => {
    if (!isBuffering && liveQ.current.length < PAUSE_THRESHOLD_LT) {
      setIsBuffering(true);
      pauseCountRef.current += 1;
      pauseStartedAtRef.current = now;
    }
  };
  const maybeResume = (now) => {
    if (isBuffering && liveQ.current.length >= RESUME_THRESHOLD_GTE) {
      const dur = now - pauseStartedAtRef.current;
      totalPausedMsRef.current += dur;
      if (dur > longestPauseMsRef.current) longestPauseMsRef.current = dur;
      setIsBuffering(false);
    }
  };
  const shouldInvalidate = () => {
    return (
      pauseCountRef.current > MAX_PAUSES ||
      totalPausedMsRef.current > MAX_TOTAL_PAUSE_MS ||
      longestPauseMsRef.current > MAX_SINGLE_PAUSE_MS
    );
  };

  // propagate buffering state upward if requested
  useEffect(() => {
    if (typeof onBufferingChange === "function") onBufferingChange(isBuffering);
  }, [isBuffering, onBufferingChange]);

  // main lifecycle
  useEffect(() => {
    // kick off the first minute
    setMinuteIndex(0);
    startMinute(nextPhaseRef.current);

    // 5 Hz ticker
    tickTimer.current = setInterval(() => {
      const now = performance.now();
      const ph = phaseRef.current;
      if (ph !== "live" && ph !== "pr") return;

      // 1) LIVE branch with pause/invalidate guardrails
      if (ph === "live") {
        if (isBuffering) {
          maybeResume(now);
          return; // hold frame; do not consume a bit while buffering
        } else {
          maybePause(now);
          if (isBuffering) return; // we just entered buffering
        }

        // consume next bit FIFO; if queue unexpectedly empty, hold last bit
        const next = liveQ.current.length ? liveQ.current.shift() : lastBitRef.current;
        const bit = (next === 0 || next === 1) ? next : lastBitRef.current;
        lastBitRef.current = bit;

        // render + tick callback
        setLastBit(bit);
        setFlashesShown((c) => c + 1);
        flashesRef.current += 1;
        if (onTick) {
          onTick({
            minuteIndex,
            phase: ph,
            bit,
            flashesShown: flashesRef.current,
            elapsedMs: Date.now() - minuteStart.current,
          });
        }

        // invalidate if guardrails exceeded
        if (shouldInvalidate()) {
          endMinute("invalidated-buffer", { restartSameKind: true });
          return;
        }
      }

      // 2) PR branch (simple FIFO from tape)
      if (ph === "pr") {
        const bit = chooseBitPR();
        lastBitRef.current = bit;
        setLastBit(bit);
        setFlashesShown((c) => c + 1);
        flashesRef.current += 1;
        if (onTick) {
          onTick({
            minuteIndex,
            phase: ph,
            bit,
            flashesShown: flashesRef.current,
            elapsedMs: Date.now() - minuteStart.current,
          });
        }
      }

      // 3) timekeeping + end conditions (applies to both live and pr)
      const elapsed = Date.now() - minuteStart.current;
      setElapsedSec(Math.floor(elapsed / 1000));
      const reachedTarget = flashesRef.current >= TARGET_FLASHES;
      const hitCap = elapsed >= HARD_CAP_MS;
      if (reachedTarget || hitCap) {
        endMinute(reachedTarget ? "300-flashes" : "cap");
      }
    }, TICK_MS);

    // cleanup on unmount
    return () => {
      clearInterval(tickTimer.current);
      stopLS();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once

  // simple status panel + buffering overlay
  return (
    <>
      {isBuffering && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            color: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 24,
            zIndex: 9998,
          }}
          aria-live="polite"
        >
          buffering… (keeping timing)
        </div>
      )}

      <div style={{
        position: "fixed", top: 16, right: 16, padding: 12,
        background: "white", borderRadius: 8, boxShadow: "0 6px 24px rgba(0,0,0,.12)",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif", zIndex: 9999
      }}>
        <div><b>Minute {Math.min(minuteIndex + 1, totalMinutes)}/{totalMinutes}</b> — Phase: {phase.toUpperCase()}</div>
        <div>Flashes this minute: {flashesShown} / {TARGET_FLASHES}</div>
        <div>Elapsed: {elapsedSec}s (cap 90s)</div>
        <div>Last bit: <code>{lastBit ?? "—"}</code> | Last source: <code>{lastSource ?? "—"}</code></div>
        {phase === "live" && (
          <div style={{ marginTop: 6, fontSize: 12, color: "#555" }}>
            Buffer: {liveQ.current.length} • Pauses: {pauseCountRef.current} •
            TotalPaused: {totalPausedMsRef.current | 0}ms • Longest: {longestPauseMsRef.current | 0}ms
          </div>
        )}
      </div>
    </>
  );
}
