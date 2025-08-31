import React, { useState } from 'react';
import { preQuestions, postQuestions } from './lib/questions';
import ConsentGate from './components/consent/ConsentGate';
import SurveyForm from './components/surveys/SurveyForm';
import BasisChoiceBlock from './components/qcc/BasisChoiceBlock';
import RACBlock from './components/qcc/RACBlock';
import ResultsDashboard from './components/results/ResultsDashboard';
import { ensureSignedIn, db } from './lib/firebase';

export default function MainShell() {
  const [step, setStep] = useState('consent');
  const [rows, setRows] = useState([]);
  const [pre, setPre] = useState({});
  const [post, setPost] = useState({});

  const TRIALS = 40; // or 3 for pilot

  function onTrial(r) {
    setRows((x) => [...x, r]);
  }
  function next() {
    setStep((s) => {
      if (s === 'consent') return 'pre';
      if (s === 'pre') return 'basis';
      if (s === 'basis') return 'rac_class';
      if (s === 'rac_class') return 'rac_quant';
      if (s === 'rac_quant') return 'post';
      if (s === 'post') return 'results';
      return 'results';
    });
  }

  if (step === 'consent')
    return <ConsentGate onAgree={() => setStep('pre')} />;
  if (step === 'pre')
    return (
      <SurveyForm
        title="Pre-questions"
        questions={preQuestions}
        onSubmit={(r) => {
          setPre(r);
          next();
        }}
      />
    );
  if (step === 'basis')
    return (
      <BasisChoiceBlock
        trials={TRIALS}
        onTrial={onTrial}
        onDone={next}
      />
    );
  if (step === 'rac_class')
    return (
      <RACBlock
        mode="RAC_CLASSICAL"
        trials={TRIALS}
        onTrial={onTrial}
        onDone={next}
      />
    );
  if (step === 'rac_quant')
    return (
      <RACBlock
        mode="RAC_QUANTUM_SIM"
        trials={TRIALS}
        onTrial={onTrial}
        onDone={next}
      />
    );
  if (step === 'post')
    return (
      <SurveyForm
        title="Post-questions"
        questions={postQuestions}
        onSubmit={(r) => {
          setPost(r);
          next();
        }}
      />
    );
  return <ResultsDashboard session={{ trials: rows }} />;
}
