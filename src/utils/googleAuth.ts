import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User as FirebaseUser,
  signOut
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize or reuse Firebase App
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);

// Comprehensive Google Workspace and Identity OAuth Scopes
export const WORKSPACE_SCOPES = [
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.labels',
  'https://www.googleapis.com/auth/gmail.metadata',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://www.googleapis.com/auth/gmail.settings.sharing',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
];

export const GMAIL_SCOPES = WORKSPACE_SCOPES;

const provider = new GoogleAuthProvider();
WORKSPACE_SCOPES.forEach((scope) => {
  provider.addScope(scope);
});
provider.setCustomParameters({
  prompt: 'consent',
  access_type: 'offline',
});

// Cache the access token strictly in memory (Do NOT store in localStorage or sessionStorage)
let cachedAccessToken: string | null = null;
let isSigningIn = false;
let authSubscribers: Array<(user: FirebaseUser | null, token: string | null) => void> = [];

export const subscribeToGoogleAuth = (callback: (user: FirebaseUser | null, token: string | null) => void) => {
  authSubscribers.push(callback);
  // Initial fire
  callback(auth.currentUser, cachedAccessToken);
  return () => {
    authSubscribers = authSubscribers.filter((cb) => cb !== callback);
  };
};

const notifySubscribers = (user: FirebaseUser | null, token: string | null) => {
  authSubscribers.forEach((cb) => cb(user, token));
};

// Initialize Google Auth listener
export const initGoogleAuth = (
  onAuthSuccess?: (user: FirebaseUser, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: FirebaseUser | null) => {
    if (user && cachedAccessToken) {
      notifySubscribers(user, cachedAccessToken);
      if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
    } else if (!user) {
      cachedAccessToken = null;
      notifySubscribers(null, null);
      if (onAuthFailure) onAuthFailure();
    }
  });
};

// Sign in with Google Popup
export const googleSignIn = async (): Promise<{ user: FirebaseUser; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Could not retrieve access token from Google authentication credential.');
    }

    cachedAccessToken = credential.accessToken;
    notifySubscribers(result.user, cachedAccessToken);
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error('[Google Auth] Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

// Retrieve in-memory access token
export const getGoogleAccessToken = (): string | null => {
  return cachedAccessToken;
};

// Set in-memory access token
export const setGoogleAccessToken = (token: string | null) => {
  cachedAccessToken = token;
  notifySubscribers(auth.currentUser, cachedAccessToken);
};

// Sign out of Google
export const googleSignOut = async () => {
  try {
    await signOut(auth);
  } finally {
    cachedAccessToken = null;
    notifySubscribers(null, null);
  }
};
