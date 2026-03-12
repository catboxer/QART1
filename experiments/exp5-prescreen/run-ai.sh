#!/bin/bash
# experiments/exp5-prescreen/run-ai.sh
# Run AI agent session with GPT-4o-mini

export OPENAI_API_KEY=$(grep OPENAI_API_KEY .env | cut -d '=' -f2)
node experiments/exp5-prescreen/ai-agent.js
