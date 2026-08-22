# Known Issues — fix before this app goes live

Found 2026-08-20 while comparing this codebase against exp5-prescreen (which
went through the same refactor these issues describe). Both items below are
carried-over legacy code, not something specific to exp5's own design intent.

## 1. Subject/PCS split still uses the old same-call assignment bit

`src/hooks/useTrialRunner.js` calls `splitBlockBits(quantumBits, C.TRIALS_PER_BLOCK)`
with no separate assignment bit — the split is still decided by bit 0 of the
same QRNG call that generates the block's content, exactly the design the
manuscript's own §5.9 ("Timing of stream assignment") flags as a limitation:
assignment and content share one physical generation event, so a genuine
Subject-specific finding can't be cleanly distinguished from a same-call
artifact tied to the assignment bit itself.

exp5-prescreen already has the fix: a separate, dedicated `random.org` call
made *before* the block's content bits are fetched, so the split is decided
and committed to Firestore before the content that will be labeled Subject or
PCS even exists. See `experiments/exp5-prescreen/src/hooks/useTrialRunner.js`
(the `ASSIGNMENT_BIT_INDEX` / assignment-call block near the top of the
fetching effect) and `experiments/exp5-prescreen/src/lib/trialBlock.js`
(`splitBlockBits` takes the assignment bit as an explicit param now, not
`rawBitString[0]`).

Porting that fix here is a straightforward copy of the pattern, not a design
question — it's already resolved and tested elsewhere in this repo.

## 2. Legacy per-session history reconstruction — expensive, and nothing uses the arrays

`src/hooks/useParticipantProfile.js`'s `loadParticipant`/`loadAutoParticipant`
query up to 50 past completed sessions and reconstruct their full per-block
Hurst arrays and raw-bit arrays (`buildParticipantHistory`, `pastH_s`,
`pastH_d`, `pastBits`, `pastDemonBits`) on every session start.

Checked what actually consumes those arrays in `MainApp.jsx`: nothing.
`usePrescreenAnalysis.js` (the hook that used to consume them for scoring)
was already deleted from this codebase. The only things actually read out of
that whole reconstruction are two scalars, `pastSubjectHits` and
`pastDemonTrials`, used once for the results screen's cumulative-average
display (`MainApp.jsx` around the `phase === 'results'` block). Everything
else pulled out of Firestore and rebuilt into arrays on every session load is
pure dead weight.

exp5-prescreen replaced this with two cheap running scalars
(`cumulative_hits`, `cumulative_trials`) stored directly on the participant
profile doc, updated via Firestore's atomic `increment()` in the session
completion write — no history query, no array reconstruction, one existing
document read. See `experiments/exp5-prescreen/src/hooks/useSessionPersistence.js`
(the completion effect) and `experiments/exp5-prescreen/src/MainApp.jsx`
(`cumSubjectHitRate` calc in the results screen) for the pattern to port.

Once ported, `useParticipantProfile.js` can drop `pastH_s`/`pastH_d`/
`pastBits`/`pastDemonBits`/`usableSessionCount`/`setCumulativeHistory` and the
`buildParticipantHistory` import/query entirely — same simplification already
done in exp5-prescreen's version of this file.
