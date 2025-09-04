// exp3/src/MainApp.jsx
import React, {
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
  collection,
  doc,
  addDoc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';

const QRNG_URL = '/.netlify/functions/qrng-race';
// const RNG_PROXY = '/.netlify/functions/random-org-proxy'; // optional
// Stable, module-scoped fetch for QRNG bytes
async function fetchBytes(n) {
  const res = await fetch(`${QRNG_URL}?n=${n}&nonce=${Date.now()}`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('qrng_http_' + res.status);
  const j = await res.json();
  if (!j?.bytes || j.bytes.length < n) throw new Error('qrng_shape');
  return {
    bytes: new Uint8Array(j.bytes),
    source: j.source || 'qrng',
  };
}

// --- crypto helpers ---
async function sha256Hex(bytes) {
  const buf =
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// --- UI bits ---
function FlashPanel({ bit, lowContrast, patterns }) {
  const isRed = bit === 1;
  const base = isRed
    ? lowContrast
      ? '#ffefef'
      : '#cc0000'
    : lowContrast
    ? '#efffee'
    : '#008a00';
  const style = {
    width: '90vw',
    height: '80vh',
    borderRadius: 16,
    boxShadow: '0 8px 40px rgba(0,0,0,0.35)',
    background: base,
    backgroundImage: patterns
      ? isRed
        ? 'repeating-linear-gradient(45deg, rgba(0,0,0,0.2) 0 8px, transparent 8px 16px)'
        : 'repeating-linear-gradient(135deg, rgba(0,0,0,0.15) 0 10px, transparent 10px 20px)'
      : 'none',
    backgroundBlendMode: 'multiply',
  };
  return <div style={style} />;
}
function CircularGauge({
  value = 0.5,
  targetBit = 1,
  width = 220,
  label = 'Short-term avg',
  subLabel,
}) {
  // value in [0,1]
  const r = Math.round((width * 0.72) / 2); // radius for the half-circle
  const cx = width / 2;
  const cy = r + 16; // leave a little top padding
  const halfLen = Math.PI * r; // length of the semicircle path
  const pct = Math.round(value * 100);

  // Colors
  const main = targetBit === 1 ? '#cc0000' : '#008a00'; // RED/GREEN
  const track = '#e6e6e6';
  const text = '#222';

  // Semicircle path (left to right)
  const d = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;

  // Foreground arc length based on value
  const dashArray = `${halfLen} ${halfLen}`;
  const dashOffset = halfLen * (1 - Math.max(0, Math.min(1, value)));

  // 50% tick marker (top center)
  const tickLen = 8;
  const tickX = cx;
  const tickY1 = cy - r - 2;
  const tickY2 = tickY1 - tickLen;

  return (
    <div style={{ display: 'inline-block' }}>
      <svg
        width={width}
        height={r + 72}
        viewBox={`0 0 ${width} ${r + 72}`}
      >
        {/* Track */}
        <path d={d} stroke={track} strokeWidth="14" fill="none" />
        {/* Foreground arc */}
        <path
          d={d}
          stroke={main}
          strokeWidth="14"
          fill="none"
          strokeLinecap="round"
          style={{
            strokeDasharray: dashArray,
            strokeDashoffset: dashOffset,
            transition: 'stroke-dashoffset 120ms linear',
          }}
        />
        {/* 50% tick */}
        <line
          x1={tickX}
          y1={tickY1}
          x2={tickX}
          y2={tickY2}
          stroke="#999"
          strokeWidth="2"
        />
        {/* Left/right end labels */}
        <text
          x={cx - r}
          y={cy + 14}
          textAnchor="start"
          fontSize="11"
          fill={targetBit === 1 ? '#008a00' : '#cc0000'}
        >
          0%
        </text>
        <text
          x={cx + r}
          y={cy + 14}
          textAnchor="end"
          fontSize="11"
          fill={main}
        >
          100%
        </text>

        {/* Big number */}
        <text
          x={cx}
          y={cy - 10}
          textAnchor="middle"
          fontSize="22"
          fill={text}
          fontWeight="700"
        >
          {pct}%
        </text>
        {/* Labels */}
        <text
          x={cx}
          y={cy + 28}
          textAnchor="middle"
          fontSize="12"
          fill={text}
          style={{ opacity: 0.8 }}
        >
          {label}
        </text>
        {subLabel ? (
          <text
            x={cx}
            y={cy + 44}
            textAnchor="middle"
            fontSize="12"
            fill="#666"
          >
            {subLabel}
          </text>
        ) : null}
      </svg>
    </div>
  );
}

function AutoAdvance({ seconds = 10, onDone }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    const id = setInterval(() => {
      setLeft((s) => {
        if (s <= 1) {
          clearInterval(id);
          onDone?.();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [seconds, onDone]);
  return (
    <div style={{ opacity: 0.7, marginTop: 8 }}>
      Continuing in {left}s…
    </div>
  );
}

// --- main ---
export default function MainApp() {
  // auth
  const [userReady, setUserReady] = useState(false);
  const [uid, setUid] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const u = await ensureSignedIn();
        setUid(u?.uid || null);
      } finally {
        setUserReady(true);
      }
    })();
  }, []);
  async function requireUid() {
    const u = await ensureSignedIn(); // your helper should sign in (anon or email/pass)
    if (!u || !u.uid)
      throw new Error(
        'auth/no-user: sign-in required before writing'
      );
    return u.uid;
  }

  // toggles
  const [lowContrast, setLowContrast] = useState(C.LOW_CONTRAST_MODE);
  const [patternsMode, setPatternsMode] = useState(true);
  // Debug UI gate: enable extra labels only if URL hash has #qa or #debug
  const [debugUI, setDebugUI] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const check = () =>
      setDebugUI(/(#qa|#\/qa|#debug)/i.test(window.location.hash));
    check(); // initial
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, []);

  // target & prime
  const [target, setTarget] = useState(null); // 'RED' | 'GREEN'
  const [primeCond, setPrimeCond] = useState(null); // 'prime' | 'neutral'
  useEffect(() => {
    if (target) return;
    const t =
      crypto.getRandomValues(new Uint8Array(1))[0] & 1
        ? 'RED'
        : 'GREEN';
    setTarget(t);
    const r = crypto.getRandomValues(new Uint8Array(1))[0] / 255;
    setPrimeCond(r < C.PRIME_PROB ? 'prime' : 'neutral');
  }, [target]);
  // Debug UI gate: only true if URL hash contains #qa or #debug

  // tapes
  const [tapeA, setTapeA] = useState(null);
  const [tapeB, setTapeB] = useState(null);
  const [tapeGhost, setTapeGhost] = useState(null);
  const [tapeMeta, setTapeMeta] = useState(null);
  const [busyTape, setBusyTape] = useState(false);
  const liveBufRef = useRef({ subj: [], ghost: [] }); // Preloaded RNG for the *next* live minute
  const nextLiveBufRef = useRef(null);

  // Fail-safe: generate local PRNG pairs if QRNG is slow/unavailable
  function localPairs(n) {
    const bytes = new Uint8Array(n * 2);
    crypto.getRandomValues(bytes);
    const subj = [],
      ghost = [];
    for (let i = 0; i < n; i++) {
      subj.push(bytes[2 * i] & 1);
      ghost.push(bytes[2 * i + 1] & 1);
    }
    return { subj, ghost, source: 'local_prng' };
  }

  function bytesToBits(bytes, nBits) {
    const bits = [];
    for (let i = 0; i < nBits; i++)
      bits.push((bytes[i >> 3] >>> (i & 7)) & 1);
    return bits;
  }
  async function makeTape(label = 'A') {
    const uidNow = uid || (await requireUid()); // ← guarantee a UID here too

    const nBytes = Math.ceil(C.RETRO_TAPE_BITS / 8);
    const { bytes, source } = await fetchBytes(nBytes);
    const H_tape = await sha256Hex(bytes);
    const createdISO = new Date().toISOString();
    const commitStr = [
      label,
      C.RETRO_TAPE_BITS,
      source,
      createdISO,
      H_tape,
    ].join('|');
    const H_commit = await sha256Hex(
      new TextEncoder().encode(commitStr)
    );
    const bits = bytesToBits(bytes, C.RETRO_TAPE_BITS);

    try {
      const tapesCol = collection(db, C.FIRESTORE_TAPES); // should be 'tapes'
      const tapeDocRef = await addDoc(tapesCol, {
        label,
        lenBits: C.RETRO_TAPE_BITS,
        createdAt: serverTimestamp(),
        createdAtISO: createdISO,
        providers: source,
        H_tape,
        H_commit,
        created_by: uidNow, // REQUIRED by your rules
        // (optional: add AES-GCM fields later if you encrypt client-side)
      });
      console.log('tapes/addDoc OK', tapeDocRef.id);
      return {
        label,
        bits,
        H_tape,
        H_commit,
        createdISO,
        tapeId: tapeDocRef.id,
      };
    } catch (e) {
      console.error('tapes/addDoc failed', {
        code: e.code,
        message: e.message,
      });
      throw e;
    }
  }

  async function prepareSessionArtifacts() {
    setBusyTape(true);
    try {
      const A = await makeTape('A');
      const G = await makeTape('GHOST');
      const B = C.RETRO_USE_TAPE_B_LAST ? await makeTape('B') : null;
      setTapeA(A);
      setTapeGhost(G);
      setTapeB(B);
      setTapeMeta({
        H_tape: A.H_tape,
        H_commit: A.H_commit,
        tapeId: A.tapeId,
        createdISO: A.createdISO,
      });
    } finally {
      setBusyTape(false);
    }
  }

  // schedule: 12 minutes alternating; start side counterbalanced from uid
  const schedule = useMemo(() => {
    const startLive = (uid || 'x').charCodeAt(0) % 2 === 0;
    return Array.from({ length: C.MINUTES_TOTAL }, (_, i) => {
      const live = i % 2 === 0 ? startLive : !startLive;
      return live ? 'live' : 'retro';
    });
  }, [uid]);

  // find the index of the last retro minute (for Tape B)
  const lastRetroIdx = useMemo(() => {
    let last = -1;
    schedule.forEach((k, i) => {
      if (k === 'retro') last = i;
    });
    return last;
  }, [schedule]);

  const [runRef, setRunRef] = useState(null);
  async function ensureRunDoc() {
    if (runRef) return runRef;

    // make sure target/prime are chosen before run creation
    if (!target || !primeCond)
      throw new Error(
        'logic/order: target and primeCond must be set before creating run'
      );

    const uidNow = uid || (await requireUid()); // ← guarantee a UID right now

    try {
      const col = collection(db, C.FIRESTORE_RUNS); // should be 'runs'
      const docRef = await addDoc(col, {
        participant_id: uidNow, // REQUIRED by your rules
        experimentId: C.EXPERIMENT_ID,
        createdAt: serverTimestamp(),
        target_side: target,
        prime_condition: primeCond,
        tape_meta: tapeMeta || null,
        minutes_planned: schedule,
      });
      setRunRef(docRef);
      // helpful console line while testing
      console.log('runs/addDoc OK', docRef.id);
      return docRef;
    } catch (e) {
      console.error('runs/addDoc failed', {
        code: e.code,
        message: e.message,
      });
      throw e;
    }
  }

  // minute engine
  const [phase, setPhase] = useState('onboarding');
  const [preparingNext, setPreparingNext] = useState(false);
  const [minuteIdx, setMinuteIdx] = useState(-1);
  const [isRunning, setIsRunning] = useState(false);
  const [bitsThisMinute, setBitsThisMinute] = useState([]);
  const [ghostBitsThisMinute, setGhostBitsThisMinute] = useState([]);
  const [alignedSeries, setAlignedSeries] = useState([]);
  const [hits, setHits] = useState(0);
  const [ghostHits, setGhostHits] = useState(0);
  // Mutable buffers to avoid per-trial state churn
  const bitsRef = useRef([]);
  const ghostBitsRef = useRef([]);
  const alignedRef = useRef([]);
  const hitsRef = useRef(0);
  const ghostHitsRef = useRef(0);

  const trialsPerMinute = Math.round(60 * C.VISUAL_HZ);
  const targetBit = target === 'RED' ? 1 : 0;

  const retroPassRef = useRef(0);

  const prefetchLivePairs = useCallback(
    async function prefetchLivePairs() {
      const n = trialsPerMinute;

      // Race QRNG vs a 1.5s timeout; on timeout, fall back to local PRNG
      const qrngPromise = (async () => {
        const { bytes, source } = await fetchBytes(n * 2);
        const subj = [],
          ghost = [];
        for (let i = 0; i < n; i++) {
          subj.push(bytes[2 * i] & 1);
          ghost.push(bytes[2 * i + 1] & 1);
        }
        return { subj, ghost, source };
      })();

      const timeout = new Promise((resolve) =>
        setTimeout(() => resolve(localPairs(n)), 1500)
      );

      const pairset = await Promise.race([qrngPromise, timeout]);
      nextLiveBufRef.current = pairset; // stage for the next live minute
      return pairset;
    },
    [trialsPerMinute]
  );
  async function ensureNextBlockReady(nextIdx) {
    const kindNext = schedule[nextIdx];

    if (kindNext === 'live') {
      // Make sure we have live pairs staged; if not, prefetch now
      if (!nextLiveBufRef.current) {
        await prefetchLivePairs();
      }
      // Consume staged pairs into the buffer used by the runner
      if (nextLiveBufRef.current) {
        liveBufRef.current = nextLiveBufRef.current;
        nextLiveBufRef.current = null;
      } else {
        // As a final fallback (very unlikely), synthesize locally
        const pairset = localPairs(Math.round(60 * C.VISUAL_HZ));
        liveBufRef.current = pairset;
      }
      return;
    }

    // Retro: make sure the tape we will use exists and has bits
    const isLastRetro =
      C.RETRO_USE_TAPE_B_LAST && nextIdx === lastRetroIdx;

    const srcBits = isLastRetro ? tapeB?.bits : tapeA?.bits;
    const ghostBits = tapeGhost?.bits;

    if (
      !srcBits ||
      !srcBits.length ||
      !ghostBits ||
      !ghostBits.length
    ) {
      throw new Error('tape-not-ready: missing A/B or GHOST bits');
    }
  }

  // 7Hz runner
  const rafRef = useRef(null),
    t0Ref = useRef(0),
    idxRef = useRef(0);
  const minuteWatchdogRef = useRef(null); // <-- add this
  const endMinuteRef = useRef(() => {}); // holds the latest endMinute

  function stopRAF() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }
  useEffect(() => {
    if (!isRunning) return;

    const TRIAL = 1000 / C.VISUAL_HZ;
    const DMS = 60_000; // keep 60 s blocks; change only if you use 30s blocks

    const isRetro = schedule[minuteIdx] === 'retro';
    const isLastRetro =
      isRetro &&
      C.RETRO_USE_TAPE_B_LAST &&
      minuteIdx === lastRetroIdx;

    // Guard: live must have a full buffer before we run
    if (!isRetro) {
      const ready =
        Array.isArray(liveBufRef.current?.subj) &&
        liveBufRef.current.subj.length >= trialsPerMinute &&
        Array.isArray(liveBufRef.current?.ghost) &&
        liveBufRef.current.ghost.length >= trialsPerMinute;
      if (!ready) {
        endMinuteRef.current();
        return;
      }
    }

    // Reset timers & index
    t0Ref.current = performance.now();
    idxRef.current = 0;

    // Watchdog: if the block exceeds duration by 1.5s, end it
    if (minuteWatchdogRef.current) {
      clearTimeout(minuteWatchdogRef.current);
      minuteWatchdogRef.current = null;
    }
    minuteWatchdogRef.current = setTimeout(() => {
      try {
        stopRAF();
      } catch {}
      endMinuteRef.current();
    }, DMS + 1500);

    // Source arrays
    const retroSrc = isRetro
      ? (isLastRetro ? tapeB?.bits : tapeA?.bits) || []
      : [];
    const ghostRetro = isRetro ? tapeGhost?.bits || [] : [];

    const tick = () => {
      const t = performance.now() - t0Ref.current;
      if (t >= DMS) {
        stopRAF();
        endMinuteRef.current();

        return;
      }

      const nextIdx = Math.floor(t / TRIAL);
      while (idxRef.current <= nextIdx) {
        const i = idxRef.current++;
        let bit, ghost;
        if (isRetro) {
          bit = retroSrc[i % (retroSrc.length || 1)] || 0;
          ghost = ghostRetro[i % (ghostRetro.length || 1)] || 0;
        } else {
          bit = liveBufRef.current.subj[i] ?? 0;
          ghost = liveBufRef.current.ghost[i] ?? 0;
        }

        // Push to mutable buffers (no React setState here!)
        bitsRef.current.push(bit);
        ghostBitsRef.current.push(ghost);

        const align = bit === targetBit ? 1 : 0;
        const alignGhost = ghost === targetBit ? 1 : 0;
        alignedRef.current.push(align);
        hitsRef.current += align;
        ghostHitsRef.current += alignGhost;
      }

      // Commit once per frame
      setBitsThisMinute([...bitsRef.current]);
      setGhostBitsThisMinute([...ghostBitsRef.current]);
      setAlignedSeries([...alignedRef.current]);
      setHits(hitsRef.current);
      setGhostHits(ghostHitsRef.current);

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    // Cleanup
    return () => {
      stopRAF();
      if (minuteWatchdogRef.current) {
        clearTimeout(minuteWatchdogRef.current);
        minuteWatchdogRef.current = null;
      }
    };
  }, [
    isRunning,
    minuteIdx,
    tapeA,
    tapeB,
    tapeGhost,
    schedule,
    targetBit,
    lastRetroIdx,
    trialsPerMinute,
  ]);

  useEffect(() => {
    const next = minuteIdx + 1;
    const willBeLive = schedule[next] === 'live';
    // When NOT running (onboarding/prime/rest), if next is live and not staged, prefetch now
    if (
      phase !== 'running' &&
      willBeLive &&
      !nextLiveBufRef.current
    ) {
      prefetchLivePairs().catch(() => {
        // ignore; startNextMinute will still fetch (with fallback) if needed
      });
    }
  }, [phase, minuteIdx, schedule, prefetchLivePairs]);

  async function startNextMinute() {
    const next = minuteIdx + 1;

    // Show "preparing…" and block until ready
    setPreparingNext(true);
    await ensureNextBlockReady(next);
    setPreparingNext(false);

    // Now flip to flashing UI and start
    setPhase('running');
    setMinuteIdx(next);

    if (schedule[next] === 'retro') retroPassRef.current += 1;

    // Reset per-block accumulators
    setBitsThisMinute([]);
    setGhostBitsThisMinute([]);
    setAlignedSeries([]);
    setHits(0);
    setGhostHits(0);
    // Reset the mutable buffers too
    bitsRef.current = [];
    ghostBitsRef.current = [];
    alignedRef.current = [];
    hitsRef.current = 0;
    ghostHitsRef.current = 0;

    setIsRunning(true);
  }

  async function endMinute() {
    setIsRunning(false);
    await persistMinute();
    if (minuteIdx + 1 >= C.MINUTES_TOTAL) setPhase('done');
    else setPhase('rest');
  }

  async function persistMinute() {
    if (!runRef) return;
    const n = alignedSeries.length;
    const k = hits;
    const kg = ghostHits;
    const z = zFromBinom(k, n, 0.5);
    const pTwo = twoSidedP(z);
    const zg = zFromBinom(kg, n, 0.5);
    const pg = twoSidedP(zg);
    const cohRange = cumulativeRange(bitsThisMinute);
    const hurst = hurstApprox(bitsThisMinute);
    const ac1 = lag1Autocorr(bitsThisMinute);
    const gCohRange = cumulativeRange(ghostBitsThisMinute);
    const gHurst = hurstApprox(ghostBitsThisMinute);
    const gAc1 = lag1Autocorr(ghostBitsThisMinute);
    const kind = schedule[minuteIdx];
    const isLastRetro =
      kind === 'retro' &&
      C.RETRO_USE_TAPE_B_LAST &&
      minuteIdx === lastRetroIdx;
    const mdoc = doc(runRef, 'minutes', String(minuteIdx));

    await setDoc(
      mdoc,
      {
        idx: minuteIdx,
        kind,
        startedAt: serverTimestamp(),
        n,
        hits: k,
        z,
        pTwo,
        ghost_hits: kg,
        ghost_z: zg,
        ghost_pTwo: pg,
        target: target,
        prime_condition: primeCond,

        // record the tape actually used this minute (A by default; B only on last retro)
        tape_meta:
          kind === 'retro'
            ? isLastRetro
              ? {
                  H_tape: tapeB?.H_tape,
                  H_commit: tapeB?.H_commit,
                  tapeId: tapeB?.tapeId,
                }
              : {
                  H_tape: tapeA?.H_tape,
                  H_commit: tapeA?.H_commit,
                  tapeId: tapeA?.tapeId,
                }
            : null,

        coherence: { cumRange: cohRange, hurst },
        resonance: { ac1 },

        // include ghost coherence/resonance so ESLint doesn't flag ghostBits as unused
        ghost_metrics: {
          coherence: { cumRange: gCohRange, hurst: gHurst },
          resonance: { ac1: gAc1 },
        },

        // single replay object (no duplicate key)
        replay:
          kind === 'retro'
            ? {
                passIndex: retroPassRef.current,
                tape: isLastRetro ? 'B' : 'A',
              }
            : null,
      },
      { merge: true }
    );
  }

  // flow
  if (!userReady || !target)
    return <div style={{ padding: 24 }}>Loading…</div>;

  if (phase === 'onboarding') {
    return (
      <div style={{ padding: 24, maxWidth: 760 }}>
        <h1>PK / Retro-PK — Pilot</h1>
        <p>
          <strong>Your target:</strong>{' '}
          {target === 'RED' ? '🟥 RED' : '🟩 GREEN'}. Keep this target
          the entire session.
        </p>
        <ul>
          <li>
            You’ll complete a series of short blocks with brief
            breathers.
          </li>

          <li>
            7 Hz flashes; the small meter shows short-term average;
            nudge it toward your target.
          </li>
        </ul>
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <button
            disabled={busyTape}
            onClick={prepareSessionArtifacts}
          >
            {busyTape ? 'Creating tapes…' : 'Create session tapes'}
          </button>
          {tapeA && (
            <div style={{ fontSize: 12, opacity: 0.8 }}>
              {/* TapeA H_tape={tapeA.H_tape.slice(0, 10)}… H_commit=
              {tapeA.H_commit.slice(0, 10)}… */}
              Tapes ready ✓
            </div>
          )}
        </div>
        <div style={{ marginTop: 12 }}>
          <button
            disabled={!tapeA}
            onClick={async () => {
              await ensureRunDoc();
              setPhase('prime');
            }}
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'prime') {
    return (
      <div style={{ padding: 24 }}>
        <h2>{primeCond === 'prime' ? 'Priming' : 'Neutral'}</h2>
        <div
          style={{
            height: 220,
            border: '1px solid #ddd',
            padding: 16,
            borderRadius: 12,
          }}
        >
          {primeCond === 'prime' ? (
            <ul>
              <li>“Think like a physicist.” — John A. Wheeler</li>
              <li>
                Schmidt/Rhine explored mind–matter effects seriously.
              </li>
              <li>
                Breathe and steer gently; playful nudge, not force.
              </li>
            </ul>
          ) : (
            <ul>
              <li>
                Fun fact: mantis shrimp can see polarized light.
              </li>
              <li>Paper beats rock 54% after a loss (bias study).</li>
              <li>We’ll begin shortly.</li>
            </ul>
          )}
        </div>
        <AutoAdvance
          seconds={38}
          onDone={() => {
            startNextMinute();
          }}
        />
        <div style={{ marginTop: 8 }}>
          <button
            onClick={() => {
              startNextMinute();
            }}
          >
            Start now
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'rest') {
    const nextIdx = minuteIdx + 1;
    const nextKind = schedule[nextIdx];
    const nextIsLastRetro =
      nextKind === 'retro' &&
      C.RETRO_USE_TAPE_B_LAST &&
      nextIdx === lastRetroIdx;

    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <p>Take a short breather…</p>
        <p>
          Next block starting soon
          {debugUI && (
            <>
              {': '}
              <strong>
                {nextKind === 'live'
                  ? 'Live'
                  : `Retro (Tape ${nextIsLastRetro ? 'B' : 'A'})`}
              </strong>
            </>
          )}
        </p>
        {preparingNext && (
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
            Preparing next block…
          </div>
        )}

        <AutoAdvance
          seconds={C.REST_MS / 1000}
          onDone={() => {
            startNextMinute();
          }}
        />
      </div>
    );
  }

  if (phase === 'running') {
    const isLive = schedule[minuteIdx] === 'live';
    return (
      <div
        style={{
          height: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#000',
        }}
      >
        <FlashPanel
          bit={bitsThisMinute[bitsThisMinute.length - 1] ?? 0}
          lowContrast={lowContrast}
          patterns={patternsMode}
        />
        <div
          style={{
            position: 'fixed',
            left: 16,
            top: 16,
            background: '#fff',
            padding: '8px 12px',
            borderRadius: 8,
          }}
        >
          <div>
            Minute {minuteIdx + 1}/{C.MINUTES_TOTAL}
            {debugUI && (
              <>
                {' — '}
                <strong>{isLive ? 'Live' : 'Retro'}</strong>
                {isLive &&
                  liveBufRef.current?.source &&
                  liveBufRef.current?.subj && (
                    <span style={{ marginLeft: 6, opacity: 0.7 }}>
                      [{liveBufRef.current.source} ·{' '}
                      {liveBufRef.current.subj.length}]
                    </span>
                  )}
              </>
            )}
            {' — '}Target: {target === 'RED' ? '🟥' : '🟩'}
          </div>

          {(() => {
            const n = alignedSeries.length;
            const k = hits;
            const minuteVal = n ? k / n : 0.5;
            const trialsPlanned = Math.round(60 * C.VISUAL_HZ);
            const toward = targetBit === 1 ? 'RED' : 'GREEN';

            return (
              <>
                <CircularGauge
                  value={minuteVal}
                  targetBit={targetBit}
                  label={`Toward ${toward}`}
                  subLabel={`This minute average`}
                />
                <div
                  style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}
                >
                  Trial {n}/{trialsPlanned} · This minute:{' '}
                  <strong>{Math.round(minuteVal * 100)}%</strong>
                </div>
                {!isLive && (
                  <div
                    style={{
                      fontSize: 12,
                      opacity: 0.7,
                      marginTop: 4,
                    }}
                  >
                    Tape A pos{' '}
                    {(alignedSeries.length % C.RETRO_TAPE_BITS) + 1}/
                    {C.RETRO_TAPE_BITS}
                  </div>
                )}
              </>
            );
          })()}

          <div
            style={{
              marginTop: 6,
              display: 'flex',
              gap: 8,
              alignItems: 'center',
            }}
          >
            <label>
              <input
                type="checkbox"
                checked={lowContrast}
                onChange={(e) => setLowContrast(e.target.checked)}
              />{' '}
              Low-contrast
            </label>
            <label>
              <input
                type="checkbox"
                checked={patternsMode}
                onChange={(e) => setPatternsMode(e.target.checked)}
              />{' '}
              Patterns
            </label>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'done') {
    return (
      <div style={{ padding: 24 }}>
        <h2>All done — thank you!</h2>
        <p>
          Run ID: <code>{runRef?.id}</code>
        </p>
        <p>
          We recorded Live vs Retro minutes, ghost channel, and the
          tape commitment.
        </p>
      </div>
    );
  }

  return null;
}
