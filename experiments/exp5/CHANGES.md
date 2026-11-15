# Exp5 — Changes

The earlier contents of this file documented the prescreen eligibility system (KS and shuffle-collapse gates, gold/silver/candidate ranks, intensity tiers, PCS and artifact warnings, `computeSessionAnalysis` / `evaluatePrescreen`). That system has been removed from the app and those notes no longer describe the code. They remain in git history.

For the current design see `README.md`. For open problems see `notebooks/KNOWN_ISSUES.md`.

## Current state (as of 2026-10-27)

- No in-app scoring, gating or ranking. The app collects data and shows participants hit rate only.
- 80 blocks per session, 301 bits per block, `TARGET_SESSIONS: 5`, `MAX_SESSIONS_FOR_ANALYSIS: 20`.
- Target colour is fixed for the whole session (`TARGET_ASSIGNMENT: 'per_session'`).
- Bit source is `qrng-race` (Outshift, then LFDR).
- Session docs go to `experiment5_responses`, with `block_commits`, `minutes` and `audits` subcollections.
