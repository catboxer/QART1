// exp3/src/QAExport.jsx
import React from 'react';
import { db, ensureSignedIn } from './firebase';
import {
  collection,
  getDocs,
  query,
  orderBy,
} from 'firebase/firestore';
import { panels } from './exp-panels';

function useAuthReady() {
  const [ready, setReady] = React.useState(false);
  const [user, setUser] = React.useState(null);
  React.useEffect(() => {
    (async () => {
      try {
        const u = await ensureSignedIn();
        setUser(u || null);
      } finally {
        setReady(true);
      }
    })();
  }, []);
  return { ready, user };
}

async function fetchAllRunsWithMinutes() {
  const runsSnap = await getDocs(
    query(collection(db, 'runs'), orderBy('createdAt', 'desc'))
  );
  const runs = runsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const out = [];
  for (const r of runs) {
    const minsSnap = await getDocs(
      collection(db, 'runs', r.id, 'minutes')
    );
    const minutes = minsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.idx ?? 0) - (b.idx ?? 0));
    out.push({ ...r, minutes });
  }
  return out;
}

function distinct(list, key) {
  const s = new Set();
  list.forEach((x) => s.add(key(x)));
  return [...s];
}

function DownloadButton({ data, filename = 'export.json' }) {
  return (
    <button
      onClick={() => {
        const blob = new Blob([JSON.stringify(data, null, 2)], {
          type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 800);
      }}
    >
      Download JSON
    </button>
  );
}

function GenericPanel({ runs }) {
  const totalRuns = runs.length;
  const totalMinutes = runs.reduce(
    (a, r) => a + (r.minutes?.length || 0),
    0
  );
  return (
    <div style={{ marginTop: 16 }}>
      <h3>Generic Summary</h3>
      <p>
        Runs: {totalRuns} • Minutes: {totalMinutes}
      </p>
      <p style={{ opacity: 0.7 }}>
        Add a custom panel for this experimentId to see richer tiles.
      </p>
    </div>
  );
}

export default function QAExport() {
  const { ready, user } = useAuthReady();
  const [loading, setLoading] = React.useState(true);
  const [runs, setRuns] = React.useState([]);
  const [expFilter, setExpFilter] = React.useState('all');

  React.useEffect(() => {
    (async () => {
      try {
        setRuns(await fetchAllRunsWithMinutes());
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (!ready)
    return <div style={{ padding: 24 }}>Checking sign-in…</div>;
  if (!user)
    return (
      <div style={{ padding: 24 }}>
        Please sign in to view exports.
      </div>
    );
  if (loading)
    return <div style={{ padding: 24 }}>Loading runs…</div>;

  const expIds = distinct(runs, (r) => r.experimentId || '(none)');
  const filtered =
    expFilter === 'all'
      ? runs
      : runs.filter(
          (r) => (r.experimentId || '(none)') === expFilter
        );

  const activeExpId =
    expFilter === 'all' && expIds.length === 1
      ? expIds[0]
      : expFilter !== 'all'
      ? expFilter
      : null;

  const Panel =
    activeExpId && panels[activeExpId]
      ? panels[activeExpId]
      : GenericPanel;

  return (
    <div style={{ padding: 24 }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <h2 style={{ margin: 0 }}>QA / Dashboard</h2>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <DownloadButton
            data={filtered}
            filename={`export_${activeExpId || 'all'}.json`}
          />
        </div>
      </header>

      <section
        style={{
          marginTop: 12,
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <label>
          Experiment:
          <select
            value={expFilter}
            onChange={(e) => setExpFilter(e.target.value)}
            style={{ marginLeft: 8 }}
          >
            <option value="all">All</option>
            {expIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <div style={{ opacity: 0.6 }}>Runs loaded: {runs.length}</div>
      </section>

      <section>
        <Panel runs={filtered} />
      </section>

      <details style={{ marginTop: 16 }}>
        <summary>Peek raw (first 1 run)</summary>
        <pre
          style={{
            maxWidth: '100%',
            overflow: 'auto',
            background: '#f7f7f7',
            padding: 12,
            borderRadius: 8,
          }}
        >
          {JSON.stringify(filtered.slice(0, 1), null, 2)}
        </pre>
      </details>
    </div>
  );
}
