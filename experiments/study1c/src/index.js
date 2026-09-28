import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

// CRITICAL SECURITY: Block Service Workers on experiment routes
// Prevents AI agents from intercepting/rewriting network responses
if ('serviceWorker' in navigator) {
  const origRegister = navigator.serviceWorker.register;
  navigator.serviceWorker.register = function() {
    if (window.location.pathname.includes('/exp')) {
      console.error('🚫 Service Worker registration blocked on experiment routes');
      return Promise.reject(new Error('Service Workers disabled on experiments for security'));
    }
    return origRegister.apply(this, arguments);
  };
}

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

// CRITICAL SECURITY: Freeze network APIs to prevent interception/manipulation
// Prevents AI agents from intercepting QRNG requests or blocking Firestore writes
if (typeof fetch !== 'undefined') {
  window.__originalFetch = fetch.bind(window);
  Object.freeze(window.__originalFetch);
  // Also freeze fetch on window to prevent reassignment
  Object.defineProperty(window, 'fetch', {
    value: window.__originalFetch,
    writable: false,
    configurable: false
  });
}

if (typeof EventSource !== 'undefined') {
  window.__originalEventSource = EventSource;
  Object.freeze(window.__originalEventSource);
  // Freeze EventSource constructor to prevent replacement
  Object.defineProperty(window, 'EventSource', {
    value: window.__originalEventSource,
    writable: false,
    configurable: false
  });
}

// Freeze XMLHttpRequest (used by Firestore SDK)
if (typeof XMLHttpRequest !== 'undefined') {
  window.__originalXMLHttpRequest = XMLHttpRequest;
  Object.freeze(window.__originalXMLHttpRequest);
  Object.defineProperty(window, 'XMLHttpRequest', {
    value: window.__originalXMLHttpRequest,
    writable: false,
    configurable: false
  });
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
