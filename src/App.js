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
  try {
    const response = await fetch(
      'https://qrng.anu.edu.au/API/jsonI.php?length=1&type=uint8'
    );
    const data = await response.json();
    return data.data[0] % 2 === 0 ? 'left' : 'right';
  } catch (error) {
    console.error(
      'QRNG fallback to pseudorandom due to error:',
      error
    );
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
      'This block uses an external Quantum Random Number Generator (QRNG), which introduces a short delay. Once you make your choice and before you push the button focus on what you want returned. The QRNG samples a quantum event and returns the result. Go slowly. Stay present. Tune into the flow.',
    spoon_love:
      'This block also uses an external Quantum Random Number Generator (QRNG), which introduces a short delay. In this trial, you will ALWAYS select “Love” — the aim is not to choose between Love and Bowl, but to bias the QRNG’s decoherence toward the Love outcome more often than Bowl, reaching a statistically significant effect. To do this, harness your emotions and thoughts around the word Love. Before each trial, cue the feeling of Love by recalling the feeling you have of deep connection. Maintain that focused mental representation throughout the QRNG’s decoherence window. Proceed at a steady pace, stay fully attentive during each delay. Go slowly. Stay present. Tune into the flow.',
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
    setIsLoading(true);
    setButtonsDisabled(true);
    setLastResult(null);

    const block = blockOrder[currentBlockIndex];
    const ghostChoice = pickRandom(['left', 'right']);
    const correct =
      block.id === 'full_stack' || block.id === 'spoon_love'
        ? await getQuantumRandomSide()
        : pickRandom(['left', 'right']);

    setIsLoading(false);
    setButtonsDisabled(false);

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

    // End of block
    if (currentTrial + 1 === totalTrialsPerBlock) {
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
    const labels = choiceLabels[blockOrder[currentBlockIndex].id];
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
            disabled={isLoading}
          >
            {labels.left}
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => handleTrial('right')}
            aria-label={`Choose ${labels.right}`}
            disabled={isLoading}
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
            This experiment explores whether awareness can subtly
            align with a future quantum event — specifically, the
            outcome of a QRNG-determined left/right binary. After each
            selection, the correct side is revealed by the QRNG. The
            first round includes no feedback. The second provides
            feedback with stars.
          </p>
          <p>
            You’ve completed this experiment{' '}
            <strong>{experimentRuns}</strong>
            time(s).
          </p>
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
          {renderButtonChoices()}
          {isLoading && (
            <div role="status" aria-live="polite">
              Waiting for the quantum RNG…
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
