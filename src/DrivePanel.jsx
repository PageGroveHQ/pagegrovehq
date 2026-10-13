import React, { useEffect, useState } from "react";
import {
  FolderOpen,
  RefreshCw,
  CloudOff,
  ArrowLeft,
  ChevronRight,
  HardDrive,
  X,
} from "lucide-react";
import * as cloud from "./cloud";
import * as storage from "./storage";
import { folderId } from "./drive-client";
export default function DrivePanel({ state, action, busy }) {
  const [folder, setFolder] = useState(null),
    [link, setLink] = useState(""),
    [recursive, setRecursive] = useState(false),
    [folders, setFolders] = useState([]),
    [path, setPath] = useState([{ id: "root", name: "My Drive" }]),
    [browsing, setBrowsing] = useState(false);
  useEffect(() => {
    if (!state.session) return;
    storage.getMeta(`drive-folder:${state.session.user.id}`).then((value) => {
      setFolder(value);
      if (value) {
        setLink(value.id);
        setRecursive(!!value.recursive);
      }
    });
  }, [state.session, state.driveStatus]);
  async function browse(nextPath) {
    setFolders(await cloud.listDriveFolders(nextPath.at(-1).id));
    setPath(nextPath);
    setBrowsing(true);
  }
  const checking = state.driveStatus === "syncing";
  return (
    <section className="drive-panel" aria-label="Google Drive books">
      <div className="settings-heading">
        <HardDrive size={18} /> Your books in Google Drive
      </div>
      <p>
        Connect a folder of EPUBs, PDFs, or other supported books. Files stay in
        your Drive and load when you read. Offline copies are optional.
      </p>
      {!state.session.user.google ? (
        <p className="notice">
          Connect Google sign-in above before connecting Drive.
        </p>
      ) : !state.driveConnected ? (
        <>
          <p className="muted">
            Google’s read-only permission allows viewing all Drive files. Page
            Grove checks only your selected folder and optional subfolders. It
            cannot edit or delete Drive files.
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={() => action(cloud.connectDrive)}
          >
            <FolderOpen size={17} />{" "}
            {folder ? "Reconnect Google Drive" : "Connect Google Drive"}
          </button>
          {folder && (
            <p className="muted">
              Saved folder: {folder.name}. Reconnect after reopening the browser
              or when Google access expires.
            </p>
          )}
        </>
      ) : (
        <>
          {folder && (
            <div className="notice">
              <strong>
                <FolderOpen size={17} /> {folder.name}
              </strong>
              <p>
                {folder.enabled
                  ? "Folder checks are on while Page Grove is open."
                  : "Folder checks are paused."}
              </p>
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              action(() => cloud.setDriveFolder(folderId(link), recursive));
            }}
          >
            <label className="field">
              Drive books folder link or ID
              <input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://drive.google.com/drive/folders/…"
                required
                disabled={busy || checking}
              />
            </label>
            <label className="drive-checkbox">
              <input
                type="checkbox"
                checked={recursive}
                onChange={(e) => setRecursive(e.target.checked)}
                disabled={busy || checking}
              />{" "}
              Include subfolders
            </label>
            <div className="backup-actions">
              <button className="primary" disabled={busy || checking}>
                Save folder & sync books
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy || checking}
                onClick={() =>
                  action(() => browse([{ id: "root", name: "My Drive" }]))
                }
              >
                <FolderOpen size={16} /> Browse folders
              </button>
            </div>
          </form>
          {browsing && (
            <div className="drive-browser">
              <div className="drive-browser-heading">
                <strong>{path.at(-1).name}</strong>
                <button
                  className="text-button"
                  aria-label="Close folder browser"
                  onClick={() => setBrowsing(false)}
                >
                  <X size={17} />
                </button>
              </div>
              {path.length > 1 && (
                <div className="backup-actions">
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => action(() => browse(path.slice(0, -1)))}
                  >
                    <ArrowLeft size={15} /> Parent folder
                  </button>
                  <button
                    className="primary"
                    onClick={() => {
                      setLink(path.at(-1).id);
                      setBrowsing(false);
                    }}
                  >
                    Use this folder
                  </button>
                </div>
              )}
              {folders.length === 0 && (
                <p className="muted">
                  No subfolders here. You can also paste a shared folder link
                  above.
                </p>
              )}
              {folders.map((f) => (
                <button
                  key={f.id}
                  className="drive-folder"
                  disabled={busy}
                  onClick={() =>
                    action(() => browse([...path, { id: f.id, name: f.name }]))
                  }
                >
                  <FolderOpen size={18} />
                  <span>{f.name}</span>
                  <ChevronRight size={16} />
                </button>
              ))}
            </div>
          )}
          {checking ? (
            <div className="notice" role="status">
              <p>{state.driveProgress?.message}</p>
              <progress value={state.driveProgress?.percent || 0} max="100" />
              <button className="text-button" onClick={cloud.cancelDriveSync}>
                Cancel folder check
              </button>
            </div>
          ) : (
            folder?.enabled && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => action(() => cloud.syncDriveFolder())}
              >
                <RefreshCw size={16} /> Sync Drive folder now
              </button>
            )
          )}
          {state.driveResult && (
            <div className="drive-result" role="status">
              <p>
                {state.driveResult.count} supported files ·{" "}
                {state.driveResult.imported} connected ·{" "}
                {state.driveResult.updated} updates to review
              </p>
              {state.driveResult.errors.length > 0 && (
                <details>
                  <summary>
                    {state.driveResult.errors.length} files could not be read
                  </summary>
                  {state.driveResult.errors.map((message, i) => (
                    <p key={i}>{message}</p>
                  ))}
                </details>
              )}
            </div>
          )}
          <p className="muted">
            The first check downloads books temporarily to read their titles and
            match existing records. Newly connected books use cloud reading by
            default. Existing device copies stay available offline.
          </p>
          <button
            className="text-button"
            disabled={busy || checking}
            onClick={() => action(cloud.disconnectDrive)}
          >
            <CloudOff size={16} /> Disconnect Drive on this device
          </button>
          <p className="muted">
            Disconnecting clears this session’s access and pauses folder checks.
            To revoke Google’s permission, remove Page Grove from your Google
            account’s third-party connections.
          </p>
        </>
      )}
    </section>
  );
}
