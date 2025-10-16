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
import { fetchQRNGBits } from './fetchQRNGBits.js';

import { preQuestions, postQuestions } from './questions.js';
import { QuestionsForm } from './Forms.jsx';
import { BlockScoreboard } from './Scoring.jsx';
import HighScoreEmailGate from './ui/HighScoreEmailGate.jsx';
import ConsentGate from './ui/ConsentGate.jsx';

// Runtime configuration validation
function validateConfig() {
  const errors = [];

  if (!C.VISUAL_HZ || C.VISUAL_HZ <= 0) errors.push('VISUAL_HZ must be positive');
  if (!C.BLOCKS_TOTAL || C.BLOCKS_TOTAL <= 0) errors.push('BLOCKS_TOTAL must be positive');
  if (!C.TRIALS_PER_BLOCK || C.TRIALS_PER_BLOCK <= 0) errors.push('TRIALS_PER_BLOCK must be positive');
  if (!C.BITS_PER_BLOCK || C.BITS_PER_BLOCK <= 0) errors.push('BITS_PER_BLOCK must be positive');
  if (C.PRIME_PROB < 0 || C.PRIME_PROB > 1) errors.push('PRIME_PROB must be between 0 and 1');
  if (!Array.isArray(C.TARGET_SIDES) || C.TARGET_SIDES.length === 0) errors.push('TARGET_SIDES must be non-empty array');

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
const PAUSE_THRESHOLD_LT = 1;     // PAUSE when buffer < 1 byte (was 6 bits, now ~1 byte for 2 trials)
                                  // - Low enough to maximize quantum data usage
                                  // - High enough to prevent buffer starvation

const RESUME_THRESHOLD_GTE = 3;   // RESUME when buffer ≥ 3 bytes (was 20 bits, now ~3 bytes for safe resume)
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
  pause: `Pause if buffer < ${PAUSE_THRESHOLD_LT} bytes`,
  resume: `Resume when buffer ≥ ${RESUME_THRESHOLD_GTE} bytes`,
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

function flattenBits(accum) {
  // flatten nested arrays deeply and coerce booleans/strings to numbers 0/1
  return accum.flat ? accum.flat(Infinity).map(b => Number(b ? 1 : 0)) :
    accum.reduce((out, item) => out.concat(Array.isArray(item) ? item : [item]), []).map(b => Number(b ? 1 : 0));
}

// Break a bit array into non-overlapping windows and compute entropy per window.
// Leaves any trailing remainder in-place in the accumulator.



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
  // AI-mode for AI agent sessions (activated via URL hash #ai)
  const isAIMode = window.location.hash.includes('ai');
  const [autoSessionCount, setAutoSessionCount] = useState(0);
  const [autoSessionTarget, setAutoSessionTarget] = useState(isAIMode ? C.AI_MODE_SESSIONS : C.AUTO_MODE_SESSIONS);

  const [userReady, setUserReady] = useState(false);
  const [uid, setUid] = useState(null);
  const {
    connect: liveConnect,
    disconnect: liveDisconnect,
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

  // ---- target assignment
  const [target, setTarget] = useState(null);
  // Note: Using trial-level bit strategy (odd=alternating, even=independent)
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

    // Note: No session-level bit strategy assignment needed
    // Using trial-level logic: odd trials = alternating, even trials = independent
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
        if (!target) throw new Error('logic/order: target must be set before creating run');
        const uidNow = uid || (await requireUid());
        const col = collection(db, 'experiment3_ai_responses');
        const docData = {
          participant_id: uidNow,
          experimentId: C.EXPERIMENT_ID,
          createdAt: serverTimestamp(),
          target_side: target,
          tape_meta: null, // No tapes in live-only mode
          minutes_planned: C.BLOCKS_TOTAL, // All blocks are live
          timestamp: new Date().toISOString(),
          session_type: isAutoMode ? 'baseline' : isAIMode ? 'ai_agent' : 'human',
          mode: isAutoMode ? 'baseline' : isAIMode ? 'ai' : 'human',
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
  }, [runRef, target, uid, requireUid, isAutoMode, isAIMode]);

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
  const demonBitsRef = useRef([]);
  const alignedRef = useRef([]);
  const hitsRef = useRef(0);
  const demonHitsRef = useRef(0);
  const blockIdxToPersist = useRef(-1); // Stores the correct blockIdx to save
  const trialsPerMinute = trialsPerBlock;

  // Process trials with randomized half assignment (subject/demon)
  const processTrials = useCallback((quantumBits) => {
    console.log('🎲 Processing 150 trials with randomized half assignment...');

    if (quantumBits.length !== C.BITS_PER_BLOCK) {
      throw new Error(`Expected ${C.BITS_PER_BLOCK} bits, got ${quantumBits.length}`);
    }

    // Clear previous block data
    bitsRef.current = [];
    demonBitsRef.current = [];
    alignedRef.current = [];
    hitsRef.current = 0;
    demonHitsRef.current = 0;

    const targetBit = target === 'BLUE' ? 1 : 0;

    // Use first bit (bit 0) to decide assignment (QRNG-based, not Math.random())
    const assignmentBit = parseInt(quantumBits[0], 10);
    const subjectGetsFirstHalf = assignmentBit === 1;

    // Split remaining 300 bits (after assignment bit) into two halves for trials
    const halfA = quantumBits.slice(1, 151);    // bits 1-150 (150 bits)
    const halfB = quantumBits.slice(151, 301);  // bits 151-300 (150 bits)

    const subjectBits = subjectGetsFirstHalf ? halfA : halfB;
    const demonBits = subjectGetsFirstHalf ? halfB : halfA;

    console.log(`🎲 Assignment (QRNG bit ${assignmentBit}): Subject gets ${subjectGetsFirstHalf ? 'first' : 'second'} half, Demon gets ${subjectGetsFirstHalf ? 'second' : 'first'} half`);

    // Process subject bits
    for (let i = 0; i < 150; i++) {
      const bit = parseInt(subjectBits[i], 10);
      bitsRef.current.push(bit);
      alignedRef.current.push(bit === targetBit ? 1 : 0);
      if (bit === targetBit) hitsRef.current++;
    }

    // Process demon bits
    for (let i = 0; i < 150; i++) {
      const bit = parseInt(demonBits[i], 10);
      demonBitsRef.current.push(bit);
      if (bit === targetBit) demonHitsRef.current++;
    }

    const subjectScore = (hitsRef.current / 150 * 100).toFixed(1);
    const demonScore = (demonHitsRef.current / 150 * 100).toFixed(1);

    console.log('✅ Trials processed:', {
      subject: `${subjectScore}% (${hitsRef.current}/150)`,
      demon: `${demonScore}% (${demonHitsRef.current}/150)`
    });

    // Calculate stats
    const k = hitsRef.current;
    const kd = demonHitsRef.current;
    const n = 150;
    const z = zFromBinom(k, n, 0.5);
    const zd = zFromBinom(kd, n, 0.5);
    const pTwo = twoSidedP(z);
    const pd = twoSidedP(zd);

    const blockSummary = {
      k, n, z, pTwo,
      kd, nd: n, zd, pd,
      kind: 'instant'
    };

    setLastBlock(blockSummary);
    setTotals(t => ({ k: t.k + k, n: t.n + n }));

    // Increment block index
    setblockIdx(prev => prev + 1);

    // Note: persistMinute will be called after this via a useEffect watching blockIdx

  }, [target]);

  // Calculate and save session-level temporal entropy (k=2 and k=3 windows)
  const calculateSessionTemporalEntropy = useCallback(async () => {
    if (!runRef) return;

    try {
      const allSubjectBits = [];
      const allGhostBits = [];

      // Fetch all minutes to get their indices
      const minutesSnapshot = await getDocs(collection(runRef, 'minutes'));
      const sortedMinutes = minutesSnapshot.docs
        .map(d => ({ id: d.id, ref: d.ref, idx: d.data().idx || 0 }))
        .sort((a, b) => a.idx - b.idx);

      // For each minute, read trials subcollection and extract bits in order
      for (const minute of sortedMinutes) {
        const trialsSnapshot = await getDocs(collection(minute.ref, 'trials'));

        // Sort trials by trialIndex to maintain proper order
        const sortedTrials = trialsSnapshot.docs
          .map(d => d.data())
          .sort((a, b) => (a.trialIndex || 0) - (b.trialIndex || 0));

        sortedTrials.forEach(trial => {
          allSubjectBits.push(trial.subjectBit);
          allGhostBits.push(trial.ghostBit);
        });
      }

      const n = allSubjectBits.length;

      if (n === 0) {
        console.warn('No subject bits found for session-level entropy calculation');
        return;
      }

      // NEW: Aggregate block-level entropy trajectories for H(t) fitting
      const allBlockEntropySubj = [];
      const allBlockEntropyGhost = [];

      // Fetch block-level entropy from each minute
      for (const minute of sortedMinutes) {
        const minuteDoc = await getDoc(minute.ref);
        const minuteData = minuteDoc.data();

        if (minuteData?.entropy?.block_entropy_subj !== undefined) {
          allBlockEntropySubj.push({
            blockIdx: minuteData.entropy.block_idx,
            entropy: minuteData.entropy.block_entropy_subj,
            timestamp: minuteData.entropy.block_timestamp || minuteData.timing?.block_start_time
          });
        }

        if (minuteData?.entropy?.block_entropy_ghost !== undefined) {
          allBlockEntropyGhost.push({
            blockIdx: minuteData.entropy.block_idx,
            entropy: minuteData.entropy.block_entropy_ghost,
            timestamp: minuteData.entropy.block_timestamp || minuteData.timing?.block_start_time
          });
        }
      }

      console.log('📈 BLOCK-LEVEL ENTROPY TRAJECTORIES:', {
        subjectBlocks: allBlockEntropySubj.length,
        ghostBlocks: allBlockEntropyGhost.length,
        sampleSubject: allBlockEntropySubj.slice(0, 5).map(b => `Block ${b.blockIdx}: ${b.entropy.toFixed(4)}`),
        sampleGhost: allBlockEntropyGhost.slice(0, 5).map(b => `Block ${b.blockIdx}: ${b.entropy.toFixed(4)}`)
      });

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

      console.log('📊 SESSION-LEVEL TEMPORAL ENTROPY:', {
        totalBits: n,
        k2_windows: entropy_k2.map((e, i) => `W${i+1}: ${e?.toFixed(4) || 'null'}`),
        k3_windows: entropy_k3.map((e, i) => `W${i+1}: ${e?.toFixed(4) || 'null'}`),
        k2_sizes: [half, n - half],
        k3_sizes: [third, third, n - 2 * third]
      });

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

      console.log('✅ Session-level temporal entropy saved to DB', {
        bitsIncluded: n
      });

      // Reset all accumulators to prevent bleed into next session
      bitsRef.current = [];
      demonBitsRef.current = [];
      alignedRef.current = [];
      console.log('🔄 Reset all accumulators for next session');
    } catch (error) {
      console.error('Error calculating session temporal entropy:', error);
    }
  }, [runRef]);

  // Fetch subject+demon tape when entering fetching phase, then process trials
  const [needsPersist, setNeedsPersist] = useState(false);

  useEffect(() => {
    if (phase !== 'fetching') return;
    // Guard: Don't fetch if we've already completed all blocks
    if (blockIdx >= C.BLOCKS_TOTAL) {
      console.log(`⚠️ Blocked fetch: blockIdx ${blockIdx} >= BLOCKS_TOTAL 
  ${C.BLOCKS_TOTAL}`);
      setPhase('done');
      return;
    }

    let isCancelled = false;

    (async () => {
      try {
        console.log(`🎯 Fetching ${C.BITS_PER_BLOCK} bits during focused intention...`);

        // Fetch quantum bits (301 bits: 1 for assignment + 300 for trials)
        const quantumBits = await fetchQRNGBits(C.BITS_PER_BLOCK);

        if (isCancelled) return;

        console.log('✅ Bits fetched:', quantumBits.length);

        // Check if we just completed the final block BEFORE processing
        // blockIdx in closure is the value BEFORE processTrials increments it
        const justCompletedBlockIdx = blockIdx;
        const nextBlockIdx = justCompletedBlockIdx + 1;

        // Store the current blockIdx before it gets incremented (this is what persistMinute should use)
        blockIdxToPersist.current = blockIdx;

        // Process all trials instantly (this increments blockIdx from blockIdx to blockIdx+1)
        processTrials(quantumBits);

        console.log(`📊 Block ${justCompletedBlockIdx} complete. Next blockIdx: ${nextBlockIdx}, BLOCKS_TOTAL: ${C.BLOCKS_TOTAL}`);

        // Always persist (we need all 30 blocks saved, idx 0-29)
        setNeedsPersist(true);

        // Always go to score phase first to show results
        setPhase('score');

        // If this was the final block, calculate session entropy in background
        if (nextBlockIdx >= C.BLOCKS_TOTAL) {
          calculateSessionTemporalEntropy().catch(err =>
            console.error('Failed to calculate final entropy:', err)
          );
        }

      } catch (error) {
        console.error('❌ Failed to fetch bits:', error);

        // Capture detailed error information
        const errorDetails = {
          message: error.message || String(error),
          stack: error.stack,
          timestamp: new Date().toISOString(),
        };
        console.error('📋 Error details:', errorDetails);

        if (!isCancelled) {
          if (isAutoMode || isAIMode) {
            // Auto/AI mode: exit early without completing session (no alert popup)
            console.log(`🚫 ${isAIMode ? 'AI' : 'AUTO'}-MODE: QRNG unavailable after retries, exiting session early`);
            console.log(`💾 Saving ${blockIdx} completed blocks and marking as early exit due to QRNG unavailability`);
            // Mark as early exit and go to results
            if (runRef) {
              await updateDoc(runRef, {
                exitedEarly: true,
                exit_reason: 'qrng_unavailable',
                exit_error_details: errorDetails,
                exit_block_index: blockIdx
              });
            }
            setPhase('results');
          } else {
            // Human mode: show alert and exit gracefully
            alert('We ran out of QRNG data for today. Your progress has been saved. Please schedule a session with us or try again tomorrow.');
            // Save and exit
            if (runRef) {
              await updateDoc(runRef, {
                exitedEarly: true,
                exit_reason: 'qrng_unavailable',
                exit_error_details: errorDetails,
                exit_block_index: blockIdx
              });
            }
            setPhase('results');
          }
        }
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [phase, blockIdx, processTrials, calculateSessionTemporalEntropy, isAutoMode, isAIMode, runRef]);

  // Audit phase: Fetch audit bits in background and randomize target
  useEffect(() => {
    if (phase !== 'audit') return;

    let isCancelled = false;

    (async () => {
      try {
        console.log(`🔬 Fetching ${C.AUDIT_BITS_PER_BREAK} audit bits (no focus)...`);

        // Fetch audit bits (no validation needed during fetch, we'll validate after)
        const auditBits = await fetchQRNGBits(C.AUDIT_BITS_PER_BREAK, 3, false);

        if (isCancelled) return;

        // Calculate validation stats
        const ones = auditBits.split('').filter(b => b === '1').length;
        const proportion = ones / C.AUDIT_BITS_PER_BREAK;

        // Run validation tests
        const n = auditBits.length;
        const expectedOnes = n / 2;
        const stdDev = Math.sqrt(n * 0.5 * 0.5);
        const zScore = Math.abs((ones - expectedOnes) / stdDev);
        const proportionPass = zScore < 3;

        let runs = 1;
        for (let i = 1; i < n; i++) {
          if (auditBits[i] !== auditBits[i-1]) runs++;
        }
        const expectedRuns = (2 * ones * (n - ones)) / n + 1;
        const runsStdDev = Math.sqrt((2 * ones * (n - ones) * (2 * ones * (n - ones) - n)) / (n * n * (n - 1)));
        const runsZ = Math.abs((runs - expectedRuns) / runsStdDev);
        const runsPass = runsZ < 3;

        let maxRun = 1, currentRun = 1;
        for (let i = 1; i < n; i++) {
          if (auditBits[i] === auditBits[i-1]) {
            currentRun++;
            maxRun = Math.max(maxRun, currentRun);
          } else {
            currentRun = 1;
          }
        }
        const expectedMaxRun = Math.log2(n);
        const maxRunPass = maxRun < expectedMaxRun * 3;

        const isRandom = proportionPass && runsPass && maxRunPass;

        const validationStats = {
          length: n,
          ones,
          onesRatio: (ones / n).toFixed(4),
          zScore: zScore.toFixed(3),
          proportionPass,
          runs,
          expectedRuns: expectedRuns.toFixed(1),
          runsZ: runsZ.toFixed(3),
          runsPass,
          maxRun,
          expectedMaxRun: expectedMaxRun.toFixed(1),
          maxRunPass
        };

        console.log('✅ Audit complete:', { proportion: proportion.toFixed(4), isRandom, stats: validationStats });

        // Calculate audit entropy
        const auditBitArray = auditBits.split('').map(b => parseInt(b));
        const auditEntropy = shannonEntropy(auditBitArray);

        // Save audit to Firebase
        if (runRef) {
          const auditDoc = doc(runRef, 'audits', `after_block_${blockIdx}`);
          await setDoc(auditDoc, {
            blockAfter: blockIdx,
            totalBits: C.AUDIT_BITS_PER_BREAK,
            auditBits: auditBits, // Store the actual bit string for QA analysis
            ones,
            proportion,
            entropy: auditEntropy,
            isRandom,
            validation: validationStats,
            timestamp: Date.now()
          });
          console.log(`💾 Audit saved to Firebase (entropy: ${auditEntropy.toFixed(4)})`);
        }

        // Randomize target for next set of blocks
        const randomByte = crypto.getRandomValues(new Uint8Array(1))[0];
        const randomBit = randomByte & 1;
        const newTarget = randomBit ? 'BLUE' : 'ORANGE';

        console.log(`🎯 Target randomized: ${target} → ${newTarget}`);
        setTarget(newTarget);

      } catch (error) {
        console.error('❌ Audit failed:', error);
        // Don't block progression on audit failure
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [phase, blockIdx, runRef, target]);

  // Auto-mode and AI-mode: Skip consent/questions, auto-restart, and auto-continue rest screens
  useEffect(() => {
    if (!isAutoMode && !isAIMode) return;

    // Auto-mode: skip all screens
    // AI-mode: skip consent/pre_questions/info, but SHOW prime (research background)
    if (phase === 'consent' || phase === 'pre_questions' || phase === 'info') {
      console.log(`🤖 ${isAIMode ? 'AI-MODE' : 'AUTO-MODE'}: Skipping`, phase, '→', isAIMode && phase === 'consent' ? 'prime' : 'onboarding');
      setPhase(isAIMode && phase === 'consent' ? 'prime' : 'onboarding');
    } else if (isAutoMode && phase === 'prime') {
      // Auto-mode skips prime, AI-mode shows it
      console.log('🤖 AUTO-MODE: Skipping prime → onboarding');
      setPhase('onboarding');
    } else if (phase === 'score' && isAutoMode) {
      // Auto-continue score screens in auto-mode
      const timer = setTimeout(() => {
        console.log(`🤖 AUTO-MODE: Auto-continuing from score after ${C.AUTO_MODE_REST_MS / 1000}s`);
        // Check if session is complete (all 30 blocks done)
        if (blockIdx >= C.BLOCKS_TOTAL) {
          console.log('🤖 AUTO-MODE: Session complete, going to done phase');
          setPhase('done');
        } else {
          // Check if audit is needed based on the just-completed block (not the incremented blockIdx)
          const completedBlockIdx = blockIdxToPersist.current;
          const needsAudit = completedBlockIdx >= 0 && (completedBlockIdx + 1) % C.AUDIT_EVERY_N_BLOCKS === 0 && blockIdx < C.BLOCKS_TOTAL;
          setPhase(needsAudit ? 'audit' : 'target_announce');
        }
      }, C.AUTO_MODE_REST_MS);
      return () => clearTimeout(timer);
    } else if ((phase === 'rest' || phase === 'target_announce') && isAutoMode) {
      // Auto-continue rest/target_announce screens in auto-mode
      const timer = setTimeout(() => {
        console.log(`🤖 AUTO-MODE: Auto-continuing after ${C.AUTO_MODE_REST_MS / 1000}s from ${phase}`);
        setPhase('fetching'); // Go to fetching phase instead of old startNextMinute
      }, C.AUTO_MODE_REST_MS);
      return () => clearTimeout(timer);
    } else if (phase === 'audit' && isAutoMode) {
      // Auto-continue audit screens in auto-mode
      const timer = setTimeout(() => {
        console.log(`🤖 AUTO-MODE: Auto-continuing after ${C.AUTO_MODE_REST_MS / 1000}s from audit`);
        setPhase('target_announce');
      }, C.AUTO_MODE_REST_MS);
      return () => clearTimeout(timer);
    } else if (phase === 'done') {
      // Skip post-questionnaire in auto/AI mode, go to results
      // Note: exitedEarly is already false by default, so completing all 30 blocks = completer
      console.log(`🤖 ${isAIMode ? 'AI-MODE' : 'AUTO-MODE'}: Skipping post-questionnaire → results`);
      console.log(`✅ Session completed all ${C.BLOCKS_TOTAL} blocks (exitedEarly should be false)`);
      setPhase('results');
    } else if (phase === 'results' || phase === 'summary') {
      // Skip results/summary screens in auto/AI mode, go to next session
      console.log(`🤖 ${isAIMode ? 'AI-MODE' : 'AUTO-MODE'}: Skipping results/summary → next session`);
      setPhase('next');
    } else if (phase === 'next') {
      // Immediately transition to avoid re-triggering
      const newCount = autoSessionCount + 1;

      if (newCount < autoSessionTarget) {
        // Reset for next session
        console.log(`🤖 ${isAIMode ? 'AI-MODE' : 'AUTO-MODE'}: Session ${autoSessionCount}/${autoSessionTarget} complete, starting session ${newCount}`);
        setAutoSessionCount(newCount);
        setPhase('preparing_next');
      } else {
        console.log(`🤖 ${isAIMode ? 'AI-MODE' : 'AUTO-MODE'}: All ${autoSessionTarget} sessions complete!`);
        setAutoSessionCount(newCount); // Update count before showing completion
        setPhase(isAIMode ? 'ai_complete' : 'auto_complete');
      }
    } else if (phase === 'preparing_next') {
      // Delayed reset to ensure clean state transition
      setTimeout(() => {
        console.log(`🔄 Resetting state for next ${isAIMode ? 'AI' : 'auto'}-mode session`);
        setRunRef(null);
        setblockIdx(-1);
        setTotals({ k: 0, n: 0 });
        setLastBlock(null);
        setIsRunning(false);
        setPhase('consent');
      }, 100);
    }
    // Note: blockIdxToPersist is a ref, not a state, so it doesn't need to be in dependencies
  }, [isAutoMode, isAIMode, phase, blockIdx, autoSessionCount, autoSessionTarget, runRef]);
  const targetBit = target === 'BLUE' ? 1 : 0;

  // live buffer guardrails
  const [isBuffering, setIsBuffering] = useState(false);
  const pauseCountRef = useRef(0);
  const totalPausedMsRef = useRef(0);
  const longestPauseMsRef = useRef(0);
  const pauseStartedAtRef = useRef(0);
  const redoCurrentMinuteRef = useRef(false);
  const minuteInvalidRef = useRef(false);
  const invalidReasonRef = useRef('');

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
  const firstTrialTimeRef = useRef(0);
  const lastTrialTimeRef = useRef(0);

  // --- persist & end-minute (persist must be defined BEFORE endMinute) ---
  const persistMinute = useCallback(async () => {
    if (!runRef) return;

    // Use the captured blockIdx (before increment) instead of current blockIdx
    const saveBlockIdx = blockIdxToPersist.current;

    if (saveBlockIdx < 0 || saveBlockIdx >= C.BLOCKS_TOTAL) {
      console.log(`⚠️ Skipping persist: invalid blockIdx ${saveBlockIdx} (should be 0-${C.BLOCKS_TOTAL - 1})`);
      return;
    }

    const n = 150;
    const k = hitsRef.current;
    const kd = demonHitsRef.current;

    const z = zFromBinom(k, n, 0.5);
    const pTwo = twoSidedP(z);
    const zd = zFromBinom(kd, n, 0.5);
    const pd = twoSidedP(zd);

    // Subject metrics
    const cohRange = cumulativeRange(bitsRef.current);
    const hurst = hurstApprox(bitsRef.current);
    const ac1 = lag1Autocorr(bitsRef.current);

    // Demon metrics
    const dCohRange = cumulativeRange(demonBitsRef.current);
    const dHurst = hurstApprox(demonBitsRef.current);
    const dAc1 = lag1Autocorr(demonBitsRef.current);

    // Block-level entropy (150 bits per block)
    const blockSubjEntropy = bitsRef.current.length > 0 ? shannonEntropy(bitsRef.current) : null;
    const blockDemonEntropy = demonBitsRef.current.length > 0 ? shannonEntropy(demonBitsRef.current) : null;

    // Block-level k2 split
    const half = Math.floor(150 / 2);
    const blockK2Subj = [
      shannonEntropy(bitsRef.current.slice(0, half)),
      shannonEntropy(bitsRef.current.slice(half))
    ];
    const blockK2Demon = [
      shannonEntropy(demonBitsRef.current.slice(0, half)),
      shannonEntropy(demonBitsRef.current.slice(half))
    ];

    // Block-level k3 split
    const third = Math.floor(150 / 3);
    const blockK3Subj = [
      shannonEntropy(bitsRef.current.slice(0, third)),
      shannonEntropy(bitsRef.current.slice(third, 2 * third)),
      shannonEntropy(bitsRef.current.slice(2 * third))
    ];
    const blockK3Demon = [
      shannonEntropy(demonBitsRef.current.slice(0, third)),
      shannonEntropy(demonBitsRef.current.slice(third, 2 * third)),
      shannonEntropy(demonBitsRef.current.slice(2 * third))
    ];

    console.log(`📊 BLOCK ENTROPY: Block ${saveBlockIdx}, Subject: ${blockSubjEntropy?.toFixed(4)}, Demon: ${blockDemonEntropy?.toFixed(4)}`);

    const mdoc = doc(runRef, 'minutes', String(saveBlockIdx));

    console.log(`💾 Saving block ${saveBlockIdx} to Firestore`);

    const targetBit = target === 'BLUE' ? 1 : 0;

    await setDoc(mdoc, {
      idx: saveBlockIdx,
      kind: 'instant',
      ended_by: 'instant_process',
      startedAt: serverTimestamp(),

      // Subject data
      n, hits: k, z, pTwo,
      coherence: { cumRange: cohRange, hurst },
      resonance: { ac1 },

      // Demon data
      demon_hits: kd, demon_z: zd, demon_pTwo: pd,
      demon_metrics: {
        coherence: { cumRange: dCohRange, hurst: dHurst },
        resonance: { ac1: dAc1 }
      },

      // Entropy
      entropy: {
        block_entropy_subj: blockSubjEntropy,
        block_entropy_demon: blockDemonEntropy,
        block_k2_subj: blockK2Subj,
        block_k2_demon: blockK2Demon,
        block_k3_subj: blockK3Subj,
        block_k3_demon: blockK3Demon,
        bits_count: 150
      },

      // Store bit sequences
      trial_data: {
        subject_bits: bitsRef.current,
        demon_bits: demonBitsRef.current,
        target_bit: targetBit,
        trial_count: 150
      }
    }, { merge: true });

    console.log('💾 Saved block data:', { blockIdx, subjectHits: k, demonHits: kd });
  }, [runRef, blockIdx, target]);

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
  }, [liveDisconnect, persistMinute]);
  // Idle prefetch during PRIME/REST in non-streaming mode
  useEffect(() => {
    // Never prefetch in streaming mode
    if (C.USE_LIVE_STREAM) return;

    // Only consider prefetching after onboarding has begun (avoid consent/preQ)
    const allowedPhases = new Set(['prime', 'rest']);
    if (!allowedPhases.has(phase)) return;

    // When NOT running, if the next minute is 'live' and not already staged, prefetch now
    if (phase !== 'running') {
      // All blocks are live now - always prefetch
      if (!nextLiveBufRef.current) {
        prefetchLivePairs().catch(() => { /* ignore */ });
      }
    }
  }, [phase, blockIdx, prefetchLivePairs]);
  useEffect(() => {
    endMinuteRef.current = endMinute;
  }, [endMinute]);

  // Save block data after processing (must be after persistMinute is defined)
  useEffect(() => {
    if (!needsPersist || !runRef) return;

    console.log('💾 Saving block data to Firestore...');
    persistMinute()
      .then(() => {
        console.log('✅ Block data saved');
        setNeedsPersist(false);
      })
      .catch(err => {
        console.error('❌ Failed to save block data:', err);
        setNeedsPersist(false);
      });
  }, [needsPersist, runRef, persistMinute]);

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
    if (tickTimerRef.current) {
      console.warn('⚠️ Clearing existing tick timer before starting new one!');
      clearInterval(tickTimerRef.current);
      tickTimerRef.current = null;
    }

    console.log(`⏱️ Starting tick timer for block ${blockIdx} with TICK=${TICK}ms`);
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

      if (i >= MAX_TRIALS) {
        console.log('✅ TRIALS COMPLETE:', {
          trialCount: i,
          MAX_TRIALS,
          elapsed,
          actualTrials: alignedRef.current.length
        });
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

      let bit, ghost;
      if (C.USE_LIVE_STREAM) {
        const now = performance.now();
        if (isBuffering) { maybeResume(now); return; } // Don't increment i when buffering
        else { maybePause(now); if (isBuffering) { return; } } // Don't increment i when buffering starts
        // Use trial-level BIT strategy: odd trials = alternating, even trials = independent
        const trialNumber = i + 1; // Convert 0-based to 1-based for odd/even logic
        const sBitObj = livePopSubjectBit(trialNumber); const gBitObj = livePopGhostBit(trialNumber);
        if (sBitObj === null || gBitObj === null) {
          console.warn('🔴 NULL BITS DETECTED - pausing:', {
            trialNumber,
            sBitObj, gBitObj,
            bufferSize: liveBufferedBits(),
            isBuffering
          });
          maybePause(now);
          return;
        } // Don't increment i when no bits available

        // Extract bit values and indices
        const subjectBit = sBitObj.bit;
        const ghostBit = gBitObj.bit;

        // Convert bit strings to integers for display logic
        bit = subjectBit === '1' ? 1 : 0;
        ghost = ghostBit === '1' ? 1 : 0;

        // Debug early trials to see initial buffer bias
        if (i < 20) {
          console.log(`🔍 EARLY TRIAL ${i}:`, {
            subjectBit, ghostBit,
            sNum: bit, gNum: ghost,
            align: bit === targetBit ? 'HIT' : 'MISS',
            ghostAlign: ghost === targetBit ? 'HIT' : 'MISS',
            target: target,
            targetBit: targetBit,
            bufferSize: liveBufferedBits()
          });
        }

        // Ghost tracking disabled - no longer used
        // (Commented out to remove ghost references)
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
      const now = Date.now();
      console.log('⏰ Tick timing:', { i, elapsed: now - start, expected: i * TICK });
      // Capture first trial timestamp
      if (i === 0) {
        firstTrialTimeRef.current = now;
      }

      bitsRef.current.push(bit);
      // Ghost tracking removed - no longer used
      const align = bit === targetBit ? 1 : 0;
      alignedRef.current.push(align);
      hitsRef.current += align;

      // Trigger re-render for UI updates
      setRenderTrigger(prev => prev + 1);

      // Update last trial timestamp (will be final value when loop completes)
      lastTrialTimeRef.current = now;

      i += 1; // Only increment when we actually process a trial
    }, TICK);

    return () => { if (tickTimerRef.current) { clearInterval(tickTimerRef.current); tickTimerRef.current = null; } };
  }, [
    isRunning, blockIdx, trialsPerMinute, targetBit, target,
    livePopSubjectBit, livePopGhostBit, liveBufferedBits, maybePause, maybeResume, shouldInvalidate, trialsPerBlock, isBuffering,
  ]);





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

  // CONSENT - Skip for auto/AI modes
  if (phase === 'consent') {
    // Auto and AI modes skip consent and questions
    if (isAutoMode || isAIMode) {
      setPhase('prime');
      return null;
    }

    return (
      <div style={{ position: 'relative' }}>
        <ConsentGate
          title="Consent to Participate"
          studyDescription="This study investigates whether focused attention can correlate with patterns in random color generation during attention tasks. You will complete 30 blocks each 5 seconds long and brief questionnaires (approximately 3 minutes total)."
          bullets={[
            'You will focus on an assigned target color (orange or blue) and attempt to influence quantum random outcomes through focused intention.',
            'Your task is to concentrate your attention on your target color during the moment quantum data is fetched from a quantum random number generator.',
            'Each block begins when you click "I\'m Ready" - this triggers quantum data retrieval while your target color pulses on screen.',
            'We collect data on quantum random sequences, your performance metrics, timing patterns, and your questionnaire responses.',
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

  // PRE QUESTIONS - Skip for auto/AI modes
  if (phase === 'preQ') {
    // Auto and AI modes skip questions
    if (isAutoMode || isAIMode) {
      setPhase('prime');
      return null;
    }

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
            <h3 style={{ marginTop: 0, color: '#2c3e50' }}>PK Research: Moving Beyond "Does It Exist?"</h3>
            <div style={{ lineHeight: 1.6, fontSize: 15 }}>
              <p>Between 1959 and 2000, researchers conducted 515 carefully controlled laboratory experiments testing whether human intention could influence random number generators. The combined results deviated more than 16 standard deviations from pure chance. To put that in perspective: the odds of this happening by accident are essentially zero. The effect is tiny—less than 1% deviation on average. But here's what matters: it never goes away.</p>

              <p>Studies published after 1987 showed nearly identical effect sizes to earlier work (z-scores of 0.61 vs 0.73), even as experimental quality dramatically improved over this period. As scientists got better at controlling for errors and tightening protocols, the effect remained rock-solid stable.</p>

              <p>The skeptics' objections don't add up. To dismiss these results as publication bias, you'd need to believe that 91 researchers collectively conducted and hid nearly 3,000 failed experiments. When three independent labs—Princeton, Giessen, and Freiburg—ran a strict replication with identical equipment, all three found effects in the predicted direction with "substantial structural anomalies well beyond chance expectation". </p>
              <p>Four decades. Nearly 100 researchers. Multiple continents. Increasingly rigorous controls. The same small, persistent deviation from randomness, appearing again and again and again.</p>
              <p>Because the effect of human intention on RNG's is so small, we're now examining its statistical signatures including the temporal patterns, correlation structures, and relationships to other variables—to distinguish genuine anomalies from methodological artifacts and develop more specific, testable hypotheses about what's actually happening.</p>

              <p style={{ fontStyle: 'italic', color: '#555', marginBottom: 0 }}>Your participation helps map the landscape of consciousness-matter interaction.</p>
            </div>
          </div>

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

  // INFO SCREEN (binaural beats information) - Skip for auto/AI modes
  if (phase === 'info') {
    // Auto and AI modes skip binaural beats info
    if (isAutoMode || isAIMode) {
      setPhase('onboarding');
      return null;
    }

    const binauralText = "Correlations have been found with some researchers claiming mental coherence increasing PSI through use of binaural beats.";

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

    // Show auto-mode status if active
    if (isAutoMode) {
      // Auto-start when runRef is ready
      if (canContinue && !isRunning) {
        console.log('🤖 AUTO-MODE: Auto-starting trials for session', autoSessionCount + 1);
        ensureRunDoc().then(() => {
          setblockIdx(0); // Initialize to 0 for first block
          setPhase('rest');
        }); // Go to rest, then auto-mode will trigger fetching
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

    // AI mode - auto-initialize runRef to enable Continue button (but still require AI to click it)
    if (isAIMode && !canContinue && !isRunning && target && uid) {
      console.log('🤖 AI-MODE: Auto-initializing runRef to enable Continue button...');
      ensureRunDoc().catch(err => {
        console.error('❌ AI-MODE: Failed to initialize runRef:', err);
      });
    }

    return (
      <div style={{ padding: 24, maxWidth: 760, position: 'relative' }}>
        <h1>{isAIMode ? '🤖 AI Agent Mode' : 'Assessing Randomness Suppression During Conscious Intention Tasks — Pilot Study'}</h1>

        <div style={{ marginBottom: 30, marginTop: 30 }}>
          <h3 style={{ color: '#2c3e50', marginBottom: 15 }}>What to Expect:</h3>
          <ul style={{ fontSize: 16, lineHeight: 1.8 }}>
            <li>You'll complete 30 short blocks with breaks between each. Your only task is to know that your target color will appear more often than 50%.</li>
            <li><strong>Critical moment:</strong> When you click "I'm Ready", the system will fetch quantum random data while your target color pulses on screen. <strong>This is when to focus all your intention on your target color.</strong></li>
            <li>After the quantum data is retrieved, results appear instantly.</li>
            <li>During breaks, you'll see your performance summary before the next block.</li>
            {debugUI && (
              <li style={{ opacity: 0.8 }}>{POLICY_TEXT.warmup}; {POLICY_TEXT.pause}; {POLICY_TEXT.resume}</li>
            )}
          </ul>
        </div>

        {/* Continue button */}
        <div style={{ textAlign: 'center', marginTop: 40 }}>
          <button
            onClick={() => {
              if (canContinue && !isRunning) {
                console.log('✅ Starting experiment...');
                ensureRunDoc().then(() => {
                  console.log('✅ ensureRunDoc complete, transitioning to rest phase');
                  setblockIdx(0);
                  setPhase('rest');
                }).catch(err => {
                  console.error('❌ ensureRunDoc failed:', err);
                });
              }
            }}
            disabled={!canContinue}
            style={{
              padding: '20px 60px',
              fontSize: 20,
              fontWeight: 'bold',
              background: canContinue ? '#10b981' : '#ccc',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: canContinue ? 'pointer' : 'not-allowed',
              boxShadow: canContinue ? '0 4px 6px rgba(0,0,0,0.1)' : 'none'
            }}
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  // SCORE - Show last block results
  if (phase === 'score') {
    const pctLast = lastBlock && lastBlock.n ? Math.round((100 * lastBlock.k) / lastBlock.n) : 0;
    // Use the just-completed block index (the one that was saved, not the incremented one)
    const completedBlockIdx = blockIdxToPersist.current;
    const completedBlockNum = completedBlockIdx + 1; // Human-readable (1-30)
    // Show audit after blocks 5, 10, 15, 20, 25 (when completed block is 4, 9, 14, 19, 24 in 0-indexed)
    const needsAudit = completedBlockIdx >= 0 && (completedBlockIdx + 1) % C.AUDIT_EVERY_N_BLOCKS === 0 && blockIdx < C.BLOCKS_TOTAL;
    const isSessionComplete = blockIdx >= C.BLOCKS_TOTAL;

    // Expose state for AI agent to read
    if (isAIMode && typeof window !== 'undefined') {
      window.expState = {
        phase: 'score',
        blockIdx: completedBlockNum, // Use human-readable block number (1-30) for consistency with other phases
        completedBlock: completedBlockNum,
        totalBlocks: C.BLOCKS_TOTAL,
        score: pctLast,
        hits: lastBlock?.k || 0,
        trials: lastBlock?.n || 0,
        isSessionComplete,
        needsAudit
      };
    }

    return (
      <div style={{ padding: 24, textAlign: 'center', maxWidth: 600, margin: '0 auto' }}>
        <h2 style={{ marginBottom: 20 }}>Block {completedBlockNum} Complete</h2>

        {/* Show last block score */}
        {lastBlock && lastBlock.n > 0 && (
          <div
            style={{
              display: 'inline-block',
              padding: '16px 24px',
              borderRadius: 12,
              border: '2px solid #ddd',
              background: '#f9f9f9',
              marginBottom: 24,
              fontSize: 24,
              fontWeight: 600
            }}
          >
            Your Score: {pctLast}% ({lastBlock.k}/{lastBlock.n} HITs)
          </div>
        )}

        {/* Session totals */}
        <BlockScoreboard
          last={lastBlock || { k: 0, n: 0, z: 0, pTwo: 1, kind: 'instant' }}
          totals={totals}
          targetSide={target}
          hideGhost={true}
          hideBlockType={true}
        />

        <button
          onClick={() => {
            // Check if this was the final block
            if (blockIdx >= C.BLOCKS_TOTAL) {
              setPhase('done');
            } else if (needsAudit) {
              setPhase('audit');
            } else {
              setPhase('target_announce');
            }
          }}
          style={{
            marginTop: 32,
            padding: '16px 32px',
            fontSize: 18,
            fontWeight: 600,
            background: '#10b981',
            color: 'white',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
          }}
        >
          Continue
        </button>

        <p style={{ marginTop: 16, fontSize: 14, color: '#6b7280' }}>
          Block {completedBlockNum} of {C.BLOCKS_TOTAL}
        </p>
      </div>
    );
  }

  // TARGET_ANNOUNCE / REST - Large target display with "I'm Ready" button
  if (phase === 'target_announce' || phase === 'rest') {
    const targetColor = target === 'BLUE' ? '#1e40af' : '#ea580c';
    const targetEmoji = target === 'BLUE' ? '🟦' : '🟠';
    const isFirstBlock = blockIdx === 0;

    // Expose state for AI agent to read
    if (isAIMode && typeof window !== 'undefined') {
      window.expState = {
        target,
        score: 0,
        hits: 0,
        trials: 0,
        totalTrials: trialsPerBlock,
        blockIdx: blockIdx,
        totalBlocks: C.BLOCKS_TOTAL
      };
    }

    return (
      <div style={{ padding: 24, textAlign: 'center', maxWidth: 600, margin: '0 auto' }}>
        {/* Large target display */}
        <div style={{
          padding: 60,
          background: '#f9f9f9',
          borderRadius: 20,
          border: `4px solid ${targetColor}`,
          marginBottom: 40
        }}>
          <p style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 20, color: '#666' }}>
            Your Target:
          </p>
          <div style={{ fontSize: 96, marginBottom: 10 }}>
            {targetEmoji}
          </div>
          <div style={{ fontSize: 48, fontWeight: 'bold', color: targetColor }}>
            {target}
          </div>
        </div>

        {/* Ready prompt */}
        <div style={{
          padding: 24,
          background: '#f0f7ff',
          borderRadius: 12,
          border: '2px solid #3b82f6',
          marginBottom: 24
        }}>
          <p style={{ fontSize: 18, marginBottom: 16, fontWeight: 500 }}>
            {isFirstBlock ? 'Ready to begin?' : 'Ready for the next block?'}
          </p>

          <p style={{ fontSize: 16, marginBottom: 8, color: '#555' }}>
            We're about to fetch quantum data from the QRNG.
          </p>
          <p style={{ fontSize: 16, marginBottom: 20, color: '#555' }}>
            <strong>Know that your target color will appear more often than 50%.</strong> Click when ready.
          </p>

          <button
            onClick={() => setPhase('fetching')}
            style={{
              padding: '16px 48px',
              fontSize: 20,
              fontWeight: 'bold',
              borderRadius: 8,
              border: 'none',
              background: target === 'BLUE' ? '#1e40af' : '#ea580c',
              color: '#fff',
              cursor: 'pointer',
              transition: 'transform 0.1s'
            }}
            onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.95)')}
            onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
            onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
          >
            I'm Ready
          </button>
        </div>

        <div style={{ fontSize: 14, opacity: 0.75, marginTop: 16 }}>
          Block {blockIdx + 1} of {C.BLOCKS_TOTAL}
        </div>
      </div>
    );
  }

  // AUDIT - Rest & recovery screen with audit fetch in background
  if (phase === 'audit') {
    // Use the just-completed block for display
    const completedBlockIdx = blockIdxToPersist.current;
    const completedBlockNum = completedBlockIdx + 1;

    return (
      <div style={{ padding: 24, textAlign: 'center', maxWidth: 600, margin: '0 auto' }}>
        <h2 style={{ marginBottom: 32 }}>Block {completedBlockNum} Complete</h2>

        {/* Audit rest prompt */}
        <div style={{
          marginTop: 32,
          padding: 32,
          background: '#f0fdf4',
          borderRadius: 12,
          border: '2px solid #10b981'
        }}>
          <h3 style={{ color: '#059669', marginBottom: 16 }}>Rest & Recovery</h3>
          <p style={{ fontSize: 18, lineHeight: 1.6, marginBottom: 16 }}>
            Take a moment to breathe and relax...
          </p>
          <p style={{ fontSize: 14, color: '#6b7280' }}>
            Clear your mind. Let go of any focus or intention.
          </p>
        </div>

        {/* Continue button */}
        <button
          onClick={() => setPhase('target_announce')}
          style={{
            marginTop: 32,
            padding: '16px 32px',
            fontSize: 18,
            fontWeight: 600,
            background: '#10b981',
            color: 'white',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
          }}
          onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.95)')}
          onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
          onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
        >
          Continue
        </button>

        <p style={{ marginTop: 16, fontSize: 14, color: '#6b7280' }}>
          Block {completedBlockNum} of {C.BLOCKS_TOTAL}
        </p>
      </div>
    );
  }

  // FETCHING - Full-screen target color with 5Hz pulse + white spinner
  if (phase === 'fetching') {
    const targetColor = target === 'BLUE' ? '#1e40af' : '#ea580c';
    const pulseKeyframes = `
      @keyframes breathe {
        0%, 100% { opacity: 0.8; }
        50% { opacity: 1; }
      }
    `;

    return (
      <>
        <style>{pulseKeyframes}</style>
        <div style={{
          position: 'fixed',
          inset: 0,
          background: targetColor,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          animation: 'breathe 200ms ease-in-out infinite', // 5 Hz = 200ms cycle
        }}>
          {/* White spinner */}
          <div style={{
            width: 80,
            height: 80,
            border: '8px solid rgba(255, 255, 255, 0.3)',
            borderTop: '8px solid white',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            marginBottom: 24
          }} />

          <style>{`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>

          <p style={{
            color: 'white',
            fontSize: 24,
            fontWeight: 500,
            textAlign: 'center'
          }}>
            Fetching quantum data...
          </p>
        </div>
      </>
    );
  }

  // RUNNING phase removed - trials process instantly now

  // POST QUESTIONS - Skip for auto/AI modes
  if (phase === 'done') {
    // Auto and AI modes skip post questions and go straight to results
    if (isAutoMode || isAIMode) {
      setPhase('results');
      return null;
    }

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

        {/* Hide email capture for auto-mode and AI-mode */}
        {!isAutoMode && !isAIMode && (
          <HighScoreEmailGate
            experiment="exp3"
            step="done"
            sessionId={runRef?.id}
            participantId={uid}
            finalPercent={finalPct}
            cutoffOverride={C.FINALIST_MIN_PCT}
            lowCutoffOverride={C.FINALIST_MAX_PCT}
          />
        )}

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

  // AUTO-MODE / AI-MODE COMPLETION SCREEN
  if (phase === 'auto_complete' || phase === 'ai_complete') {
    return (
      <div className="App" style={{ textAlign: 'center', maxWidth: 600, margin: '0 auto', padding: 24 }}>
        <h1>🤖 {phase === 'ai_complete' ? 'AI-Mode' : 'Auto-Mode'} Complete</h1>
        <div style={{ marginTop: 32, padding: '24px', background: '#f0fdf4', border: '2px solid #10b981', borderRadius: 8 }}>
          <h2 style={{ color: '#059669', marginBottom: 16 }}>✓ {phase === 'ai_complete' ? 'AI Agent Sessions' : 'Baseline Data Collection'} Complete</h2>
          <p style={{ fontSize: 18, marginBottom: 12 }}>
            Successfully completed {autoSessionCount} {phase === 'ai_complete' ? 'AI agent' : 'baseline'} session{autoSessionCount !== 1 ? 's' : ''}
          </p>
          <p style={{ color: '#6b7280', fontSize: 14 }}>
            Data has been saved to the database. You can now view the results in the QA dashboard.
          </p>
        </div>

        <div style={{ marginTop: 24, padding: '16px', background: '#fff', border: '1px solid #ddd', borderRadius: 8 }}>
          <p style={{ fontFamily: 'monospace', fontSize: 12, color: '#6b7280' }}>
            {phase === 'ai_complete' ? 'AI-mode enabled via #ai URL hash' : 'Auto-mode enabled via #auto URL hash'}
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
