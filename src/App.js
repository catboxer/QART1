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
  const [blockOrder] = useState([
    cueBlocks.find((b) => b.id === 'neutral'),
    cueBlocks.find((b) => b.id === 'full_stack'),
  ]);
  const [showStar, setShowStar] = useState(false);
  const [score, setScore] = useState(0);
  const [lastResult, setLastResult] = useState(null);
  const [buttonsDisabled, setButtonsDisabled] = useState(false);
  const totalTrialsPerBlock = 35;
  const [neutralStats, setNeutralStats] = useState(null);
  const [finalStats, setFinalStats] = useState(null);
  const [experimentRuns, setExperimentRuns] = useState(1);
  // inside your App function, before the return:
  const currentBlock = blockOrder[currentBlockIndex];
  const trialInstructions = {
    neutral: `This block is a quick check using an internal pseudorandom number generator (no external delay or feedback). Go as fast as you like and pick whatever feels right—this is simply a default performance measurement. `,
    full_stack: `This block uses an external Quantum Random Number
            Generator (QRNG), which introduces a short delay. Once you
            make your choice, the QRNG samples a quantum event and
            returns the result. Go slowly. Stay present. Tune into the
            flow.`,
  };
  const currentInstruction =
    currentBlock && trialInstructions[currentBlock.id];
  const handleChange = (id, value, isPost = false) => {
    const updater = isPost ? setPostResponses : setPreResponses;
    updater((prev) => ({ ...prev, [id]: value }));
  };
  const renderInput = (q, isPost = false) => {
    const onChange = (e) =>
      handleChange(q.id, e.target.value, isPost);
    if (q.type === 'number') {
      return (
        <input
          id={q.id}
          type="number"
          onChange={onChange}
          className="number-input"
        />
      );
    }
    if (q.type === 'slider') {
      return (
        <div className="slider-container">
          <span className="slider-label">{q.leftLabel || 'Low'}</span>
          <input
            id={q.id}
            type="range"
            min={q.min}
            max={q.max}
            onChange={onChange}
            className="slider"
            aria-labelledby={`label-${q.id}`}
          />
          <span className="slider-label">
            {q.rightLabel || 'High'}
          </span>
        </div>
      );
    }
    if (q.type === 'textarea') {
      return (
        <textarea
          id={q.id}
          onChange={onChange}
          className="textarea-input"
        />
      );
    }
    if (q.type === 'select') {
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
    }
    return (
      <input
        id={q.id}
        type="text"
        onChange={onChange}
        className="text-input"
      />
    );
  };
  const startTrials = (isFullStack = false) => {
    if (isFullStack) {
      setCurrentBlockIndex(1);
    }
    setGhostResults([]);
    setTrialResults([]);
    setCurrentTrial(0);
    setScore(0);
    setLastResult(null);
    setStep('trials');
  };

  const handleTrial = async (selected) => {
    setButtonsDisabled(true);
    try {
      const currentBlock = blockOrder[currentBlockIndex];
      const ghostChoice = pickRandom(['left', 'right']);
      const correct =
        currentBlock.id === 'full_stack'
          ? await getQuantumRandomSide()
          : pickRandom(['left', 'right']);

      const isCorrect = selected === correct;
      const ghostIsCorrect = ghostChoice === correct;

      const newTrial = {
        block: currentBlock.id,
        trial: currentTrial + 1,
        selectedSide: selected,
        correctSide: correct,
        isCorrect,
      };

      const newGhost = {
        block: currentBlock.id,
        trial: currentTrial + 1,
        ghostChoice,
        correctSide: correct,
        isCorrect: ghostIsCorrect,
      };

      const updatedTrialResults = [...trialResults, newTrial];
      const updatedGhostResults = [...ghostResults, newGhost];

      setTrialResults(updatedTrialResults);
      setGhostResults(updatedGhostResults);
      setLastResult(
        currentBlock.id === 'full_stack'
          ? { selected, ghostChoice, correct }
          : null
      );

      if (currentBlock.showFeedback && isCorrect) {
        setScore((prev) => prev + 1);
        setShowStar(true);
        setTimeout(() => setShowStar(false), 1000);
      } else {
        setShowStar(false);
      }

      if (currentTrial + 1 === totalTrialsPerBlock) {
        const userCorrect = updatedTrialResults.filter(
          (t) => t.block === currentBlock.id && t.isCorrect
        ).length;
        const ghostCorrect = updatedGhostResults.filter(
          (g) => g.block === currentBlock.id && g.isCorrect
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

        if (currentBlockIndex === 0) {
          setNeutralStats({ userPercent, ghostPercent });
          setStep('neutral-results');
        } else {
          setFinalStats({ userPercent, ghostPercent });
          setStep('final-results');
        }

        return;
      }

      if (currentBlock.id === 'full_stack') {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      // clear the old result and bump to the next trial
      setLastResult(null);
      setCurrentTrial((prev) => prev + 1);
    } finally {
      // only now do we re-enable the buttons
      setButtonsDisabled(false);
    }
  };
  const saveResults = async (exitedEarly = false) => {
    const storedRuns = parseInt(
      localStorage.getItem('experimentRuns') || '0',
      10
    );
    const newCount = exitedEarly ? storedRuns : storedRuns + 1;
    localStorage.setItem('experimentRuns', newCount);
    setExperimentRuns(newCount);

    await addDoc(collection(db, 'experiment2_responses'), {
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
        accuracy: neutralStats?.userPercent ?? null,
        ghostAccuracy: neutralStats?.ghostPercent ?? null,
      },
      experimentRuns: newCount,
      exitedEarly,
      timestamp: new Date().toISOString(),
    });
  };

  const renderButtonChoices = () => (
    <div
      className="icon-options-wrapper"
      role="group"
      aria-label="Binary choice between left and right"
    >
      <div
        className={`icon-options large-buttons ${
          buttonsDisabled ? 'text-hidden' : 'text-visible'
        }`}
      >
        <button
          className="icon-button"
          onClick={() => handleTrial('left')}
          aria-label="Choose Left"
          disabled={buttonsDisabled}
        >
          Left
        </button>
        <button
          className="icon-button"
          onClick={() => handleTrial('right')}
          aria-label="Choose Right"
          disabled={buttonsDisabled}
        >
          Right
        </button>
      </div>
    </div>
  );

  const ratingMessage = (percent) => {
    const p = parseFloat(percent);
    if (p <= 50) return 'Expected by chance.';
    if (p <= 59) return 'Slightly above chance.';
    if (p <= 69) return 'Notably above chance.';
    if (p <= 79) return 'Strong result.';
    return 'Very strong alignment — impressive!';
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
            <strong>{experimentRuns}</strong> time(s).
          </p>
          {preQuestions.map((q, index) => (
            <div key={q.id} className="question-block">
              <label htmlFor={q.id} className="question-label">
                <strong className="question-number">
                  Q{index + 1}.
                </strong>{' '}
                {q.question}
              </label>
              <div className="answer-wrapper">
                {renderInput(q, true)}
              </div>
            </div>
          ))}
          <button onClick={() => startTrials(false)}>
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
            <br></br>
            Go slowly. Let your body relax.<br></br>
            Trust that the answer is already there—your mind just
            needs space to find it.<br></br>
          </p>
          <button onClick={() => startTrials(true)}>I'm Ready</button>
        </div>
      )}

      {step === 'final-results' && finalStats && (
        <>
          <h2>Focused Block Results</h2>
          <p>
            <strong>Your accuracy:</strong> {finalStats.userPercent}%
          </p>
          <p>
            <strong>Ghost accuracy:</strong> {finalStats.ghostPercent}
            %
          </p>
          <p>{ratingMessage(finalStats.userPercent)}</p>
          <button onClick={() => setStep('post')}>
            Continue to Post-Experiment Questions
          </button>
        </>
      )}

      {step === 'trials' && (
        <>
          <h2>
            Trial {currentTrial + 1} of {totalTrialsPerBlock}
          </h2>
          <p>{currentInstruction}</p>
          {renderButtonChoices()}

          {lastResult && (
            <div className="results-display" aria-live="polite">
              <p>
                You picked <strong>{lastResult.selected}</strong>
              </p>
              <p>
                Ghost picked <strong>{lastResult.ghostChoice}</strong>
              </p>
              <p>
                Correct answer was{' '}
                <strong>{lastResult.correct}</strong>
              </p>
              {showStar && <div className="star-burst">🌟</div>}
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
            <>
              <h3 style={{ textAlign: 'center' }}>Score: {score}</h3>
            </>
          )}
        </>
      )}

      {step === 'post' && (
        <>
          <h2>Post-Experiment Questions</h2>
          {postQuestions.map((q, index) => (
            <div key={q.id} className="question-block">
              <label htmlFor={q.id} className="question-label">
                <strong className="question-number">
                  Q{index + 1}.
                </strong>{' '}
                {q.question}
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
          <h2>Thank you!</h2>
          <p>Your data has been submitted.</p>
        </>
      )}
    </div>
  );
}

export default App;
