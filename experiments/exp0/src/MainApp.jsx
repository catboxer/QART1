import React, { useState, useMemo } from 'react';
import BasisChoiceBlock from './components/BasisChoiceBlock';
import RACBlock from './components/RACBlock';
import './App.css';
// import FoldedSelfCheck from './FoldedSelfCheck';

// ✅ Use the shared Firebase singletons + helper
// import { db, auth, ensureSignedIn } from './firebase';

// import {
//   collection,
//   addDoc,
//   doc,
//   getDoc,
//   setDoc,
//   updateDoc,
//   serverTimestamp,
//   increment,
// } from 'firebase/firestore';

// import {
//   preQuestions,
//   cueBlocks,
//   midQuestions,
//   postQuestions,
//   buildIssueMailto,
// } from './questions';
// import confetti from 'canvas-confetti';
// import { config } from './config.js';

export default function MainApp() {
  const [idx, setIdx] = useState(0),
    [rows, setRows] = useState([]);
  const TRIALS = 3;
  const blocks = useMemo(
    () => [
      {
        id: 'basis_choice',
        render: () => (
          <BasisChoiceBlock trials={2} onTrial={push} onDone={next} />
        ),
      },
      {
        id: 'RAC_CLASSICAL',
        render: () => (
          <RACBlock
            mode="RAC_CLASSICAL"
            trials={TRIALS}
            onTrial={push}
            onDone={next}
          />
        ),
      },
      {
        id: 'RAC_QUANTUM_SIM',
        render: () => (
          <RACBlock
            mode="RAC_QUANTUM_SIM"
            trials={TRIALS}
            onTrial={push}
            onDone={next}
          />
        ),
      },
    ],
    []
  );

  function push(r) {
    setRows((p) => [...p, r]);
  }
  function next() {
    setIdx((i) => i + 1);
  }

  function downloadCSV() {
    const cols = Object.keys(
      rows[0] || { block_type: 1, trial_id: 1 }
    );
    const lines = [cols.join(',')].concat(
      rows.map((r) => cols.map((k) => r[k]).join(','))
    );
    const blob = new Blob([lines.join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'exp0_trials.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="App" role="main" id="main">
      <h1>Quantum Choice Challenge</h1>
      <p>
        Two blocks: Influence (50% ceiling) and Random Access Code
        (75% vs ~85%).
      </p>

      {idx < blocks.length ? (
        <>
          {blocks[idx].render()}
          <p style={{ marginTop: 16 }}>
            <em>
              Block {idx + 1} of {blocks.length}
            </em>
          </p>
        </>
      ) : (
        <>
          <h2>All Blocks Complete</h2>
          <p>You ran {rows.length} trials.</p>
          <button onClick={downloadCSV} disabled={!rows.length}>
            Download CSV
          </button>
        </>
      )}
    </div>
  );
}
