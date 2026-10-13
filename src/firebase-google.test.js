import { it, expect, vi, beforeEach } from "vitest";
const sdk = vi.hoisted(() => ({
  auth: { currentUser: null },
  popup: vi.fn(),
  link: vi.fn(),
  reauth: vi.fn(),
  logout: vi.fn(),
  providers: [],
}));
vi.mock("firebase/app", () => ({ initializeApp: () => ({}) }));
vi.mock("firebase/auth", () => ({
  initializeAuth: () => sdk.auth,
  browserLocalPersistence: {},
  browserPopupRedirectResolver: {},
  onAuthStateChanged: vi.fn(),
  sendSignInLinkToEmail: vi.fn(),
  isSignInWithEmailLink: () => false,
  signInWithEmailLink: vi.fn(),
  signOut: sdk.logout,
  signInWithPopup: sdk.popup,
  linkWithPopup: sdk.link,
  reauthenticateWithPopup: sdk.reauth,
  GoogleAuthProvider: class {
    constructor() {
      this.scopes = [];
      sdk.providers.push(this);
    }
    setCustomParameters(value) {
      this.parameters = value;
    }
    addScope(value) {
      this.scopes.push(value);
    }
    static credentialFromResult(result) {
      return result.credential;
    }
  },
}));
vi.mock("firebase/firestore", () => ({
  initializeFirestore: () => ({}),
  memoryLocalCache: () => ({}),
  collection: vi.fn(),
  doc: vi.fn(),
  getDocs: vi.fn(),
  runTransaction: vi.fn(),
}));
vi.mock("firebase/storage", () => ({
  getStorage: () => ({}),
  ref: vi.fn(),
  uploadBytes: vi.fn(),
  getBlob: vi.fn(),
}));
vi.mock("firebase/functions", () => ({
  getFunctions: vi.fn(),
  httpsCallable: vi.fn(),
}));
import { createFirebaseBackend } from "./firebase-client";
beforeEach(() => {
  vi.clearAllMocks();
  sdk.providers = [];
  sdk.auth.currentUser = null;
});
it("signs in with Google without requesting Drive permission", async () => {
  const user = {
    uid: "google-reader",
    email: "me@example.test",
    providerData: [{ providerId: "google.com" }],
  };
  sdk.popup.mockResolvedValue({ user });
  const backend = createFirebaseBackend({});
  expect((await backend.signInGoogle()).user.id).toBe("google-reader");
  expect(sdk.providers[0].scopes).toEqual([]);
});
it("links an existing email session rather than creating another Firebase owner", async () => {
  sdk.auth.currentUser = {
    uid: "existing-reader",
    email: "me@example.test",
    providerData: [{ providerId: "password" }],
  };
  sdk.link.mockResolvedValue({
    user: {
      ...sdk.auth.currentUser,
      providerData: [{ providerId: "google.com" }],
    },
  });
  const backend = createFirebaseBackend({});
  expect((await backend.signInGoogle()).user.id).toBe("existing-reader");
  expect(sdk.link).toHaveBeenCalledWith(
    sdk.auth.currentUser,
    expect.anything(),
    expect.anything(),
  );
  expect(sdk.popup).not.toHaveBeenCalled();
});
it("obtains read-only Drive permission for the signed-in user and forgets tokens on disconnect or sign out", async () => {
  sdk.auth.currentUser = {
    uid: "reader",
    email: "me@example.test",
    providerData: [{ providerId: "google.com" }],
  };
  sdk.reauth.mockResolvedValue({
    user: sdk.auth.currentUser,
    credential: { accessToken: "temporary-secret" },
  });
  const backend = createFirebaseBackend({});
  await backend.connectDrive();
  expect(sdk.providers[0].scopes).toEqual([
    "https://www.googleapis.com/auth/drive.readonly",
  ]);
  expect(backend.driveAccessToken()).toBe("temporary-secret");
  backend.disconnectDrive();
  expect(() => backend.driveAccessToken()).toThrow("Reconnect");
  await backend.connectDrive();
  await backend.signOut();
  expect(() => backend.driveAccessToken()).toThrow("Reconnect");
});
