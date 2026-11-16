import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, User } from 'firebase/auth';
import { auth } from './firebase.ts';

export const GOOGLE_DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
];

const driveProvider = new GoogleAuthProvider();
for (const scope of GOOGLE_DRIVE_SCOPES) {
  driveProvider.addScope(scope);
}
driveProvider.setCustomParameters({
  prompt: 'consent select_account',
});

let isSigningIn = false;
let cachedAccessToken: string | null = null;
let cachedDriveUser: { email: string; displayName: string; photoURL: string } | null = null;

export const initGoogleDriveAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        onAuthSuccess?.(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        onAuthFailure?.();
      }
    } else {
      cachedAccessToken = null;
      cachedDriveUser = null;
      onAuthFailure?.();
    }
  });
};

export const signInWithGoogleDrive = async (): Promise<{
  user: User;
  accessToken: string;
  email: string;
  displayName: string;
  photoURL: string;
}> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, driveProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Não foi possível obter o token de acesso ao Google Drive.');
    }
    cachedAccessToken = credential.accessToken;
    cachedDriveUser = {
      email: result.user.email || '',
      displayName: result.user.displayName || result.user.email || 'Conta Google',
      photoURL: result.user.photoURL || '',
    };
    return {
      user: result.user,
      accessToken: cachedAccessToken,
      ...cachedDriveUser,
    };
  } finally {
    isSigningIn = false;
  }
};

export const getGoogleDriveAccessToken = (): string | null => {
  return cachedAccessToken;
};

export const getCachedGoogleDriveUser = () => {
  return cachedDriveUser;
};

export const clearGoogleDriveAccessToken = () => {
  cachedAccessToken = null;
  cachedDriveUser = null;
};
