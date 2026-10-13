import React, { useEffect, useState } from "react";
import {
  Cloud,
  CloudOff,
  RefreshCw,
  ShieldCheck,
  Mail,
  LogOut,
  Check,
  FileText,
} from "lucide-react";
import { Dialog } from "./components";
import * as cloud from "./cloud";
import * as storage from "./storage";
import DrivePanel from "./DrivePanel";
export default function AccountPanel({ onClose, notify, onChanged }) {
  const [state, setState] = useState(cloud.cloudState()),
    [busy, setBusy] = useState(false),
    [sync, setSync] = useState(false),
    [jobs, setJobs] = useState([]);
  useEffect(() => cloud.subscribeCloud(setState), []);
  useEffect(() => {
    storage
      .getMeta("cloud-sync")
      .then((v) =>
        setSync(!!v?.enabled && v.userId === state.session?.user.id),
      );
    cloud
      .listProcessingJobs()
      .then(setJobs)
      .catch(() => {});
  }, [state.session, state.status]);
  async function action(fn) {
    setBusy(true);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Your grove, wherever you read" onClose={onClose}>
      <div className="account-intro">
        <Cloud size={35} />
        <h2>A private place for your library.</h2>
        <p>
          Firebase Spark sync carries library records, saved excerpts, notes,
          profiles, and your reading position between devices. Connect Google
          Drive for your book files, or keep books on this device. Local reading
          remains available without an account.
        </p>
      </div>
      {!state.configured ? (
        <div className="notice">
          <strong>Cloud accounts are not enabled on this deployment</strong>
          <p>
            The app owner needs to connect its dedicated backend before
            accounts, sync, or AI can be used. Your library and all local tools
            work now. Use a backup to move your reading to another device.
          </p>
        </div>
      ) : !state.session ? (
        <div className="google-signin">
          <button
            className="google-button"
            disabled={busy}
            onClick={() => action(cloud.signInGoogle)}
          >
            <GoogleMark />
            {busy ? "Connecting…" : "Continue with Google"}
          </button>
          <p className="muted">
            Use the same Google email as your existing Page Grove account to
            keep your synced library. No email verification links.
          </p>
        </div>
      ) : (
        <>
          <p className="muted">Signed in as {state.session.user.email}</p>
          {!state.session.user.google && (
            <div className="notice">
              <p>
                Connect the same Google account ({state.session.user.email}) to
                keep your existing library and switch away from email links.
              </p>
              <button
                className="google-button"
                disabled={busy}
                onClick={() => action(cloud.signInGoogle)}
              >
                <GoogleMark />
                Connect Google sign-in
              </button>
            </div>
          )}
          <div className="notice">
            <strong>
              {state.status === "synced"
                ? "Everything is up to date"
                : state.status === "syncing"
                  ? "Syncing your grove…"
                  : state.status === "offline"
                    ? "Offline changes are queued"
                    : state.status === "conflict"
                      ? "A few changes need your choice"
                      : sync
                        ? "Ready to sync"
                        : "Sync is off"}
            </strong>
            {state.lastSynced > 0 && (
              <p>
                Last synced {new Date(state.lastSynced).toLocaleTimeString()}
              </p>
            )}
            <p>{state.pending} pending changes</p>
          </div>
          {!sync ? (
            <>
              <p className="muted">
                Enabling sync uploads book titles, reading positions, bookmarks,
                highlighted excerpts, notes, profiles, and sessions to your
                private Firebase account. Book files remain on this device or in
                your connected Google Drive. Drive file references and your
                selected folder also sync; book text is not uploaded to
                Firebase. Nothing is shared publicly.
              </p>
              <button
                className="primary"
                disabled={busy}
                onClick={() => action(() => cloud.enableSync(false))}
              >
                <Cloud size={17} />
                Sync progress & notes
              </button>
            </>
          ) : (
            <div className="backup-actions">
              <button
                className="primary"
                disabled={busy}
                onClick={() => action(cloud.syncLibrary)}
              >
                <RefreshCw size={16} />
                Sync now
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => action(cloud.disableSync)}
              >
                <CloudOff size={16} />
                Turn sync off
              </button>
            </div>
          )}
          {state.conflicts.map((c) => (
            <div className="sync-conflict" key={c.item.key}>
              <h3>{c.local?.title || "Reading preferences"}</h3>
              <p>
                Both this device and the cloud changed:{" "}
                {c.fields.map((f) => f.split(":")[0]).join(", ")}.
              </p>
              <p className="muted">
                Choose the version you intend to keep. Compatible notes and
                sessions are merged; a further reading position is not
                automatically preferred.
              </p>
              <div className="backup-actions">
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    action(() => cloud.resolveConflict(c, "local"))
                  }
                >
                  Keep this device’s choice
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    action(() => cloud.resolveConflict(c, "remote"))
                  }
                >
                  Use the cloud copy
                </button>
              </div>
            </div>
          ))}
          <DrivePanel state={state} action={action} busy={busy} />
          {jobs.length > 0 && (
            <>
              <div className="settings-heading">
                Background document processing
              </div>
              {jobs.map((j) => (
                <div className="processing-job" key={j.id}>
                  <FileText size={17} />
                  <span>
                    {j.status} · {j.progress}%
                    {j.error && <small>{j.error}</small>}
                  </span>
                </div>
              ))}
            </>
          )}
          <button
            className="text-button"
            disabled={busy}
            onClick={() => action(cloud.signOut)}
          >
            <LogOut size={16} />
            Sign out
          </button>
          <p className="muted">
            Signing out stops sync and keeps your downloaded library on this
            device. Use your browser’s site-data controls on a shared computer.
          </p>
        </>
      )}
      {state.error && (
        <p className="error-message" role="alert">
          {state.error}
        </p>
      )}
      <p className="muted account-privacy">
        <ShieldCheck size={15} />
        Synced notes are private to your account. Books stay on this device or
        in your private Google Drive.
      </p>
      <a
        className="text-button"
        href={new URL("privacy.html", document.baseURI).href}
        target="_blank"
        rel="noopener noreferrer"
      >
        Privacy & Google Drive access
      </a>
    </Dialog>
  );
}
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"
      />
      <path
        fill="#4285F4"
        d="M47.54 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h13.24c-.59 3.04-2.31 5.62-4.89 7.36l7.73 6C44.59 38.2 47.54 32 47.54 24.55Z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.12.78-4.59l-7.98-6.19A24 24 0 0 0 0 24c0 3.87.94 7.53 2.56 10.78l7.97-6.19Z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.91-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.2C6.51 42.62 14.62 48 24 48Z"
      />
    </svg>
  );
}
