import { renderHook, waitFor } from '@testing-library/react';
import { usePrescreenAnalysis } from './usePrescreenAnalysis';
import { computeSessionAnalysis, evaluatePrescreen } from '../stats/index.js';

jest.mock('firebase/firestore', () => ({
  doc: jest.fn(() => 'mock-doc-ref'),
  setDoc: jest.fn(() => Promise.resolve()),
  serverTimestamp: jest.fn(() => null),
}));

jest.mock('../stats/index.js', () => ({
  computeSessionAnalysis: jest.fn(),
  evaluatePrescreen: jest.fn(),
}));

const C = {
  NULL_HURST_MEAN: 0.5,
  NULL_HURST_SD: 0.1,
  N_SHUFFLES: 10,
  MIN_SESSIONS_FOR_DECISION: 5,
  BLOCKS_TOTAL: 4,
  PARTICIPANT_COLLECTION: 'test_participants',
};

// Shape needed for Effect 3's setDoc destructuring
const MOCK_ANALYSIS = {
  ks:              { originalP: 0.05 },
  shuffleSubject:  { collapseP: 0.02, dDrop: 0.22 },
  shuffleDemon:    { collapseP: 0.30, dDrop: 0.05, available: true },
  artifactContrast:{ deltaDGap: 0.17 },
  pcs:             { nullZ: 0, ghostZ: 0, sdRatio: 1, crossCorr: 0 },
};

const ELIGIBLE_EVAL = {
  rank: 'gold', eligible: true,
  ksGate: true, collapseGate: true,
  intensityTier: 'high', pcsWarning: false, pcsFlags: {}, artifactWarning: false,
};

const NONE_EVAL = {
  rank: 'none', eligible: false,
  ksGate: false, collapseGate: false,
  intensityTier: null, pcsWarning: false, pcsFlags: {}, artifactWarning: false,
};

// Minimal props: no Firestore writes (runRef=null, participantHash=null)
function makeProps(overrides = {}) {
  return {
    db: {},
    C,
    phase: 'results',
    sessionCount: 0,
    usableSessionCount: 0,
    isAutoMode: false,
    isAIMode: false,
    hurstSubjectHistory: [0.55, 0.60, 0.52, 0.58],
    hurstDemonHistory:   [0.50, 0.48, 0.51, 0.49],
    subjectBitsHistory:  [[1,0,1],[0,1,0],[1,1,0],[0,0,1]],
    demonBitsHistory:    [[0,1,0],[1,0,1],[0,0,1],[1,1,0]],
    totalGhostHits: 2,
    totals: { k: 85, n: 150 },
    pastH_s: [],
    pastH_d: [],
    pastBits: [],
    pastDemonBits: [],
    pastDemonHits: 0,
    pastDemonTrials: 0,
    runRef: null,
    allRawBitsRef: { current: [] },
    participantHash: null,
    participantProfile: null,
    emailPlaintext: '',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  computeSessionAnalysis.mockReturnValue(MOCK_ANALYSIS);
  evaluatePrescreen.mockReturnValue(ELIGIBLE_EVAL);
});

// ── Session analysis (Effect 1) ───────────────────────────────────────────────

describe('usePrescreenAnalysis — session analysis', () => {
  test('sessionAnalysis is null before results phase', () => {
    const { result } = renderHook(() =>
      usePrescreenAnalysis(makeProps({ phase: 'score' }))
    );
    expect(result.current.sessionAnalysis).toBeNull();
    expect(computeSessionAnalysis).not.toHaveBeenCalled();
  });

  test('sessionAnalysis is computed when phase becomes results', async () => {
    const { result } = renderHook(() =>
      usePrescreenAnalysis(makeProps())
    );
    await waitFor(() => expect(result.current.sessionAnalysis).not.toBeNull());
    expect(computeSessionAnalysis).toHaveBeenCalledTimes(1);
  });

  test('sessionAnalysis is not computed when hurstSubjectHistory is empty', async () => {
    const { result } = renderHook(() =>
      usePrescreenAnalysis(makeProps({ hurstSubjectHistory: [], hurstDemonHistory: [] }))
    );
    // Give effects a chance to fire
    await new Promise(r => setTimeout(r, 30));
    expect(result.current.sessionAnalysis).toBeNull();
    expect(computeSessionAnalysis).not.toHaveBeenCalled();
  });
});

// ── 5-session invite gate ─────────────────────────────────────────────────────

describe('usePrescreenAnalysis — 5-session invite gate', () => {
  test('showInvite and eligible are false before cumulative (usableSessionCount = 0)', async () => {
    const { result } = renderHook(() =>
      usePrescreenAnalysis(makeProps({ usableSessionCount: 0 }))
    );
    await waitFor(() => expect(result.current.sessionAnalysis).not.toBeNull());
    expect(result.current.isCumulativeReady).toBe(false);
    expect(result.current.decision.eligible).toBe(false);
    expect(result.current.inviteStatus.showInvite).toBe(false);
  });

  test('gold session rank visible in decision.rank before session 5, but invite stays closed', async () => {
    // This was the behavioral regression: session-level gold was unlocking the invite
    evaluatePrescreen.mockReturnValue(ELIGIBLE_EVAL);
    const { result } = renderHook(() =>
      usePrescreenAnalysis(makeProps({ usableSessionCount: 3 }))
    );
    // usableSessionCount=3 → usableNewCount=4 < 5 → no cumulative
    await waitFor(() => expect(result.current.sessionAnalysis).not.toBeNull());
    expect(result.current.decision.rank).toBe('gold');     // rank hint still shows
    expect(result.current.decision.eligible).toBe(false);  // but eligible is blocked
    expect(result.current.inviteStatus.showInvite).toBe(false);
  });

  test('isCumulativeReady and showInvite unlock at session 5 (usableSessionCount = 4)', async () => {
    const { result } = renderHook(() =>
      usePrescreenAnalysis(makeProps({
        usableSessionCount: 4,  // 4 past usable + current = 5
        pastH_s: [0.55, 0.60, 0.52, 0.58],
        pastH_d: [0.50, 0.48, 0.51, 0.49],
        pastBits: [[1,0,1],[0,1,0],[1,1,0],[0,0,1]],
        pastDemonBits: [[0,1,0],[1,0,1],[0,0,1],[1,1,0]],
      }))
    );
    await waitFor(() => expect(result.current.isCumulativeReady).toBe(true));
    expect(result.current.decision.eligible).toBe(true);
    expect(result.current.decision.scope).toBe('cumulative');
    expect(result.current.inviteStatus.showInvite).toBe(true);
    expect(result.current.inviteStatus.category).toBe('eligible');
  });

  test('candidate rank at session 5 triggers showInvite with candidate_review category', async () => {
    evaluatePrescreen.mockReturnValue({ ...ELIGIBLE_EVAL, rank: 'candidate', eligible: false });
    const { result } = renderHook(() =>
      usePrescreenAnalysis(makeProps({
        usableSessionCount: 4,
        pastH_s: [0.55, 0.60, 0.52, 0.58],
        pastH_d: [0.50, 0.48, 0.51, 0.49],
        pastBits: [[1,0,1],[0,1,0],[1,1,0],[0,0,1]],
        pastDemonBits: [[0,1,0],[1,0,1],[0,0,1],[1,1,0]],
      }))
    );
    await waitFor(() => expect(result.current.isCumulativeReady).toBe(true));
    expect(result.current.inviteStatus.showInvite).toBe(true);
    expect(result.current.inviteStatus.category).toBe('candidate_review');
    expect(result.current.decision.eligible).toBe(false); // candidate ≠ eligible
  });

  test('non-eligible cumulative rank keeps showInvite false', async () => {
    evaluatePrescreen.mockReturnValue(NONE_EVAL);
    const { result } = renderHook(() =>
      usePrescreenAnalysis(makeProps({
        usableSessionCount: 4,
        pastH_s: [0.55, 0.60, 0.52, 0.58],
        pastH_d: [0.50, 0.48, 0.51, 0.49],
        pastBits: [[1,0,1],[0,1,0],[1,1,0],[0,0,1]],
        pastDemonBits: [[0,1,0],[1,0,1],[0,0,1],[1,1,0]],
      }))
    );
    await waitFor(() => expect(result.current.isCumulativeReady).toBe(true));
    expect(result.current.inviteStatus.showInvite).toBe(false);
    expect(result.current.inviteStatus.category).toBe('none');
    expect(result.current.decision.eligible).toBe(false);
  });

  test('session 4 usable (usableSessionCount = 3) does not trigger cumulative analysis', async () => {
    const { result } = renderHook(() =>
      usePrescreenAnalysis(makeProps({
        usableSessionCount: 3,  // 3 past usable + current = 4 < MIN_SESSIONS_FOR_DECISION
        pastH_s: [0.55, 0.60, 0.52],
        pastH_d: [0.50, 0.48, 0.51],
        pastBits: [[1,0,1],[0,1,0],[1,1,0]],
        pastDemonBits: [[0,1,0],[1,0,1],[0,0,1]],
      }))
    );
    await waitFor(() => expect(result.current.sessionAnalysis).not.toBeNull());
    expect(result.current.isCumulativeReady).toBe(false);
    expect(computeSessionAnalysis).toHaveBeenCalledTimes(1);
  });
});

// ── Auto-mode / AI-mode guardrails ────────────────────────────────────────────

describe('usePrescreenAnalysis — mode guards', () => {
  test('auto-mode skips cumulative analysis regardless of usableSessionCount', async () => {
    const { result } = renderHook(() =>
      usePrescreenAnalysis(makeProps({
        isAutoMode: true,
        usableSessionCount: 10,
        pastH_s: [0.55, 0.60, 0.52, 0.58],
        pastH_d: [0.50, 0.48, 0.51, 0.49],
        pastBits: [[1,0,1],[0,1,0],[1,1,0],[0,0,1]],
        pastDemonBits: [[0,1,0],[1,0,1],[0,0,1],[1,1,0]],
      }))
    );
    // Session analysis still runs (Effect 1 is unconditional on mode)
    await waitFor(() => expect(result.current.sessionAnalysis).not.toBeNull());
    expect(result.current.isCumulativeReady).toBe(false);
    expect(result.current.inviteStatus.showInvite).toBe(false);
  });

  test('AI-mode skips cumulative analysis regardless of usableSessionCount', async () => {
    const { result } = renderHook(() =>
      usePrescreenAnalysis(makeProps({
        isAIMode: true,
        usableSessionCount: 10,
        pastH_s: [0.55, 0.60, 0.52, 0.58],
        pastH_d: [0.50, 0.48, 0.51, 0.49],
        pastBits: [[1,0,1],[0,1,0],[1,1,0],[0,0,1]],
        pastDemonBits: [[0,1,0],[1,0,1],[0,0,1],[1,1,0]],
      }))
    );
    await waitFor(() => expect(result.current.sessionAnalysis).not.toBeNull());
    expect(result.current.isCumulativeReady).toBe(false);
    expect(result.current.inviteStatus.showInvite).toBe(false);
  });
});
