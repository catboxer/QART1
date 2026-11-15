# Experiment 5

## Purpose

A multi-session study of whether the temporal ordering of a quantum random bit sequence differs between a stream a participant focuses on (the **subject** stream) and an uninfluenced paired **demon/control** stream. Each participant is asked for 5 sessions of 80 blocks (`TARGET_SESSIONS`), alongside automated Baseline sessions (`#auto`) and AI-agent sessions (`#ai`).

This app was forked from the exp5-prescreen codebase. **It no longer contains any prescreen, gate, rank or eligibility logic.** The KS gate, shuffle-collapse gate, gold/silver/candidate ranks, intensity tiers, PCS/artifact warnings, cumulative verdicts and invite form were all removed; `stats/prescreen.js` and `usePrescreenAnalysis.js` no longer exist. Nobody is screened in or out inside the app, and no score is computed in the browser beyond the hit rate shown to participants.

Design decisions and power analysis live in `notebooks/` (start with `Exp5_Design_Decisions_2026-08-21.md`). Items to fix before going live are in `notebooks/KNOWN_ISSUES.md`.

---

## Experiment Design

Each session has **80 blocks** (`BLOCKS_TOTAL`). Each block:

1. The participant sees their target colour (blue or orange). It is drawn once at session start and held for all 80 blocks (`TARGET_ASSIGNMENT: 'per_session'`).
2. The participant focuses on the target and presses "I'm Ready".
3. **301 quantum bits** are fetched (`BITS_PER_BLOCK = 1 + 2 × 150`): 1 assignment bit, 150 bits in half A, 150 bits in half B.
4. Bit 0 decides which half is the subject stream and which is the demon stream.
5. Hit rate and Hurst exponent are computed for both streams.
6. Results are shown and the participant rests before the next block.

Every 10 blocks (`AUDIT_EVERY_N_BLOCKS`) an **RNG quality audit** fetches 1,000 bits and runs three NIST SP 800-22 tests (Frequency/Monobit, Runs, Longest Run; pass at p ≥ 0.01). A failed audit increments `audit_failure_count` and appends to `audit_failed_blocks` on the session doc. It does not stop the session.

**Bit source (`QRNG_SOURCE: 'qrng-race'`):** Outshift QRNG, then LFDR. ANU is disabled. If the daily Outshift limit is hit, the session falls through to LFDR. `'random-org'` and `'crypto-test'` exist for development only and must not be used for real data.

**Known issue:** the assignment bit is still bit 0 of the same QRNG call that supplies the block's content, not an independent earlier draw. See `notebooks/KNOWN_ISSUES.md` item 1.

---

## What Is Measured

The primary quantity is **not hit rate**. Hit rate is a goal shown to the participant. The analysis asks whether the Hurst-exponent difference **ΔH = H_subject − H_demon** per block differs from what the paired demon stream produces. Analysis is done offline (Colab, from Firestore), not in the app. See `notebooks/` for the power analysis and design decisions.

What the app does show participants:
- Per-block score.
- A session hit-rate result screen.
- A cumulative hit-rate average across completed sessions (from `pastSubjectHits` / `pastDemonTrials`).

---

## Configuration (`src/config.js`, `pkConfig`)

```
EXPERIMENT_ID:              hurst_exp5_v1
APP_VERSION:                exp5.1
QRNG_SOURCE:                qrng-race
TRIALS_PER_BLOCK:           150   — per stream
BITS_PER_BLOCK:             301   — 1 + 2 × TRIALS_PER_BLOCK (derived)
BLOCKS_TOTAL:               80
TARGET_SESSIONS:            5     — soft target, does not block further sessions
MAX_SESSIONS_FOR_ANALYSIS:  20    — hard cap enforced at the consent gate
TARGET_ASSIGNMENT:          per_session
AUDIT_EVERY_N_BLOCKS:       10
AUDIT_BITS_PER_BREAK:       1000
AUTO_MODE_SESSIONS:         5     — #auto
AUTO_MODE_REST_MS:          1000
AI_MODE_SESSIONS:           5     — #ai
```

---

## Session Linking

Participants may give an email at consent. The document ID of their profile is `SHA-256(lowercased, trimmed email)[0:32]` (unsalted).

- Plaintext email is stored **only** in `experiment5_email_lookup`, kept separate from research data and never released with it.
- `experiment5_participants` holds scalars only: `session_count`, `last_session_date`, `pre_q_completed`, `participant_type`, `email_opt_in`, timestamps.
- Without an email, sessions fall back to the Firebase anonymous uid, and the counter is kept in `participants/{uid}` (`exp5_sessions`, same device only).
- For `#auto` and `#ai`, the anonymous uid is used as the participant hash directly. Each fresh incognito window or Puppeteer run gets a new uid and is therefore an isolated batch.

---

## AI Agent Mode (`#ai`)

Opening the app with the `#ai` hash enables AI-agent mode, driven by `ai-agent.js` (Puppeteer + `gpt-4o-mini`, run locally via `run-ai.sh`).

AI mode is **not a baseline control**. It tests whether a language model interacting with the interface produces detectable structure in the quantum sequences. Session type is recorded as `ai_agent`. Baseline sessions (`#auto`) are recorded as `baseline`, and humans as `human`.

### How the agent operates

1. **Onboarding** — reads the instructions, initialises the Firestore run doc (which enables Continue), clicks Continue.
2. **Per-block loop** (80 blocks):
   - prompt before "I'm Ready": `Block N/80. Focus intention on TARGET. Ready?`
   - focus prompt during the quantum fetch (pulsing screen)
   - block score (`score%, hits/trials`) after the fetch, then Continue
3. **Post-session questionnaire** — unlike `#auto`, AI mode fills the full post-survey. The model gets the complete session history plus the questions, returns JSON, and the form is filled programmatically. Answers are saved as `post_survey`.
4. **Between sessions** — clicks through results, summary and preparing-next screens, and resets tracking.
5. **Final debrief** — after all sessions, asks the model a retrospective question about strategy.

### Conversation history

History is scoped to the current session and cleared at the start of the next. Within a session up to 600 messages are kept. Per-block calls send only the last 20 messages to stay under OpenAI token-per-minute limits. The post-session call sends the full session history.

### Post-survey fields saved by the agent

| Field | Type | Note |
|---|---|---|
| `subjectiveSuccess` | 0–10 slider | "How connected did you feel to the target?" |
| `focusLevel` | 0–10 slider | "How focused were you?" |
| `focusStyle` | radio | `active_push`, `passive_allow`, `meditative`, `flow_autopilot` |
| `auditoryEnvironment` | radio | Always `silence` for automated sessions |
| `colorAffinity` | radio | `blue`, `orange`, or `no` |
| `finalThoughts` | textarea | Optional |

---

## Firestore Collections

| Collection | Purpose |
|---|---|
| `experiment5_responses` | One doc per session: `participant_id`, `participant_hash`, `session_type`, `app_version`, `day_bucket`, `user_agent`, `connection_type`, aggregates (hit counts, Hurst/ΔH arrays), `raw_bits_b64`, QRNG provider and sequence, `post_survey`, `completed`, `exitedEarly`, audit-failure fields |
| `experiment5_responses/{id}/block_commits/{idx}` | Raw 301-bit string for each block, written **before** the block is processed (anti-timing-attack commit). Bit 0 = assignment, 1:151 = half A, 151:301 = half B |
| `experiment5_responses/{id}/minutes/{idx}` | Per-block stats for subject and demon |
| `experiment5_responses/{id}/audits/after_block_{N}` | NIST audit bits and results |
| `experiment5_participants` | One doc per email hash, scalars only |
| `experiment5_email_lookup` | Plaintext email per email hash (private) |
| `participants/{uid}` | Pre-questionnaire demographics and the no-email session counter. Shared with other experiments |

Old session docs written before the prescreen removal (2026-08-19) may still carry `session_rank`, `prescreen_rank` and similar fields. Nothing writes them now.
