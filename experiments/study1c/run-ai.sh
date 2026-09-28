#!/bin/bash
# experiments/study1c/run-ai.sh
# Run AI agent session with GPT-4o-mini

export OPENAI_API_KEY=$(grep OPENAI_API_KEY .env | cut -d '=' -f2)
node experiments/study1c/ai-agent.js
