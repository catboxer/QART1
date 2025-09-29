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
} from './stats/index.js';
import { db, ensureSignedIn } from './firebase';
import {
  collection, doc, addDoc, setDoc, getDoc, updateDoc, serverTimestamp,
} from 'firebase/firestore';
import { useLiveStreamQueue } from './useLiveStreamQueue';
import { MappingDisplay } from './SelectionMappings.jsx';
import { preQuestions, postQuestions } from './questions';
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
  if (C.emailSignificanceThreshold < 0 || C.emailSignificanceThreshold > 1) errors.push('emailSignificanceThreshold must be between 0 and 1');

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

const QRNG_URL = '/.netlify/functions/qrng-race';

// ===== LIVE QUANTUM BUFFER MANAGEMENT =====
// These parameters control how the experiment handles live quantum random number streams
// to ensure smooth, uninterrupted biofeedback during consciousness research trials.

const TICK_MS = Math.round(1000 / C.VISUAL_HZ);

// BUFFER WARMUP PHASE
// Before starting trials, we accumulate quantum bits to avoid immediate buffering issues
const WARMUP_BITS_START = 24;     // Require 24 bits (~4.8s @ 5Hz) before starting trials
const WARMUP_TIMEOUT_MS = 1500;   // Max 1.5s to wait for warmup (fallback to local PRNG)

// BUFFER PAUSE/RESUME THRESHOLDS
// These create a "hysteresis" system to prevent rapid pause/resume cycling
// when quantum stream delivery is inconsistent due to network variability.
//
// CONSCIOUSNESS RESEARCH RATIONALE:
// - Smooth, uninterrupted feedback is critical for consciousness-RNG experiments
// - Participants need consistent 5Hz visual updates to maintain focus
// - Buffer interruptions could contaminate results by breaking concentration
//
const PAUSE_THRESHOLD_LT = 6;     // PAUSE when buffer < 6 bits (~1.2s of data remaining)
                                  // - Low enough to maximize quantum data usage
                                  // - High enough to prevent buffer starvation

const RESUME_THRESHOLD_GTE = 20;  // RESUME when buffer ≥ 20 bits (~4s of data available)
                                  // - Creates 14-bit "dead zone" (6-20) to prevent flicker
                                  // - Ensures sufficient buffer depth before resuming
                                  // - Balances quantum authenticity vs. experimental continuity

// TRIAL INVALIDATION LIMITS
// If buffering becomes excessive, the trial block is invalidated to maintain data quality
const MAX_PAUSES = 3;             // Max 3 pause events per 30s block (10% pause tolerance)
const MAX_TOTAL_PAUSE_MS = 5 * TICK_MS;  // Max 1s total pause time per block (~3.3%)
const MAX_SINGLE_PAUSE_MS = 3 * TICK_MS; // Max 600ms for any single pause event

const fmtSec = (ms) => `${(ms / 1000).toFixed(ms % 1000 ? 1 : 0)}s`;
const POLICY_TEXT = {
  warmup: `Warm-up until buffer ≥ ${WARMUP_BITS_START} bits (~${(WARMUP_BITS_START / C.VISUAL_HZ).toFixed(1)}s @ ${C.VISUAL_HZ}Hz)`,
  pause: `Pause if buffer < ${PAUSE_THRESHOLD_LT} bits`,
  resume: `Resume when buffer ≥ ${RESUME_THRESHOLD_GTE} bits`,
  guardrails: `Invalidate if >${MAX_PAUSES} pauses, total pauses > ${fmtSec(MAX_TOTAL_PAUSE_MS)}, or any pause > ${fmtSec(MAX_SINGLE_PAUSE_MS)}`
};

// ===== helpers (module scope) =====
async function fetchBytes(n, { timeoutMs = 3500, retries = 2, requireQRNG = false } = {}) {
  async function tryOnce() {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${QRNG_URL}?n=${n}&nonce=${Date.now()}`, { cache: 'no-store', signal: ctrl.signal });
      if (!res.ok) {
        let detail = '';
        try {
          const j = await res.json();
          if (j?.trace) detail = `:${(j.trace || []).join('|')}`;
          else if (j?.detail || j?.error) detail = `:${j.detail || j.error}`;
        } catch { }
        throw new Error('http_' + res.status + detail);
      }
      const j = await res.json();
      if (!j?.bytes || j.bytes.length < n) throw new Error('shape');
      return { ok: true, bytes: new Uint8Array(j.bytes), source: j.source || 'qrng' };
    } finally {
      clearTimeout(t);
    }
  }
  let lastErr = null;
  for (let r = 0; r <= retries; r++) {
    try { return await tryOnce(); }
    catch (e) { lastErr = e?.message || String(e); await new Promise(s => setTimeout(s, 200 * (r + 1))); }
  }
  if (requireQRNG) throw new Error('qrng_unavailable_after_retries:' + lastErr);
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  console.warn('[exp3] QRNG unavailable; using local_prng. Last error:', lastErr);
  return { ok: true, bytes, source: 'local_prng', fallback: true, lastErr };
}
// sha256Hex function removed - no longer needed for live-only mode
function localPairs(n) {
  const bytes = new Uint8Array(n * 2);
  crypto.getRandomValues(bytes);
  const subj = [], ghost = [];
  for (let i = 0; i < n; i++) {
    subj.push(bytes[2 * i] & 1);
    ghost.push(bytes[2 * i + 1] & 1);
  }
  return { subj, ghost, source: 'local_prng' };
}
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
// Compute binary Shannon entropy (in bits per symbol, 0..1)
function shannonEntropy(bits) {
  const n = bits.length;
  if (n === 0) return null;
  const ones = bits.reduce((a, b) => a + b, 0);
  const p = ones / n;
  if (p === 0 || p === 1) return 0;
  return -p * Math.log2(p) - (1 - p) * Math.log2(1 - p);
}

// Break a bit array into non-overlapping windows and compute entropy per window.
// Leaves any trailing remainder in-place in the accumulator.
function extractEntropyWindowsFromAccumulator(accumArray, winSize = 1000) {
  const out = [];
  while (accumArray.length >= winSize) {
    const chunk = accumArray.slice(0, winSize);
    const h = shannonEntropy(chunk);
    out.push(h);
    accumArray.splice(0, winSize); // remove consumed bits
  }
  return out;
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
  // ---- auth
  const [userReady, setUserReady] = useState(false);
  const [uid, setUid] = useState(null);
  const {
    connect: liveConnect,
    disconnect: liveDisconnect,
    popBit: livePopBit,
    popSubjectBit: livePopSubjectBit,
    popGhostBit: livePopGhostBit,
    bufferedBits: liveBufferedBits,
    connected: liveConnected,
    lastSource: liveLastSource,
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

  // ---- target & prime
  const [target, setTarget] = useState(null);
  const [primeCond, setPrimeCond] = useState(null);
  const targetAssignedRef = useRef(false);

  useEffect(() => {
    if (targetAssignedRef.current) {
      console.log('🎯 TARGET ASSIGNMENT BLOCKED - already assigned');
      return;
    }
    console.log('🎯 ASSIGNING NEW TARGET...');
    targetAssignedRef.current = true; // Set flag immediately to prevent second execution

    const randomByte = crypto.getRandomValues(new Uint8Array(1))[0];
    const randomBit = randomByte & 1;
    const t = randomBit ? 'BLUE' : 'ORANGE';
    console.log('🎯 TARGET ASSIGNMENT:', { randomByte, randomBit, assignedTarget: t });
    setTarget(t);
    const r = crypto.getRandomValues(new Uint8Array(1))[0] / 255;
    setPrimeCond(r < C.PRIME_PROB ? 'prime' : 'neutral');
  }, []);

  // ---- tapes
  // Tape system removed - all blocks use live streams

  // ---- returning participant (skip preQ on same device)
  // returning participant (skip preQ on same device)
  const [preDone, setPreDone] = useState(() => {
    try { return localStorage.getItem(`pre_done_global:${C.EXPERIMENT_ID}`) === '1'; }
    catch { return false; }
  });
  const [checkedReturning, setCheckedReturning] = useState(false);  // ← add this



  // live prefetch model (only used when NOT using streaming)
  const liveBufRef = useRef({ subj: [], ghost: [] });
  const nextLiveBufRef = useRef(null);

  const prefetchLivePairs = useCallback(async () => {
    // If you're using the real live stream, don't prefetch at all
    if (C.USE_LIVE_STREAM) return null;

    const n = Math.round((C.BLOCK_MS / 1000) * C.VISUAL_HZ);

    const qrngPromise = (async () => {
      const { bytes, source } = await fetchBytes(n * 2);
      const subj = [], ghost = [];
      for (let i = 0; i < n; i++) {
        subj.push(bytes[2 * i] & 1);
        ghost.push(bytes[2 * i + 1] & 1);
      }
      return { subj, ghost, source };
    })();

    // small timeout to fall back to local if QRNG is slow
    const timeout = new Promise((resolve) =>
      setTimeout(() => resolve(localPairs(n)), 1500)
    );

    const pairset = await Promise.race([qrngPromise, timeout]);
    nextLiveBufRef.current = pairset;
    return pairset;
  }, []);
 
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


  async function requireUid() {
    const u = await ensureSignedIn();
    if (!u || !u.uid) throw new Error('auth/no-user: sign-in required before writing');
    return u.uid;
  }

  // makeTape function removed - live streams only

  // prepareSessionArtifacts function removed - live streams only

  // ---- schedule (18×150 driven by config: VISUAL_HZ * (BLOCK_MS/1000) should be 150; BLOCKS_TOTAL=18)
  // All blocks are now live - no scheduling needed
  const trialsPerBlock = Math.round((C.BLOCK_MS / 1000) * C.VISUAL_HZ);

  // ---- run doc
  const [runRef, setRunRef] = useState(null);
  const ensureRunDocPromiseRef = useRef(null); // Prevent race conditions
  const isCreatingDocRef = useRef(false); // Immediate flag to prevent race conditions

  const ensureRunDoc = useCallback(async (exitInfo = null) => {
    if (runRef) {
      console.log('ensureRunDoc: returning existing runRef', runRef.id);
      return runRef;
    }

    // If already creating, wait for the existing promise
    if (isCreatingDocRef.current || ensureRunDocPromiseRef.current) {
      console.log('ensureRunDoc: waiting for existing promise');
      return await ensureRunDocPromiseRef.current;
    }

    // Set flag immediately to block concurrent calls
    isCreatingDocRef.current = true;
    console.log('ensureRunDoc: creating new document');

    // Create new promise and store it IMMEDIATELY
    const createPromise = (async () => {
      try {
        if (!target || !primeCond) throw new Error('logic/order: target and primeCond must be set before creating run');
        const uidNow = uid || (await requireUid());
        const col = collection(db, 'experiment3_responses');
        const docData = {
          participant_id: uidNow,
          experimentId: C.EXPERIMENT_ID,
          createdAt: serverTimestamp(),
          target_side: target,
          prime_condition: primeCond,
          tape_meta: null, // No tapes in live-only mode
          minutes_planned: C.BLOCKS_TOTAL, // All blocks are live
          timestamp: new Date().toISOString(),
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
        console.log('🔍 DATABASE: Created document successfully', docRef.id, docData);
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
  }, [runRef, target, primeCond, uid, requireUid]);

  // ---- phase & per-minute state
  const [phase, setPhase] = useState('consent');
  const [blockIdx, setblockIdx] = useState(-1);
  const [isRunning, setIsRunning] = useState(false);
  // Removed redundant state - using refs as single source of truth for performance
  const [lastBlock, setLastBlock] = useState(null);
  const [totals, setTotals] = useState({ k: 0, n: 0 });
  const [blocks, setBlocks] = useState([]);
  const [renderTrigger, setRenderTrigger] = useState(0); // Force re-renders for ref updates

  const bitsRef = useRef([]); const ghostBitsRef = useRef([]); const alignedRef = useRef([]);
  const hitsRef = useRef(0); const ghostHitsRef = useRef(0);
  const trialsPerMinute = trialsPerBlock;
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
      console.log('🎲 MAPPING SELECTION:', {
        blockIdx,
        randomByte,
        randomBit,
        mapping: pick,
        isRing: pick === 'low_entropy',
        isMosaic: pick === 'high_entropy'
      });
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
    if (!isBuffering && liveBufferedBits() < PAUSE_THRESHOLD_LT) {
      setIsBuffering(true);
      pauseCountRef.current += 1;
      pauseStartedAtRef.current = now;
    }
  }, [isBuffering, liveBufferedBits]);
  const maybeResume = useCallback((now) => {
    if (isBuffering && liveBufferedBits() >= RESUME_THRESHOLD_GTE) {
      const dur = now - pauseStartedAtRef.current;
      totalPausedMsRef.current += dur;
      if (dur > longestPauseMsRef.current) longestPauseMsRef.current = dur;
      setIsBuffering(false);
    }
  }, [isBuffering, liveBufferedBits]);
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

    const gCohRange = cumulativeRange(ghostBitsRef.current);
    const gHurst = hurstApprox(ghostBitsRef.current);
    const gAc1 = lag1Autocorr(ghostBitsRef.current);

    // All blocks are live now
    const kind = 'live';
    // ---- Entropy windowing (accumulate & compute 1000-bit windows) ----
    let newSubjWindows = [];
    let newGhostWindows = [];
    let subjCount = 0;
    let ghostCount = 0;

    try {
      // Append this minute's bits to accumulators
      if (Array.isArray(bitsRef.current) && bitsRef.current.length) {
        const beforeLength = entropyAccumRef.current.subj.length;
        entropyAccumRef.current.subj.push(...bitsRef.current);
        console.log(`🔍 ENTROPY ACCUMULATOR: Block ${blockIdx}, added ${bitsRef.current.length} bits (${beforeLength} → ${entropyAccumRef.current.subj.length}), can make window: ${entropyAccumRef.current.subj.length >= ENTROPY_WINDOW_SIZE}`);
      }
      if (Array.isArray(ghostBitsRef.current) && ghostBitsRef.current.length) {
        const beforeLength = entropyAccumRef.current.ghost.length;
        entropyAccumRef.current.ghost.push(...ghostBitsRef.current);
        console.log(`Entropy: Added ${ghostBitsRef.current.length} ghost bits (accumulator: ${beforeLength} → ${entropyAccumRef.current.ghost.length})`);
      }

      // Extract any completed windows
      newSubjWindows = extractEntropyWindowsFromAccumulator(entropyAccumRef.current.subj, ENTROPY_WINDOW_SIZE);
      newGhostWindows = extractEntropyWindowsFromAccumulator(entropyAccumRef.current.ghost, ENTROPY_WINDOW_SIZE);

      if (newSubjWindows.length) {
        console.log(`Entropy: Extracted ${newSubjWindows.length} subject windows, avg entropy: ${(newSubjWindows.reduce((a,b) => a+b, 0) / newSubjWindows.length).toFixed(4)}`);
      }
      if (newGhostWindows.length) {
        console.log(`Entropy: Extracted ${newGhostWindows.length} ghost windows, avg entropy: ${(newGhostWindows.reduce((a,b) => a+b, 0) / newGhostWindows.length).toFixed(4)}`);
      }

      // Append to running windows history
      if (newSubjWindows.length) entropyWindowsRef.current.subj.push(...newSubjWindows);
      if (newGhostWindows.length) entropyWindowsRef.current.ghost.push(...newGhostWindows);

      subjCount = entropyWindowsRef.current.subj.length;
      ghostCount = entropyWindowsRef.current.ghost.length;

      console.log(`Entropy: Total windows - Subject: ${subjCount}, Ghost: ${ghostCount}`);

    } catch (entropyErr) {
      console.warn('entropy-windowing failed', entropyErr);
    }


    const mdoc = doc(runRef, 'minutes', String(blockIdx));

    const blockSummary = { k, n, z, pTwo, kg: ghostHitsRef.current, ng: n, zg, pg, kind };
    setLastBlock(blockSummary);
    setTotals((t) => ({ k: t.k + k, n: t.n + n }));
    setBlocks((b) => [...b, blockSummary]);

    await setDoc(mdoc, {
      idx: blockIdx,
      kind,
      ended_by: 'timer',
      startedAt: serverTimestamp(),
      n, hits: k, z, pTwo,
      ghost_hits: kg, ghost_z: zg, ghost_pTwo: pg,
      target, prime_condition: primeCond,
      // No tape metadata for live streams
      coherence: { cumRange: cohRange, hurst },
      resonance: { ac1 },
      ghost_metrics: { coherence: { cumRange: gCohRange, hurst: gHurst }, resonance: { ac1: gAc1 } },
      mapping_type: mappingType,
      micro_entropy: microEntropyRef.current.count ? (microEntropyRef.current.sum / microEntropyRef.current.count) : null,
      entropy: {
        window_size: ENTROPY_WINDOW_SIZE,
        new_windows_subj: newSubjWindows.map((entropy, index) => ({
          entropy,
          windowIndex: entropyWindowsRef.current.subj.length + index
        })),
        new_windows_ghost: newGhostWindows.map((entropy, index) => ({
          entropy,
          windowIndex: entropyWindowsRef.current.ghost.length + index
        })),
        cumulative: {
          subj_count: subjCount,
          ghost_count: ghostCount,
        },
      },
      // No redundancy tracking for live streams
      invalidated: minuteInvalidRef.current || false,
      invalid_reason: minuteInvalidRef.current ? invalidReasonRef.current : null,
      live_buffer: kind === 'live' ? {
        pauseCount: pauseCountRef.current,
        totalPausedMs: Math.round(totalPausedMsRef.current),
        longestSinglePauseMs: Math.round(longestPauseMsRef.current),
      } : null,
    }, { merge: true });

    // Save raw trial data to subcollection for proper temporal analysis
    try {
      const trialsCollection = collection(mdoc, 'trials');
      const blockStartTime = Date.now();

      console.log('💾 Saving raw trial data:', {
        blockIdx,
        totalTrials: bitsRef.current.length,
        subjectBits: bitsRef.current.length,
        ghostBits: ghostBitsRef.current.length,
        outcomes: alignedRef.current.length
      });

      // Save each trial with all raw data
      const trialPromises = [];
      for (let i = 0; i < bitsRef.current.length; i++) {
        const trialDoc = {
          trialIndex: i,
          blockIndex: blockIdx,
          timestamp: blockStartTime + (i * Math.round(1000 / C.VISUAL_HZ)), // Estimated trial time
          subjectBit: bitsRef.current[i],
          ghostBit: ghostBitsRef.current[i],
          targetBit: targetBit,
          target: target,
          subjectOutcome: alignedRef.current[i], // 1 = hit, 0 = miss
          ghostOutcome: ghostBitsRef.current[i] === targetBit ? 1 : 0, // Ghost hit/miss
          mappingType: mappingType,
          primeCond: primeCond
        };

        trialPromises.push(addDoc(trialsCollection, trialDoc));
      }

      // Save all trials in parallel
      await Promise.all(trialPromises);
      console.log('✅ Raw trial data saved successfully');

    } catch (trialSaveError) {
      console.error('❌ Failed to save raw trial data:', trialSaveError);
      // Don't fail the entire block if trial saving fails
    }
  }, [
    runRef, blockIdx, target, primeCond, mappingType
  ]);

  const endMinute = useCallback(async () => {
    // Always disconnect live stream since all blocks are live
    if (C.USE_LIVE_STREAM) {
      liveDisconnect();
    }
    setIsRunning(false);
    await persistMinute();
    if (minuteInvalidRef.current) { setPhase('rest'); return; }
    // Always go to rest phase first, even for the final block
    setPhase('rest');
  }, [blockIdx, liveDisconnect, persistMinute]);
  // Idle prefetch during PRIME/REST in non-streaming mode
  useEffect(() => {
    // Never prefetch in streaming mode
    if (C.USE_LIVE_STREAM) return;

    // Only consider prefetching after onboarding has begun (avoid consent/preQ)
    const allowedPhases = new Set(['prime', 'rest']);
    if (!allowedPhases.has(phase)) return;

    // When NOT running, if the next minute is 'live' and not already staged, prefetch now
    if (phase !== 'running') {
      const next = blockIdx + 1;
      // All blocks are live now - always prefetch
      if (!nextLiveBufRef.current) {
        prefetchLivePairs().catch(() => { /* ignore */ });
      }
    }
  }, [phase, blockIdx, prefetchLivePairs]);
  useEffect(() => {
    endMinuteRef.current = endMinute;
  }, [endMinute]);

  // minute tick loop
  useEffect(() => {
    if (!isRunning) return;
    const TICK = Math.round(1000 / C.VISUAL_HZ);
    const MAX_TRIALS = trialsPerMinute; // Should be exactly 150 trials
    console.log('🎯 STARTING TRIALS:', {
      MAX_TRIALS,
      trialsPerMinute,
      trialsPerBlock,
      BLOCK_MS: C.BLOCK_MS,
      VISUAL_HZ: C.VISUAL_HZ
    });
    // All blocks are live now
    if (!C.USE_LIVE_STREAM) {
      const ready =
        Array.isArray(liveBufRef.current?.subj) && liveBufRef.current.subj.length >= trialsPerMinute &&
        Array.isArray(liveBufRef.current?.ghost) && liveBufRef.current.ghost.length >= trialsPerMinute;
      if (!ready) { endMinuteRef.current?.(); return; }
    }

    let i = 0;
    const start = Date.now();
    if (tickTimerRef.current) { clearInterval(tickTimerRef.current); tickTimerRef.current = null; }

    tickTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      const hitCap = elapsed >= (C.BLOCK_MS + 5000);

      // Debug logging every 10 trials
      if (i % 10 === 0 || i >= MAX_TRIALS - 5) {
        console.log('📊 TRIAL PROGRESS:', {
          i,
          MAX_TRIALS,
          actualTrials: alignedRef.current.length,
          shouldStop: i >= MAX_TRIALS,
          hitCap,
          elapsed: Math.round(elapsed/1000) + 's'
        });
      }

      if (i >= MAX_TRIALS || hitCap) {
        console.log('🛑 STOPPING TRIALS:', {
          trialCount: i,
          MAX_TRIALS,
          hitCap,
          elapsed,
          actualTrials: alignedRef.current.length,
          timerCleared: !!tickTimerRef.current
        });
        clearInterval(tickTimerRef.current);
        tickTimerRef.current = null;
        endMinuteRef.current?.();
        return;
      }

      let bit, ghost;
      if (C.USE_LIVE_STREAM) {
        const now = performance.now();
        if (isBuffering) { maybeResume(now); return; } // Don't increment i when buffering
        else { maybePause(now); if (isBuffering) { return; } } // Don't increment i when buffering starts
        const sBit = livePopSubjectBit(); const gBit = livePopGhostBit();
        if (sBit === null || gBit === null) { maybePause(now); return; } // Don't increment i when no bits available
        bit = sBit === '1' ? 1 : 0; ghost = gBit === '1' ? 1 : 0;

        // Debug early trials to see initial buffer bias
        if (i < 20) {
          console.log(`🔍 EARLY TRIAL ${i}:`, {
            sBit, gBit,
            sNum: bit, gNum: ghost,
            align: bit === targetBit ? 'HIT' : 'MISS',
            ghostAlign: ghost === targetBit ? 'HIT' : 'MISS',
            target: target,
            targetBit: targetBit,
            bufferSize: liveBufferedBits()
          });
        }

        // Debug ghost vs subject correlation every 25 trials (more frequent)
        if (i % 25 === 0 && i > 0) {
          const subjHitRate = hitsRef.current / alignedRef.current.length;
          const ghostHitRate = ghostHitsRef.current / alignedRef.current.length;
          const recentSubjBits = bitsRef.current.slice(-10);
          const recentGhostBits = ghostBitsRef.current.slice(-10);

          console.log('👻 GHOST vs SUBJECT:', {
            trial: i,
            subjHitRate: (subjHitRate * 100).toFixed(1) + '%',
            ghostHitRate: (ghostHitRate * 100).toFixed(1) + '%',
            diff: ((subjHitRate - ghostHitRate) * 100).toFixed(1) + '%',
            deviation: Math.abs(subjHitRate - 0.5) + Math.abs(ghostHitRate - 0.5),
            rawBits: { sBit, gBit, sNum: bit, gNum: ghost },
            recent10SubjBits: recentSubjBits,
            recent10GhostBits: recentGhostBits,
            bufferStatus: liveBufferedBits()
          });
        }
        if (shouldInvalidate()) {
          minuteInvalidRef.current = true; invalidReasonRef.current = 'invalidated-buffer';
          redoCurrentMinuteRef.current = true;
          clearInterval(tickTimerRef.current); tickTimerRef.current = null;
          endMinuteRef.current?.(); return;
        }
      } else {
        bit = liveBufRef.current.subj[i] ?? 0;
        ghost = liveBufRef.current.ghost[i] ?? 0;
      }

      // Only process trial and increment counter when we have valid data
      bitsRef.current.push(bit);
      ghostBitsRef.current.push(ghost);
      const align = bit === targetBit ? 1 : 0;
      const alignGhost = ghost === targetBit ? 1 : 0;
      alignedRef.current.push(align);
      hitsRef.current += align;
      ghostHitsRef.current += alignGhost;

      // Trigger re-render for UI updates
      setRenderTrigger(prev => prev + 1);

      i += 1; // Only increment when we actually process a trial
    }, TICK);

    return () => { if (tickTimerRef.current) { clearInterval(tickTimerRef.current); tickTimerRef.current = null; } };
  }, [
    isRunning, blockIdx, trialsPerMinute, targetBit,
    isBuffering, livePopSubjectBit, livePopGhostBit, maybePause, maybeResume, shouldInvalidate,
  ]);


  // Prepare next block (warmup / load buffers)
  const ensureNextBlockReady = useCallback(async (nextIdx) => {
    // All blocks are live now
    // STREAMING: warm up buffer, no prefetch
    if (C.USE_LIVE_STREAM) {
      if (!liveConnected) { liveConnect(); }
      const t0 = Date.now();
      while (Date.now() - t0 < WARMUP_TIMEOUT_MS &&
        liveBufferedBits() < WARMUP_BITS_START) {
        await new Promise((r) => setTimeout(r, 50));
      }
      resetLivePauseCounters();
      return;
    }

    // NON-STREAM (prefetch model)
    if (!nextLiveBufRef.current) { await prefetchLivePairs(); }
    if (nextLiveBufRef.current) {
      liveBufRef.current = nextLiveBufRef.current;
      nextLiveBufRef.current = null;
    } else {
      // last-resort local
      liveBufRef.current = localPairs(Math.round((C.BLOCK_MS / 1000) * C.VISUAL_HZ));
    }
    return;

  }, [
    // streaming deps
    liveConnected, liveConnect, liveBufferedBits, resetLivePauseCounters,
    // prefetch model deps
    prefetchLivePairs,
  ]);

  async function startNextMinute() {
    const redo = redoCurrentMinuteRef.current;
    const next = redo ? blockIdx : (blockIdx + 1);

    // If we've completed all blocks, go to post-experiment questions
    if (!redo && blockIdx + 1 >= C.BLOCKS_TOTAL) {
      setPhase('done');
      return;
    }

    if (redo) {
      redoCurrentMinuteRef.current = false;
      minuteInvalidRef.current = false;
      invalidReasonRef.current = '';
      resetLivePauseCounters();
    }

    await ensureNextBlockReady(next);

    setPhase('running');
    setblockIdx(next);

    // All blocks are live now - no retro tracking needed

    bitsRef.current = []; ghostBitsRef.current = []; alignedRef.current = [];
    hitsRef.current = 0; ghostHitsRef.current = 0;
    resetLivePauseCounters();
    setRenderTrigger(0);

    setIsRunning(true);
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
        } else if (target && primeCond) {
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
  }, [blockIdx, isRunning, liveDisconnect, persistMinute, runRef, target, primeCond, ensureRunDoc]);

  // Ensure document is created early in onboarding phase
  useEffect(() => {
    if (phase === 'onboarding' && !runRef && target && primeCond) {
      ensureRunDoc().catch(console.error);
    }
  }, [phase, runRef, target, primeCond]);

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
          studyDescription="This study investigates whether focused attention can correlate with patterns in random color generation during attention tasks. You will complete 18 blocks and brief questionnaires (approximately 20-25 minutes total)."
          bullets={[
            'You will focus on an assigned target color (red or green) while random colors are generated.',
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

            console.log('Pre-questions check:', { preDone, localPreDone, checkedReturning });
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

  // PRIME SCREEN (research background/study overview)
  if (phase === 'prime') {
    return (
      <div style={{ padding: 24, position: 'relative' }}>
        <h2>{primeCond === 'prime' ? 'Research Background' : 'Study Overview'}</h2>
        <div style={{ border: '1px solid #ddd', padding: 20, borderRadius: 12, background: '#f9f9f9', minHeight: 300 }}>
          {primeCond === 'prime' ? (
            <div>
              <h3 style={{ marginTop: 0, color: '#2c3e50' }}>PK Research: Moving Beyond "Does It Exist?"</h3>
              <div style={{ lineHeight: 1.6, fontSize: 15 }}>
                <p>Decades of data already show small but highly reliable deviations from chance in mind–matter interaction studies. Radin & Nelson's meta-analysis of 515 experiments (1959–2000, 91 researchers) found a consistent 0.7% shift from chance, an effect 16.1 standard errors beyond randomness—replicated across four decades and many labs worldwide.</p>

                <p>Criticisms that early effects were due to weak methods don't hold up: as experimental rigor improved, effect sizes held steady. Likewise, the "file drawer" objection fails as over 3,000 null studies would be needed to cancel the signal, yet surveys of researchers suggest at most ~60 exist.</p>

                <p>Because the effect size is so small, we're exploring whether statistical signatures might help distinguish genuine anomalies from methodological artifacts. By examining patterns in how these small deviations manifest—their temporal structure, correlation patterns, and relationship to other variables—we aim to develop more specific, testable hypotheses. If consistent signatures emerge alongside positive results, this convergent evidence could help clarify whether we're observing a real phenomenon or persistent experimental confounds.</p>

                <p style={{ fontStyle: 'italic', color: '#555', marginBottom: 0 }}>Your participation helps map the landscape of consciousness-matter interaction.</p>
              </div>
            </div>
          ) :  null}

          <div style={{ marginTop: 8}}>
            <h3 style={{ marginTop: 0, color: '#2c3e50' }}>Instructions</h3>
            <ul style={{ lineHeight: 1.6 }}>
              <li>This experiment uses quantum random number generators for true randomness.</li>
              <li>You'll focus on influencing random color sequences toward your assigned target color.</li>
              <li>Use your mental intention to nudge the quantum processes toward your target.</li>
              <li>Statistical analysis will examine patterns in the data for signatures of your influence.</li>
              <li>Take your time and maintain relaxed focus during each block.</li>
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
    const binauralText = primeCond === 'prime'
      ? "Correlations have been found with some researchers claiming mental coherence increasing PSI through use of binaural beats."
      : "Optional background audio that some people find helpful for maintaining focus during attention tasks.";

    return (
      <div style={{ padding: 24, maxWidth: 760, position: 'relative' }}>
        <h3 style={{ marginTop: 0, color: '#2c3e50' }}>Optional Enhancement: Binaural Beats</h3>
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
    return (
      <div style={{ padding: 24, maxWidth: 760, position: 'relative' }}>
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
                      console.log('Image failed to load:', e.target.src);
                      e.target.style.display = 'none';
                    }}
                    onLoad={() => console.log('Image loaded successfully')}
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
                      console.log('Mosaic image failed to load:', e.target.src);
                      e.target.style.display = 'none';
                    }}
                    onLoad={() => console.log('Mosaic image loaded successfully')}
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

        <div style={{ marginTop: 12 }}>
          <button
            className="primary-btn"
            disabled={!canContinue}
            onClick={async () => {
              console.log('🔍 DEBUGGING: Start Trials clicked', { runRef: !!runRef, runRefId: runRef?.id });
              if (!runRef) {
                console.log('🔍 DEBUGGING: No runRef, calling ensureRunDoc');
                await ensureRunDoc();
                console.log('🔍 DEBUGGING: After ensureRunDoc', { runRef: !!runRef, runRefId: runRef?.id });
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

    // We’re bypassing participant UI, but still auditing silently.

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
            {redundancyReady ? 'Continue' : 'Complete check above…'}
          </button>
          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 8 }}>
            Block {blockIdx + 1} of {C.BLOCKS_TOTAL} complete
          </div>
        </div>

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
                <strong>{isLive ? 'Live' : 'Retro'}</strong>
                {!isLive && (
                  <span style={{ marginLeft: 6, opacity: 0.7 }}>
                    (live stream)
                  </span>
                )}
                {isLive && !C.USE_LIVE_STREAM && liveBufRef.current?.source && (
                  <span style={{ marginLeft: 6, opacity: 0.7 }}>
                    [{liveBufRef.current.source} · {liveBufRef.current?.subj?.length || 0}]
                  </span>
                )}
                {isLive && C.USE_LIVE_STREAM && (
                  <span style={{ marginLeft: 6, opacity: 0.7 }}>
                    [live src: {liveLastSource || '—'} · buf {liveBufferedBits()}]
                  </span>
                )}
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
          console.log('Exit button clicked!', { showExitModal });
          setShowExitModal(true);
          console.log('Set showExitModal to true');
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
                console.log('🔍 DATABASE: Saving completion', { runRefId: runRef.id, answers, completed: true });
                await setDoc(runRef, { post_survey: answers, completed: true }, { merge: true });
                console.log('🔍 DATABASE: Completion saved successfully');
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
            <li>Try again in different moods or mindsets.</li>
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
