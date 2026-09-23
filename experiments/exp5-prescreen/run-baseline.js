// experiments/exp5-prescreen/run-baseline.js
// Runs one exp5-prescreen baseline ("auto-mode") session through a real Chromium
// browser hitting the live deployed site -- exp5-prescreen's AUTO_MODE_SESSIONS
// already defaults to 1 in src/config.js, so a single page load is exactly one
// session; no early-stop trick needed (unlike exp4's equivalent script, which had
// to be stopped early since exp4 defaults to a 20-session batch per page load).
//
// exp5-prescreen's ensureRunDoc() call sites all already gate on `uid` (verified
// 2026-09-11), so this does not need the local-dev-server workaround exp4 needed
// for its equivalent uid-race bug -- safe to hit production directly.
//
// Usage:
//   node experiments/exp5-prescreen/run-baseline.js            # visible browser
//   HEADLESS=1 node experiments/exp5-prescreen/run-baseline.js # no window

const puppeteer = require('puppeteer');

// msg.text() prints "JSHandle@error" for Error objects passed to console.error
// (they don't serialize). Pull the real message/stack out of the page context.
async function stringifyConsoleArgs(msg) {
  const parts = await Promise.all(msg.args().map(async (arg) => {
    try {
      return await arg.evaluate((val) => (val instanceof Error ? (val.stack || val.message) : val));
    } catch {
      return null;
    }
  }));
  return parts
    .map((p) => (typeof p === 'string' ? p : JSON.stringify(p)))
    .join(' ');
}

const EXPERIMENT_URL = 'https://experiments.whatthequark.com/exp5-prescreen/#auto';
const HEADLESS = process.env.HEADLESS === '1';
const SESSION_TIMEOUT_MS = parseInt(process.env.SESSION_TIMEOUT_MS, 10) || 10 * 60 * 1000;

async function runBaseline() {
  console.log('🧪 Starting exp5-prescreen Baseline (auto-mode) session run');
  console.log(`📍 Experiment URL: ${EXPERIMENT_URL}`);
  console.log(`🖥️  Headless: ${HEADLESS}`);

  const browser = await puppeteer.launch({
    headless: HEADLESS,
    defaultViewport: { width: 1280, height: 720 },
  });

  const page = await browser.newPage();

  let qrngErrorCount = 0;
  let disconnected = false;
  let intentionalClose = false;

  browser.on('disconnected', () => {
    disconnected = true;
    if (intentionalClose) return;
    console.error('❌ Browser disconnected/crashed unexpectedly.');
  });

  page.on('dialog', async (dialog) => {
    const message = dialog.message();
    console.log(`⚠️ DIALOG DETECTED - Type: ${dialog.type()}, Message: ${message}`);

    if (message.includes('QRNG') || message.includes('timeout') || message.includes('unavailable')) {
      qrngErrorCount++;
      console.error(`❌ QRNG ERROR #${qrngErrorCount}: ${message}`);

      if (qrngErrorCount >= 3) {
        console.error('❌ FATAL: Multiple QRNG errors detected. The quantum service appears to be down.');
        await dialog.accept();
        await new Promise((resolve) => setTimeout(resolve, 1000));
        intentionalClose = true;
        await browser.close().catch(() => {});
        process.exit(1);
      }
    }

    await dialog.accept();
  });

  page.on('pageerror', (err) => {
    console.error('❌ Page error:', err.message);
  });

  page.on('console', async (msg) => {
    const text = await stringifyConsoleArgs(msg);
    console.log(`[page ${new Date().toISOString()}] ${text}`);
  });

  const screenStatePoll = setInterval(async () => {
    try {
      const preview = await page.evaluate(() => document.body.innerText.slice(0, 200));
      console.log(`[screen ${new Date().toISOString()}] ${JSON.stringify(preview)}`);
    } catch (e) {
      console.log(`[screen ${new Date().toISOString()}] (could not read page: ${e.message})`);
    }
  }, 20000);

  const runPromise = new Promise((resolveRun) => {
    const checkComplete = setInterval(async () => {
      try {
        const isComplete = await page.evaluate(() =>
          document.body.innerText.includes('Auto-Mode Complete') ||
          document.body.innerText.includes('Baseline Data Collection Complete')
        );
        if (isComplete) {
          clearInterval(checkComplete);
          intentionalClose = true;
          await browser.close().catch(() => {});
          resolveRun('done');
        }
      } catch (e) {
        // page may be mid-navigation; ignore transient eval failures
      }
    }, 2000);

    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down...');
      clearInterval(checkComplete);
      intentionalClose = true;
      await browser.close().catch(() => {});
      process.exit(0);
    });

    page.goto(EXPERIMENT_URL).then(() => {
      console.log('✅ Browser launched, navigating to experiment (auto-mode skips consent/questionnaires)');
    }).catch((err) => {
      console.error('❌ Navigation failed:', err.message);
      clearInterval(checkComplete);
      resolveRun('nav_failed');
    });
  });

  const timeoutPromise = new Promise((resolve) => {
    setTimeout(() => resolve('timeout'), SESSION_TIMEOUT_MS);
  });

  const disconnectPromise = new Promise((resolve) => {
    const check = setInterval(() => {
      if (disconnected) { clearInterval(check); resolve('disconnected'); }
    }, 1000);
  });

  const outcome = await Promise.race([runPromise, timeoutPromise, disconnectPromise]);
  clearInterval(screenStatePoll);

  if (outcome === 'timeout') {
    console.error(`❌ TIMEOUT: session did not complete within ${SESSION_TIMEOUT_MS}ms. Force-closing browser.`);
    intentionalClose = true;
    await browser.close().catch(() => {});
    process.exit(1);
  }
  if (outcome === 'disconnected') {
    console.error('❌ Exiting due to browser disconnect/crash.');
    process.exit(1);
  }
  if (outcome === 'nav_failed') {
    process.exit(1);
  }

  console.log('✅ Baseline run complete. Browser closed.');
  process.exit(0);
}

runBaseline().catch((err) => {
  console.error('❌ Fatal error running baseline session:', err);
  process.exit(1);
});
