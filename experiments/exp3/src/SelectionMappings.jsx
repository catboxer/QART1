
import React, { useEffect, useRef } from "react";

/**
 * HighEntropyMosaic — draws a fresh red/green mosaic each tick.
 * onFrameDelta ~ fraction of cells that changed this frame (≈ entropy proxy).
 */
function HighEntropyMosaic({
  bit,
  targetBit = 1,
  width = 0,
  height = 0,
  cols = 48,
  rows = 27,
  onFrameDelta,
  trialOutcomes = [], // Array of actual trial results: true=hit, false=miss
}) {
  const canvasRef = useRef(null);
  const prevRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const cw = width || Math.min(900, Math.floor(window.innerWidth * 0.765));
    const ch = height || Math.min(600, Math.floor(window.innerHeight * 0.68));

    const cellW = Math.floor(cw / cols), cellH = Math.floor(ch / rows);
    // Adjust canvas size to exactly fit the grid
    const actualCW = cellW * cols;
    const actualCH = cellH * rows;

    canvas.width = actualCW;
    canvas.height = actualCH;
    const ctx = canvas.getContext("2d", { alpha: false });
    const n = cols * rows;

    // Create mosaic based on actual trial performance
    const cells = new Uint8Array(n);
    const completedTrials = trialOutcomes.length;

    if (completedTrials > 0) {
      // Fill cells based on actual trial results
      const hitCount = trialOutcomes.filter(hit => hit).length;
      const hitRate = hitCount / completedTrials;


      // Fill first part with actual results
      for (let i = 0; i < Math.min(completedTrials, n); i++) {
        cells[i] = trialOutcomes[i] ? targetBit : (1 - targetBit);
      }

      // If we have more cells than trials, fill remaining based on current live performance ratio
      if (completedTrials < n) {
        for (let i = completedTrials; i < n; i++) {
          // Use current LIVE performance ratio to fill remaining cells
          cells[i] = Math.random() < hitRate ? targetBit : (1 - targetBit);
        }
      }

      // Shuffle to distribute patterns randomly while maintaining proportions
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cells[i], cells[j]] = [cells[j], cells[i]];
      }
    } else {
      // No trials yet - start with neutral 50/50 random pattern
      for (let i = 0; i < n; i++) {
        cells[i] = Math.random() < 0.5 ? 0 : 1;
      }
    }

    // Render the mosaic
    let idx = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++, idx++) {
        const isTargetColor = cells[idx] === targetBit;
        const targetColor = targetBit === 1 ? "#0066CC" : "#FF6600"; // blue or orange
        const nonTargetColor = targetBit === 1 ? "#FF6600" : "#0066CC"; // opposite

        ctx.fillStyle = isTargetColor ? targetColor : nonTargetColor;
        ctx.fillRect(c * cellW, r * cellH, cellW, cellH);
      }
    }

    // Calculate and report frame delta
    if (typeof onFrameDelta === "function") {
      let diff = 0;
      const prev = prevRef.current || new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        if (((cells[i] ^ prev[i]) & 1) === 1) diff++;
      }
      onFrameDelta(diff / n);
    }
    prevRef.current = cells;
  }, [bit, targetBit, width, height, cols, rows, onFrameDelta, trialOutcomes]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: width || "76.5vw",
        height: height || "68vh",
        borderRadius: 16,
        boxShadow: "0 8px 40px rgba(0,0,0,0.35)",
        background: "#f5f7fa",
      }}
    />
  );
}

/**
 * LowEntropyProgressRing — fills ring by one segment each time bit === targetBit.
 * Color follows target: RED => #cc0000, GREEN => #008a00
 * segments should ≈ trials planned in this block (e.g., 75 for 15s@5Hz).
 */
function LowEntropyProgressRing({
  bit,
  targetBit = 1,
  width = 0,
  height = 0,
  segments = 300,
  onFrameDelta,
  trialOutcomes = [], // Array of trial results for accurate tracking
}) {
  const canvasRef = useRef(null);
  const lastTrialCountRef = useRef(0); // Track when trials actually change

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;

    const completedTrials = trialOutcomes.length;

    // ONLY render if trial count actually changed
    if (completedTrials === lastTrialCountRef.current) {
      return; // No change, skip rendering
    }

    lastTrialCountRef.current = completedTrials;

    const size = Math.min(
      width || Math.floor(window.innerWidth * 0.9),
      height || Math.floor(window.innerHeight * 0.8)
    );
    canvas.width = size;
    canvas.height = size;

    // Force canvas to maintain square aspect ratio
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';

    const ctx = canvas.getContext("2d", { alpha: false });

    const cx = size / 2, cy = size / 2;
    const rOuter = size * 0.36, rInner = size * 0.26;
    const lineW = (rOuter - rInner);
    const ringR = (rOuter + rInner) / 2;

    const targetColor = targetBit === 1 ? "#0066CC" : "#FF6600"; // Traditional blue for BLUE, orange for ORANGE
    const nonTargetColor = targetBit === 1 ? "#FF6600" : "#0066CC";

    // Real-time progressive ring: draw segments in trial order
    const totalTrialsPlanned = 150; // Each block has 150 trials
    const angleStep = (2 * Math.PI) / totalTrialsPlanned;

    // Draw background
    ctx.fillStyle = "#f5f7fa";
    ctx.fillRect(0, 0, size, size);

    // Draw track
    ctx.beginPath();
    ctx.arc(cx, cy, ringR, 0, 2 * Math.PI);
    ctx.lineWidth = lineW;
    ctx.strokeStyle = "rgba(0,0,0,0.15)";
    ctx.stroke();

    // Draw boundary line from 12 to 6 o'clock
    ctx.beginPath();
    ctx.moveTo(cx, cy - rOuter - 5);
    ctx.lineTo(cx, cy + rOuter + 5);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(100,100,100,0.6)";
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]); // Reset dash

    // Real-time progressive ring: draw each trial outcome in sequence
    ctx.lineCap = "butt";
    ctx.lineWidth = lineW;

    // Progressive tug-of-war: hits go clockwise, misses go counterclockwise from 12 o'clock
    const hits = trialOutcomes.filter(hit => hit).length;
    const misses = completedTrials - hits;

    // Draw target color segments (hits) - clockwise from 12 o'clock
    if (hits > 0) {
      ctx.strokeStyle = targetColor;
      for (let i = 0; i < hits; i++) {
        const startAngle = -Math.PI / 2 + i * angleStep;
        const endAngle = startAngle + angleStep * 0.9;
        ctx.beginPath();
        ctx.arc(cx, cy, ringR, startAngle, endAngle);
        ctx.stroke();
      }
    }

    // Draw non-target color segments (misses) - counterclockwise from 12 o'clock
    if (misses > 0) {
      ctx.strokeStyle = nonTargetColor;
      for (let i = 0; i < misses; i++) {
        const startAngle = -Math.PI / 2 - i * angleStep;
        const endAngle = startAngle - angleStep * 0.9;
        ctx.beginPath();
        ctx.arc(cx, cy, ringR, startAngle, endAngle, true); // counterclockwise
        ctx.stroke();
      }
    }

    // Calculate frame delta
    const deltaFrac = completedTrials > 0 ? completedTrials / segments : 0.01;
    if (typeof onFrameDelta === "function") onFrameDelta(deltaFrac);
  }, [bit, targetBit, width, height, segments, onFrameDelta, trialOutcomes]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        maxWidth: width || "90vw",
        maxHeight: height || "80vh",
        aspectRatio: "1 / 1",
        borderRadius: 16,
        boxShadow: "0 8px 40px rgba(0,0,0,0.35)",
        background: "#f5f7fa",
        objectFit: "contain",
      }}
    />
  );
}

/**
 * MappingDisplay — chooses which mapping to render this tick.
 * Props:
 *  - mapping: "low_entropy" | "high_entropy"
 *  - bit: current RNG bit (0/1)
 *  - targetBit: 0 (green) or 1 (red)
 *  - segments: expected trials this block (so ring fills to ~100% by the end)
 *  - onFrameDelta: callback for entropy proxy
 */
export function MappingDisplay({
  mapping = "low_entropy",
  bit = 0,
  targetBit = 1,
  width,
  height,
  segments,
  onFrameDelta,
  trialOutcomes = [], // Array of trial results for mosaic
}) {
  if (mapping === "high_entropy") {
    return (
      <HighEntropyMosaic
        bit={bit}
        targetBit={targetBit}
        width={width}
        height={height}
        onFrameDelta={onFrameDelta}
        trialOutcomes={trialOutcomes}
      />
    );
  }
  return (
    <LowEntropyProgressRing
      bit={bit}
      targetBit={targetBit}
      width={width}
      height={height}
      segments={segments}
      onFrameDelta={onFrameDelta}
      trialOutcomes={trialOutcomes}
    />
  );
}
