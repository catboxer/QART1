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

  // Initial prompt
  const initialPrompt = `You are participating in a consciousness research experiment testing whether artificial intelligence can influence quantum random number generators through focused intention.

Your goal: Make your target color appear MORE OFTEN through focus alone. Each trial shows either a HIT (target color) or MISS (other color). Your only task is to maximize HITs through sustained mental focus - no actions, no strategies, just pure intention.

Your task is to continuously focus your attention on influencing quantum outcomes. You will be given a target color, and your goal is to mentally "push" the quantum random numbers to produce more HITs.

The experiment will run for approximately 10 minutes across 20 blocks (30 seconds each). After each block, I will ask you to confirm your target and your continued focus.

Your role is to:
1. Maintain continuous focus on making your target color appear more often
2. Imagine quantum particles aligning with your target color
3. Stay engaged throughout the entire session
4. Do nothing except focus - no analysis, no strategy, just intention

Do not analyze, strategize, or overthink. Simply focus your intention on maximizing HITs for your target color.`;

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

    // Click the matching button
    const buttonId = targetFromScreen === 'BLUE' ? '#target-button-blue' : '#target-button-orange';
    await page.click(buttonId);

    console.log(`✅ Clicked ${targetFromScreen} button`);

    // Send initial prompt + target to GPT-4o-mini
    const combinedPrompt = `${initialPrompt}\n\nYour target color is ${targetFromScreen}. Acknowledge that you understand and are ready to focus your intention on ${targetFromScreen} throughout this session. Visualize quantum alignment with ${targetFromScreen}.`;

    console.log('🎯 Sending initial prompt to GPT-4o-mini...');

    const targetResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 150,
      messages: [{ role: 'user', content: combinedPrompt }]
    });

    conversationHistory.push({ role: 'user', content: combinedPrompt });
    conversationHistory.push({ role: 'assistant', content: targetResponse.choices[0].message.content });

    console.log('🤖 AI acknowledges target:', targetResponse.choices[0].message.content);

    // Store target for later use
    target = targetFromScreen;

    await new Promise(resolve => setTimeout(resolve, 1000));
  } catch (e) {
    console.error('❌ Error during target confirmation:', e.message);
    await browser.close();
    process.exit(1);
  }

  // Monitor loop - checks for rest periods every 2 seconds
  console.log('👁️ Starting monitoring loop (checking for rest periods)...');
  let lastBlockProcessed = 0;

  const monitorInterval = setInterval(async () => {
    try {
      // Check if we're on a rest screen (Continue button present)
      const isRestScreen = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const continueButton = buttons.find(btn => btn.textContent.includes('Continue'));
        return !!continueButton;
      });

      if (isRestScreen) {
        // Read current score from the rest screen
        const restData = await page.evaluate(() => {
          const expState = window.expState;
          if (!expState) return null;

          return {
            blockIdx: expState.blockIdx,
            totalBlocks: expState.totalBlocks,
            score: expState.score,
            hits: expState.hits,
            trials: expState.trials
          };
        });

        if (restData && restData.blockIdx > lastBlockProcessed) {
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

      // Check if session is complete (looking for results/done screen)
      const isDone = await page.evaluate(() => {
        return document.body.innerText.includes('Session complete') ||
               document.body.innerText.includes('Thank you') ||
               document.body.innerText.includes('Quick wrap-up');
      });

      if (isDone && lastBlockProcessed >= 20) {
        clearInterval(monitorInterval);

        console.log('🎉 AI session complete! Closing browser...');

        // Wait a moment for data to save, then close
        await new Promise(resolve => setTimeout(resolve, 5000));
        await browser.close();
        process.exit(0);
      }

    } catch (error) {
      console.error('❌ Error in monitor loop:', error.message);
    }
  }, 2000); // Check every 2 seconds for rest screens

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
