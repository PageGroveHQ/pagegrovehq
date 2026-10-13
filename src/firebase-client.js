import { initializeApp } from "firebase/app";
import {
  initializeAuth,
  browserLocalPersistence,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  linkWithPopup,
  reauthenticateWithPopup,
  browserPopupRedirectResolver,
} from "firebase/auth";
import {
  initializeFirestore,
  memoryLocalCache,
  collection,
  doc,
  getDocs,
  runTransaction,
} from "firebase/firestore";
import { getStorage, ref, uploadBytes, getBlob } from "firebase/storage";
import { getFunctions, httpsCallable } from "firebase/functions";
import { waitForGoogle } from "./google-auth";

// Firestore deliberately uses memory caching: only the small library index is
// persisted by Page Grove, and private book downloads never enter the service worker.
export function createFirebaseBackend(config) {
  const app = initializeApp(config, "pagegrovehq");
  let driveToken = null;
  const auth = initializeAuth(app, { persistence: browserLocalPersistence }),
    db = initializeFirestore(app, { localCache: memoryLocalCache() }),
    bucket = getStorage(app);
  const session = (user) =>
    user
      ? {
          user: {
            id: user.uid,
            email: user.email,
            google: user.providerData.some(
              (p) => p.providerId === "google.com",
            ),
          },
        }
      : null;
  const googleProvider = (drive = false) => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({
      prompt: "select_account",
      ...(auth.currentUser?.email
        ? { login_hint: auth.currentUser.email }
        : {}),
    });
    if (drive)
      provider.addScope("https://www.googleapis.com/auth/drive.readonly");
    return provider;
  };
  const owner = () => {
    if (!auth.currentUser) throw new Error("Sign in first.");
    return auth.currentUser.uid;
  };
  return {
    async invoke(name, data) {
      return (await httpsCallable(getFunctions(app, "us-east1"), name)(data))
        .data;
    },
    async jobs() {
      const snapshot = await getDocs(collection(db, "users", owner(), "jobs"));
      return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
    async start(callback) {
      await auth.authStateReady();
      onAuthStateChanged(auth, (user) => callback(session(user)));
      if (isSignInWithEmailLink(auth, location.href)) {
        const email = localStorage.getItem("pagegrove-signin-email");
        if (email) await this.finishSignIn(email);
      }
      return session(auth.currentUser);
    },
    needsEmail: () => isSignInWithEmailLink(auth, location.href),
    async finishSignIn(email) {
      await signInWithEmailLink(auth, email, location.href);
      localStorage.removeItem("pagegrove-signin-email");
      history.replaceState(null, "", new URL("./", document.baseURI));
    },
    async signIn(email) {
      if (this.needsEmail()) return this.finishSignIn(email);
      await sendSignInLinkToEmail(auth, email, {
        url: new URL("./", document.baseURI).href,
        handleCodeInApp: true,
      });
      localStorage.setItem("pagegrove-signin-email", email);
    },
    async signInGoogle() {
      const provider = googleProvider();
      // Linking from the existing session preserves its UID and owner-only records.
      const result =
        auth.currentUser && !session(auth.currentUser).user.google
          ? await waitForGoogle(
              linkWithPopup(
                auth.currentUser,
                provider,
                browserPopupRedirectResolver,
              ),
            )
          : await waitForGoogle(
              signInWithPopup(auth, provider, browserPopupRedirectResolver),
            );
      return session(result.user);
    },
    async connectDrive() {
      if (!auth.currentUser) throw new Error("Sign in with Google first.");
      if (!session(auth.currentUser).user.google)
        throw new Error("Connect Google sign-in before connecting Drive.");
      const result = await waitForGoogle(
        reauthenticateWithPopup(
          auth.currentUser,
          googleProvider(true),
          browserPopupRedirectResolver,
        ),
        120000,
      );
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (!credential?.accessToken)
        throw new Error(
          "Google did not grant Drive access. Try connecting again.",
        );
      driveToken = {
        value: credential.accessToken,
        expires: Date.now() + 50 * 60 * 1000,
        uid: result.user.uid,
      };
    },
    driveAccess() {
      return (
        !!driveToken &&
        driveToken.uid === auth.currentUser?.uid &&
        driveToken.expires > Date.now()
      );
    },
    driveAccessToken() {
      if (!this.driveAccess()) {
        driveToken = null;
        throw new Error(
          "Reconnect Google Drive in Account & sync to read or sync books.",
        );
      }
      return driveToken.value;
    },
    disconnectDrive() {
      driveToken = null;
    },
    signOut: () => {
      driveToken = null;
      return signOut(auth);
    },
    async upload(path, blob, contentType) {
      if (!path.startsWith(owner() + "/"))
        throw new Error("Invalid private upload path.");
      await uploadBytes(ref(bucket, path), blob, { contentType });
    },
    async download(path) {
      if (!path.startsWith(owner() + "/"))
        throw new Error("Invalid private download path.");
      return getBlob(ref(bucket, path), 180 * 1024 * 1024);
    },
    async documents() {
      const snapshot = await getDocs(
        collection(db, "users", owner(), "documents"),
      );
      return snapshot.docs.map((d) => d.data());
    },
    async write(item, payload, revision) {
      const record = doc(
        db,
        "users",
        owner(),
        "documents",
        `${item.kind}_${item.id}`,
      );
      return runTransaction(db, async (transaction) => {
        const existing = await transaction.get(record),
          previous = existing.exists() ? existing.data() : null;
        if ((previous?.revision || 0) !== revision)
          return { accepted: false, document: previous };
        const document = {
          kind: item.kind,
          record_id: item.id,
          payload: JSON.parse(JSON.stringify(payload || {})),
          deleted: !!item.deleted,
          revision: revision + 1,
          updated_at: Date.now(),
        };
        transaction.set(record, document);
        return { accepted: true, document };
      });
    },
  };
}
