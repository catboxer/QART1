# exp3 — PK / CIR²S Experiment Spec
_Last updated: (fill in today’s date)_

This document summarizes the **what** and **why** so you can start a new chat and we’ll be on the same page.

---

## Core Goals
- Compare **Live** vs **Retro (tape)** minutes with strong auditability.
- Test CIR²S mechanisms via **Redundancy** (R0–R2) and **S-Selection** (entropy mapping).
- Maintain experimental hygiene: ghost control, preregistered thresholds, transparent logs.

## Bit Sources (kept interchangeable)
- **Live (SSE)**: one `EventSource('/live?dur=...')` per live minute; FIFO queue.
- **Live (per-tick CSPRNG)**: `crypto.getRandomValues` each tick; 0 network calls. (Optional fallback.)
- **Retro (tape)**: preselected sequences with **commit–reveal** (`H_tape`, `H_commit`).

## Live Buffer Guardrails (Option 1)
- **Warm-up:** start live minute when buffer ≥ **12 bits** (or after **1.5 s**, whichever first).
- **Pause:** if buffer < **3** bits → **pause** UI (show overlay); **resume** when ≥ **10** bits.
- **Invalidate & Restart Same Minute** if **any**:
  - `pauseCount > 3`
  - `totalPausedTime > ~1.0 s` ( = `5 * tick_ms`; tick_ms = 200 at 5 Hz)
  - `longestSinglePause > ~0.6 s` ( = `3 * tick_ms`)
- Logging per minute: `{ pauseCount, totalPausedMs, longestSinglePauseMs, invalidated }`.

## Redundancy Test (single-device, “relative environment”)
- **R0 (Private/Ephemeral):** compute commitment in RAM only; show nothing; no persistence.
- **R1 (Device-Persisted):** save **commit.json** to disk **and** IndexedDB/localStorage; briefly show 8-hex prefix.
- **R2 (Participant-Encoded):** R1 **+** display full commitment (and optional first N tape bits), **speak** 8–12 hex via TTS, and require **typed echo** of the prefix to continue.
- **Prediction (CIR²S):** effect decreases with redundancy: **R0 > R1 > R2**.
- **Primary outcome:** `(subject_hits − ghost_hits) / n` at **lag 0**.
- **Minute logging additions:**
"redundancy": {
"tier": "R0|R1|R2",
"local_copies_count": 0,
"modalities": {"disk":false,"indexeddb":false,"screen":false,"tts":false,"typed_echo":false},
"typed_echo_ok": null,
"h_commit_prefix": ""
}

## S-Selection Test (mapping entropy)
- **High-entropy mapping:** each tick renders a decorrelated pattern (low frame-to-frame mutual info).
- **Low-entropy mapping:** persistent **progress** (e.g., ring/spiral) that changes minimally per tick (high continuity).
- **Hold equal:** luminance, contrast, tick rate, audio, and instructions.
- **Prediction:** **Low-entropy > High-entropy** on primary outcome; per-minute **micro-entropy** negatively correlates with effect.
- **Manipulation checks (per minute):**
  - `frame_delta_entropy` (Shannon of XOR with previous frame) **or**
  - `lz_complexity` / compression ratio of a downsampled frame-delta stream.

## Analysis (preregister)
- **Primary endpoint:** subject − ghost alignment at lag 0.
- **Contrasts:** Redundancy slope < 0; Low-entropy > High-entropy; (optional) Live-Real > Live-Sham; Immediate > Delayed > None.
- **Lag profile:** examine −5..+5; only **lag 0** counts as confirmatory.
- **Sequential plan:** BF10 ≥ 6 to stop early, else max N (define).
- **Exclusions:** apply live invalidation rules; keep logs; retro minutes unaffected.
- **Effect sizes:** report Cohen’s h or risk difference with CIs; include ghost-adjusted estimator.

## Implementation Pointers
- **Minute engine:** one 5 Hz loop; consume exactly one bit per tick.
- **SSE live:** decouple network from tick timing via FIFO; pause UI rather than duplicating bits.
- **Commit–reveal:** precompute `H_tape`, `H_commit`; publish commit before session, reveal after.
- **Hash-chain (optional):** for live, maintain running SHA-256 over emitted bits + timestamps; export final digest.

## UI/UX Notes
- Buffering overlay text: “buffering… (keeping timing)”. Pause consumes **no bits**.
- Keep all other visuals/timing identical across conditions; blind condition names in UI.

## Fields to Persist per Minute (superset)
- `idx, kind (live|retro), n, hits, z, pTwo, ghost_hits, ghost_z, ghost_pTwo`
- `target, prime_condition`
- `tape_meta` (for retro): `{ H_tape, H_commit, tapeId, whichTape }`
- `coherence: { cumRange, hurst }; resonance: { ac1 }`
- `ghost_metrics: { coherence:..., resonance:... }`
- `invalidated, invalid_reason`
- `live_buffer: { pauseCount, totalPausedMs, longestSinglePauseMs }`
- `redundancy: { tier, local_copies_count, modalities, typed_echo_ok, h_commit_prefix }`
- `mapping_type: "high_entropy"|"low_entropy"` and `micro_entropy: number` (if S-Selection run)

---

## Minimal Redundancy API (pseudo)
```ts
type RedundancyInfo = {
  tier: "R0"|"R1"|"R2",
  local_copies_count: number,
  modalities: { disk:boolean, indexeddb:boolean, screen:boolean, tts:boolean, typed_echo:boolean },
  typed_echo_ok: boolean|null,
  h_commit_prefix: string
};

## S-Selection Test (mapping entropy)
- **High-entropy mapping:** each tick renders a decorrelated pattern (low frame-to-frame mutual info).
- **Low-entropy mapping:** persistent **progress** (e.g., ring/spiral) that changes minimally per tick (high continuity).
- **Hold equal:** luminance, contrast, tick rate, audio, and instructions.
- **Prediction:** **Low-entropy > High-entropy** on primary outcome; per-minute **micro-entropy** negatively correlates with effect.
- **Manipulation checks (per minute):**
  - `frame_delta_entropy` (Shannon of XOR with previous frame) **or**
  - `lz_complexity` / compression ratio of a downsampled frame-delta stream.

## Analysis (preregister)
- **Primary endpoint:** subject − ghost alignment at lag 0.
- **Contrasts:** Redundancy slope < 0; Low-entropy > High-entropy; (optional) Live-Real > Live-Sham; Immediate > Delayed > None.
- **Lag profile:** examine −5..+5; only **lag 0** counts as confirmatory.
- **Sequential plan:** BF10 ≥ 6 to stop early, else max N (define).
- **Exclusions:** apply live invalidation rules; keep logs; retro minutes unaffected.
- **Effect sizes:** report Cohen’s h or risk difference with CIs; include ghost-adjusted estimator.

## Implementation Pointers
- **Minute engine:** one 5 Hz loop; consume exactly one bit per tick.
- **SSE live:** decouple network from tick timing via FIFO; pause UI rather than duplicating bits.
- **Commit–reveal:** precompute `H_tape`, `H_commit`; publish commit before session, reveal after.
- **Hash-chain (optional):** for live, maintain running SHA-256 over emitted bits + timestamps; export final digest.

## UI/UX Notes
- Buffering overlay text: “buffering… (keeping timing)”. Pause consumes **no bits**.
- Keep all other visuals/timing identical across conditions; blind condition names in UI.

## Fields to Persist per Minute (superset)
- `idx, kind (live|retro), n, hits, z, pTwo, ghost_hits, ghost_z, ghost_pTwo`
- `target, prime_condition`
- `tape_meta` (for retro): `{ H_tape, H_commit, tapeId, whichTape }`
- `coherence: { cumRange, hurst }; resonance: { ac1 }`
- `ghost_metrics: { coherence:..., resonance:... }`
- `invalidated, invalid_reason`
- `live_buffer: { pauseCount, totalPausedMs, longestSinglePauseMs }`
- `redundancy: { tier, local_copies_count, modalities, typed_echo_ok, h_commit_prefix }`
- `mapping_type: "high_entropy"|"low_entropy"` and `micro_entropy: number` (if S-Selection run)

---

## Minimal Redundancy API (pseudo)
```ts
type RedundancyInfo = {
  tier: "R0"|"R1"|"R2",
  local_copies_count: number,
  modalities: { disk:boolean, indexeddb:boolean, screen:boolean, tts:boolean, typed_echo:boolean },
  typed_echo_ok: boolean|null,
  h_commit_prefix: string
};
type MappingInfo = {
  mapping_type: "high_entropy"|"low_entropy",
  micro_entropy: number  // e.g., bits per pixel of frame deltas, or compression ratio
};

---

### `exp3_logging_checklist.json` (paste anywhere; it’s just a reference, or keep as a comment block in code)

```json
{
  "minute_doc_fields": [
    "idx",
    "kind",
    "n",
    "hits",
    "z",
    "pTwo",
    "ghost_hits",
    "ghost_z",
    "ghost_pTwo",
    "target",
    "prime_condition",
    "tape_meta",
    "coherence",
    "resonance",
    "ghost_metrics",
    "replay",
    "invalidated",
    "invalid_reason",
    "live_buffer",
    "redundancy",
    "mapping_type",
    "micro_entropy"
  ],
  "redundancy_modalities_keys": ["disk", "indexeddb", "screen", "tts", "typed_echo"],
  "invalid_rules": {
    "warmup_bits_start": 12,
    "pause_threshold_lt": 3,
    "resume_threshold_gte": 10,
    "max_pauses": 3,
    "max_total_pause_ms_at_5hz": 1000,
    "max_single_pause_ms_at_5hz": 600
  },
  "primary_outcome": "subject_minus_ghost_at_lag0",
  "primary_predictions": {
    "redundancy": "R0 > R1 > R2 (negative slope)",
    "s_selection": "low_entropy > high_entropy"
  }
}
redundancy: schedule[minuteIdx] === 'retro' ? (window.__lastRedundancyInfo || null) : null,
(Use a useRef instead of window if you prefer; I used window for simplicity.)

2) S-Selection mappings (mosaic vs progress ring) + micro-entropy
Drop this file as experiments/exp3/SSelectionMappings.jsx and replace your FlashPanel with <MappingDisplay .../>.

jsx
Copy code
// experiments/exp3/SSelectionMappings.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

// ===== High-entropy: Mosaic (decorrelated each tick) =====
function HighEntropyMosaic({ bit, width=0, height=0, cols=48, rows=27, onFrameDelta }) {
  const canvasRef = useRef(null);
  const prevRef = useRef(null); // Uint8Array of 0/1 cells

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cw = width || Math.min(900, Math.floor(window.innerWidth*0.9));
    const ch = height || Math.min(600, Math.floor(window.innerHeight*0.8));
    canvas.width = cw; canvas.height = ch;

    const ctx = canvas.getContext("2d", { alpha: false });
    const cellW = Math.floor(cw / cols);
    const cellH = Math.floor(ch / rows);

    // Generate fresh random cells each tick (high frame delta entropy)
    const n = cols * rows;
    const cells = new Uint8Array(n);
    const rnd = new Uint8Array(n);
    crypto.getRandomValues(rnd);
    for (let i = 0; i < n; i++) cells[i] = (rnd[i] & 1);

    // Draw
    let idx = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++, idx++) {
        ctx.fillStyle = cells[idx] ? "#cc0000" : "#008a00"; // red/green palette
        ctx.fillRect(c*cellW, r*cellH, cellW, cellH);
      }
    }

    // Micro-entropy proxy: fraction of changed cells vs previous frame
    if (typeof onFrameDelta === "function") {
      let changed = 1.0; // first frame assume maximal change
      if (prevRef.current && prevRef.current.length === n) {
        let diff = 0;
        for (let i = 0; i < n; i++) if (prevRef.current[i] !== cells[i]) diff++;
        changed = diff / n;
      }
      onFrameDelta(changed);
    }
    prevRef.current = cells;
  }, [bit, width, height, cols, rows, onFrameDelta]);

  return <canvas ref={canvasRef} style={{
    width: width || "90vw", height: height || "80vh",
    borderRadius: 16, boxShadow: "0 8px 40px rgba(0,0,0,0.35)", background: "#000"
  }} />;
}

// ===== Low-entropy: Progress Ring (persistent structure) =====
function LowEntropyProgressRing({
  bit, targetBit=1, width=0, height=0, segments=300, onFrameDelta
}) {
  const canvasRef = useRef(null);
  const progressRef = useRef(0);
  const lastDrawnSegRef = useRef(-1);
  const shimmerRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const size = Math.min(
      width || Math.floor(window.innerWidth*0.9),
      height || Math.floor(window.innerHeight*0.8)
    );
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext("2d", { alpha: false });

    const cx = size/2, cy = size/2;
    const rOuter = size*0.36;
    const rInner = size*0.26;
    const angleStep = (2*Math.PI) / segments;

    // Update state
    let deltaFrac = 0.0;
    if (bit === targetBit) {
      progressRef.current = Math.min(progressRef.current + 1, segments);
      deltaFrac = 1/segments; // one segment changed
      lastDrawnSegRef.current = progressRef.current - 1;
    } else {
      // small reversible shimmer that leaves structure intact
      shimmerRef.current = (shimmerRef.current + 1) % 6;
      deltaFrac = 0.02; // ~2% pixels changed (proxy)
    }

    // Draw background
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, size, size);

    // Placeholder ring (faint)
    ctx.beginPath();
    ctx.arc(cx, cy, (rOuter+rInner)/2, 0, 2*Math.PI);
    ctx.lineWidth = (rOuter - rInner);
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.stroke();

    // Filled segments up to progress
    for (let i = 0; i < progressRef.current; i++) {
      const a0 = -Math.PI/2 + i*angleStep;
      const a1 = a0 + angleStep*0.92;
      ctx.beginPath();
      ctx.arc(cx, cy, (rOuter+rInner)/2, a0, a1);
      ctx.lineWidth = (rOuter - rInner);
      ctx.strokeStyle = "#cc0000"; // red progress
      ctx.lineCap = "butt";
      ctx.stroke();
    }

    // Shimmer overlay (very subtle)
    if (shimmerRef.current) {
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1 + (shimmerRef.current % 2);
      ctx.beginPath();
      ctx.arc(cx, cy, rOuter - 2 - shimmerRef.current, 0, 2*Math.PI);
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
    }

    if (typeof onFrameDelta === "function") onFrameDelta(deltaFrac);
  }, [bit, targetBit, width, height, segments, onFrameDelta]);

  return <canvas ref={canvasRef} style={{
    width: width || "90vw", height: height || "80vh",
    borderRadius: 16, boxShadow: "0 8px 40px rgba(0,0,0,0.35)", background: "#000"
  }} />;
}

// ===== Wrapper that chooses mapping =====
export function MappingDisplay({
  mapping = "low_entropy", // "low_entropy" | "high_entropy"
  bit = 0,
  targetBit = 1,
  width,
  height,
  onFrameDelta // receives fraction changed this tick; you can average per minute
}) {
  if (mapping === "high_entropy") {
    return <HighEntropyMosaic bit={bit} width={width} height={height} onFrameDelta={onFrameDelta} />;
  }
  return <LowEntropyProgressRing bit={bit} targetBit={targetBit} width={width} height={height} onFrameDelta={onFrameDelta} />;
}
How to wire it into MainApp.jsx
Import and replace your FlashPanel:

jsx
Copy code
import { MappingDisplay } from "./SSelectionMappings";
Add a state to pick mapping per minute (randomize or follow a schedule):

jsx
Copy code
const [mappingType, setMappingType] = useState("low_entropy"); // or "high_entropy"
const microEntropyRef = useRef({ sum: 0, count: 0 });

useEffect(() => {
  // choose mapping at the start of each minute (running phase entry)
  if (phase === 'running') {
    const pick = (crypto.getRandomValues(new Uint8Array(1))[0] & 1) ? "low_entropy" : "high_entropy";
    setMappingType(pick);
    microEntropyRef.current = { sum: 0, count: 0 };
  }
}, [phase, minuteIdx]);
In your 'running' render, replace:

jsx
Copy code
<FlashPanel
  bit={bitsThisMinute[bitsThisMinute.length - 1] ?? 0}
  lowContrast={lowContrast}
  patterns={patternsMode}
/>
with:

jsx
Copy code
<MappingDisplay
  mapping={mappingType}
  bit={bitsThisMinute[bitsThisMinute.length - 1] ?? 0}
  targetBit={targetBit}
  onFrameDelta={(fracChanged) => {
    // accumulate a simple “micro-entropy” proxy for the minute
    const m = microEntropyRef.current;
    m.sum += Math.max(0, Math.min(1, fracChanged));
    m.count += 1;
  }}
/>
In persistMinute, include the per-minute micro-entropy:

js
Copy code
const microEntropy = microEntropyRef.current.count
  ? (microEntropyRef.current.sum / microEntropyRef.current.count)
  : null;

await setDoc(mdoc, {
  // ...existing fields...
  mapping_type: mappingType,             // "low_entropy" | "high_entropy"
  micro_entropy: microEntropy,           // lower should correlate with bigger effect
  // redundancy: (already added for retro minutes)
}, { merge: true });
This micro_entropy is a bounded 0–1 proxy (avg fraction of frame changes).

High-entropy mosaic → ~0.5–1.0 per tick.

Low-entropy ring → ~0.02–0.005 per tick (≈ 1/segments).
It’s enough for the preregistered negative correlation check.

What you can test immediately
Redundancy (R0→R2): run several retro minutes in each tier; your primary prediction is R0 > R1 > R2 on (subject−ghost)/n.

S-Selection (mapping): interleave high vs low entropy minutes; prediction is low_entropy > high_entropy and a negative slope of effect vs micro_entropy.

If you want, I can also:

wire the tier randomizer + RedundancyGate directly into your existing rest → startNextMinute() flow,

or add a config flag so you can toggle between FlashPanel and MappingDisplay without editing code again.

# Pre-registration — exp3 (PK / CIR²S)

## Study title
exp3 — Within-participant tests of CIR²S: Redundancy & S-Selection

## Hypotheses (CIR²S-scaffolded)
- H1 (Redundancy): For retro minutes, effect size decreases with in-room/device redundancy: **R0 > R1 > R2** (negative slope over tiers).
- H2 (S-Selection): With identical RNG bits, a **low-entropy (stable)** mapping yields a larger effect than a **high-entropy (complex)** mapping: **Low > High**. Per-minute effect **negatively correlates** with micro-entropy.
- H0 (for each): No ordered effect; slope/contrast = 0.

## Design
- Participants complete alternating **live** and **retro** minutes at 5 Hz (200 ms).  
- **Redundancy** applies to **retro** minutes only:  
  - R0: commitment in RAM only (no persistence).  
  - R1: save commit to disk + IndexedDB; show 8-hex prefix.  
  - R2: R1 + TTS prefix + typed-echo gate.  
- **S-Selection** applies to all minutes: mapping randomized per minute:  
  - Low-entropy: persistent progress (ring/spiral).  
  - High-entropy: decorrelated mosaic.  
- UI luminance/contrast/timing identical across mappings; condition names hidden (“Mode A/B”).

## Outcomes
- Primary minute-level score: \(\hat\theta = (k_\text{subj}-k_\text{ghost})/n\) at lag 0.  
- Secondary diagnostics: lag profile (−5…+5), run-length distribution, lag-1 autocorr, Hurst; per-minute **micro-entropy** (avg frame-delta fraction changed).

## Randomization & Blinding
- Tiers (R0/R1/R2) randomized per retro minute; mappings (Low/High) randomized per minute.  
- Randomness via `crypto.getRandomValues`.  
- Participants blind to tier/mapping labels; R2 is obvious by necessity—collect brief arousal/motivation rating if desired.

## Guardrails & Exclusions
- **Live guardrails** (applied & logged): warm-up ≥12 bits or 1.5 s; pause if buffer<3, resume≥10; invalidate minute if pauses>3 or totalPaused>~1 s or singlePause>~600 ms. Invalid live minutes are restarted.  
- Exclude any minute with <80% planned ticks rendered or software error.  
- Retro minutes not subject to network pauses but still dropped if rendering fails.

## Confirmatory Analyses
- Redundancy slope (retro minutes): mixed model  
  \( \hat\theta_{im} = \beta_0 + \beta_1\mathrm{Tier}_{im} + u_i + \epsilon_{im} \), Tier ∈ {0,1,2}.  
  Test \( \beta_1<0 \) (one-sided); report CI and Bayes factor for ordered alternative.
- S-Selection mapping (all minutes): mixed model  
  \( \hat\theta_{im} = \alpha_0 + \alpha_1\mathrm{Low}_{im} + u_i + \epsilon_{im} \).  
  Test \( \alpha_1>0 \) (one-sided).
- Micro-entropy regression:  
  \( \hat\theta_{im} = \gamma_0 + \gamma_1\mathrm{MicroEntropy}_{im} + u_i + \epsilon_{im} \).  
  Test \( \gamma_1<0 \) (one-sided).
- Lag profile plotted; only lag 0 is confirmatory.

## Statistical Reporting
- Minute z-scores for subject and ghost; primary reports \(\hat\theta\).  
- Effect sizes: risk difference with 95% CIs; optionally Cohen’s h.  
- Bayes factors (JZS) for primary contrasts; preregister priors if informed.  
- Multiplicity: primary contrasts are orthogonal; secondary exploratory.

## Sequential Plan / N
- Sequential Bayes: stop for support at **BF10 ≥ 6**, for null at **BF01 ≥ 6**, or at max N sessions = ____ (fill).  
- Target ≥6 minutes per tier (Redundancy) and ≥6 per mapping (S-Selection) per participant across the study.

## Auditing & Provenance
- Retro: commit–reveal (`H_tape`, `H_commit`, `tapeId`, ISO time).  
- Live: one SSE per minute; FIFO queue; optional live hash-chain digest.  
- Logged per minute: condition tags, random seeds, invalidation flags, buffer stats, redundancy object, mapping_type, micro_entropy.

## Decision Rules
- **Support (facet-level):** primary contrast CI excludes 0 in predicted direction **and** BF10 ≥ 6; manipulation checks pass.  
- **Inconclusive:** CIs cross 0 and 1/3 < BF < 3.  
- **Falsified (facet-level):** effect near 0 with tight CI (SOI = ____), or reliably opposite sign.

## Data & Code
- De-identified data + exact analysis code (hash) released on ____ after lock.  
- Deviations from plan will be documented in a “Deviations” section.

## Notes / Deviations
- (fill after study)

Signatures: PI ________  Date ____   Analyst ________  Date ____
