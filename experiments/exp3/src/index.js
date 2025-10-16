import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

// CRITICAL SECURITY: Freeze crypto APIs before any other code runs
// Prevents AI agents from monkey-patching crypto.getRandomValues or crypto.subtle.digest
if (typeof crypto !== 'undefined') {
  Object.freeze(crypto);
  if (crypto.subtle) {
    Object.freeze(crypto.subtle);
  }
  // Store original functions to detect tampering
  window.__originalCryptoGetRandomValues = crypto.getRandomValues.bind(crypto);
  window.__originalCryptoDigest = crypto.subtle?.digest?.bind(crypto.subtle);
  Object.freeze(window.__originalCryptoGetRandomValues);
  Object.freeze(window.__originalCryptoDigest);
}

// Freeze fetch to prevent interception
if (typeof fetch !== 'undefined') {
  window.__originalFetch = fetch.bind(window);
  Object.freeze(window.__originalFetch);
}

const root = ReactDOM.createRoot(document.getElementById('root'));
function handleFirstTab(e) {
  if (e.key === 'Tab') {
    document.body.classList.add('user-is-tabbing');
    window.removeEventListener('keydown', handleFirstTab);
    window.addEventListener('mousedown', handleMouseDownOnce);
  }
}

function handleMouseDownOnce() {
  document.body.classList.remove('user-is-tabbing');
  window.removeEventListener('mousedown', handleMouseDownOnce);
  window.addEventListener('keydown', handleFirstTab);
}

window.addEventListener('keydown', handleFirstTab);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

reportWebVitals();
