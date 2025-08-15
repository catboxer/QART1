import React, { useState, useRef, useEffect, useMemo } from 'react';
import './App.css';
import FoldedSelfCheck from './FoldedSelfCheck';

// ✅ Use the shared Firebase singletons + helper
import { db, auth, ensureSignedIn } from './firebase';

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
} from './questions';
import confetti from 'canvas-confetti';
import { config } from './config.js';

// ---------- helpers ----------
const randomInt = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;
const getBlock = (id) => cueBlocks.find((b) => b.id === id);
const getLabel = (id) => getBlock(id)?.buttonLabel || 'RIGHT';

// consider a question "answered" if it has a non-empty value in the responses map
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

// Binomial stats at p=0.5 for N trials (rounded to whole hits)
const binom50 = (N) => {
  const mu = N / 2;
  const sd = Math.sqrt(N) / 2; // = sqrt(N*0.25)
  const r = (x) => Math.round(x);
  const sdPct = 50 / Math.sqrt(N); // sd in percentage points
  return {
    N,
    muHits: r(mu),
    sdHits: r(sd),
    oneHi: r(mu + sd),
    oneLo: r(mu - sd),
    twoHi: r(mu + 2 * sd),
    twoLo: r(mu - 2 * sd),
    sdPct, // ≈ 1σ as % points (optional to show)
  };
};
const allAnswered = (questions, responses) =>
  questions.every((q) => isAnswered(q, responses));

// ---- PRNG client (Random.org): one call → two bytes (primary+ghost) with retries ----
async function getPrngPairOrThrow(retries = 2, backoffMs = 250) {
  const make = () =>
    fetch(
      `/.netlify/functions/random-org-proxy?n=2&nonce=${Date.now()}`,
      {
        cache: 'no-store',
      }
    );

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await make();
      if (!res.ok)
        throw new Error(
          'prng_http_' + res.status + '_' + (res.statusText || '')
        );
      const j = await res.json();

      // Support both "bytes" and legacy "data"
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

// ---- QRNG client: one call → two bytes (primary+ghost) with retries ----
async function getQuantumPairOrThrow(retries = 2, backoffMs = 250) {
  const make = () =>
    fetch(
      `/.netlify/functions/qrng-race?pair=1&nonce=${Date.now()}`,
      {
        cache: 'no-store',
      }
    );

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await make();
      if (!res.ok) {
        throw new Error(
          'qrng_http_' + res.status + '_' + (res.statusText || '')
        );
      }
      const j = await res.json();
      // Server always returns { success, bytes:[b0,b1], source, server_time }
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

// filter out name/email so we never render or collect them
const filterOutPII = (q) => {
  const id = (q.id || '').toString().toLowerCase();
  const type = (q.type || '').toString().toLowerCase();
  return id !== 'name' && id !== 'email' && type !== 'email';
};

// Confetti helper (respect reduced motion)
function fireConfettiSafely() {
  const prefersReduced = window.matchMedia?.(
    '(prefers-reduced-motion: reduce)'
  )?.matches;
  if (prefersReduced) return;
  confetti({ particleCount: 150, spread: 100, origin: { y: 0.6 } });
}

function MainApp() {
  // ----- participant profile (demographics stored once) -----
  const [profile, setProfile] = useState(undefined); // undefined = loading, null = first run, object = returning user
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // 1) Ensure we are signed in (awaits persistence; creates anon user if none)
        const user = await ensureSignedIn();
        if (!user || cancelled) return;

        // 2) Read this UID's participant profile
        const ref = doc(db, 'participants', user.uid);
        try {
          const snap = await getDoc(ref);
          if (!cancelled) {
            setProfile(snap.exists() ? snap.data() : null);
          }
        } catch (err) {
          // If a read fails due to timing/rules, treat as first run (no crash)
          if (!cancelled) {
            console.warn(
              '[profile] read failed, treating as first run:',
              err
            );
            setProfile(null);
          }
        }
      } catch (err) {
        // If sign-in itself fails (e.g., very strict privacy), still allow first run
        if (!cancelled) {
          console.warn(
            '[auth] ensureSignedIn failed, treating as first run:',
            err
          );
          setProfile(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const hasDemographics = !!(profile && profile.demographics);

  // ----- session / version -----
  const [sessionId] = useState(() => {
    try {
      if (
        typeof window !== 'undefined' &&
        window.crypto?.randomUUID
      ) {
        return window.crypto.randomUUID();
      }
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

  // ---- ROBOT ----

  // ----- timing arm + robot flags (from URL) -----
  // After: const appVersion = process.env.REACT_APP_COMMIT ?? 'dev';

  const parseParams = () => {
    const search = window.location.search || '';
    const hash = window.location.hash || '';
    // support params in search (?arm=...) and after a hash (e.g., #qa?arm=open&robot=1)
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

  // ----- consent gate -----
  const [step, setStep] = useState('consent');
  const [consent18, setConsent18] = useState(false);
  const [consentAgree, setConsentAgree] = useState(false);
  const CONSENT_VERSION = config.CONSENT_VERSION;
  const DEBRIEF_URL = config.DEBRIEF_URL;

  // ----- experiment state -----
  const [preResponses, setPreResponses] = useState({});
  const [midResponses, setMidResponses] = useState({});
  const [postResponses, setPostResponses] = useState({});
  const [trialResults, setTrialResults] = useState([]);
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0);
  const [currentTrial, setCurrentTrial] = useState(0);
  const [showStar, setShowStar] = useState(false);
  const [starBurstId, setStarBurstId] = useState(0);
  const starTimerRef = useRef(null);
  const [lastResult, setLastResult] = useState(null);
  const [buttonsDisabled, setButtonsDisabled] = useState(false);
  const [fullStackStats, setFullStackStats] = useState(null);
  const [spoonLoveStats, setSpoonLoveStats] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const inFlightRef = useRef(false);

  // NEW: highlight-missing flags (only after they try to continue)
  const [showPreMissing, setShowPreMissing] = useState(false);
  const [showMidMissing, setShowMidMissing] = useState(false);
  const [showPostMissing, setShowPostMissing] = useState(false);

  // ----- blocks & trials -----
  const fullStackBlock = cueBlocks.find((b) => b.id === 'full_stack');
  const spoonLoveBlock = cueBlocks.find((b) => b.id === 'spoon_love');
  const [blockOrder] = useState([
    { ...fullStackBlock, id: 'full_stack', showFeedback: true },
    { ...spoonLoveBlock, id: 'spoon_love', showFeedback: true },
  ]);
  const trialsPerBlock = config.trialsPerBlock;
  const currentBlock = blockOrder[currentBlockIndex].id;
  const currentBlockObj = blockOrder[currentBlockIndex];
  const totalTrialsPerBlock = trialsPerBlock[currentBlock];

  // prime assignment (display boost)
  const [isHighPrime] = useState(() => Math.random() < 0.5);
  const BOOST_MIN = config.BOOST_MIN;
  const BOOST_MAX = config.BOOST_MAX;
  const FLOOR = config.FLOOR;

  // Confetti thresholds
  const CONFETTI_THRESHOLD_BASELINE = config.confetti.baseline;
  const CONFETTI_THRESHOLD_QUANTUM = config.confetti.quantum;

  // --- Feedback switches per block (live score unblocked for both) ---
  const FB = {
    full_stack: { STAR: false, ALIGNED_TEXT: false, SCORE: false },
    spoon_love: { STAR: false, ALIGNED_TEXT: false, SCORE: false },
  };

  // --- Feedback on early exit ---
  const [showExitModal, setShowExitModal] = useState(false);
  const [exitReason, setExitReason] = useState('time');
  const [exitNotes, setExitNotes] = useState('');

  useEffect(() => {
    return () => {
      if (starTimerRef.current) clearTimeout(starTimerRef.current);
    };
  }, []);

  // ----- forms -----
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

  // ----- save profile once (first run) -----
  async function saveProfileIfNeeded(preResponses) {
    await ensureSignedIn();
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const demographics = { ...preResponses };
    const ref = doc(db, 'participants', uid);
    const snap = await getDoc(ref);
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

  // ----- start blocks -----
  const startTrials = (index = 0) => {
    setCurrentBlockIndex(index);
    if (index === 0) setTrialResults([]); // clear only when starting the FIRST block
    setCurrentTrial(0);
    setLastResult(null);
    setStep('trials');
  };

  // ----- one big PRIMARY button -----
  const renderRightButton = () => (
    <div className="icon-options-wrapper">
      <div
        className={`icon-options large-buttons ${
          buttonsDisabled ? 'text-hidden' : 'text-visible'
        }`}
      >
        <button
          type="button"
          className={`icon-button ${isLoading ? 'is-fetching' : ''}`}
          onPointerDown={handlePressStart}
          onPointerUp={handlePressEnd}
          onPointerCancel={() => (pressStartRef.current = null)}
          disabled={isLoading || buttonsDisabled}
        >
          <span className="btn-label">
            {getLabel(currentBlockObj.id)}
          </span>
        </button>
      </div>
    </div>
  );

  // ----- live score (memoized) -----
  const liveScore = useMemo(() => {
    const rows = trialResults.filter(
      (t) => t.block_type === currentBlock
    );
    const hits = rows.filter((t) => t.matched === 1).length;
    return {
      trialsSoFar: rows.length,
      hitsSoFar: hits,
      pct: rows.length
        ? ((hits / rows.length) * 100).toFixed(1)
        : '0.0',
    };
  }, [trialResults, currentBlock]);

  // --- Press/hold tracking ---
  const pressStartRef = useRef(null);
  const handlePressStart = (e) => {
    try {
      if (e && e.pointerType)
        e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {}
    pressStartRef.current = performance.now();
  };
  const handlePressEnd = async () => {
    const t0 = pressStartRef.current;
    const t1 = performance.now();
    pressStartRef.current = null;
    const holdDurationMs = Number.isFinite(t0)
      ? Math.max(0, t1 - t0)
      : null;
    await handleTrial(holdDurationMs);
  };

  // ----- per-trial handler -----
  const handleTrial = async (holdDurationMs = null) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    const block = blockOrder[currentBlockIndex];

    setIsLoading(true);
    setButtonsDisabled(true);
    setLastResult(null);
    const press_start_ts = new Date().toISOString();
    let press_release_ts = null;

    let rng = null;

    // ---- timing arms ----
    if (timingArm === 'scramble') {
      // smear the press phase randomly (destroys phase advantage)
      const MAX_MS = 16; // ~1 frame at 60 Hz
      await new Promise((r) => setTimeout(r, Math.random() * MAX_MS));
    } else if (timingArm === 'synced') {
      // quantize sampling to the next 60 Hz tick (amplifies phase effects)
      const T = 1000 / 60; // 16.67 ms
      const now = performance.now();
      const wait = T - (now % T);
      await new Promise((r) => setTimeout(r, wait));
    } else if (timingArm === 'blind') {
      // placeholder: you’ll wire prequeue/commit–reveal later.
      // For now, treat as 'open' so the app still runs if someone passes ?arm=blind.
    }

    try {
      if (block.id === 'full_stack') {
        // PRNG: one call → two bytes
        try {
          const {
            bytes: pair,
            source,
            server_time,
          } = await getPrngPairOrThrow();
          const trialNum = currentTrial + 1;
          const primaryIsFirst = trialNum % 2 === 1; // odd → first primary

          const b0 = pair[0] >>> 0;
          const b1 = pair[1] >>> 0;
          const primaryByte = primaryIsFirst ? b0 : b1;
          const ghostByte = primaryIsFirst ? b1 : b0;

          // same coding as QRNG: 1=LEFT, 2=RIGHT
          rng = {
            source: source || 'random_org',
            rawByte: primaryByte,
            qrng_code: primaryByte % 2 === 0 ? 1 : 2,
            server_time: server_time ?? null,

            ghost_rawByte: ghostByte,
            ghost_qrng_code: ghostByte % 2 === 0 ? 1 : 2,

            pair_rule: 'alternate',
            primary_pos: primaryIsFirst ? 1 : 2,
          };

          if (process.env.NODE_ENV !== 'production') {
            console.log('[PRNG pair]', {
              trial: trialNum,
              primary_pos: rng.primary_pos,
              primary_raw: rng.rawByte,
              ghost_raw: rng.ghost_rawByte,
              primary_label: rng.qrng_code === 2 ? 'RIGHT' : 'LEFT',
              ghost_label:
                rng.ghost_qrng_code === 2 ? 'RIGHT' : 'LEFT',
            });
          }
        } catch (e) {
          alert(
            'Network hiccup—no PRNG value. Please press once again.'
          );
          setIsLoading(false);
          setButtonsDisabled(false);
          inFlightRef.current = false;
          return;
        }
      } else {
        // QRNG: one call → two bytes
        try {
          const {
            bytes: pair,
            source,
            server_time,
          } = await getQuantumPairOrThrow();
          const trialNum = currentTrial + 1;
          const primaryIsFirst = trialNum % 2 === 1; // odd → first primary

          const b0 = pair[0] >>> 0;
          const b1 = pair[1] >>> 0;
          const primaryByte = primaryIsFirst ? b0 : b1;
          const ghostByte = primaryIsFirst ? b1 : b0;

          rng = {
            source: source || 'qrng',
            rawByte: primaryByte,
            qrng_code: primaryByte % 2 === 0 ? 1 : 2, // 1=LEFT, 2=RIGHT
            server_time: server_time ?? null,

            ghost_rawByte: ghostByte,
            ghost_qrng_code: ghostByte % 2 === 0 ? 1 : 2,

            pair_rule: 'alternate',
            primary_pos: primaryIsFirst ? 1 : 2,
          };

          if (process.env.NODE_ENV !== 'production') {
            console.log('[QRNG pair]', {
              trial: trialNum,
              primary_pos: rng.primary_pos,
              primary_raw: rng.rawByte,
              ghost_raw: rng.ghost_rawByte,
              primary_label: rng.qrng_code === 2 ? 'RIGHT' : 'LEFT',
              ghost_label:
                rng.ghost_qrng_code === 2 ? 'RIGHT' : 'LEFT',
            });
          }
        } catch (e) {
          alert(
            'Network hiccup—no quantum value. Please press once again.'
          );
          setIsLoading(false);
          setButtonsDisabled(false);
          inFlightRef.current = false;
          return;
        }
      }
      press_release_ts = new Date().toISOString();

      // ----- score + display (same rule for BOTH blocks) -----
      const matched = rng.qrng_code === 2 ? 1 : 0; // RIGHT = hit
      const correctSide = rng.qrng_code === 2 ? 'right' : 'left';

      // ----- log row -----
      const logRow = {
        session_id: sessionId,
        app_version: appVersion,
        condition: isHighPrime ? 'primed' : 'control',
        block_type: block.id,
        agent: robotMode ? 'robot' : 'human',
        timing_arm: timingArm, // 'open' | 'blind' | 'synced' | 'scramble'
        trial_index: currentTrial + 1,
        press_time: press_start_ts,
        press_start_ts,
        press_release_ts,
        hold_duration_ms: holdDurationMs,
        rng_source: rng.source,
        raw_byte: rng.rawByte ?? null,
        qrng_code: rng.qrng_code,
        qrng_label: rng.qrng_code === 2 ? 'right' : 'left',
        primary_is_right: rng.qrng_code === 2 ? 1 : 0,
        qrng_server_time: rng.server_time ?? null,
        ghost_raw_byte: rng.ghost_rawByte ?? null,
        ghost_qrng_code: rng.ghost_qrng_code ?? null,
        ghost_is_right:
          rng.ghost_qrng_code != null && rng.ghost_qrng_code === 2
            ? 1
            : 0,
        pair_rule: rng.pair_rule,
        primary_pos: rng.primary_pos,
        matched,
      };

      const newTrials = [...trialResults, logRow];
      setTrialResults(newTrials);

      // star feedback (only for quantum hits)
      if (block.id === 'spoon_love' && matched) {
        if (starTimerRef.current) clearTimeout(starTimerRef.current);
        setStarBurstId((k) => k + 1);
        setShowStar(true);
        starTimerRef.current = setTimeout(
          () => setShowStar(false),
          1000
        );
      }

      // Always set lastResult so UI flags can decide what to show
      setLastResult({ correct: correctSide, matched });

      // end-of-block
      const countThisBlock = newTrials.filter(
        (t) => t.block_type === block.id
      ).length;
      if (countThisBlock === totalTrialsPerBlock) {
        const userCorrect = newTrials.filter(
          (t) => t.block_type === block.id && t.matched === 1
        ).length;
        const realPercent = (userCorrect / totalTrialsPerBlock) * 100;

        if (block.id === 'full_stack') {
          let displayed = realPercent;
          if (isHighPrime) {
            const boost = randomInt(BOOST_MIN, BOOST_MAX);
            displayed = Math.min(
              Math.max(realPercent + boost, FLOOR),
              100
            );
          }
          if (displayed > CONFETTI_THRESHOLD_BASELINE)
            fireConfettiSafely();
          setFullStackStats({ userPercent: displayed.toFixed(1) });
          setStep('fullstack-results');
        } else {
          if (realPercent > CONFETTI_THRESHOLD_QUANTUM)
            fireConfettiSafely();
          setSpoonLoveStats({ userPercent: realPercent.toFixed(1) });
          setStep('final-results');
        }
        return;
      }

      setCurrentTrial((c) => c + 1);
    } finally {
      setIsLoading(false);
      setButtonsDisabled(false);
      inFlightRef.current = false;
    }
  };

  // ----- robot/autopilot: drives the same code path as humans -----
  useEffect(() => {
    if (!robotMode) return;
    if (step !== 'trials') return;

    let cancelled = false;
    (async () => {
      while (!cancelled && currentTrial < totalTrialsPerBlock) {
        // Inter-press interval (Poisson-ish); tweak mean as you like
        const waitMs = -Math.log(1 - Math.random()) * 900;
        await new Promise((r) => setTimeout(r, waitMs));

        // Simulated hold (human-ish)
        const hold = 300 + Math.random() * 600; // 300–900 ms

        // IMPORTANT: call your existing handler so logging/UI stay identical
        await handleTrial(hold);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [robotMode, step, currentTrial, totalTrialsPerBlock]);

  // -------- minimize each trial row (only what QAExport needs) --------
  const toMinimalTrial = (r) => ({
    session_id: r.session_id,
    block_type: r.block_type,
    trial_index: r.trial_index,
    press_time: r.press_time,
    press_start_ts: r.press_start_ts ?? r.press_time ?? null,
    press_release_ts: r.press_release_ts ?? null,
    hold_duration_ms: r.hold_duration_ms ?? null,
    timing_arm: r.timing_arm ?? null, // 'open' | 'scramble' | 'synced' | 'blind'
    agent: r.agent ?? null, // 'robot' | 'human'

    // primary (subject) fields
    qrng_code: r.qrng_code, // 1=LEFT, 2=RIGHT
    qrng_label: r.qrng_label, // 'left'|'right'
    primary_is_right: r.primary_is_right, // 1|0

    // demon/ghost fields
    ghost_qrng_code: r.ghost_qrng_code ?? null, // 1|2|null
    ghost_is_right: r.ghost_is_right ?? null, // 1|0|null

    // allocation / RNG metadata
    primary_pos: r.primary_pos, // 1|2 (alternates)
    rng_source: r.rng_source || null,
    raw_byte: r.raw_byte ?? null,
    ghost_raw_byte: r.ghost_raw_byte ?? null,
  });

  // ----- save all results: small main doc + trials in subcollection -----
  const saveResults = async (
    exitedEarly = false,
    earlyExitInfo = null
  ) => {
    // ✅ Ensure we have a user before any writes
    await ensureSignedIn();

    const devNotify = (msg) => {
      if (process.env.NODE_ENV !== 'production') {
        try {
          alert(msg);
        } catch (_) {}
      } else {
        console.warn(msg);
      }
    };

    // Split trials by block
    const fsTrials = trialResults.filter(
      (t) => t.block_type === 'full_stack'
    );
    const slTrials = trialResults.filter(
      (t) => t.block_type === 'spoon_love'
    );

    // Primary (RIGHT) hits
    const fsHits = fsTrials.filter((t) => t.matched === 1).length;
    const slHits = slTrials.filter((t) => t.matched === 1).length;

    // Primary % (real)
    const fsRealPct = fsTrials.length
      ? Number(((fsHits / fsTrials.length) * 100).toFixed(1))
      : null;
    const slRealPct = slTrials.length
      ? Number(((slHits / slTrials.length) * 100).toFixed(1))
      : null;

    // Baseline displayed % (after priming boost)
    const fsDisplayedPct =
      fullStackStats?.userPercent != null
        ? Number(fullStackStats.userPercent)
        : null;

    /* ---------------- Baseline (PRNG) ghost summary ---------------- */
    const fsGhostRights = fsTrials.reduce(
      (acc, row) => acc + (row.ghost_is_right || 0),
      0
    );
    const fsGhostPct = fsTrials.length
      ? Number(((fsGhostRights / fsTrials.length) * 100).toFixed(1))
      : null;
    const fsDeltaPct =
      fsRealPct != null && fsGhostPct != null
        ? Number((fsRealPct - fsGhostPct).toFixed(1))
        : null;
    const fsN10 = fsTrials.filter(
      (t) => t.primary_is_right === 1 && t.ghost_is_right === 0
    ).length;
    const fsN01 = fsTrials.filter(
      (t) => t.primary_is_right === 0 && t.ghost_is_right === 1
    ).length;

    /* ---------------- QRNG ghost summary ---------------- */
    const ghostRights = slTrials.reduce(
      (acc, row) => acc + (row.ghost_is_right || 0),
      0
    );
    const ghostPct = slTrials.length
      ? Number(((ghostRights / slTrials.length) * 100).toFixed(1))
      : null;
    const deltaPct =
      slRealPct != null && ghostPct != null
        ? Number((slRealPct - ghostPct).toFixed(1))
        : null;
    const n10 = slTrials.filter(
      (t) => t.primary_is_right === 1 && t.ghost_is_right === 0
    ).length;
    const n01 = slTrials.filter(
      (t) => t.primary_is_right === 0 && t.ghost_is_right === 1
    ).length;

    // ----- Build small session summary (NO big arrays here) -----
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

      // Baseline (PRNG) summary
      full_stack: {
        primed: isHighPrime,
        accuracy_real: fsRealPct,
        accuracy_displayed: fsDisplayedPct,
        percent_ghost_right: fsGhostPct,
        delta_vs_ghost: fsDeltaPct,
        summary: {
          trials: fsTrials.length,
          hits_primary_right: fsHits,
          hits_ghost_right: fsGhostRights,
          percent_primary_right: fsRealPct,
          percent_ghost_right: fsGhostPct,
          delta_vs_ghost: fsDeltaPct,
          n10: fsN10,
          n01: fsN01,
        },
      },

      // QRNG summary
      spoon_love: {
        accuracy_real: slRealPct,
        percent_ghost_right: ghostPct,
        delta_vs_ghost: deltaPct,
        summary: {
          trials: slTrials.length,
          hits_primary_right: slHits,
          hits_ghost_right: ghostRights,
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

    // -------- minimize each trial row --------
    const fsTrialsMin = fsTrials.map((r) => {
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
      return toMinimalTrial({
        ...r,
        primary_is_right: primary,
        ghost_is_right: r.ghost_is_right ?? null,
      });
    });

    const slTrialsMin = slTrials.map(toMinimalTrial);

    // ---- Firestore writes ----
    try {
      // (1) Add the small main doc
      const colRef = collection(db, 'experiment2_responses');
      const participant_id = auth.currentUser?.uid ?? null;
      const mainDocRef = await addDoc(colRef, {
        participant_id, // stable per browser/profile
        session_id: sessionId,
        ...sessionSummary, // NOTE: NO trial arrays here
      });

      // (2) Write arrays into a single child doc:
      //     experiment2_responses/{id}/details/trialDetails
      const detailsRef = doc(
        db,
        'experiment2_responses',
        mainDocRef.id,
        'details',
        'trialDetails'
      );

      try {
        await setDoc(detailsRef, {
          full_stack_trials: fsTrialsMin,
          spoon_love_trials: slTrialsMin,
        });
        console.log('WROTE details/trialDetails for', mainDocRef.id);
      } catch (e) {
        console.error('DETAILS WRITE FAILED', e);
        devNotify('Details write failed. See console for details.');
        throw e; // bubble so caller notices during testing
      }
    } catch (e) {
      console.error('MAIN SAVE FAILED', e);
      devNotify('Main save failed. See console for details.');
      throw e;
    }

    // (3) Increment runs on the participant document + bump UI immediately
    try {
      const uid = auth.currentUser?.uid;
      if (uid) {
        const partRef = doc(db, 'participants', uid);
        await setDoc(
          partRef,
          {
            has_run: true,
            runs: increment(exitedEarly ? 0 : 1), // don’t count early exits, if you prefer
            updated_at: serverTimestamp(),
            last_run_at: serverTimestamp(),
          },
          { merge: true }
        );

        // ✅ Reflect the increment locally so the on-screen counter bumps immediately
        setProfile((prev) => {
          if (!prev) return prev; // leave undefined (loading) or null (first run) as-is
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

  return (
    // <>
    //   {process.env.NODE_ENV !== 'production' && (
    //     <div
    //       style={{
    //         position: 'sticky',
    //         top: 0,
    //         zIndex: 9999,
    //         background: '#111',
    //         color: '#fff',
    //         padding: '6px 10px',
    //         fontFamily: 'monospace',
    //         fontSize: 12,
    //       }}
    //     >
    //       UID: {auth.currentUser?.uid || '—'} | persistence:{' '}
    //       {window.__authPersistence || '—'} | hasDemo:{' '}
    //       {profile?.demographics
    //         ? 'Y'
    //         : profile === undefined
    //         ? '…'
    //         : 'N'}
    //     </div>
    //   )}

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
              We store anonymous trial data (button presses, random
              outcomes, timestamps) and questionnaire answers in
              Google Firestore (USA).
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
            const canContinue =
              consent18 && consentAgree && profile !== undefined;

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
                    {profile === undefined
                      ? 'Loading your profile…'
                      : 'Check both boxes to continue.'}
                  </p>
                ) : null}

                <button
                  className={`primary-btn ${
                    !canContinue ? 'is-disabled' : ''
                  }`}
                  disabled={!canContinue}
                  aria-disabled={!canContinue}
                  onClick={() => {
                    // profile is loaded because the button is disabled until then
                    if (
                      profile?.demographics &&
                      profile?.demographics_version === 'v1'
                    ) {
                      // returning UID with submitted pre → skip pre page
                      startTrials(0);
                    } else {
                      // first run or abandoned pre → ask pre again
                      setStep('pre');
                    }
                  }}
                >
                  I Agree, Continue
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
          <h1>Experiment #2: Conscious Nudge of Random Outcomes</h1>
          <h2>Welcome!</h2>
          <p>
            We’re testing whether focused attention can gently shift a
            truly random process. If an effect exists, it will likely
            be very small — but even the smallest effect would be
            amazing to see!
          </p>
          <p>
            The only way to know is with a mountain of data. That’s
            where you come in:
          </p>
          <ul>
            <li>
              Try it again and again, in different moods and frames of
              mind.
            </li>
            <li>
              Share it with friends, family, and anyone curious.
            </li>
            <li>Every single run adds to the bigger picture.</li>
            <li>
              The first baseline block uses a physical RNG — the same
              kind of device used in the famous{' '}
              <a
                href="https://pearlab.icrl.org/"
                target="_blank"
                rel="noopener noreferrer"
                title="PEAR (Princeton Engineering Anomalies Research) used physical RNGs to explore mind–machine interaction."
              >
                PEAR experiments
              </a>
              . We switch to a quantum RNG in the second main block to
              see if there is a detectable difference in RNGs.
            </li>
            <li>
              Quantum processes work in probabilities, not certainties
              — and any influence, if it exists, will be small and
              hidden in the averages of many people’s results.
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
                  The natural variation (“standard deviation”) is
                  about <strong>{statsQuantum.sdHits} hits</strong>
                  {` (~${statsQuantum.sdPct.toFixed(
                    1
                  )} percentage points).`}
                </li>
                <li>
                  Scoring{' '}
                  <strong>{statsQuantum.oneHi} or more</strong> is
                  above 1 standard deviation — happens only about 16%
                  of the time by luck alone.
                </li>
                <li>
                  Scoring{' '}
                  <strong>{statsQuantum.twoHi} or more</strong> is
                  about 2 standard deviations above chance — unusual
                  when the RNG is truly random.
                </li>
                <li>
                  Scoring{' '}
                  <strong>{statsQuantum.oneLo} or fewer</strong> is
                  also 1 standard deviation away, and{' '}
                  <strong>{statsQuantum.twoLo} or fewer</strong> is 2
                  standard deviations — equally unusual, just in the
                  other direction.
                </li>
                <li>
                  Very low scores (like around 33%) are just as rare
                  as very high scores (like around 67%) — both mean
                  you got an unusual result, not that you “did badly.”
                </li>
              </ul>
              <p>
                In short: 50% is average, 55+ or 45− is better/worse
                than chance, and 60+ or 40− is rare in either
                direction.
              </p>
            </div>
          </details>

          <details
            className="expander"
            style={{ marginTop: '0.75rem' }}
          >
            <summary>
              What you’ll do in each block (tap to expand)
            </summary>
            <ol>
              <li>
                <strong>Baseline Block</strong> (
                {trialsPerBlock.full_stack} trials): press the{' '}
                <strong>{getLabel('full_stack')}</strong> button;
                outcome comes from a <em>physical RNG.</em> Your score
                will be displayed at the end.
              </li>
              <li>
                <strong>Main Quantum Block</strong> (
                {trialsPerBlock.spoon_love} trials): press the{' '}
                <strong>{getLabel('spoon_love')}</strong> button;
                outcome comes from a <em>quantum RNG.</em> Your score
                will be displayed at the end.
              </li>
            </ol>
          </details>

          <p>
            You have completed this experiment{' '}
            {profile === undefined ? '…' : String(profile?.runs ?? 0)}{' '}
            time(s).
          </p>

          {filteredPreQuestions.map((q, i) => {
            const error = showPreMissing
              ? fieldError(q, preResponses)
              : null;
            const invalid = !!error;
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
            const preComplete = allAnswered(
              filteredPreQuestions,
              preResponses
            );
            const onStartBaseline = async () => {
              if (!preComplete) {
                setShowPreMissing(true);
                return;
              }
              setShowPreMissing(false);
              await saveProfileIfNeeded(preResponses);
              setStep('breathe-fullstack'); // go to the new instruction screen
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
                    Please answer all questions to continue. Some
                    items repeat across trials, but each trial is
                    analyzed separately. Accurate, complete responses
                    on every trial are essential to the validity of
                    this research. Do not enter any personal
                    information including email or phone number into
                    our text fields.
                  </p>
                ) : null}
                <button
                  className="primary-btn"
                  aria-disabled={!preComplete}
                  onClick={onStartBaseline}
                >
                  Start Baseline Trials
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
            <div
              key={q.id}
              className={`question-block ${
                showMidMissing && !isAnswered(q, midResponses)
                  ? 'missing'
                  : ''
              }`}
            >
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
            const onGoQuantum = () => {
              if (!midComplete) {
                setShowMidMissing(true);
                return;
              }
              setShowMidMissing(false);
              setStep('breathe-spoon');
            };
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
                    Please answer all questions to continue. Some
                    items repeat across trials, but each trial is
                    analyzed separately. Accurate, complete responses
                    on every trial are essential to the validity of
                    this research.
                  </p>
                ) : null}
                <button
                  className="primary-btn"
                  aria-disabled={!midComplete}
                  onClick={onGoQuantum}
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
          <button onClick={() => startTrials(0)}>
            Start Baseline Trials
          </button>
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
          <button onClick={() => startTrials(1)}>
            Start Quantum Trials
          </button>
        </div>
      )}

      {step === 'trials' && (
        <>
          <h2>
            Trial {currentTrial + 1} of {totalTrialsPerBlock}
          </h2>

          <div
            className="instructions"
            dangerouslySetInnerHTML={{
              __html: (currentBlockObj.trialInstructions || '')
                .replaceAll(
                  '{{WORD}}',
                  getLabel ? getLabel(currentBlockObj.id) : 'Primary'
                )
                .replaceAll(
                  '{{ISSUE_MAILTO}}',
                  buildIssueMailto(sessionId)
                ),
            }}
          />

          <div className="trial-ui">
            <div className="top-feedback-slot">
              {FB[currentBlock].STAR &&
              currentBlock === 'spoon_love' &&
              showStar ? (
                <div
                  key={starBurstId}
                  className="star-burst"
                  aria-hidden="true"
                >
                  🌟
                </div>
              ) : null}
            </div>

            {renderRightButton()}

            {/* Visual-only loading text; results announced when they change */}
            <div className="bottom-feedback-slot" aria-live="polite">
              {isLoading ? (
                <div role="status" className="status-line show">
                  {currentBlock === 'spoon_love'
                    ? 'Waiting for the quantum RNG…'
                    : currentBlock === 'full_stack'
                    ? 'Waiting for the physical RNG…'
                    : 'Waiting…'}
                </div>
              ) : null}

              {!isLoading && lastResult ? (
                <>
                  {FB[currentBlock].ALIGNED_TEXT ? (
                    <p className="aligned-line">
                      {lastResult.matched
                        ? 'Aligned ✅'
                        : 'Not aligned ❌'}
                    </p>
                  ) : null}
                  {FB[currentBlock].SCORE ? (
                    <h3 className="score-line">
                      Score so far: {liveScore.hitsSoFar}
                      {liveScore.trialsSoFar
                        ? ` / ${liveScore.trialsSoFar}`
                        : ''}
                      <br />
                      Percentage: {liveScore.pct}%
                    </h3>
                  ) : null}
                </>
              ) : null}

              {!isLoading && !lastResult ? (
                <div
                  className="status-placeholder"
                  aria-hidden="true"
                >
                  &nbsp;
                </div>
              ) : null}
            </div>
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
            or hits.
          </p>
          <hr style={{ margin: '1.5rem 0' }} />

          <FoldedSelfCheck />

          <p>{ratingMessage(spoonLoveStats.userPercent)}</p>
          <div
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
            <div
              key={q.id}
              className={`question-block ${
                showPostMissing && !isAnswered(q, postResponses)
                  ? 'missing'
                  : ''
              }`}
            >
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
              if (!postComplete) {
                setShowPostMissing(true);
                return;
              }
              setShowPostMissing(false);
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
                    Some items repeat across trials, but each trial is
                    analyzed separately. Accurate, complete responses
                    on every trial are essential to the validity of
                    this research.
                  </p>
                ) : null}
                <button
                  className="primary-btn"
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
            style={{ display: 'inline-block', marginTop: '1em' }}
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
    // </>
  );
}

export default MainApp;
