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
export default function AccountPanel({ onClose, notify, onChanged }) {
  const [state, setState] = useState(cloud.cloudState()),
    [email, setEmail] = useState(""),
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
          profiles, and your reading position between devices. Book files stay
          on the device. Local reading remains available without an account.
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
        <form
          onSubmit={(e) => {
            e.preventDefault();
            action(async () => {
              await cloud.signIn(email);
              notify(
                cloud.cloudState().session
                  ? "You are signed in."
                  : "Check your email for your Page Grove sign-in link.",
              );
            });
          }}
        >
          <label className="field">
            Email address
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <button className="primary" type="submit" disabled={busy}>
            <Mail size={17} />
            {busy
              ? "Connecting…"
              : cloud.needsSignInEmail()
                ? "Complete sign-in with this email"
                : "Email me a sign-in link"}
          </button>
        </form>
      ) : (
        <>
          <p className="muted">Signed in as {state.session.user.email}</p>
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
                private Firebase account. Original files, full book text, and
                illustrations stay on this device. Import the same book file on
                another device to use its synced position and notes. Nothing is
                shared publicly.
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
        Synced notes are private to your account. Book files stay on this device; export backups for an additional copy.
      </p>
    </Dialog>
  );
}
