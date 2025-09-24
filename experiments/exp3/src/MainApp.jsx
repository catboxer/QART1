// src/MainApp.jsx
import './App.css';
import React, {
  Component,
  useEffect,
  useMemo,
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
import { BlockScoreboard, SessionSummary } from './Scoring.jsx';
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
  if (!C.RETRO_TAPE_BITS || C.RETRO_TAPE_BITS <= 0) errors.push('RETRO_TAPE_BITS must be positive');
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

// ===== live buffer policy (auto-scales with VISUAL_HZ) =====
const TICK_MS = Math.round(1000 / C.VISUAL_HZ);
const WARMUP_BITS_START = 24;
const WARMUP_TIMEOUT_MS = 1500;
const PAUSE_THRESHOLD_LT = 6; //when the buffer drops below this, we pause.
const RESUME_THRESHOLD_GTE = 20; //We resume only once the buffer reaches this.
const MAX_PAUSES = 3; //How many pauses we will tolerate before invalidating the minute.
const MAX_TOTAL_PAUSE_MS = 5 * TICK_MS;
const MAX_SINGLE_PAUSE_MS = 3 * TICK_MS;

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
async function sha256Hex(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
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
function bytesToBits(bytes, nBits) {
  const bits = [];
  for (let i = 0; i < nBits; i++) bits.push((bytes[i >> 3] >>> (i & 7)) & 1);
  return bits;
}
function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint8Array(1))[0] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function makeRedundancyPlan(numRetro) {
  const base = ['R0', 'R1', 'R2'];
  const plan = [];
  while (plan.length < numRetro) plan.push(...shuffleInPlace(base.slice()));
  return plan.slice(0, numRetro);
}

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
  const main = targetBit === 1 ? '#cc0000' : '#008a00';
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
        <text x={cx - r} y={cy + 14} textAnchor="start" fontSize="11" fill={targetBit === 1 ? '#008a00' : '#cc0000'}>0%</text>
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
  useEffect(() => {
    if (target) return;
    const t = (crypto.getRandomValues(new Uint8Array(1))[0] & 1) ? 'RED' : 'GREEN';
    setTarget(t);
    const r = crypto.getRandomValues(new Uint8Array(1))[0] / 255;
    setPrimeCond(r < C.PRIME_PROB ? 'prime' : 'neutral');
  }, [target]);

  // ---- tapes
  const [tapeA, setTapeA] = useState(null);
  const [tapeB, setTapeB] = useState(null);
  const [tapeGhost, setTapeGhost] = useState(null);
  const [tapeMeta, setTapeMeta] = useState(null);
  const [busyTape, setBusyTape] = useState(false);
  const [tapesReady, setTapesReady] = useState(false); // gray out create button when complete

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

  async function makeTape(label = 'A') {
    const uidNow = uid || (await requireUid());
    const nBytes = Math.ceil(C.RETRO_TAPE_BITS / 8);
    const { bytes, source, fallback, lastErr } = await fetchBytes(nBytes);
    const H_tape = await sha256Hex(bytes);
    const createdISO = new Date().toISOString();
    const commitStr = [label, C.RETRO_TAPE_BITS, source, createdISO, H_tape].join('|');
    const H_commit = await sha256Hex(new TextEncoder().encode(commitStr));
    const bits = bytesToBits(bytes, C.RETRO_TAPE_BITS);
    try {
      // Ensure main experiment document exists first
      const mainRef = await ensureRunDoc();

      // Save tape as subcollection under main document (like exp1/exp2)
      const tapesCol = collection(mainRef, 'tapes');
      const tapeDocRef = await addDoc(tapesCol, {
        label, lenBits: C.RETRO_TAPE_BITS,
        createdAt: serverTimestamp(), createdAtISO: createdISO,
        providers: source, H_tape, H_commit,
        created_by: uidNow,
        qrng_fallback: !!fallback || null,
        qrng_error: fallback ? (lastErr || 'unknown') : null,
      });
      return { label, bits, H_tape, H_commit, createdISO, tapeId: tapeDocRef.id, source };
    } catch (e) {
      console.error('tapes/addDoc failed', e);
      throw e;
    }
  }

  async function prepareSessionArtifacts() {
    setBusyTape(true);
    try {
      const A = await makeTape('A');
      const G = await makeTape('GHOST');
      const B = C.RETRO_USE_TAPE_B_LAST ? await makeTape('B') : null;
      setTapeA(A); setTapeGhost(G); setTapeB(B);
      setTapeMeta({ H_tape: A.H_tape, H_commit: A.H_commit, tapeId: A.tapeId, createdISO: A.createdISO });
      setTapesReady(true);
    } finally {
      setBusyTape(false);
    }
  }

  // ---- schedule (18×150 driven by config: VISUAL_HZ * (BLOCK_MS/1000) should be 150; BLOCKS_TOTAL=18)
  const schedule = useMemo(() => {
    const startLive = (uid || 'x').charCodeAt(0) % 2 === 0;
    return Array.from({ length: C.BLOCKS_TOTAL }, (_, i) => (i % 2 === 0 ? startLive : !startLive) ? 'live' : 'retro');
  }, [uid]);
  const trialsPerBlock = Math.round((C.BLOCK_MS / 1000) * C.VISUAL_HZ);

  const lastRetroIdx = useMemo(() => {
    let last = -1; schedule.forEach((k, i) => { if (k === 'retro') last = i; }); return last;
  }, [schedule]);

  // Redundancy tiers plan (balanced)
  const redundancyPlan = useMemo(() => {
    const countRetro = schedule.filter(k => k === 'retro').length;
    return makeRedundancyPlan(countRetro);
  }, [schedule]);

  // ---- run doc
  const [runRef, setRunRef] = useState(null);
  const ensureRunDocPromiseRef = useRef(null); // Prevent race conditions
  const isCreatingDocRef = useRef(false); // Immediate flag to prevent race conditions

  async function ensureRunDoc(exitInfo = null) {
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
          tape_meta: tapeMeta || null,
          minutes_planned: schedule,
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
        console.log('ensureRunDoc: created document', docRef.id);
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
  }

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
  const targetBit = target === 'RED' ? 1 : 0;
  // Accumulate bits across minutes until we have full windows (e.g., 1000 bits)
  const entropyAccumRef = useRef({ subj: [], ghost: [] });
  // Running store of computed entropy windows (keeps history of windows across the run)
  const entropyWindowsRef = useRef({ subj: [], ghost: [] });
  // Configuration: window size for Shannon entropy (1000-bit standard)
  const ENTROPY_WINDOW_SIZE = 1000;

  // Retro pass & redundancy info (audit)
  const retroPassRef = useRef(0);
  const redundancyRef = useRef(null);
  const retroOrdinalRef = useRef(0);

  // S-Selection mapping & micro-entropy
  const [mappingType, setMappingType] = useState('low_entropy');
  const microEntropyRef = useRef({ sum: 0, count: 0 });
  useEffect(() => {
    if (phase === 'running') {
      const pick = (crypto.getRandomValues(new Uint8Array(1))[0] & 1) ? 'low_entropy' : 'high_entropy';
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

    const kind = schedule[blockIdx];
    const isLastRetro = kind === 'retro' && C.RETRO_USE_TAPE_B_LAST && blockIdx === lastRetroIdx;
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
        console.log(`Entropy: Added ${bitsRef.current.length} subject bits (accumulator: ${beforeLength} → ${entropyAccumRef.current.subj.length})`);
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
      tape_meta: kind === 'retro'
        ? (isLastRetro
          ? { H_tape: tapeB?.H_tape, H_commit: tapeB?.H_commit, tapeId: tapeB?.tapeId }
          : { H_tape: tapeA?.H_tape, H_commit: tapeA?.H_commit, tapeId: tapeA?.tapeId })
        : null,
      coherence: { cumRange: cohRange, hurst },
      resonance: { ac1 },
      ghost_metrics: { coherence: { cumRange: gCohRange, hurst: gHurst }, resonance: { ac1: gAc1 } },
      replay: kind === 'retro' ? { passIndex: retroPassRef.current, tape: isLastRetro ? 'B' : 'A' } : null,
      mapping_type: mappingType,
      micro_entropy: microEntropyRef.current.count ? (microEntropyRef.current.sum / microEntropyRef.current.count) : null,
      entropy: {
        window_size: ENTROPY_WINDOW_SIZE,
        new_windows_subj: newSubjWindows,
        new_windows_ghost: newGhostWindows,
        cumulative: {
          subj_count: subjCount,
          ghost_count: ghostCount,
        },
      },
      redundancy: kind === 'retro' ? (redundancyRef.current || null) : null,
      invalidated: minuteInvalidRef.current || false,
      invalid_reason: minuteInvalidRef.current ? invalidReasonRef.current : null,
      live_buffer: kind === 'live' ? {
        pauseCount: pauseCountRef.current,
        totalPausedMs: Math.round(totalPausedMsRef.current),
        longestSinglePauseMs: Math.round(longestPauseMsRef.current),
      } : null,
    }, { merge: true });
  }, [
    runRef, schedule, blockIdx, lastRetroIdx, tapeA, tapeB, target, primeCond, mappingType
  ]);

  const endMinute = useCallback(async () => {
    if (C.USE_LIVE_STREAM && schedule[blockIdx] === 'live') {
      liveDisconnect();
    }
    setIsRunning(false);
    await persistMinute();
    if (minuteInvalidRef.current) { setPhase('rest'); return; }
    // Always go to rest phase first, even for the final block
    setPhase('rest');
  }, [blockIdx, liveDisconnect, schedule, persistMinute]);
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
      if (schedule[next] === 'live' && !nextLiveBufRef.current) {
        prefetchLivePairs().catch(() => { /* ignore */ });
      }
    }
  }, [phase, blockIdx, schedule, prefetchLivePairs]);
  useEffect(() => {
    endMinuteRef.current = endMinute;
  }, [endMinute]);

  // minute tick loop
  useEffect(() => {
    if (!isRunning) return;
    const TICK = Math.round(1000 / C.VISUAL_HZ);
    const MAX_TRIALS = trialsPerMinute; // Should be exactly 150 trials
    const isRetro = schedule[blockIdx] === 'retro';
    const isLastRetro = isRetro && C.RETRO_USE_TAPE_B_LAST && blockIdx === lastRetroIdx;

    if (!isRetro && !C.USE_LIVE_STREAM) {
      const ready =
        Array.isArray(liveBufRef.current?.subj) && liveBufRef.current.subj.length >= trialsPerMinute &&
        Array.isArray(liveBufRef.current?.ghost) && liveBufRef.current.ghost.length >= trialsPerMinute;
      if (!ready) { endMinuteRef.current?.(); return; }
    }

    const retroSrc = isRetro ? (isLastRetro ? tapeB?.bits : tapeA?.bits) || [] : [];
    const ghostRetro = isRetro ? tapeGhost?.bits || [] : [];

    let i = 0;
    const start = Date.now();
    if (tickTimerRef.current) { clearInterval(tickTimerRef.current); tickTimerRef.current = null; }

    tickTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      const hitCap = elapsed >= (C.BLOCK_MS + 5000);
      if (i >= MAX_TRIALS || hitCap) {
        clearInterval(tickTimerRef.current);
        tickTimerRef.current = null;
        endMinuteRef.current?.();
        return;
      }

      let bit, ghost;
      if (isRetro) {
        bit = retroSrc[i % (retroSrc.length || 1)] || 0;
        ghost = ghostRetro[i % (ghostRetro.length || 1)] || 0;
      } else if (C.USE_LIVE_STREAM) {
        const now = performance.now();
        if (isBuffering) { maybeResume(now); i += 1; return; }
        else { maybePause(now); if (isBuffering) { i += 1; return; } }
        const sBit = livePopBit(); const gBit = livePopBit();
        if (sBit === null || gBit === null) { maybePause(now); i += 1; return; }
        bit = sBit === '1' ? 1 : 0; ghost = gBit === '1' ? 1 : 0;
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

      bitsRef.current.push(bit);
      ghostBitsRef.current.push(ghost);
      const align = bit === targetBit ? 1 : 0;
      const alignGhost = ghost === targetBit ? 1 : 0;
      alignedRef.current.push(align);
      hitsRef.current += align;
      ghostHitsRef.current += alignGhost;

      // Trigger re-render for UI updates
      setRenderTrigger(prev => prev + 1);

      i += 1;
    }, TICK);

    return () => { if (tickTimerRef.current) { clearInterval(tickTimerRef.current); tickTimerRef.current = null; } };
  }, [
    isRunning, blockIdx, schedule, trialsPerMinute, targetBit,
    tapeA, tapeB, tapeGhost, lastRetroIdx,
    isBuffering, livePopBit, maybePause, maybeResume, shouldInvalidate,
  ]);


  // Prepare next block (warmup / load buffers)
  const ensureNextBlockReady = useCallback(async (nextIdx) => {
    const kindNext = schedule[nextIdx];

    if (kindNext === 'live') {
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
    }

    // === RETRO checks === (unchanged; only runs after you click "Create session tapes")
    const isLastRetro = C.RETRO_USE_TAPE_B_LAST && nextIdx === lastRetroIdx;
    const srcBits = isLastRetro ? tapeB?.bits : tapeA?.bits;
    const ghostBits = tapeGhost?.bits;

    if (!srcBits || !srcBits.length || !ghostBits || !ghostBits.length) {
      throw new Error('tape-not-ready: missing A/B or GHOST bits');
    }
    // Auto-create a silent redundancy audit record (no participant UI)
    if (!redundancyRef.current) {
      const commitPayload = {
        H_tape: isLastRetro ? tapeB?.H_tape : tapeA?.H_tape,
        H_commit: isLastRetro ? tapeB?.H_commit : tapeA?.H_commit,
        lenBits: C.RETRO_TAPE_BITS,
        createdISO: isLastRetro ? tapeB?.createdISO : tapeA?.createdISO,
      };
      redundancyRef.current = {
        tier: redundancyPlan[retroOrdinalRef.current] || 'R0',
        method: 'auto_silent',
        at: new Date().toISOString(),
        commitPayload,
      };
    }

  }, [
    schedule,
    // streaming deps
    liveConnected, liveConnect, liveBufferedBits, resetLivePauseCounters,
    // prefetch model deps
    prefetchLivePairs,
    // retro deps
    tapeA, tapeB, tapeGhost, lastRetroIdx,
    redundancyPlan
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

    if (schedule[next] === 'retro') {
      retroOrdinalRef.current = Math.min(retroOrdinalRef.current + 1, redundancyPlan.length);
      retroPassRef.current += 1;
    }

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
      if (C.USE_LIVE_STREAM && schedule[blockIdx] === 'live') {
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
  }, [blockIdx, isRunning, liveDisconnect, schedule, persistMinute, runRef, target, primeCond, ensureRunDoc]);

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
            'You will focus on an assigned target symbol (red or green) while random symbols are generated.',
            'Your task is to maintain focused attention on your target throughout each trial block.',
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
    const canContinue = !!tapeA && tapesReady && !busyTape && !!runRef;
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
            {target === 'RED' ? '🟥 RED' : '🟩 GREEN'}
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

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            disabled={busyTape || tapesReady}
            onClick={prepareSessionArtifacts}
            style={{
              opacity: (busyTape || tapesReady) ? 0.6 : 1,
              cursor: (busyTape || tapesReady) ? 'not-allowed' : 'pointer',
            }}
          >
            {busyTape ? 'Creating tapes…' : (tapesReady ? 'Tapes ready ✓' : 'Create session tapes')}
          </button>
        </div>

        <div style={{ marginTop: 12 }}>
          <button
            className="primary-btn"
            disabled={!canContinue}
            onClick={async () => {
              if (!runRef) await ensureRunDoc();
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
            {canContinue ? 'Continue' : (busyTape ? 'Creating tapes…' : 'Continue (tapes required)')}
          </button>
        </div>

      </div>
    );
  }

  // PRIME
  // REST (manual Continue; participant score only; RedundancyGate for retro)
  if (phase === 'rest') {
    const next = redoCurrentMinuteRef.current ? blockIdx : (blockIdx + 1);
    const nextKind = schedule[next];
    const nextIsLastRetro = nextKind === 'retro' && C.RETRO_USE_TAPE_B_LAST && next === lastRetroIdx;

    const pctLast = lastBlock && lastBlock.n ? Math.round((100 * lastBlock.k) / lastBlock.n) : 0;
    const trialsPlanned = trialsPerBlock;

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
          last={lastBlock || { k: hitsRef.current, n: alignedRef.current.length, z: 0, pTwo: 1, kg: 0, ng: 0, zg: 0, pg: 1, kind: nextKind }}
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
    const isLive = schedule[blockIdx] === 'live';
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
                    (tape {C.RETRO_USE_TAPE_B_LAST && blockIdx === lastRetroIdx ? 'B' : 'A'})
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
            {' — '}Target: {target === 'RED' ? '🟥' : '🟩'}
          </div>

          {(() => {
            const n = alignedRef.current.length;
            const k = hitsRef.current;
            const minuteVal = n ? k / n : 0.5;
            const toward = targetBit === 1 ? 'RED' : 'GREEN';
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
                  Trial {n}/{trialsPlanned} · This minute: <strong>{Math.round(minuteVal * 100)}%</strong>
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
              if (runRef) await setDoc(runRef, { post_survey: answers }, { merge: true });
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
