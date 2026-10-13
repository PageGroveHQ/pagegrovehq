import React, { useEffect, useRef, useState } from "react";
import {
  Upload,
  FileText,
  ShieldCheck,
  Leaf,
  Check,
  ArrowRight,
  Pencil,
  ChevronUp,
  ChevronDown,
  X,
} from "lucide-react";
import { Dialog, Cover, IconButton, Toggle } from "./components";
import { importFile } from "./importers";
import { makeBook, textBlocks } from "./engine";
import { fingerprint, repairBook } from "./enhancements";
import { addBook, listBooks } from "./storage";
import { relinkLocalFile } from "./spark-sync";
export default function ImportDialog({
  files = [],
  books,
  settings,
  onClose,
  onAdded,
  notify,
}) {
  const [tab, setTab] = useState("file"),
    [title, setTitle] = useState(""),
    [paste, setPaste] = useState(""),
    [candidate, setCandidate] = useState(null),
    [status, setStatus] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(false),
    [queue, setQueue] = useState([]);
  const input = useRef(),
    abort = useRef(),
    pending = useRef([]),
    initial = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    if (!initial.current) {
      initial.current = true;
      if (files.length) enqueue(files);
    }
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
  }, []);
  function close() {
    if (status) {
      abort.current?.abort();
      pending.current = [];
      return;
    }
    onClose();
  }
  async function enqueue(items) {
    if (status || busy) return;
    pending.current = Array.from(items);
    setQueue(pending.current.map((f) => ({ name: f.name, state: "waiting" })));
    await next();
  }
  async function next() {
    const file = pending.current.shift();
    if (!file) {
      setCandidate(null);
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    setError("");
    setCandidate(null);
    setEditing(false);
    setStatus({ message: "Opening your book…", percent: 0 });
    setQueue((prev) =>
      prev.map((q) =>
        q.name === file.name && q.state === "waiting"
          ? { ...q, state: "processing" }
          : q,
      ),
    );
    try {
      const hash = await fingerprint(file);
      const book = await importFile(
        file,
        (message, percent) => {
          if (mounted.current) setStatus({ message, percent });
        },
        controller.signal,
        settings.ocrLanguage,
      );
      if (controller.signal.aborted || !mounted.current) return;
      book.sourceHash = hash;
      const existing = (await listBooks()).find((b) => b.sourceHash === hash);
      const linked = existing?.needsLocalFile
        ? relinkLocalFile(book, existing)
        : book;
      setCandidate({
        book: linked,
        file,
        duplicate: existing?.needsLocalFile ? null : existing,
        relinked: !!existing?.needsLocalFile,
      });
      setQueue((prev) =>
        prev.map((q) =>
          q.name === file.name && q.state === "processing"
            ? { ...q, state: "review" }
            : q,
        ),
      );
    } catch (e) {
      if (e.name !== "AbortError" && mounted.current) {
        setError(e.message);
        setQueue((prev) =>
          prev.map((q) =>
            q.name === file.name && q.state === "processing"
              ? { ...q, state: "failed" }
              : q,
          ),
        );
      }
    } finally {
      if (mounted.current) setStatus(null);
      abort.current = null;
    }
  }
  async function accept() {
    if (!candidate || busy) return;
    setBusy(true);
    try {
      await addBook(candidate.book, candidate.file);
      await onAdded();
      setQueue((prev) =>
        prev.map((q) =>
          q.name === candidate.file?.name ? { ...q, state: "saved" } : q,
        ),
      );
      setCandidate(null);
      notify(
        candidate.relinked
          ? "Book file connected. Your saved position and notes are ready."
          : "Your book is ready. Welcome to the grove.",
      );
      if (pending.current.length) await next();
      else onClose();
    } catch (e) {
      setError(`Could not save this book: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }
  const summary = candidate?.book;
  return (
    <Dialog
      title={summary ? "Your book is almost home" : "Add to your grove"}
      onClose={close}
      wide
    >
      <div className="import-tabs">
        <button
          className={tab === "file" ? "selected" : ""}
          disabled={!!status || !!candidate}
          onClick={() => setTab("file")}
        >
          <Upload size={17} />
          Upload a book
        </button>
        <button
          className={tab === "paste" ? "selected" : ""}
          disabled={!!status || !!candidate}
          onClick={() => setTab("paste")}
        >
          <FileText size={17} />
          Paste text
        </button>
      </div>
      {queue.length > 1 && (
        <div className="import-queue" aria-label="Import queue">
          {queue.map((q, i) => (
            <div key={i}>
              <span>{q.name}</span>
              <small>{q.state}</small>
            </div>
          ))}
        </div>
      )}
      {status ? (
        <div className="import-progress">
          <Leaf className="loading-leaf" size={36} />
          <h3>{status.message}</h3>
          <progress max="100" value={status.percent} />
          <p>Processing privately on your device.</p>
          <button
            className="secondary"
            onClick={() => {
              abort.current?.abort();
              pending.current = [];
            }}
          >
            Cancel import queue
          </button>
        </div>
      ) : summary ? (
        <>
          <div className="import-summary">
            <Cover book={summary} small />
            <div>
              <h3>{summary.title}</h3>
              <p>{summary.author}</p>
              <span className="pill">
                {summary.format} · {summary.wordCount.toLocaleString()} words ·{" "}
                {summary.chapters.length} sections
              </span>
            </div>
          </div>
          {candidate.duplicate && (
            <div className="notice">
              <strong>This file is already on your shelf</strong>
              <p>
                “{candidate.duplicate.title}” has the same file fingerprint. You
                can keep a separate copy, or skip it.
              </p>
            </div>
          )}
          {summary.needsReview && (
            <div className="notice">
              <strong>Check your PDF’s reading order</strong>
              <p>
                Compare the extracted text with the original. Use the repair
                tools to correct OCR, exclude headers, and reorder passages.
              </p>
              {summary.warnings?.length > 0 && (
                <details>
                  <summary>{summary.warnings.length} extraction notes</summary>
                  <ul>
                    {summary.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          {editing ? (
            <RepairEditor
              book={summary}
              onCancel={() => setEditing(false)}
              onSave={(book) => {
                setCandidate({ ...candidate, book });
                setEditing(false);
              }}
            />
          ) : (
            <>
              <ImportPreview book={summary} />
              <button className="text-button" onClick={() => setEditing(true)}>
                <Pencil size={15} />
                Repair extracted text
              </button>
            </>
          )}
          {!editing && (
            <div className="dialog-actions">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  if (pending.current.length) next();
                  else {
                    setCandidate(null);
                    setQueue([]);
                  }
                }}
              >
                {pending.current.length ? "Skip & continue" : "Choose another"}
              </button>
              <button className="primary" disabled={busy} onClick={accept}>
                <Check size={18} />
                {busy
                  ? "Saving…"
                  : candidate.duplicate
                    ? "Add another copy"
                    : "Add to my library"}
              </button>
            </div>
          )}
        </>
      ) : tab === "file" ? (
        <>
          <button className="upload-zone" onClick={() => input.current.click()}>
            <span className="upload-icon">
              <Upload size={30} />
            </span>
            <h3>A whole new world, one file away.</h3>
            <p>Drop one or more books here, or browse your files</p>
            <span className="secondary">Choose files</span>
            <small>
              EPUB · PDF · FB2 · TXT · MD · HTML · up to 100 MB each
            </small>
          </button>
          <input
            ref={input}
            type="file"
            hidden
            multiple
            accept=".epub,.pdf,.fb2,.txt,.md,.html,.htm,.mobi,.azw,.azw3,.kfx"
            onChange={(e) => {
              enqueue(e.target.files);
              e.target.value = "";
            }}
          />
          <div className="import-footnote">
            <ShieldCheck size={19} />
            <p>
              Books stay on your device unless you enable cloud sync. OCR
              resources load from this app’s hosting. Files are processed one at
              a time so large imports don’t overwhelm your device.
            </p>
          </div>
          {pending.current.length > 0 && (
            <button className="secondary" onClick={next}>
              Continue with next file
              <ArrowRight size={16} />
            </button>
          )}
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            try {
              setCandidate({
                book: makeBook({
                  title: title.trim() || "Untitled reading",
                  author: "Personal text",
                  chapters: [{ title: "Reading", blocks: textBlocks(paste) }],
                }),
                file: null,
              });
            } catch (e) {
              setError(e.message);
            }
          }}
        >
          <label className="field">
            Title
            <input
              maxLength="500"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Give your reading a name"
            />
          </label>
          <label className="field">
            Your text
            <textarea
              rows="9"
              required
              maxLength="2000000"
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder="An article, a chapter, a little something to read…"
            />
          </label>
          <button className="primary" type="submit">
            Preview reading
            <ArrowRight size={18} />
          </button>
        </form>
      )}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
export function ImportPreview({ book }) {
  const [index, setIndex] = useState(0),
    chapter = book.chapters[Math.min(index, book.chapters.length - 1)];
  return (
    <section className="import-preview">
      <label className="field">
        Preview section
        <select value={index} onChange={(e) => setIndex(+e.target.value)}>
          {book.chapters.map((c, i) => (
            <option key={c.id || i} value={i}>
              {c.title}
            </option>
          ))}
        </select>
      </label>
      <div className="preview-columns">
        <div className="preview-text">
          {chapter.blocks
            .filter((b) => b.text && !b.excluded)
            .slice(0, 6)
            .map((b, i) => (
              <p key={i}>{b.text.slice(0, 2500)}</p>
            ))}
        </div>
        {book.format === "PDF" &&
          chapter.blocks.find((b) => b.type === "image") && (
            <img
              alt="Original PDF page for comparison"
              src={chapter.blocks.find((b) => b.type === "image").src}
            />
          )}
      </div>
    </section>
  );
}
export function RepairEditor({ book, onSave, onCancel }) {
  const [chapters, setChapters] = useState(() =>
      structuredClone(book.chapters),
    ),
    [ci, setCi] = useState(0),
    [error, setError] = useState("");
  const chapter = chapters[ci];
  function editBlock(index, patch) {
    setChapters((prev) =>
      prev.map((c, i) =>
        i !== ci
          ? c
          : {
              ...c,
              blocks: c.blocks.map((b, j) =>
                j === index ? { ...b, ...patch } : b,
              ),
            },
      ),
    );
  }
  function move(index, delta) {
    setChapters((prev) =>
      prev.map((c, i) => {
        if (i !== ci) return c;
        const blocks = [...c.blocks];
        [blocks[index], blocks[index + delta]] = [
          blocks[index + delta],
          blocks[index],
        ];
        return { ...c, blocks };
      }),
    );
  }
  function repeated() {
    const counts = new Map();
    chapters.forEach((c) =>
      c.blocks.forEach((b) => {
        if (b.text && b.text.length < 180)
          counts.set(b.text, (counts.get(b.text) || 0) + 1);
      }),
    );
    setChapters((prev) =>
      prev.map((c) => ({
        ...c,
        blocks: c.blocks.map((b) => ({
          ...b,
          excluded:
            b.excluded ||
            (b.type === "paragraph" && (counts.get(b.text) || 0) >= 3),
        })),
      })),
    );
  }
  return (
    <section className="repair-editor">
      <div className="notice">
        <strong>A cleaner path through the book</strong>
        <p>
          Edit passages, move them into reading order, and exclude unwanted
          sections. Your original file is retained. Notes use stable passage
          IDs; notes whose passages are excluded are kept and flagged.
        </p>
      </div>
      <label className="field">
        Section to repair
        <select value={ci} onChange={(e) => setCi(+e.target.value)}>
          {chapters.map((c, i) => (
            <option key={c.id} value={i}>
              {c.title}
              {c.excluded ? " · excluded" : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Section title
        <input
          value={chapter.title}
          onChange={(e) =>
            setChapters((prev) =>
              prev.map((c, i) =>
                i === ci ? { ...c, title: e.target.value } : c,
              ),
            )
          }
        />
      </label>
      <Toggle
        label="Exclude this section from playback"
        value={!!chapter.excluded}
        onChange={(excluded) =>
          setChapters((prev) =>
            prev.map((c, i) => (i === ci ? { ...c, excluded } : c)),
          )
        }
      />
      <button className="secondary" onClick={repeated}>
        Exclude repeated short paragraphs
      </button>
      <div className="repair-columns">
        <div className="repair-passages">
          {chapter.blocks.map((block, i) => (
            <article
              className={block.excluded ? "excluded-block" : ""}
              key={block.id}
            >
              <header>
                <span>
                  {block.type} {i + 1}
                </span>
                <div>
                  <IconButton
                    icon={ChevronUp}
                    label={`Move passage ${i + 1} up`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  />
                  <IconButton
                    icon={ChevronDown}
                    label={`Move passage ${i + 1} down`}
                    disabled={i === chapter.blocks.length - 1}
                    onClick={() => move(i, 1)}
                  />
                </div>
              </header>
              {block.type === "image" ? (
                <small>{block.alt}</small>
              ) : block.type === "table" ? (
                <p className="muted">
                  Table layout is retained. Exclude it here if it isn’t useful.
                </p>
              ) : (
                <textarea
                  aria-label={`Passage ${i + 1} text`}
                  value={block.text}
                  rows="4"
                  onChange={(e) => editBlock(i, { text: e.target.value })}
                />
              )}
              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={!!block.excluded}
                  onChange={(e) => editBlock(i, { excluded: e.target.checked })}
                />
                Exclude from reading
              </label>
            </article>
          ))}
        </div>
        {chapter.blocks.find((b) => b.type === "image") && (
          <figure className="repair-original">
            <img
              alt="Original page or illustration for repair"
              src={chapter.blocks.find((b) => b.type === "image").src}
            />
          </figure>
        )}
      </div>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button className="secondary" onClick={onCancel}>
          Cancel repairs
        </button>
        <button
          className="primary"
          onClick={() => {
            try {
              onSave(repairBook(book, chapters));
            } catch (e) {
              setError(e.message);
            }
          }}
        >
          Save repaired text
        </button>
      </div>
    </section>
  );
}
