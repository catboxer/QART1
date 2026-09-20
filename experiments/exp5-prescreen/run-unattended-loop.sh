#!/bin/bash
# experiments/exp5-prescreen/run-unattended-loop.sh
# Runs one baseline session and one AI session, back to back, then waits a
# randomized 10-60 minute interval before repeating -- meant to be left
# running headless/unattended to approximate the pacing of individual human
# sittings rather than a scripted batch.
#
# exp5-prescreen's AUTO_MODE_SESSIONS / AI_MODE_SESSIONS already default to 1
# in src/config.js, so no SESSIONS_PER_RUN override is needed here (unlike the
# exp4 equivalent, which defaults to a 20/12-session batch per page load).
#
# Usage: CYCLES=200 bash experiments/exp5-prescreen/run-unattended-loop.sh
#        (CYCLES unset or 0 = run forever until stopped)
# Stop:  kill the PID printed at startup (also logged in the log file).

cd "$(dirname "$0")/../.." || exit 1  # repo root

LOG_FILE="experiments/exp5-prescreen/unattended-loop.log"
export OPENAI_API_KEY=$(grep OPENAI_API_KEY .env | cut -d '=' -f2)

CYCLES="${CYCLES:-0}"  # 0 = infinite
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

  echo "--- $(date): Cycle $i${CYCLES:+/$CYCLES} - Running AI session ---" | tee -a "$LOG_FILE"
  HEADLESS=$HEADLESS node experiments/exp5-prescreen/ai-agent.js >> "$LOG_FILE" 2>&1

  if [ "$CYCLES" -ne 0 ] && [ "$i" -ge "$CYCLES" ]; then
    echo "=== $(date): Reached ${CYCLES} cycles, stopping. ===" | tee -a "$LOG_FILE"
    break
  fi

  WAIT_SECS=$(( (RANDOM % 3001) + 600 ))  # 600-3600s = 10-60 min
  echo "--- $(date): Sleeping ${WAIT_SECS}s (~$((WAIT_SECS / 60)) min) before next cycle ---" | tee -a "$LOG_FILE"
  sleep "$WAIT_SECS"
done
