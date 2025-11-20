// src/MainApp.jsx
import './App.css';
import React, {
  Component,
  useEffect,
  useRef,
  useState,
  useCallback,
} from 'react';
import { pkConfig as C } from './config.js';
import {
  zFromBinom,
  twoSidedP,
  cumulativeRange,
  hurstApprox,
  lag1Autocorr,
  shannonEntropy,
} from './stats/index.js';
import { db, ensureSignedIn } from './firebase.js';
import {
  collection, doc, addDoc, setDoc, getDoc, getDocs, updateDoc, serverTimestamp,
} from 'firebase/firestore';
import { useLiveStreamQueue } from './useLiveStreamQueue.js';
import { MappingDisplay } from './SelectionMappings.jsx';
import { preQuestions, postQuestions } from './questions.js';
import { QuestionsForm } from './Forms.jsx';
import { BlockScoreboard } from './Scoring.jsx';
import HighScoreEmailGate from './ui/HighScoreEmailGate.jsx';
import ConsentGate from './ui/ConsentGate.jsx';

// Runtime configuration validation
function validateConfig() {
  const errors = [];

  if (!C.VISUAL_HZ || C.VISUAL_HZ <= 0) errors.push('VISUAL_HZ must be positive');
  if (!C.BLOCK_MS || C.BLOCK_MS <= 0) errors.push('BLOCK_MS must be positive');
  if (!C.BLOCKS_TOTAL || C.BLOCKS_TOTAL <= 0) errors.push('BLOCKS_TOTAL must be positive');
  if (C.PRIME_PROB < 0 || C.PRIME_PROB > 1) errors.push('PRIME_PROB must be between 0 and 1');
  if (!Array.isArray(C.TARGET_SIDES) || C.TARGET_SIDES.length === 0) errors.push('TARGET_SIDES must be non-empty array');
  // RETRO_TAPE_BITS validation removed - live streams only

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed: ${errors.join(', ')}`);
  }
}

// Validate configuration on load
validateConfig();

// Error boundary component for data collection protection
class DataCollectionErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Data collection error caught by boundary:', error, errorInfo);
    // Continue experiment - don't crash completely
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20, background: '#ffebee', border: '1px solid #f44336', borderRadius: 8 }}>
          <h3>Data Collection Issue</h3>
          <p>A non-critical error occurred but the experiment continues:</p>
          <code>{this.state.error?.message}</code>
          <button onClick={() => this.setState({ hasError: false, error: null })}>
            Continue Experiment
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// QRNG_URL removed - old prefetch endpoint no longer used

// ===== LIVE QUANTUM BUFFER MANAGEMENT =====
// These parameters control how the experiment handles live quantum random number streams
// to ensure smooth, uninterrupted biofeedback during consciousness research trials.

const TICK_MS = Math.round(1000 / C.VISUAL_HZ);

// BUFFER WARMUP PHASE
// Before starting trials, we accumulate quantum bytes to avoid immediate buffering issues
const WARMUP_BYTES_START = 250;    // Require 250 bytes before starting trials (increased for stability)
const WARMUP_TIMEOUT_MS = 25000;   // Max 25s to wait for warmup (allows time for larger initial buffer)

// BUFFER PAUSE/RESUME THRESHOLDS
// These create a "hysteresis" system to prevent rapid pause/resume cycling
// when quantum stream delivery is inconsistent due to network variability.
//
// CONSCIOUSNESS RESEARCH RATIONALE:
// - Smooth, uninterrupted feedback is critical for consciousness-RNG experiments
// - Participants need consistent 5Hz visual updates to maintain focus
// - Buffer interruptions could contaminate results by breaking concentration
//
// OPTIMIZED 2025-01-18: Increased thresholds to reduce invalidations from 36% → <10%
// Analysis showed ~7-8 blocks/session were being invalidated due to tight buffer constraints
const PAUSE_THRESHOLD_LT = 50;     // PAUSE when buffer < 50 bytes (~25 trials = 5s runway)
                                   // - Increased from 20 bytes to give more buffer runway
                                   // - Prevents premature pausing during normal stream fluctuations

const RESUME_THRESHOLD_GTE = 120;  // RESUME when buffer ≥ 120 bytes (~60 trials = 12s runway)
                                   // - Increased from 50 bytes to ensure robust buffer depth
                                   // - Creates 70-byte hysteresis zone (was 30) to prevent rapid cycling
                                   // - Ensures stream is truly stable before resuming trials

// TRIAL INVALIDATION LIMITS
// If buffering becomes excessive, the trial block is invalidated to maintain data quality
// RELAXED 2025-01-18: More tolerant of transient network issues while maintaining quality
const MAX_PAUSES = 5;                    // Max 5 pause events per 30s block (was 3)
const MAX_TOTAL_PAUSE_MS = 10 * TICK_MS; // Max 2s total pause time per block (was 1s)
const MAX_SINGLE_PAUSE_MS = 5 * TICK_MS; // Max 1s for any single pause event (was 600ms)

const fmtSec = (ms) => `${(ms / 1000).toFixed(ms % 1000 ? 1 : 0)}s`;
const POLICY_TEXT = {
  warmup: `Warm-up until buffer ≥ ${WARMUP_BYTES_START} bytes (~${(WARMUP_BYTES_START / 10).toFixed(1)}s @ 10 bytes/sec)`,
  pause: `Pause if buffer < ${PAUSE_THRESHOLD_LT} bytes`,
  resume: `Resume when buffer ≥ ${RESUME_THRESHOLD_GTE} bytes`,
  guardrails: `Invalidate if >${MAX_PAUSES} pauses, total pauses > ${fmtSec(MAX_TOTAL_PAUSE_MS)}, or any pause > ${fmtSec(MAX_SINGLE_PAUSE_MS)}`
};

// ===== helpers (module scope) =====
// fetchBytes() function removed - dead code from old prefetch model with pseudo-RNG fallback
// All quantum randomness now comes from live SSE stream only
// sha256Hex function removed - no longer needed for live-only mode
// localPairs() function removed - NEVER fall back to pseudo-RNG
// If quantum sources are exhausted, the experiment must fail gracefully with an error message
// bytesToBits function removed - no longer needed for live-only mode
// shuffleInPlace function removed - no longer needed for live-only mode
// makeRedundancyPlan function removed - no longer needed for live-only mode

function ExitDoorButton({ onClick, title = 'Exit and save' }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        zIndex: 9999,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '12px 16px',
        borderRadius: 10,
        background: '#f5f7fa',
        border: '1px solid #ccc',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        cursor: 'pointer',
        fontSize: 16,
        fontWeight: 500,
        color: '#2b2b2b',
        fontFamily: 'inherit',
      }}
    >
      <span role="img" aria-hidden="true" style={{ marginRight: 6, fontSize: 42 }}>🚪</span>
      EXIT
    </button>
  );
}

function bytesToBits(byteArray) {
  // Convert array of bytes (0-255) to array of bits (0/1)
  // Each byte becomes 8 bits
  const bits = [];
  for (const byte of byteArray) {
    // Convert byte to 8-bit binary string, then to array of bits
    const binaryString = byte.toString(2).padStart(8, '0');
    for (let i = 0; i < 8; i++) {
      bits.push(binaryString[i] === '1' ? 1 : 0);
    }
  }
  return bits;
}

function flattenBits(accum) {
  // flatten nested arrays deeply and coerce booleans/strings to numbers 0/1
  // NOTE: This function is for decision bits (already 0/1), NOT for byte conversion
  return accum.flat ? accum.flat(Infinity).map(b => Number(b ? 1 : 0)) :
    accum.reduce((out, item) => out.concat(Array.isArray(item) ? item : [item]), []).map(b => Number(b ? 1 : 0));
}

// Break a bit array into non-overlapping windows and compute entropy per window.
// Leaves any trailing remainder in-place in the accumulator.
// NOTE: accumArray must contain bits (0/1), not bytes (0-255). Use bytesToBits() first if needed.
function extractEntropyWindowsFromAccumulator(accumArray, winSize = 1000) {
  const flat = flattenBits(accumArray);
  if (flat.length > 0 && !flat.every(b => b === 0 || b === 1)) {
    console.warn('⚠️ Entropy accumulator contains non-binary elements (after flatten):', flat.slice(0,20));
    console.warn('This should not happen! Did you forget to convert bytes to bits?');
  }
  const windows = [];
  while (flat.length >= winSize) {
    const w = flat.splice(0, winSize);
    windows.push(shannonEntropy(w));
  }
  // replace original accumulator with the leftover flat array
  accumArray.length = 0;
  accumArray.push(...flat);
  return windows;
}


function CircularGauge({ value = 0.5, targetBit = 1, width = 220, label = 'Short-term avg', subLabel }) {
  const r = Math.round((width * 0.72) / 2);
  const cx = width / 2;
  const cy = r + 16;
  const halfLen = Math.PI * r;
  const pct = Math.round(value * 100);
  const main = targetBit === 1 ? '#0066CC' : '#FF6600';
  const track = '#e6e6e6';
  const text = '#222';
  const d = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const dashArray = `${halfLen} ${halfLen}`;
  const dashOffset = halfLen * (1 - Math.max(0, Math.min(1, value)));
  const tickLen = 8;
  const tickX = cx;
  const tickY1 = cy - r - 2;
  const tickY2 = tickY1 - tickLen;

  return (
    <div style={{
      display: 'inline-block',
      width: width,
      height: r + 72,
      flexShrink: 0,
      overflow: 'visible'
    }}>
      <svg
        width={width}
        height={r + 72}
        viewBox={`0 0 ${width} ${r + 72}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        <path d={d} stroke={track} strokeWidth="14" fill="none" />
        <path d={d} stroke={main} strokeWidth="14" fill="none" strokeLinecap="round"
          style={{ strokeDasharray: dashArray, strokeDashoffset: dashOffset, transition: 'stroke-dashoffset 120ms linear' }} />
        <line x1={tickX} y1={tickY1} x2={tickX} y2={tickY2} stroke="#999" strokeWidth="2" />
        <text x={cx - r} y={cy + 14} textAnchor="start" fontSize="11" fill={targetBit === 1 ? '#FF6600' : '#0066CC'}>0%</text>
        <text x={cx + r} y={cy + 14} textAnchor="end" fontSize="11" fill={main}>100%</text>
        <text x={cx} y={cy - 10} textAnchor="middle" fontSize="22" fill={text} fontWeight="700">{pct}%</text>
        <text x={cx} y={cy + 28} textAnchor="middle" fontSize="12" fill={text} style={{ opacity: 0.8 }}>{label}</text>
        {subLabel ? <text x={cx} y={cy + 44} textAnchor="middle" fontSize="12" fill="#666">{subLabel}</text> : null}
      </svg>
    </div>
  );
}

// ===== main =====
export default function MainApp() {
  // Auto-mode for baseline data collection (activated via URL hash #auto)
  const isAutoMode = window.location.hash.includes('auto');
  const [autoSessionCount, setAutoSessionCount] = useState(0);
  const [autoSessionTarget, setAutoSessionTarget] = useState(C.AUTO_MODE_SESSIONS);

  const [userReady, setUserReady] = useState(false);
  const [uid, setUid] = useState(null);
  const {
    connect: liveConnect,
    disconnect: liveDisconnect,
    popSubjectByte: livePopSubjectByte,
    popGhostByte: livePopGhostByte,
    bufferedBytes: liveBufferedBytes,
    connected: liveConnected,
    lastSource: liveLastSource,
    streamError: liveStreamError,
  } = useLiveStreamQueue({ durationMs: C.LIVE_STREAM_DURATION_MS });

  // ---- toggles
  const [lowContrast, setLowContrast] = useState(C.LOW_CONTRAST_MODE);
  const [patternsMode, setPatternsMode] = useState(true);
  const [debugUI, setDebugUI] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const check = () => setDebugUI(/(#qa|#\/qa|#debug)/i.test(window.location.hash));
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, []);

  // ---- target assignment
  const [target, setTarget] = useState(null);
  // Note: Using trial-level bit strategy (odd=consecutive bytes, even=temporally separated bytes)
  const targetAssignedRef = useRef(false);

  useEffect(() => {
    if (targetAssignedRef.current) {
      return;
    }
    targetAssignedRef.current = true; // Set flag immediately to prevent second execution

    const randomByte = crypto.getRandomValues(new Uint8Array(1))[0];
    const randomBit = randomByte & 1;
    const t = randomBit ? 'BLUE' : 'ORANGE';
    setTarget(t);

    // Note: No session-level bit strategy assignment needed
    // Using trial-level logic: odd trials = consecutive bytes, even trials = temporally separated bytes
  }, []);

  // ---- Monitor for QRNG errors and display alert
  useEffect(() => {
    if (liveStreamError) {
      alert(`❌ ${liveStreamError.message}\n\n${liveStreamError.detail}\n\nThe experiment cannot continue without quantum randomness.`);
      // Stop the experiment
      setIsRunning(false);
      if (tickTimerRef.current) {
        clearInterval(tickTimerRef.current);
        tickTimerRef.current = null;
      }
    }
  }, [liveStreamError]);

  // ---- tapes
  // Tape system removed - all blocks use live streams

  // ---- returning participant (skip preQ on same device)
  // returning participant (skip preQ on same device)
  const [preDone, setPreDone] = useState(() => {
    try { return localStorage.getItem(`pre_done_global:${C.EXPERIMENT_ID}`) === '1'; }
    catch { return false; }
  });
  const [checkedReturning, setCheckedReturning] = useState(false);  // ← add this



  // liveBufRef and nextLiveBufRef removed - old prefetch model no longer used
  // All quantum data now comes from live SSE stream (useLiveStreamQueue)
 
  // ---- sign-in (local-only returning check)
    useEffect(() => {
        (async () => {
         try {
             const u = await ensureSignedIn();
             setUid(u?.uid || null);
             // fast local skip for preQ if they've done it on this device
               try {
                   const globalKey = `pre_done_global:${C.EXPERIMENT_ID}`;
                   if (localStorage.getItem(globalKey) === '1') {
                       setPreDone(true);
                     }
                 } catch { }
           } finally {
             setUserReady(true);
             setCheckedReturning(true);
           }
          })();
      }, []);


  const requireUid = useCallback(async () => {
    const u = await ensureSignedIn();
    if (!u || !u.uid) throw new Error('auth/no-user: sign-in required before writing');
    return u.uid;
  }, []);

  // makeTape function removed - live streams only

  // prepareSessionArtifacts function removed - live streams only

  // ---- schedule (20×150 driven by config: VISUAL_HZ * (BLOCK_MS/1000) should be 150; BLOCKS_TOTAL=20)
  // All blocks are now live - no scheduling needed
  const trialsPerBlock = Math.round((C.BLOCK_MS / 1000) * C.VISUAL_HZ);

  // ---- run doc
  const [runRef, setRunRef] = useState(null);
  const ensureRunDocPromiseRef = useRef(null); // Prevent race conditions
  const isCreatingDocRef = useRef(false); // Immediate flag to prevent race conditions

  const ensureRunDoc = useCallback(async (exitInfo = null) => {
    if (runRef) {
      return runRef;
    }

    // If already creating, wait for the existing promise
    if (isCreatingDocRef.current || ensureRunDocPromiseRef.current) {
      return await ensureRunDocPromiseRef.current;
    }

    // Set flag immediately to block concurrent calls
    isCreatingDocRef.current = true;

    // Create new promise and store it IMMEDIATELY
    const createPromise = (async () => {
      try {
        if (!target) throw new Error('logic/order: target must be set before creating run');
        const uidNow = uid || (await requireUid());
        const col = collection(db, 'experiment3_responses');
        const docData = {
          participant_id: uidNow,
          experimentId: C.EXPERIMENT_ID,
          createdAt: serverTimestamp(),
          target_side: target,
          tape_meta: null, // No tapes in live-only mode
          minutes_planned: C.BLOCKS_TOTAL, // All blocks are live
          timestamp: new Date().toISOString(),
          ...(isAutoMode && { session_type: 'baseline', mode: 'baseline' }), // Mark auto-mode sessions
        };

        // Add exit info if provided
        if (exitInfo) {
          docData.exitedEarly = true;
          docData.exit_reason = exitInfo.reason || 'unspecified';
          docData.exit_reason_notes = exitInfo.notes || null;
          docData.exit_block_index = exitInfo.blockIdx || null;
        } else {
          docData.exitedEarly = false;
          docData.exit_reason = null;
          docData.exit_reason_notes = null;
          docData.exit_block_index = null;
        }

        const docRef = await addDoc(col, docData);
        setRunRef(docRef);
        return docRef;
      } catch (error) {
        console.error('ensureRunDoc: error creating document', error);
        throw error;
      } finally {
        ensureRunDocPromiseRef.current = null; // Clear the promise
        isCreatingDocRef.current = false; // Clear the flag
      }
    })();

    // Store the promise immediately to block concurrent calls
    ensureRunDocPromiseRef.current = createPromise;

    const result = await createPromise;
    return result;
  }, [runRef, target, uid, requireUid, isAutoMode]);

  // ---- phase & per-minute state
  const [phase, setPhase] = useState('consent');
  const [blockIdx, setblockIdx] = useState(-1);
  const [isRunning, setIsRunning] = useState(false);
  // Removed redundant state - using refs as single source of truth for performance
  const [lastBlock, setLastBlock] = useState(null);
  const [totals, setTotals] = useState({ k: 0, n: 0 });
  // eslint-disable-next-line no-unused-vars
  const [renderTrigger, setRenderTrigger] = useState(0); // Force re-renders for ref updates

  const bitsRef = useRef([]);
  const ghostBitsRef = useRef([]);
  const alignedRef = useRef([]);
  const alignedGhostRef = useRef([]); // Ghost hit indicators (aligned ghost bits to target)
  const hitsRef = useRef(0);
  const ghostHitsRef = useRef(0);
  const subjectBytesRef = useRef([]); // Store full bytes (0-255) for entropy
  const ghostBytesRef = useRef([]); // Store full bytes (0-255) for entropy
  const subjectIndicesRef = useRef([]); // Track raw QRNG stream indices
  const ghostIndicesRef = useRef([]); // Track raw QRNG stream indices
  const trialStrategiesRef = useRef([]); // Track which strategy each trial used (1=consecutive, 0=temporally separated)
  const bitPositionRef = useRef(0); // Cyclic bit position counter (0→7→0→7...)
  const subjectBitPositionsRef = useRef([]); // Track which bit position was used for each trial (subject)
  const ghostBitPositionsRef = useRef([]); // Track which bit position was used for each trial (ghost)
  const trialsPerMinute = trialsPerBlock;

  // Auto-mode: Skip consent/questions, auto-restart, and auto-continue rest screens
  useEffect(() => {
    if (!isAutoMode) return;

    if (phase === 'consent' || phase === 'pre_questions' || phase === 'prime' || phase === 'info') {
      setPhase('onboarding');
    } else if (phase === 'rest') {
      const timer = setTimeout(() => {
        startNextMinuteRef.current();
      }, C.AUTO_MODE_REST_MS);
      return () => clearTimeout(timer);
    } else if (phase === 'done') {
      // Skip post-questionnaire in auto-mode, mark completed, and go to results
      if (runRef) {
        setDoc(runRef, { completed: true }, { merge: true }).catch(e =>
          console.warn('Auto-mode completion save error:', e)
        );
      }
      setPhase('results');
    } else if (phase === 'results' || phase === 'summary') {
      // Skip results/summary screens in auto-mode, go to next session
      setPhase('next');
    } else if (phase === 'next') {
      // Immediately transition to avoid re-triggering
      const newCount = autoSessionCount + 1;

      if (newCount < autoSessionTarget) {
        // Reset for next session
        setAutoSessionCount(newCount);
        setPhase('preparing_next');
      } else {
        setAutoSessionCount(newCount); // Update count before showing completion
        setPhase('auto_complete');
      }
    } else if (phase === 'preparing_next') {
      // Delayed reset to ensure clean state transition
      setTimeout(() => {
        setRunRef(null);
        setblockIdx(-1);
        setTotals({ k: 0, n: 0 });
        setLastBlock(null);
        setIsRunning(false);

        // Assign new random target directly (don't rely on useEffect)
        const randomByte = crypto.getRandomValues(new Uint8Array(1))[0];
        const randomBit = randomByte & 1;
        const newTarget = randomBit ? 'BLUE' : 'ORANGE';
        setTarget(newTarget);
        targetAssignedRef.current = true; // Mark as assigned

        setPhase('consent');
      }, 100);
    }
  }, [isAutoMode, phase, autoSessionCount, autoSessionTarget, runRef]);
  const targetBit = target === 'BLUE' ? 1 : 0;
  // Accumulate bits across minutes until we have full windows (e.g., 1000 bits)
  const entropyAccumRef = useRef({ subj: [], ghost: [] });
  // Running store of computed entropy windows (keeps history of windows across the run)
  const entropyWindowsRef = useRef({ subj: [], ghost: [] });
  // Configuration: window size for Shannon entropy (1000-bit standard)
  const ENTROPY_WINDOW_SIZE = 1000;

  // No retro functionality - all blocks are live

  // S-Selection mapping & micro-entropy
  const [mappingType, setMappingType] = useState('low_entropy');
  const microEntropyRef = useRef({ sum: 0, count: 0 });
  useEffect(() => {
    if (phase === 'running') {
      const randomByte = crypto.getRandomValues(new Uint8Array(1))[0];
      const randomBit = randomByte & 1;
      const pick = randomBit ? 'low_entropy' : 'high_entropy';
      setMappingType(pick);
      microEntropyRef.current = { sum: 0, count: 0 };
    }
  }, [phase, blockIdx]);

  // live buffer guardrails
  const [isBuffering, setIsBuffering] = useState(false);
  const pauseCountRef = useRef(0);
  const totalPausedMsRef = useRef(0);
  const longestPauseMsRef = useRef(0);
  const pauseStartedAtRef = useRef(0);
  const redoCurrentMinuteRef = useRef(false);
  const minuteInvalidRef = useRef(false);
  const invalidReasonRef = useRef('');
  const blockStartTimeRef = useRef(0);
  const blockEndTimeRef = useRef(0);
  const previousBlockEndTimeRef = useRef(0);

  const resetLivePauseCounters = useCallback(() => {
    pauseCountRef.current = 0;
    totalPausedMsRef.current = 0;
    longestPauseMsRef.current = 0;
    pauseStartedAtRef.current = 0;
    setIsBuffering(false);
    minuteInvalidRef.current = false;
    invalidReasonRef.current = '';
  }, []);
  const maybePause = useCallback((now) => {
    if (!isBuffering && liveBufferedBytes() < PAUSE_THRESHOLD_LT) {
      setIsBuffering(true);
      pauseCountRef.current += 1;
      pauseStartedAtRef.current = now;
    }
  }, [isBuffering, liveBufferedBytes]);
  const maybeResume = useCallback((now) => {
    if (isBuffering && liveBufferedBytes() >= RESUME_THRESHOLD_GTE) {
      const dur = now - pauseStartedAtRef.current;
      totalPausedMsRef.current += dur;
      if (dur > longestPauseMsRef.current) longestPauseMsRef.current = dur;
      setIsBuffering(false);
    }
  }, [isBuffering, liveBufferedBytes]);
  const shouldInvalidate = useCallback(() => {
    return (
      pauseCountRef.current > MAX_PAUSES ||
      totalPausedMsRef.current > MAX_TOTAL_PAUSE_MS ||
      longestPauseMsRef.current > MAX_SINGLE_PAUSE_MS
    );
  }, []);

  // minute runner plumbing
  const tickTimerRef = useRef(null);
  const endMinuteRef = useRef(() => { });
  const firstTrialTimeRef = useRef(0);
  const lastTrialTimeRef = useRef(0);

  // --- persist & end-minute (persist must be defined BEFORE endMinute) ---
  const persistMinute = useCallback(async () => {
    if (!runRef) return;

    const n = alignedRef.current.length;
    const k = hitsRef.current;
    const kg = ghostHitsRef.current;

    const z = zFromBinom(k, n, 0.5);
    const pTwo = twoSidedP(z);
    const zg = zFromBinom(kg, n, 0.5);
    const pg = twoSidedP(zg);

    const cohRange = cumulativeRange(bitsRef.current);
    const hurst = hurstApprox(bitsRef.current);
    const ac1 = lag1Autocorr(bitsRef.current);
    const ac1_hits = lag1Autocorr(alignedRef.current); // AC1 on hit indicators (feedback amplification test)

    const gCohRange = cumulativeRange(ghostBitsRef.current);
    const gHurst = hurstApprox(ghostBitsRef.current);
    const gAc1 = lag1Autocorr(ghostBitsRef.current);
    const gAc1_hits = lag1Autocorr(alignedGhostRef.current); // AC1 on ghost hit indicators

    // All blocks are live now
    const kind = 'live';
    // ---- Entropy windowing (accumulate & compute 1000-bit windows) ----
    let newSubjWindows = [];
    let newGhostWindows = [];

    try {
      // ONLY accumulate entropy from valid blocks - invalid blocks contaminate the data
      if (!minuteInvalidRef.current) {
        // Convert this minute's BYTES to BITS, then append to accumulators
        if (Array.isArray(subjectBytesRef.current) && subjectBytesRef.current.length) {
          const subjBits = bytesToBits(subjectBytesRef.current);
          const ghostBits = bytesToBits(ghostBytesRef.current);
          entropyAccumRef.current.subj.push(...subjBits);
          entropyAccumRef.current.ghost.push(...ghostBits);

        } else {
          console.warn(`⚠️ Block ${blockIdx}: subjectBytesRef.current is empty or not an array!`, {
            isArray: Array.isArray(subjectBytesRef.current),
            length: subjectBytesRef.current?.length,
            sample: subjectBytesRef.current?.slice(0, 5)
          });
        }

        // Extract any completed windows
        newSubjWindows = extractEntropyWindowsFromAccumulator(entropyAccumRef.current.subj, ENTROPY_WINDOW_SIZE);
        newGhostWindows = extractEntropyWindowsFromAccumulator(entropyAccumRef.current.ghost, ENTROPY_WINDOW_SIZE);

        // Append to running windows history
        if (newSubjWindows.length) entropyWindowsRef.current.subj.push(...newSubjWindows);
        if (newGhostWindows.length) entropyWindowsRef.current.ghost.push(...newGhostWindows);
      }

    } catch (entropyErr) {
      console.warn('entropy-windowing failed', entropyErr);
    }

    // Block-level entropy calculations (150 bits per block)
    const blockBits = bitsRef.current.length;
    const blockSubjEntropy = blockBits > 0 ? shannonEntropy(bitsRef.current) : null;
    const blockGhostEntropy = ghostBitsRef.current.length > 0 ? shannonEntropy(ghostBitsRef.current) : null;

    // Block-level k2 split: [first 75 bits, last 75 bits]
    const half = Math.floor(blockBits / 2);
    const blockK2Subj = blockBits >= 50 ? [
      shannonEntropy(bitsRef.current.slice(0, half)),
      shannonEntropy(bitsRef.current.slice(half))
    ] : null;
    const blockK2Ghost = ghostBitsRef.current.length >= 50 ? [
      shannonEntropy(ghostBitsRef.current.slice(0, half)),
      shannonEntropy(ghostBitsRef.current.slice(half))
    ] : null;

    // Block-level k3 split: [early 50, middle 50, late 50]
    const third = Math.floor(blockBits / 3);
    const blockK3Subj = blockBits >= 50 ? [
      shannonEntropy(bitsRef.current.slice(0, third)),
      shannonEntropy(bitsRef.current.slice(third, 2 * third)),
      shannonEntropy(bitsRef.current.slice(2 * third))
    ] : null;
    const blockK3Ghost = ghostBitsRef.current.length >= 50 ? [
      shannonEntropy(ghostBitsRef.current.slice(0, third)),
      shannonEntropy(ghostBitsRef.current.slice(third, 2 * third)),
      shannonEntropy(ghostBitsRef.current.slice(2 * third))
    ] : null;


    // Session-level temporal entropy is calculated in calculateSessionTemporalEntropy()
    // at session end, not per-block


    const mdoc = doc(runRef, 'minutes', String(blockIdx));

    const blockSummary = { k, n, z, pTwo, kg: ghostHitsRef.current, ng: n, zg, pg, kind };
    setLastBlock(blockSummary);
    setTotals((t) => ({ k: t.k + k, n: t.n + n }));


    await setDoc(mdoc, {
      idx: blockIdx,
      kind,
      ended_by: 'timer',
      startedAt: serverTimestamp(),
      n, hits: k, z, pTwo,
      ghost_hits: kg, ghost_z: zg, ghost_pTwo: pg,
      // No tape metadata for live streams
      coherence: { cumRange: cohRange, hurst },
      resonance: { ac1, ac1_hits }, // AC1 on bits and AC1 on hit indicators
      ghost_metrics: {
        coherence: { cumRange: gCohRange, hurst: gHurst },
        resonance: { ac1: gAc1, ac1_hits: gAc1_hits } // Ghost AC1 on bits and hits
      },
      mapping_type: mappingType,
      // Block-level timing (replaces per-trial timestamps)
      timing: {
        block_start_time: blockStartTimeRef.current,
        block_end_time: blockEndTimeRef.current,
        block_duration_ms: blockEndTimeRef.current - blockStartTimeRef.current,
        pause_before_block_ms: previousBlockEndTimeRef.current > 0
          ? blockStartTimeRef.current - previousBlockEndTimeRef.current
          : 0,
        first_trial_time: firstTrialTimeRef.current,
        last_trial_time: lastTrialTimeRef.current,
      },
      micro_entropy: microEntropyRef.current.count ? (microEntropyRef.current.sum / microEntropyRef.current.count) : null,
      entropy: {
        // 1000-bit windows (computed across session as bits accumulate)
        new_windows_subj: newSubjWindows.map((entropy, index) => {
          const globalWindowIndex = entropyWindowsRef.current.subj.length + index;
          const bitIndexCenter = globalWindowIndex * ENTROPY_WINDOW_SIZE + (ENTROPY_WINDOW_SIZE / 2);
          return {
            entropy,
            windowIndex: globalWindowIndex,
            bitIndexCenter,  // Center of window for uniform bit-time axis (e.g., 500, 1500, 2500, ...)
            timestamp: blockStartTimeRef.current
          };
        }),
        new_windows_ghost: newGhostWindows.map((entropy, index) => {
          const globalWindowIndex = entropyWindowsRef.current.ghost.length + index;
          const bitIndexCenter = globalWindowIndex * ENTROPY_WINDOW_SIZE + (ENTROPY_WINDOW_SIZE / 2);
          return {
            entropy,
            windowIndex: globalWindowIndex,
            bitIndexCenter,  // Center of window for uniform bit-time axis (e.g., 500, 1500, 2500, ...)
            timestamp: blockStartTimeRef.current
          };
        }),

        // Block-level entropy (150 bits per block)
        block_entropy_subj: blockSubjEntropy,
        block_entropy_ghost: blockGhostEntropy,
        block_k2_subj: blockK2Subj,
        block_k2_ghost: blockK2Ghost,
        block_k3_subj: blockK3Subj,
        block_k3_ghost: blockK3Ghost,
        bits_count: blockBits,
      },
      // No redundancy tracking for live streams
      invalidated: minuteInvalidRef.current || false,
      invalid_reason: minuteInvalidRef.current ? invalidReasonRef.current : null,
      live_buffer: kind === 'live' ? {
        pauseCount: pauseCountRef.current,
        totalPausedMs: Math.round(totalPausedMsRef.current),
        longestSinglePauseMs: Math.round(longestPauseMsRef.current),
      } : null,
      // Store trial sequences as arrays (much more efficient than subcollection)
      trial_data: {
        subject_bits: bitsRef.current, // Decision bits (0 or 1) for trial outcome
        ghost_bits: ghostBitsRef.current, // Ghost decision bits
        subject_bytes: subjectBytesRef.current, // Full bytes (0-255) for entropy calculation
        ghost_bytes: ghostBytesRef.current, // Ghost full bytes
        subject_raw_indices: subjectIndicesRef.current,
        ghost_raw_indices: ghostIndicesRef.current,
        trial_strategies: trialStrategiesRef.current, // 1=consecutive, 0=temporally separated (for chi-square test separation)
        subject_bit_positions: subjectBitPositionsRef.current, // Bit positions used (0-7) for positional bias detection
        ghost_bit_positions: ghostBitPositionsRef.current, // Bit positions used (0-7) for positional bias detection
        source_label: liveLastSource || 'unknown',
        target_bit: targetBit,
        trial_count: bitsRef.current.length
        // Outcomes can be calculated: subject_bits[i] === target_bit ? 1 : 0
      }
    }, { merge: true });


    // Update previous block end time for next block's pause calculation
    previousBlockEndTimeRef.current = blockEndTimeRef.current;
  }, [
    runRef, blockIdx, mappingType, targetBit, liveLastSource
  ]);

  const endMinute = useCallback(async () => {
    // Capture block end time FIRST, before any async operations
    blockEndTimeRef.current = Date.now();

    // Keep stream connected across blocks - only disconnect at session end
    // (Disconnecting between blocks wastes quota on repeated warmup calls)
    setIsRunning(false);
    await persistMinute();
    if (minuteInvalidRef.current) { setPhase('rest'); return; }
    // Always go to rest phase first, even for the final block
    setPhase('rest');
  }, [persistMinute]);
  // Idle prefetch during PRIME/REST in non-streaming mode
  // Prefetch useEffect removed - dead code since USE_LIVE_STREAM is always true
  useEffect(() => {
    endMinuteRef.current = endMinute;
  }, [endMinute]);

  // minute tick loop
  useEffect(() => {
    if (!isRunning) return;
    const TICK = Math.round(1000 / C.VISUAL_HZ);
    const MAX_TRIALS = trialsPerMinute; // Should be exactly 150 trials
    // All blocks use live streaming now - no prefetch buffer check needed

    let i = 0;
    const start = Date.now();
    if (tickTimerRef.current) {
      console.warn('⚠️ Clearing existing tick timer before starting new one!');
      clearInterval(tickTimerRef.current);
      tickTimerRef.current = null;
    }

    tickTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      const hitCap = elapsed >= (C.BLOCK_MS + 5000);

      // Debug logging every 10 trials
      if (i % 10 === 0 || i >= MAX_TRIALS - 5) {
      }

      if (i >= MAX_TRIALS) {
        clearInterval(tickTimerRef.current);
        tickTimerRef.current = null;
        endMinuteRef.current?.();
        return;
      }

      if (hitCap) {
        console.warn('⏱️ TIMEOUT - STOPPING TRIALS:', {
          trialCount: i,
          MAX_TRIALS,
          elapsed,
          actualTrials: alignedRef.current.length,
          missedTrials: MAX_TRIALS - i
        });
        clearInterval(tickTimerRef.current);
        tickTimerRef.current = null;
        endMinuteRef.current?.();
        return;
      }

      let bit, ghost, subjectRawIndex, ghostRawIndex, subjectByte, ghostByte;
      if (C.USE_LIVE_STREAM) {
        const now = performance.now();
        if (isBuffering) { maybeResume(now); return; } // Don't increment i when buffering
        else { maybePause(now); if (isBuffering) { return; } } // Don't increment i when buffering starts
        // Use trial-level BYTE strategy: odd trials = consecutive, even trials = temporally separated
        const trialNumber = i + 1; // Convert 0-based to 1-based for odd/even logic
        const sByteObj = livePopSubjectByte(trialNumber); const gByteObj = livePopGhostByte(trialNumber);
        if (sByteObj === null || gByteObj === null) {
          console.warn('🔴 NULL BYTES DETECTED - pausing:', {
            trialNumber,
            sByteObj, gByteObj,
            bufferSize: liveBufferedBytes(),
            isBuffering
          });
          maybePause(now);
          return;
        } // Don't increment i when no bytes available

        // Extract byte values and indices
        subjectByte = sByteObj.byte;
        ghostByte = gByteObj.byte;
        subjectRawIndex = sByteObj.rawIndex;
        ghostRawIndex = gByteObj.rawIndex;

        // Extract 1 bit for trial decision using CYCLIC position selection (0→7→0→7...)
        // Cycles through all 8 bit positions to average out any positional bias
        // Track positions to enable positional bias detection in QA dashboard
        const bitPos = bitPositionRef.current % 8;
        bit = (subjectByte >> bitPos) & 1;
        ghost = (ghostByte >> bitPos) & 1;

        // Store positions used for this trial (for bias analysis)
        subjectBitPositionsRef.current.push(bitPos);
        ghostBitPositionsRef.current.push(bitPos);

        // Increment position counter for next trial
        bitPositionRef.current += 1;

        if (shouldInvalidate()) {
          minuteInvalidRef.current = true; invalidReasonRef.current = 'invalidated-buffer';
          redoCurrentMinuteRef.current = true;
          clearInterval(tickTimerRef.current); tickTimerRef.current = null;
          endMinuteRef.current?.(); return;
        }
      }
      // Note: else branch removed - USE_LIVE_STREAM is always true

      // Only process trial and increment counter when we have valid data
      const now = Date.now();
      // Capture first trial timestamp
      if (i === 0) {
        firstTrialTimeRef.current = now;
      }

      bitsRef.current.push(bit);
      ghostBitsRef.current.push(ghost);
      if (C.USE_LIVE_STREAM) {
        // Store full bytes (0-255) for entropy calculation
        subjectBytesRef.current.push(subjectByte);
        ghostBytesRef.current.push(ghostByte);
        subjectIndicesRef.current.push(subjectRawIndex);
        ghostIndicesRef.current.push(ghostRawIndex);
        // Track strategy: 1=consecutive (odd trials), 0=temporally separated (even trials)
        const trialNumber = i + 1;
        trialStrategiesRef.current.push(trialNumber % 2 === 1 ? 1 : 0);
      }
      const align = bit === targetBit ? 1 : 0;
      const alignGhost = ghost === targetBit ? 1 : 0;
      alignedRef.current.push(align);
      alignedGhostRef.current.push(alignGhost); // Store ghost hit sequence
      hitsRef.current += align;
      ghostHitsRef.current += alignGhost;

      // Trigger re-render for UI updates
      setRenderTrigger(prev => prev + 1);

      // Update last trial timestamp (will be final value when loop completes)
      lastTrialTimeRef.current = now;

      i += 1; // Only increment when we actually process a trial
    }, TICK);

    return () => { if (tickTimerRef.current) { clearInterval(tickTimerRef.current); tickTimerRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isRunning, blockIdx, trialsPerMinute, targetBit, target,
    livePopSubjectByte, livePopGhostByte, liveBufferedBytes, maybePause, maybeResume, shouldInvalidate, trialsPerBlock,
    // NOTE: isBuffering deliberately EXCLUDED from deps - tick loop handles buffering internally via early returns
    // Including it causes the tick loop to restart on every buffer state change, resulting in 200+ trials
  ]);


  // Prepare next block (warmup / load buffers)
  const ensureNextBlockReady = useCallback(async () => {
    // All blocks are live now
    // STREAMING: warm up buffer, no prefetch
    if (C.USE_LIVE_STREAM) {
      if (!liveConnected) { liveConnect(); }
      const t0 = Date.now();
      // Wait for buffer to fill with enough bytes before starting trials
      while (Date.now() - t0 < WARMUP_TIMEOUT_MS &&
        liveBufferedBytes() < WARMUP_BYTES_START) {
        await new Promise((r) => setTimeout(r, 50));
      }
      // Reset pause counters inline to avoid circular dependency
      pauseCountRef.current = 0;
      totalPausedMsRef.current = 0;
      longestPauseMsRef.current = 0;
      pauseStartedAtRef.current = 0;
      setIsBuffering(false);
      minuteInvalidRef.current = false;
      invalidReasonRef.current = '';
      return;
    }

    // NON-STREAM (prefetch model) - NOT USED, left for backwards compatibility only
    // This code path should never execute since USE_LIVE_STREAM is always true
    throw new Error('Prefetch model is deprecated - USE_LIVE_STREAM must be true');

  }, [
    // streaming deps only - prefetch model is deprecated
    liveConnected, liveConnect, liveBufferedBytes, setIsBuffering,
  ]);

  // Calculate and save session-level temporal entropy (k=2 and k=3 windows)
  const calculateSessionTemporalEntropy = useCallback(async () => {
    if (!runRef) return;

    try {
      const allSubjectBits = [];
      const allGhostBits = [];

      // Fetch all minutes to get their indices
      const minutesSnapshot = await getDocs(collection(runRef, 'minutes'));
      const sortedMinutes = minutesSnapshot.docs
        .map(d => ({ id: d.id, ref: d.ref, data: d.data(), idx: d.data().idx || 0 }))
        .sort((a, b) => a.idx - b.idx);

      // For each minute, read trial_data field (NOT trials subcollection - that's old structure)
      for (const minute of sortedMinutes) {
        const trialData = minute.data.trial_data;

        if (trialData?.subject_bits && Array.isArray(trialData.subject_bits)) {
          // Use decision bits (0/1) for temporal entropy
          allSubjectBits.push(...trialData.subject_bits);
          allGhostBits.push(...trialData.ghost_bits);
        } else {
          console.warn(`⚠️ No trial_data found for minute ${minute.idx}`);
        }
      }

      const n = allSubjectBits.length;

      if (n === 0) {
        console.warn('No subject bits found for session-level entropy calculation');
        return;
      }

      // NEW: Aggregate block-level entropy trajectories for H(t) fitting
      const allBlockEntropySubj = [];
      const allBlockEntropyGhost = [];

      // Extract block-level entropy from each minute (data already fetched above)
      for (const minute of sortedMinutes) {
        const minuteData = minute.data;

        if (minuteData?.entropy?.block_entropy_subj !== undefined) {
          allBlockEntropySubj.push({
            blockIdx: minuteData.idx, // Use minute.idx, not entropy.block_idx (which doesn't exist)
            entropy: minuteData.entropy.block_entropy_subj,
            timestamp: minuteData.timing?.block_start_time || minuteData.timing?.first_trial_time
          });
        }

        if (minuteData?.entropy?.block_entropy_ghost !== undefined) {
          allBlockEntropyGhost.push({
            blockIdx: minuteData.idx, // Use minute.idx, not entropy.block_idx (which doesn't exist)
            entropy: minuteData.entropy.block_entropy_ghost,
            timestamp: minuteData.timing?.block_start_time || minuteData.timing?.first_trial_time
          });
        }
      }


      // Minimum window size for meaningful entropy calculation
      const MIN_WINDOW_SIZE = 500;

      // k=2: split into first/second half (1500/1500 for 3000 bits)
      const half = Math.floor(n / 2);
      if (half < MIN_WINDOW_SIZE) {
        console.warn(`Insufficient bits for k=2 temporal entropy: ${n} bits (need ${MIN_WINDOW_SIZE * 2}+ for meaningful windows)`);
        return;
      }
      const entropy_k2 = [
        shannonEntropy(allSubjectBits.slice(0, half)),
        shannonEntropy(allSubjectBits.slice(half, n))
      ];
      const ghost_entropy_k2 = [
        shannonEntropy(allGhostBits.slice(0, half)),
        shannonEntropy(allGhostBits.slice(half, n))
      ];

      // k=3: split into thirds (1000/1000/1000 for 3000 bits)
      const third = Math.floor(n / 3);
      if (third < MIN_WINDOW_SIZE) {
        console.warn(`Insufficient bits for k=3 temporal entropy: ${n} bits (need ${MIN_WINDOW_SIZE * 3}+ for meaningful windows)`);
        return;
      }
      const entropy_k3 = [
        shannonEntropy(allSubjectBits.slice(0, third)),
        shannonEntropy(allSubjectBits.slice(third, 2 * third)),
        shannonEntropy(allSubjectBits.slice(2 * third, n))
      ];
      const ghost_entropy_k3 = [
        shannonEntropy(allGhostBits.slice(0, third)),
        shannonEntropy(allGhostBits.slice(third, 2 * third)),
        shannonEntropy(allGhostBits.slice(2 * third, n))
      ];


      // Save to session document
      await setDoc(runRef, {
        entropy: {
          temporal: {
            subj_bits_count: n,
            entropy_k2: entropy_k2,
            entropy_k3: entropy_k3,
            ghost_entropy_k2: ghost_entropy_k2,
            ghost_entropy_k3: ghost_entropy_k3,
          },
          temporal_trajectories: {
            block_level_subj: allBlockEntropySubj,
            block_level_ghost: allBlockEntropyGhost,
            // This enables H_subject(t) and H_ghost(t) fitting for thermalization analysis
          }
        }
      }, { merge: true });


      // Reset all accumulators to prevent bleed into next session
      bitsRef.current = [];
      ghostBitsRef.current = [];
      subjectBytesRef.current = [];
      ghostBytesRef.current = [];
      subjectIndicesRef.current = [];
      ghostIndicesRef.current = [];
      trialStrategiesRef.current = [];
      subjectBitPositionsRef.current = [];
      ghostBitPositionsRef.current = [];
      bitPositionRef.current = 0; // Reset cyclic position counter
      entropyAccumRef.current = { subj: [], ghost: [] };
      entropyWindowsRef.current = { subj: [], ghost: [] };
    } catch (error) {
      console.error('Error calculating session temporal entropy:', error);
    }
  }, [runRef]);

  const startNextMinute = useCallback(async () => {
    const redo = redoCurrentMinuteRef.current;
    const next = redo ? blockIdx : (blockIdx + 1);


    // If we've completed all blocks, go to post-experiment questions
    if (!redo && blockIdx + 1 >= C.BLOCKS_TOTAL) {
      // Disconnect stream at session end
      if (C.USE_LIVE_STREAM) {
        liveDisconnect();
      }
      // Calculate and save session-level temporal entropy before ending
      await calculateSessionTemporalEntropy();
      setPhase('done');
      return;
    }

    if (redo) {
      redoCurrentMinuteRef.current = false;
      minuteInvalidRef.current = false;
      invalidReasonRef.current = '';
      resetLivePauseCounters();
    }

    setPhase('buffering'); // Show loading UI while buffer fills
    await ensureNextBlockReady();

    setPhase('running');
    setblockIdx(next);

    // All blocks are live now - no retro tracking needed

    bitsRef.current = []; ghostBitsRef.current = []; alignedRef.current = []; alignedGhostRef.current = [];
    subjectBytesRef.current = []; ghostBytesRef.current = [];
    subjectIndicesRef.current = []; ghostIndicesRef.current = []; trialStrategiesRef.current = [];
    subjectBitPositionsRef.current = []; ghostBitPositionsRef.current = []; // Reset position tracking
    bitPositionRef.current = 0; // Reset cyclic position counter to 0 at start of each block
    hitsRef.current = 0; ghostHitsRef.current = 0;
    resetLivePauseCounters();
    setRenderTrigger(0);

    // Track block start time for timing data
    blockStartTimeRef.current = Date.now();

    setIsRunning(true);
  }, [blockIdx, calculateSessionTemporalEntropy, ensureNextBlockReady, resetLivePauseCounters, liveDisconnect]);

  // Create a ref to hold the latest startNextMinute function for auto-mode
  const startNextMinuteRef = useRef(null);
  if (!startNextMinuteRef.current) {
    startNextMinuteRef.current = startNextMinute;
  }
  // Update ref when blockIdx changes (which causes startNextMinute to be recreated)
  if (startNextMinuteRef.current !== startNextMinute) {
    startNextMinuteRef.current = startNextMinute;
  }

  // Exit → persist + mark ended_by
  const userExitRef = useRef(false);
  const [showExitModal, setShowExitModal] = useState(false);
  const [exitReason, setExitReason] = useState('time');
  const [exitNotes, setExitNotes] = useState('');
  const handleExitNow = useCallback(async (exitInfo = null) => {
    userExitRef.current = true;
    try {
      // Always disconnect since all blocks are live
      if (C.USE_LIVE_STREAM) {
        liveDisconnect();
      }
      if (isRunning) {
        setIsRunning(false);
        await persistMinute();
      }

      // Save exit info to existing doc or create new one
      try {
        if (runRef) {
          // Update existing document with exit info
          await setDoc(runRef, {
            exitedEarly: true,
            exit_reason: exitInfo?.reason || 'user_exit',
            exit_reason_notes: exitInfo?.notes || null,
            exit_block_index: blockIdx >= 0 ? blockIdx : 0
          }, { merge: true });
        } else if (target) {
          // Create new document with exit info
          await ensureRunDoc({
            reason: exitInfo?.reason || 'user_exit',
            notes: exitInfo?.notes || null,
            blockIdx: blockIdx >= 0 ? blockIdx : 0
          });
        }
      } catch (saveError) {
        console.warn('Exit save failed (non-blocking):', saveError);
      }
    } catch (e) {
      console.warn('Exit error (non-blocking):', e);
    } finally {
      setPhase('summary');
    }
  }, [blockIdx, isRunning, liveDisconnect, persistMinute, runRef, target, ensureRunDoc]);

  // Ensure document is created early in onboarding phase
  useEffect(() => {
    if (phase === 'onboarding' && !runRef && target) {
      ensureRunDoc().catch(console.error);
    }
  }, [phase, runRef, target, ensureRunDoc]);

  // ===== flow gates =====
  if (!userReady || !target || !checkedReturning) {
    return (
      <div style={{ padding: 24 }}>
        Loading…
      </div>
    );
  }

  // In MainApp.jsx, replace the ConsentGate section with:

  // CONSENT
  if (phase === 'consent') {
    return (
      <div style={{ position: 'relative' }}>
        <ConsentGate
          title="Consent to Participate"
          studyDescription="This study investigates whether focused attention can correlate with patterns in random color generation during attention tasks. You will complete 20 blocks each 30 seconds long and brief questionnaires (approximately 10-15 minutes total)."
          bullets={[
            'You will focus on an assigned target color (orange or blue) while random colors are generated.',
            'Your task is to maintain focused attention on your target color throughout each trial block.',
            'We collect data on randomly generated sequences, timing patterns, and your questionnaire responses.',
            'Participation is completely voluntary; you may exit at any time using the door button.',
            'All data is stored anonymously and securely for research purposes.',
            'Data will be retained indefinitely to enable scientific replication and analysis.',
            'Hosting providers may log IP addresses for security purposes, but these are not linked to your study data.',
          ]}
          onAgree={() => {
            // Double-check localStorage before deciding
            let localPreDone = false;
            try {
              localPreDone = localStorage.getItem(`pre_done_global:${C.EXPERIMENT_ID}`) === '1';
            } catch {}

            const shouldSkipPre = preDone || localPreDone;
            setPhase(shouldSkipPre ? 'prime' : 'preQ');
          }}
        />
      </div>
    );
  }

  // PRE QUESTIONS (required, highlights missing in red via QuestionsForm)
  if (phase === 'preQ') {
    return (
      <div style={{ position: 'relative' }}>
        <QuestionsForm
          title="Before you begin"
          questions={preQuestions}
          requiredAll
          onSubmit={async (answers, { valid }) => {
            if (!valid) return;
            setPhase('prime');
            try {
              const uidNow = await requireUid();
              // Save to participants collection like exp1
              const ref = doc(db, 'participants', uidNow);
              const snap = await getDoc(ref);
              const demographics = { ...answers };

              if (snap.exists()) {
                await updateDoc(ref, {
                  demographics,
                  demographics_version: 'v1',
                  updated_at: serverTimestamp(),
                });
              } else {
                await setDoc(ref, {
                  demographics,
                  demographics_version: 'v1',
                  created_at: serverTimestamp(),
                  updated_at: serverTimestamp(),
                  profile_version: 1,
                });
              }

              if (typeof localStorage !== 'undefined') {
                localStorage.setItem(`pre_done:${C.EXPERIMENT_ID}:${uidNow}`, '1');
                localStorage.setItem(`pre_done_global:${C.EXPERIMENT_ID}`, '1');
              }
              setPreDone(true);
            } catch (e) {
              console.warn('Pre survey save error (non-blocking):', e);
              console.warn('Debug info:', {
                uid: uid,
                runRefId: runRef?.id,
                userReady: userReady,
                errorCode: e?.code,
                errorMessage: e?.message
              });
            }
          }}
        />
      </div>
    );
  }

  // PRIME SCREEN (research background - shown to all participants)
  if (phase === 'prime') {
    return (
      <div style={{ padding: 24, position: 'relative' }}>
        <h2>Research Background</h2>
        <div style={{ border: '1px solid #ddd', padding: 20, borderRadius: 12, background: '#f9f9f9', minHeight: 300 }}>
          <div>
            <h3 style={{ marginTop: 0, color: '#2c3e50' }}>For more than half a century, scientists have explored one of the most radical questions in modern science: Can consciousness directly influence the physical world?</h3>
            <div style={{ lineHeight: 1.6, fontSize: 15 }}>
              <p>Between 1959 and 2000, over 500 carefully controlled laboratory studies tested whether human intention could subtly shift the output of random number generators—machines designed to be perfectly unpredictable. The result? A combined deviation exceeding 16 standard deviations from chance. Statistically, that’s so unlikely it would take billions of years of random guessing to match it once.</p>

              <p>The effect is small (less than 1% deviation on average), but remarkably stable. Across four decades, nearly 100 researchers on three continents found the same pattern, even as methods improved and controls tightened. The signal never disappeared. There is a growing movement in science and philosophy that sees consciousness not as a byproduct of matter, but as the fundamental field from which matter arises.</p>
              <p>Because the effect is so small, the next frontier isn't about repeating the same experiments—it's about tracing its signatures including:</p>
              <ul>
                <li>Temporal patterns</li>
                <li>Entropy shifts</li>
                <li>Cross-correlations</li>
              </ul>
              <p>These signatures may reveal that consciousness it organizes matter, much like gravity shapes spacetime or magnetism aligns iron filings.</p>
              

              <h4 style={{ fontStyle: 'italic', color: 'green', marginBottom: 0 }}>Your participation helps map the landscape of consciousness-matter interaction.</h4>
            </div>
          </div>

          <div style={{ marginTop: 20}}>
            <h3 style={{ marginTop: 0, color: '#2c3e50' }}>Instructions</h3>
            <ul style={{ lineHeight: 1.6 }}>
              <li>This experiment uses quantum random number generators for true randomness.</li>
              <li>Your goal is to mentally influence the random color sequence toward your assigned target color. </li>
              <li>People use different mental approaches to do this. You might:
              <ul>
                  <li>Imagine becoming “one” with the random process,</li>
                  <li>Visualize the target color clearly and confidently,</li>
                  <li>Believe that the desired result already exists,</li>
                  <li>Or clear your mind and hold the thought of the target color in your awareness.</li></ul>
                  Choose whichever method feels most natural for you.
                (Some participants find that <b>binaural beats</b> help them focus.)
              </li>
              <li>Use your intention to gently guide the quantum process toward your target outcome.</li>
              <li>Afterward, statistical analysis will look for meaningful patterns that could reflect your influence.</li>
              <li>Take your time, stay relaxed, and maintain steady focus during each block of trials.</li>
            </ul>
          </div>
        </div>
        <div style={{ marginTop: 8 }}>
          <button onClick={() => setPhase('info')}>Continue</button>
        </div>
      </div>
    );
  }

  // INFO SCREEN (binaural beats information)
  if (phase === 'info') {
    const binauralText = "Correlations have been found with some researchers claiming mental coherence increasing PSI through use of binaural beats.";

    return (
      <div style={{ padding: 24, maxWidth: 760, position: 'relative' }}>
        <h3 style={{ marginTop: 0, color: '#2c3e50' }}>Optional Enhancement: Binaural Beats</h3><p>If you have access to a pair of headphones and an internet connection please use them during your session.</p>
        <div style={{ marginTop: 20, padding: 20, background: '#f8f9fa', borderRadius: 12, border: '1px solid #e9ecef' }}>
          <ul style={{ fontSize: 16, lineHeight: 1.6 }}>
            <li><strong>About binaural beats:</strong> {binauralText}</li>
            <li><strong>What you need:</strong> A pair of headphones.</li>
            <li><strong>How:</strong> Use <a href="https://mynoise.net/NoiseMachines/binauralBrainwaveGenerator.php" target="_blank" rel="noopener noreferrer">this binaural beat generator</a> or your preferred app and set the frequency between <strong>4–8&nbsp;Hz</strong>, choosing the level that feels most comfortable.</li>
            <li><strong>Choose:</strong>You must choose to either use binaural beats for your entire session or complete the whole session without them. You're welcome to take this experiment multiple times. Try some sessions with binaural beats and others without them to explore different approaches</li>
            <li><strong>Prepare:</strong> Listen for at least 1–2 minutes before starting. Breathe deeply and try to empty your mind.</li>
          </ul>
        </div>

        <div style={{ marginTop: 20 }}>
          <button
            className="primary-btn"
            onClick={() => setPhase('onboarding')}
            style={{
              padding: '12px 20px',
              borderRadius: 8,
              border: '1px solid #999',
              background: '#1a8f1a',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 16,
              transition: 'background 150ms ease'
            }}
          >
            Continue
          </button>
        </div>

      </div>
    );
  }

  // ONBOARDING
  if (phase === 'onboarding') {
    const canContinue = !!runRef; // Live mode - no tapes needed

    // Show auto-mode status if active
    if (isAutoMode) {
      // Auto-start when runRef is ready
      if (canContinue && !isRunning) {
        ensureRunDoc().then(() => startNextMinute());
      }

      const isComplete = autoSessionCount >= autoSessionTarget;

      return (
        <div style={{ padding: 24, maxWidth: 760 }}>
          <h1>🤖 Auto-Mode Baseline Collection</h1>

          {autoSessionCount === 0 && (
            <div style={{ marginBottom: 20, padding: 20, background: '#f0f0f0', borderRadius: 8 }}>
              <label style={{ display: 'block', marginBottom: 5, fontWeight: 'bold' }}>
                Number of sessions to run:
              </label>
              <input
                type="number"
                value={autoSessionTarget}
                onChange={(e) => setAutoSessionTarget(Math.max(1, parseInt(e.target.value) || 1))}
                min="1"
                max="1000"
                style={{ padding: '8px', width: '100px', marginRight: 10 }}
              />
              <span style={{ fontSize: 12, color: '#666' }}>
                (Each session = 20 blocks, ~10 min)
              </span>
            </div>
          )}

          <p style={{ fontSize: 18, marginTop: 20 }}>
            Sessions: <strong>{autoSessionCount} / {autoSessionTarget}</strong>
          </p>

          {isComplete ? (
            <p style={{ color: '#1a8f1a', fontWeight: 'bold', marginTop: 10 }}>
              ✅ All sessions complete! Check QA dashboard.
            </p>
          ) : (
            <p style={{ color: '#666', marginTop: 10 }}>
              {canContinue ? 'Running...' : 'Starting...'}
            </p>
          )}
        </div>
      );
    }

    return (
      <div style={{ padding: 24, maxWidth: 760, margin: '0 auto', position: 'relative' }}>
        <h1>Assessing Randomness Suppression During Conscious Intention Tasks — Pilot Study</h1>
        <div style={{
          textAlign: 'center',
          margin: '20px 0',
          padding: '20px',
          border: '3px solid #ddd',
          borderRadius: '12px',
          background: '#f9f9f9'
        }}>
          <p style={{ fontSize: '24px', fontWeight: 'bold', margin: '0 0 10px 0' }}>
            Your Target:
          </p>
          <div style={{ fontSize: '48px', fontWeight: 'bold', margin: '10px 0' }}>
            {target === 'BLUE' ? '🟦 BLUE' : '🟠 ORANGE'}
          </div>
          <p style={{ fontSize: '18px', margin: '10px 0 0 0', color: '#666' }}>
            Keep this target the entire session
          </p>
        </div>
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ color: '#2c3e50', marginBottom: 15 }}>What to Expect:</h3>
          <ul>
            <li>You'll complete short blocks with breaks. Nudge the color toward your target.</li>
            <li>The screen will display visual patterns - stay focused on your target color intention.</li>
            <li>During breaks, you'll see your performance summary before continuing.</li>
            {debugUI && (
              <li style={{ opacity: 0.8 }}>{POLICY_TEXT.warmup}; {POLICY_TEXT.pause}; {POLICY_TEXT.resume}</li>
            )}
          </ul>

          <div style={{
            marginTop: 20,
            padding: 15,
            border: '2px solid #e9ecef',
            borderRadius: 8,
            background: '#f8f9fa'
          }}>
            <h4 style={{ margin: '0 0 10px 0', color: '#495057' }}>Visual Preview:</h4>
            <p style={{ margin: '5px 0 15px 0', fontSize: 14, color: '#6c757d' }}>
              You'll see patterns like this during the experiment:
            </p>
            <div style={{
              background: '#f0f0f0',
              borderRadius: 8,
              padding: 20,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              minHeight: 200,
              border: '1px dashed #ccc'
            }}>
              <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                  <img
                    src={`${process.env.PUBLIC_URL}/ring-pattern.webp`}
                    alt="Ring pattern example"
                    loading="lazy"
                    style={{
                      maxWidth: 150,
                      height: 'auto',
                      borderRadius: 8,
                      imageRendering: 'crisp-edges'
                    }}
                    onError={(e) => {
                      e.target.style.display = 'none';
                    }}
                  />
                  <p style={{ fontSize: 12, color: '#666', marginTop: 8 }}>Ring Pattern</p>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <img
                    src={`${process.env.PUBLIC_URL}/mosaic-pattern.webp`}
                    alt="Mosaic pattern example"
                    loading="lazy"
                    style={{
                      maxWidth: 150,
                      height: 'auto',
                      borderRadius: 8,
                      imageRendering: 'crisp-edges'
                    }}
                    onError={(e) => {
                      e.target.style.display = 'none';
                    }}
                  />
                  <p style={{ fontSize: 12, color: '#666', marginTop: 8 }}>Mosaic Pattern</p>
                </div>
              </div>
            </div>
            <p style={{ margin: '10px 0 5px 0', fontSize: 13, color: '#6c757d', fontStyle: 'italic' }}>
              Focus on your intention to influence the patterns toward your target color.
              The patterns will change continuously during the experiment.
            </p>
          </div>
        </div>

        {/* Tape creation button removed - all blocks use live streams */}

        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <button
            className="primary-btn"
            disabled={!canContinue}
            onClick={async () => {
              if (!runRef) {
                await ensureRunDoc();
              }
              startNextMinute();
            }}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid #999',
              background: canContinue ? '#1a8f1a' : '#ccc',
              color: canContinue ? '#fff' : '#444',
              cursor: canContinue ? 'pointer' : 'not-allowed',
              transition: 'background 150ms ease'
            }}
          >
            Start Trials
          </button>
        </div>
      </div>
    );
  }

  // PRIME
  // REST (manual Continue; participant score only; RedundancyGate for retro)
  if (phase === 'rest') {
    const pctLast = lastBlock && lastBlock.n ? Math.round((100 * lastBlock.k) / lastBlock.n) : 0;
    // All blocks are live now - simplified rest phase

    // We're bypassing participant UI, but still auditing silently.

    const redundancyReady = true;

    return (
      <div style={{ padding: 24, textAlign: 'center', position: 'relative' }}>
        <p>Take a short breather…</p>

        {/* Participant score (no ghost) */}
        {lastBlock && lastBlock.n > 0 && (
          <div
            style={{
              display: 'inline-block',
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid #ddd',
              background: '#f7f7f7',
              marginBottom: 8,
              fontWeight: 600
            }}
          >
            Last block: {pctLast}% ({lastBlock.k}/{lastBlock.n})
          </div>
        )}

        {/* Optional totals board (ghost hidden if your component supports) */}
        <BlockScoreboard
          last={lastBlock || { k: hitsRef.current, n: alignedRef.current.length, z: 0, pTwo: 1, kg: 0, ng: 0, zg: 0, pg: 1, kind: 'live' }}
          totals={totals}
          targetSide={target}
          hideGhost={true}
          hideBlockType={true}
        />

        <div style={{ marginTop: 12 }}>
          <button
            onClick={() => startNextMinute()}
            disabled={!redundancyReady}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid #999',
              background: redundancyReady ? '#1a8f1a' : '#ccc',
              color: redundancyReady ? '#fff' : '#444',
              cursor: redundancyReady ? 'pointer' : 'not-allowed',
              transition: 'background 150ms ease'
            }}
          >
            {!redundancyReady ? 'Complete check above…' : 'Continue'}
          </button>
          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 8 }}>
            Block {blockIdx + 1} of {C.BLOCKS_TOTAL} complete
          </div>
        </div>

      </div>
    );
  }

  // BUFFERING (loading quantum data before trials start)
  if (phase === 'buffering') {
    const targetColor = target === 'BLUE' ? '#4169E1' : '#FF8C00';
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#1a1a2e',
        color: '#fff'
      }}>
        <div style={{
          width: 80,
          height: 80,
          border: `6px solid ${targetColor}30`,
          borderTop: `6px solid ${targetColor}`,
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
          marginBottom: 30
        }} />
        <h2 style={{ margin: '10px 0', fontSize: 28 }}>Please Wait</h2>
        <p style={{ color: '#aaa', fontSize: 16 }}>Loading quantum stream from {liveLastSource || 'QRNG'}...</p>
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  // RUNNING
  if (phase === 'running') {
    const isLive = true; // All blocks are live now
    const trialsPlanned = trialsPerBlock;

    return (
      <div
        style={{
          height: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#f5f7fa',
          position: 'relative'
        }}
      >
        {isLive && isBuffering && (
          <div
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
              color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 24, zIndex: 10
            }}
            aria-live="polite"
          >
            buffering… (keeping timing)
          </div>
        )}

        <DataCollectionErrorBoundary>
          <MappingDisplay
            key={`block-${blockIdx}`}
            mapping={mappingType}
            bit={bitsRef.current[bitsRef.current.length - 1] ?? 0}
            targetBit={targetBit}
            target={target}
            segments={trialsPlanned}
            trialOutcomes={alignedRef.current.map(align => align === 1)} // Convert 1/0 to true/false
            onFrameDelta={mappingType === "high_entropy"
              ? (alignedRef.current.length > 0 ? hitsRef.current / alignedRef.current.length : 0.5)
              : ((f) => {
                  const m = microEntropyRef.current;
                  m.sum += Math.max(0, Math.min(1, f));
                  m.count += 1;
                })
            }
          />
        </DataCollectionErrorBoundary>

        <div
          style={{
            position: 'fixed',
            left: 16, top: 16,
            background: '#fff',
            padding: '8px 12px',
            borderRadius: 8,
          }}
        >
          <div>
            Block {blockIdx + 1}/{C.BLOCKS_TOTAL}
            {debugUI && (
              <>
                {' — '}
                <strong>Live</strong>
                <span style={{ marginLeft: 6, opacity: 0.7 }}>
                  [src: {liveLastSource || '—'} · buf {liveBufferedBytes()} bytes]
                </span>
              </>
            )}
            {' — '}Target: {target === 'BLUE' ? '🟦' : '🟠'}
          </div>

          {(() => {
            const n = alignedRef.current.length;
            const k = hitsRef.current;
            const minuteVal = n ? k / n : 0.5;
            const toward = targetBit === 1 ? 'BLUE' : 'ORANGE';
            return (
              <>
                {C.SHOW_FEEDBACK_GAUGE && (
                  <CircularGauge
                    value={minuteVal}
                    targetBit={targetBit}
                    label={`Toward ${toward}`}
                    subLabel={`This minute average`}
                  />
                )}
                <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>
                  Trial {n}/{trialsPlanned} 
                  {/* · This minute: <strong>{Math.round(minuteVal * 100)}%</strong> */}
                </div>
              </>
            );
          })()}

          {debugUI && (
            <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
              <label>
                <input type="checkbox" checked={lowContrast} onChange={(e) => setLowContrast(e.target.checked)} /> Low-contrast
              </label>
              <label>
                <input type="checkbox" checked={patternsMode} onChange={(e) => setPatternsMode(e.target.checked)} /> Patterns
              </label>
            </div>
          )}
        </div>

        <ExitDoorButton onClick={() => {
          setShowExitModal(true);
        }} />

        {/* Exit modal */}
        {showExitModal && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="exit-title"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.45)',
              display: 'grid',
              placeItems: 'center',
              zIndex: 9999,
              padding: 16,
            }}
          >
            <div
              style={{
                maxWidth: 400,
                background: '#fff',
                borderRadius: 12,
                boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
                padding: 24,
              }}
            >
              <h3 id="exit-title" style={{ marginTop: 0, marginBottom: 16 }}>
                Exit Survey
              </h3>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>
                  Why are you exiting?
                </label>
                <select
                  value={exitReason}
                  onChange={(e) => setExitReason(e.target.value)}
                  style={{ width: '100%', padding: 8, borderRadius: 4 }}
                >
                  <option value="time">Out of time</option>
                  <option value="difficulty">Too difficult</option>
                  <option value="technical">Technical problems</option>
                  <option value="other">Other reason</option>
                </select>
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>
                  Additional notes (optional):
                </label>
                <textarea
                  value={exitNotes}
                  onChange={(e) => setExitNotes(e.target.value)}
                  rows={3}
                  style={{ width: '100%', padding: 8, borderRadius: 4, resize: 'vertical' }}
                  placeholder="Any additional feedback..."
                />
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setShowExitModal(false)}
                  style={{
                    padding: '10px 16px',
                    borderRadius: 6,
                    border: '1px solid #28a745',
                    background: '#28a745',
                    color: 'white',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setShowExitModal(false);
                    handleExitNow({ reason: exitReason, notes: exitNotes });
                  }}
                  style={{
                    padding: '10px 16px',
                    borderRadius: 6,
                    border: 'none',
                    background: '#dc3545',
                    color: 'white',
                    cursor: 'pointer',
                  }}
                >
                  Save & Exit
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // POST QUESTIONS
  if (phase === 'done') {
    return (
      <div style={{ position: 'relative' }}>
        <QuestionsForm
          title="Quick wrap-up"
          questions={postQuestions}
          onSubmit={async (answers, { valid }) => {
            if (!valid) return;
            setPhase('results');
            try {
              if (runRef) {
                await setDoc(runRef, { post_survey: answers, completed: true }, { merge: true });
              } else {
                console.error('🔍 DATABASE: No runRef when trying to save completion!');
              }
            } catch (e) {
              console.warn('Post survey save error (non-blocking):', e);
            }
          }}
        />
      </div>
    );
  }

  // SIMPLE RESULTS
  if (phase === 'results') {
    const finalPct = totals.n ? Math.round((100 * totals.k) / totals.n) : 0;

    return (
      <div className="App" style={{ textAlign: 'center', maxWidth: 600, margin: '0 auto', padding: 24 }}>
        <h1>Your Results</h1>

        <div
          style={{
            display: 'inline-block',
            padding: '20px 30px',
            borderRadius: 12,
            border: '2px solid #ddd',
            background: '#eef8ee',
            marginBottom: 24,
            fontSize: 24,
            fontWeight: 700
          }}
        >
          Final Score: {finalPct}%
        </div>

        <div style={{ textAlign: 'left', marginBottom: 32, padding: '16px', background: '#f8f9fa', borderRadius: 8 }}>
          <h4>What This Study Investigated</h4>
          <p>This experiment tested whether focused mental intention could reduce entropy (increase order) in randomly generated sequences. You were asked to focus attention on specific target symbols while observing rapid visual displays to see if your intention could make the patterns less random.</p>

          <h4>Understanding Your Score</h4>
          <p>A single session score doesn't tell us much about whether you have any ability, but repeating the experiment multiple times can reveal meaningful patterns. Very high scores (consistently above 55%) or very low scores (consistently below 45%) across many sessions could indicate an effect.</p>

          <p>To evaluate your personal performance: complete at least 10 sessions, then calculate your average score. If your average is consistently above 52-53% or below 47-48% across multiple sets of 10 sessions, this might indicate a genuine pattern rather than random variation. Remember, low scores are just as telling as high scores—we would simply test you with reversed instructions.</p>

          <h4>Next Steps</h4>
          <p>Your data contributes to a larger dataset that will be analyzed for statistical patterns. Results will be made available once data collection is complete and analysis is finished.</p>
        </div>

        <HighScoreEmailGate
          experiment="exp3"
          step="done"
          sessionId={runRef?.id}
          participantId={uid}
          finalPercent={finalPct}
          cutoffOverride={C.FINALIST_MIN_PCT}
          lowCutoffOverride={C.FINALIST_MAX_PCT}
        />

        <button
          className="primary-btn"
          onClick={() => setPhase('summary')}
          style={{ marginTop: 16 }}
        >
          Continue to Session Details
        </button>
      </div>
    );
  }

  // AUTO-MODE COMPLETION SCREEN
  if (phase === 'auto_complete') {
    return (
      <div className="App" style={{ textAlign: 'center', maxWidth: 600, margin: '0 auto', padding: 24 }}>
        <h1>🤖 Auto-Mode Complete</h1>
        <div style={{ marginTop: 32, padding: '24px', background: '#f0fdf4', border: '2px solid #10b981', borderRadius: 8 }}>
          <h2 style={{ color: '#059669', marginBottom: 16 }}>✓ Baseline Data Collection Complete</h2>
          <p style={{ fontSize: 18, marginBottom: 12 }}>
            Successfully completed {autoSessionCount} baseline session{autoSessionCount !== 1 ? 's' : ''}
          </p>
          <p style={{ color: '#6b7280', fontSize: 14 }}>
            Data has been saved to the database. You can now view the results in the QA dashboard.
          </p>
        </div>

        <div style={{ marginTop: 24, padding: '16px', background: '#fff', border: '1px solid #ddd', borderRadius: 8 }}>
          <p style={{ fontFamily: 'monospace', fontSize: 12, color: '#6b7280' }}>
            Auto-mode enabled via #auto URL hash
          </p>
        </div>
      </div>
    );
  }

  // FINAL SCREEN
  if (phase === 'summary') {
    return (
      <div className="App" style={{ textAlign: 'center', maxWidth: 600, margin: '0 auto', padding: 24 }}>
        <h1>Thank You!</h1>

        <div style={{ textAlign: 'left', marginBottom: 32, padding: '20px', background: '#f8f9fa', borderRadius: 8 }}>
          <h3>Study Complete</h3>
          <p>Thank you for participating in this research on attention and random pattern generation.</p>

          <h4>Questions or Concerns</h4>
          <p>If you have any questions about this research, please contact the research team at <a href="mailto:h@whatthequark.com">h@whatthequark.com</a></p>
        </div>

        <div style={{ marginTop: 24, padding: '16px', background: '#fff', border: '1px solid #ddd', borderRadius: 8 }}>
          <p>Session ID: <code>{runRef?.id}</code></p>
          <p>To keep the study fair and unbiased for future participants, we're holding back full details until data collection is complete.</p>

          <ul style={{ textAlign: 'left', marginTop: 16 }}>
            <li>Try again in different mindsets, with and without binaural beats.</li>
            <li>Share with friends—large datasets matter here.</li>
            <li>
              We'll post a full debrief at{' '}
              <a href="https://whatthequark.com/debriefs/">https://whatthequark.com/debriefs/</a> when the study closes.
            </li>
          </ul>

          <button
            onClick={() => window.location.reload()}
            className="primary-btn"
            style={{ marginTop: '1em' }}
          >
            Run It Again
          </button>

          <div style={{ marginTop: 12 }}>
            <a
              className="secondary-btn"
              href="mailto:h@whatthequark.com?subject=Experiment%20Results%20Updates"
            >
              Email me when results are posted
            </a>
          </div>
        </div>
      </div>
    );
  }
}