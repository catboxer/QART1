import React, { useMemo, useState } from 'react';
import BasisChoiceBlock from './components/BasisChoiceBlock';
import RACBlock from './components/RACBlock';

// ⬇ reuse your app's firebase helpers
import { db, auth, ensureSignedIn } from './firebase';
import {
  collection,
  addDoc,
  doc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';

export default function QuantumChoices() {
  const [idx, setIdx] = useState(0);
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState(null);

  const blocks = useMemo(
    () => [
      {
        id: 'basis_choice',
        title: 'Basis Choice (Influence Test)',
        render: () => (
          <BasisChoiceBlock
            trials={40} // tweak N here
            onTrial={pushRow}
            onDone={() => setIdx((i) => i + 1)}
          />
        ),
      },
      {
        id: 'RAC_CLASSICAL',
        title: 'RAC — Classical',
        render: () => (
          <RACBlock
            mode="RAC_CLASSICAL"
            trials={40}
            onTrial={pushRow}
            onDone={() => setIdx((i) => i + 1)}
          />
        ),
      },
      {
        id: 'RAC_QUANTUM_SIM',
        title: 'RAC — Quantum Sim',
        render: () => (
          <RACBlock
            mode="RAC_QUANTUM_SIM"
            trials={40}
            onTrial={pushRow}
            onDone={() => setIdx((i) => i + 1)}
          />
        ),
      },
    ],
    []
  );

  function pushRow(r) {
    setRows((prev) => [...prev, r]);
  }

  async function saveAll() {
    setSaving(true);
    try {
      await ensureSignedIn();
      const participant_id = auth.currentUser?.uid ?? null;
      const session_id = crypto?.randomUUID?.() || String(Date.now());
      const payload = {
        participant_id,
        session_id,
        created_at: serverTimestamp(),
        summary: {
          counts: {
            total: rows.length,
            basis_choice: rows.filter(
              (r) => r.block_type === 'basis_choice'
            ).length,
            rac_classical: rows.filter(
              (r) => r.block_type === 'RAC_CLASSICAL'
            ).length,
            rac_quantum: rows.filter(
              (r) => r.block_type === 'RAC_QUANTUM_SIM'
            ).length,
          },
        },
      };
      const mainRef = await addDoc(
        collection(db, 'experiment_qcc_responses'),
        payload
      );
      const detailsRef = doc(
        db,
        'experiment_qcc_responses',
        mainRef.id,
        'details',
        'trialDetails'
      );
      await setDoc(detailsRef, { trials: rows }, { merge: true });
      setSavedId(mainRef.id);
    } finally {
      setSaving(false);
    }
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
    a.download = 'qcc_trials.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  if (idx < blocks.length) {
    return (
      <div className="App" role="main" id="main">
        <h1>Quantum Choice Challenge</h1>
        <p>
          A two-part experiment: influence (50% ceiling) and quantum
          advantage (75% vs ~85%).
        </p>
        {blocks[idx].render()}
        <p style={{ marginTop: 16 }}>
          <em>
            Block {idx + 1} of {blocks.length}
          </em>
        </p>
      </div>
    );
  }

  return (
    <div className="App" role="main" id="main">
      <h1>All Blocks Complete</h1>
      <p>
        You ran {rows.length} trials across {blocks.length} blocks.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={downloadCSV} disabled={!rows.length}>
          Download CSV
        </button>
        <button onClick={saveAll} disabled={!rows.length || saving}>
          {saving ? 'Saving…' : 'Save to Firestore'}
        </button>
      </div>
      {savedId && (
        <p>
          Saved: <code>{savedId}</code>
        </p>
      )}
    </div>
  );
}
