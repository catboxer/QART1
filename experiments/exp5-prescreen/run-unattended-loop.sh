#!/bin/bash
# experiments/exp5-prescreen/run-unattended-loop.sh
# Runs one baseline session, then waits a randomized 10-60 minute interval
# before repeating -- meant to be left running headless/unattended to
# approximate the pacing of individual human sittings rather than a scripted
# batch. AI-agent sessions are disabled for now (OpenAI billing issue) --
# see git history for the AI session step if it needs to come back.
#
# exp5-prescreen's AUTO_MODE_SESSIONS already defaults to 1 in src/config.js,
# so no SESSIONS_PER_RUN override is needed here (unlike the exp4 equivalent,
# which defaults to a 20-session batch per page load).
#
# Usage: CYCLES=200 bash experiments/exp5-prescreen/run-unattended-loop.sh
#        (CYCLES unset or 0 = run forever until stopped)
# Stop:  kill the PID printed at startup (also logged in the log file).
#
# Every CHECK_EVERY cycles (default 25), logs real completed-session counts
# from Firestore via check-session-counts.js -- the CYCLES counter above only
# tracks attempted sessions, not how many actually completed, so this is the
# real progress signal.

cd "$(dirname "$0")/../.." || exit 1  # repo root

LOG_FILE="experiments/exp5-prescreen/unattended-loop.log"

CYCLES="${CYCLES:-0}"  # 0 = infinite
CHECK_EVERY="${CHECK_EVERY:-25}"  # cycles between Firestore progress checks
# Defaults headless (for the dedicated always-on box). Override with HEADLESS=0
# on a machine where you want a real visible browser (e.g. HEADLESS=0 CYCLES=200
# bash run-unattended-loop.sh) to watch sessions run closer to what a human sees.
HEADLESS="${HEADLESS:-1}"

echo "=== Unattended loop started at $(date), PID $$, CYCLES=${CYCLES:-infinite} ===" | tee -a "$LOG_FILE"

i=0
while [ "$CYCLES" -eq 0 ] || [ "$i" -lt "$CYCLES" ]; do
  i=$((i + 1))
  echo "--- $(date): Cycle $i${CYCLES:+/$CYCLES} - Running baseline session ---" | tee -a "$LOG_FILE"
  HEADLESS=$HEADLESS node experiments/exp5-prescreen/run-baseline.js >> "$LOG_FILE" 2>&1

  if [ "$((i % CHECK_EVERY))" -eq 0 ]; then
    node experiments/exp5-prescreen/check-session-counts.js 2>&1 | tee -a "$LOG_FILE"
  fi

  if [ "$CYCLES" -ne 0 ] && [ "$i" -ge "$CYCLES" ]; then
    echo "=== $(date): Reached ${CYCLES} cycles, stopping. ===" | tee -a "$LOG_FILE"
    node experiments/exp5-prescreen/check-session-counts.js 2>&1 | tee -a "$LOG_FILE"
    break
  fi

  WAIT_SECS=$(( (RANDOM % 3001) + 600 ))  # 600-3600s = 10-60 min
  echo "--- $(date): Sleeping ${WAIT_SECS}s (~$((WAIT_SECS / 60)) min) before next cycle ---" | tee -a "$LOG_FILE"
  sleep "$WAIT_SECS"
done
