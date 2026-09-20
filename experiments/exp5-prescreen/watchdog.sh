#!/bin/bash
# experiments/exp5-prescreen/watchdog.sh
# Runs ALONGSIDE run-unattended-loop.sh (not instead of it). Detects two stall
# patterns and auto-restarts the loop when it finds one:
#   1. The loop's own bash process died entirely.
#   2. The loop process is alive but produced no new log output for far longer
#      than it should have (e.g. its `sleep N` between cycles never returned
#      because the Mac was shut down/suspended mid-sleep).
#
# Usage: nohup bash experiments/exp5-prescreen/watchdog.sh > /dev/null 2>&1 &
# Stop:  kill the PID printed at startup (also logged in watchdog.log).
#
# Note: each restart resets the loop's own CYCLES counter to 1 -- if the loop
# restarts several times, total sessions run across the whole run can exceed
# the CYCLES target. Acceptable tradeoff; not tracking a cross-restart counter.

cd "$(dirname "$0")/../.." || exit 1

LOG_FILE="experiments/exp5-prescreen/unattended-loop.log"
LOOP_SCRIPT="experiments/exp5-prescreen/run-unattended-loop.sh"
WATCHDOG_LOG="experiments/exp5-prescreen/watchdog.log"
CHECK_INTERVAL=120     # how often to check, seconds
STALE_ACTIVE_SECS=300  # no new log line in 5 min while mid-session -> stalled
STALE_SLEEP_BUFFER=300 # grace period past the announced inter-cycle sleep duration

restart_loop() {
  pkill -f "$LOOP_SCRIPT" 2>/dev/null
  pkill -f "exp5-prescreen/run-baseline.js" 2>/dev/null
  pkill -f "exp5-prescreen/ai-agent.js" 2>/dev/null
  sleep 2
  nohup env CYCLES=200 bash "$LOOP_SCRIPT" > /dev/null 2>&1 &
  disown
  echo "$(date): Restarted loop, new PID $!" | tee -a "$WATCHDOG_LOG"
}

echo "=== Watchdog started at $(date), PID $$ ===" | tee -a "$WATCHDOG_LOG"

while true; do
  sleep "$CHECK_INTERVAL"

  if ! pgrep -f "$LOOP_SCRIPT" > /dev/null; then
    echo "$(date): Loop process not found -- restarting." | tee -a "$WATCHDOG_LOG"
    restart_loop
    continue
  fi

  [ -f "$LOG_FILE" ] || continue

  last_mod=$(stat -f %m "$LOG_FILE" 2>/dev/null || stat -c %Y "$LOG_FILE")
  now=$(date +%s)
  age=$((now - last_mod))
  last_line=$(tail -1 "$LOG_FILE")

  if echo "$last_line" | grep -q "Sleeping .*before next cycle"; then
    announced=$(echo "$last_line" | grep -oE "Sleeping [0-9]+s" | grep -oE "[0-9]+")
    allowed=$((announced + STALE_SLEEP_BUFFER))
    if [ "$age" -gt "$allowed" ]; then
      echo "$(date): Stalled in sleep phase (${age}s elapsed, expected ~${announced}s). Restarting." | tee -a "$WATCHDOG_LOG"
      restart_loop
    fi
  else
    if [ "$age" -gt "$STALE_ACTIVE_SECS" ]; then
      echo "$(date): Stalled mid-session (${age}s since last log line). Restarting." | tee -a "$WATCHDOG_LOG"
      restart_loop
    fi
  fi
done
