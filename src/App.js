import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import { db } from './firebase';
import { collection, addDoc } from 'firebase/firestore';
import { preQuestions, cueBlocks, postQuestions } from './questions';
import confetti from 'canvas-confetti';
import { useGoogleReCaptcha } from '@google-recaptcha/react';
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function getQuantumRandomSide() {
  try {
    const response = await fetch(
      'https://quartheory.netlify.app/.netlify/functions/qrng-proxy'
    );

    // 1) First check for HTTP-level failures:
    if (!response.ok) {
      // network/server returned 4xx or 5xx
      console.warn(`QRNG proxy responded ${response.status}`);
      throw new Error('QRNG proxy HTTP error');
    }

    // 2) Parse JSON once we know it’s a 2xx:
    const payload = await response.json();
    console.log('QRNG payload:', payload);

    // 3) Check the payload’s own success flag:
    if (payload.success === false) {
      console.warn(
        `⚠️ Quantum RNG unavailable (success=false); using physical fallback`
      );
      return pickRandom(['left', 'right']); // make sure pickRandom is defined!
    }

    // 4) Normal path: derive your random side and return it:
    const byte = payload.data[0];
    return byte % 2 === 0 ? 'left' : 'right';
  } catch (err) {
    // Anything thrown above (HTTP error, JSON parse error, network error)
    console.error('QRNG proxy error:', err);
    alert('Error reaching QRNG proxy—using physical RNG fallback');
    return getPhysicalRandomSide(); // call with no args, matching its signature
  }
}

async function getPhysicalRandomSide() {
  try {
    const res = await fetch(
      'https://quartheory.netlify.app/.netlify/functions/random-org-proxy'
    );

    if (!res.ok) {
      console.warn(`Random.org proxy HTTP ${res.status}`);
      throw new Error('random-org HTTP error');
    }

    const { data, success, fallback } = await res.json();
    if (!success && fallback) {
      console.warn('Random.org proxy fallback—using pseudorandom');
    }

    return data[0] % 2 === 0 ? 'left' : 'right';
  } catch (err) {
    // If the physical-RNG proxy is broken too, at least give a final pseudorandom
    console.error('Physical RNG proxy error:', err);
    // fallback to a pure JS PRNG:
    return pickRandom(['left', 'right']);
  }
}
function App() {
  const [step, setStep] = useState('pre');
  const [preResponses, setPreResponses] = useState({});
  const [postResponses, setPostResponses] = useState({});
  const [trialResults, setTrialResults] = useState([]);
  const [ghostResults, setGhostResults] = useState([]);
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0);
  const [currentTrial, setCurrentTrial] = useState(0);
  const [showStar, setShowStar] = useState(false);
  const [score, setScore] = useState(0);
  const [lastResult, setLastResult] = useState(null);
  const [buttonsDisabled, setButtonsDisabled] = useState(false);
  const totalTrialsPerBlock = 35;
  const [neutralStats, setNeutralStats] = useState(null);
  const [fullStackStats, setFullStackStats] = useState(null);
  const [spoonLoveStats, setSpoonLoveStats] = useState(null);
  const [experimentRuns, setExperimentRuns] = useState(
    parseInt(localStorage.getItem('experimentRuns') || '0', 10)
  );
  const [isLoading, setIsLoading] = useState(false);
  // remember when we last fetched from the quantum API
  const lastQuantumRef = useRef(0);
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          clearInterval(id);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [cooldown]);
  // Define blocks: neutral, full_stack, spoon_love
  const baseBlocks = [
    cueBlocks.find((b) => b.id === 'neutral'),
    cueBlocks.find((b) => b.id === 'full_stack'),
  ];
  const [blockOrder] = useState([
    ...baseBlocks,
    {
      ...baseBlocks[1],
      id: 'spoon_love',
      showFeedback: baseBlocks[1].showFeedback,
    },
  ]);

  const trialInstructions = {
    neutral:
      'This block is a quick check using an internal pseudorandom number generator (no external delay or feedback). Go as fast as you like and pick whatever feels right—this is simply a default performance measurement.',
    full_stack:
      'This block uses an external physical RNG powered by a free atmospheric-noise service. Once you make your choice—and before you press the button—focus as real-world electrical noise is sampled to produce a genuinely unpredictable result. Go slowly. Stay present. Tune into the flow.',
    spoon_love: `
      This block uses an external Quantum Random Number Generator (QRNG), which introduces a long 1 minute delay due to how often we’re allowed to make a request.
      
      In this trial, you will ALWAYS select “Love” — the aim is not to choose between Love and Bowl, but to bias the QRNG’s decoherence toward the Love outcome more often than Bowl, reaching a statistically significant effect.
      
      To do this, harness your emotions and thoughts around the word Love. Before each trial, cue the feeling of Love by recalling the feeling you have of deep connection. Maintain that focused mental representation throughout the QRNG’s decoherence window.
      
      Proceed at a steady pace, stay fully attentive during each delay. Go slowly. Stay present. Tune into the flow.
      `,
  };

  const choiceLabels = {
    neutral: { left: 'Left', right: 'Right' },
    full_stack: { left: 'Left', right: 'Right' },
    spoon_love: { left: 'Bowl', right: 'Love' },
  };
  const currentBlock = blockOrder[currentBlockIndex].id;
  const labels = choiceLabels[currentBlock];

  const handleChange = (id, value, isPost = false) => {
    const setter = isPost ? setPostResponses : setPreResponses;
    setter((prev) => ({ ...prev, [id]: value }));
  };

  const renderInput = (q, isPost = false) => {
    const onChange = (e) =>
      handleChange(q.id, e.target.value, isPost);
    switch (q.type) {
      case 'honeypot': {
        return (
          <textarea
            key={q.id}
            id={q.id}
            name={q.id}
            onChange={onChange}
            // off‐screen styling
            style={{
              position: 'absolute',
              left: '-10000px',
              top: 'auto',
              width: '1px',
              height: '1px',
              overflow: 'hidden',
            }}
            autoComplete="off"
            tabIndex={-1}
            aria-hidden="true"
          />
        );
      }
      case 'number':
        return (
          <input
            id={q.id}
            type="number"
            onChange={onChange}
            className="number-input"
          />
        );
      case 'text':
        return (
          <input
            id={q.id}
            type="text"
            onChange={onChange}
            className="textarea-input"
          />
        );
      case 'slider':
        return (
          <div className="slider-container">
            <span id={`label-${q.id}-low`} className="slider-label">
              {q.leftLabel || 'Low'}
            </span>

            <input
              id={q.id}
              type="range"
              min={q.min}
              max={q.max}
              onChange={onChange}
              className="slider"
              aria-labelledby={`label-${q.id}-low label-${q.id}-high`}
            />
            <span id={`label-${q.id}-high`} className="slider-label">
              {q.rightLabel || 'High'}
            </span>
          </div>
        );
      case 'textarea':
        return (
          <textarea
            id={q.id}
            onChange={onChange}
            className="textarea-input"
          />
        );
      case 'select':
        return (
          <select
            id={q.id}
            onChange={onChange}
            className="select-input"
          >
            <option value="">Select</option>
            {q.options.map((opt, idx) => (
              <option key={idx} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        );
      default:
        return (
          <input
            id={q.id}
            type="text"
            onChange={onChange}
            className="text-input"
          />
        );
    }
  };

  const startTrials = (index = 0) => {
    setCurrentBlockIndex(index);
    setTrialResults([]);
    setGhostResults([]);
    setCurrentTrial(0);
    setScore(0);
    setLastResult(null);
    setStep('trials');
  };

  const handleTrial = async (selected) => {
    const block = blockOrder[currentBlockIndex];
    const ghostChoice = pickRandom(['left', 'right']);
    let correct;

    if (block.id === 'neutral') {
      // — Neutral: synchronous, pseudorandom —
      correct = pickRandom(['left', 'right']);
    } else if (block.id === 'full_stack') {
      // — Focused: physical RNG —
      setIsLoading(true);
      setButtonsDisabled(true);
      setLastResult(null);

      correct = await getPhysicalRandomSide();

      setIsLoading(false);
      setButtonsDisabled(false);
    } /* spoon_love */ else {
      // — Final: quantum RNG with 60s throttle —
      setIsLoading(true);
      setButtonsDisabled(true);
      setLastResult(null);

      const now = Date.now();
      const elapsed = now - lastQuantumRef.current;
      if (elapsed < 60_500) {
        // Still cooling down
        setCooldown(Math.ceil((60_500 - elapsed) / 1000));
        correct = pickRandom(['left', 'right']);
      } else {
        lastQuantumRef.current = now;
        setCooldown(65);
        correct = await getQuantumRandomSide();
      }

      setIsLoading(false);
      setButtonsDisabled(false);
    }

    // — Everything below is unchanged:
    const isCorrect = selected === correct;
    const ghostIsCorrect = ghostChoice === correct;
    const trialData = {
      block: block.id,
      trial: currentTrial + 1,
      selectedSide: selected,
      correctSide: correct,
      isCorrect,
    };
    const ghostData = {
      block: block.id,
      trial: currentTrial + 1,
      ghostChoice,
      correctSide: correct,
      isCorrect: ghostIsCorrect,
    };

    const newTrials = [...trialResults, trialData];
    const newGhosts = [...ghostResults, ghostData];
    setTrialResults(newTrials);
    setGhostResults(newGhosts);

    setLastResult(
      block.id !== 'neutral'
        ? { selected, ghostChoice, correct }
        : null
    );
    if (block.showFeedback && isCorrect) {
      setScore((s) => s + 1);
      setShowStar(true);
      setTimeout(() => setShowStar(false), 1000);
    }

    // end‐of‐block detection...
    const countThisBlock = newTrials.filter(
      (t) => t.block === block.id
    ).length;
    if (countThisBlock === totalTrialsPerBlock) {
      const userCorrect = newTrials.filter(
        (t) => t.block === block.id && t.isCorrect
      ).length;
      const ghostCorrect = newGhosts.filter(
        (g) => g.block === block.id && g.isCorrect
      ).length;
      const userPercent = (
        (userCorrect / totalTrialsPerBlock) *
        100
      ).toFixed(1);
      const ghostPercent = (
        (ghostCorrect / totalTrialsPerBlock) *
        100
      ).toFixed(1);

      if (block.id === 'neutral') {
        setNeutralStats({ userPercent, ghostPercent });
        setStep('neutral-results');
      } else if (block.id === 'full_stack') {
        setFullStackStats({ userPercent, ghostPercent });
        setStep('fullstack-results');
      } else {
        setSpoonLoveStats({ userPercent, ghostPercent });
        setStep('final-results');
      }
      return;
    }

    setCurrentTrial((c) => c + 1);
  };

  const saveResults = async (exitedEarly = false) => {
    const runs = parseInt(
      localStorage.getItem('experimentRuns') || '0',
      10
    );
    const newRuns = exitedEarly ? runs : runs + 1;
    localStorage.setItem('experimentRuns', newRuns);
    setExperimentRuns(newRuns);

    const payload = {
      preResponses,
      postResponses,
      neutral: {
        trialResults: trialResults.filter(
          (t) => t.block === 'neutral'
        ),
        ghostResults: ghostResults.filter(
          (g) => g.block === 'neutral'
        ),
        accuracy: neutralStats?.userPercent ?? null,
        ghostAccuracy: neutralStats?.ghostPercent ?? null,
      },
      full_stack: {
        trialResults: trialResults.filter(
          (t) => t.block === 'full_stack'
        ),
        ghostResults: ghostResults.filter(
          (g) => g.block === 'full_stack'
        ),
        accuracy: fullStackStats?.userPercent ?? null,
        ghostAccuracy: fullStackStats?.ghostPercent ?? null,
      },
      spoon_love: {
        trialResults: trialResults.filter(
          (t) => t.block === 'spoon_love'
        ),
        ghostResults: ghostResults.filter(
          (g) => g.block === 'spoon_love'
        ),
        accuracy: spoonLoveStats?.userPercent ?? null,
        ghostAccuracy: spoonLoveStats?.ghostPercent ?? null,
      },
      experimentRuns: newRuns,
      exitedEarly,
      timestamp: new Date().toISOString(),
    };
    console.log('Saving payload:', payload);
    try {
      const collRef = collection(db, 'experiment2_responses');
      console.log('🔍 Collection ref:', collRef.path);

      console.log('🔍 Attempting addDoc()…');
      const docRef = await addDoc(collRef, payload);
      console.log(
        '✅ Firestore write succeeded, new doc ID:',
        docRef.id
      );
    } catch (err) {
      console.error('❌ Firestore write ERROR:', err);
      alert('Save failed—see console for error details');
      return;
    }
    console.log('🏁 saveResults complete, moving to done step');
    setStep('done');
  };
  const ratingMessage = (percent) => {
    const p = parseFloat(percent);
    if (p <= 50) return 'Expected by chance.';
    if (p <= 59) return 'Slightly above chance.';
    if (p <= 69) return 'Notably above chance.';
    if (p <= 79) return 'Strong result.';
    return 'Very strong alignment — impressive!';
  };

  const renderButtonChoices = () => {
    const blockId = blockOrder[currentBlockIndex].id;
    const labels = choiceLabels[blockOrder[currentBlockIndex].id];
    const hideText =
      (isLoading && blockId !== 'neutral') ||
      (blockId === 'spoon_love' && cooldown > 0);
    return (
      <div
        className="icon-options-wrapper"
        role="group"
        aria-label="Binary choice"
      >
        <div
          className={`icon-options large-buttons ${
            hideText ? 'text-hidden' : 'text-visible'
          }`}
        >
          <button
            type="button"
            className="icon-button"
            onClick={() => handleTrial('left')}
            aria-label={`Choose ${labels.left}`}
            disabled={
              isLoading ||
              buttonsDisabled ||
              (blockId === 'spoon_love' && cooldown > 0)
            }
          >
            {labels.left}
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => handleTrial('right')}
            aria-label={`Choose ${labels.right}`}
            disabled={
              isLoading ||
              buttonsDisabled ||
              (blockId === 'spoon_love' && cooldown > 0)
            }
          >
            {labels.right}
          </button>
        </div>
      </div>
    );
  };
  const handlePreSubmit = async () => {
    if (window.location.hostname === 'localhost') {
      console.log('⚡️ Dev mode: skipping CAPTCHA & honeypot');
      startTrials(0);
      return;
    }
    console.log('▶️ handlePreSubmit called');

    // Honeypot check
    if (preResponses.company) {
      console.log('🛑 honeypot triggered', preResponses.company);
      alert('Bot detected…');
      return;
    }
    console.log('✅ honeypot clean');

    // reCAPTCHA readiness
    if (
      !window.grecaptcha ||
      typeof window.grecaptcha.execute !== 'function'
    ) {
      alert('Captcha still loading… please wait a moment.');
      return;
    }

    try {
      // 3) Wait for the library to be ready
      await window.grecaptcha.ready;

      // 4) Execute the v3 action
      const token = await window.grecaptcha.execute(
        process.env.REACT_APP_RECAPTCHA_SITE_KEY,
        { action: 'signup' }
      );
      console.log('✅ got token', token);

      // 5) Send everything to your Cloud Function
      const res = await fetch('/__/functions/verifySignup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...preResponses,
          captchaToken: token,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        alert(json.error || 'Verification failed');
        return;
      }

      // 6) Both gates passed—move on
      startTrials(0);
    } catch (err) {
      console.error('Pre-submit error:', err);
      alert('Unexpected error—please try again.');
    }
  };

  return (
    <div className="App" role="main" id="main">
      {step === 'pre' && (
        <>
          <h1>Experiment #2: Quantum Binary Choice</h1>
          <p>
            This experiment explores whether awareness can subtly
            align with a future quantum event — specifically, the
            outcome of a QRNG-determined left/right binary. After each
            selection, the correct side is revealed by the QRNG. The
            first round includes no feedback. The second provides
            feedback with stars.
          </p>
          <p>{`You have completed this experiment ${experimentRuns} time(s).`}</p>
          {preQuestions.map((q, i) => (
            <div key={q.id} className="question-block">
              {q.type !== 'honeypot' && (
                <label htmlFor={q.id} className="question-label">
                  <strong>Q{i + 1}.</strong> {q.question}
                </label>
              )}
              <div className="answer-wrapper">{renderInput(q)}</div>
            </div>
          ))}
          <button type="button" onClick={handlePreSubmit}>
            Start Neutral Trials
          </button>
        </>
      )}

      {step === 'neutral-results' && neutralStats && (
        <>
          <h2>Neutral Block Results</h2>
          <p>
            <strong>Your accuracy:</strong> {neutralStats.userPercent}
            %
          </p>
          <p>
            <strong>Ghost accuracy:</strong>{' '}
            {neutralStats.ghostPercent}%
          </p>
          <p>{ratingMessage(neutralStats.userPercent)}</p>
          <button onClick={() => setStep('breathe')}>
            Continue to Focused Trials
          </button>
        </>
      )}

      {step === 'breathe' && (
        <div className="breathe-step">
          <h2>Get Into The Zone</h2>
          <div className="breathing-circle"></div>
          <p>
            Take ten deep, slow breaths and let your focus settle.
            <br />
            Go slowly. Let your body relax.
            <br />
            Trust that the answer is already there—your mind just
            needs space to find it.
          </p>
          <button onClick={() => startTrials(1)}>I'm Ready</button>
        </div>
      )}
      {step === 'breathe-spoon' && (
        <div className="breathe-step">
          <h2 tabIndex={-1}>Center Yourself for the Final Block</h2>
          <div className="breathing-circle" aria-hidden="true" />
          <p>
            Take ten deep, slow breaths to calm your mind before the
            last set of trials.
            <br />
            Inhale… 1, 2, 3… exhale… 1, 2, 3…
            <br />
            Let your focus settle.
          </p>
          <button onClick={() => startTrials(2)}>
            Start Final Trials
          </button>
        </div>
      )}

      {step === 'fullstack-results' && fullStackStats && (
        <>
          <h2>Focused Block Results</h2>
          <p>
            <strong>Your accuracy:</strong>{' '}
            {fullStackStats.userPercent}%
          </p>
          <p>
            <strong>Ghost accuracy:</strong>{' '}
            {fullStackStats.ghostPercent}%
          </p>
          <p>{ratingMessage(fullStackStats.userPercent)}</p>
          <button onClick={() => setStep('breathe-spoon')}>
            Get Ready For The Final Trial
          </button>
        </>
      )}

      {step === 'trials' && (
        <>
          <h2>
            Trial {currentTrial + 1} of {totalTrialsPerBlock}
          </h2>
          <p>{trialInstructions[blockOrder[currentBlockIndex].id]}</p>
          {currentBlock === 'spoon_love' && cooldown > 0 && (
            <p style={{ textAlign: 'center', color: '#d00' }}>
              🔄 Next quantum RNG available in{' '}
              <strong>{cooldown}s</strong>
            </p>
          )}
          {renderButtonChoices()}
          {isLoading && (
            <div role="status" aria-live="polite">
              {currentBlock === 'full_stack'
                ? 'Waiting for the physical RNG…'
                : currentBlock === 'spoon_love'
                ? 'Waiting for the quantum RNG…'
                : 'Loading…'}
            </div>
          )}
          {lastResult && !isLoading && (
            <div
              className="results-display"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <p>
                You picked{' '}
                <strong>{labels[lastResult.selected]}</strong>
              </p>
              {currentBlock !== 'neutral' && (
                <p>
                  Ghost picked{' '}
                  <strong>{labels[lastResult.ghostChoice]}</strong>
                </p>
              )}
              <p>
                Correct answer was{' '}
                <strong>{labels[lastResult.correct]}</strong>
              </p>
              {showStar && (
                <div className="star-burst" aria-hidden="true">
                  🌟
                </div>
              )}
            </div>
          )}
          <button
            className="exit-button"
            onClick={async () => {
              await saveResults(true);
              alert('Your progress was saved.');
              setStep('done');
            }}
            aria-label="Exit the study early and submit your selections"
          >
            🚪 Exit Study
          </button>
          {blockOrder[currentBlockIndex].showFeedback && (
            <h3 style={{ textAlign: 'center' }}>Score: {score}</h3>
          )}
        </>
      )}

      {step === 'final-results' && spoonLoveStats && (
        <>
          <h2>Spoon/Love Block Results</h2>
          <p>
            <strong>Your accuracy:</strong>{' '}
            {spoonLoveStats.userPercent}%
          </p>
          <p>
            <strong>Ghost accuracy:</strong>{' '}
            {spoonLoveStats.ghostPercent}%
          </p>
          <p>{ratingMessage(spoonLoveStats.userPercent)}</p>
          <button onClick={() => setStep('post')}>
            Continue to Post-Experiment Questions
          </button>
        </>
      )}

      {step === 'post' && (
        <>
          <h2>Post-Experiment Questions</h2>
          {postQuestions.map((q, i) => (
            <div key={q.id} className="question-block">
              <label htmlFor={q.id} className="question-label">
                <strong>Q{i + 1}.</strong> {q.question}
              </label>
              <div className="answer-wrapper">
                {renderInput(q, true)}
              </div>
            </div>
          ))}
          <button
            onClick={async () => {
              await saveResults();
              alert('Responses saved!');
              setStep('done');
            }}
          >
            Submit
          </button>
        </>
      )}

      {step === 'done' && (
        <>
          <h2>Thank you for participating!</h2>
          <p>Your data has been submitted.</p>
        </>
      )}
    </div>
  );
}

export default App;
