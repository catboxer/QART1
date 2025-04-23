// Import the functions you need from the SDKs you need
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
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
export { db };
