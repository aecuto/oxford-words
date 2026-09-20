import { FirebaseError } from "firebase/app";
import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
};

export function getFirebase() {
  const app = getApps()[0] ?? initializeApp(firebaseConfig);
  return { app, auth: getAuth(app), fs: getFirestore(app) };
}

export async function ensureAnonAuth(): Promise<string> {
  const { auth } = getFirebase();
  if (auth.currentUser) return auth.currentUser.uid;
  const cred = await signInAnonymously(auth);
  return cred.user.uid;
}

function withCode(message: string, e: FirebaseError): string {
  return `${message} (code: ${e.code})`;
}

export function describeAuthError(e: unknown): string {
  if (e instanceof FirebaseError) {
    switch (e.code) {
      case "auth/configuration-not-found":
      case "auth/operation-not-allowed":
      case "auth/admin-restricted-operation":
        return withCode(
          "Anonymous sign-in is not enabled. Fix: Firebase console → Authentication → Get started (if asked) → Sign-in method → Anonymous → Enable.",
          e
        );
      case "auth/unauthorized-domain":
        return withCode(
          "This domain is not authorized. Fix: Firebase console → Authentication → Settings → Authorized domains → Add domain.",
          e
        );
      case "auth/network-request-failed":
        return withCode("Network error — check your internet connection.", e);
      case "auth/api-key-not-valid":
        return withCode(
          "Firebase API key is invalid — check .env.local and your Vercel env vars.",
          e
        );
      case "permission-denied":
        return withCode(
          "Firestore rules are blocking this action. Fix: paste firestore.rules from the repo into Firebase console → Firestore Database → Rules → Publish.",
          e
        );
      case "not-found":
      case "failed-precondition":
        return withCode(
          "Firestore database does not exist yet. Fix: Firebase console → Firestore Database → Create database (production mode).",
          e
        );
      case "unavailable":
        return withCode(
          "Firestore unreachable — usually the database hasn't been created yet (console → Firestore Database → Create database), or you are offline / behind a blocker.",
          e
        );
    }
    return withCode("Battle server error.", e);
  }
  return `Battle error: ${e instanceof Error ? e.message : String(e)}`;
}
