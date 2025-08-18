// src/firebase.js

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// ---- Your Firebase project config ----
const firebaseConfig = {
  apiKey: 'AIzaSyBnZiiYdnaTxa6Zn-QOPhgNJ8lt6PAi2uU',
  authDomain: 'qartexperiment1.firebaseapp.com',
  projectId: 'qartexperiment1',
  storageBucket: 'qartexperiment1.appspot.com',
  messagingSenderId: '922467950974',
  appId: '1:922467950974:web:7fc4054ad2854b8e21532f',
  measurementId: 'G-TB0M38XPBC',
};

// ---- Initialize core singletons (internal names to avoid collisions) ----
const app = initializeApp(firebaseConfig);
const authInstance = getAuth(app);
const dbInstance = getFirestore(app);

// ✅ Public named exports (use these everywhere else)
export const auth = authInstance;
export const db = dbInstance;

// ---- Persistence: try local, fall back to session ----
const persistenceReady = (async () => {
  try {
    await setPersistence(authInstance, browserLocalPersistence);
  } catch {
    try {
      await setPersistence(authInstance, browserSessionPersistence);
    } catch {
      // ignore — still usable without persistence
    }
  }
})();

// ---- Optional: email+password sign-in (for admin/QA) ----
export async function signInWithEmailPassword(email, password) {
  const cred = await signInWithEmailAndPassword(
    authInstance,
    email,
    password
  );
  return cred.user;
}

// ---- Ensure we have an (anon) user before Firestore ops ----
export async function ensureSignedIn() {
  await persistenceReady;

  if (authInstance.currentUser) return authInstance.currentUser;

  await signInAnonymously(authInstance);

  return new Promise((resolve, reject) => {
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
}

// (handy for quick debugging in the console)
if (typeof window !== 'undefined') {
  window._auth = authInstance;
}
