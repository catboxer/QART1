import React, { useState, useRef, useEffect, useMemo } from 'react';
import './App.css';
import FoldedSelfCheck from './FoldedSelfCheck.jsx';

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

/* =========================
   Helpers / UI primitives
   ========================= */

const SolidSquare = ({ size = 200, inset = 4 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 100 100"
    aria-hidden="true"
  >
    <rect
      x={inset}
      y={inset}
      width={100 - inset * 2}
      height={100 - inset * 2}
      fill="currentColor"
    />
  </svg>
);

const SolidCircle = ({ size = 200 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 100 100"
    aria-hidden="true"
  >
    <circle cx="50" cy="50" r="50" fill="currentColor" />
  </svg>
);

const ICONS = [
  { id: 'circle', element: <SolidCircle /> },
  { id: 'square', element: <SolidSquare /> },
];

const shuffledPair = () =>
  Math.random() < 0.5 ? ICONS : [ICONS[1], ICONS[0]];

// Map RNG pair-of-bytes to screen indices (0=left, 1=right) for primary & ghost
// Map Subject (raw_byte) + Demon (ghost_raw_byte) to left/right indices,
// while still alternating `primary_pos` as 1,2,1,2,... for integrity checks.
function assignFromBytes(rawByte, ghostByte, trialIndex1Based) {
  const primary_pos = trialIndex1Based % 2 === 1 ? 1 : 2; // 1,2,1,2,...
  const toIndex = (byte) => (byte % 2 === 0 ? 0 : 1); // even→left(0), odd→right(1)
  return {
    primaryIndex: toIndex(rawByte),
    ghostIndex: toIndex(ghostByte),
    primary_pos,
    primary_raw: rawByte >>> 0,
    ghost_raw: ghostByte >>> 0,
  };
}

const randomInt = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;
const getBlock = (id) => cueBlocks.find((b) => b.id === id);
const getLabel = (id) => getBlock(id)?.buttonLabel || 'RIGHT';

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
const binom50 = (N) => {
  const mu = N / 2;
  const sd = Math.sqrt(N) / 2;
  const r = (x) => Math.round(x);
  const sdPct = 50 / Math.sqrt(N);
  return {
    N,
    muHits: r(mu),
    sdHits: r(sd),
    oneHi: r(mu + sd),
    oneLo: r(mu - sd),
    twoHi: r(mu + 2 * sd),
    twoLo: r(mu - 2 * sd),
    sdPct,
  };
};
const allAnswered = (questions, responses) =>
  questions.every((q) => isAnswered(q, responses));
/* ===== Commit–reveal helpers ===== */
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
        {/* Paper slides in */}
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

        {/* Envelope body */}
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

        {/* Flap closes */}
        <g className="flap">
          <polygon points="8,12 56,12 32,28"></polygon>
        </g>

        {/* Wax seal pops */}
        <circle className="seal" cx="32" cy="26" r="3"></circle>
      </svg>
      <figcaption className="envelope-label">{label}</figcaption>
    </figure>
  );
}
// Return which trial indices we still need for this block (0..total-1)
function getMissingTrialIndices(blockId, total, assignmentCache) {
  const missing = [];
  const have = assignmentCache?.[blockId] || {};
  for (let i = 1; i <= total; i++) {
    if (!(i in have)) missing.push(i);
  }
  return missing;
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
    return () => {
      cancelled = true;
    };
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
    } catch {}
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
  const [currentBlockId, setCurrentBlockId] = useState('full_stack'); // explicit id to avoid races
  const [currentTrial, setCurrentTrial] = useState(0);
  const [lastResult, setLastResult] = useState(null);

  const [fullStackStats, setFullStackStats] = useState(null);
  const [spoonLoveStats, setSpoonLoveStats] = useState(null);

  // Two-choice task state
  const [choiceOptions, setChoiceOptions] = useState([]); // [leftIcon, rightIcon]
  const [correctIndex, setCorrectIndex] = useState(null); // 0 or 1
  const [ghostIndex, setGhostIndex] = useState(null); // 0 or 1
  const [rngMeta, setRngMeta] = useState(null);
  const [trialReady, setTrialReady] = useState(false);
  const [sealedEnvelopeId, setSealedEnvelopeId] = useState(null);
  const hasGuessedRef = useRef(false);
  const starTimerRef = useRef(null);
  const isSavingRef = useRef(false);
  const [trialBlockingError, setTrialBlockingError] = useState(null);
  // Prefetch/caching for sealed envelopes
  const [assignmentCache, setAssignmentCache] = useState({
    full_stack: null, // { 1: {assigned, rngMeta}, 2: {...}, ... }
    spoon_love: null,
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
  });
  const [isPrefetching, setIsPrefetching] = useState({
    full_stack: false,
    spoon_love: false,
  });

  // One pre-drawn tape per block (each trial uses 2 bytes: primary + ghost)
  const tapesRef = useRef({}); // { [blockId]: { pairs:Uint8Array, saltHex, hashHex, createdISO, rng_source } }

  // Blocks / trials config
  const fullStackBlock = cueBlocks.find((b) => b.id === 'full_stack');
  const spoonLoveBlock = cueBlocks.find((b) => b.id === 'spoon_love');
  const blockOrder = [
    { ...fullStackBlock, id: 'full_stack', showFeedback: true },
    { ...spoonLoveBlock, id: 'spoon_love', showFeedback: true },
  ];
  const trialsPerBlock = config.trialsPerBlock;
  const currentBlockObj = getBlock(currentBlockId);
  // Use server-provided total if available; otherwise fall back to config
  const totalTrialsFor = (blockId) => {
    const fromServer = prefetchStatus?.[blockId]?.total;
    return Number.isFinite(Number(fromServer))
      ? Number(fromServer)
      : Number(trialsPerBlock[blockId]);
  };

  const totalTrialsPerBlock = totalTrialsFor(currentBlockId);

  // Priming/boost visuals (baseline block only)
  const [isHighPrime] = useState(() => Math.random() < 0.5);
  const BOOST_MIN = Number(config.BOOST_MIN);
  const BOOST_MAX = Number(config.BOOST_MAX);

  // Confetti thresholds
  const CONFETTI_THRESHOLD_BASELINE = Number(
    config.confetti.baseline
  );
  const CONFETTI_THRESHOLD_QUANTUM = Number(config.confetti.quantum);

  // Feedback switches
  const FB = {
    full_stack: { STAR: false, ALIGNED_TEXT: false, SCORE: false },
    spoon_love: { STAR: false, ALIGNED_TEXT: false, SCORE: false },
  };

  // Early exit modal
  const [showExitModal, setShowExitModal] = useState(false);
  const [exitReason, setExitReason] = useState('time');
  const [exitNotes, setExitNotes] = useState('');

  useEffect(() => {
    return () => {
      if (starTimerRef.current) clearTimeout(starTimerRef.current);
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

  const statsQuantum = useMemo(
    () => binom50(trialsPerBlock.spoon_love),
    [trialsPerBlock.spoon_love]
  );
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

  // Ensure we have ONE parent run document for both blocks (create once; reuse)
  async function ensureRunDoc() {
    if (exp1DocId) return exp1DocId;
    await ensureSignedIn();
    const participant_id = auth.currentUser?.uid ?? null;
    const mainRef = await addDoc(
      collection(db, 'experiment1_responses'),
      {
        participant_id,
        session_id: sessionId,
        app_version: appVersion,
        created_at: serverTimestamp(),
      }
    );
    const parentId = mainRef.id;

    // Make sure participant_id is present & visible before sub-writes
    await setDoc(
      doc(db, 'experiment1_responses', parentId),
      { participant_id },
      { merge: true }
    );

    // tiny settle
    try {
      await getDoc(doc(db, 'experiment1_responses', parentId));
    } catch (_) {}
    setExp1DocId(parentId);
    return parentId;
  }

  // Pre-generate & store sealed envelopes for a whole block, plus local cache
  const prefetchBlock = async (blockId) => {
    // prevent double-run
    if (isPrefetching?.[blockId] || prefetchStatus?.[blockId]?.done)
      return;

    try {
      setIsPrefetching((p) => ({ ...p, [blockId]: true }));
      setPrefetchStatus((s) => ({
        ...s,
        [blockId]: { total: 0, count: 0, done: false },
      }));

      // ONE call: server decides how many trials (1..100) for this session+block
      const res = await fetch('/.netlify/functions/envelopes-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId, // keep
          block: blockId, // the function accepts block or blockId
          // optional flags—fine to include or omit:
          allocate_all: true,
          domain_separation: true,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(
          `Batch fetch failed (${res.status}): ${text}`
        );
      }

      const payload = await res.json();
      // Expected shape:
      // {
      //   batch_id, rng_source, server_time,
      //   total, // integer 1..100
      //   envelopes: [
      //     { trial_index, raw_byte, ghost_raw_byte, qrng_code }
      //   ]
      // }

      const envs = Array.isArray(payload.envelopes)
        ? payload.envelopes
        : [];
      const total = Number.isFinite(payload.total)
        ? payload.total
        : envs.length;

      const missing = getMissingTrialIndices(
        blockId,
        total,
        assignmentCache
      );

      // Cache and (optionally) persist sealed docs
      let wrote = 0;
      setAssignmentCache((prev) => {
        const next = { ...prev };
        next[blockId] = next[blockId] ? { ...next[blockId] } : {};

        for (const e of envs) {
          const i = e.trial_index;
          if (!missing.includes(i)) continue; // skip already-filled slots

          next[blockId][i] = {
            assigned: null, // prepareTrial will set this later
            raw_byte: e.raw_byte, // Subject stream
            ghost_raw_byte: e.ghost_raw_byte, // Demon stream
            rngMeta: {
              source: payload.rng_source || 'qrng_api',
              server_time: payload.server_time || Date.now(),
              batch_id: payload.batch_id || null,
              qrng_code: e.qrng_code ?? null,
            },
          };

          // If you already write a sealed doc per trial, uncomment & drop your write here:
          // const sealedId = `${sessionId}-${blockId}-${i}`;
          // writes.push(
          //   setDoc(doc(db, 'sealed_envelopes', sealedId), {
          //     sessionId, blockId, trial_index: i,
          //     raw_byte: e.raw_byte, ghost_raw_byte: e.ghost_raw_byte,
          //     rng_source: payload.rng_source || 'qrng_api',
          //     server_time: payload.server_time || Date.now(),
          //     qrng_code: e.qrng_code ?? null,
          //     batch_id: payload.batch_id || null,
          //   }, { merge: true })
          // );

          wrote += 1;
        }
        return next;
      });
      // ---- Build a commit-reveal tape for this block ----
      try {
        // Order by trial_index and pack Subject/Demon bytes as pairs
        const ordered = [...envs].sort(
          (a, b) => a.trial_index - b.trial_index
        );
        const pairs = new Uint8Array(total * 2);
        for (const e of ordered) {
          const i0 = (e.trial_index - 1) * 2;
          pairs[i0] = (e.raw_byte >>> 0) & 0xff; // Subject byte
          pairs[i0 + 1] = (e.ghost_raw_byte >>> 0) & 0xff; // Demon byte
        }

        // 16-byte random salt
        const salt = new Uint8Array(16);
        crypto.getRandomValues(salt);

        // Commit = SHA-256(salt || pairs)
        const hashHex = await sha256Hex(concatBytes(salt, pairs));
        const saltHex = bytesToHex(salt);

        // Cache locally so the end-of-block reveal writer can use it
        tapesRef.current[blockId] = {
          pairs,
          saltHex,
          hashHex,
          createdISO: new Date().toISOString(),
          rng_source: payload.rng_source || 'qrng_api',
        };
      } catch (e) {
        console.warn(
          'Failed to build commit-reveal tape (continuing):',
          e
        );
      }

      // If you collect `writes`, finish them here:
      // if (writes.length) await Promise.all(writes);

      setPrefetchStatus((s) => ({
        ...s,
        [blockId]: { total, count: wrote, done: true },
      }));
    } catch (err) {
      console.error(err);
      window.alert(
        'Failed to draw sealed envelopes. Please try again.\n' +
          (err?.message || err)
      );
      setPrefetchStatus((s) => ({
        ...s,
        [blockId]: { total: 0, count: 0, done: false },
      }));
    } finally {
      setIsPrefetching((p) => ({ ...p, [blockId]: false }));
    }
  };

  /* =========================
     Trial lifecycle
     ========================= */

  const [exp1DocId, setExp1DocId] = useState(null);

  const startTrials = async (index = 0) => {
    const blockId = blockOrder[index].id;
    setCurrentBlockId(blockId);
    if (index === 0) setTrialResults([]); // clear at beginning of FIRST block
    setCurrentTrial(0);
    setLastResult(null);

    // Reuse/create a single parent run document for BOTH blocks
    const parentId = await ensureRunDoc();

    setStep('trials');
    await prepareTrial(0, parentId, blockId); // avoid state race by passing blockId
  };

  async function prepareTrial(
    nextTrialIndex = 0,
    parentId = exp1DocId,
    activeBlockId = currentBlockId
  ) {
    // Disable until sealed envelope is written; reset one-click guard
    setTrialReady(false);
    setSealedEnvelopeId(null);
    hasGuessedRef.current = false;
    setTrialBlockingError(null);

    const trialNum = nextTrialIndex + 1;

    // Show icons in random left/right order
    const pair = shuffledPair();
    setChoiceOptions(pair);

    // RNG pair / assignment for this trial
    let assigned, source, server_time;

    const cached = assignmentCache[activeBlockId]?.[trialNum];
    if (cached) {
      const assignedNow = assignFromBytes(
        cached.raw_byte,
        cached.ghost_raw_byte,
        trialNum
      );

      // optional: store back so next time it's already there
      setAssignmentCache((prev) => {
        const next = { ...prev };
        next[activeBlockId] = { ...(next[activeBlockId] || {}) };
        next[activeBlockId][trialNum] = {
          ...(next[activeBlockId][trialNum] || {}),
          assigned: assignedNow,
        };
        return next;
      });

      assigned = assignedNow;
      source = cached.rngMeta.source;
      server_time = cached.rngMeta.server_time;

      const sealedId = `${sessionId}-${activeBlockId}-${trialNum}`;

      // Write sealed envelope on first use of cached assignment
      if (parentId) {
        try {
          const sealedRef = doc(
            db,
            `experiment1_responses/${parentId}/sealed_envelope/${sealedId}`
          );
          await setDoc(
            sealedRef,
            {
              session_id: sessionId,
              app_version: appVersion,
              block_type: activeBlockId,
              trial_index: trialNum,
              rng_source: source,
              server_time,
              pair_rule: 'alternate',
              primary_pos: assignedNow.primary_pos,
              raw_byte: assignedNow.primary_raw,
              ghost_raw_byte: assignedNow.ghost_raw,
              primary_is_right:
                assignedNow.primaryIndex === 1 ? 1 : 0,
              ghost_is_right: assignedNow.ghostIndex === 1 ? 1 : 0,
              created_at: serverTimestamp(),
            },
            { merge: false }
          );
        } catch (e) {
          console.warn('[sealed_envelope] cached-write failed:', e);
        }
      }

      setSealedEnvelopeId(sealedId);
    } else {
      // No cache → fetch now (old behavior), then write sealed doc
      if (activeBlockId === 'full_stack') {
        const res = await getPrngPairOrThrow();
        source = res.source || 'random_org';
        server_time = res.server_time ?? null;
        assigned = assignFromBytes(
          res.bytes[0],
          res.bytes[1],
          trialNum
        );
      } else {
        const res = await getQuantumPairOrThrow();
        source = res.source || 'qrng';
        server_time = res.server_time ?? null;
        assigned = assignFromBytes(
          res.bytes[0],
          res.bytes[1],
          trialNum
        );
      }

      // Write the sealed envelope now (idempotent: same ID per trial)
      if (!parentId) {
        console.warn(
          'exp1DocId not ready; skipping sealed_envelope for this trial'
        );
        return;
      }
      const sealedId = `${sessionId}-${activeBlockId}-${trialNum}`;
      const sealedRef = doc(
        db,
        `experiment1_responses/${parentId}/sealed_envelope/${sealedId}`
      );
      const payload = {
        session_id: sessionId,
        app_version: appVersion,
        block_type: activeBlockId,
        trial_index: trialNum,
        rng_source: source,
        server_time,
        pair_rule: 'alternate',
        primary_pos: assigned.primary_pos,
        raw_byte: assigned.primary_raw,
        ghost_raw_byte: assigned.ghost_raw,
        primary_is_right: assigned.primaryIndex === 1 ? 1 : 0,
        ghost_is_right: assigned.ghostIndex === 1 ? 1 : 0,
        created_at: serverTimestamp(),
      };

      try {
        await setDoc(sealedRef, payload, { merge: false });
      } catch (e) {
        console.error(
          '[sealed_envelope] write failed',
          sealedRef.path,
          e
        );
        return; // keep disabled
      }
      setSealedEnvelopeId(sealedId);
    }

    // Expose indices/meta & enable guessing
    setCorrectIndex(assigned.primaryIndex);
    setGhostIndex(assigned.ghostIndex);
    setRngMeta({
      source,
      server_time,
      pair_rule: 'alternate',
      primary_pos: assigned.primary_pos,
      raw_byte: assigned.primary_raw,
      ghost_raw_byte: assigned.ghost_raw,
    });
    setTrialReady(true);
  }
  async function handleGuess(selectedIndex) {
    // must be ready, must have a sealed envelope, and must not have guessed yet
    if (!trialReady || !sealedEnvelopeId || hasGuessedRef.current)
      return;
    hasGuessedRef.current = true;

    if (
      choiceOptions.length !== 2 ||
      correctIndex == null ||
      ghostIndex == null
    )
      return;

    const blockId = currentBlockId;
    const totalThisBlock =
      (prefetchStatus?.[blockId]?.total &&
        Number(prefetchStatus[blockId].total)) ||
      Number(trialsPerBlock[blockId]);

    const press_start_ts = new Date().toISOString();

    // Did the participant guess the RNG's target?
    const matched = selectedIndex === correctIndex ? 1 : 0;
    const correctSide = correctIndex === 1 ? 'right' : 'left';
    // NEW: per-trial correctness flags
    const subject_hit = matched; // subject is "right" iff matched
    const demon_hit = selectedIndex === ghostIndex ? 1 : 0;

    const logRow = {
      session_id: sessionId,
      app_version: appVersion,
      condition: isHighPrime ? 'primed' : 'control',
      block_type: blockId,
      agent: robotMode ? 'robot' : 'human',
      timing_arm: timingArm,
      trial_index: currentTrial + 1,

      sealed_envelope_id: sealedEnvelopeId,

      press_time: press_start_ts,
      press_start_ts,
      press_release_ts: new Date().toISOString(),
      hold_duration_ms: null,
      subject_hit,
      demon_hit,
      rng_source: rngMeta?.source,
      raw_byte: rngMeta?.raw_byte ?? null,
      qrng_code: correctIndex === 1 ? 2 : 1, // 1=LEFT, 2=RIGHT
      qrng_label: correctSide,
      primary_is_right: correctIndex === 1 ? 1 : 0,
      qrng_server_time: rngMeta?.server_time ?? null,

      ghost_raw_byte: rngMeta?.ghost_raw_byte ?? null,
      ghost_qrng_code: ghostIndex === 1 ? 2 : 1,
      ghost_is_right: ghostIndex === 1 ? 1 : 0,

      pair_rule: rngMeta?.pair_rule,
      primary_pos: rngMeta?.primary_pos,

      options: choiceOptions.map((o) => o.id),
      selected_index: selectedIndex,
      selected_id: choiceOptions[selectedIndex].id,

      matched,
    };

    const updatedTrials = [...trialResults, logRow];
    setTrialResults(updatedTrials);

    // Append-only log
    if (exp1DocId && sealedEnvelopeId) {
      try {
        await addDoc(
          collection(db, `experiment1_responses/${exp1DocId}/logs`),
          {
            session_id: logRow.session_id,
            block_type: logRow.block_type,
            trial_index: logRow.trial_index,
            press_time: logRow.press_time,
            press_start_ts: logRow.press_start_ts,
            press_release_ts: logRow.press_release_ts,
            hold_duration_ms: logRow.hold_duration_ms,
            timing_arm: logRow.timing_arm,
            subject_hit: logRow.subject_hit,
            demon_hit: logRow.demon_hit,
            agent: logRow.agent,
            qrng_code: logRow.qrng_code,
            qrng_label: logRow.qrng_label,
            primary_is_right: logRow.primary_is_right,
            ghost_qrng_code: logRow.ghost_qrng_code ?? null,
            ghost_is_right: logRow.ghost_is_right ?? null,
            primary_pos: logRow.primary_pos,
            rng_source: logRow.rng_source || null,
            raw_byte: logRow.raw_byte ?? null,
            ghost_raw_byte: logRow.ghost_raw_byte ?? null,
            sealed_envelope_id: logRow.sealed_envelope_id,
            created_at: serverTimestamp(),
          }
        );
      } catch (e) {
        console.warn('guess log write failed', e);
      }
    }

    // Optional visual feedback
    if (FB[blockId]?.STAR && matched) {
      if (starTimerRef.current) clearTimeout(starTimerRef.current);
      setLastResult({ correct: correctSide, matched });
      starTimerRef.current = setTimeout(
        () => setLastResult(null),
        1000
      );
    } else {
      setLastResult({ correct: correctSide, matched });
    }

    // End-of-block?
    const countThisBlock = updatedTrials.filter(
      (t) => t.block_type === blockId
    ).length;
    if (countThisBlock === totalThisBlock) {
      const userCorrect = updatedTrials.filter(
        (t) => t.block_type === blockId && t.matched === 1
      ).length;
      const realPercent = (userCorrect / totalThisBlock) * 100;
      // Reveal the tape now so the commit can be verified
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
              commit_hash_hex: tape.hashHex, // echo for convenience
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

      if (blockId === 'full_stack') {
        // control (not primed): show the true score, no floor/boost
        const basePercent = realPercent;
        let displayed = basePercent;
        let boost = 0;

        // primed: apply optional boost + floor
        // primed: apply conditional boost + random floor (60–70)
        if (isHighPrime) {
          const min = Number.isFinite(Number(BOOST_MIN))
            ? Number(BOOST_MIN)
            : 0;
          const max = Number.isFinite(Number(BOOST_MAX))
            ? Number(BOOST_MAX)
            : 0;

          // Random floor between 60 and 70 for the displayed score
          const floorRand = randomInt(60, 70);

          // Pick boost size based on performance:
          // - below 60 → give max boost
          // - 60 or above → give min boost
          if (max >= min) {
            boost = basePercent < 60 ? max : min;
            displayed = Math.min(
              Math.max(basePercent + boost, floorRand),
              100
            );
          } else {
            // If config is weird (max < min), just apply floor
            displayed = Math.min(
              Math.max(basePercent, floorRand),
              100
            );
          }
        }

        // Use boosted display for primed baseline, real score otherwise
        const confettiMetric = isHighPrime ? displayed : basePercent;
        if (confettiMetric >= CONFETTI_THRESHOLD_BASELINE) {
          fireConfettiSafely();
        }

        setFullStackStats({
          userPercent: displayed.toFixed(1),
          basePercent: basePercent.toFixed(1),
          boostAmount: boost,
          boosted: !!(isHighPrime && boost !== 0),
          confettiMetric: confettiMetric.toFixed(1), // <- optional
        });

        setStep('fullstack-results');
      } else {
        if (realPercent > CONFETTI_THRESHOLD_QUANTUM)
          fireConfettiSafely();
        setSpoonLoveStats({ userPercent: realPercent.toFixed(1) });
        setStep('final-results');
      }
      return;
    }

    // Next trial
    setCurrentTrial((c) => {
      const next = c + 1;
      prepareTrial(next, exp1DocId, currentBlockId);
      return next;
    });
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
        const guess = Math.random() < 0.5 ? 0 : 1;
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
    if (isSavingRef.current) return; // prevent double-taps
    isSavingRef.current = true;

    await ensureSignedIn();
    const uid = auth.currentUser?.uid ?? null;

    const devNotify = (msg) => {
      if (process.env.NODE_ENV !== 'production') {
        try {
          alert(msg);
        } catch (_) {}
      } else {
        console.warn(msg);
      }
    };

    const fsTrials = trialResults.filter(
      (t) => t.block_type === 'full_stack'
    );
    const slTrials = trialResults.filter(
      (t) => t.block_type === 'spoon_love'
    );

    // --- helpers — robust extraction with backfills for older rows ---
    const getSubjectHit = (r) => {
      if (typeof r.subject_hit === 'number') return r.subject_hit;
      if (typeof r.matched === 'number') return r.matched; // older rows
      // last-resort backfill if needed:
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
      if (typeof r.demon_hit === 'number') return r.demon_hit;
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

    // --- FULL STACK (baseline) ---
    const fsSub = fsTrials
      .map(getSubjectHit)
      .filter((v) => v != null);
    const fsDem = fsTrials.map(getDemonHit).filter((v) => v != null);
    const fsN = Math.min(fsSub.length, fsDem.length) || 0;

    const fsHits = sum(fsSub);
    const fsDemonHits = sum(fsDem);

    const fsRealPct = fsN
      ? Number(((fsHits / fsN) * 100).toFixed(1))
      : null;
    const fsGhostPct = fsN
      ? Number(((fsDemonHits / fsN) * 100).toFixed(1))
      : null;
    const fsDeltaPct =
      fsRealPct != null && fsGhostPct != null
        ? Number((fsRealPct - fsGhostPct).toFixed(1))
        : null;

    // displayed (possibly boosted/floored) baseline percent shown to the user
    const fsDisplayedPct =
      fullStackStats?.userPercent != null
        ? Number(fullStackStats.userPercent)
        : null;

    // paired n10/n01 on overlapping indices only
    let fsN10 = 0,
      fsN01 = 0;
    for (let i = 0; i < fsN; i++) {
      const s = fsSub[i],
        d = fsDem[i];
      if (s === 1 && d === 0) fsN10++;
      else if (s === 0 && d === 1) fsN01++;
    }

    // --- SPOON LOVE (quantum) ---
    const slSub = slTrials
      .map(getSubjectHit)
      .filter((v) => v != null);
    const slDem = slTrials.map(getDemonHit).filter((v) => v != null);
    const slN = Math.min(slSub.length, slDem.length) || 0;

    const slHits = sum(slSub);
    const slDemonHits = sum(slDem);

    const slRealPct = slN
      ? Number(((slHits / slN) * 100).toFixed(1))
      : null;
    const ghostPct = slN
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

    const sessionSummary = {
      session_id: sessionId,
      app_version: appVersion,
      assignment: { primed: isHighPrime },
      consent: {
        version: CONSENT_VERSION,
        consented: !!consentAgree,
        age_over_18: !!consent18,
        partial_disclosure_ack: true,
        debrief_url: DEBRIEF_URL,
        timestamp: new Date().toISOString(),
      },
      preResponses,
      mid_survey: midResponses,
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
      exitedEarly,
      exit_reason: exitedEarly
        ? earlyExitInfo?.reason || 'unspecified'
        : null,
      exit_reason_notes: exitedEarly
        ? earlyExitInfo?.notes || null
        : null,
      timestamp: new Date().toISOString(),
    };

    // minimalizer (mirrors log shape)
    const toMinimalTrial = (r) => ({
      session_id: r.session_id,
      sealed_envelope_id: r.sealed_envelope_id ?? null,
      block_type: r.block_type,
      trial_index: r.trial_index,
      press_time: r.press_time,
      press_start_ts: r.press_start_ts ?? r.press_time ?? null,
      press_release_ts: r.press_release_ts ?? null,
      hold_duration_ms: r.hold_duration_ms ?? null,
      timing_arm: r.timing_arm ?? null,
      agent: r.agent ?? null,

      // side codes / allocation flags
      qrng_code: r.qrng_code,
      qrng_label: r.qrng_label,
      primary_is_right: r.primary_is_right,
      ghost_qrng_code: r.ghost_qrng_code ?? null,
      ghost_is_right: r.ghost_is_right ?? null,
      primary_pos: r.primary_pos,

      // RNG meta + raw bytes
      rng_source: r.rng_source || null,
      raw_byte: r.raw_byte ?? null,
      ghost_raw_byte: r.ghost_raw_byte ?? null,

      // NEW: correctness flags
      subject_hit:
        typeof r.subject_hit === 'number'
          ? r.subject_hit
          : typeof r.matched === 'number'
          ? r.matched
          : null,
      demon_hit: typeof r.demon_hit === 'number' ? r.demon_hit : null,
    });

    const fsTrialsMin = fsTrials.map((r, idx, arr) => {
      const primary =
        typeof r.primary_is_right === 'number'
          ? r.primary_is_right
          : r.qrng_label
          ? r.qrng_label === 'right'
            ? 1
            : 0
          : r.matched === 1
          ? 1
          : 0;
      const baseRow = toMinimalTrial({
        ...r,
        primary_is_right: primary,
        ghost_is_right:
          r.ghost_is_right != null ? r.ghost_is_right : null,
      });
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

    try {
      const mainDocId =
        exp1DocId ||
        (
          await addDoc(collection(db, 'experiment1_responses'), {
            participant_id: uid,
            session_id: sessionId,
            app_version: appVersion,
            created_at: serverTimestamp(),
          })
        ).id;
      if (!exp1DocId) setExp1DocId(mainDocId);

      await setDoc(
        doc(db, 'experiment1_responses', mainDocId),
        {
          participant_id: uid,
          session_id: sessionId,
          ...sessionSummary,
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
        },
        { merge: true }
      );
      console.log('Saved run', mainDocId);
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

  const ratingMessage = (percent) => {
    const p = parseFloat(percent);
    if (p <= 50) return 'Expected by chance.';
    if (p <= 59) return 'Slightly above chance.';
    if (p <= 69) return 'Notably above chance.';
    if (p <= 79) return 'Strong result.';
    return 'Very strong alignment — impressive!';
  };

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
            This study examines how focused attention relates to
            outcomes from a random process. You will press a button
            across multiple short trials and answer brief questions
            (15-45 minutes).
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
                  className={`primary-btn ${
                    !canContinue || isBusy ? 'is-disabled' : ''
                  }`}
                  disabled={!canContinue || isBusy}
                  aria-disabled={!canContinue || isBusy}
                  onClick={async () => {
                    setIsBusy(true);
                    try {
                      let p = profile;
                      if (p === undefined) {
                        const user = await ensureSignedIn();
                        const ref = doc(db, 'participants', user.uid);
                        const snap = await getDoc(ref);
                        p = snap.exists()
                          ? { id: snap.id, ...snap.data() }
                          : null;
                      }
                      if (
                        p?.demographics &&
                        p?.demographics_version === 'v1'
                      ) {
                        // returning participant → go straight to trials
                        setStep('breathe-fullstack');
                      } else {
                        setStep('pre'); // first-time → pre-questions
                      }
                    } catch (e) {
                      console.error('Consent continue failed', e);
                      setStep('pre'); // allow participation anyway
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
          <h1>Experiment #1: Sealed Envelope</h1>
          <h2>Welcome!</h2>
          <p>
            We’re testing whether one can pick up on a preselected
            option. If an effect exists, it will likely be very small
            — but even the smallest effect would be amazing to see!
          </p>
          <p>
            The only way to know is with a mountain of data. That’s
            where you come in:
          </p>
          <ul>
            <li>
              Try it again in different moods and frames of mind.
            </li>
            <li>
              Share it with friends, family, and anyone curious.
            </li>
            <li>Every single run adds to the bigger picture.</li>
            <li>
              The first baseline block uses a physical RNG (like those
              used in the{' '}
              <a
                href="https://pearlab.icrl.org/"
                target="_blank"
                rel="noopener noreferrer"
                title="PEAR experiments used physical RNGs to explore mind–machine interaction."
              >
                PEAR experiments
              </a>
              ). We switch to a quantum RNG in the second block to see
              if there’s a detectable difference.
            </li>
          </ul>

          <details className="expander">
            <summary>How scoring works (tap to expand)</summary>
            <div>
              <p>Over {statsQuantum.N} trials:</p>
              <ul>
                <li>
                  By pure chance, you’d expect about{' '}
                  <strong>{statsQuantum.muHits} hits</strong> (50%).
                </li>
                <li>
                  Natural variation (“standard deviation”) is about{' '}
                  <strong>{statsQuantum.sdHits} hits</strong>{' '}
                  {` (~${statsQuantum.sdPct.toFixed(
                    1
                  )} percentage points).`}
                </li>
                <li>
                  {`≥ ${statsQuantum.oneHi}`} is above 1σ (~16% by
                  luck alone). {`≥ ${statsQuantum.twoHi}`} is about 2σ
                  — unusual if the RNG is truly random.
                </li>
                <li>
                  Very low scores (e.g., ~33%) are as rare as very
                  high (~67%) — both are unusual outcomes, not “bad.”
                </li>
              </ul>
              <p>
                In short: 50% is average; 55+/45− notable; 60+/40−
                rare in either direction.
              </p>
            </div>
          </details>

          <details
            className="expander"
            style={{ marginTop: '0.75rem' }}
          >
            <summary>What you’ll do in each block</summary>
            <ol>
              <li>
                <strong>Baseline Block</strong> (
                {trialsPerBlock.full_stack} trials): press the{' '}
                <strong>{getLabel('full_stack')}</strong> button;
                outcome from a <em>physical RNG.</em>
              </li>
              <li>
                <strong>Main Quantum Block</strong> (
                {trialsPerBlock.spoon_love} trials): press the{' '}
                <strong>{getLabel('spoon_love')}</strong> button;
                outcome from a <em>quantum RNG.</em>
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
                className={`question-block ${
                  invalid ? 'missing' : ''
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
                  className={`primary-btn ${
                    isBlocked ? 'looks-disabled' : ''
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
          <p>
            <strong>Your score:</strong> {fullStackStats.userPercent}%
          </p>
          <p>{ratingMessage(fullStackStats.userPercent)}</p>
          <div
            className="instructions"
            dangerouslySetInnerHTML={{
              __html: (
                fullStackBlock.resultsMessage || ''
              ).replaceAll(
                '{{WORD}}',
                fullStackBlock.buttonLabel || 'RIGHT'
              ),
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
            const midComplete = allAnswered(
              midQuestions,
              midResponses
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
                  className={`primary-btn ${
                    !midComplete ? 'looks-disabled' : ''
                  }`}
                  aria-disabled={!midComplete}
                  onClick={() => {
                    if (!midComplete) return;
                    setStep('breathe-spoon');
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
          <hr style={{ margin: '1.5rem 0' }} />
          <div
            className="instructions"
            dangerouslySetInnerHTML={{
              __html: (
                fullStackBlock.preInstructions || ''
              ).replaceAll(
                '{{WORD}}',
                fullStackBlock.buttonLabel || 'RIGHT'
              ),
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
                  if (!prefetchStatus.full_stack.done) {
                    prefetchBlock('full_stack');
                  }
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

            <button
              className="primary-btn"
              onClick={() => startTrials(0)}
              disabled={
                !prefetchStatus.full_stack.done ||
                isPrefetching.full_stack
              }
              aria-disabled={
                !prefetchStatus.full_stack.done ||
                isPrefetching.full_stack
              }
              title={
                !prefetchStatus.full_stack.done
                  ? 'Please prepare sealed envelopes first…'
                  : undefined
              }
            >
              Start Baseline Trials
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
              __html: (
                spoonLoveBlock.preInstructions || ''
              ).replaceAll(
                '{{WORD}}',
                spoonLoveBlock.buttonLabel || 'RIGHT'
              ),
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
                onClick={() => {
                  if (!prefetchStatus.spoon_love.done) {
                    prefetchBlock('spoon_love');
                  }
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

            <button
              className="primary-btn"
              onClick={() => startTrials(1)}
              disabled={
                !prefetchStatus.spoon_love.done ||
                isPrefetching.spoon_love
              }
              aria-disabled={
                !prefetchStatus.spoon_love.done ||
                isPrefetching.spoon_love
              }
              title={
                !prefetchStatus.spoon_love.done
                  ? 'Please prepare sealed envelopes first…'
                  : undefined
              }
            >
              Start Quantum Trials
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

          <div
            className="instructions"
            dangerouslySetInnerHTML={{
              __html: (currentBlockObj?.trialInstructions || '')
                .replaceAll(
                  '{{WORD}}',
                  getLabel ? getLabel(currentBlockId) : 'Primary'
                )
                .replaceAll(
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
                    // Force solid visuals even while waiting
                    style={{
                      opacity: 1,
                      color: '#000',
                      cursor: waiting ? 'default' : 'pointer',
                      pointerEvents: 'auto',
                    }}
                  >
                    <span
                      className="icon-symbol"
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
            {!lastResult ? (
              <div className="status-placeholder" aria-hidden="true">
                &nbsp;
              </div>
            ) : (
              <>
                {FB[currentBlockId].ALIGNED_TEXT ? (
                  <p className="aligned-line">
                    {lastResult.matched
                      ? 'Correct ✅'
                      : 'Incorrect ❌'}
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
          <h2>Quantum Block Results</h2>
          <p>
            <strong>Your Score:</strong> {spoonLoveStats.userPercent}%
          </p>
          <p>{ratingMessage(spoonLoveStats.userPercent)}</p>
          <hr style={{ margin: '1.5rem 0' }} />
          <FoldedSelfCheck />
          <div
            className="instructions"
            dangerouslySetInnerHTML={{
              __html: (
                spoonLoveBlock.resultsMessage || ''
              ).replaceAll(
                '{{WORD}}',
                spoonLoveBlock.buttonLabel || 'RIGHT'
              ),
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
          {filteredPostQuestions.map((q, i) => (
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
            const postComplete = allAnswered(
              filteredPostQuestions.filter(
                (q) => !OPTIONAL_POST_IDS.has(q.id)
              ),
              postResponses
            );
            const onSubmit = async () => {
              if (!postComplete) return;
              await saveResults();
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
                  className={`primary-btn ${
                    !postComplete ? 'looks-disabled' : ''
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
            <li>Share with friends—large datasets matter here.</li>
            <li>
              We’ll post a full debrief at{' '}
              <a href={DEBRIEF_URL}>{DEBRIEF_URL}</a> when the study
              closes.
            </li>
          </ul>
          <button
            onClick={() => window.location.reload()}
            className="secondary-btn"
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
