import { initializeApp, getApp, getApps } from 'firebase/app';

// Auth
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
  signInWithEmailAndPassword,
  signInAnonymously,
  onAuthStateChanged,
} from 'firebase/auth';

// Firestore
import { getFirestore } from 'firebase/firestore';

// 1) PASTE YOUR WORKING CONFIG HERE
const firebaseConfig = {
  apiKey: 'AIzaSyBnZiiYdnaTxa6Zn-QOPhgNJ8lt6PAi2uU',
  authDomain: 'qartexperiment1.firebaseapp.com',
  projectId: 'qartexperiment1',
  storageBucket: 'qartexperiment1.appspot.com',
  messagingSenderId: '922467950974',
  appId: '1:922467950974:web:7fc4054ad2854b8e21532f',
  measurementId: 'G-TB0M38XPBC',
};

// 2) Initialize exactly once (safe even if multiple bundles import this)
const app = getApps().length
  ? getApp()
  : initializeApp(firebaseConfig);

// 3) Core singletons
const authInstance = getAuth(app);
const dbInstance = getFirestore(app);

// 4) Local persistence (survives browser close). Fallback: session, then in-memory.
export const persistenceReady = (async () => {
  try {
    await setPersistence(authInstance, browserLocalPersistence);
    console.log('✅ Using local persistence - anonymous user will persist across sessions');
  } catch (e) {
    console.warn(
      'Local persistence not available; falling back to session persistence.',
      e
    );
    try {
      await setPersistence(authInstance, browserSessionPersistence);
    } catch (e2) {
      console.warn(
        'Session persistence not available; falling back to in-memory.',
        e2
      );
      await setPersistence(authInstance, inMemoryPersistence);
    }
  }
})();

// 5) Auth helpers
export async function signInWithEmailPassword(email, password) {
  await persistenceReady;
  const cred = await signInWithEmailAndPassword(
    authInstance,
    email,
    password
  );
  return cred.user;
}

// Ensure we have a user (anonymous) before Firestore ops where needed.
// Module-level promise ensures concurrent callers (e.g. React 18 StrictMode double-invoke)
// share a single signInAnonymously call rather than creating two anonymous users.
let _pendingSignIn = null;
export async function ensureSignedIn() {
  await persistenceReady;
  if (authInstance.currentUser) return authInstance.currentUser;
  if (_pendingSignIn) return _pendingSignIn;
  _pendingSignIn = (async () => {
    try {
      await signInAnonymously(authInstance);
      return await new Promise((resolve, reject) => {
        const off = onAuthStateChanged(
          authInstance,
          (u) => {
            if (!u) return;
            off();
            resolve(u);
          },
          reject
        );
      });
    } finally {
      _pendingSignIn = null;
    }
  })();
  return _pendingSignIn;
}

// 6) Public exports used by your app
export const auth = authInstance;
export const db = dbInstance;

// 7) Debug helpers (handy in DevTools)
if (typeof window !== 'undefined') {
  window._auth = authInstance;
  window.__FBDEBUG__ = {
    get projectId() {
      return authInstance.app.options.projectId;
    },
    get email() {
      return authInstance.currentUser?.email || null;
    },
    async provider() {
      const u = authInstance.currentUser;
      if (!u) return null;
      const t = await u.getIdTokenResult();
      return t.signInProvider || null; // "password", "anonymous", etc.
    },
  };
}
