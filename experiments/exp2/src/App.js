// src/App.js
import React from 'react';
import QAExport from './QAExport';
import MainApp from './MainApp';
import { config } from './config.js';
// This is just a convenience toggle in the URL hash.
// It's not real security since it's shipped in the bundle.
const QA_SECRET = config.QA_SECRET;

function parseHash(hashString) {
  const hash = hashString || '';
  // Accept "#qa", "#/qa", and with params "#qa?..." or "#/qa?..."
  const isQA =
    hash.startsWith('#qa') ||
    hash.startsWith('#/qa') ||
    hash.startsWith('#qa?') ||
    hash.startsWith('#/qa?');

  // Extract "?key=..." from the hash part (if present)
  const qIndex = hash.indexOf('?');
  const qs = qIndex >= 0 ? hash.slice(qIndex + 1) : '';
  const params = new URLSearchParams(qs);
  const key = params.get('key') || '';

  return { isQA, key };
}

function useHashInfo() {
  // Read the hash safely (no window access during SSR)
  const get = React.useCallback(() => {
    if (typeof window === 'undefined')
      return { isQA: false, key: '' };
    return parseHash(window.location.hash || '');
  }, []);

  // Initialize without touching window on the server
  const [state, setState] = React.useState(() => {
    if (typeof window === 'undefined')
      return { isQA: false, key: '' };
    return parseHash(window.location.hash || '');
  });

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const onHash = () => setState(get());
    window.addEventListener('hashchange', onHash);
    // In case something set the hash before we mounted
    onHash();
    return () => window.removeEventListener('hashchange', onHash);
  }, [get]);

  return state;
}

export default function App() {
  const { isQA, key } = useHashInfo();

  if (isQA && key === QA_SECRET) {
    return <QAExport />;
  }
  if (isQA) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Not authorized</h1>
        <p>
          Add <code>#qa?key=YOUR_SECRET</code> to the URL using the
          exact secret you set in <code>App.js</code>.
        </p>
      </div>
    );
  }

  return <MainApp />;
}
