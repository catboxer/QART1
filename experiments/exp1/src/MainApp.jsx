import React, { useState, useRef, useEffect, useMemo } from 'react';
import './App.css';

// Firebase singletons
import { db, auth, ensureSignedIn } from './firebase.js';
import {
  collection,
  addDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  increment,
} from 'firebase/firestore';

import {
  preQuestions,
  cueBlocks,
  midQuestions,
  postQuestions,
  buildIssueMailto,
} from './questions.js';

import confetti from 'canvas-confetti';
import { config } from './config.js';
import HighScoreEmailGate from "./HighScoreEmailGate";
import { binomPValueOneSidedAtOrAbove, formatP } from './stats/';
/* =========================
   Helpers / UI
   ========================= */


// Mini-match settings
const MATCH_SIZE = 5; // 5 trials per match
const calcTotalMatches = (trialsCount) =>
  Math.ceil(trialsCount / MATCH_SIZE);
const toSymIdx = (b) => ((b >>> 0) & 0xff) % 5; // 0..4

/* =========================
   Zener Icons (5 symbols)
   ========================= */

// geometry (viewBox 0..100)
const VISUAL_R = 46;
const LEFT = 50 - VISUAL_R;
const RIGHT = 50 + VISUAL_R;

// All components accept optional className, but also set their own base classes
export const SolidCircle = ({ className = '' }) => (
  <svg
    className={`zener-icon zener-circle ${className}`}
    viewBox="0 0 100 100"
    preserveAspectRatio="xMidYMid meet"
    aria-hidden="true"
  >
    <g className="glyph">
      <circle cx="50" cy="50" r={VISUAL_R} />
    </g>
  </svg>
);

export const SolidSquare = ({ className = '' }) => (
  <svg
    className={`zener-icon zener-square ${className}`}
    viewBox="0 0 100 100"
    preserveAspectRatio="xMidYMid meet"
    aria-hidden="true"
  >
    <g className="glyph">
      <rect
        x={LEFT}
        y={LEFT}
        width={VISUAL_R * 2}
        height={VISUAL_R * 2}
        rx="2"
        ry="2"
      />
    </g>
  </svg>
);

export const SolidPlus = ({ className = '' }) => {
  const reach = VISUAL_R - 3;
  return (
    <svg
      className={`zener-icon zener-plus ${className}`}
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <g className="glyph">
        <line x1="50" y1={50 - reach} x2="50" y2={50 + reach} />
        <line x1={50 - reach} y1="50" x2={50 + reach} y2="50" />
      </g>
    </svg>
  );
};

export const SolidWaves = ({ className = '' }) => {
  const rows = [-27, -9, 9, 27];
  const width = RIGHT - LEFT;
  const amp = width * 0.08;
  const q = width / 4;
  const dFor = (y) =>
    `M ${LEFT} ${50 + y}
     C ${LEFT + 0.5 * q} ${50 + y - amp},
       ${LEFT + 1.5 * q} ${50 + y + amp},
       ${LEFT + 2 * q} ${50 + y}
     S ${LEFT + 3.5 * q} ${50 + y + amp},
       ${RIGHT} ${50 + y}`;
  return (
    <svg
      className={`zener-icon zener-waves ${className}`}
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <g className="glyph">
        {rows.map((dy, i) => (
          <path key={i} d={dFor(dy)} />
        ))}
      </g>
    </svg>
  );
};

export const SolidStar = ({ className = '' }) => {
  const cx = 50,
    cy = 50;
  const outerR = VISUAL_R; // base size; CSS will nudge via scale
  const innerR = outerR * 0.382;
  const startDeg = -90;

  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = ((startDeg + i * 36) * Math.PI) / 180;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  const d =
    `M ${pts[0][0]} ${pts[0][1]} ` +
    pts
      .slice(1)
      .map(([x, y]) => `L ${x} ${y}`)
      .join(' ') +
    ' Z';

  return (
    <svg
      className={`zener-icon zener-star ${className}`}
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <g className="glyph">
        <path d={d} />
      </g>
    </svg>
  );
};

const ZENER = [
  { id: 'circle', element: <SolidCircle /> },
  { id: 'plus', element: <SolidPlus /> },
  { id: 'waves', element: <SolidWaves /> },
  { id: 'square', element: <SolidSquare /> },
  { id: 'star', element: <SolidStar /> },
];
// Chance model for 5 options
const K_OPTIONS = ZENER.length;
const P0 = 1 / K_OPTIONS;
// Punctuation timings (ms)
const FLASH_MS = 85; // how long the layout is visible per flash
const ISI_MS = 20;  // blank interval between flashes

function isAboveChanceMatch5(hitsInMatch) {
  return hitsInMatch >= 3;
}
// Unbiased int in [0, n) from a RNG that returns [0,1)
function randInt(n, rand01) {
  // rejection sampling to avoid modulo bias
  const max = Math.floor(4294967296 / n) * n; // largest multiple of n < 2^32
  let x;
  do {
    // pull 32 bits from the RNG (fast path for seeded; for crypto we replace below)
    x = Math.floor(rand01() * 4294967296) >>> 0;
  } while (x >= max);
  return x % n;
}

// Crypto-backed [0,1) RNG
function crypto01() {
  const u = new Uint32Array(1);
  crypto.getRandomValues(u);
  // Map to [0,1) with full 32-bit precision
  return u[0] / 4294967296;
}
/**
 * Secure, unbiased shuffle of the 5 symbols.
 * - If `seed` is provided (number), the order is deterministic.
 * - If omitted, uses crypto.getRandomValues for audit-friendly randomness.
 */
function shuffledFive(seed /* number? */) {
  const arr = [...ZENER]; // don't mutate original
  // Fisher–Yates
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1, crypto01);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr;
}

// Map Subject (raw_byte) + Demon (ghost_raw_byte) to indices in the displayed order
function assignZenerFromBytes(rawByte, ghostByte, displayIcons) {
  const toSymIdx = (b) => ((b >>> 0) & 0xff) % 5; // 0..4
  const subjectSym = ZENER[toSymIdx(rawByte)].id;
  const ghostSym = ZENER[toSymIdx(ghostByte)].id;

  const idxOf = (id) => displayIcons.findIndex((o) => o.id === id);
  const primaryIndex = idxOf(subjectSym);
  const ghostIndex = idxOf(ghostSym);

  return {
    primaryIndex, // 0..4 in display order
    ghostIndex, // 0..4
    primary_symbol_id: subjectSym,
    ghost_symbol_id: ghostSym,
    primary_raw: rawByte >>> 0,
    ghost_raw: ghostByte >>> 0,
  };
}

const getBlock = (id) => cueBlocks.find((b) => b.id === id);
// 50/50 coin flip using strong randomness

const isAnswered = (q, responses) => {
  const v = responses[q.id];
  if (q.type === 'number') {
    const n = Number(v);
    if (v === '' || v == null || Number.isNaN(n)) return false;
    if (q.min != null && n < q.min) return false;
    if (q.max != null && n > q.max) return false;
    return true;
  }
  return (
    v === false || v === true || v === 0 || (v !== '' && v != null)
  );
};

const fieldError = (q, responses) => {
  const v = responses[q.id];
  if (q.type === 'number') {
    const n = Number(v);
    if (v === '' || v == null || Number.isNaN(n)) return 'Required';
    if (q.min != null && n < q.min) return `Must be ≥ ${q.min}`;
    if (q.max != null && n > q.max) return `Must be ≤ ${q.max}`;
    return null;
  }
  return !isAnswered(q, responses) ? 'Required' : null;
};

/* ==== Round & p-value helpers (define once, above MainApp) ==== */
function countAboveChanceRoundWins(rows, matchSize = 5) {
  let wins = 0;
  const completed = Math.floor(rows.length / matchSize);
  for (let m = 0; m < completed; m++) {
    const slice = rows.slice(m * matchSize, (m + 1) * matchSize);
    const pts = slice.reduce(
      (a, r) =>
        a +
        (Number(r.subject_hit) === 1
          ? 1
          : Number(r.matched) === 1
            ? 1
            : 0),
      0
    );
    if (pts >= 3) wins++; // "round win" = 3+ hits in 5 trials
  }
  return { wins, totalRounds: completed };
}

/* ===== Commit–reveal helpers ===== */
async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
function bytesToHex(bytes) {
  return [...bytes]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
function concatBytes(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
function bytesToBase64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/* RNG clients */
async function getPrngPairOrThrow(retries = 2, backoffMs = 250) {
  const make = () =>
    fetch(
      `/.netlify/functions/random-org-proxy?n=2&nonce=${Date.now()}`,
      { cache: 'no-store' }
    );
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await make();
      if (!res.ok)
        throw new Error(
          'prng_http_' + res.status + '_' + (res.statusText || '')
        );
      const j = await res.json();
      const arr = Array.isArray(j.bytes) ? j.bytes : j.data;
      if (
        j?.success === true &&
        Array.isArray(arr) &&
        arr.length >= 2
      ) {
        const b0 = arr[0] >>> 0;
        const b1 = arr[1] >>> 0;
        return {
          bytes: [b0, b1],
          source: j.source || 'random_org',
          server_time: j.server_time ?? null,
        };
      }
      throw new Error('prng_shape_pair_required');
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) =>
        setTimeout(r, backoffMs * (attempt + 1))
      );
    }
  }
}
async function getQuantumPairOrThrow(retries = 2, backoffMs = 250) {
  const make = () =>
    fetch(
      `/.netlify/functions/qrng-race?pair=1&nonce=${Date.now()}`,
      { cache: 'no-store' }
    );
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await make();
      if (!res.ok)
        throw new Error(
          'qrng_http_' + res.status + '_' + (res.statusText || '')
        );
      const j = await res.json();
      if (
        j?.success === true &&
        Array.isArray(j.bytes) &&
        j.bytes.length >= 2
      ) {
        const b0 = j.bytes[0] >>> 0;
        const b1 = j.bytes[1] >>> 0;
        return {
          bytes: [b0, b1],
          source: j.source || 'qrng',
          server_time: j.server_time ?? null,
        };
      }
      throw new Error('qrng_shape_pair_required');
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) =>
        setTimeout(r, backoffMs * (attempt + 1))
      );
    }
  }
}

/* PII filter */
const filterOutPII = (q) => {
  const id = (q.id || '').toString().toLowerCase();
  const type = (q.type || '').toString().toLowerCase();
  return id !== 'name' && id !== 'email' && type !== 'email';
};

/* confetti with reduced-motion respect */
function fireConfettiSafely() {
  const prefersReduced = window.matchMedia?.(
    '(prefers-reduced-motion: reduce)'
  )?.matches;
  if (prefersReduced) return;
  confetti({ particleCount: 150, spread: 100, origin: { y: 0.6 } });
}
// Even bigger/longer finale for block-end significance (about 2.5s)
// ~1 second celebration used only on significant last rounds
// Very short "finale" (~0.5–0.7s total)
function fireConfettiFinale() {
  const prefersReduced = window.matchMedia?.(
    '(prefers-reduced-motion: reduce)'
  )?.matches;
  if (prefersReduced) return;

  const base = {
    spread: 120,
    startVelocity: 55,
    scalar: 1.2, // medium pieces
    origin: { y: 0.6 },
  };

  confetti({ ...base, particleCount: 220 });
  setTimeout(
    () =>
      confetti({
        ...base,
        particleCount: 160,
        spread: 140,
        startVelocity: 50,
      }),
    180
  );
  setTimeout(
    () =>
      confetti({
        ...base,
        particleCount: 120,
        spread: 160,
        startVelocity: 45,
      }),
    420
  );
}

// Simple envelope fold+seal loader (loops)
function EnvelopeLoader({ label }) {
  return (
    <figure
      className="envelope-loader"
      role="status"
      aria-live="polite"
    >
      <svg
        className="env"
        viewBox="0 0 64 48"
        aria-hidden="true"
        focusable="false"
      >
        {/* Paper */}
        <g className="paper">
          <rect
            x="14"
            y="6"
            width="36"
            height="24"
            rx="2"
            ry="2"
          ></rect>
          <line x1="18" y1="12" x2="46" y2="12"></line>
          <line x1="18" y1="16" x2="42" y2="16"></line>
          <line x1="18" y1="20" x2="40" y2="20"></line>
        </g>
        {/* Body */}
        <g className="body">
          <rect
            x="8"
            y="12"
            width="48"
            height="28"
            rx="3"
            ry="3"
          ></rect>
          <polyline points="8,20 32,36 56,20"></polyline>
        </g>
        {/* Flap */}
        <g className="flap">
          <polygon points="8,12 56,12 32,28"></polygon>
        </g>
        <circle className="seal" cx="32" cy="26" r="3"></circle>
      </svg>
      <figcaption className="envelope-label">{label}</figcaption>
    </figure>
  );
}

/* =========================
   Main Component
   ========================= */

function MainApp() {
  // Profile load
  const [profile, setProfile] = useState(undefined); // undefined=loading, null=first run
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const user = await ensureSignedIn();
        if (!user || cancelled) return;
        const ref = doc(db, 'participants', user.uid);
        try {
          const snap = await getDoc(ref);
          if (!cancelled)
            setProfile(snap.exists() ? snap.data() : null);
        } catch (err) {
          if (!cancelled) {
            console.warn('[profile] read failed, first-run:', err);
            setProfile(null);
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('[auth] ensureSignedIn failed:', err);
          setProfile(null);
        }
      }
    })();

    return () => { cancelled = true; };
  }, []);
  const hasDemographics = !!(profile && profile.demographics);

  // Stop long-press context menu on icon buttons (mobile)
  useEffect(() => {
    const root = document.getElementById('main');
    if (!root) return;
    const MATCH = '.icon-options .icon-button';
    const onContextMenu = (e) => {
      if (e.target.closest?.(MATCH)) e.preventDefault();
    };
    root.addEventListener('contextmenu', onContextMenu, {
      capture: true,
    });
    return () =>
      root.removeEventListener('contextmenu', onContextMenu, {
        capture: true,
      });
  }, []);

  // Session / version
  const [sessionId] = useState(() => {
    try {
      if (typeof window !== 'undefined' && window.crypto?.randomUUID)
        return window.crypto.randomUUID();
    } catch { }
    const t = Date.now().toString(36);
    const p =
      typeof performance !== 'undefined' && performance.now
        ? Math.floor(performance.now()).toString(36)
        : '';
    const r = Math.random().toString(36).slice(2);
    return `${t}-${p}-${r}`;
  });
  const appVersion = process.env.REACT_APP_COMMIT ?? 'dev';

  // URL flags
  const parseParams = () => {
    const search = window.location.search || '';
    const hash = window.location.hash || '';
    const qs = new URLSearchParams(
      search + (hash.includes('?') ? '&' + hash.split('?')[1] : '')
    );
    const arm = (qs.get('arm') || '').toLowerCase();
    const allowed = ['open', 'scramble', 'synced', 'blind'];
    return {
      timingArm: allowed.includes(arm) ? arm : 'open',
      robotMode: qs.get('robot') === '1',
    };
  };
  const { timingArm, robotMode } = useMemo(parseParams, []);

  // Consent gate
  const [step, setStep] = useState('consent');
  const [consent18, setConsent18] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [consentAgree, setConsentAgree] = useState(false);
  const CONSENT_VERSION = config.CONSENT_VERSION;
  const DEBRIEF_URL = config.DEBRIEF_URL;

  // Experiment state
  const [preResponses, setPreResponses] = useState({});
  const [midResponses, setMidResponses] = useState({});
  const [postResponses, setPostResponses] = useState({});
  const [trialResults, setTrialResults] = useState([]);
  // Gamification: per-block match tallies + between-match banner
  // Redundancy manipulation
  const [redundancyMode, setRedundancyMode] = useState('single'); // 'single' | 'redundant'
  // Motion-safe mode: no flashing (R=1, no ISI). Defaults to OS 'prefers-reduced-motion'.
  const [motionSafe, setMotionSafe] = useState(() =>
    window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false
  );

  // (Optional) react to OS setting changes live
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq?.addEventListener) return;
    const onChange = () => setMotionSafe(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const [redundancyCount, setRedundancyCount] = useState(1);      // 1 for Single, R (e.g., 2) for Redundant
  const [redundancyOrders, setRedundancyOrders] = useState([]);   // array of option-id arrays (for logging)
  const [redundancyTimestamps, setRedundancyTimestamps] = useState([]); // ms since trial start per flash

  const [matchSummary, setMatchSummary] = useState(null); // {blockId, matchNumber, subjectPts, demonPts, winner}
  const [currentBlockId, setCurrentBlockId] = useState('full_stack'); // explicit id to avoid races
  const [currentTrial, setCurrentTrial] = useState(0);
  const [lastResult, setLastResult] = useState(null);
  const [hasGuessedThisTrial, setHasGuessedThisTrial] =
    useState(false);

  const roundsTally = useMemo(() => {
    const rows = trialResults.filter(
      (t) => t.block_type === currentBlockId &&
        t.target_index_0based !== null && t.target_index_0based !== undefined &&
        t.selected_index !== null && t.selected_index !== undefined &&
        t.ghost_index_0based !== null && t.ghost_index_0based !== undefined
    );
    return countAboveChanceRoundWins(rows, MATCH_SIZE);
  }, [trialResults, currentBlockId]);

  const [fullStackStats, setFullStackStats] = useState(null);
  const [spoonLoveStats, setSpoonLoveStats] = useState(null);

  // Five-choice task state
  const [choiceOptions, setChoiceOptions] = useState([]); // 5 icons
  const [correctIndex, setCorrectIndex] = useState(null); // 0..4
  const [ghostIndex, setGhostIndex] = useState(null); // 0..4
  const [rngMeta, setRngMeta] = useState(null);
  const [trialReady, setTrialReady] = useState(false);
  const [sealedEnvelopeId, setSealedEnvelopeId] = useState(null);
  const hasGuessedRef = useRef(false);
  const starTimerRef = useRef(null);
  const isSavingRef = useRef(false);
  const [trialStartTime, setTrialStartTime] = useState(null);
  const layoutRef = useRef(null);   // the 5 icons, fixed for the current trial
  const prepRunIdRef = useRef(0);   // cancels overlapping prepareTrial calls

  const [trialBlockingError, setTrialBlockingError] = useState(null);

  // Prefetch/caching for sealed envelopes
  const [assignmentCache, setAssignmentCache] = useState({
    full_stack: null, // { 1: {assigned, rngMeta}, ... }
    spoon_love: null,
    client_local: null,
  });
  const [prefetchStatus, setPrefetchStatus] = useState({
    full_stack: {
      done: false,
      count: 0,
      total: Number(config.trialsPerBlock.full_stack),
    },
    spoon_love: {
      done: false,
      count: 0,
      total: Number(config.trialsPerBlock.spoon_love),
    },
    client_local: {
      done: false,
      count: 0,
      total: Number(config.trialsPerBlock.client_local || 20),
    },
  });
  const [isPrefetching, setIsPrefetching] = useState({
    full_stack: false,
    spoon_love: false,
    client_local: false,
  });

  // One pre-drawn tape per server block (each trial uses 2 bytes)
  const tapesRef = useRef({}); // { [blockId]: { pairs, saltHex, hashHex, createdISO, rng_source } }
  const spoonCommitTokenRef = useRef(null); // holds commit_token for 'spoon_love' reveal

  // Blocks / trials config
  const fullStackBlock = cueBlocks.find((b) => b.id === 'full_stack');
  const spoonLoveBlock = cueBlocks.find((b) => b.id === 'spoon_love');
  const clientLocalBlock = cueBlocks.find(
    (b) => b.id === 'client_local'
  );
  const blockOrder = [
    { ...fullStackBlock, id: 'full_stack', showFeedback: false },
    { ...spoonLoveBlock, id: 'spoon_love', showFeedback: false },
    { ...clientLocalBlock, id: 'client_local', showFeedback: false },
  ];

  const trialsPerBlock = config.trialsPerBlock;
  const currentBlockObj = getBlock(currentBlockId);
  const totalTrialsFor = (blockId) =>
    Number(config.trialsPerBlock[blockId]);

  const totalTrialsPerBlock = totalTrialsFor(currentBlockId);

  // Priming/boost visuals (baseline block only)
  const [isHighPrime] = useState(() => false);

  // Feedback switches
  const FB = {
    full_stack: { STAR: true, ALIGNED_TEXT: false, SCORE: false },
    spoon_love: { STAR: true, ALIGNED_TEXT: false, SCORE: false },
    client_local: { STAR: true, ALIGNED_TEXT: false, SCORE: false },
  };
  // Show/Hide "ghost" from participant UI (still logged under the hood)

  // Early exit modal
  const [showExitModal, setShowExitModal] = useState(false);
  const [exitReason, setExitReason] = useState('time');
  const [exitNotes, setExitNotes] = useState('');

  // Timer cleanup (capture id once)
  useEffect(() => {
    const id = starTimerRef.current;
    return () => {
      if (id) clearTimeout(id);
    };
  }, []);

  // Forms helpers
  const handleChange = (id, value, bucket = 'pre') => {
    const setMap = {
      pre: setPreResponses,
      mid: setMidResponses,
      post: setPostResponses,
    };
    const setter = setMap[bucket] || setPreResponses;
    setter((prev) => ({ ...prev, [id]: value }));
  };

  const filteredPreQuestions = useMemo(
    () => (hasDemographics ? [] : preQuestions.filter(filterOutPII)),
    [hasDemographics]
  );
  const filteredPostQuestions = useMemo(
    () => postQuestions.filter(filterOutPII),
    []
  );

  const renderInput = (q, bucket = 'pre', invalid = false) => {
    const onChange = (e) =>
      handleChange(q.id, e.target.value, bucket);
    switch (q.type) {
      case 'number':
        return (
          <input
            id={q.id}
            type="number"
            min={q.min}
            max={q.max}
            inputMode="numeric"
            onChange={onChange}
            className="number-input"
            aria-invalid={invalid || undefined}
          />
        );
      case 'slider':
        return (
          <div className="slider-container">
            <span id={`label-${q.id}-low`} className="slider-label">
              {q.leftLabel || 'Low'}
            </span>
            <input
              id={q.id}
              type="range"
              min={q.min}
              max={q.max}
              onChange={onChange}
              className="slider"
              aria-labelledby={`label-${q.id}-low label-${q.id}-high`}
              aria-invalid={invalid || undefined}
            />
            <span id={`label-${q.id}-high`} className="slider-label">
              {q.rightLabel || 'High'}
            </span>
          </div>
        );
      case 'textarea':
        return (
          <textarea
            id={q.id}
            onChange={onChange}
            className="textarea-input"
            aria-invalid={invalid || undefined}
          />
        );
      case 'select':
        return (
          <select
            id={q.id}
            onChange={onChange}
            className="select-input"
            aria-invalid={invalid || undefined}
          >
            <option value="">Select</option>
            {(q.options || []).map((opt, idx) => (
              <option key={idx} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        );
      case 'checkbox':
        return (
          <label
            style={{ display: 'flex', gap: 8, alignItems: 'center' }}
          >
            <input
              id={q.id}
              type="checkbox"
              onChange={(e) =>
                handleChange(q.id, e.target.checked, bucket)
              }
              aria-invalid={invalid || undefined}
            />
            {q.label || q.question}
          </label>
        );
      default:
        return (
          <input
            id={q.id}
            type="text"
            onChange={onChange}
            className="text-input"
            aria-invalid={invalid || undefined}
          />
        );
    }
  };

  // Save profile (first run only / idempotent)
  async function saveProfileIfNeeded(pre) {
    await ensureSignedIn();
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const ref = doc(db, 'participants', uid);
    const snap = await getDoc(ref);
    const demographics = { ...pre };
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
  }
  async function completeBlockAfterLastRound(blockId) {
    // Recompute block totals from the log you already have
    const trialsThisBlock = trialResults.filter(
      (t) => t.block_type === blockId &&
        t.target_index_0based !== null && t.target_index_0based !== undefined &&
        t.selected_index !== null && t.selected_index !== undefined &&
        t.ghost_index_0based !== null && t.ghost_index_0based !== undefined
    );
    const N = trialsThisBlock.length;
    const hits = trialsThisBlock.reduce((a, t) => {
      // subject_hit is set; fall back to matched for safety
      const v =
        typeof t.subject_hit === 'number'
          ? t.subject_hit
          : typeof t.matched === 'number'
            ? t.matched
            : 0;
      return a + (v || 0);
    }, 0);
    const pct = N > 0 ? (hits / N) * 100 : 0;

    // One-sided exact binomial vs p0 = 0.2 (5 options)
    const pValue = binomPValueOneSidedAtOrAbove(hits, N, P0);
    const significant = pValue <= 0.05;

    // Reveal tape for server blocks (same as your end-of-block code)
    try {
      const tape = tapesRef.current[blockId];
      if (tape && exp1DocId) {
        const revealRef = doc(
          db,
          'experiment1_responses',
          exp1DocId,
          'reveal',
          `reveal_${blockId}`
        );
        await setDoc(
          revealRef,
          {
            block_type: blockId,
            commit_algo: 'SHA-256',
            commit_hash_hex: tape.hashHex,
            salt_hex: tape.saltHex,
            tape_pairs_b64: bytesToBase64(tape.pairs),
            bytes_per_trial: 2,
            tape_length_trials: tape.pairs.length / 2,
            revealed_at: serverTimestamp(),
            created_iso: tape.createdISO,
            rng_source: tape.rng_source,
          },
          { merge: false }
        );
      }
    } catch (e) {
      console.warn('Reveal write failed (continuing):', e);
    }

    // Store stats + navigate, exactly like your original end-of-block
    if (blockId === 'full_stack') {
      const basePercent = pct;
      const displayed = basePercent;
      setFullStackStats({
        userPercent: displayed.toFixed(1),
        basePercent: basePercent.toFixed(1),
        confettiMetric: displayed.toFixed(1),
        pValue: Number(pValue.toFixed(4)),
        significant,
      });
      if (significant) fireConfettiFinale(); // BIG confetti only here
      setStep('breathe-spoon');
    } else if (blockId === 'spoon_love') {
      setSpoonLoveStats({
        userPercent: pct.toFixed(1),
        pValue: Number(pValue.toFixed(6)),
        significant,
      });
      if (significant) fireConfettiFinale(); // BIG confetti only here


      setStep('breathe-client');
    } else {
      // client_local final block
      setSpoonLoveStats({
        userPercent: pct.toFixed(1),
        pValue: Number(pValue.toFixed(6)),
        significant,
      });
      if (significant) fireConfettiFinale(); // BIG confetti only here
      setStep('final-results');
    }
  }

  // Ensure we have ONE parent run document for all blocks
  const [exp1DocId, setExp1DocId] = useState(null);
  const ensureDocPromiseRef = useRef(null);
  const cachedDocIdRef = useRef(null); // Session-level cache that doesn't rely on React state

  async function ensureRunDoc() {
    console.log('🔥 ensureRunDoc called, exp1DocId:', exp1DocId, 'cachedDocId:', cachedDocIdRef.current, 'hasPromise:', !!ensureDocPromiseRef.current);

    // Check both React state and ref cache
    const existingId = exp1DocId || cachedDocIdRef.current;
    if (existingId) {
      console.log('✅ Returning existing docId:', existingId);
      return existingId;
    }

    // If we already have a promise in flight, await it
    if (ensureDocPromiseRef.current) {
      console.log('⏳ Already creating doc, waiting for existing promise...');
      return await ensureDocPromiseRef.current;
    }

    console.log('🏗️ Starting doc creation - creating new promise');

    // Create and store the promise immediately (synchronously)
    ensureDocPromiseRef.current = (async () => {
      await ensureSignedIn();
      const participant_id = auth.currentUser?.uid ?? null;

      // Create parent doc
      console.log('📝 Creating Firebase doc with session_id:', sessionId);
      const mainRef = await addDoc(collection(db, 'experiment1_responses'), {
        participant_id,
        session_id: sessionId,
        app_version: appVersion,
        created_at: serverTimestamp(),
        timestamp: serverTimestamp(),
      });
      const parentId = mainRef.id;
      console.log('✨ Created Firebase doc with ID:', parentId);

      // Decide once per session: which half first?
      const redundancy_order = Math.random() < 0.5 ? 'single_then_redundant' : 'redundant_then_single';
      await setDoc(doc(db, 'experiment1_responses', parentId), {
        participant_id,
        redundancy_order,
      }, { merge: true });

      console.log('🎯 Setting exp1DocId to:', parentId);
      setExp1DocId(parentId);
      cachedDocIdRef.current = parentId; // Cache in ref immediately
      console.log('✅ ensureRunDoc complete, returning:', parentId);
      return parentId;
    })();

    // Await the promise and clean up
    try {
      const result = await ensureDocPromiseRef.current;
      ensureDocPromiseRef.current = null;
      return result;
    } catch (error) {
      ensureDocPromiseRef.current = null;
      throw error;
    }
  }


  // Pre-generate & store sealed envelopes for a whole block, plus local cache
  const prefetchBlock = async (blockId) => {
    if (isPrefetching?.[blockId] || prefetchStatus?.[blockId]?.done)
      return;

    const totalWanted = Number(config.trialsPerBlock[blockId]);

    try {
      setIsPrefetching((p) => ({ ...p, [blockId]: true }));
      // keep the real total visible; don't flash 0
      setPrefetchStatus((s) => ({
        ...s,
        [blockId]: { total: totalWanted, count: 0, done: false },
      }));

      /* ===============================
       CLIENT-LOCAL: pre-draw on client
       =============================== */
      if (blockId === 'client_local') {
        const total = totalWanted;

        // Make 2 bytes per trial locally
        const bytes = new Uint8Array(total * 2);
        crypto.getRandomValues(bytes);
        const envs = Array.from({ length: total }, (_, i) => ({
          trial_index: i + 1, // 1-based
          raw_byte: bytes[i * 2] >>> 0,
          ghost_raw_byte: bytes[i * 2 + 1] >>> 0,
        }));

        // Merge into cache deterministically (fill holes only)
        const prevBlock = assignmentCache?.[blockId] || {};
        const nextBlock = { ...prevBlock };
        for (const e of envs) {
          const i = e.trial_index >>> 0;
          if (nextBlock[i]) continue; // only fill holes
          nextBlock[i] = {
            assigned: null,
            raw_byte: e.raw_byte,
            ghost_raw_byte: e.ghost_raw_byte,
            rngMeta: {
              source: 'client_local_predraw',
              server_time: Date.now(),
              batch_id: null,
              qrng_code: null,
            },
          };
        }
        const nextAll = { ...assignmentCache, [blockId]: nextBlock };
        setAssignmentCache(nextAll);

        // Build a commit-reveal tape (optional but nice for parity)
        try {
          const pairs = new Uint8Array(total * 2);
          for (const e of envs) {
            const i0 = (e.trial_index - 1) * 2;
            pairs[i0] = e.raw_byte & 0xff;
            pairs[i0 + 1] = e.ghost_raw_byte & 0xff;
          }
          const salt = new Uint8Array(16);
          crypto.getRandomValues(salt);
          const hashHex = await sha256Hex(concatBytes(salt, pairs));
          const saltHex = bytesToHex(salt);
          tapesRef.current[blockId] = {
            pairs,
            saltHex,
            hashHex,
            createdISO: new Date().toISOString(),
            rng_source: 'client_local_predraw',
          };
          try {
            const runId = await ensureRunDoc();
            await setDoc(
              doc(
                db,
                'experiment1_responses',
                runId,
                'commits',
                'client_local_predraw'
              ),
              {
                session_id: sessionId,
                block: 'client_local',
                commit_hash: hashHex, // hash only (no salt/pairs yet)
                created_at: serverTimestamp(),
              },
              { merge: true }
            );
          } catch (e) {
            console.warn(
              'client_local commit save failed (continuing):',
              e
            );
          }
        } catch (e) {
          console.warn(
            'client_local tape build failed (continuing):',
            e
          );
        }

        const countNow = Object.keys(nextBlock).length;
        setPrefetchStatus((s) => ({
          ...s,
          [blockId]: {
            total,
            count: countNow,
            done: countNow === total,
          },
        }));
        return; // ✅ done with client_local
      }

      /* ===============================
       FULL_STACK / SPOON_LOVE: server batch
       =============================== */
      const res = await fetch('/.netlify/functions/envelopes-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          block: blockId,
          allocate_all: true,
          domain_separation: true,
          total: totalWanted, // ask for exactly N
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(
          `Batch fetch failed (${res.status}): ${text}`
        );
      }
      const payload = await res.json();

      const envs = Array.isArray(payload.envelopes)
        ? payload.envelopes
        : [];
      const total = totalWanted;
      // console.log(
      //   `[${blockId}] batch size:`,
      //   envs.length,
      //   envs.slice(0, 3)
      // );

      // Merge into cache deterministically (fill holes only)
      const prevBlock = assignmentCache?.[blockId] || {};
      const nextBlock = { ...prevBlock };
      for (const e of envs) {
        const i = e.trial_index >>> 0;
        if (nextBlock[i]) continue;
        nextBlock[i] = {
          assigned: null,
          raw_byte: e.raw_byte,
          ghost_raw_byte: e.ghost_raw_byte,
          rngMeta: {
            source:
              payload.rng_source ||
              (blockId === 'full_stack' ? 'random_org' : 'qrng_api'),
            server_time: payload.server_time || Date.now(),
            batch_id: payload.batch_id || null,
            qrng_code: e.qrng_code ?? null,
          },
        };
      }
      const nextAll = { ...assignmentCache, [blockId]: nextBlock };
      setAssignmentCache(nextAll);

      // Build commit-reveal tape from server batch
      try {
        const ordered = [...envs].sort(
          (a, b) => a.trial_index - b.trial_index
        );
        const pairs = new Uint8Array(total * 2);
        for (const e of ordered) {
          const i0 = (e.trial_index - 1) * 2;
          pairs[i0] = (e.raw_byte >>> 0) & 0xff;
          pairs[i0 + 1] = (e.ghost_raw_byte >>> 0) & 0xff;
        }
        const salt = new Uint8Array(16);
        crypto.getRandomValues(salt);
        const hashHex = await sha256Hex(concatBytes(salt, pairs));
        const saltHex = bytesToHex(salt);
        tapesRef.current[blockId] = {
          pairs,
          saltHex,
          hashHex,
          createdISO: new Date().toISOString(),
          rng_source:
            payload.rng_source ||
            (blockId === 'full_stack' ? 'random_org' : 'qrng_api'),
        };

        // Save commit hash to database for auditing
        try {
          const runId = await ensureRunDoc();
          await setDoc(
            doc(
              db,
              'experiment1_responses',
              runId,
              'commits',
              blockId // 'full_stack' or 'spoon_love'
            ),
            {
              session_id: sessionId,
              block: blockId,
              commit_hash: hashHex, // hash only (no salt/pairs yet)
              rng_source: payload.rng_source ||
                (blockId === 'full_stack' ? 'random_org' : 'qrng_api'),
              created_at: serverTimestamp(),
            },
            { merge: true }
          );
        } catch (e) {
          console.warn(
            `${blockId} commit save failed (continuing):`,
            e
          );
        }
      } catch (e) {
        console.warn(
          'Failed to build commit-reveal tape (continuing):',
          e
        );
      }

      const countNow = Object.keys(nextBlock).length;
      setPrefetchStatus((s) => ({
        ...s,
        [blockId]: {
          total,
          count: countNow,
          done: countNow === total,
        },
      }));
    } catch (err) {
      console.error(err);
      window.alert(
        'Failed to draw sealed envelopes. Please try again.\n' +
        (err?.message || err)
      );
      setPrefetchStatus((s) => ({
        ...s,
        [blockId]: { total: totalWanted, count: 0, done: false },
      }));
    } finally {
      setIsPrefetching((p) => ({ ...p, [blockId]: false }));
    }
  };

  /* =========================
   Trial lifecycle
   ========================= */

  const startTrials = async (index = 0) => {
    const blockId = blockOrder[index].id;
    setCurrentBlockId(blockId);

    // Reset per-run/block state
    if (index === 0) setTrialResults([]); // clear at beginning of FIRST block
    setCurrentTrial(0);
    setLastResult(null);

    // NEW: reset the gamified match counters/banner
    setMatchSummary(null);

    const parentId = await ensureRunDoc();

    setStep('trials');
    await prepareTrial(0, parentId, blockId);
  };
  // Decide Single vs Redundant for this trial, by block, with a 50/50 split of trials in the block.
  // We also keep the split on round boundaries (multiples of MATCH_SIZE).
  function redundancyConditionFor(blockId, trialIndex0, totalTrialsThisBlock, redundancy_order) {
    const trialsPerHalf = Math.floor(totalTrialsThisBlock / 2);
    // align halves to round boundaries:
    const halfAligned = Math.floor(trialsPerHalf / MATCH_SIZE) * MATCH_SIZE || trialsPerHalf;

    const inFirstHalf = trialIndex0 < halfAligned;
    const first = redundancy_order === 'single_then_redundant' ? 'single' : 'redundant';
    const second = first === 'single' ? 'redundant' : 'single';
    const condition = inFirstHalf ? first : second;

    // If total trials isn't an even multiple of MATCH_SIZE, the remainder goes into the second half.
    return { condition, halfAligned };
  }

  async function handleGuess(selectedIndex) {
    // allow client_local without a sealed envelope; others must have one

    if (!trialReady || !sealedEnvelopeId || hasGuessedRef.current)
      return;
    hasGuessedRef.current = true;
    setHasGuessedThisTrial(true); // NEW: we can now show feedback

    if (choiceOptions.length < 1) return;

    const blockId = currentBlockId;
    const totalThisBlock = totalTrialsFor(blockId);
    const press_start_ts = new Date().toISOString();

    // Calculate response time from trial start to button press
    const responseTimeMs = trialStartTime ? Math.round(performance.now() - trialStartTime) : null;

    // We'll compute everything into these local vars for immediate scoring/logging
    let resolvedCorrectIndex = null;
    let resolvedGhostIndex = null;
    let resolvedMeta = null; // carries rng info (bytes/symbols), plus remap data if any

    // ===== Block 3: client_local — score pre-drawn assignment (no new randomness) =====
    if (blockId === 'client_local') {
      resolvedCorrectIndex = rngMeta?.calculated_primary_index ?? correctIndex;
      resolvedGhostIndex = rngMeta?.calculated_ghost_index ?? ghostIndex;
      resolvedMeta = rngMeta || {
        source: 'client_local_predraw',
        k_options: 5,
      };
    }
    // ===== Block 1 (full_stack) OR Block 2 (spoon_love) — use server-backed RNG =====
    else {
      resolvedCorrectIndex = rngMeta?.calculated_primary_index ?? correctIndex;
      resolvedGhostIndex = rngMeta?.calculated_ghost_index ?? ghostIndex;
      resolvedMeta = rngMeta || null;
    }

    // Safety: if something glitched, allow another press
    if (resolvedCorrectIndex == null || resolvedGhostIndex == null) {
      hasGuessedRef.current = false;
      console.warn('Resolved indices not ready; skipping this press');
      return;
    }

    // Score this press
    const matched = selectedIndex === resolvedCorrectIndex ? 1 : 0;
    const subject_hit = matched;

    // Set result for feedback display
    setLastResult({
      matched: matched === 1,
      selectedIndex,
      correctIndex: resolvedCorrectIndex,
    });
    // correct: did the ghost pick the actual target?
    const demon_hit =
      resolvedGhostIndex === resolvedCorrectIndex ? 1 : 0;
    console.log('HIT CALCULATION:', {
      selectedIndex,
      resolvedGhostIndex,
      resolvedCorrectIndex,
      subject_hit,
      demon_hit,
      subjectMatch: selectedIndex === resolvedCorrectIndex,
      ghostMatch: resolvedGhostIndex === resolvedCorrectIndex
  });
    const selectedLabel =
      choiceOptions[selectedIndex]?.id ?? String(selectedIndex);

    const optionsIds = choiceOptions.map((o) => o.id);
    const commitHash = tapesRef.current[blockId]?.hashHex ?? null;
    const logRow = {
      // session/meta
      session_id: sessionId,
      app_version: appVersion,
      condition: isHighPrime ? 'primed' : 'control',
      block_type: blockId,
      agent: robotMode ? 'robot' : 'human',
      k_options: 5,
      timing_arm: timingArm,

      // trial identity
      trial_index: currentTrial + 1,
      sealed_envelope_id: sealedEnvelopeId ?? null,
      commit_hash_hex: commitHash,
      // timing
      press_time: press_start_ts,
      press_start_ts,
      press_release_ts: new Date().toISOString(),
      hold_duration_ms: null,
      response_time_ms: responseTimeMs,

      // scoring
      subject_hit,
      ghost_hit: demon_hit,
      matched,

      // target/ghost (resolved indices for this press)
      target_index_0based: resolvedCorrectIndex,
      ghost_index_0based: resolvedGhostIndex,
      target_symbol_id:
        resolvedMeta?.primary_symbol_id ??
        rngMeta?.primary_symbol_id ??
        null,
      ghost_symbol_id:
        resolvedMeta?.ghost_symbol_id ??
        rngMeta?.ghost_symbol_id ??
        null,

      // selection + options (display order)
      options: optionsIds,
      selected_index: selectedIndex,
      selected_id: selectedLabel,
      // --- redundancy manipulation (new) ---
      redundancy_mode: redundancyMode,
      redundancy_count: redundancyCount,
      redundancy_orders: JSON.stringify(redundancyOrders),
      redundancy_timestamps_ms: redundancyTimestamps,
      punctuation: { flash_ms: FLASH_MS, isi_ms: ISI_MS },
      // RNG provenance
      rng_source:
        resolvedMeta?.source ||
        rngMeta?.source ||
        (blockId === 'client_local' ? 'client_local' : null),
      raw_byte: resolvedMeta?.raw_byte ?? rngMeta?.raw_byte ?? null,
      ghost_raw_byte:
        resolvedMeta?.ghost_raw_byte ??
        rngMeta?.ghost_raw_byte ??
        null,


      // audit marker for your proof context shape
      proof_ctx_version: 1,
    };
    // Debug logging removed to prevent data leaks during experiments

    // Tag this row with match metadata before saving
    const countThisBlockSoFar =
      trialResults.filter((t) => t.block_type === blockId &&
        t.target_index_0based !== null && t.target_index_0based !== undefined &&
        t.selected_index !== null && t.selected_index !== undefined &&
        t.ghost_index_0based !== null && t.ghost_index_0based !== undefined).length + 1; // including this one
    const matchIndex0 = Math.floor(
      (countThisBlockSoFar - 1) / MATCH_SIZE
    ); // 0-based
    const trialInMatch = ((countThisBlockSoFar - 1) % MATCH_SIZE) + 1; // 1..5

    const enrichedRow = {
      ...logRow,
      match_index_0based: matchIndex0,
      trial_in_match: trialInMatch,
    };

    const updatedTrials = [...trialResults, enrichedRow];
    setTrialResults(updatedTrials);

    // Calculate and log running percentages for this block
    const allRows = updatedTrials.filter(t => t.block_type === blockId);
    const validRows = allRows.filter(t =>
      t.target_index_0based !== null && t.target_index_0based !== undefined &&
      t.selected_index !== null && t.selected_index !== undefined &&
      t.ghost_index_0based !== null && t.ghost_index_0based !== undefined
    );
    // Calculate percentages before and after filtering
    if (allRows.length > 0) {
      const allSubjectHits = allRows.reduce((sum, t) => sum + (t.subject_hit || 0), 0);
      const allDemonHits = allRows.reduce((sum, t) => sum + (t.ghost_hit || 0), 0);
      const allSubjectPct = (allSubjectHits / allRows.length * 100);
      const allDemonPct = (allDemonHits / allRows.length * 100);
      console.log(`${currentBlockId} BEFORE filtering: ${allRows.length} trials, Subject: ${allSubjectPct.toFixed(1)}%, Demon: ${allDemonPct.toFixed(1)}%`);
    }
    if (validRows.length > 0) {
      const validSubjectHits = validRows.reduce((sum, t) => sum + (t.subject_hit || 0), 0);
      const validDemonHits = validRows.reduce((sum, t) => sum + (t.ghost_hit || 0), 0);
      const validSubjectPct = (validSubjectHits / validRows.length * 100);
      const validDemonPct = (validDemonHits / validRows.length * 100);
      console.log(`${currentBlockId} AFTER filtering: ${validRows.length} trials, Subject: ${validSubjectPct.toFixed(1)}%, Demon: ${validDemonPct.toFixed(1)}%`);
      console.log(`${currentBlockId} Filtered out: ${allRows.length - validRows.length} trials`);
    }

    // console.log('[LOG GUARD]', { exp1DocId, sealedEnvelopeId });

    // Append-only Firestore log (skip if no sealed envelope — CL doesn't have one)
    if (exp1DocId) {
      try {
        const targetIndex = Number.isFinite(
          logRow?.target_index_0based
        )
          ? logRow.target_index_0based
          : Number.isFinite(currentTrial?.targetIndex) // <-- your local correct index
            ? currentTrial.targetIndex
            : null;

        const optionsArr = Array.isArray(logRow?.options)
          ? logRow.options
          : Array.isArray(currentTrial?.options)
            ? currentTrial.options
            : null;

        const selectedId =
          optionsArr && Number.isFinite(selectedIndex)
            ? optionsArr[selectedIndex] ?? null
            : null;

        const targetId =
          optionsArr && Number.isFinite(targetIndex)
            ? optionsArr[targetIndex] ?? null
            : null;

        const matchedFlag =
          Number.isFinite(selectedIndex) &&
            Number.isFinite(targetIndex)
            ? selectedIndex === targetIndex
              ? 1
              : 0
            : 0;


        // 🔧 Ensure client_local writes the enriched fields used by the dashboard
        if (logRow?.block_type === 'client_local') {
          // options (array of 5)
          if (!Array.isArray(logRow.options)) {
            // use whatever your app already has around this scope:
            // optionsIds OR currentTrial?.options
            logRow.options =
              (typeof optionsIds !== 'undefined' &&
                Array.isArray(optionsIds) &&
                optionsIds) ||
              (Array.isArray(currentTrial?.options) &&
                currentTrial.options) ||
              null;
          }

          // selected_index (0..4)
          if (!Number.isFinite(logRow.selected_index)) {
            if (
              typeof selectedIndex !== 'undefined' &&
              Number.isFinite(selectedIndex)
            ) {
              logRow.selected_index = selectedIndex;
            }
          }

          // target_index_0based (0..4)
          if (!Number.isFinite(logRow.target_index_0based)) {
            // many codebases call this "resolvedCorrectIndex" or "targetIndex"
            const tIdx = Number.isFinite(resolvedCorrectIndex)
              ? resolvedCorrectIndex
              : Number.isFinite(targetIndex)
                ? targetIndex
                : Number.isFinite(currentTrial?.targetIndex)
                  ? currentTrial.targetIndex
                  : null;
            logRow.target_index_0based = tIdx;
          }

          // ids derived from options
          if (
            logRow.selected_id == null &&
            Array.isArray(logRow.options) &&
            Number.isFinite(logRow.selected_index)
          ) {
            logRow.selected_id =
              logRow.options[logRow.selected_index] ?? null;
          }
          if (
            logRow.target_symbol_id == null &&
            Array.isArray(logRow.options) &&
            Number.isFinite(logRow.target_index_0based)
          ) {
            logRow.target_symbol_id =
              logRow.options[logRow.target_index_0based] ?? null;
          }

          // matched (0/1)
          if (!Number.isFinite(logRow.matched)) {
            logRow.matched =
              Number.isFinite(logRow.selected_index) &&
                Number.isFinite(logRow.target_index_0based) &&
                logRow.selected_index === logRow.target_index_0based
                ? 1
                : 0;
          }

          // client_local has no envelope; make it explicit
          if (logRow.sealed_envelope_id === undefined) {
            logRow.sealed_envelope_id = null;
          }

          // quick sanity print
          // Debug logging removed to prevent data leaks during experiments
        }

        const docId = exp1DocId || cachedDocIdRef.current;
        console.log('📊 About to write log with docId:', docId, 'exp1DocId:', exp1DocId, 'cached:', cachedDocIdRef.current);
        if (!docId) {
          console.error('❌ No document ID available for logs write!');
          return;
        }
        console.log('📝 Writing log to:', `experiment1_responses/${docId}/logs`);
        await addDoc(
          collection(db, `experiment1_responses/${docId}/logs`),
          {
            // meta
            session_id: logRow.session_id,
            app_version: logRow.app_version,
            condition: logRow.condition,
            k_options: logRow.k_options,
            block_type: logRow.block_type,
            // trial identity & timing
            trial_index: logRow.trial_index,
            press_time: logRow.press_time,
            press_start_ts: logRow.press_start_ts,
            press_release_ts: logRow.press_release_ts,
            hold_duration_ms: logRow.hold_duration_ms,
            response_time_ms: logRow.response_time_ms,
            timing_arm: logRow.timing_arm,

            // selection + options (display order)  🔴 REQUIRED for Patterns
            options: optionsArr,
            selected_index: selectedIndex,
            selected_id: selectedId,

            // results
            subject_hit: Number.isFinite(logRow.subject_hit)
              ? logRow.subject_hit
              : matchedFlag,
            ghost_hit: logRow.ghost_hit ?? 0,
            matched: logRow.matched,

            // resolved target/ghost for this press
            target_symbol_id: logRow.target_symbol_id,
            ghost_index_0based: logRow.ghost_index_0based ?? null,
            ghost_symbol_id: logRow.ghost_symbol_id ?? null,
            // --- redundancy manipulation (new) ---
            redundancy_mode: logRow.redundancy_mode,
            redundancy_count: logRow.redundancy_count,
            redundancy_orders: logRow.redundancy_orders,
            redundancy_timestamps_ms: logRow.redundancy_timestamps_ms,
            punctuation: { flash_ms: FLASH_MS, isi_ms: ISI_MS },
            // RNG provenance
            rng_source: logRow.rng_source || null,
            raw_byte: logRow.raw_byte ?? null,
            ghost_raw_byte: logRow.ghost_raw_byte ?? null,
            target_index_0based: logRow.target_index_0based,
            // sealed envelope id (baseline/quantum have it; client_local null)
            sealed_envelope_id: logRow.sealed_envelope_id,


            // audit marker for context shape
            proof_ctx_version: logRow.proof_ctx_version ?? 1,

            created_at: serverTimestamp(),
          }
        );
      } catch (e) {
        console.warn('guess log write failed', e);
      }
    }
    // ===== End-of-match detection (show ONLY after each full 5-trial match) =====
    const trialsThisBlock = updatedTrials.filter(
      (t) => t.block_type === blockId &&
        t.target_index_0based !== null && t.target_index_0based !== undefined &&
        t.selected_index !== null && t.selected_index !== undefined &&
        t.ghost_index_0based !== null && t.ghost_index_0based !== undefined
    );
    const gamesPlayedInBlock = trialsThisBlock.length;

    // ✅ put this line back:
    const justCompletedARound =
      gamesPlayedInBlock > 0 && gamesPlayedInBlock % MATCH_SIZE === 0;

    if (justCompletedARound) {
      const isLastRoundOfBlock =
        gamesPlayedInBlock === totalThisBlock;

      const roundStart = gamesPlayedInBlock - MATCH_SIZE; // last 5 only
      const thisRound = trialsThisBlock.slice(
        roundStart,
        gamesPlayedInBlock
      );

      const subjectPts = thisRound.reduce(
        (a, r) => a + (Number(r.subject_hit ?? r.matched) || 0),
        0
      );

      const wonRound = isAboveChanceMatch5(subjectPts);
      if (
        !window.matchMedia?.('(prefers-reduced-motion: reduce)')
          ?.matches &&
        wonRound
      ) {
        fireConfettiSafely();
      }

      const roundNumber = gamesPlayedInBlock / MATCH_SIZE; // 1-based
      setMatchSummary({
        blockId,
        roundNumber,
        totalRounds: calcTotalMatches(totalThisBlock),
        subjectPts,
        aboveChance: wonRound,
        isLastRound: isLastRoundOfBlock,
      });

      return; // show the summary card before continuing
    }

    // ==== End-of-block fallback (not on a round boundary) ====
    const trialsThisBlockNow = updatedTrials.filter(
      (t) => t.block_type === blockId &&
        t.target_index_0based !== null && t.target_index_0based !== undefined &&
        t.selected_index !== null && t.selected_index !== undefined &&
        t.ghost_index_0based !== null && t.ghost_index_0based !== undefined
    );
    if (trialsThisBlockNow.length === totalThisBlock) {
      await completeBlockAfterLastRound(blockId);
      return;
    }

    // ===== Next trial =====
    setCurrentTrial((c) => {
      const next = c + 1;
      prepareTrial(next, exp1DocId, currentBlockId);
      return next;
    });
  }

  async function prepareTrial(
    nextTrialIndex = 0,
    parentId = exp1DocId,
    activeBlockId = currentBlockId
  ) {
    console.log('🎯 PREPARE TRIAL DEBUG:', { nextTrialIndex, parentId, activeBlockId });
    const myRunId = ++prepRunIdRef.current; // mark this invocation; newer runs cancel older ones

    setTrialReady(false);
    setSealedEnvelopeId(null);
    hasGuessedRef.current = false;
    setTrialBlockingError(null);

    // Reset feedback immediately for new trial
    setHasGuessedThisTrial(false);
    setLastResult(null);

    const useMotionSafe = Boolean(motionSafe); // 👈 now defined
    const totalThisBlock = totalTrialsFor(activeBlockId);
    const runId = await ensureRunDoc();

    // read the redundancy_order we just stored (best-effort; safe to default)
    let redundancy_order = 'single_then_redundant';
    try {
      const snap = await getDoc(doc(db, 'experiment1_responses', runId));
      const ro = snap.exists() ? String(snap.data()?.redundancy_order || '') : '';
      if (ro === 'single_then_redundant' || ro === 'redundant_then_single') redundancy_order = ro;
    } catch (_) { }

    const trialNum = nextTrialIndex + 1;
    const { condition } = redundancyConditionFor(
      activeBlockId,
      nextTrialIndex,
      totalThisBlock,
      redundancy_order
    );

    const isRedundant = condition === 'redundant';
    const R = useMotionSafe
      ? 1
      : (isRedundant ? Math.max(2, Number(config.REDUNDANT_R) || 2) : 1);

    const finalRedundancyMode = useMotionSafe ? 'single' : (isRedundant ? 'redundant' : 'single');
    console.log('🔄 REDUNDANCY DEBUG:', {
      trial: nextTrialIndex + 1,
      condition,
      isRedundant,
      useMotionSafe,
      finalMode: finalRedundancyMode,
      redundancyCount: R
    });
    setRedundancyMode(finalRedundancyMode);
    setRedundancyCount(R);
    setRedundancyOrders([]);
    setRedundancyTimestamps([]);

    // We will fetch/resolve RNG BYTES once, then map against final layout after R flashes.
    let rng_source = null;
    let server_time = null;
    let primary_raw = null;
    let ghost_raw = null;
    let primary_symbol_id = null;
    let ghost_symbol_id = null;

    // ===== Block 3: client_local (predrawn on client) =====
    console.log('🟡 CHECKING: client_local path, activeBlockId:', activeBlockId);
    if (activeBlockId === 'client_local') {
      console.log('✅ TAKING: client_local path');
      const cached = assignmentCache?.client_local?.[trialNum];
      if (!cached) {
        setTrialBlockingError(
          'Client-local envelopes not ready. Please click “Draw Your Sealed Envelopes” on the previous screen.'
        );
        return;
      }
      primary_raw = cached.raw_byte >>> 0;
      ghost_raw = cached.ghost_raw_byte >>> 0;
      primary_symbol_id = ZENER[toSymIdx(primary_raw)].id;
      ghost_symbol_id = ZENER[toSymIdx(ghost_raw)].id;
      rng_source = 'client_local_predraw';
      server_time = Date.now();

      if (runId) {
        const sealedId = `${sessionId}-${activeBlockId}-${trialNum}`;
        try {
          await setDoc(
            doc(db, `experiment1_responses/${runId}/sealed_envelope/${sealedId}`),
            {
              session_id: sessionId,
              app_version: appVersion,
              block_type: activeBlockId,
              trial_index: trialNum,
              rng_source,
              server_time,
              k_options: K_OPTIONS,
              raw_byte: primary_raw,
              ghost_raw_byte: ghost_raw,
              primary_symbol_id,
              ghost_symbol_id,
              primary_index_0based: null,
              ghost_index_0based: null,
              created_at: serverTimestamp(),
            },
            { merge: false }
          );
          setSealedEnvelopeId(sealedId);
        } catch (e) {
          console.warn('[sealed_envelope] client_local write failed:', e);
        }
      }
    }
    // ===== Server-backed blocks =====
    else {
      console.log('✅ TAKING: server-backed path (full_stack or spoon_love)', activeBlockId);
      const cached = assignmentCache[activeBlockId]?.[trialNum];

      const pullBytesNow = async () => {
        if (activeBlockId === 'full_stack') {
          const res = await getPrngPairOrThrow();
          return { bytes: res.bytes, source: res.source || 'random_org', server_time: res.server_time ?? null };
        } else {
          const res = await getQuantumPairOrThrow();
          return { bytes: res.bytes, source: res.source || 'qrng', server_time: res.server_time ?? null };
        }
      };

      let bytes, source;
      if (cached) {
        bytes = [cached.raw_byte >>> 0, cached.ghost_raw_byte >>> 0];
        source = cached.rngMeta?.source || (activeBlockId === 'full_stack' ? 'random_org' : 'qrng');
        server_time = cached.rngMeta?.server_time ?? null;
      } else {
        const r = await pullBytesNow();
        bytes = r.bytes;
        source = r.source;
        server_time = r.server_time;
      }

      primary_raw = bytes[0] >>> 0;
      ghost_raw = bytes[1] >>> 0;
      primary_symbol_id = ZENER[toSymIdx(primary_raw)].id;
      ghost_symbol_id = ZENER[toSymIdx(ghost_raw)].id;
      rng_source = source;

      const sealedId = `${sessionId}-${activeBlockId}-${trialNum}`;
      try {
        await setDoc(
          doc(db, `experiment1_responses/${runId}/sealed_envelope/${sealedId}`),
          {
            session_id: sessionId,
            app_version: appVersion,
            block_type: activeBlockId,
            trial_index: trialNum,
            rng_source,
            server_time,
            k_options: K_OPTIONS,
            raw_byte: primary_raw,
            ghost_raw_byte: ghost_raw,
            primary_symbol_id,
            ghost_symbol_id,
            primary_index_0based: null,
            ghost_index_0based: null,
            created_at: serverTimestamp(),
          },
          { merge: false }
        );
        setSealedEnvelopeId(sealedId);
      } catch (e) {
        console.warn('[sealed_envelope] write failed', e);
      }
    }

    // === Shuffle ONCE per trial, reuse for all flashes ===
    layoutRef.current = shuffledFive();               // one Fisher–Yates per trial
    const baseLayout = layoutRef.current;             // frozen order for this trial

    const baseOrder = baseLayout.map(o => o.id);
    const orders = Array.from({ length: R }, () => [...baseOrder]);
    setRedundancyOrders(orders);
    // If motionSafe, record a single order; otherwise record R identical flashes
    setRedundancyOrders(useMotionSafe ? [baseOrder] : Array.from({ length: R }, () => [...baseOrder]));

    const t0 = performance.now();
    const ts = []; // onset time for each flash (ms since trial start)
    // --- Punctuation path: R flashes with blanks ---
    for (let i = 0; i < R; i++) {
      setChoiceOptions(baseLayout);                  // flash on
      ts.push(Math.round(performance.now() - t0));   // onset timestamp
      await new Promise(r => setTimeout(r, FLASH_MS));  // on-duration
      if (myRunId !== prepRunIdRef.current) return;
      if (i < R - 1 && !useMotionSafe) {
        setChoiceOptions([]);                   // blank/mask
        await new Promise(r => setTimeout(r, ISI_MS));
        if (myRunId !== prepRunIdRef.current) return;
      }
    }

    // After the final flash, compute indices against this SAME layout:
    console.log('BYTE DEBUG:', { primary_raw, ghost_raw, same: primary_raw === ghost_raw });
    const assigned = assignZenerFromBytes(primary_raw, ghost_raw, baseLayout);
    console.log('ASSIGNMENT DEBUG:', {
      rawByte: primary_raw,
      ghostByte: ghost_raw,
      rawByte_mod5: primary_raw % 5,
      ghostByte_mod5: ghost_raw % 5,
      subjectSym: assigned.primary_symbol_id,
      ghostSym: assigned.ghost_symbol_id,
      primaryIndex: assigned.primaryIndex,
      ghostIndex: assigned.ghostIndex,
      displayIcons: baseLayout.map(opt => opt.id)
    });
    console.log('BEFORE setState:', { primaryIndex: assigned.primaryIndex, ghostIndex: assigned.ghostIndex });
    setCorrectIndex(assigned.primaryIndex);
    setGhostIndex(assigned.ghostIndex);
    console.log('AFTER setState - SET TO:', { correctIndex: assigned.primaryIndex, ghostIndex: assigned.ghostIndex });
    setRngMeta({
      source: rng_source,
      server_time,
      k_options: K_OPTIONS,
      primary_symbol_id,
      ghost_symbol_id,
      raw_byte: primary_raw,
      ghost_raw_byte: ghost_raw,
      redundancy_mode: useMotionSafe ? 'single' : (isRedundant ? 'redundant' : 'single'),
      redundancy_count: R,
      punctuation: { flash_ms: FLASH_MS, isi_ms: ISI_MS },
      calculated_primary_index: assigned.primaryIndex,
      calculated_ghost_index: assigned.ghostIndex,
    });

    setRedundancyTimestamps(ts);
    setChoiceOptions(baseLayout); // ensure final layout is on-screen
    setTrialStartTime(performance.now()); // Capture trial start time
    setTrialReady(true);
  }


  // Robot/autopilot mode: random guesses
  useEffect(() => {
    if (!robotMode) return;
    if (step !== 'trials') return;
    let cancelled = false;
    (async () => {
      while (!cancelled && currentTrial < totalTrialsPerBlock) {
        const waitMs = -Math.log(1 - Math.random()) * 900;
        await new Promise((r) => setTimeout(r, waitMs));
        const guess = Math.floor(
          Math.random() * Math.max(1, choiceOptions.length)
        );
        await handleGuess(guess);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [robotMode, step, currentTrial, totalTrialsPerBlock]);

  /* =========================
     Save results (summary + details)
     ========================= */

  const saveResults = async (
    exitedEarly = false,
    earlyExitInfo = null
  ) => {
    if (isSavingRef.current) return;
    isSavingRef.current = true;

    await ensureSignedIn();
    const uid = auth.currentUser?.uid ?? null;

    const devNotify = (msg) => {
      if (process.env.NODE_ENV !== 'production') {
        try {
          alert(msg);
        } catch (_) { }
      } else {
        console.warn(msg);
      }
    };

    const fsTrials = trialResults.filter(
      (t) => t.block_type === 'full_stack' &&
        t.target_index_0based !== null && t.target_index_0based !== undefined &&
        t.selected_index !== null && t.selected_index !== undefined &&
        t.ghost_index_0based !== null && t.ghost_index_0based !== undefined
    );
    const slTrials = trialResults.filter(
      (t) => t.block_type === 'spoon_love' &&
        t.target_index_0based !== null && t.target_index_0based !== undefined &&
        t.selected_index !== null && t.selected_index !== undefined &&
        t.ghost_index_0based !== null && t.ghost_index_0based !== undefined
    );
    // NEW: client-local (third block)
    const clTrials = trialResults.filter(
      (t) => t.block_type === 'client_local' &&
        t.target_index_0based !== null && t.target_index_0based !== undefined &&
        t.selected_index !== null && t.selected_index !== undefined &&
        t.ghost_index_0based !== null && t.ghost_index_0based !== undefined
    );

    const getSubjectHit = (r) => {
      if (typeof r.subject_hit === 'number') return r.subject_hit;
      if (typeof r.matched === 'number') return r.matched;
      if (
        typeof r.selected_index === 'number' &&
        typeof r.primary_is_right === 'number'
      ) {
        const primaryIndex = r.primary_is_right ? 1 : 0;
        return r.selected_index === primaryIndex ? 1 : 0;
      }
      return null;
    };
    const getDemonHit = (r) => {
      if (typeof r.ghost_hit === 'number') return r.ghost_hit;
      if (
        typeof r.selected_index === 'number' &&
        typeof r.ghost_is_right === 'number'
      ) {
        const ghostIndex = r.ghost_is_right ? 1 : 0;
        return r.selected_index === ghostIndex ? 1 : 0;
      }
      return null;
    };
    const sum = (arr) => arr.reduce((a, b) => a + b, 0);

    // FULL STACK (baseline)
    const fsSub = fsTrials
      .map(getSubjectHit)
      .filter((v) => v != null);
    const fsDem = fsTrials.map(getDemonHit).filter((v) => v != null);
    const fsN = Math.min(fsSub.length, fsDem.length) || 0;
    const fsHits = sum(fsSub);
    const fsDemonHits = sum(fsDem);
    const fsRealPct = fsN > 0 && Number.isFinite(fsHits)
      ? Number(((fsHits / fsN) * 100).toFixed(1))
      : null;
    const fsGhostPct = fsN > 0 && Number.isFinite(fsDemonHits)
      ? Number(((fsDemonHits / fsN) * 100).toFixed(1))
      : null;
    const fsDeltaPct =
      fsRealPct != null && fsGhostPct != null
        ? Number((fsRealPct - fsGhostPct).toFixed(1))
        : null;

    const fsDisplayedPct =
      fullStackStats?.userPercent != null
        ? Number(fullStackStats.userPercent)
        : null;

    let fsN10 = 0,
      fsN01 = 0;
    for (let i = 0; i < fsN; i++) {
      const s = fsSub[i],
        d = fsDem[i];
      if (s === 1 && d === 0) fsN10++;
      else if (s === 0 && d === 1) fsN01++;
    }

    // SPOON LOVE (quantum)
    const slSub = slTrials
      .map(getSubjectHit)
      .filter((v) => v != null);
    const slDem = slTrials.map(getDemonHit).filter((v) => v != null);
    const slN = Math.min(slSub.length, slDem.length) || 0;
    const slHits = sum(slSub);
    const slDemonHits = sum(slDem);
    const slRealPct = slN > 0 && Number.isFinite(slHits)
      ? Number(((slHits / slN) * 100).toFixed(1))
      : null;
    const ghostPct = slN > 0 && Number.isFinite(slDemonHits)
      ? Number(((slDemonHits / slN) * 100).toFixed(1))
      : null;
    const deltaPct =
      slRealPct != null && ghostPct != null
        ? Number((slRealPct - ghostPct).toFixed(1))
        : null;

    let n10 = 0,
      n01 = 0;
    for (let i = 0; i < slN; i++) {
      const s = slSub[i],
        d = slDem[i];
      if (s === 1 && d === 0) n10++;
      else if (s === 0 && d === 1) n01++;
    }
    // CLIENT LOCAL (third block) — optional summary for the parent doc
    const clSub = clTrials
      .map(getSubjectHit)
      .filter((v) => v != null);
    const clDem = clTrials.map(getDemonHit).filter((v) => v != null);
    const clN = Math.min(clSub.length, clDem.length) || 0;
    const clHits = clSub.reduce((a, b) => a + b, 0);
    const clDemonHits = clDem.reduce((a, b) => a + b, 0);
    const clRealPct = clN > 0 && Number.isFinite(clHits)
      ? Number(((clHits / clN) * 100).toFixed(1))
      : null;
    const clGhostPct = clN > 0 && Number.isFinite(clDemonHits)
      ? Number(((clDemonHits / clN) * 100).toFixed(1))
      : null;
    const clDeltaPct =
      clRealPct != null && clGhostPct != null
        ? Number((clRealPct - clGhostPct).toFixed(1))
        : null;
    let clN10 = 0,
      clN01 = 0;
    for (let i = 0; i < clN; i++) {
      const s = clSub[i],
        d = clDem[i];
      if (s === 1 && d === 0) clN10++;
      else if (s === 0 && d === 1) clN01++;
    }

    const sessionSummary = {
      session_id: sessionId,
      app_version: appVersion,
      assignment: { primed: false },
      consent: {
        version: CONSENT_VERSION,
        consented: !!consentAgree,
        age_over_18: !!consent18,
        partial_disclosure_ack: true,
        debrief_url: DEBRIEF_URL,
        timestamp: new Date().toISOString(),
      },
      preResponses,
      postResponses,
      full_stack: {
        primed: isHighPrime,
        accuracy_real: fsRealPct,
        accuracy_displayed: fsDisplayedPct,
        accuracy_base:
          fullStackStats?.basePercent != null
            ? Number(fullStackStats.basePercent)
            : fsRealPct,
        boost_amount: Number(fullStackStats?.boostAmount ?? 0),
        boosted: !!fullStackStats?.boosted,
        percent_ghost_right: fsGhostPct,
        delta_vs_ghost: fsDeltaPct,
        summary: {
          trials: fsTrials.length,
          hits_primary_right: fsHits,
          hits_ghost_right: fsDemonHits,
          percent_primary_right: fsRealPct,
          percent_ghost_right: fsGhostPct,
          delta_vs_ghost: fsDeltaPct,
          n10: fsN10,
          n01: fsN01,
        },
      },
      spoon_love: {
        accuracy_real: slRealPct,
        percent_ghost_right: ghostPct,
        delta_vs_ghost: deltaPct,
        summary: {
          trials: slTrials.length,
          hits_primary_right: slHits,
          hits_ghost_right: slDemonHits,
          percent_primary_right: slRealPct,
          percent_ghost_right: ghostPct,
          delta_vs_ghost: deltaPct,
          n10,
          n01,
        },
      },
      client_local: {
        accuracy_real: clRealPct,
        percent_ghost_right: clGhostPct,
        delta_vs_ghost: clDeltaPct,
        summary: {
          trials: clTrials.length,
          hits_primary_right: clHits,
          hits_ghost_right: clDemonHits,
          percent_primary_right: clRealPct,
          percent_ghost_right: clGhostPct,
          delta_vs_ghost: clDeltaPct,
          n10: clN10,
          n01: clN01,
        },
      },
      exitedEarly: exitedEarly,
      exit_reason: exitedEarly
        ? earlyExitInfo?.reason || 'unspecified'
        : 'complete',
      exit_reason_notes: exitedEarly
        ? earlyExitInfo?.notes || null
        : null,
      // Keep this ISO for human/CSV readability; Firestore 'timestamp' is added below
      timestamp: new Date().toISOString(),
    };

    // Keep the small record BUT include picks/targets so analysis can run.
    const toMinimalTrial = (r) => {
      const sh = getSubjectHit(r);
      const dh = getDemonHit(r);

      return {
        // identity
        session_id: r.session_id,
        sealed_envelope_id: r.sealed_envelope_id ?? null,
        block_type: r.block_type,
        trial_index: r.trial_index,

        // timing
        press_time: r.press_time,
        press_start_ts: r.press_start_ts ?? r.press_time ?? null,
        press_release_ts: r.press_release_ts ?? null,
        hold_duration_ms: r.hold_duration_ms ?? null,
        response_time_ms: r.response_time_ms ?? null,
        timing_arm: r.timing_arm ?? null,
        agent: r.agent ?? null,

        // rng provenance
        rng_source: r.rng_source || null,
        raw_byte: r.raw_byte ?? null,
        ghost_raw_byte: r.ghost_raw_byte ?? null,


        // selection + options (needed for Patterns)
        options: Array.isArray(r.options) ? r.options : null,
        selected_index:
          typeof r.selected_index === 'number'
            ? r.selected_index
            : null,
        selected_id: r.selected_id ?? null,

        // resolved target/ghost indices (needed for Patterns)
        target_index_0based:
          typeof r.target_index_0based === 'number'
            ? r.target_index_0based
            : null,
        ghost_index_0based:
          typeof r.ghost_index_0based === 'number'
            ? r.ghost_index_0based
            : null,
        target_symbol_id: r.target_symbol_id ?? null,
        ghost_symbol_id: r.ghost_symbol_id ?? null,

        // results
        subject_hit: sh,
        ghost_hit: dh,
        matched: typeof r.matched === 'number' ? r.matched : null,

      };
    };

    const fsTrialsMin = fsTrials.map((r, idx, arr) => {
      const baseRow = toMinimalTrial(r);

      const isLastFullStackTrial = idx === arr.length - 1;
      if (!isLastFullStackTrial) return baseRow;
      const basePercent =
        fullStackStats && fullStackStats.basePercent != null
          ? Number(fullStackStats.basePercent)
          : fsRealPct ?? null;
      const displayedPercent =
        fullStackStats && fullStackStats.userPercent != null
          ? Number(fullStackStats.userPercent)
          : fsDisplayedPct ?? null;
      const boostAmount =
        fullStackStats && fullStackStats.boostAmount != null
          ? Number(fullStackStats.boostAmount)
          : 0;
      const boostedFlag = !!(
        fullStackStats && fullStackStats.boosted
      );
      return {
        ...baseRow,
        block_summary: 1,
        fs_base_percent: basePercent,
        fs_displayed_percent: displayedPercent,
        fs_boost_amount: boostAmount,
        fs_boosted: boostedFlag,
      };
    });
    const slTrialsMin = slTrials.map(toMinimalTrial);
    // NEW: client-local minimal trials
    const clTrialsMin = clTrials.map(toMinimalTrial);

    try {
      const existingDocId = exp1DocId || cachedDocIdRef.current;
      console.log('🐛 Complete experiment - existingDocId:', existingDocId, 'exp1DocId:', exp1DocId, 'cached:', cachedDocIdRef.current);
      if (!existingDocId) {
        console.error('❌ No existing document ID found! This will create a duplicate document.');
        throw new Error('No document ID available - cannot complete experiment');
      }
      const mainDocId = existingDocId;
      console.log('✅ Using existing document ID:', mainDocId);

      await setDoc(
        doc(db, 'experiment1_responses', mainDocId),
        {
          participant_id: uid,
          session_id: sessionId,
          ...sessionSummary,
          // canonical server time for ordering
          timestamp: serverTimestamp(),
          updated_at: serverTimestamp(),
        },
        { merge: true }
      );

      const detailsRef = doc(
        db,
        'experiment1_responses',
        mainDocId,
        'details',
        'trialDetails'
      );
      await setDoc(
        detailsRef,
        {
          full_stack_trials: fsTrialsMin,
          spoon_love_trials: slTrialsMin,
          client_local_trials: clTrialsMin,
        },
        { merge: true }
      );

      // console.log('Saved run', mainDocId);
    } catch (e) {
      console.error('MAIN SAVE FAILED', e);
      const msg = (e && (e.message || e.code)) || String(e);
      devNotify('Main save failed: ' + msg);
      throw e;
    } finally {
      isSavingRef.current = false;
    }

    // Participant runs bump
    try {
      if (uid) {
        await setDoc(
          doc(db, 'participants', uid),
          {
            has_run: true,
            runs: increment(exitedEarly ? 0 : 1),
            updated_at: serverTimestamp(),
            last_run_at: serverTimestamp(),
          },
          { merge: true }
        );
        setProfile((prev) => {
          if (!prev) return prev;
          const bump = exitedEarly ? 0 : 1;
          return {
            ...prev,
            has_run: true,
            runs: (prev.runs ?? 0) + bump,
          };
        });
      }
    } catch (e) {
      console.warn('Participant runs update failed:', e);
    }
  };
  function ratingMessage(pValue, pct) {
    // Prefer p-value (tells us statistical strength)
    if (Number.isFinite(pValue)) {
      if (pValue > 0.2) return 'Within chance range.';
      if (pValue > 0.05)
        return 'Slightly above chance (not significant).';
      if (pValue > 0.01) return 'Significant at the 0.05 level.';
      return 'Very strong evidence (p < 0.01).';
    }
    // Fallback to percent if p-value isn’t available
    const p = parseFloat(pct);
    if (!Number.isFinite(p)) return '';
    if (p <= 20) return 'Within chance range (≈20%).';
    if (p <= 29) return 'Slightly above chance.';
    if (p <= 39) return 'Notably above chance.';
    if (p <= 49) return 'Strong result.';
    return 'Very strong alignment.';
  }

  /* =========================
     Render
     ========================= */

  return (
    <div className="App" role="main" id="main">
      {/* consent gate */}
      {step === 'consent' && (
        <>
          <h1>Consent to Participate (pilot study)</h1>
          <p>
            This study evaluates whether selection accuracy for a
            preselected symbol exceeds chance levels. You will
            complete multiple short trials and brief questionnaires at
            the beginning and end (approximately 10–20
            minutes). You have the option of listening to Binaural Beats throughout the trials.
          </p>
          <p>
            <strong>Important:</strong> To preserve the scientific
            validity of the study, some details cannot be fully
            explained until after participation. A full explanation
            will be provided after data collection for the entire
            study is complete.
          </p>
          <ul>
            <li>
              Participation is voluntary; you may stop at any time.
            </li>
            <li>
              We store anonymous trial data and questionnaire answers
              in Google Firestore (USA).
            </li>
            <li>
              We store responses indefinitely for research
              replication. Hosting providers may log IPs for security;
              we do not add IPs to the study database.
            </li>
            <li>
              Contact:{' '}
              <a href="mailto:h@whatthequark.com">
                h@whatthequark.com
              </a>{' '}
              with any questions or concerns.
            </li>
          </ul>

          <label>
            <input
              type="checkbox"
              checked={consent18}
              onChange={(e) => setConsent18(e.target.checked)}
            />{' '}
            I am 18 years or older.
          </label>
          <br />
          <label>
            <input
              type="checkbox"
              checked={consentAgree}
              onChange={(e) => setConsentAgree(e.target.checked)}
            />{' '}
            I consent to participate and understand some details will
            be explained after participation.
          </label>

          {(() => {
            const canContinue = consent18 && consentAgree;
            return (
              <>
                {!canContinue ? (
                  <p
                    style={{
                      textAlign: 'center',
                      fontSize: 14,
                      opacity: 0.75,
                      marginTop: 8,
                    }}
                  >
                    Check both boxes to continue.
                  </p>
                ) : null}
                <button
                  className={`primary-btn ${!canContinue || isBusy ? 'is-disabled' : ''
                    }`}
                  disabled={!canContinue || isBusy}
                  aria-disabled={!canContinue || isBusy}
                  onClick={async () => {
                    setIsBusy(true);
                    try {
                      const canSkipPre = !!(profile?.demographics && profile?.demographics_version === 'v1');
                      setStep(canSkipPre ? 'breathe-fullstack' : 'pre');
                    } finally {
                      setIsBusy(false);
                    }
                  }}
                >
                  {isBusy ? 'One moment…' : 'I Agree, Continue'}
                </button>
              </>
            );
          })()}

          <p style={{ fontSize: 12, opacity: 0.7 }}>
            Consent {CONSENT_VERSION}
          </p>
        </>
      )}

      {step === 'pre' && (
        <>
          <h1>Experiment #1: Sealed Envelopes</h1>
          <h2>Welcome!</h2>

          <p>
            In this experiment, you’ll try to choose the{' '}
            <strong>hidden symbol</strong> out of five options. Since
            there are five symbols, random guessing would be about
            <strong> 20% correct</strong>. Trials are grouped into{' '}
            <strong>rounds of 5</strong>. If you get{' '}
            <strong>3 or more</strong> right in a round, that counts
            as a<strong> round win</strong>.
          </p>

          <h3>How this session works</h3>
          <ol>
            <li>
              <strong>Physical block</strong> (
              {trialsPerBlock.full_stack} trials,{' '}
              {calcTotalMatches(trialsPerBlock.full_stack)} rounds): A
              sealed sequence from a physical hardware random
              generator is fixed at draw time, and you try to perceive
              the hidden target.
            </li>
            <li>
              <strong>Quantum block</strong> (
              {trialsPerBlock.spoon_love} trials,{' '}
              {calcTotalMatches(trialsPerBlock.spoon_love)} rounds): A
              sealed sequence from a quantum random generator is fixed
              at draw time, and you try to perceive the hidden target.
            </li>
            <li>
              <strong>Client-local block</strong> (
              {trialsPerBlock.client_local} trials,{' '}
              {calcTotalMatches(trialsPerBlock.client_local)} rounds):
              Your device pre-draws and commits a sealed sequence, and
              each trial uses a predrawn value to test for perception
              of the hidden target generated locally.
            </li>
          </ol>

          <p>
            You’ll answer a few questions at the beginning and a quick
            wrap-up at the end. Estimated time:{' '}
            <strong>10-15 minutes</strong>.
          </p>
          <p>
            <strong>Feedback:</strong> Results are summarized{' '}
            <em>by round</em> only. After every 5 trials, you’ll see
            your trial and round score and whether it was counted as a
            win (3+ correct). At the end of all the matches you will
            see your total score.
          </p>
          <details
            className="expander"
            style={{ marginTop: '0.75rem' }}
          >
            <summary>Why “sealed envelopes”?</summary>
            <div>
              <p>
                We use “sealed envelopes” (hash commitments) so
                targets are fixed, hidden, and later verifiable. Three
                RNG's fix targets on a server the participant never
                touches. There’s no experimenter and no physical cards
                to mark. We include a demon under the hood to confirm
                RNG parity. If, under these conditions, participants
                beat chance in this pilot, that’s meaningful evidence
                warranting deeper study.
              </p>
            </div>
          </details>

          <details
            className="expander"
            style={{ marginTop: '0.75rem' }}
          >
            <summary>What you’ll do in each match</summary>
            <div>
              In each match you will try to perceive a hidden target
              under sealed and auditable randomness. We call this
              anomalous cognition (perception of hidden information).
            </div>
            <div>
              Some participants prefer to go quickly. Others prefer to
              pause and focus. Use the pace that feels natural to you.
            </div>
            <ol>
              <li>
                <strong>Physical RNG Match</strong> (
                {trialsPerBlock.full_stack} trials): Click{' '}
                <em>Draw Your Sealed Envelopes</em> to fetch a sealed
                sequence from a physical hardware random generator. On
                each trial, pick one of five symbols and the app
                scores against the sealed target index. After the
                match, the server reveals the bytes and salt for
                verification.
              </li>
              <li>
                <strong>Quantum RNG Match</strong> (
                {trialsPerBlock.spoon_love} trials): Click{' '}
                <em>Draw Your Sealed Envelopes</em> to fetch a sealed
                quantum sequence. On each trial, pick a symbol. After the match, the server reveals the bytes and
                salt for verification.
              </li>
              <li>
                <strong>Client RNG Match</strong> (
                {trialsPerBlock.client_local} trials): Click{' '}
                <em>Draw Your Sealed Envelopes</em> to pre-draw and
                commit a sealed sequence on your device. On each
                trial, the app uses a predrawn target index held in
                local memory to score your choice. After the match,
                your device reveals the bytes and salt for
                verification.
              </li>
            </ol>
          </details>

          <p>
            You have completed this experiment{' '}
            {profile === undefined ? '…' : String(profile?.runs ?? 0)}{' '}
            time(s).
          </p>

          {filteredPreQuestions.map((q, i) => {
            const error = fieldError(q, preResponses);
            const invalid = !!error && config.REQUIRE_PRE;
            return (
              <div
                key={q.id}
                className={`question-block ${invalid ? 'missing' : ''
                  }`}
              >
                <label htmlFor={q.id} className="question-label">
                  <strong>Q{i + 1}.</strong> {q.question}
                </label>
                <div className="answer-wrapper">
                  {renderInput(q, 'pre', invalid)}
                  {invalid ? (
                    <div className="field-hint" role="alert">
                      {error}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}

          {(() => {
            const REQUIRE_PRE = config.REQUIRE_PRE;
            const preComplete = filteredPreQuestions.every((q) =>
              isAnswered(q, preResponses)
            );
            const isBlocked = REQUIRE_PRE && !preComplete;

            const onStartBaseline = async () => {
              if (isBlocked) return;
              try {
                await saveProfileIfNeeded(preResponses);
              } catch (e) {
                console.warn(
                  'saveProfileIfNeeded failed (continuing):',
                  e
                );
              }
              setStep('breathe-fullstack');
            };

            return (
              <>
                {!preComplete ? (
                  <p
                    style={{
                      fontSize: 12,
                      opacity: 0.75,
                      marginTop: 8,
                    }}
                  >
                    Please answer all questions to continue. Accurate,
                    complete responses help the research.
                  </p>
                ) : null}
                <button
                  className={`primary-btn ${isBlocked ? 'looks-disabled' : ''
                    }`}
                  aria-disabled={isBlocked}
                  onClick={onStartBaseline}
                >
                  Read Instructions
                </button>
              </>
            );
          })()}
        </>
      )}

      {step === 'fullstack-results' && fullStackStats && (
        <>
          <h2>Practice Block Results</h2>
          <div>
            <p>
              <strong>Your Score:</strong>
            </p>

            {(() => {
              const rows = trialResults.filter(
                (t) => t.block_type === 'full_stack'
              );
              const hits = rows.reduce(
                (a, r) =>
                  a +
                  (Number(r.subject_hit) === 1
                    ? 1
                    : Number(r.matched) === 1
                      ? 1
                      : 0),
                0
              );
              const total =
                rows.length || totalTrialsFor('full_stack');
              return (
                <p style={{ marginTop: 4, opacity: 0.85 }}>
                  Total trial wins: <b>{hits}</b> / <b>{total}</b> (
                  {fullStackStats.userPercent}%)
                </p>
              );
            })()}

            {(() => {
              const rows = trialResults.filter(
                (t) => t.block_type === 'full_stack'
              );
              const { wins } = countAboveChanceRoundWins(
                rows,
                MATCH_SIZE
              );
              const totalRounds = calcTotalMatches(
                totalTrialsFor('full_stack')
              );
              return (
                <p style={{ opacity: 0.8 }}>
                  Total round wins (≥3/5): <b>{wins}</b> /{' '}
                  <b>{totalRounds}</b>
                </p>
              );
            })()}

            <p style={{ opacity: 0.8 }}>
              <em>One-sided p (X ≥ hits, p₀=20%):</em>{' '}
              {formatP(fullStackStats.pValue)}{' '}
              {fullStackStats.significant
                ? '— Significant at 0.05'
                : ''}
            </p>
          </div>

          <p>
            {ratingMessage(
              fullStackStats.pValue,
              fullStackStats.userPercent
            )}
          </p>

          {/* Per-block match tally (baseline / full_stack) */}

          <div
            className="instructions"
            dangerouslySetInnerHTML={{
              __html: fullStackBlock?.resultsMessage || '',
            }}
          />

          {midQuestions.map((q, i) => (
            <div key={q.id} className="question-block">
              <label htmlFor={q.id} className="question-label">
                <strong>Q{i + 1}.</strong> {q.question}
              </label>
              <div className="answer-wrapper">
                {renderInput(q, 'mid')}
              </div>
            </div>
          ))}

          {(() => {
            const midComplete = midQuestions.every((q) =>
              isAnswered(q, midResponses)
            );
            return (
              <>
                {!midComplete ? (
                  <p
                    style={{
                      fontSize: 12,
                      opacity: 0.75,
                      marginTop: 6,
                    }}
                  >
                    Please answer all questions to continue. Accurate,
                    complete responses help the research.
                  </p>
                ) : null}
                <button
                  className={`primary-btn ${!midComplete ? 'looks-disabled' : ''
                    }`}
                  aria-disabled={!midComplete}
                  onClick={() => {
                    if (midComplete) setStep('breathe-spoon');
                  }}
                >
                  Get Ready For The Quantum Trials
                </button>
              </>
            );
          })()}
        </>
      )}

      {step === 'breathe-fullstack' && (
        <div className="breathe-step">
          <div className="breathing-circle" aria-hidden="true" />
          <div style={{ margin: '8px 0', fontSize: 13, opacity: 0.85 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={motionSafe}
                onChange={(e) => setMotionSafe(e.target.checked)}
              />
              Reduce motion (no flashing)
            </label>
          </div>

          <hr style={{ margin: '1.5rem 0' }} />
          <div
            className="instructions"
            dangerouslySetInnerHTML={{
              __html: fullStackBlock?.preInstructions || '',
            }}
          />

          {/* Prefetch sealed envelopes for BASELINE */}
          <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
            {isPrefetching.full_stack ? (
              <EnvelopeLoader
                label={`Drawing sealed envelopes… ${prefetchStatus.full_stack.count}/${prefetchStatus.full_stack.total}`}
              />
            ) : (
              <button
                className={
                  prefetchStatus.full_stack.done
                    ? 'secondary-btn looks-disabled'
                    : 'primary-btn'
                }
                onClick={() => {
                  if (!prefetchStatus.full_stack.done)
                    prefetchBlock('full_stack');
                }}
                disabled={
                  isPrefetching.full_stack ||
                  prefetchStatus.full_stack.done
                }
                aria-disabled={
                  isPrefetching.full_stack ||
                  prefetchStatus.full_stack.done
                }
                title={
                  prefetchStatus.full_stack.done
                    ? 'Sealed envelopes ready'
                    : undefined
                }
              >
                <span className="btn-icon">
                  <svg
                    className="btn-envelope"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path
                      d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2
                 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 2v.01L12 13
                 4 6.01V6h16ZM4 18V8l8 7 8-7v10H4Z"
                    />
                  </svg>
                  <span>Draw Your Sealed Envelopes</span>
                </span>
              </button>
            )}
            {/* Status line: show progress & prompt more draws */}
            <div style={{ fontSize: 12, opacity: 0.8 }}>
              Envelopes ready: {prefetchStatus.full_stack.count}/
              {prefetchStatus.full_stack.total}
              {prefetchStatus.full_stack.count <
                prefetchStatus.full_stack.total ? (
                <span>
                  {' '}
                  — please click “Draw Your Sealed Envelopes” again.
                </span>
              ) : null}
            </div>
            <button
              className={`primary-btn ${!prefetchStatus.full_stack?.done ||
                prefetchStatus.full_stack.count <
                prefetchStatus.full_stack.total
                ? 'looks-disabled'
                : ''
                }`}
              onClick={async () => {
                // Double-guard in onClick too (cheap and safe)
                const ps = prefetchStatus.full_stack;
                if (
                  isPrefetching.full_stack ||
                  !ps?.done ||
                  ps.count < ps.total
                ) {
                  return; // don't start yet
                }
                await startTrials(0);
              }}
              disabled={
                isPrefetching.full_stack ||
                !prefetchStatus.full_stack?.done ||
                prefetchStatus.full_stack.count <
                prefetchStatus.full_stack.total
              }
              aria-disabled={
                isPrefetching.full_stack ||
                !prefetchStatus.full_stack?.done ||
                prefetchStatus.full_stack.count <
                prefetchStatus.full_stack.total
              }
              title={
                !prefetchStatus.full_stack?.done ||
                  prefetchStatus.full_stack.count <
                  prefetchStatus.full_stack.total
                  ? 'Please prepare sealed envelopes first…'
                  : undefined
              }
            >
              Start Match One Trials
            </button>
          </div>
        </div>
      )}

      {step === 'breathe-spoon' && (
        <div className="breathe-step">
          <div className="breathing-circle" aria-hidden="true" />
          <div
            className="instructions"
            dangerouslySetInnerHTML={{
              __html: spoonLoveBlock?.preInstructions || '',
            }}
          />

          {/* Prefetch sealed envelopes for QUANTUM */}
          <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
            {isPrefetching.spoon_love ? (
              <EnvelopeLoader
                label={`Drawing sealed envelopes… ${prefetchStatus.spoon_love.count}/${prefetchStatus.spoon_love.total}`}
              />
            ) : (
              <button
                className={
                  prefetchStatus.spoon_love.done
                    ? 'secondary-btn looks-disabled'
                    : 'primary-btn'
                }
                onClick={async () => {
                  if (prefetchStatus.spoon_love.done) return;
                  await prefetchBlock('spoon_love');
                  const runId = await ensureRunDoc();
                  let tokenResp = null;
                  try {
                    const res = await fetch(
                      '/.netlify/functions/preblock-commit-key',
                      {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                          session_id: sessionId,
                          block: 'spoon_love',
                        }),
                      }
                    );
                    const j = await res.json().catch(() => ({}));
                    if (!res.ok || !j?.success || !j.commit_token) {
                      alert(
                        'Failed to create quantum commit: ' +
                        (j?.error || `HTTP ${res.status}`)
                      );
                      return;
                    }
                    tokenResp = j;
                    spoonCommitTokenRef.current = j.commit_token;
                  } catch (e) {
                    alert(
                      'Network error creating quantum commit: ' +
                      String(e)
                    );
                    return;
                  }

                  try {
                    await setDoc(
                      doc(
                        db,
                        'experiment1_responses',
                        runId,
                        'commits',
                        'spoon_love_stateless'
                      ),
                      {
                        session_id: sessionId,
                        block: 'spoon_love',
                        commit_token: tokenResp.commit_token,
                        commit_hash: tokenResp.commit_hash || null,
                        created_at: serverTimestamp(),
                      },
                      { merge: true }
                    );
                  } catch (e) {
                    console.warn(
                      'commit token save failed (continuing):',
                      e
                    );
                  }

                  await prefetchBlock('spoon_love');
                }}
                disabled={
                  isPrefetching.spoon_love ||
                  prefetchStatus.spoon_love.done
                }
                aria-disabled={
                  isPrefetching.spoon_love ||
                  prefetchStatus.spoon_love.done
                }
                title={
                  prefetchStatus.spoon_love.done
                    ? 'Sealed envelopes ready'
                    : undefined
                }
              >
                <span className="btn-icon">
                  <svg
                    className="btn-envelope"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path
                      d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2
                 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 2v.01L12 13
                 4 6.01V6h16ZM4 18V8l8 7 8-7v10H4Z"
                    />
                  </svg>
                  <span>Draw Your Sealed Envelopes</span>
                </span>
              </button>
            )}
            <div style={{ fontSize: 12, opacity: 0.8 }}>
              Envelopes ready: {prefetchStatus.spoon_love.count}/
              {prefetchStatus.spoon_love.total}
              {prefetchStatus.spoon_love.count <
                prefetchStatus.spoon_love.total ? (
                <span>
                  {' '}
                  — please click “Draw Your Sealed Envelopes” again.
                </span>
              ) : null}
            </div>

            <button
              className="primary-btn"
              onClick={async () => {
                const ps = prefetchStatus.spoon_love;
                if (
                  isPrefetching.spoon_love ||
                  !ps?.done ||
                  ps.count < ps.total
                ) {
                  return;
                }
                await startTrials(1);
              }}
              disabled={
                isPrefetching.spoon_love ||
                !prefetchStatus.spoon_love?.done ||
                prefetchStatus.spoon_love.count <
                prefetchStatus.spoon_love.total
              }
              aria-disabled={
                isPrefetching.spoon_love ||
                !prefetchStatus.spoon_love?.done ||
                prefetchStatus.spoon_love.count <
                prefetchStatus.spoon_love.total
              }
              title={
                !prefetchStatus.spoon_love?.done ||
                  prefetchStatus.spoon_love.count <
                  prefetchStatus.spoon_love.total
                  ? 'Please prepare sealed envelopes first…'
                  : undefined
              }
            >
              Start Match Two Trials
            </button>
          </div>
        </div>
      )}

      {step === 'breathe-client' && (
        <div className="breathe-step">
          <div className="breathing-circle" aria-hidden="true" />
          <div
            className="instructions"
            dangerouslySetInnerHTML={{
              __html:
                clientLocalBlock?.preInstructions ||
                'Get ready for the client-local trials. Targets will be sealed when you draw envelopes.',
            }}
          />

          {/* Prefetch sealed envelopes for CLIENT-LOCAL */}
          <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
            {isPrefetching.client_local ? (
              <EnvelopeLoader
                label={`Drawing sealed envelopes… ${prefetchStatus.client_local.count}/${prefetchStatus.client_local.total}`}
              />
            ) : (
              <button
                className={
                  prefetchStatus.client_local.done
                    ? 'secondary-btn looks-disabled'
                    : 'primary-btn'
                }
                onClick={() => {
                  if (!prefetchStatus.client_local.done)
                    prefetchBlock('client_local');
                }}
                disabled={
                  isPrefetching.client_local ||
                  prefetchStatus.client_local.done
                }
                aria-disabled={
                  isPrefetching.client_local ||
                  prefetchStatus.client_local.done
                }
                title={
                  prefetchStatus.client_local.done
                    ? 'Sealed envelopes ready'
                    : undefined
                }
              >
                <span className="btn-icon">
                  <svg
                    className="btn-envelope"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path
                      d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2
                 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 2v.01L12 13
                 4 6.01V6h16ZM4 18V8l8 7 8-7v10H4Z"
                    />
                  </svg>
                  <span>Draw Your Sealed Envelopes</span>
                </span>
              </button>
            )}

            {/* Status line */}
            <div style={{ fontSize: 12, opacity: 0.8 }}>
              Envelopes ready: {prefetchStatus.client_local.count}/
              {prefetchStatus.client_local.total}
              {prefetchStatus.client_local.count <
                prefetchStatus.client_local.total ? (
                <span>
                  {' '}
                  — please click “Draw Your Sealed Envelopes” again.
                </span>
              ) : null}
            </div>

            {/* Start */}
            <button
              className={`primary-btn ${!prefetchStatus.client_local?.done ||
                prefetchStatus.client_local.count <
                prefetchStatus.client_local.total
                ? 'looks-disabled'
                : ''
                }`}
              onClick={async () => {
                const ps = prefetchStatus.client_local;
                if (
                  isPrefetching.client_local ||
                  !ps?.done ||
                  ps.count < ps.total
                ) {
                  return;
                }
                await startTrials(2);
              }}
              disabled={
                isPrefetching.client_local ||
                !prefetchStatus.client_local?.done ||
                prefetchStatus.client_local.count <
                prefetchStatus.client_local.total
              }
              aria-disabled={
                isPrefetching.client_local ||
                !prefetchStatus.client_local?.done ||
                prefetchStatus.client_local.count <
                prefetchStatus.client_local.total
              }
              title={
                !prefetchStatus.client_local?.done ||
                  prefetchStatus.client_local.count <
                  prefetchStatus.client_local.total
                  ? 'Please prepare sealed envelopes first…'
                  : undefined
              }
            >
              Start Match Three Trials
            </button>
          </div>
        </div>
      )}

      {step === 'trials' && (
        <>
          <h2>
            Trial {currentTrial + 1} of{' '}
            {totalTrialsFor(currentBlockId)}
          </h2>

          {(() => {
            const totalRounds = calcTotalMatches(
              totalTrialsFor(currentBlockId)
            );
            const currentRound =
              Math.floor(currentTrial / MATCH_SIZE) + 1;
            return (

              <div
                style={{
                  fontSize: '0.9em',
                  marginTop: '-0.5rem',
                  marginBottom: '0.75rem',
                  opacity: 0.8,
                }}
              >
                Round {currentRound} of {totalRounds}
                <div style={{ fontSize: '0.75em', opacity: 0.7 }}>
                  {MATCH_SIZE} Trials = 1 Round
                </div>
              </div>
            );
          })()}

          <div
            className="instructions"
            dangerouslySetInnerHTML={{
              __html: (
                currentBlockObj?.trialInstructions ||
                'Tap the symbol you feel is right.'
              ).replaceAll(
                '{{ISSUE_MAILTO}}',
                buildIssueMailto(sessionId)
              ),
            }}
          />

          {!trialReady && !trialBlockingError && (
            <p style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
              Preparing trial…
            </p>
          )}

          {trialBlockingError && (
            <div
              role="alert"
              style={{
                margin: '8px 0',
                padding: 8,
                background: '#fff3cd',
                border: '1px solid #ffeeba',
                borderRadius: 4,
              }}
            >
              <div style={{ marginBottom: 6 }}>
                {trialBlockingError}
              </div>
              <button
                className="secondary-btn"
                onClick={() =>
                  prepareTrial(
                    currentTrial,
                    exp1DocId,
                    currentBlockId
                  )
                }
              >
                Retry preparing this trial
              </button>
            </div>
          )}

          {/* Between-round summary card */}
          {matchSummary && (
            <div className="match-summary">
              {(() => {
                // Round numbers (supports old/new field names)
                const roundNum =
                  matchSummary.roundNumber ??
                  matchSummary.matchNumber;
                const totalRounds = calcTotalMatches(
                  totalTrialsFor(currentBlockId)
                );

                // Win = 3+ hits this round
                const isWin =
                  (matchSummary.subjectPts ?? 0) >= MATCH_SIZE - 2; // 3/5

                // Totals so far in this block
                const rows = trialResults.filter(
                  (t) => t.block_type === currentBlockId
                );
                const hitsSoFar = rows.reduce(
                  (a, r) =>
                    a +
                    (Number(r.subject_hit) === 1
                      ? 1
                      : Number(r.matched) === 1
                        ? 1
                        : 0),
                  0
                );

                const totalTrialsPlanned =
                  totalTrialsFor(currentBlockId);
                const pct =
                  totalTrialsPlanned > 0
                    ? (
                      (hitsSoFar / totalTrialsPlanned) *
                      100
                    ).toFixed(1)
                    : '0.0';

                // Round wins so far (completed rounds only)
                const totalRoundWins = roundsTally.wins;

                const cta = matchSummary.isLastRound
                  ? 'Continue'
                  : 'Play Next Round';

                return (
                  <>
                    <div className="match-summary__title">
                      Round {roundNum} of {totalRounds}
                    </div>

                    <div
                      className="match-summary__scoreline"
                      style={{ marginTop: 6 }}
                    >
                      <div>
                        You scored <b>{matchSummary.subjectPts}</b>{' '}
                        out of <b>5</b> this round.
                      </div>

                      <div style={{ marginTop: 4 }}>
                        {isWin
                          ? 'You won this round.'
                          : 'You lost this round.'}
                      </div>

                      <div style={{ marginTop: 4 }}>
                        Total round wins: <b>{totalRoundWins}</b> /{' '}
                        <b>{totalRounds}</b>
                      </div>

                      <div style={{ marginTop: 2 }}>
                        Total trial wins: <b>{hitsSoFar}</b> /{' '}
                        <b>{totalTrialsPlanned}</b> ({pct}%)
                      </div>
                    </div>

                    <button
                      className="primary-btn match-summary__cta"
                      onClick={async () => {
                        setMatchSummary(null);
                        if (matchSummary.isLastRound) {
                          // Last round of this block → compute p, maybe confetti, advance block
                          await completeBlockAfterLastRound(
                            currentBlockId
                          );
                        } else {
                          // Not last round → proceed to the very next trial
                          setCurrentTrial((c) => {
                            const next = c + 1;
                            prepareTrial(
                              next,
                              exp1DocId,
                              currentBlockId
                            );
                            return next;
                          });
                        }
                      }}
                    >
                      {cta}
                    </button>
                  </>
                );
              })()}
            </div>
          )}

          {/* Cards */}
          <div className="icon-options-wrapper">
            <div className="icon-options">
              {choiceOptions.map((icon, idx) => {
                const waiting = !trialReady;
                return (
                  <button
                    key={icon.id}
                    type="button"
                    className="icon-button"
                    aria-disabled={waiting}
                    onClick={() => {
                      if (!waiting) handleGuess(idx);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === ' ' || e.key === 'Enter') {
                        e.preventDefault();
                        if (!waiting) handleGuess(idx);
                      }
                    }}
                    style={{
                      opacity: 1,
                      color: '#000',
                      cursor: waiting ? 'default' : 'pointer',
                      pointerEvents: 'auto',
                      display: 'grid',
                      placeItems: 'center',
                    }}
                  >
                    <span
                      className="icon-symbol zener"
                      aria-hidden="true"
                      style={{
                        display: 'inline-block',
                        lineHeight: 0,
                      }}
                    >
                      {icon.element}
                    </span>
                    <span className="sr-only">{icon.id}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="bottom-feedback-slot" aria-live="polite">
            {!hasGuessedThisTrial || !lastResult ? (
              // Hide before any guess
              <div className="status-placeholder" aria-hidden="true">
                &nbsp;
              </div>
            ) : (
              <>
                <p className="aligned-line">
                  {lastResult.matched ? 'Correct ✅' : 'Incorrect ❌'}
                </p>
                {FB[currentBlockId].STAR && lastResult.matched ? (
                  <div className="star-burst">⭐</div>
                ) : null}
                {FB[currentBlockId].ALIGNED_TEXT ? (
                  <p className="alignment-feedback">
                    {(() => {
                      const blockResults = trialResults.filter(t => t.block_type === currentBlockId &&
                        t.target_index_0based !== null && t.target_index_0based !== undefined &&
                        t.selected_index !== null && t.selected_index !== undefined &&
                        t.ghost_index_0based !== null && t.ghost_index_0based !== undefined);
                      const hits = blockResults.filter(t => t.matched === 1).length;
                      const total = blockResults.length;
                      const pct = total > 0 ? (hits / total) * 100 : 0;
                      return ratingMessage(null, pct);
                    })()}
                  </p>
                ) : null}
                {FB[currentBlockId].SCORE ? (
                  <h3 className="score-line">
                    Score so far:{' '}
                    {
                      trialResults.filter(
                        (t) =>
                          t.block_type === currentBlockId &&
                          t.matched === 1
                      ).length
                    }{' '}
                    /{' '}
                    {
                      trialResults.filter(
                        (t) => t.block_type === currentBlockId
                      ).length
                    }
                  </h3>
                ) : null}
              </>
            )}
          </div>

          <button
            className="exit-button"
            onClick={() => setShowExitModal(true)}
            aria-label="Exit the study early and submit your selections"
            style={{ marginTop: 16 }}
          >
            🚪 Exit Study
          </button>
        </>
      )}

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
              background: '#fff',
              borderRadius: 8,
              maxWidth: 520,
              width: '100%',
              padding: 16,
              boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
            }}
          >
            <h3 id="exit-title" style={{ marginTop: 0 }}>
              Exit early — quick reason?
            </h3>
            <p style={{ marginTop: 0 }}>
              Totally optional, but helpful for improving the study.
            </p>

            <div style={{ display: 'grid', gap: 8 }}>
              {[
                ['time', 'Ran out of time'],
                ['tech', 'Technical/network issue'],
                ['interest', 'Lost interest'],
                ['fatigue', 'Felt tired / needed a break'],
                ['other', 'Other'],
              ].map(([value, label]) => (
                <label
                  key={value}
                  style={{ display: 'flex', gap: 8 }}
                >
                  <input
                    type="radio"
                    name="exit_reason"
                    value={value}
                    checked={exitReason === value}
                    onChange={() => setExitReason(value)}
                  />
                  {label}
                </label>
              ))}
            </div>

            <label style={{ display: 'block', marginTop: 12 }}>
              <span
                style={{
                  display: 'block',
                  fontSize: 12,
                  color: '#666',
                }}
              >
                Optional details
              </span>
              <textarea
                value={exitNotes}
                onChange={(e) => setExitNotes(e.target.value)}
                rows={3}
                style={{ width: '100%' }}
              />
            </label>

            <div
              style={{
                display: 'flex',
                gap: 8,
                justifyContent: 'flex-end',
                marginTop: 12,
              }}
            >
              <button
                className="secondary-btn"
                onClick={() => setShowExitModal(false)}
              >
                Never mind
              </button>
              <button
                className="primary-btn"
                onClick={async () => {
                  setShowExitModal(false);
                  await saveResults(true, {
                    reason: exitReason,
                    notes: exitNotes,
                  });
                  alert('Your progress was saved.');
                  setStep('done');
                }}
              >
                Save & Exit
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 'final-results' && spoonLoveStats && (
        <>
          <h2>Final Results (All 3 Blocks)</h2>
          <div>
            <p>
              <strong>Your Score:</strong>
            </p>

            {(() => {
              // Use ALL trials from all blocks
              const rows = trialResults;

              const hits = rows.reduce(
                (a, r) =>
                  a +
                  (Number(r.subject_hit) === 1
                    ? 1
                    : Number(r.matched) === 1
                      ? 1
                      : 0),
                0
              );

              // Planned total if someone exits weirdly early
              const plannedTotal =
                totalTrialsFor('full_stack') +
                totalTrialsFor('spoon_love') +
                totalTrialsFor('client_local');

              const total = rows.length || plannedTotal;
              const pct =
                total > 0 ? ((hits / total) * 100).toFixed(1) : '0.0';

              return (
                <p style={{ marginTop: 4, opacity: 0.85 }}>
                  Total trial wins: <b>{hits}</b> / <b>{total}</b> (
                  {pct}%)
                </p>
              );
            })()}

            {(() => {
              // Cumulative round wins across all blocks
              const rows = trialResults;
              const blocks = [
                'full_stack',
                'spoon_love',
                'client_local',
              ];

              let totalRoundWins = 0;
              let totalPlannedRounds = 0;

              for (const b of blocks) {
                const rs = rows.filter((t) => t.block_type === b &&
                  t.target_index_0based !== null && t.target_index_0based !== undefined &&
                  t.selected_index !== null && t.selected_index !== undefined &&
                  t.ghost_index_0based !== null && t.ghost_index_0based !== undefined);
                totalRoundWins += countAboveChanceRoundWins(
                  rs,
                  MATCH_SIZE
                ).wins;
                totalPlannedRounds += calcTotalMatches(
                  totalTrialsFor(b)
                );
              }

              return (
                <p style={{ opacity: 0.8 }}>
                  Total round wins (≥3/5): <b>{totalRoundWins}</b> /{' '}
                  <b>{totalPlannedRounds}</b>
                </p>
              );
            })()}

            {(() => {
              // One-sided binomial p-value on cumulative results vs p0=0.2
              const rows = trialResults;
              const hits = rows.reduce(
                (a, r) =>
                  a +
                  (Number(r.subject_hit) === 1
                    ? 1
                    : Number(r.matched) === 1
                      ? 1
                      : 0),
                0
              );
              const total = rows.length;
              const pValue =
                total > 0
                  ? binomPValueOneSidedAtOrAbove(hits, total, P0)
                  : NaN;

              return (
                <p style={{ opacity: 0.8 }}>
                  <em>One-sided p (X ≥ hits, p₀=20%):</em>{' '}
                  {formatP(pValue)}{' '}
                  {Number.isFinite(pValue) && pValue <= 0.05
                    ? '— Significant at 0.05'
                    : ''}
                </p>
              );
            })()}
          </div>

          {/* Optional qualitative message based on overall percent */}
          {(() => {
            const rows = trialResults;
            const hits = rows.reduce(
              (a, r) =>
                a +
                (Number(r.subject_hit) === 1
                  ? 1
                  : Number(r.matched) === 1
                    ? 1
                    : 0),
              0
            );
            const total = rows.length || 1;
            const pct = ((hits / total) * 100).toFixed(1);
            return <p>{ratingMessage(NaN, pct)}</p>;
          })()}

          <HighScoreEmailGate
            experiment="exp1"
            step="final-results"
            sessionId={sessionId}
            participantId={auth.currentUser?.uid ?? null}
            pValue={(() => {
              const rows = trialResults;
              const hits = rows.reduce(
                (a, r) =>
                  a +
                  (typeof r.matched === 'number'
                    ? r.matched
                    : Number(r.matched) === 1
                      ? 1
                      : 0),
                0
              );
              const total = rows.length;
              // exp1: 5 options = 20% chance, exp2/exp3: 2 options = 50% chance
              const chanceProb = 0.2; // This is for exp1
              return total > 0 ? binomPValueOneSidedAtOrAbove(hits, total, chanceProb) : 1;
            })()}
            finalPercent={(() => {
              const rows = trialResults;
              const hits = rows.reduce(
                (a, r) =>
                  a +
                  (typeof r.matched === 'number'
                    ? r.matched
                    : Number(r.matched) === 1
                      ? 1
                      : 0),
                0
              );
              const total = rows.length || 1;
              return ((hits / total) * 100);
            })()}
            spoonLoveStats={spoonLoveStats}
            fullStackStats={fullStackStats}
          />

          <hr style={{ margin: '1.5rem 0' }} />

          <div
            className="instructions"
            dangerouslySetInnerHTML={{
              __html:
                (spoonLoveBlock?.resultsMessage || '') +
                '<p style="opacity:0.8;margin-top:0.5rem">Scores shown above are cumulative across all three blocks.</p>',
            }}
          />

          <button onClick={() => setStep('post')}>
            Continue to Post-Experiment Questions
          </button>
        </>
      )}

      {step === 'post' && (
        <>
          <h2>Post-Experiment Questions</h2>
          {filteredPostQuestions
            .filter((q) => {
              if (!q.showIf) return true; // always show if no condition

              const parentAnswer = postResponses[q.showIf.id]; // user's answer to the parent question
              return q.showIf.values.includes(parentAnswer);
            })
            .map((q, i) => (
              <div key={q.id} className="question-block">
                <label htmlFor={q.id} className="question-label">
                  <strong>Q{i + 1}.</strong> {q.question}
                </label>
                <div className="answer-wrapper">
                  {renderInput(q, 'post')}
                </div>
              </div>
            ))}


          {(() => {
            const OPTIONAL_POST_IDS = new Set(['finalThoughts']);
            const postComplete = filteredPostQuestions
              .filter((q) => {
                // Only check required questions that are currently visible
                if (OPTIONAL_POST_IDS.has(q.id)) return false; // skip optional
                if (!q.showIf) return true; // always required if no condition
                const parentAnswer = postResponses[q.showIf.id];
                return q.showIf.values.includes(parentAnswer); // only if visible
              })
              .every((q) => isAnswered(q, postResponses));
            const onSubmit = async () => {
              if (!postComplete) return;

              // Ensure all postQuestions exist in final data
              const finalResponses = {};
              postQuestions.forEach((q) => {
                if (postResponses[q.id] !== undefined) {
                  finalResponses[q.id] = postResponses[q.id];
                } else {
                  finalResponses[q.id] = null; // store null for hidden/unanswered
                }
              });

              await saveResults(false); // completed successfully, not exited early
              alert('Responses saved!');
              setStep('done');
            };

            return (
              <>
                {!postComplete ? (
                  <p
                    style={{
                      fontSize: 12,
                      opacity: 0.75,
                      marginTop: 6,
                    }}
                  >
                    Please answer all questions before submitting.
                    Accurate, complete responses help the research.
                  </p>
                ) : null}
                <button
                  className={`primary-btn ${!postComplete ? 'looks-disabled' : ''
                    }`}
                  aria-disabled={!postComplete}
                  onClick={onSubmit}
                >
                  Submit
                </button>
              </>
            );
          })()}
        </>
      )}

      {step === 'done' && (
        <>
          <h2>Thank you for participating!</h2>
          <p>Your data has been submitted.</p>
          <p>
            Session ID: <code>{sessionId}</code>
          </p>
          <p>
            To keep the study fair and unbiased for future
            participants, we’re holding back full details until data
            collection is complete.
          </p>
          <ul>
            <li>Try again in different moods or mindsets.</li>
            <li>Make sure to save your Session ID to earn prizes.</li>
            <li>Share with friends—large datasets matter here.</li>
            <li>
              We’ll post a full debrief at{' '}
              <a href={DEBRIEF_URL}>{DEBRIEF_URL}</a> when the study
              closes.
            </li>
          </ul>
          <button
            onClick={() => window.location.reload()}
            className="primary-btn"
            style={{ marginTop: '1em' }}
          >
            Run It Again
          </button>
          <div className="cta-row">
            <a
              className="secondary-btn"
              href="mailto:h@whatthequark.com?subject=Experiment%20Results%20Updates"
            >
              Email me when results are posted
            </a>
          </div>
        </>
      )}
    </div>
  );
}

export default MainApp;