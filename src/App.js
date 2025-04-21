import React, { useState } from 'react';
import './App.css';
import { db } from './firebase';
import { collection, addDoc } from 'firebase/firestore';
import { preQuestions, cueBlocks, postQuestions } from './questions';
import { generateThreeIcons, pickRandom } from './utils';

function App() {
  const [step, setStep] = useState('pre');
  const [preResponses, setPreResponses] = useState({});
  const [postResponses, setPostResponses] = useState({});
  const [trialResults, setTrialResults] = useState([]);
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0);
  const [currentTrial, setCurrentTrial] = useState(0);
  const [blockOrder] = useState([
    cueBlocks.find((b) => b.id === 'neutral'),
    cueBlocks.find((b) => b.id === 'full_stack'),
  ]);
  const [currentOptions, setCurrentOptions] = useState([]);
  const [correctIcon, setCorrectIcon] = useState(null);
  const [showStar, setShowStar] = useState(false);
  const [score, setScore] = useState(0);

  const handleChange = (id, value, isPost = false) => {
    const updater = isPost ? setPostResponses : setPreResponses;
    updater((prev) => ({ ...prev, [id]: value }));
  };

  const startNeutralTrials = () => {
    const initialOptions = generateThreeIcons();
    const initialCorrect = pickRandom(initialOptions);
    console.log('Neutral block — correct icon:', initialCorrect);
    setCurrentOptions(initialOptions);
    setCorrectIcon(initialCorrect);
    setCurrentTrial(0);
    setStep('trials');
  };

  const startFullStackTrials = () => {
    const nextIndex = currentBlockIndex + 1;
    setCurrentBlockIndex(nextIndex);
    const initialOptions = generateThreeIcons();
    const initialCorrect = pickRandom(initialOptions);
    console.log('Full Stack block — correct icon:', initialCorrect);
    setCurrentOptions(initialOptions);
    setCorrectIcon(initialCorrect);
    setCurrentTrial(0);
    setStep('trials');
  };

  const handleTrial = (selected) => {
    const isCorrect = selected === correctIcon;
    const currentBlock = blockOrder[currentBlockIndex];

    if (currentBlock.showFeedback && isCorrect) {
      setScore((prev) => prev + 1);
      setShowStar(true);
      setTimeout(() => {
        setShowStar(false);
      }, 1000);
    } else {
      setShowStar(false);
    }

    setTrialResults((prev) => [
      ...prev,
      {
        block: currentBlock.id,
        trial: currentTrial + 1,
        options: currentOptions,
        correctIcon,
        selectedIcon: selected,
        isCorrect,
      },
    ]);

    const isLastNeutralTrial =
      currentTrial === 9 && currentBlockIndex === 0;
    if (isLastNeutralTrial) {
      setStep('breathe');
      return;
    }

    const isFullStack = currentBlockIndex === 1;
    const fullStackLimit = 20;
    const isLastFullStackTrial =
      isFullStack && currentTrial === fullStackLimit - 1;

    if (isLastFullStackTrial) {
      setStep('post');
      return;
    }

    const newOptions = generateThreeIcons();
    const newCorrect = pickRandom(newOptions);
    console.log(
      `${currentBlock.label} block — correct icon:`,
      newCorrect
    );
    setCurrentOptions(newOptions);
    setCorrectIcon(newCorrect);
    setCurrentTrial((prev) => prev + 1);
  };

  const renderInput = (q, isPost = false) => {
    const onChange = (e) =>
      handleChange(q.id, e.target.value, isPost);

    if (q.type === 'number')
      return <input type="number" onChange={onChange} />;

    if (q.type === 'slider') {
      return (
        <div className="slider-container">
          <span className="slider-label">{q.leftLabel || 'Low'}</span>
          <input
            type="range"
            min={q.min}
            max={q.max}
            onChange={onChange}
            className="slider"
          />
          <span className="slider-label">
            {q.rightLabel || 'High'}
          </span>
        </div>
      );
    }

    if (q.type === 'textarea')
      return <textarea onChange={onChange} />;

    if (q.type === 'select') {
      return (
        <select onChange={onChange}>
          <option value="">Select</option>
          {q.options.map((opt, idx) => (
            <option key={idx}>{opt}</option>
          ))}
        </select>
      );
    }
  };

  if (step === 'pre') {
    return (
      <div className="App">
        <h2>Pre-Experiment Questions</h2>
        {preQuestions.map((q, index) => (
          <div key={q.id} className="question-block">
            <label className="question-label">
              <strong className="question-number">
                Q{index + 1}.
              </strong>{' '}
              {q.question}
            </label>
            <div className="answer-wrapper">{renderInput(q)}</div>
          </div>
        ))}
        <button onClick={startNeutralTrials}>
          Start Neutral Trials
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
          Now, take a moment to imagine yourself knowing the answer —
          confidently, instinctively.
          <br />
          <br />
          Picture that clarity and let it settle in your body.
          <br />
          <br />
          Take deep, slow breaths, and let your focus sharpen.
        </p>
        <button onClick={startFullStackTrials}>I'm Ready</button>
      </div>
    );
  }

  if (step === 'trials') {
    const block = blockOrder[currentBlockIndex];

    return (
      <div>
        <h2>
          {block.label} — Trial {currentTrial + 1}
        </h2>
        <p>{block.instructions}</p>
        <div className="icon-options-wrapper">
          <div className="icon-options">
            {currentOptions.map((icon, i) => (
              <button
                key={i}
                onClick={() => handleTrial(icon)}
                className="icon-button"
              >
                <span className="icon-symbol">{icon}</span>
              </button>
            ))}
          </div>
        </div>

        {block.showFeedback && (
          <>
            <h3 style={{ textAlign: 'center' }}>Score: {score}</h3>
            {showStar && <div className="star-burst">🌟</div>}
          </>
        )}
      </div>
    );
  }

  if (step === 'post') {
    return (
      <div>
        <h2>Post-Experiment Questions</h2>
        {postQuestions.map((q, index) => (
          <div key={q.id} className="question-block">
            <label className="question-label">
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
            try {
              await addDoc(collection(db, 'responses'), {
                preResponses,
                postResponses,
                trialResults,
                timestamp: new Date().toISOString(),
              });
              alert('Responses saved to database!');
              setStep('done');
            } catch (error) {
              console.error('Error saving to Firestore:', error);
              alert('There was a problem saving your responses.');
            }
          }}
        >
          Submit
        </button>
      </div>
    );
  }

  return (
    <div>
      <h2>Thanks!</h2>
      <p>Your final score: {score}</p>
    </div>
  );
}

export default App;
