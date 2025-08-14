// src/firebase.js (JavaScript version)

// Import the functions you need from the SDKs you need
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  signInWithEmailAndPassword,
} from 'firebase/auth';

// Your web app's Firebase configuration
// (These keys are OK to be in the client for Firebase web apps)
const firebaseConfig = {
  apiKey: 'AIzaSyBnZiiYdnaTxa6Zn-QOPhgNJ8lt6PAi2uU',
  authDomain: 'qartexperiment1.firebaseapp.com',
  projectId: 'qartexperiment1',
  storageBucket: 'qartexperiment1.appspot.com',
  messagingSenderId: '922467950974',
  appId: '1:922467950974:web:7fc4054ad2854b8e21532f',
  measurementId: 'G-TB0M38XPBC',
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
export const auth = getAuth(app);
export { db };

// Set persistence (no top-level await; use promise form)
// Try local; if that fails (e.g., privacy mode), fall back to session.
// Make persistence a promise we can await before any sign-in.
// Try local; if that fails (e.g., privacy mode), fall back to session.
const persistenceReady = setPersistence(
  auth,
  browserLocalPersistence
).catch(async () => {
  try {
    await setPersistence(auth, browserSessionPersistence);
  } catch {
    // ignore — we'll still proceed, but auth may not persist across reloads
  }
});

/**
 * Waits until there is a Firebase user. If none, signs in anonymously.
 * Call this BEFORE any Firestore reads/writes that require auth.
 * Usage: const user = await ensureSignedIn();
 */
// ----- Email + Password sign-in (stable identity for QA/admin) -----
export async function signInWithEmailPassword(email, password) {
  const cred = await signInWithEmailAndPassword(
    auth,
    email,
    password
  );
  return cred.user; // contains uid, email, displayName, etc.
}

export async function ensureSignedIn() {
  // Ensure persistence is set BEFORE we decide to sign in
  await persistenceReady;

  // If a user already exists (from a prior visit), use it
  if (auth.currentUser) return auth.currentUser;

  // Otherwise create ONE anonymous user
  await signInAnonymously(auth);

  // Wait for the user object to be ready
  return new Promise((resolve, reject) => {
    const off = onAuthStateChanged(
      auth,
      (u) => {
        if (!u) return;
        off();
        resolve(u);
      },
      reject
    );
  });
}

if (typeof window !== 'undefined') {
  window._auth = auth; // Now you can run: window._auth.currentUser?.uid
}
