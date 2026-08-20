# Exp4 Artificial Injection / Provider Validation — Handoff README

**Branch:** `exp4-artificial-injection` (off `main`)
**Last updated:** 2026-08-19
**Purpose of this file:** so anyone (including a future session with no memory of how this got built) can pick this up cold.

## Why this exists

The Exp4 manuscript ("The Paired-Delta Protocol") was rejected by the Frontiers Chief Editor. His central objection:

> "the experiment relied on multiple QRNG providers, while provider identity was not retained at the block level and consequently cannot be evaluated as an analytic factor... a stronger validation of the proposed artifact-control properties would require prospective testing under independently characterized sources of artifact."

Everything on this branch is aimed at closing that gap. There are **two complementary tracks**, both real, neither a substitute for the other:

- **Track A — real, controlled provider injection** (this file's main subject). Deliberately switches which real QRNG provider (Outshift vs. LFDR) serves each call, under experimenter control, and tests whether the paired-delta architecture cancels a genuine physical common-mode artifact. This is the one the editor's letter is most directly pointing at.
- **Track B — synthetic NIST-sourced injection preregistration.** Already fully built, preregistered, and submitted to OSF (see `injection-preregistration-exp4.md`, `resolution_floor_derivation-exp4.md`, `check-hrs-common-mode-cancellation.js`, `crossed_bootstrap_realization_diagnostic.py`). Not the subject of this README — that track is done pending the OSF registration finalizing.

## The original design brief (7 points), verbatim intent

1. **Log provider identity per call** — non-negotiable. The one thing everything else refines.
2. **Control provider selection, don't just observe it.** Two known endpoints/API keys, script picks per call — not left to a load balancer or race.
3. **Randomize the order, not strict alternation** (A,B,A,B,…) — avoids aliasing with periodic timing effects.
4. **Keep acquisition mechanics identical to Exp4** — same 301-bit call, same bit-0 assignment, same 150/150 split. Only the endpoint and logging change.
5. **Log timestamp + batch/session ID per call, multiple separate sittings** — rules out time-of-day drift as a confound.
6. **Tag as its own condition label** (`provider_validation`, not "Baseline") — can never get merged into the pilot's Baseline arm.
7. **Write the analysis plan before collecting** — see `PROVIDER_VALIDATION_PRESPEC.md`.

## Status checklist

| # | Item | Status |
|---|---|---|
| 1 | Provider identity capture | ✅ Fixed in `src/fetchQRNGBits.js` (was recording the meta-route `'qrng-race'` instead of the real per-call provider — bug, now fixed, matches the already-working version in exp5/exp5-prescreen/exp6-pilot). **Committed, NOT deployed.** |
| 2 | Explicit provider control | ✅ `run-provider-validation.js` calls Outshift/LFDR directly, bypassing the production race/fallback entirely. |
| 3 | Randomized order | ✅ Balanced block-randomized shuffle per sitting (Fisher-Yates), not alternation. |
| 4 | Identical acquisition mechanics | ✅ Same 301-bit call, bit-0 assignment, 150/150 split — ported verbatim from `src/MainApp.jsx`'s `processTrials`. |
| 5 | Timestamp/session ID, multiple sittings | ✅ Built in (`sitting_id`, `call_timestamp`, `committed_at`). No sittings actually run yet. |
| 6 | Own condition label | ✅ `condition: 'provider_validation'`, written to Firestore collection `exp4_artificial_injection` — fully isolated from `experiment3_ai_responses` (the real pilot data). |
| 7 | Analysis plan before collecting | ✅ `PROVIDER_VALIDATION_PRESPEC.md`, including a §7 addendum (asymmetric/stream-specific variant) and a §8 (OSF-ready fields: research questions, hypotheses, sample size/stopping rule, measured variables, an open decision on how to derive the equivalence bound, and full disclosure of the 2 smoke-test sittings). **Drafted, not yet actually submitted to OSF** — the content is ready to paste, submission itself hasn't happened. |

## What's actually blocking real data collection

**Nothing is collected yet.** The single blocker: `src/fetchQRNGBits.js`'s fix needs to be deployed to production before real sittings mean anything, because:
- `run-provider-validation.js` / `run-provider-validation-asymmetric.js` call Outshift/LFDR directly — they don't need the deploy, they're ready to run right now.
- But the **real Baseline/AI production collection** (a separate, complementary, *observational* piece — see below) needs the fix live, since AI-mode drives the actual production URL via Puppeteer.

Deploying requires an explicit go-ahead (per standing instruction: never push without being told to). Nothing pushed anywhere yet — this whole branch is local-only.

## Real Baseline/AI production collection — separate from the controlled study, don't conflate them

Running real Baseline/AI sessions through the normal exp4 app (with the fix deployed) is **not the same thing** as the controlled `run-provider-validation.js` study, and doesn't replace it:
- It gives you provider identity **observationally** — whatever the production race/fallback naturally did, not randomized/controlled/balanced.
- Real risk: Outshift is preferred-first in production, so exposure could be heavily skewed toward Outshift, and any LFDR exposure would cluster around whenever Outshift happened to be down — reintroducing a time confound.
- Still useful as a real-condition sanity check, but the controlled study is what actually satisfies "prospective testing under independently characterized sources of artifact."

**Known gap, not yet built:** device/browser/latency/timing capture. Confirmed nowhere in exp4's codebase (checked `MainApp.jsx` for `navigator.*`/`userAgent`/device/latency — nothing). Your own manuscript's §5.8 names this as desirable ("Device, browser, latency, and relevant timing variables should also be logged when privacy and feasibility permit"). Not implemented.

## Practical numbers for running real sittings

- **Outshift daily budget:** ~100,000 bits/day account-wide, shared with the live pilot. Each block call costs 304 bits (38 bytes requested, 3 discarded). Budget conservatively to **300 Outshift calls/day**, not the ~328 theoretical max, leaving headroom for the live pilot (per the user, only one other person's occasional testing collides with this right now — pause the automation, below, when that happens).
- **Current defaults (as of 2026-08-19): 30 blocks/sitting, 15/15 Outshift/LFDR split** — matches a real Exp4 session length (`pkConfig.BLOCKS_TOTAL`). `node experiments/exp4/run-provider-validation.js` with no flags now uses these defaults; override with `--batch-size` / `--outshift-budget` if needed.
- **Recommended cadence:** 18 sittings/day (270 Outshift calls/day, 82,080 bits — comfortable margin under the 100,000/day cap), spread across different times of day (this is what makes the time-of-day check meaningful). ~14.6 days to reach the 3,930 blocks/provider (262 sittings, 7,860 total blocks) target in the prespec — sized for 80% power against the most conservative of three benchmark effect sizes, not just the more likely ones (see prespec §8 for the full power table and the exp5-prescreen data it's grounded in).
- **Open question, never resolved:** whether to run a smaller staged batch first (e.g. 200-400 blocks/provider) to check for *any* detectable provider effect before committing the full week — raised because raw hit-rate differences between two working QRNGs may be too small to detect at this sample size; H_RS/structure metrics are more likely to show something.
- **Exactly 2 smoke-test sittings exist in Firestore** (`exp4_artificial_injection`, verified directly via query on 2026-08-19): `pv_1787113000691_bdb2aa` (`provider_validation`, 2 blocks: 1 Outshift, 1 LFDR) and `pva_1787116665640_5c3bca` (`provider_validation_asymmetric`, 2 blocks). Both labeled `"smoke-test"`, disclosed in the prespec §8, never cleaned up. Filter these out of any analysis query, or delete them.

## Running it unattended, throughout the day (launchd)

Set up 2026-08-19, macOS `launchd` (survives this chat session ending — nothing about it depends on Claude Code staying open):

- **Wrapper script:** `experiments/exp4/run-sitting-cron.sh` — runs one sitting with the current defaults, logs to `~/qart-power-run/provider-validation-logs/YYYY-MM-DD.log` (durable location, not `/tmp` — an earlier unrelated background job lost its checkpoint to a reboot when logging to `/tmp`, so this project keeps background job output at `~/qart-power-run/`).
- **Scheduler:** `~/Library/LaunchAgents/com.qart.provider-validation.plist` — fires once immediately on load, then every 80 minutes (`StartInterval=4800`), 18 sittings/day.

**Start it:**
```
launchctl load ~/Library/LaunchAgents/com.qart.provider-validation.plist
```

**Pause it gracefully** (e.g. when the one other person needs to test something) — a flag file the wrapper script checks at the *start* of each firing, never during an in-flight sitting, so a currently running sitting always finishes naturally on its own; this only prevents the *next* one from starting:
```
touch ~/qart-power-run/provider-validation-logs/PAUSE
```

**Resume:**
```
rm ~/qart-power-run/provider-validation-logs/PAUSE
```

launchd itself stays loaded the whole time with this approach — no need to unload/reload at all, the schedule keeps firing every 80 minutes, each firing just checks the flag first and skips if it's present (logged as a no-op line, not silently).

If you do want to stop the schedule entirely rather than pause (e.g. genuinely done for the day), `launchctl unload` also works, but note it may interrupt a sitting if one happens to be actively running at that exact moment — the flag-file approach above avoids that uncertainty entirely.

**Check it's actually running:**
```
launchctl list | grep com.qart.provider-validation
tail -f ~/qart-power-run/provider-validation-logs/$(date +%Y-%m-%d).log
```

**What happens when Outshift's daily quota runs out mid-run:** the sitting in progress halts immediately (per the halt-on-failure design, no substitution) and gets logged with `ended_reason=outshift_exhausted`, `completed=0/30` -- excluded, not partial data. This is not a special retry path -- `launchd`'s 80-minute timer was always going to fire again regardless of the last outcome, so the next scheduled sitting just tries fresh. If the quota is still exhausted it fails the same cheap way and excludes itself again; once Outshift's daily quota actually resets, the next firing succeeds normally. No action needed unless you want to pause it (e.g. to cap how much of a freshly-reset quota gets used before you're back).

**Requirement: the Mac needs to stay awake, and it will go to sleep on its own even with the lid open** (idle sleep, on its own timer, separate from lid-closure sleep) — `launchd` can't wake a sleeping machine for a job like this, so a missed 80-minute window just doesn't happen and the next one might too.

Fix: a second LaunchAgent that runs `caffeinate` continuously, self-healing (`KeepAlive`, so launchd restarts it if it ever dies) rather than a background process in a terminal that dies when the terminal closes:
```
launchctl load ~/Library/LaunchAgents/com.qart.caffeinate.plist
```
Uses `caffeinate -i -s` (prevent idle sleep, prevent sleep on AC power). **Keep the laptop plugged in for the ~14.6-day run** — `-s` only has an effect on AC power, and battery obviously won't last that long regardless.

**Lid must stay open.** Closing the lid triggers clamshell sleep, a separate mechanism from idle sleep — `caffeinate` does not override it. (The only way to run lid-closed is with an external display connected while on AC power, which wasn't set up here.)

To stop preventing sleep (e.g. genuinely done, or want the Mac to sleep normally again):
```
launchctl unload ~/Library/LaunchAgents/com.qart.caffeinate.plist
```

**To remove entirely** (not just pause): `launchctl unload` first, then `rm ~/Library/LaunchAgents/com.qart.provider-validation.plist`.

## File manifest (this directory)

| File | What it is |
|---|---|
| `src/fetchQRNGBits.js` | The provider-capture fix. Not deployed. |
| `run-provider-validation.js` | Controlled common-mode study — Outshift vs. LFDR, randomized, balanced sittings. Smoke-tested working, no real data collected. |
| `run-provider-validation-asymmetric.js` | Live dual-fetch asymmetric variant. Built, smoke-tested, but **demoted to optional fallback** — primary asymmetric analysis is splicing already-collected common-mode data (free, no new collection), not this script. Only run this if the spliced analysis is ambiguous. |
| `PROVIDER_VALIDATION_PRESPEC.md` | Prespecification for Track A (this track). Not yet OSF-registered. |
| `injection-preregistration-exp4.md` | Track B's locked preregistration (NIST-sourced synthetic injection, δ=0.002 equivalence bound, 100 realizations/dose). Already submitted to OSF (Secondary Data Analysis Plan template, embargoed). |
| `resolution_floor_derivation-exp4.md` | How δ=0.002 was derived — provenance record for Track B. |
| `check-hrs-common-mode-cancellation.js` | Resolves whether paired-delta cancellation holds for the nonlinear HRS estimator (yes, via exchangeability, confirmed by simulation). Track B. |
| `crossed_bootstrap_realization_diagnostic.py` | Decomposes session- vs. realization-driven variance; the diagnostic that set Track B's realization count. Needs `notebooks/Frozen_Blocks_2026-02-10_195735.csv` and `Frozen_Sessions_2026-02-10_195735.csv` (gitignored, kept local — present in this branch's working tree already). Track B. |
| `run-sitting-cron.sh` | Wrapper invoked by launchd to run one sitting unattended. Not meant to be run interactively. |
| `ARTIFICIAL_INJECTION_README.md` | This file. |

Also outside this directory: `~/Library/LaunchAgents/com.qart.provider-validation.plist` (the launchd schedule — see below) and `~/qart-power-run/provider-validation-logs/` (log output).

## Recommended next steps, in order

1. Decide on `fetchQRNGBits.js`: commit as-is (already done here) → get explicit go-ahead → deploy to production. (Only needed for the real Baseline/AI observational piece, not for the controlled study below, which doesn't touch production at all.)
2. Decide the staged-vs-full-target collection question above.
3. Decide how to lock the equivalence bound for Track A (prespec §8 — reuse δ=0.002 from Track B, or derive fresh from an initial tranche). Not yet decided.
4. Submit `PROVIDER_VALIDATION_PRESPEC.md` (content is ready, §8) to an OSF Study Plan before real (non-smoke-test) sittings begin.
5. Start the launchd automation (commands above) once 2-4 are settled, or earlier if you're comfortable running before the OSF submission is finalized.
6. Optionally: add device/browser/latency capture if you want the real Baseline/AI observational piece to close that manuscript-flagged gap too.
