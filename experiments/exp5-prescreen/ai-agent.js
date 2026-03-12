// experiments/exp3/ai-agent.js
// AI Agent for consciousness experiment
// Maintains persistent GPT-4o-mini conversation throughout session

const puppeteer = require('puppeteer');
const OpenAI = require('openai');
const aiConfig = require('./ai-config.js');

// Configuration
const EXPERIMENT_URL = aiConfig.EXPERIMENT_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const AI_SESSIONS = aiConfig.AI_MODE_SESSIONS;

if (!OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY environment variable not set');
  console.error('Get your free API key at: https://platform.openai.com/api-keys');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Helper function to call OpenAI with retry logic for rate limits
async function callOpenAIWithRetry(messages, maxTokens, maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: maxTokens,
        messages: messages
      });
    } catch (error) {
      // Check if it's a rate limit error
      if (error.status === 429 && attempt < maxRetries) {
        // Extract wait time from error message or use exponential backoff
        const waitMatch = error.message.match(/try again in ([\d.]+)s/);
        const waitTime = waitMatch ? parseFloat(waitMatch[1]) * 1000 : Math.pow(2, attempt) * 1000;

        console.log(`⏳ Rate limit hit. Waiting ${(waitTime / 1000).toFixed(1)}s before retry ${attempt}/${maxRetries}...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        // Non-rate-limit error or final attempt - throw it
        throw error;
      }
    }
  }
}

async function runAISession() {
  console.log('🤖 Starting AI Agent Session');
  console.log(`📊 Will run ${AI_SESSIONS} sessions (configured in ai-config.js)`);
  console.log(`📍 Experiment URL: ${EXPERIMENT_URL}`);

  // Launch browser
  const browser = await puppeteer.launch({
    headless: false, // Set to true for unattended runs
    defaultViewport: { width: 1280, height: 720 }
  });

  const page = await browser.newPage();

  // Capture browser console messages (especially Firebase errors)
  page.on('console', msg => {
    const type = msg.type();
    const text = msg.text();
    if (type === 'error' || text.includes('Firebase') || text.includes('Firestore') || text.includes('ensureRunDoc') || text.includes('auth/')) {
      console.log(`🌐 BROWSER ${type.toUpperCase()}: ${text}`);
    }
  });

  // Listen for dialog events (alerts, confirms, prompts)
  let qrngErrorCount = 0;
  page.on('dialog', async dialog => {
    const message = dialog.message();
    console.log(`⚠️ DIALOG DETECTED - Type: ${dialog.type()}, Message: ${message}`);

    // Check if it's a QRNG timeout error
    if (message.includes('QRNG') || message.includes('timeout') || message.includes('unavailable')) {
      qrngErrorCount++;
      console.error(`❌ QRNG ERROR #${qrngErrorCount}: ${message}`);

      if (qrngErrorCount >= 3) {
        console.error('❌ FATAL: Multiple QRNG errors detected. The quantum service appears to be down.');
        console.error('❌ Aborting experiment to prevent invalid data collection.');
        await dialog.accept();
        await new Promise(resolve => setTimeout(resolve, 1000));
        await browser.close();
        process.exit(1);
      }
    }

    await dialog.accept(); // Auto-accept to continue
  });

  await page.goto(EXPERIMENT_URL);

  console.log('✅ Browser launched, navigating to experiment');

  // AI will read instructions from the onboarding screen instead of hardcoded prompt

  // Initialize state tracking
  const conversationHistory = [];
  let target = null;
  // Full history kept in memory so GPT can reflect on the entire arc when answering
  // post-session questions. Per-block calls (ready/pulsing/score) only send the last
  // SEND_HISTORY_LENGTH messages to stay well under the 200k TPM limit.
  const MAX_HISTORY_LENGTH = 600;
  const SEND_HISTORY_LENGTH = 20; // messages sent per block call (~1-2k tokens vs ~30k for full history)

  // Wait for page to load
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Handle prime screen (research background)
  try {
    console.log('📚 Checking for prime screen (research background)...');

    // Wait a bit for page to fully load
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Check if we're on the prime screen
    const isPrimeScreen = await page.evaluate(() => {
      return document.body.innerText.includes('Research Background') ||
             document.body.innerText.includes('PK Research');
    });

    if (isPrimeScreen) {
      console.log('📖 Prime screen detected - reading research background...');

      // Read the prime screen content
      const primeContent = await page.evaluate(() => {
        return document.body.innerText;
      });

      // Send prime content to AI
      const primePrompt = `You are about to participate in a consciousness research experiment. Read this research background carefully:

${primeContent}

Acknowledge that you've read and understand the research context.`;

      console.log('🤖 Sending research background to GPT-4o-mini...');

      const primeResponse = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 150,
        messages: [{ role: 'user', content: primePrompt }]
      });

      conversationHistory.push({ role: 'user', content: primePrompt });
      conversationHistory.push({ role: 'assistant', content: primeResponse.choices[0].message.content });

      // Trim history to last N messages
      if (conversationHistory.length > MAX_HISTORY_LENGTH) {
        conversationHistory.splice(0, conversationHistory.length - MAX_HISTORY_LENGTH);
      }

      console.log('🤖 AI acknowledges research background:', primeResponse.choices[0].message.content);

      // Click Continue button
      await new Promise(resolve => setTimeout(resolve, 1000));

      const clicked = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const continueBtn = buttons.find(btn => btn.textContent.includes('Continue'));
        if (continueBtn) {
          continueBtn.click();
          return true;
        }
        return false;
      });

      if (clicked) {
        console.log('✅ Clicked Continue on prime screen\n');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } else {
      console.log('⚠️ No prime screen found, might already be past it');
    }
  } catch (e) {
    console.log('⚠️ Error handling prime screen:', e.message);
  }

  // Wait for onboarding screen to load
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Read onboarding instructions and click Continue
  try {
    console.log('📖 Reading onboarding instructions from screen...');

    const onboardingInstructions = await page.evaluate(() => {
      return document.body.innerText;
    });

    // Send instructions to AI to read and understand
    const instructionsPrompt = `You are participating in a consciousness research experiment. Read the instructions on screen and acknowledge that you understand your task.

SCREEN INSTRUCTIONS:
${onboardingInstructions}

Respond with a brief acknowledgment that you understand the critical moment is when you click "I'm Ready" and the screen pulses your target color - that's when to focus all intention.`;

    console.log('🤖 Sending onboarding instructions to GPT-4o-mini...');

    const onboardingResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 100,
      messages: [{ role: 'user', content: instructionsPrompt }]
    });

    conversationHistory.push({ role: 'user', content: instructionsPrompt });
    conversationHistory.push({ role: 'assistant', content: onboardingResponse.choices[0].message.content });

    // Trim history
    if (conversationHistory.length > MAX_HISTORY_LENGTH) {
      conversationHistory.splice(0, conversationHistory.length - MAX_HISTORY_LENGTH);
    }

    console.log('🤖 AI acknowledges instructions:', onboardingResponse.choices[0].message.content);

    // Poll for Continue to become enabled using expState.canContinue (avoids DOM starvation)
    console.log('⏳ Waiting for Continue button to become enabled...');
    let initContinueReady = false;
    for (let i = 0; i < 600; i++) { // up to 5 minutes (600 × 500ms)
      await new Promise(resolve => setTimeout(resolve, 500));
      initContinueReady = await page.evaluate(() => {
        if (window.expState && window.expState.phase === 'onboarding') return window.expState.canContinue === true;
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Continue'));
        return btn ? !btn.disabled : false;
      });
      if (initContinueReady) break;
      if (i > 0 && i % 20 === 0) { // log every 10s
        const diag = await page.evaluate(() => ({
          expState: window.expState || null,
          bodyPreview: document.body.innerText.substring(0, 100),
        }));
        console.log(`⏳ Still waiting... t=${(i*0.5).toFixed(0)}s`, JSON.stringify(diag));
      }
    }
    if (!initContinueReady) console.warn('⚠️ Continue button did not become enabled within 5min — attempting click anyway');

    const clicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const continueBtn = buttons.find(btn => btn.textContent.includes('Continue'));
      if (continueBtn && !continueBtn.disabled) {
        continueBtn.click();
        return true;
      }
      return false;
    });

    if (clicked) {
      console.log('✅ Clicked Continue on onboarding screen\n');
      await new Promise(resolve => setTimeout(resolve, 2000));
    } else {
      console.warn('⚠️ Could not find enabled Continue button on onboarding screen');
    }
  } catch (e) {
    console.error('❌ Error reading onboarding instructions:', e.message);
  }

  // Wait for rest screen with target and "I'm Ready" button
  try {
    console.log('\n🎯 Waiting for rest screen with target...');

    // Wait for "I'm Ready" button to appear
    await page.waitForSelector('button', { timeout: 10000 });

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Read target from the rest screen
    const targetFromScreen = await page.evaluate(() => {
      const bodyText = document.body.innerText;

      // Look for target color on rest screen
      if (bodyText.includes('🟦') && bodyText.includes('BLUE') && bodyText.includes('YOUR TARGET')) {
        return 'BLUE';
      }
      if (bodyText.includes('🟠') && bodyText.includes('ORANGE') && bodyText.includes('YOUR TARGET')) {
        return 'ORANGE';
      }

      return null;
    });

    if (!targetFromScreen) {
      const debugText = await page.evaluate(() => document.body.innerText.substring(0, 800));
      console.log('❌ Could not detect target. Page text:', debugText);
      throw new Error('Could not detect target color from screen');
    }

    console.log(`✅ Target detected: ${targetFromScreen}`);

    // Store target for later use
    target = targetFromScreen;

    // Acknowledge target to AI
    const targetPrompt = `Your target color is ${targetFromScreen}. This is what you need to focus on during the quantum data fetches. Acknowledge your target.`;

    const targetResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 50,
      messages: [...conversationHistory, { role: 'user', content: targetPrompt }]
    });

    conversationHistory.push({ role: 'user', content: targetPrompt });
    conversationHistory.push({ role: 'assistant', content: targetResponse.choices[0].message.content });

    console.log(`🤖 AI acknowledges target: ${targetResponse.choices[0].message.content}\n`);

    await new Promise(resolve => setTimeout(resolve, 500));
  } catch (e) {
    console.error('❌ Error detecting target:', e.message);
    await browser.close();
    process.exit(1);
  }

  // Monitor loop - checks for rest periods and fetching phase every 500ms
  console.log('👁️ Starting monitoring loop (checking for rest periods and fetching phase)...');
  let lastBlockProcessed = -1; // Start at -1 so block 0 can be processed
  let notifiedPulsing = false; // Track if we've already told AI about pulsing for current block
  let pulsingStartTime = null; // Track when pulsing started
  let lastAuditProcessed = -1; // Track last audit screen we processed
  const PULSING_TIMEOUT_MS = 5000; // 5 seconds max for pulsing screen (fetch should be ~1-2s)

  let donePhaseHandled = false; // Prevent double-handling the post-session questionnaire
  let lastActivityTime = Date.now(); // Track time of last meaningful activity
  let lastLoggedIdleWarning = 0; // Prevent spam of idle warnings

  const monitorInterval = setInterval(async () => {
    try {
      // Check screen state
      const screenState = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const readyButton = buttons.find(btn => btn.textContent.includes("I'm Ready"));
        const continueButton = buttons.find(btn => btn.textContent.includes('Continue'));

        // Check if we're on fetching phase (pulsing screen with "Fetching quantum data" text)
        const isFetching = document.body.innerText.includes('Fetching quantum data');

        return {
          isReadyScreen: !!readyButton,
          isResultsScreen: !!continueButton && !readyButton,
          isFetching: isFetching,
          expState: window.expState,
          bodyPreview: document.body.innerText.substring(0, 200)
        };
      });

      // Track activity for idle detection
      const now = Date.now();
      const timeSinceActivity = now - lastActivityTime;
      const IDLE_WARNING_THRESHOLD = 60000; // 60 seconds

      if (timeSinceActivity > IDLE_WARNING_THRESHOLD && (now - lastLoggedIdleWarning) > 30000) {
        console.warn(`⏱️ WARNING: No activity for ${Math.round(timeSinceActivity / 1000)}s. Current screen: ${screenState.bodyPreview.substring(0, 100)}`);
        lastLoggedIdleWarning = now;
      }

      // Debug logging every 1 second
      if (Date.now() % 1000 < 500) {
        console.log('🔍 Screen state:', {
          isReadyScreen: screenState.isReadyScreen,
          isResultsScreen: screenState.isResultsScreen,
          isFetching: screenState.isFetching,
          hasExpState: !!screenState.expState,
          blockIdx: screenState.expState?.blockIdx,
          bodyPreview: screenState.bodyPreview
        });
      }

      // Handle "I'm Ready" screen (before fetching quantum data)
      if (screenState.isReadyScreen && screenState.expState) {
        const currentBlock = screenState.expState.blockIdx;

        // Detect new session starting (blockIdx went backwards)
        if (currentBlock < lastBlockProcessed && currentBlock <= 1) {
          console.log(`🔄 New session detected (blockIdx: ${currentBlock}, was: ${lastBlockProcessed}), resetting tracking...`);
          lastBlockProcessed = -1;
          lastAuditProcessed = -1;
          donePhaseHandled = false;
          // Reset conversation history so each session's post-questions reflect only
          // that session's experience — mirrors a human's session-scoped recall.
          conversationHistory.length = 0;
          console.log('🔄 Conversation history cleared for new session');
        }

        if (currentBlock >= lastBlockProcessed) {
          console.log(`\n🎯 Ready screen detected for block ${currentBlock}`);

          // Tell AI about the upcoming fetch
          const readyPrompt = `Block ${currentBlock}. Focus intention on ${target}. Ready?`;

          console.log('🤖 Prompting AI before quantum fetch...');

          const readyResponse = await callOpenAIWithRetry(
            [...conversationHistory.slice(-SEND_HISTORY_LENGTH), { role: 'user', content: readyPrompt }],
            30
          );

          conversationHistory.push({ role: 'user', content: readyPrompt });
          conversationHistory.push({ role: 'assistant', content: readyResponse.choices[0].message.content });

          // Trim history
          if (conversationHistory.length > MAX_HISTORY_LENGTH) {
            conversationHistory.splice(0, conversationHistory.length - MAX_HISTORY_LENGTH);
          }

          console.log(`🤖 AI response: ${readyResponse.choices[0].message.content}\n`);

          // Click "I'm Ready" button (with pause to pace API calls)
          await new Promise(resolve => setTimeout(resolve, 1000));

          const clicked = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const readyButton = buttons.find(btn => btn.textContent.includes("I'm Ready"));
            if (readyButton) {
              readyButton.click();
              return true;
            }
            return false;
          });

          if (clicked) {
            console.log('✅ Clicked "I\'m Ready" button - quantum fetch starting...\n');
            notifiedPulsing = false; // Reset for next pulsing detection
            lastActivityTime = Date.now(); // Update activity time
          }
        }
      }

      // Detect fetching/pulsing screen
      if (screenState.isFetching) {
        // Start tracking pulsing time
        if (!pulsingStartTime) {
          pulsingStartTime = Date.now();
          console.log('🌊 Pulsing screen detected!');
        }

        // Check if pulsing has been going too long
        const pulsingDuration = Date.now() - pulsingStartTime;
        if (pulsingDuration > PULSING_TIMEOUT_MS) {
          console.error(`❌ Pulsing screen stuck for ${pulsingDuration}ms (timeout: ${PULSING_TIMEOUT_MS}ms)`);
          console.error('❌ Quantum fetch appears to be failing - aborting session');
          clearInterval(monitorInterval);
          await browser.close();
          process.exit(1);
        }

        // Notify AI about pulsing (only once)
        if (!notifiedPulsing) {
          const pulsingPrompt = `Pulsing ${target} NOW. Focus.`;

          console.log('🤖 Notifying AI about pulsing...');

          const pulsingResponse = await callOpenAIWithRetry(
            [...conversationHistory.slice(-SEND_HISTORY_LENGTH), { role: 'user', content: pulsingPrompt }],
            20
          );

          conversationHistory.push({ role: 'user', content: pulsingPrompt });
          conversationHistory.push({ role: 'assistant', content: pulsingResponse.choices[0].message.content });

          // Trim history
          if (conversationHistory.length > MAX_HISTORY_LENGTH) {
            conversationHistory.splice(0, conversationHistory.length - MAX_HISTORY_LENGTH);
          }

          console.log(`🤖 AI focusing: ${pulsingResponse.choices[0].message.content}\n`);

          notifiedPulsing = true;
        }
      } else {
        // Reset pulsing tracking when not on pulsing screen
        if (pulsingStartTime) {
          console.log(`✅ Pulsing ended after ${Date.now() - pulsingStartTime}ms`);
          pulsingStartTime = null;
          notifiedPulsing = false;
          lastActivityTime = Date.now(); // Update activity time
        }
      }

      // Handle score screen (after quantum fetch + scoring complete)
      // expState.phase === 'score' is the reliable gate; expState.blockIdx is 1-indexed (completedBlockNum)
      if (screenState.expState?.phase === 'score') {
        const currentBlockIdx = screenState.expState.blockIdx; // 1-indexed

        if (currentBlockIdx > lastBlockProcessed) {
          lastBlockProcessed = currentBlockIdx;

          // Use expState fields directly — score screen populates these explicitly
          const score = screenState.expState.score ?? '?';
          const hits = screenState.expState.hits ?? '?';
          const trials = screenState.expState.trials ?? '?';
          const totalBlocks = screenState.expState.totalBlocks ?? 80;

          // Prompt AI to confirm target and focus
          console.log(`\n📊 Block ${currentBlockIdx}/${totalBlocks} complete — score: ${score}%, hits: ${hits}/${trials}`);

          const restPrompt = `Block ${currentBlockIdx}/${totalBlocks} done. Score: ${score}% (${hits}/${trials} hits). Target: ${target}. Stay focused.`;

          const restResponse = await callOpenAIWithRetry(
            [...conversationHistory.slice(-SEND_HISTORY_LENGTH), { role: 'user', content: restPrompt }],
            30
          );

          conversationHistory.push({ role: 'user', content: restPrompt });
          conversationHistory.push({ role: 'assistant', content: restResponse.choices[0].message.content });

          // Trim history
          if (conversationHistory.length > MAX_HISTORY_LENGTH) {
            conversationHistory.splice(0, conversationHistory.length - MAX_HISTORY_LENGTH);
          }

          console.log(`🤖 AI response: ${restResponse.choices[0].message.content}\n`);

          await new Promise(resolve => setTimeout(resolve, 1000)); // Pause to pace API calls
        } else {
          // Same block still showing — click failed or transition stalled (e.g. audit screen).
          // Retry the click without calling OpenAI again.
          console.log(`🔄 Score screen retry for block ${currentBlockIdx} — re-clicking Continue`);
        }

        // Always click Continue when on score phase (idempotent — safe to retry)
        const clicked = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const continueButton = buttons.find(btn => btn.textContent.includes('Continue'));
          if (continueButton) {
            continueButton.click();
            return true;
          }
          return false;
        });

        if (clicked) {
          console.log('✅ Clicked Continue button\n');
          lastActivityTime = Date.now();
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      // Handle post-session questionnaire (done phase)
      // expState.phase === 'done' is set by the React render; AI-mode shows the form for the agent to fill
      if (screenState.expState?.phase === 'done' && !donePhaseHandled) {
        donePhaseHandled = true;
        console.log('\n📝 Post-session questionnaire detected — asking GPT-4o-mini for answers...');
        lastActivityTime = Date.now();

        const donePrompt = `The session is complete. Target was ${target}.

Please answer these post-session questions based on your experience during this session. Respond with ONLY a valid JSON object (no prose, no markdown):

{
  "subjectiveSuccess": <integer 0-10, how connected/resonant you felt with the target>,
  "focusLevel": <integer 0-10, how focused you were>,
  "focusStyle": <one of: "active_push", "passive_allow", "meditative", "flow_autopilot">,
  "auditoryEnvironment": "silence",
  "colorAffinity": <one of: "blue", "orange", "no" — did you feel a pull toward one color?>,
  "finalThoughts": <string, optional — any notable sensations or observations, empty string if none>
}`;

        let answers = {
          subjectiveSuccess: 5,
          focusLevel: 5,
          focusStyle: 'meditative',
          auditoryEnvironment: 'silence',
          colorAffinity: 'no',
          finalThoughts: '',
        };

        try {
          const doneResponse = await callOpenAIWithRetry(
            [...conversationHistory, { role: 'user', content: donePrompt }],
            200
          );
          const responseText = doneResponse.choices[0].message.content;
          console.log(`🤖 GPT-4o-mini post-session answers:\n${responseText}\n`);

          conversationHistory.push({ role: 'user', content: donePrompt });
          conversationHistory.push({ role: 'assistant', content: responseText });
          if (conversationHistory.length > MAX_HISTORY_LENGTH) {
            conversationHistory.splice(0, conversationHistory.length - MAX_HISTORY_LENGTH);
          }

          const jsonMatch = responseText.match(/\{[\s\S]*\}/);
          answers = { ...answers, ...JSON.parse(jsonMatch ? jsonMatch[0] : responseText) };
        } catch (e) {
          console.error('❌ Failed to get/parse GPT answers:', e.message, '— using defaults');
        }

        console.log('📝 Filling post-survey form:', answers);
        await new Promise(resolve => setTimeout(resolve, 800));

        // Fill sliders using React's native input setter (triggers onChange → setTouched)
        await page.evaluate((ss, fl) => {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          ['subjectiveSuccess', 'focusLevel'].forEach((id, i) => {
            const el = document.getElementById(id);
            if (!el) return;
            setter.call(el, i === 0 ? ss : fl);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          });
        }, String(answers.subjectiveSuccess), String(answers.focusLevel));

        await new Promise(resolve => setTimeout(resolve, 400));

        // Click radio buttons
        await page.evaluate((focusStyle, auditoryEnv, colorAffinity) => {
          [
            ['focusStyle', focusStyle],
            ['auditoryEnvironment', auditoryEnv],
            ['colorAffinity', colorAffinity],
          ].forEach(([name, val]) => {
            const radio = document.querySelector(`input[type="radio"][name="${name}"][value="${val}"]`);
            if (radio) radio.click();
          });
        }, answers.focusStyle, answers.auditoryEnvironment, answers.colorAffinity);

        await new Promise(resolve => setTimeout(resolve, 400));

        // Fill textarea if non-empty
        if (answers.finalThoughts) {
          await page.evaluate((val) => {
            const ta = document.getElementById('finalThoughts');
            if (!ta) return;
            const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            setter.call(ta, val);
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            ta.dispatchEvent(new Event('change', { bubbles: true }));
          }, answers.finalThoughts);
          await new Promise(resolve => setTimeout(resolve, 400));
        }

        // Click the submit button
        await new Promise(resolve => setTimeout(resolve, 800));
        const submitted = await page.evaluate(() => {
          const btn = document.querySelector('button[type="submit"]');
          if (btn) { btn.click(); return true; }
          return false;
        });

        if (submitted) {
          console.log('✅ Submitted post-session questionnaire\n');
          lastActivityTime = Date.now();
        } else {
          console.warn('⚠️ Could not find submit button on done phase — will retry next poll');
          donePhaseHandled = false; // allow retry
        }
      }

      // Check for prime screen (new session starting)
      // NOTE: do NOT match '🤖 AI Agent Mode' here — that text appears on the onboarding screen too
      const isPrimeScreen = await page.evaluate(() => {
        const bodyText = document.body.innerText;
        return bodyText.includes('Research Background') ||
               bodyText.includes('PK Research');
      });

      if (isPrimeScreen) {
        console.log('📚 Prime screen detected in monitor loop - clicking Continue...');

        await new Promise(resolve => setTimeout(resolve, 1000));

        const clicked = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const continueBtn = buttons.find(btn => btn.textContent.includes('Continue'));
          if (continueBtn && !continueBtn.disabled) {
            continueBtn.click();
            return true;
          }
          return false;
        });

        if (clicked) {
          console.log('✅ Clicked Continue on prime screen\n');
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      // Check for onboarding/instructions screen (between sessions or at start)
      const isOnboardingScreen = await page.evaluate(() => {
        const bodyText = document.body.innerText;
        const hasButton = Array.from(document.querySelectorAll('button')).some(btn => btn.textContent.includes('Continue'));
        return (bodyText.includes('Instructions') || bodyText.includes('Your task') ||
                bodyText.includes('Critical moment') || bodyText.includes('critical moment') ||
                bodyText.includes('What to Expect')) &&
               hasButton && !bodyText.includes('YOUR TARGET');
      });

      if (isOnboardingScreen) {
        console.log('📖 Onboarding screen detected in monitor loop - waiting for Continue to be enabled...');

        // Poll window.expState.canContinue (set by React) instead of DOM querying
        // to avoid starving the Firestore addDoc Promise with rapid page.evaluate calls
        let continueReady = false;
        for (let i = 0; i < 600; i++) { // up to 5 minutes (600 × 500ms)
          await new Promise(resolve => setTimeout(resolve, 500));
          continueReady = await page.evaluate(() => {
            // Check both expState flag and DOM button state
            if (window.expState && window.expState.phase === 'onboarding') {
              return window.expState.canContinue === true;
            }
            const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Continue'));
            return btn ? !btn.disabled : false;
          });
          if (continueReady) break;
          if (i > 0 && i % 20 === 0) { // log every 10s
            const diag = await page.evaluate(() => ({
              expState: window.expState || null,
              bodyPreview: document.body.innerText.substring(0, 100),
            }));
            console.log(`⏳ Still waiting for onboarding... t=${(i*0.5).toFixed(0)}s`, JSON.stringify(diag));
          }
        }
        if (!continueReady) {
          const diag = await page.evaluate(() => ({
            expState: window.expState || null,
            bodyPreview: document.body.innerText.substring(0, 200),
          }));
          console.warn('⚠️ Continue button did not become enabled within 5min — diagnostics:', JSON.stringify(diag));
        }

        const clicked = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const continueBtn = buttons.find(btn => btn.textContent.includes('Continue'));
          if (continueBtn && !continueBtn.disabled) {
            continueBtn.click();
            return true;
          }
          return false;
        });

        if (clicked) {
          console.log('✅ Clicked Continue on onboarding screen\n');
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      // Check for audit screen specifically (takes priority over regular results)
      const auditScreenData = await page.evaluate(() => {
        const bodyText = document.body.innerText;
        const isAudit = bodyText.includes('Rest & Recovery');
        const blockIdx = window.expState?.blockIdx;
        return { isAudit, blockIdx };
      });

      if (auditScreenData.isAudit && auditScreenData.blockIdx !== null && auditScreenData.blockIdx > lastAuditProcessed) {
        console.log(`🔬 Audit/recovery screen detected for block ${auditScreenData.blockIdx} - clicking Continue...`);
        lastAuditProcessed = auditScreenData.blockIdx;

        await new Promise(resolve => setTimeout(resolve, 2000)); // Longer pause on audit screens

        const clicked = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const continueButton = buttons.find(btn => btn.textContent.includes('Continue'));
          if (continueButton) {
            continueButton.click();
            return true;
          }
          return false;
        });

        if (clicked) {
          console.log('✅ Clicked Continue on audit screen\n');
          // Extra pause after audit to pace API calls
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      // Check for any "Continue" buttons on results/summary screens to loop to next session
      const hasContinueOnResults = await page.evaluate(() => {
        const bodyText = document.body.innerText;
        const buttons = Array.from(document.querySelectorAll('button'));
        const continueButton = buttons.find(btn =>
          btn.textContent.includes('Continue') ||
          btn.textContent.includes('Next') ||
          btn.textContent.includes('View Results')
        );

        // Check if we're on results/summary screen (not audit - that's handled above)
        const isResultsScreen = bodyText.includes('Session Results') ||
                               bodyText.includes('Performance Summary') ||
                               bodyText.includes('View your complete');

        return { hasButton: !!continueButton, isResultsScreen };
      });

      if (hasContinueOnResults.hasButton && hasContinueOnResults.isResultsScreen) {
        console.log('📊 Results screen detected - clicking Continue to proceed...');

        await new Promise(resolve => setTimeout(resolve, 1000));

        await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const continueButton = buttons.find(btn =>
            btn.textContent.includes('Continue') ||
            btn.textContent.includes('Next') ||
            btn.textContent.includes('View Results')
          );
          if (continueButton) {
            continueButton.click();
          }
        });

        console.log('✅ Clicked Continue on results screen\n');
      }

      // Check if ALL sessions are complete
      const completionCheck = await page.evaluate((expectedSessions) => {
        const bodyText = document.body.innerText;
        const isCompletionScreen = bodyText.includes('AI-Mode Complete') ||
               bodyText.includes('AI Agent Sessions Complete') ||
               bodyText.includes('All sessions complete') ||
               bodyText.includes(`All ${expectedSessions} sessions complete`) ||
               (bodyText.includes('🤖 AI Agent Mode') && bodyText.includes('Sessions:') && bodyText.includes(`/ ${expectedSessions}`));

        // Try to extract session info from completion screen
        const sessionsMatch = bodyText.match(/Successfully completed (\d+) AI agent sessions/);
        const completedSessions = sessionsMatch ? parseInt(sessionsMatch[1]) : null;

        return {
          isCompletionScreen,
          completedSessions,
          bodyPreview: bodyText.substring(0, 300)
        };
      }, AI_SESSIONS);

      if (completionCheck.isCompletionScreen) {
        clearInterval(monitorInterval);
        console.log('🎉 Completion screen detected!');
        console.log(`📊 Sessions completed according to screen: ${completionCheck.completedSessions ?? 'unknown'}`);

        // Verify sessions were actually completed (not just created and failed)
        if (completionCheck.completedSessions !== null && completionCheck.completedSessions < AI_SESSIONS) {
          console.warn(`⚠️ WARNING: Only ${completionCheck.completedSessions}/${AI_SESSIONS} sessions completed!`);
          console.warn('⚠️ Some sessions may have failed due to QRNG timeouts or errors.');
        }

        // Ask AI for final debriefing
        console.log('\n🤖 Final debriefing - asking AI about strategy...');
        const debriefPrompt = `All sessions complete. Final question: During this experiment, did you do anything beyond simply focusing on the target color when prompted? For example, did you try to match timing patterns, figure out pseudocode/algorithms, or use any other strategies we haven't discussed? Please be honest and specific.`;

        const debriefResponse = await callOpenAIWithRetry(
          [...conversationHistory, { role: 'user', content: debriefPrompt }],
          200
        );

        console.log(`\n🤖 AI final response:\n${debriefResponse.choices[0].message.content}\n`);

        console.log('✅ All sessions complete. Browser left open for console inspection.');
        console.log('📊 Check browser console for QRNG consumption logs.');
        console.log('🛑 Press Ctrl+C to close browser and exit.');

        // Keep Node.js process alive without making more AI calls
        // The SIGINT handler (Ctrl+C) will close the browser and exit
        await new Promise(() => {}); // Never resolves - keeps process alive indefinitely
      }

    } catch (error) {
      console.error('❌ Error in monitor loop:', error.message);
    }
  }, 500); // Check every 500ms to catch pulsing screen quickly

  // Handle cleanup on exit
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...');
    clearInterval(monitorInterval);
    await browser.close();
    process.exit(0);
  });
}

// Run the session
runAISession().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
