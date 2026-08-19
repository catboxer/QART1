#!/bin/bash
# run-sitting-cron.sh
# Wrapper invoked by launchd (com.qart.provider-validation.plist) to run one
# provider-validation sitting on a schedule, unattended. Not meant to be run
# interactively -- use `node run-provider-validation.js` directly for that.

set -euo pipefail

NODE_BIN="/Users/macuser/.nvm/versions/node/v20.11.0/bin/node"
REPO_DIR="/Users/macuser/qart-experiment"
LOG_DIR="/Users/macuser/qart-power-run/provider-validation-logs"
LOG_FILE="$LOG_DIR/$(date +%Y-%m-%d).log"

mkdir -p "$LOG_DIR"

{
  echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) starting sitting ==="
  cd "$REPO_DIR"
  "$NODE_BIN" experiments/exp4/run-provider-validation.js --batch-size 30 --outshift-budget 15 --label "cron-$(date +%H%M)"
  echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) sitting finished ==="
} >> "$LOG_FILE" 2>&1
