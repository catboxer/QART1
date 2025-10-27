#!/bin/bash
# experiments/exp3/run-ai.sh
# Run AI agent session with GPT-4o-mini

export OPENAI_API_KEY=$(grep OPENAI_API_KEY .env | cut -d '=' -f2)
node experiments/exp3/ai-agent.js
