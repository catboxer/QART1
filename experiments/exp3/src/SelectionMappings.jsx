
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
}) {
  const canvasRef = useRef(null);
  const prevRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const cw = width || Math.min(900, Math.floor(window.innerWidth * 0.9));
    const ch = height || Math.min(600, Math.floor(window.innerHeight * 0.8));

    const cellW = Math.floor(cw / cols), cellH = Math.floor(ch / rows);
    // Adjust canvas size to exactly fit the grid
    const actualCW = cellW * cols;
    const actualCH = cellH * rows;

    canvas.width = actualCW;
    canvas.height = actualCH;
    const ctx = canvas.getContext("2d", { alpha: false });
    const n = cols * rows;

        // start from previous frame if we have one
           const prev = prevRef.current || new Uint8Array(n);
         const cells = new Uint8Array(prev); // copy
    
           // flip a fraction of cells depending on the incoming bit
           // (smaller fraction when on-target → more coherent)
           const flipFrac = bit === targetBit ? 0.12 : 0.85;
         const flips = Math.max(1, Math.floor(flipFrac * n));
         for (let k = 0; k < flips; k++) {
             const i = (crypto.getRandomValues(new Uint32Array(1))[0] % n);
             cells[i] ^= 1;
           }

    let idx = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++, idx++) {
        const red = (cells[idx] & 1) === 1;
        ctx.fillStyle = red ? "#cc0000" : "#008a00";
        ctx.fillRect(c * cellW, r * cellH, cellW, cellH);
      }
    }

    if (typeof onFrameDelta === "function") {
             // report actual fraction changed this frame
               let diff = 0;
             for (let i = 0; i < n; i++) if (((cells[i] ^ prev[i]) & 1) === 1) diff++;
             onFrameDelta(diff / n);
           }
         prevRef.current = cells;
       }, [bit, targetBit, width, height, cols, rows, onFrameDelta]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: width || "90vw",
        height: height || "80vh",
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
}) {
  const canvasRef = useRef(null);
  const progressRef = useRef(0);
  const shimmerRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;

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
    const angleStep = (2 * Math.PI) / Math.max(1, segments);
    const mainColor = targetBit === 1 ? "#cc0000" : "#008a00";

    // update progress
    let deltaFrac = 0.0;
    if (bit === targetBit) {
      // add one segment (cap at segments)
      progressRef.current = Math.min(progressRef.current + 1, segments);
      deltaFrac = 1 / Math.max(1, segments);
    } else {
      // a tiny shimmer so it's not completely static when off-target
      shimmerRef.current = (shimmerRef.current + 1) % 6;
      deltaFrac = 0.02;
    }

    // draw
    ctx.fillStyle = "#f5f7fa";
    ctx.fillRect(0, 0, size, size);

    // track
    ctx.beginPath();
    ctx.arc(cx, cy, ringR, 0, 2 * Math.PI);
    ctx.lineWidth = lineW;
    ctx.strokeStyle = "rgba(0,0,0,0.15)";
    ctx.stroke();

    // progress arcs
    ctx.lineCap = "butt";
    ctx.strokeStyle = mainColor;
    ctx.lineWidth = lineW;
    for (let i = 0; i < progressRef.current; i++) {
      const a0 = -Math.PI / 2 + i * angleStep;
      const a1 = a0 + angleStep * 0.92;
      ctx.beginPath();
      ctx.arc(cx, cy, ringR, a0, a1);
      ctx.stroke();
    }

    // subtle shimmer when off-target
    if (shimmerRef.current) {
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1 + (shimmerRef.current % 2);
      ctx.beginPath();
      ctx.arc(cx, cy, rOuter - 2 - shimmerRef.current, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
    }

    if (typeof onFrameDelta === "function") onFrameDelta(deltaFrac);
  }, [bit, targetBit, width, height, segments, onFrameDelta]);

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
}) {
  if (mapping === "high_entropy") {
    return (
      <HighEntropyMosaic
        bit={bit}
        width={width}
        height={height}
        onFrameDelta={onFrameDelta}
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
    />
  );
}
