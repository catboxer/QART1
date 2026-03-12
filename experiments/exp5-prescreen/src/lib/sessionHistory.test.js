import { buildParticipantHistory } from './sessionHistory';
import { packBitsToBase64 } from './rawBitsCodec';

// Minimal config — actual Hurst/stat values are irrelevant here
const C = { BITS_PER_BLOCK: 5, TRIALS_PER_BLOCK: 2 };

// Fake Firestore doc snapshot
function makeSnap(data) {
  return { data: () => data };
}

// 5-bit blocks: assignment=1, halfA=[0,1], halfB=[1,0]
function makeBitsB64(nBlocks) {
  return packBitsToBase64(Array.from({ length: nBlocks }, () => [1, 0, 1, 1, 0]));
}

describe('buildParticipantHistory', () => {
  test('empty docs → all zeros, empty arrays', () => {
    expect(buildParticipantHistory([], C)).toEqual({
      sessionCount: 0, usableSessionCount: 0,
      pastH_s: [], pastH_d: [], pastBits: [], pastDemonBits: [],
      pastDemonHits: 0, pastDemonTrials: 0,
    });
  });

  test('non-human (baseline / ai_agent) sessions are ignored entirely', () => {
    const snaps = [
      makeSnap({ session_type: 'baseline',
        aggregates: { hurst_subject: [0.5], hurst_demon: [0.5] },
        raw_bits_b64: makeBitsB64(1) }),
      makeSnap({ session_type: 'ai_agent',
        aggregates: { hurst_subject: [0.5], hurst_demon: [0.5] },
        raw_bits_b64: makeBitsB64(1) }),
    ];
    const r = buildParticipantHistory(snaps, C);
    expect(r.sessionCount).toBe(0);
    expect(r.usableSessionCount).toBe(0);
  });

  test('missing hurst_demon: no TypeError, counted in sessionCount but excluded from usable', () => {
    // This was the crash: cumH_d.push(...undefined) threw on old sessions
    const snap = makeSnap({
      session_type: 'human',
      aggregates: { hurst_subject: [0.55] }, // no hurst_demon field
      raw_bits_b64: makeBitsB64(1),
    });
    expect(() => buildParticipantHistory([snap], C)).not.toThrow();
    const r = buildParticipantHistory([snap], C);
    expect(r.sessionCount).toBe(1);        // counted for display
    expect(r.usableSessionCount).toBe(0);  // excluded from analysis gate
    expect(r.pastH_s).toEqual([]);
  });

  test('missing raw_bits_b64: counted in sessionCount but excluded from usable', () => {
    const snap = makeSnap({
      session_type: 'human',
      aggregates: { hurst_subject: [0.55], hurst_demon: [0.50] },
      // no raw_bits_b64
    });
    const r = buildParticipantHistory([snap], C);
    expect(r.sessionCount).toBe(1);
    expect(r.usableSessionCount).toBe(0);
  });

  test('valid human session populates both counts and all payload arrays', () => {
    const snap = makeSnap({
      session_type: 'human',
      aggregates: {
        hurst_subject: [0.55, 0.60],
        hurst_demon:   [0.52, 0.48],
        totalGhostHits: 7,
        totalTrials:    12,
      },
      raw_bits_b64: makeBitsB64(2),
    });
    const r = buildParticipantHistory([snap], C);
    expect(r.sessionCount).toBe(1);
    expect(r.usableSessionCount).toBe(1);
    expect(r.pastH_s).toEqual([0.55, 0.60]);
    expect(r.pastH_d).toEqual([0.52, 0.48]);
    expect(r.pastBits).toHaveLength(2);           // one entry per block
    expect(r.pastBits[0]).toHaveLength(2);        // TRIALS_PER_BLOCK bits per entry
    expect(r.pastDemonBits).toHaveLength(2);      // demon bits: same shape
    expect(r.pastDemonBits[0]).toHaveLength(2);
    expect(r.pastDemonHits).toBe(7);
    expect(r.pastDemonTrials).toBe(12);
  });

  test('session_type absent → treated as human', () => {
    const snap = makeSnap({
      // no session_type field
      aggregates: { hurst_subject: [0.5], hurst_demon: [0.5] },
      raw_bits_b64: makeBitsB64(1),
    });
    const r = buildParticipantHistory([snap], C);
    expect(r.sessionCount).toBe(1);
    expect(r.usableSessionCount).toBe(1);
  });

  test('mixed sessions: sessionCount = all human, usableSessionCount = fully valid only', () => {
    const valid = makeSnap({
      session_type: 'human',
      aggregates: { hurst_subject: [0.5], hurst_demon: [0.5],
        totalGhostHits: 2, totalTrials: 4 },
      raw_bits_b64: makeBitsB64(1),
    });
    const missingDemon = makeSnap({
      session_type: 'human',
      aggregates: { hurst_subject: [0.5] }, // no hurst_demon → usable=false
      raw_bits_b64: makeBitsB64(1),
    });
    const noBits = makeSnap({
      session_type: 'human',
      aggregates: { hurst_subject: [0.5], hurst_demon: [0.5] },
      // no raw_bits_b64 → usable=false
    });
    const baseline = makeSnap({
      session_type: 'baseline',
      aggregates: { hurst_subject: [0.5], hurst_demon: [0.5] },
      raw_bits_b64: makeBitsB64(1),
    });
    const r = buildParticipantHistory([valid, missingDemon, noBits, baseline], C);
    expect(r.sessionCount).toBe(3);        // valid + missingDemon + noBits (all human)
    expect(r.usableSessionCount).toBe(1);  // only valid
    expect(r.pastH_s).toEqual([0.5]);      // only valid session's Hurst values
  });

  test('multiple valid sessions accumulate arrays and counts correctly', () => {
    const s1 = makeSnap({
      session_type: 'human',
      aggregates: { hurst_subject: [0.55], hurst_demon: [0.50],
        totalGhostHits: 3, totalTrials: 6 },
      raw_bits_b64: makeBitsB64(1),
    });
    const s2 = makeSnap({
      session_type: 'human',
      aggregates: { hurst_subject: [0.60], hurst_demon: [0.48],
        totalGhostHits: 2, totalTrials: 6 },
      raw_bits_b64: makeBitsB64(1),
    });
    const r = buildParticipantHistory([s1, s2], C);
    expect(r.sessionCount).toBe(2);
    expect(r.usableSessionCount).toBe(2);
    expect(r.pastH_s).toEqual([0.55, 0.60]);
    expect(r.pastH_d).toEqual([0.50, 0.48]);
    expect(r.pastDemonHits).toBe(5);
    expect(r.pastDemonTrials).toBe(12);
  });
});
