import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Leaf,
  ArrowRight,
  BookOpen,
  Bookmark,
  Highlighter,
  Download,
  Pencil,
  Trash2,
  Plus,
  Sprout,
  Clock,
  Check,
  FolderOpen,
  ChevronUp,
  ChevronDown,
  Search,
  Wifi,
  WifiOff,
  Cloud,
  Smartphone,
} from "lucide-react";
import {
  Cover,
  Dialog,
  DownloadLink,
  IconButton,
  ReaderSettings,
} from "./components";
import { tokenize, cleanSettings } from "./engine";
import {
  notebookEntries,
  notebookMarkdown,
  readingInsights,
  growStage,
} from "./enhancements";
import * as storage from "./storage";
export function ProfilesPanel({ settings, onChange, book, onBookSettings }) {
  const [profiles, setProfiles] = useState([]),
    [name, setName] = useState(""),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    storage.getProfiles().then(setProfiles);
  }, []);
  async function saveProfile() {
    if (!name.trim()) return;
    setSaving(true);
    const next = [
      ...profiles,
      {
        id: crypto.randomUUID(),
        name: name.trim(),
        settings: cleanSettings(settings),
      },
    ];
    try {
      await storage.setMeta("profiles", next);
      setProfiles(next);
      setName("");
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="profile-panel">
      <div className="settings-heading">Saved reading profiles</div>
      <label className="field">
        Choose a reading profile
        <select
          value={
            profiles.some((p) => p.id === settings.profileId)
              ? settings.profileId
              : ""
          }
          onChange={(e) => {
            const p = profiles.find((p) => p.id === e.target.value);
            if (p) onChange({ ...p.settings, profileId: p.id });
          }}
        >
          <option value="" disabled>
            Custom settings
          </option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <div className="inline-form">
        <input
          aria-label="New profile name"
          placeholder="Name your current settings"
          value={name}
          maxLength="80"
          onChange={(e) => setName(e.target.value)}
        />
        <button
          className="secondary"
          disabled={saving || !name.trim()}
          onClick={saveProfile}
        >
          <Plus size={15} />
          Save profile
        </button>
      </div>
      {profiles.some(
        (p) =>
          p.id === settings.profileId &&
          !["balanced", "evening", "study", "articles"].includes(p.id),
      ) && (
        <button
          className="text-button danger"
          onClick={async () => {
            const next = profiles.filter((p) => p.id !== settings.profileId);
            await storage.setMeta("profiles", next);
            setProfiles(next);
            onChange({ profileId: "balanced" });
          }}
        >
          Remove selected custom profile
        </button>
      )}
      {book && (
        <label className="checkbox-line">
          <input
            type="checkbox"
            checked={!!book.readingSettings}
            onChange={(e) =>
              onBookSettings(e.target.checked ? cleanSettings(settings) : null)
            }
          />
          Remember separate settings for this book
        </label>
      )}
    </section>
  );
}
export function Notebook({ books, onOpen, onChanged, notify }) {
  const [query, setQuery] = useState(""),
    [kind, setKind] = useState("all"),
    [editing, setEditing] = useState(null),
    [note, setNote] = useState("");
  const entries = notebookEntries(books).filter(
    ({ book, mark, quote }) =>
      (kind === "all" || mark.kind === kind) &&
      `${book.title} ${quote} ${mark.note}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const blob = useMemo(
    () => new Blob([notebookMarkdown(books)], { type: "text/markdown" }),
    [books],
  );
  async function remove(book, mark) {
    const key = mark.kind === "highlight" ? "highlights" : "bookmarks";
    try {
      await storage.patchBook(book.id, {
        [key]: (book[key] || []).filter((m) => m.id !== mark.id),
        annotationTombstones: [
          ...(book.annotationTombstones || []),
          { id: mark.id, deletedAt: Date.now() },
        ],
      });
      await onChanged();
    } catch (e) {
      notify(e.message);
    }
  }
  return (
    <section className="notebook-view">
      <div className="feature-tools">
        <div className="library-search">
          <Search size={17} />
          <input
            aria-label="Search notebook"
            placeholder="Search passages or notes"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          aria-label="Notebook entry type"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="all">All saved passages</option>
          <option value="highlight">Highlights</option>
          <option value="bookmark">Bookmarks</option>
        </select>
        <DownloadLink
          blob={blob}
          filename="page-grove-notebook.md"
          className="secondary"
        >
          <Download size={16} />
          Export notebook
        </DownloadLink>
      </div>
      {entries.map(({ book, mark, quote }) => (
        <article
          className={`saved-card annotation-${mark.color || "sage"}`}
          key={mark.id}
        >
          {mark.kind === "highlight" ? (
            <Highlighter size={22} />
          ) : (
            <Bookmark size={22} />
          )}
          <div>
            <span className="eyebrow">
              {mark.kind} · {new Date(mark.createdAt).toLocaleDateString()}
            </span>
            <h3>{book.title}</h3>
            <p>“{quote}”</p>
            {mark.note && <blockquote>{mark.note}</blockquote>}
            {mark.orphaned && (
              <small className="muted">
                The original passage was excluded during repair. Your quotation
                is preserved.
              </small>
            )}
            <button
              className="text-button"
              onClick={() => onOpen(book, mark.position)}
            >
              Return to passage
              <ArrowRight size={15} />
            </button>
          </div>
          <div className="annotation-actions">
            <IconButton
              icon={Pencil}
              label="Edit saved note"
              onClick={() => {
                setEditing({ book, mark });
                setNote(mark.note || "");
              }}
            />
            <IconButton
              icon={Trash2}
              label="Delete saved passage"
              onClick={() => remove(book, mark)}
            />
          </div>
        </article>
      ))}
      {!entries.length && (
        <div className="empty-state">
          <Highlighter size={36} />
          <h2>A place for what stays with you</h2>
          <p>
            Save bookmarks and highlights in the reader. Their quotations and
            notes will live here, ready to search or export.
          </p>
        </div>
      )}
      {editing && (
        <Dialog title="A note to come back to" onClose={() => setEditing(null)}>
          <blockquote className="bookmark-excerpt">
            {editing.mark.quote || ""}
          </blockquote>
          <label className="field">
            Your note
            <textarea
              aria-label="Your note"
              rows="5"
              maxLength="2000"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button
            className="primary"
            onClick={async () => {
              try {
                const key =
                  editing.mark.kind === "highlight"
                    ? "highlights"
                    : "bookmarks";
                await storage.patchBook(editing.book.id, {
                  [key]: editing.book[key].map((m) =>
                    m.id === editing.mark.id
                      ? { ...m, note, updatedAt: Date.now() }
                      : m,
                  ),
                });
                await onChanged();
                setEditing(null);
              } catch (e) {
                notify(e.message);
              }
            }}
          >
            Save note
          </button>
        </Dialog>
      )}
    </section>
  );
}
export function ReadingDesk({
  books,
  settings,
  onOpen,
  onLibrary,
  onPractice,
  onSettings,
}) {
  const insight = readingInsights(books),
    stage = growStage(insight.totalSeconds),
    current = books
      .filter((b) => b.lastRead && !b.completed)
      .sort((a, b) => b.lastRead - a.lastRead)[0],
    queue = books.filter((b) => b.readingStatus === "want");
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const fn = () => setOnline(navigator.onLine);
    window.addEventListener("online", fn);
    window.addEventListener("offline", fn);
    return () => {
      window.removeEventListener("online", fn);
      window.removeEventListener("offline", fn);
    };
  }, []);
  return (
    <section className="reading-desk">
      <div className="desk-banner">
        <div>
          <span className="eyebrow">A MOMENT THAT BELONGS TO YOU</span>
          <h2>
            Welcome back to
            <br />
            your reading desk.
          </h2>
          <p>
            {current
              ? "Your story is right where you left it."
              : "Make a little space for a new story."}
          </p>
          <button
            className="primary"
            onClick={() => (current ? onOpen(current) : onLibrary())}
          >
            {current ? "Continue reading" : "Find your next book"}
            <ArrowRight size={16} />
          </button>
        </div>
        <img
          src="./grove-banner.webp"
          alt="An open book growing into a quiet grove"
        />
      </div>
      <div className="desk-grid">
        <section className="desk-card">
          <span className="eyebrow">ON YOUR DESK</span>
          {current ? (
            <div className="desk-current">
              <Cover book={current} small />
              <div>
                <h3>{current.title}</h3>
                <p>{current.author}</p>
                <span className="pill">
                  {Math.round(
                    ((current.position + 1) / current.wordCount) * 100,
                  )}
                  % read
                </span>
              </div>
            </div>
          ) : (
            <>
              <h3>A fresh page awaits</h3>
              <p>
                Open a book from your library, or begin with a short practice
                passage.
              </p>
            </>
          )}
          <button
            className="text-button"
            onClick={() => (current ? onOpen(current) : onPractice())}
          >
            {current ? "Open your book" : "Find your pace"}
            <ArrowRight size={15} />
          </button>
        </section>
        <section className="desk-card">
          <span className="eyebrow">YOUR READING RHYTHM</span>
          <h3>{settings.wpm} WPM</h3>
          <p>
            {settings.presentation === "word"
              ? "One word at a time"
              : settings.presentation === "guided"
                ? "Guided passage reading"
                : `${settings.presentation} presentation`}{" "}
            ·{" "}
            {settings.theme === "dark"
              ? "Nightfall"
              : settings.theme === "sepia"
                ? "Parchment"
                : "Daylight"}
          </p>
          <button className="text-button" onClick={onSettings}>
            Adjust your comfort
            <ArrowRight size={15} />
          </button>
        </section>
        <section className="desk-card">
          <span className="eyebrow">READY WHEN YOU ARE</span>
          <h3 className="device-status">
            {online ? <Wifi size={20} /> : <WifiOff size={20} />}{" "}
            {online ? "Connected" : "Reading offline"}
          </h3>
          <p>
            Your downloaded library is available on this device. New imports
            that need uncached resources may require a connection.
          </p>
          <InstallButton />
        </section>
      </div>
      {settings.growth && (
        <section className="growth-card">
          <GrowthTree stage={stage} />
          <div>
            <span className="eyebrow">YOUR GROWING GROVE</span>
            <h2>
              {
                [
                  "A seed of a good habit.",
                  "A little green beginning.",
                  "Taking root, one reading at a time.",
                  "Room for a few more leaves.",
                  "A quiet canopy of stories.",
                  "Your grove is flourishing.",
                ][stage]
              }
            </h2>
            <p>
              {Math.floor(insight.totalSeconds / 60)} minutes spent reading.
              Growth follows your time with books; missed days never take it
              away.
            </p>
          </div>
        </section>
      )}
      <div className="section-title">
        <h2>Your next stories</h2>
        <button className="text-button" onClick={onLibrary}>
          Visit your library
          <ArrowRight size={15} />
        </button>
      </div>
      <div className="desk-next-books">
        {(queue.length
          ? queue
          : books.filter((b) => !b.completed && !b.lastRead)
        )
          .slice(0, 4)
          .map((b) => (
            <button key={b.id} onClick={() => onOpen(b)}>
              <Cover book={b} small />
              <span>
                {b.title}
                <small>{queue.length ? "Want to read" : b.author}</small>
              </span>
            </button>
          ))}
        {!books.length && <p className="muted">Add a book to begin.</p>}
      </div>
    </section>
  );
}
export function GrowthTree({ stage }) {
  return (
    <svg
      className="growth-tree"
      viewBox="0 0 180 150"
      role="img"
      aria-label={`Grove growth stage ${stage + 1} of 6`}
    >
      <ellipse cx="90" cy="131" rx="64" ry="9" fill="#b8c4a1" opacity=".5" />
      <path
        d={`M90 130V${stage ? 95 - stage * 8 : 119}`}
        stroke="#6b7050"
        strokeWidth="4"
        strokeLinecap="round"
      />
      {stage === 0 ? (
        <path d="M83 125Q82 115 94 117Q100 130 83 125Z" fill="#879967" />
      ) : (
        <g>
          {Array.from({ length: stage + 1 }, (_, i) => (
            <g key={i}>
              <path
                d={`M90 ${111 - i * 10}L${i % 2 ? 112 : 68} ${96 - i * 10}`}
                stroke="#6b7050"
                strokeWidth="2"
              />
              <ellipse
                cx={i % 2 ? 112 : 68}
                cy={93 - i * 10}
                rx={13 + stage * 2}
                ry={20 + stage}
                transform={`rotate(${i % 2 ? 25 : -25} ${i % 2 ? 112 : 68} ${93 - i * 10})`}
                fill={i % 2 ? "#8ea877" : "#607e59"}
              />
            </g>
          ))}
          <ellipse
            cx="90"
            cy={90 - stage * 8}
            rx={17 + stage}
            ry="27"
            fill="#769465"
          />
        </g>
      )}
    </svg>
  );
}
function InstallButton() {
  const [event, setEvent] = useState(null),
    [installed, setInstalled] = useState(
      matchMedia("(display-mode: standalone)").matches,
    );
  useEffect(() => {
    const before = (e) => {
        e.preventDefault();
        setEvent(e);
      },
      done = () => {
        setInstalled(true);
        setEvent(null);
      };
    window.addEventListener("beforeinstallprompt", before);
    window.addEventListener("appinstalled", done);
    return () => {
      window.removeEventListener("beforeinstallprompt", before);
      window.removeEventListener("appinstalled", done);
    };
  }, []);
  return installed ? (
    <span className="local-label">
      <Check size={14} />
      Installed on your device
    </span>
  ) : event ? (
    <button
      className="text-button"
      onClick={async () => {
        await event.prompt();
        await event.userChoice;
        setEvent(null);
      }}
    >
      <Smartphone size={15} />
      Install Page Grove
    </button>
  ) : (
    <small className="muted">
      Use your browser’s “Install app” or “Add to Home Screen” option.
    </small>
  );
}
export function Insights({ books, onOpen }) {
  const { sessions, totalSeconds, days, finished, annotations } =
    readingInsights(books);
  const max = Math.max(1, ...days.map((d) => d.minutes));
  return (
    <section className="insights-view">
      <div className="insight-metrics">
        {[
          [Math.floor(totalSeconds / 60), "minutes with books"],
          [sessions.length, "reading sessions"],
          [finished, "finished readings"],
          [annotations, "saved passages"],
        ].map(([value, label]) => (
          <div key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <section className="desk-card">
        <div className="section-title">
          <h2>A little reading, day by day</h2>
          <span className="muted">Past 14 days</span>
        </div>
        <div
          className="reading-chart"
          aria-label="Reading minutes over the past fourteen days"
        >
          {days.map((d) => (
            <div
              key={d.date}
              title={`${new Date(d.date).toLocaleDateString()}: ${d.minutes.toFixed(1)} minutes`}
            >
              <span
                style={{ height: `${Math.max(2, (d.minutes / max) * 140)}px` }}
              />
              <small>{d.label}</small>
              <span className="sr-only">{d.minutes.toFixed(1)} minutes</span>
            </div>
          ))}
        </div>
        <p className="muted">
          Time is recorded while playback is running. Earlier versions’ reading
          totals remain included, but only new sessions appear in the daily
          chart.
        </p>
      </section>
      <div className="section-title">
        <h2>Your pace by book</h2>
        <span className="muted">Base pace, not a comprehension score</span>
      </div>
      <div className="pace-by-book">
        {books
          .filter((b) => b.sessions?.length)
          .map((b) => {
            const last =
              [...b.sessions].reverse().find((s) => s.clarity === "clear") ||
              b.sessions.at(-1);
            return (
              <button key={b.id} onClick={() => onOpen(b)}>
                <BookOpen size={20} />
                <span>
                  {b.title}
                  <small>
                    {last.clarity === "clear"
                      ? "Last session you rated clear"
                      : "Most recent selected pace"}
                  </small>
                </span>
                <strong>{last.wpm} WPM</strong>
              </button>
            );
          })}
      </div>
      <div className="section-title">
        <h2>Session history</h2>
      </div>
      {sessions.length ? (
        <div className="session-history">
          {sessions.slice(0, 50).map((s) => (
            <article key={s.id}>
              <Clock size={16} />
              <div>
                <strong>{s.title}</strong>
                <small>
                  {new Date(s.startedAt).toLocaleString()} · {s.mode}
                </small>
              </div>
              <span>
                {(s.seconds / 60).toFixed(1)} min
                <br />
                <small>
                  {s.words} words · {s.wpm} WPM
                </small>
              </span>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <Clock size={33} />
          <h3>Your next session starts the story</h3>
          <p>Read a passage and come back to see your time and pace.</p>
        </div>
      )}
    </section>
  );
}
export function Shelves({ books, onOpen, onChanged, notify }) {
  const [shelves, setShelves] = useState([]),
    [name, setName] = useState(""),
    [rename, setRename] = useState(null),
    [renameText, setRenameText] = useState("");
  useEffect(() => {
    storage.getMeta("shelves").then((v) => setShelves(v || []));
  }, []);
  const names = [
    ...new Set([...shelves, ...books.map((b) => b.collection).filter(Boolean)]),
  ];
  async function changeName() {
    const old = rename,
      next = renameText.trim();
    if (!next) return;
    try {
      for (const b of books.filter((b) => b.collection === old))
        await storage.patchBook(b.id, { collection: next });
      const list = [
        ...new Set(shelves.map((s) => (s === old ? next : s)).concat(next)),
      ];
      await storage.setMeta("shelves", list);
      setShelves(list);
      setRename(null);
      await onChanged();
    } catch (e) {
      notify(e.message);
    }
  }
  return (
    <section>
      <div className="feature-tools">
        <div className="inline-form">
          <input
            aria-label="New shelf name"
            placeholder="A name for a new shelf"
            maxLength="100"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            className="secondary"
            disabled={!name.trim()}
            onClick={async () => {
              const list = [...new Set([...shelves, name.trim()])];
              await storage.setMeta("shelves", list);
              setShelves(list);
              setName("");
            }}
          >
            <Plus size={15} />
            Create shelf
          </button>
        </div>
      </div>
      {names.map((n) => (
        <section className="collection-card" key={n}>
          <header>
            <FolderOpen size={21} />
            <h2>{n}</h2>
            <span>{books.filter((b) => b.collection === n).length} books</span>
            <IconButton
              icon={Pencil}
              label={`Rename shelf ${n}`}
              onClick={() => {
                setRename(n);
                setRenameText(n);
              }}
            />
          </header>
          <div className="collection-books">
            {books
              .filter((b) => b.collection === n)
              .map((b) => (
                <button key={b.id} onClick={() => onOpen(b)}>
                  <Cover book={b} small />
                  <span>{b.title}</span>
                </button>
              ))}
            {!books.some((b) => b.collection === n) && (
              <p className="muted">
                Assign books here from their details page.
              </p>
            )}
          </div>
        </section>
      ))}
      {!names.length && (
        <div className="empty-state">
          <FolderOpen size={36} />
          <h2>Give your books a home</h2>
          <p>Create a shelf, then assign books from their details.</p>
        </div>
      )}
      {rename && (
        <Dialog title="Rename this shelf" onClose={() => setRename(null)}>
          <label className="field">
            Shelf name
            <input
              value={renameText}
              maxLength="100"
              onChange={(e) => setRenameText(e.target.value)}
            />
          </label>
          <button className="primary" onClick={changeName}>
            Save shelf name
          </button>
        </Dialog>
      )}
    </section>
  );
}
