import React, { useState } from 'react';
import './App.css';
import { db } from './firebase';
import { collection, addDoc } from 'firebase/firestore';
import { preQuestions, cueBlocks, postQuestions } from './questions';
import confetti from 'canvas-confetti';
import { generateIconPair, pickRandom } from './utils';
import { useEffect } from 'react';
function App() {
  useEffect(() => {
    console.log(
      '🔥 App mounted  — added name fields:',
      new Date().toISOString()
    );
  }, []);
  const [step, setStep] = useState('pre');
  const [preResponses, setPreResponses] = useState({});
  const [postResponses, setPostResponses] = useState({});
  const [trialResults, setTrialResults] = useState([]);
  const [ghostResults, setGhostResults] = useState([]);
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0);
  const [currentTrial, setCurrentTrial] = useState(0);
  const [primeNeutral, setPrimeNeutral] = useState(false);
  const [blockOrder] = useState([
    cueBlocks.find((b) => b.id === 'neutral'),
    cueBlocks.find((b) => b.id === 'full_stack'),
  ]);
  const [currentOptions, setCurrentOptions] = useState([]);
  const [correctIcon, setCorrectIcon] = useState(null);
  const [showStar, setShowStar] = useState(false);
  const [score, setScore] = useState(0);
  const [neutralStats, setNeutralStats] = useState(null);
  const [finalStats, setFinalStats] = useState(null);

  const handleChange = (id, value, isPost = false) => {
    const updater = isPost ? setPostResponses : setPreResponses;
    updater((prev) => ({ ...prev, [id]: value }));
  };

  const startNeutralTrials = () => {
    // 50% of the time we’ll prime
    setPrimeNeutral(Math.random() < 0.5);
    const initialOptions = generateIconPair();
    const initialCorrect = pickRandom(initialOptions);
    // console.log('Neutral block — correct icon:', initialCorrect);
    setCurrentOptions(initialOptions);
    setCorrectIcon(initialCorrect);
    setGhostResults([]);
    setTrialResults([]);
    setCurrentTrial(0);
    setScore(0);
    setStep('trials');
  };

  const startFullStackTrials = () => {
    const nextIndex = currentBlockIndex + 1;
    const initialOptions = generateIconPair();
    const initialCorrect = pickRandom(initialOptions);
    console.log('Full Stack block — correct icon:', initialCorrect);
    setCurrentBlockIndex(nextIndex);
    setCurrentOptions(initialOptions);
    setCorrectIcon(initialCorrect);
    setCurrentTrial(0);
    setScore(0);
    setStep('trials');
  };

  const handleTrial = (selected) => {
    const isCorrect = selected.id === correctIcon.id;
    const currentBlock = blockOrder[currentBlockIndex];
    const totalTrials = currentBlock.trials;

    if (currentBlock.showFeedback && isCorrect) {
      setScore((prev) => prev + 1);
      setShowStar(true);
      setTimeout(() => setShowStar(false), 1000);
    } else {
      setShowStar(false);
    }

    const updatedTrialResults = [
      ...trialResults,
      {
        block: currentBlock.id,
        trial: currentTrial + 1,
        options: currentOptions.map((opt) => opt.id),
        correctIcon: correctIcon.id,
        selectedIcon: selected.id,
        isCorrect,
      },
    ];
    setTrialResults(updatedTrialResults);

    const ghostChoice = pickRandom(currentOptions);
    const ghostIsCorrect = ghostChoice.id === correctIcon.id;
    const updatedGhostResults = [
      ...ghostResults,
      {
        block: currentBlock.id,
        trial: currentTrial + 1,
        ghostChoice: ghostChoice.id,
        correctIcon: correctIcon.id,
        isCorrect: ghostIsCorrect,
      },
    ];
    setGhostResults(updatedGhostResults);

    if (currentTrial + 1 === totalTrials) {
      const blockId = currentBlock.id;

      const blockTrialResults = updatedTrialResults.filter(
        (t) => t.block === blockId
      );
      const blockGhostResults = updatedGhostResults.filter(
        (g) => g.block === blockId
      );

      const userCorrect = blockTrialResults.filter(
        (t) => t.isCorrect
      ).length;
      const ghostCorrect = blockGhostResults.filter(
        (g) => g.isCorrect
      ).length;

      let userPercent = ((userCorrect / totalTrials) * 100).toFixed(
        1
      );
      if (blockId === 'neutral' && primeNeutral) {
        userPercent = (Math.random() * (100 - 69) + 69).toFixed(1);
      }

      const ghostPercent = (
        (ghostCorrect / totalTrials) *
        100
      ).toFixed(1);

      console.log(`✅ ${blockId} User Accuracy:`, userPercent);
      console.log(`👻 ${blockId} Ghost Accuracy:`, ghostPercent);

      if (parseFloat(userPercent) > 65) {
        confetti({
          particleCount: 150,
          spread: 100,
          origin: { y: 0.6 },
        });
      }

      if (currentBlockIndex === 0) {
        setNeutralStats({
          userPercent,
          ghostPercent,
          primed: primeNeutral,
        });
        setStep('neutral-results');
      } else {
        setFinalStats({ userPercent, ghostPercent });
        setStep('final-results');
      }

      return;
    }
    // otherwise, prepare next trial
    const newOptions = generateIconPair();
    const newCorrect = pickRandom(newOptions);
    if (blockOrder[currentBlockIndex].id === 'full_stack') {
      console.log('Full Stack block — correct icon:', newCorrect);
    }

    setCurrentOptions(newOptions);
    setCorrectIcon(newCorrect);
    setCurrentTrial((prev) => prev + 1);
  };
  const ratingMessage = (percent) => {
    const p = parseFloat(percent);
    if (p <= 50) return 'Expected by chance.';
    if (p <= 59) return 'Slightly above chance.';
    if (p <= 69) return 'Notably above chance.';
    if (p <= 79) return 'Strong result.';
    return 'Very strong alignment — impressive!';
  };
  const renderInput = (q, isPost = false) => {
    const onChange = (e) =>
      handleChange(q.id, e.target.value, isPost);

    if (['text', 'email', 'number'].includes(q.type)) {
      return (
        <input
          id={q.id}
          type={q.type}
          onChange={onChange}
          value={(isPost ? postResponses : preResponses)[q.id] || ''}
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
          value={(isPost ? postResponses : preResponses)[q.id] || ''}
        />
      );
    }

    if (q.type === 'select') {
      return (
        <select id={q.id} onChange={onChange}>
          <option value="">Select</option>
          {q.options.map((opt, idx) => (
            <option key={idx} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    }

    // in case of an unknown type
    return null;
  };

  if (step === 'pre') {
    return (
      <div className="App">
        <main role="main">
          <h1>Experiment #1</h1>
        </main>
        {/* ——— Instructions block ——— */}
        <div
          className="instructions"
          style={{
            maxWidth: '600px',
            margin: '0 auto',
            paddingBottom: '1rem',
          }}
        >
          <h2>How it works</h2>
          <p>
            On each trial you’ll see two icons—a circle and a square.
            Before they appear, a random number generator (RNG) has
            already picked one of them.
          </p>

          <h2>Your task</h2>
          <ol>
            <li>
              <strong>Trust your first impression.</strong> Click the
              shape you believe the RNG selected.
            </li>
            <li>
              <strong>No “right” strategy.</strong> Go with your gut.
            </li>
            <li>
              <strong>See your score.</strong> After each block you’ll
              see your accuracy. Chance is around 50%. I am exploring
              whether intuition or focus can help you beat
              chance—suggesting your mind can subtly “tune in” to a
              preset outcome.
            </li>
          </ol>

          <p>
            Good luck, and remember: there’s no wrong answer—just
            follow whatever feels right!
          </p>
        </div>
        {/* ———————————————— */}
        <h2>Pre-Experiment Questions</h2>
        {preQuestions.map((q, index) => (
          <div key={q.id} className="question-block">
            <label
              id={`label-${q.id}`}
              htmlFor={q.id}
              className="question-label"
            >
              <strong className="question-number">
                Q{index + 1}.
              </strong>{' '}
              {q.question}
            </label>
            <div className="answer-wrapper">{renderInput(q)}</div>
          </div>
        ))}
        <button
          onClick={startNeutralTrials}
          aria-label="Begin neutral block trials"
        >
          Start Neutral Trials
        </button>
      </div>
    );
  }

  if (step === 'neutral-results' && neutralStats) {
    const { userPercent, ghostPercent } = neutralStats;
    return (
      <div className="App">
        <h2>Neutral Block Results</h2>
        <p>
          <strong>Your accuracy:</strong> {userPercent}%
        </p>
        <p>
          Random guessing would score around 50%.
          <br />
          {ratingMessage(userPercent)}
        </p>
        <p>
          <strong>Ghost accuracy:</strong> {ghostPercent}%
        </p>

        <button
          onClick={() => setStep('breathe')}
          aria-label="Continue to focused trials"
        >
          Continue to Focused Trials
        </button>
      </div>
    );
  }

  if (step === 'breathe') {
    return (
      <div className="App">
        <h2>Get Into the Zone</h2>
        <div className="breathing-circle"></div>
        <p>
          Take ten deep, slow breaths and let your focus settle.
          <br></br>
          Go slowly. Let your body relax.<br></br>
          Trust that the answer is already there—your mind just needs
          space to find it.<br></br>
        </p>
        <button
          onClick={startFullStackTrials}
          aria-label="I am ready."
        >
          I'm Ready
        </button>
      </div>
    );
  }

  if (step === 'final-results') {
    const { userPercent, ghostPercent } = finalStats;
    return (
      <div className="App">
        <h2>Focused Block Results</h2>
        <p>
          <strong>Your accuracy:</strong> {userPercent}%
        </p>
        <p>
          Random guessing would score around 50%.
          <br />
          {ratingMessage(userPercent)}
        </p>
        <p>
          <strong>Ghost accuracy:</strong> {ghostPercent}%
        </p>
        <button
          onClick={() => setStep('post')}
          aria-label="Continue to Post Questions."
        >
          Continue to Post Questions
        </button>
      </div>
    );
  }

  if (step === 'trials') {
    const block = blockOrder[currentBlockIndex];
    const totalTrials = block.trials;
    return (
      <div className="App">
        <h2>
          {block.label} Block — Trial {currentTrial + 1} of{' '}
          {totalTrials}
        </h2>
        <p>{block.instructions}</p>
        <div className="icon-options-wrapper">
          <div className="icon-options">
            {currentOptions.map((icon, i) => (
              <button
                key={i}
                onClick={() => handleTrial(icon)}
                className="icon-button"
                aria-label={`Select ${icon.id}`}
              >
                <span className="icon-symbol">{icon.element}</span>
              </button>
            ))}
          </div>
        </div>
        <button
          className="exit-button"
          aria-label="Exit the study early and submit your selections."
          onClick={async () => {
            const neutralTrials = trialResults.filter(
              (t) => t.block === 'neutral'
            );
            const neutralGhosts = ghostResults.filter(
              (g) => g.block === 'neutral'
            );
            const fullTrials = trialResults.filter(
              (t) => t.block === 'full_stack'
            );
            const fullGhosts = ghostResults.filter(
              (g) => g.block === 'full_stack'
            );

            const safeAccuracy = (results) => {
              const correct = results.filter(
                (r) => r.isCorrect
              ).length;
              return results.length > 0
                ? ((correct / results.length) * 100).toFixed(1)
                : null;
            };
            // await addDoc(collection(db, 'responses'), {
            // 1️⃣ Get and log the exact path you’re writing to
            const responsesRef = collection(db, 'responses');
            console.log('⛓️ Writing to:', responsesRef.path);
            // 2️⃣ Then actually write
            const docSnap = await addDoc(responsesRef, {
              preResponses,
              postResponses,
              neutral: {
                trialResults: neutralTrials,
                ghostResults: neutralGhosts,
                accuracy:
                  neutralStats?.userPercent ||
                  safeAccuracy(neutralTrials),
                ghostAccuracy:
                  neutralStats?.ghostPercent ||
                  safeAccuracy(neutralGhosts),
                primed: primeNeutral,
              },
              full_stack: {
                trialResults: fullTrials,
                ghostResults: fullGhosts,
                accuracy:
                  finalStats?.userPercent || safeAccuracy(fullTrials),
                ghostAccuracy:
                  finalStats?.ghostPercent ||
                  safeAccuracy(fullGhosts),
              },
              timestamp: new Date().toISOString(),
              exitedEarly: true,
            });
            console.log(
              '✅ Firestore write succeeded, doc ID =',
              docSnap.id
            );
            alert('Your progress was saved.');
            setStep('done');
          }}
        >
          🚪 Exit Study
        </button>
        {block.showFeedback && (
          <>
            <h3 style={{ textAlign: 'center' }}>Score: {score}</h3>
            <div role="status" aria-live="polite">
              {showStar && <div className="star-burst">🌟</div>}
            </div>
          </>
        )}
      </div>
    );
  }

  if (step === 'post') {
    return (
      <div className="App">
        <h2>Post-Experiment Questions</h2>
        {postQuestions.map((q, index) => (
          <div key={q.id} className="question-block">
            <label
              id={`label-${q.id}`}
              htmlFor={q.id}
              className="question-label"
            >
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
          aria-label="Submit your post-experiment responses"
          onClick={async () => {
            const existingRuns =
              parseInt(localStorage.getItem('experimentRuns'), 10) ||
              0;
            const newRunCount = existingRuns + 1;
            localStorage.setItem('experimentRuns', newRunCount);
            await addDoc(collection(db, 'responses'), {
              preResponses,
              postResponses,
              neutral: {
                trialResults: trialResults.filter(
                  (t) => t.block === 'neutral'
                ),
                ghostResults: ghostResults.filter(
                  (g) => g.block === 'neutral'
                ),
                accuracy: neutralStats?.userPercent,
                ghostAccuracy: neutralStats?.ghostPercent,
                primed: primeNeutral,
              },
              full_stack: {
                trialResults: trialResults.filter(
                  (t) => t.block === 'full_stack'
                ),
                ghostResults: ghostResults.filter(
                  (g) => g.block === 'full_stack'
                ),
                accuracy: finalStats?.userPercent,
                ghostAccuracy: finalStats?.ghostPercent,
              },
              timestamp: new Date().toISOString(),
              experimentRuns: newRunCount,
            });
            alert('Responses saved!');
            setStep('done');
          }}
        >
          Submit
        </button>
      </div>
    );
  }

  return (
    <div className="App">
      <h2>Thank You!</h2>
      <p>Your results have been submitted.</p>
    </div>
  );
}

export default App;
