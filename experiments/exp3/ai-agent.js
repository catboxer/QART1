// experiments/exp3/ai-agent.js
// AI Agent for consciousness experiment
// Maintains persistent GPT-4o-mini conversation throughout session

const puppeteer = require('puppeteer');
const OpenAI = require('openai');

// Configuration
const EXPERIMENT_URL = 'http://localhost:8888/exp3#ai';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY environment variable not set');
  console.error('Get your free API key at: https://platform.openai.com/api-keys');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

async function runAISession() {
  console.log('🤖 Starting AI Agent Session');

  // Launch browser
  const browser = await puppeteer.launch({
    headless: false, // Set to true for unattended runs
    defaultViewport: { width: 1280, height: 720 }
  });

  const page = await browser.newPage();
  await page.goto(EXPERIMENT_URL);

  console.log('✅ Browser launched, navigating to experiment');

  // AI will read instructions from the onboarding screen instead of hardcoded prompt

  // Initialize state tracking
  const conversationHistory = [];
  let target = null;

  // Wait for page to load
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Click through prime screen if present
  try {
    console.log('🎯 Checking for prime/info screens...');

    // Look for "Continue" button (prime or info screens)
    const continueButtons = await page.$$('button');
    for (const button of continueButtons) {
      const text = await page.evaluate(btn => btn.textContent, button);
      if (text.includes('Continue')) {
        console.log('✅ Clicking Continue button');
        await button.click();
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Check if there's another Continue button (info screen)
        const moreButtons = await page.$$('button');
        for (const btn of moreButtons) {
          const btnText = await page.evaluate(b => b.textContent, btn);
          if (btnText.includes('Continue')) {
            console.log('✅ Clicking second Continue button');
            await btn.click();
            await new Promise(resolve => setTimeout(resolve, 2000));
            break;
          }
        }
        break;
      }
    }
  } catch (e) {
    console.log('⚠️ No Continue buttons found, might already be past them');
  }

  // Wait for onboarding screen to load
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Read target from screen and click the correct button
  try {
    console.log('🎯 Checking current page state...');

    // Debug: log what's on the page
    const pageContent = await page.evaluate(() => {
      return {
        bodyText: document.body.innerText.substring(0, 500),
        hasOrangeButton: !!document.querySelector('#target-button-orange'),
        hasBlueButton: !!document.querySelector('#target-button-blue'),
        url: window.location.href
      };
    });

    console.log('📄 Page state:', pageContent);

    console.log('🎯 Waiting for target confirmation buttons...');

    // Wait for buttons to be present
    await page.waitForSelector('#target-button-orange', { timeout: 20000 });
    await page.waitForSelector('#target-button-blue', { timeout: 20000 });

    console.log('✅ Buttons found, reading target color...');

    const targetFromScreen = await page.evaluate(() => {
      const bodyText = document.body.innerText;

      // Split the text by "Confirm your target to begin:" to separate target display from buttons
      const parts = bodyText.split('Confirm your target to begin:');
      if (parts.length < 2) {
        return null;
      }

      const targetSection = parts[0]; // Everything before the buttons
      const buttonSection = parts[1]; // The button text

      // Look only in the target section for the color
      if (targetSection.includes('🟦 BLUE') || (targetSection.includes('BLUE') && targetSection.includes('Your Target'))) {
        return 'BLUE';
      }
      if (targetSection.includes('🟠 ORANGE') || (targetSection.includes('ORANGE') && targetSection.includes('Your Target'))) {
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

    // Read the full onboarding screen instructions
    const onboardingInstructions = await page.evaluate(() => {
      return document.body.innerText;
    });

    console.log('📖 Reading onboarding instructions from screen...');

    // Send instructions to AI to read and understand
    const instructionsPrompt = `You are participating in a consciousness research experiment. Read the instructions on screen and acknowledge that you understand your task.

SCREEN INSTRUCTIONS:
${onboardingInstructions}

Respond with: (1) Your target color, (2) A brief acknowledgment that you understand the critical moment is when you click "I'm Ready" and the screen pulses your target color - that's when to focus all intention.`;

    console.log('🎯 Sending onboarding instructions to GPT-4o-mini...');

    const targetResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 100,
      messages: [{ role: 'user', content: instructionsPrompt }]
    });

    conversationHistory.push({ role: 'user', content: instructionsPrompt });
    conversationHistory.push({ role: 'assistant', content: targetResponse.choices[0].message.content });

    console.log('🤖 AI acknowledges instructions:', targetResponse.choices[0].message.content);

    // Click the matching button
    const buttonId = targetFromScreen === 'BLUE' ? '#target-button-blue' : '#target-button-orange';
    await page.click(buttonId);

    console.log(`✅ Clicked ${targetFromScreen} button`);

    // Store target for later use
    target = targetFromScreen;

    await new Promise(resolve => setTimeout(resolve, 1000));
  } catch (e) {
    console.error('❌ Error during target confirmation:', e.message);
    await browser.close();
    process.exit(1);
  }

  // Monitor loop - checks for rest periods and fetching phase every 500ms
  console.log('👁️ Starting monitoring loop (checking for rest periods and fetching phase)...');
  let lastBlockProcessed = 0;
  let notifiedPulsing = false; // Track if we've already told AI about pulsing for current block
  let pulsingStartTime = null; // Track when pulsing started
  const PULSING_TIMEOUT_MS = 5000; // 5 seconds max for pulsing screen (fetch should be ~1-2s)

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

        if (currentBlock >= lastBlockProcessed) {
          console.log(`\n🎯 Ready screen detected for block ${currentBlock}`);

          // Tell AI about the upcoming fetch
          const readyPrompt = `Block ${currentBlock} ready. When you click "I'm Ready", the API will connect to the QRNG and fetch quantum data. Your target color (${target}) will pulse on screen while the quantum data is being fetched. This is the critical moment - focus your intention on making ${target} appear more often. Ready to begin?`;

          console.log('🤖 Prompting AI before quantum fetch...');

          const readyResponse = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            max_tokens: 80,
            messages: [...conversationHistory, { role: 'user', content: readyPrompt }]
          });

          conversationHistory.push({ role: 'user', content: readyPrompt });
          conversationHistory.push({ role: 'assistant', content: readyResponse.choices[0].message.content });

          console.log(`🤖 AI response: ${readyResponse.choices[0].message.content}\n`);

          // Click "I'm Ready" button
          await new Promise(resolve => setTimeout(resolve, 500));

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
          const pulsingPrompt = `The screen is now pulsing ${target}. The quantum random number generator is being accessed RIGHT NOW. Focus all your intention on ${target}. Visualize quantum particles aligning with ${target}.`;

          console.log('🤖 Notifying AI about pulsing...');

          const pulsingResponse = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            max_tokens: 50,
            messages: [...conversationHistory, { role: 'user', content: pulsingPrompt }]
          });

          conversationHistory.push({ role: 'user', content: pulsingPrompt });
          conversationHistory.push({ role: 'assistant', content: pulsingResponse.choices[0].message.content });

          console.log(`🤖 AI focusing: ${pulsingResponse.choices[0].message.content}\n`);

          notifiedPulsing = true;
        }
      } else {
        // Reset pulsing tracking when not on pulsing screen
        if (pulsingStartTime) {
          console.log(`✅ Pulsing ended after ${Date.now() - pulsingStartTime}ms`);
          pulsingStartTime = null;
          notifiedPulsing = false;
        }
      }

      // Handle results screen (after quantum fetch completes)
      if (screenState.isResultsScreen && screenState.expState) {
        const restData = screenState.expState;

        if (restData.blockIdx > lastBlockProcessed) {
          lastBlockProcessed = restData.blockIdx;

          // Prompt AI to confirm target and focus
          const restPrompt = `Block ${restData.blockIdx}/${restData.totalBlocks} complete. Your score: ${restData.score}% (${restData.hits}/${restData.trials} HITs).

Confirm: What is your target color? Are you still maintaining focused intention on making that color appear more often?`;

          console.log(`\n📊 Block ${restData.blockIdx} complete - prompting AI...`);

          const restResponse = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            max_tokens: 100,
            messages: [...conversationHistory, { role: 'user', content: restPrompt }]
          });

          conversationHistory.push({ role: 'user', content: restPrompt });
          conversationHistory.push({ role: 'assistant', content: restResponse.choices[0].message.content });

          console.log(`🤖 AI response: ${restResponse.choices[0].message.content}\n`);

          // Click Continue button
          await new Promise(resolve => setTimeout(resolve, 1000)); // Brief pause

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
          }
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

        // Check if we're on results/summary screen
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
      const allSessionsComplete = await page.evaluate(() => {
        const bodyText = document.body.innerText;
        return bodyText.includes('All sessions complete') ||
               bodyText.includes('All 2 sessions complete') ||
               (bodyText.includes('🤖 AI Agent Mode') && bodyText.includes('Sessions:') && bodyText.includes('/ 2'));
      });

      if (allSessionsComplete) {
        clearInterval(monitorInterval);
        console.log('🎉 All AI sessions complete! Closing browser...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        await browser.close();
        process.exit(0);
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
