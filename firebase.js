// firebase.js
// -----------------------------------------------------------------------------
// Inicializacija Firebase (Auth + Firestore) prek modularnega SDK-ja (v10, CDN).
// Deluje na GitHub Pages brez build koraka.
//
// ⚠️  POMEMBNO: Zamenjaj spodnji `firebaseConfig` s SVOJIM iz Firebase konzole:
//     Firebase Console → Project settings → Your apps → Web app → Config.
//
// V Firebase konzoli še omogoči:
//   • Authentication → Sign-in method → Email/Password (ON)
//   • Authentication → Sign-in method → Anonymous (ON)  (za "gost" dostop)
//   • Firestore Database → Create database
//
// Pravila Firestore (za začetek – vsak prijavljen uporabnik lahko piše):
//   rules_version = '2';
//   service cloud.firestore {
//     match /databases/{database}/documents {
//       match /{document=**} {
//         allow read, write: if request.auth != null;
//       }
//     }
//   }
// -----------------------------------------------------------------------------

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInAnonymously,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  increment,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// 🔧 ZAMENJAJ TO S SVOJO KONFIGURACIJO
const firebaseConfig = {
  apiKey: "TVOJ_API_KEY",
  authDomain: "TVOJ_PROJECT.firebaseapp.com",
  projectId: "TVOJ_PROJECT_ID",
  storageBucket: "TVOJ_PROJECT.appspot.com",
  messagingSenderId: "TVOJ_SENDER_ID",
  appId: "TVOJ_APP_ID",
};

// Seznam admin e-poštnih naslovov (poleg tega lahko v users/{uid}.role = "admin").
export const ADMIN_EMAILS = ["admin@primer.si"];

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Ponovni izvoz najpogosteje uporabljenih funkcij, da jih app.js / admin.js
// uvozita iz enega mesta.
export {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInAnonymously,
  signOut,
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  increment,
};
