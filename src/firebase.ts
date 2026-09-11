import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
  apiKey: "AIzaSyCOk_yef2gRBCdm8FwEgeidK7TrK1Yvcd0",
  authDomain: "inter-level-progress-manager.firebaseapp.com",
  projectId: "inter-level-progress-manager",
  storageBucket: "inter-level-progress-manager.firebasestorage.app",
  messagingSenderId: "379503088311",
  appId: "1:379503088311:web:261867e724dfe8e6133332",
  measurementId: "G-ZFKEZ2R3BQ",
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });
export const functions = getFunctions(firebaseApp, "us-central1");
