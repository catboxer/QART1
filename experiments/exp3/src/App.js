// exp3/src/App.js
import React from 'react';
import QAExport from './QAExport.jsx';
import MainApp from './MainApp.jsx';
import { config } from './config.js';

const QA_SECRET = config.QA_SECRET;

function parseHash(hashString) {
  const hash = hashString || '';
  const isQA =
    hash.startsWith('#qa') ||
    hash.startsWith('#/qa') ||
    hash.startsWith('#qa?') ||
    hash.startsWith('#/qa?');
  const qIndex = hash.indexOf('?');
  const qs = qIndex >= 0 ? hash.slice(qIndex + 1) : '';
  const params = new URLSearchParams(qs);
  const key = params.get('key') || '';
  return { isQA, key };
}
function useHashInfo() {
  const get = React.useCallback(() => {
    if (typeof window === 'undefined')
      return { isQA: false, key: '' };
    return parseHash(window.location.hash || '');
  }, []);
  const [state, setState] = React.useState(() => {
    if (typeof window === 'undefined')
      return { isQA: false, key: '' };
    return parseHash(window.location.hash || '');
  });
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const onHash = () => setState(get());
    window.addEventListener('hashchange', onHash);
    onHash();
    return () => window.removeEventListener('hashchange', onHash);
  }, [get]);
  return state;
}

export default function App() {
  const { isQA, key } = useHashInfo();

  if (isQA && key === QA_SECRET) return <QAExport />;
  if (isQA) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Not authorized</h1>
        <p>
          Add <code>#qa?key=YOUR_SECRET</code> to the URL using the
          exact secret you set in <code>config.js</code>.
        </p>
      </div>
    );
  }
  return <MainApp />; // ← the experiment UI lives here
}
