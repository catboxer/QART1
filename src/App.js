import React, { useState } from 'react';
import './App.css';
import { db } from './firebase';
import { collection, addDoc } from 'firebase/firestore';
import { preQuestions, cueBlocks, postQuestions } from './questions';
import confetti from 'canvas-confetti';

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function getQuantumRandomSide() {
  // Helper to interpret a byte as 'left'|'right'
  const byteToChoice = (byte) => (byte % 2 === 0 ? 'left' : 'right');

  // 1) First try the LFDR proxy
  try {
    const res1 = await fetch(
      'https://qarttheory.netlify.app/.netlify/functions/lfdr-qrng',
      { cache: 'no-store' }
    );
    const p1 = await res1.json(); // { data: [byte], success: bool, fallback: bool, ... }
    if (p1.success) {
      console.log('LFDR QRNG response:', p1);
      console.log('Using LFDR QRNG byte:', p1.data[0]);
      return byteToChoice(p1.data[0]);
    }
    console.warn('LFDR QRNG proxy failed, falling back');
  } catch (err) {
    console.warn('LFDR fetch error, falling back:', err);
  }

  // 2) Then try the ANU proxy
  try {
    const res2 = await fetch(
      'https://qarttheory.netlify.app/.netlify/functions/qrng-proxy',
      { cache: 'no-store' }
    );
    const p2 = await res2.json(); // same shape
    if (p2.success) {
      console.log('ANU QRNG response:', p2);
      console.log('Using ANU QRNG bit:', p2.data[0]);
      return byteToChoice(p2.data[0]);
    }
    console.warn('ANU QRNG proxy failed, falling back');
  } catch (err) {
    console.warn('ANU fetch error, falling back:', err);
  }

  // 3) Then your physical RNG
  try {
    console.warn('Falling back to Physical RNG');
    return await getPhysicalRandomSide(); // returns 'left'|'right'
  } catch (err) {
    console.warn('Physical RNG failed:', err);
  }

  // 4) Last-resort pseudorandom
  console.warn(
    'All external RNGs failed—using pseudorandom fallback'
  );
  return pickRandom(['left', 'right']);
}

async function getPhysicalRandomSide() {
  try {
    const res = await fetch(
      'https://qarttheory.netlify.app/.netlify/functions/random-org-proxy',
      { cache: 'no-store' }
    );
    if (!res.ok) {
      throw new Error(`Physical RNG HTTP ${res.status}`);
    }
    const { data } = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('Physical RNG returned no data');
    }
    return data[0] % 2 === 0 ? 'left' : 'right';
  } catch (err) {
    console.error(
      'Physical RNG failed, falling back to pseudorandom:',
      err
    );
    // last‐resort pseudo-random choice
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
  // const lastQuantumRef = useRef(0);
  // const [cooldown, setCooldown] = useState(0);
  // useEffect(() => {
  //   if (cooldown <= 0) return;
  //   const id = setInterval(() => {
  //     setCooldown((c) => {
  //       if (c <= 1) {
  //         clearInterval(id);
  //         return 0;
  //       }
  //       return c - 1;
  //     });
  //   }, 1000);
  //   return () => clearInterval(id);
  // }, [cooldown]);
  // Define blocks: neutral, full_stack, spoon_love
  // Define blocks: full_stack (PRNG) and spoon_love (QRNG)
  const fullStackBlock = cueBlocks.find((b) => b.id === 'full_stack');
  const [blockOrder] = useState([
    {
      ...fullStackBlock,
      showFeedback: false, // disable feedback here
    },
    {
      ...fullStackBlock,
      id: 'spoon_love',
      showFeedback: true, // keep feedback for QRNG block if desired
    },
  ]);

  const trialInstructions = {
    neutral:
      'This block is a quick check using an internal pseudorandom number generator (no external delay or feedback). Go as fast as you like and pick whatever feels right—this is simply a default performance measurement.',
    full_stack:
      'This block uses an external Physical Random Number Generator (PRNG). Go as fast as you like and pick whatever you think the answer should be—this is simply a default performance measurement.',
    spoon_love:
      'This block uses a Quantum Random Number Generator (QRNG).<br /><br />Always choose “Love”.<br /><br />Focus on the feeling of Love before each trial and hold it through the moment of choice.<br /><br />Tune in and proceed with intention.',
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
      case 'number':
        return (
          <input
            id={q.id}
            type="number"
            onChange={onChange}
            className="number-input"
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

      // const now = Date.now();
      // const elapsed = now - lastQuantumRef.current;
      // if (elapsed < 60_000) {
      //   // Still cooling down
      //   setCooldown(Math.ceil((60_000 - elapsed) / 1000));
      //   correct = pickRandom(['left', 'right']);
      // } else {
      //   lastQuantumRef.current = now;
      //   setCooldown(60);
      //   correct = await getQuantumRandomSide();
      // }
      correct = await getQuantumRandomSide();
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

      if (userPercent > 65) {
        confetti({
          particleCount: 150,
          spread: 100,
          origin: { y: 0.6 },
        });
      }
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
    // const blockId = blockOrder[currentBlockIndex].id;
    const labels = choiceLabels[blockOrder[currentBlockIndex].id];
    // const hideText = isLoading && blockId !== 'neutral';
    return (
      <div
        className="icon-options-wrapper"
        role="group"
        aria-label="Binary choice"
      >
        <div
          className={`icon-options large-buttons ${
            buttonsDisabled ? 'text-hidden' : 'text-visible'
          }`}
        >
          <button
            type="button"
            className="icon-button"
            onClick={() => handleTrial('left')}
            aria-label={`Choose ${labels.left}`}
            disabled={isLoading || buttonsDisabled}
          >
            {labels.left}
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => handleTrial('right')}
            aria-label={`Choose ${labels.right}`}
            disabled={isLoading || buttonsDisabled}
          >
            {labels.right}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="App" role="main" id="main">
      {step === 'pre' && (
        <>
          <h1>Experiment #2: Quantum Binary Choice</h1>
          <p>
            Goal: To test whether awareness, when emotionally engaged
            and focused, can influence which outcome decoheres —
            within the lawful constraints of probability.
          </p>
          <p>
            You may take this test as many times as you like. With
            practice, you may improve your ability to tune in and
            influence the outcome.
          </p>

          <p>{`You have completed this experiment ${experimentRuns} time(s).`}</p>
          {preQuestions.map((q, i) => (
            <div key={q.id} className="question-block">
              <label htmlFor={q.id} className="question-label">
                <strong>Q{i + 1}.</strong> {q.question}
              </label>
              <div className="answer-wrapper">{renderInput(q)}</div>
            </div>
          ))}
          <button onClick={() => startTrials(0)}>
            Start Neutral Trials
          </button>
        </>
      )}

      {/* {step === 'breathe' && (
        <div className="breathe-step">
          <h2>Get Into The Zone</h2>
          <div className="breathing-circle"></div>
          <p>
            Take ten deep, slow breaths and let your focus settle.
            <br />
            Go slowly. Let your body relax.
            <br />
            Now, bring to mind someone you love — and let that feeling
            wash over you. Stay with that sensation for a moment
            before making your choice.
          </p>
          <button onClick={() => startTrials(1)}>I'm Ready</button>
        </div>
      )} */}
      {step === 'breathe-spoon' && (
        <div className="breathe-step">
          <h2 tabIndex={-1}>Center Yourself for the Quantum Block</h2>
          <div className="breathing-circle" aria-hidden="true" />
          <p>
            Take ten deep, slow breaths and let your focus settle.
            <br />
            Go slowly. Let your body relax.
            <br />
            Now, bring to mind someone you love — and let that feeling
            wash over you. Stay with that sensation for a moment
            before making your choice.
          </p>
          <button onClick={() => startTrials(1)}>
            Start Quantum Trials
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
            Get Ready For The Quantum Trial
          </button>
        </>
      )}

      {step === 'trials' && (
        <>
          <h2>
            Trial {currentTrial + 1} of {totalTrialsPerBlock}
          </h2>

          <div
            dangerouslySetInnerHTML={{
              __html:
                trialInstructions[blockOrder[currentBlockIndex].id],
            }}
          />

          {renderButtonChoices()}

          {isLoading && (
            <div role="status" aria-live="polite">
              {currentBlock === 'spoon_love'
                ? 'Waiting for the quantum RNG…'
                : currentBlock === 'full_stack'
                ? 'Waiting for the physical RNG…'
                : 'Waiting…'}
            </div>
          )}
          {blockOrder[currentBlockIndex].showFeedback &&
            lastResult &&
            !isLoading && (
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
