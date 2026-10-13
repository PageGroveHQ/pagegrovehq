import React, { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Library,
  Leaf,
  Plus,
  Search,
  Settings,
  ArrowRight,
  Upload,
  FileText,
  Check,
  X,
  Download,
  ShieldCheck,
  FolderOpen,
  Bookmark,
  Trash2,
  MoreHorizontal,
  Play,
  Sprout,
  SlidersHorizontal,
  Grid2X2,
  List,
  ChevronDown,
  RefreshCw,
  CircleHelp,
} from "lucide-react";
import {
  Logo,
  GroveArt,
  Cover,
  IconButton,
  Dialog,
  ReaderSettings,
  Toggle,
  DownloadLink,
} from "./components";
import { makeBook, textBlocks, validateBackup } from "./engine";
import * as storage from "./storage";
import { sampleBooks, practiceBook } from "./samples";
import { importFile } from "./importers";
import Reader from "./Reader";
import ImportDialog, { RepairEditor } from "./ImportDialog";
import BookDetails from "./BookDetails";
import AccountPanel from "./AccountPanel";
import {
  ProfilesPanel,
  ReadingDesk,
  Notebook,
  Insights,
  Shelves,
} from "./FeaturePanels";
import { initializeCloud } from "./cloud";
import * as cloud from "./cloud";
import { Home, Highlighter, BarChart3, Cloud } from "lucide-react";

class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <main className="fatal">
        <Logo />
        <h1>Let’s reopen your grove.</h1>
        <p>
          The app encountered an unexpected error. Your saved library is still
          on this device.
        </p>
        <p>{this.state.error.message}</p>
        <button className="primary" onClick={() => location.reload()}>
          Reload Page Grove
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
export default function App() {
  return (
    <ErrorBoundary>
      <Grove />
    </ErrorBoundary>
  );
}
function Grove() {
  const [books, setBooks] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState("");
  const [page, setPage] = useState("library");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const [layout, setLayout] = useState("grid");
  const [modal, setModal] = useState(null);
  const [selected, setSelected] = useState(null);
  const [reader, setReader] = useState(null);
  const [incomingFiles, setIncomingFiles] = useState([]);
  const [toast, setToast] = useState("");
  const [original, setOriginal] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [importStatus, setImportStatus] = useState(null);
  const [candidate, setCandidate] = useState(null);
  const [pasteTitle, setPasteTitle] = useState("");
  const [paste, setPaste] = useState("");
  const [importTab, setImportTab] = useState("file");
  const [importError, setImportError] = useState("");
  const [backup, setBackup] = useState(null);
  const [restore, setRestore] = useState(null);
  const [restoreMode, setRestoreMode] = useState("merge");
  const [busy, setBusy] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [persisted, setPersisted] = useState(false);
  const fileInput = useRef();
  const backupInput = useRef();
  const abort = useRef();
  const lastReader = useRef(null);
  const notify = (text) => setToast(text);
  const refresh = async () => {
    setBooks(await storage.listBooks());
    setSettings(await storage.getSettings());
  };
  useEffect(() => {
    initializeCloud();
    const fn = () => {
      if (!lastReader.current) refresh().catch((e) => notify(e.message));
    };
    window.addEventListener("grove-library-change", fn);
    return () => window.removeEventListener("grove-library-change", fn);
  }, []);
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (!(await storage.getMeta("initialized"))) {
          await storage.restoreLibrary(
            sampleBooks(),
            await storage.getSettings(),
          );
          await storage.setMeta("initialized", true);
        }
        const [items, prefs] = await Promise.all([
          storage.listBooks(),
          storage.getSettings(),
        ]);
        if (mounted) {
          setBooks(items);
          setSettings(prefs);
        }
      } catch (e) {
        if (mounted)
          setFatal(
            `Browser storage is unavailable: ${e.message}. Enable storage for this site and reload.`,
          );
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    if (toast) {
      const id = setTimeout(() => setToast(""), 5000);
      return () => clearTimeout(id);
    }
  }, [toast]);
  useEffect(() => {
    if (settings) {
      document.documentElement.dataset.theme = settings.theme;
      document.documentElement.dataset.motion = settings.reducedMotion
        ? "reduced"
        : "normal";
    }
  }, [settings]);
  useEffect(() => {
    const fn = () => {
      if (!document.hidden && !lastReader.current)
        refresh().catch((e) => notify(e.message));
    };
    document.addEventListener("visibilitychange", fn);
    return () => document.removeEventListener("visibilitychange", fn);
  }, []);
  useEffect(() => {
    if (modal === "settings") {
      navigator.storage?.estimate?.().then(setEstimate);
      navigator.storage?.persisted?.().then(setPersisted);
    }
  }, [modal]);
  function updateSettings(patch) {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      storage
        .saveSettings(next)
        .catch(() =>
          notify(
            "Settings could not be saved. Check available browser storage.",
          ),
        );
      return next;
    });
  }
  async function openBook(book, position) {
    setModal(null);
    setOriginal(null);
    let latest =
      (await storage.listBooks()).find((b) => b.id === book.id) || book;
    try {
      latest = await cloud.ensureBookAvailable(latest);
    } catch (e) {
      notify(e.message);
      return;
    }
    lastReader.current = latest.id;
    setReader({
      ...latest,
      ...(position != null ? { position, completed: false } : {}),
    });
  }
  async function closeReader() {
    storage.releaseReadingContent(lastReader.current);
    lastReader.current = null;
    setReader(null);
    await refresh();
  }
  async function importFiles(files) {
    setIncomingFiles(Array.from(files || []));
    setModal("import");
  }
  async function backupLibrary() {
    setBusy(true);
    try {
      const data = {
        app: "pagegrovehq-reader",
        version: 1,
        exportedAt: new Date().toISOString(),
        books: await Promise.all(
          (await storage.listBooks()).map((b) => cloud.ensureBookAvailable(b)),
        ),
        settings,
        profiles: await storage.getProfiles(),
        vocabulary: await storage.getVocabulary(),
        shelves: (await storage.getMeta("shelves")) || [],
      };
      setBackup(new Blob([JSON.stringify(data)], { type: "application/json" }));
      notify("Backup prepared. Use Download backup to save it.");
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function readBackup(file) {
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > 250 * 1024 * 1024)
        throw new Error("Backups must be smaller than 250 MB.");
      setRestore(validateBackup(JSON.parse(await file.text())));
      setModal("restore");
    } catch (e) {
      notify(`Could not restore: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }
  async function applyRestore() {
    setBusy(true);
    try {
      await storage.restoreLibrary(
        restore.books,
        restore.settings,
        restoreMode === "replace",
        {
          profiles: restore.profiles,
          vocabulary: restore.vocabulary,
          shelves: restore.shelves,
        },
      );
      setSettings(restore.settings);
      await refresh();
      setRestore(null);
      setModal("settings");
      notify("Library restored successfully.");
    } catch (e) {
      notify(
        `Restore failed. Your previous library was retained. ${e.message}`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function showDetails(book) {
    if (book.cloudContentPath && !book.chapters.some((c) => c.blocks.length)) {
      try {
        book = await cloud.ensureBookAvailable(book);
      } catch (e) {
        notify(e.message);
      }
    }
    setSelected(book);
    setModal("details");
    setOriginal(await storage.getOriginal(book.id));
  }
  async function editBook(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      await storage.patchBook(selected.id, {
        title: String(form.get("title")).trim() || selected.title,
        author: String(form.get("author")).trim() || "Unknown author",
        collection: String(form.get("collection")).trim(),
      });
      await refresh();
      setModal(null);
      notify("Book details updated.");
    } catch (e) {
      notify(e.message);
    }
  }
  if (loading)
    return (
      <main className="loading">
        <Logo />
        <Leaf className="loading-leaf" />
        <p>Opening your grove…</p>
      </main>
    );
  if (fatal)
    return (
      <main className="fatal">
        <Logo />
        <h1>Your library needs browser storage</h1>
        <p>{fatal}</p>
        <button className="primary" onClick={() => location.reload()}>
          Try again
        </button>
      </main>
    );
  if (reader)
    return (
      <>
        <Reader
          key={reader.id}
          book={reader}
          settings={settings}
          updateSettings={updateSettings}
          onClose={closeReader}
          notify={notify}
        />
        {toast && (
          <div className="toast" role="status">
            <Check size={17} />
            {toast}
          </div>
        )}
      </>
    );
  const collections = [
    ...new Set(books.map((b) => b.collection).filter(Boolean)),
  ].sort();
  const visible = books
    .filter(
      (b) =>
        (!query ||
          `${b.title} ${b.author} ${b.collection} ${(b.tags || []).join(" ")}`
            .toLowerCase()
            .includes(query.toLowerCase())) &&
        (filter === "all" ||
          (filter === "want" && b.readingStatus === "want") ||
          (filter === "reading" && b.lastRead && !b.completed) ||
          (filter === "finished" && b.completed) ||
          (filter.startsWith("collection:") &&
            b.collection === filter.slice(11))),
    )
    .sort((a, b) =>
      sort === "manual"
        ? (a.shelfOrder || a.addedAt) - (b.shelfOrder || b.addedAt)
        : sort === "title"
          ? a.title.localeCompare(b.title)
          : sort === "added"
            ? b.addedAt - a.addedAt
            : b.lastRead - a.lastRead || b.addedAt - a.addedAt,
    );
  const current = books
    .filter((b) => b.lastRead && !b.completed)
    .sort((a, b) => b.lastRead - a.lastRead)[0];
  const totalMinutes = Math.floor(
    books.reduce((sum, b) => sum + b.secondsRead, 0) / 60,
  );
  const titles = {
    desk: "Your reading desk",
    notebook: "Your notebook",
    insights: "Your reading rhythm",
  };
  const headerTitle =
    titles[page] ||
    (page === "collections"
      ? "Your collections"
      : page === "bookmarks"
        ? "Saved for later"
        : "Your library");
  return (
    <div
      className="app-shell"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        importFiles(e.dataTransfer.files);
      }}
    >
      <aside className="sidebar">
        <a
          href="#library"
          className="brand-link"
          onClick={(e) => {
            e.preventDefault();
            setPage("library");
            setFilter("all");
          }}
        >
          <Logo />
        </a>
        <div className="sidebar-caption">YOUR READING SPACE</div>
        <nav aria-label="Main navigation">
          {[
            ["desk", Home, "Reading desk"],
            ["library", Library, "Library"],
            ["collections", FolderOpen, "Collections"],
            ["bookmarks", Bookmark, "Bookmarks"],
            ["notebook", Highlighter, "Notebook"],
            ["insights", BarChart3, "Insights"],
          ].map(([id, Icon, title]) => (
            <button
              className={page === id ? "nav-item active" : "nav-item"}
              key={id}
              onClick={() => {
                setPage(id);
                setFilter("all");
              }}
            >
              <Icon size={19} />
              {title}
              {id === "library" && (
                <span className="nav-count">{books.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-rule" />
        <button className="nav-item" onClick={() => openBook(practiceBook())}>
          <Sprout size={19} />
          Find your pace
        </button>
        <button className="nav-item" onClick={() => setModal("settings")}>
          <Settings size={19} />
          Settings
        </button>
        <button className="nav-item" onClick={() => setModal("account")}>
          <Cloud size={19} />
          Account & sync
        </button>
        <div className="sidebar-bottom">
          <div className="grove-note">
            <Leaf size={22} />
            <p>
              A little reading.
              <br />A little growing.
            </p>
          </div>
          <button className="nav-item" onClick={() => setModal("help")}>
            <CircleHelp size={18} />
            About your grove
          </button>
          <span className="local-label">
            <ShieldCheck size={14} />
            Private. On this device.
          </span>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            <Leaf size={16} />
            <span>Your grove</span>
            <span className="slash">/</span>
            <strong>
              {
                {
                  library: "Library",
                  collections: "Collections",
                  bookmarks: "Bookmarks",
                  desk: "Reading desk",
                  notebook: "Notebook",
                  insights: "Insights",
                }[page]
              }
            </strong>
          </div>
          <div className="top-actions">
            <button
              className="text-button desktop-only"
              onClick={() => setModal("help")}
            >
              <CircleHelp size={16} />
              How it works
            </button>
            <button
              className="avatar"
              aria-label="Open app settings"
              onClick={() => setModal("settings")}
            >
              PG
            </button>
          </div>
        </header>
        <div className="page-content">
          <section className="page-heading">
            <div>
              <span className="eyebrow">MAKE ROOM FOR A GOOD BOOK</span>
              <h1>
                {headerTitle}
                <span className="heading-dot">.</span>
              </h1>
              <p>
                {page === "library"
                  ? "Stories to get lost in. A place to find your focus."
                  : page === "collections"
                    ? "A little order for all the worlds on your shelf."
                    : "The passages you want to come back to."}
              </p>
            </div>
            <button
              className="primary"
              onClick={() => {
                setCandidate(null);
                setImportError("");
                setIncomingFiles([]);
                setModal("import");
              }}
            >
              <Plus size={18} />
              Add a book
            </button>
          </section>
          {page === "desk" && (
            <ReadingDesk
              books={books}
              settings={settings}
              onOpen={openBook}
              onLibrary={() => setPage("library")}
              onPractice={() => openBook(practiceBook())}
              onSettings={() => setModal("settings")}
            />
          )}
          {page === "notebook" && (
            <Notebook
              books={books}
              onOpen={openBook}
              onChanged={refresh}
              notify={notify}
            />
          )}
          {page === "insights" && <Insights books={books} onOpen={openBook} />}
          {page === "library" && (
            <>
              <section className="welcome-card">
                <div className="welcome-copy">
                  <span className="pill">
                    <Leaf size={13} />A QUIETER WAY TO READ
                  </span>
                  <h2>
                    One word at a time.
                    <br />A whole world within.
                  </h2>
                  <p>
                    Let the words come to you. Find your rhythm
                    <br className="desktop-only" /> and settle into your next
                    story.
                  </p>
                  <button
                    className="welcome-link"
                    onClick={() =>
                      openBook(
                        current || books.find((b) => b.demo) || practiceBook(),
                      )
                    }
                  >
                    {current ? "Continue your story" : "Try the focus reader"}
                    <ArrowRight size={17} />
                  </button>
                </div>
                <img className="hero-art" src="./grove-banner.webp" alt="" />
              </section>
              {current && (
                <section className="continue-card">
                  <Cover book={current} small />
                  <div>
                    <span className="eyebrow">PICK UP WHERE YOU LEFT OFF</span>
                    <h3>{current.title}</h3>
                    <p>
                      {current.author} ·{" "}
                      {Math.round(
                        ((current.position + 1) / current.wordCount) * 100,
                      )}
                      % read
                    </p>
                  </div>
                  <button
                    className="secondary"
                    onClick={() => openBook(current)}
                  >
                    <Play size={15} />
                    Continue reading
                  </button>
                </section>
              )}
              <section className="library-tools">
                <div className="filter-tabs" aria-label="Library filters">
                  {[
                    ["all", "All books"],
                    ["reading", "In progress"],
                    ["want", "Want to read"],
                    ["finished", "Finished"],
                  ].map(([id, text]) => (
                    <button
                      key={id}
                      className={filter === id ? "active" : ""}
                      onClick={() => setFilter(id)}
                    >
                      {text}
                      {id === "all" && <span>{books.length}</span>}
                    </button>
                  ))}
                </div>
                <div className="library-search">
                  <Search size={17} />
                  <input
                    aria-label="Search your library"
                    placeholder="Search your library"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {query && (
                    <IconButton
                      icon={X}
                      label="Clear search"
                      onClick={() => setQuery("")}
                    />
                  )}
                </div>
              </section>
              <div className="shelf-caption">
                <span>
                  {visible.length} {visible.length === 1 ? "book" : "books"} on
                  your shelf
                </span>
                <div>
                  <label className="sort-label">
                    Sort by{" "}
                    <select
                      aria-label="Sort books"
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                    >
                      <option value="recent">Recently read</option>
                      <option value="added">Date added</option>
                      <option value="title">Title A–Z</option>
                      <option value="manual">Shelf order</option>
                    </select>
                  </label>
                  <div className="view-buttons">
                    <IconButton
                      icon={Grid2X2}
                      label="Grid view"
                      aria-pressed={layout === "grid"}
                      onClick={() => setLayout("grid")}
                    />
                    <IconButton
                      icon={List}
                      label="List view"
                      aria-pressed={layout === "list"}
                      onClick={() => setLayout("list")}
                    />
                  </div>
                </div>
              </div>
              <div className={`bookshelf ${layout}`}>
                {visible.map((b) => (
                  <article className="book-card" key={b.id}>
                    <button
                      className="cover-button"
                      onClick={() => openBook(b)}
                      aria-label={`Read ${b.title}`}
                    >
                      <Cover book={b} />
                      <span className="cover-read">
                        <Play size={16} />
                        Open book
                      </span>
                      {b.demo && (
                        <span className="sample-tag">SAMPLE EXCERPT</span>
                      )}
                    </button>
                    <div className="book-info">
                      <div className="book-title-row">
                        <button
                          onClick={() => openBook(b)}
                          className="book-title"
                        >
                          {b.title}
                        </button>
                        <IconButton
                          icon={MoreHorizontal}
                          label={`Details for ${b.title}`}
                          onClick={() => showDetails(b)}
                        />
                      </div>
                      <p>{b.author}</p>
                      <div className="book-status">
                        <span
                          className={`status-dot ${b.completed ? "finished" : b.lastRead ? "reading" : ""}`}
                        />
                        {b.completed
                          ? "Finished"
                          : b.lastRead
                            ? `${Math.round(((b.position + 1) / b.wordCount) * 100)}% read`
                            : b.readingStatus === "want"
                              ? "Want to read"
                              : "Ready to begin"}
                        <span className="format-label">{b.format}</span>
                      </div>
                      {b.lastRead > 0 && (
                        <div className="book-progress">
                          <span
                            style={{
                              width: `${b.completed ? 100 : ((b.position + 1) / b.wordCount) * 100}%`,
                            }}
                          />
                        </div>
                      )}
                    </div>
                  </article>
                ))}
                {filter === "all" && !query && (
                  <button
                    className="add-book-card"
                    onClick={() => setModal("import")}
                  >
                    <span className="add-circle">
                      <Plus size={25} />
                    </span>
                    <strong>A new world awaits</strong>
                    <span>Add an EPUB, PDF, or text file</span>
                  </button>
                )}
              </div>
              {!visible.length && (
                <div className="empty-state">
                  <BookOpen size={35} />
                  <h3>
                    {query ? "No books found" : "A fresh stretch of shelf"}
                  </h3>
                  <p>
                    {query
                      ? "Try another title or author."
                      : "Add a book, or choose another library filter."}
                  </p>
                </div>
              )}
            </>
          )}
          {page === "collections" && (
            <Shelves
              books={books}
              onOpen={openBook}
              onChanged={refresh}
              notify={notify}
            />
          )}
          {page === "bookmarks" && (
            <div className="saved-passages">
              {books
                .flatMap((b) => b.bookmarks.map((m) => ({ b, m })))
                .sort((a, b) => b.m.createdAt - a.m.createdAt)
                .map(({ b, m }) => (
                  <BookmarkCard
                    key={m.id}
                    book={b}
                    mark={m}
                    onOpen={() => openBook(b, m.position)}
                    onDelete={async () => {
                      try {
                        await storage.patchBook(b.id, {
                          bookmarks: b.bookmarks.filter((x) => x.id !== m.id),
                          annotationTombstones: [
                            ...(b.annotationTombstones || []),
                            { id: m.id, deletedAt: Date.now() },
                          ],
                        });
                        await refresh();
                      } catch (e) {
                        notify(e.message);
                      }
                    }}
                  />
                ))}
              {!books.some((b) => b.bookmarks.length) && (
                <div className="empty-state">
                  <Bookmark size={38} />
                  <h2>Keep a little of what you read</h2>
                  <p>
                    Save a bookmark in the reader. Your passage and optional
                    note will appear here.
                  </p>
                </div>
              )}
            </div>
          )}
          <footer className="library-footer">
            <span>
              <ShieldCheck size={15} />
              Your books stay on your device.
            </span>
            <span>
              {totalMinutes > 0
                ? `${totalMinutes} minutes spent in your grove`
                : "Grow at your own pace."}
              <Leaf size={14} />
            </span>
          </footer>
        </div>
      </main>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        <button onClick={() => setPage("desk")} aria-pressed={page === "desk"}>
          <Home size={20} />
          Desk
        </button>
        <button
          onClick={() => setPage("library")}
          aria-pressed={page === "library"}
        >
          <Library size={20} />
          Library
        </button>
        <button
          onClick={() => setPage("collections")}
          aria-pressed={page === "collections"}
        >
          <FolderOpen size={20} />
          Collections
        </button>
        <button
          onClick={() => setPage("bookmarks")}
          aria-pressed={page === "bookmarks"}
        >
          <Bookmark size={20} />
          Bookmarks
        </button>
        <button
          onClick={() => setPage("notebook")}
          aria-pressed={page === "notebook"}
        >
          <Highlighter size={20} />
          Notebook
        </button>
        <button onClick={() => setModal("settings")}>
          <Settings size={20} />
          Settings
        </button>
      </nav>
      {dragging && (
        <div className="drop-overlay">
          <Upload size={44} />
          <h2>Drop a new story into your grove</h2>
        </div>
      )}
      {modal === "import" && (
        <ImportDialog
          files={incomingFiles}
          books={books}
          settings={settings}
          onAdded={refresh}
          notify={notify}
          onClose={() => {
            setModal(null);
            setIncomingFiles([]);
          }}
        />
      )}
      {modal === "account" && (
        <AccountPanel
          onClose={() => setModal(null)}
          onChanged={refresh}
          notify={notify}
        />
      )}
      {modal === "repair" && selected && (
        <Dialog
          title="Repair your reading text"
          onClose={() => setModal("details")}
          wide
        >
          <RepairEditor
            book={selected}
            onCancel={() => setModal("details")}
            onSave={async (book) => {
              try {
                await storage.saveBook(book);
                setSelected(book);
                await refresh();
                setModal("details");
                notify(
                  "Reading text repaired. Saved quotations are preserved.",
                );
              } catch (e) {
                notify(e.message);
              }
            }}
          />
        </Dialog>
      )}
      {modal === "settings" && (
        <Dialog
          title="Make yourself comfortable"
          onClose={() => setModal(null)}
        >
          <ProfilesPanel settings={settings} onChange={updateSettings} />
          <ReaderSettings settings={settings} onChange={updateSettings} />
          <Toggle
            label="Show my growing grove"
            description="Grows with time reading; no streak penalties."
            value={settings.growth}
            onChange={(growth) => updateSettings({ growth })}
          />
          <button className="secondary" onClick={() => setModal("account")}>
            <Cloud size={17} />
            Account & sync
          </button>
          <div className="settings-heading">Your device & library</div>
          <Toggle
            label="Reduce decorative motion"
            value={settings.reducedMotion}
            onChange={(reducedMotion) => updateSettings({ reducedMotion })}
          />
          <label className="field">
            Scanned PDF language
            <select
              value={settings.ocrLanguage}
              onChange={(e) => updateSettings({ ocrLanguage: e.target.value })}
            >
              <option value="eng">English</option>
              <option value="spa">Spanish</option>
              <option value="fra">French</option>
              <option value="deu">German</option>
              <option value="ita">Italian</option>
              <option value="por">Portuguese</option>
            </select>
          </label>
          <div className="notice">
            <strong>Your library lives in this browser</strong>
            <p>
              Clearing site data or changing devices can remove it. Export a
              backup to keep your books, extracted illustrations, progress,
              notes, and settings. Original uploaded files are excluded; keep
              those separately.
            </p>
            {estimate && (
              <p>
                {((estimate.usage || 0) / 1048576).toFixed(1)} MB used across
                this site’s origin ·{" "}
                {((estimate.quota || 0) / 1073741824).toFixed(1)} GB available
                quota
              </p>
            )}
            <button
              className="text-button"
              onClick={async () => {
                const ok = await navigator.storage?.persist?.();
                setPersisted(!!ok);
                notify(
                  ok
                    ? "Persistent storage granted."
                    : "This browser did not grant persistence. Keep regular backups.",
                );
              }}
            >
              {persisted ? <Check size={15} /> : <ShieldCheck size={15} />}{" "}
              {persisted
                ? "Persistent storage enabled"
                : "Request persistent storage"}
            </button>
          </div>
          <div className="backup-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={backupLibrary}
            >
              <Download size={17} />
              {busy ? "Preparing…" : "Prepare backup"}
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => backupInput.current.click()}
            >
              <Upload size={17} />
              Restore backup
            </button>
          </div>
          {backup && (
            <DownloadLink
              blob={backup}
              filename={`page-grove-backup-${new Date().toISOString().slice(0, 10)}.json`}
              className="primary download-backup"
            >
              <Download size={18} />
              Download backup
            </DownloadLink>
          )}
          <input
            ref={backupInput}
            hidden
            type="file"
            accept=".json"
            onChange={(e) => {
              readBackup(e.target.files[0]);
              e.target.value = "";
            }}
          />
          <div className="settings-heading">A little practice</div>
          <p className="muted">
            Start at a comfortable pace. Increase it only when you still
            understand and enjoy the passage. Faster isn’t always better.
          </p>
          <button
            className="secondary"
            onClick={() => openBook(practiceBook())}
          >
            <Sprout size={18} />
            Find your reading rhythm
          </button>
          <div className="stats-summary">
            <span>
              <strong>{totalMinutes}</strong>minutes reading
            </span>
            <span>
              <strong>{books.filter((b) => b.completed).length}</strong>finished
              readings
            </span>
            <span>
              <strong>
                {books.reduce((s, b) => s + b.bookmarks.length, 0)}
              </strong>
              bookmarks
            </span>
          </div>
        </Dialog>
      )}
      {modal === "restore" && restore && (
        <Dialog
          title="Restore your grove"
          onClose={() => {
            setRestore(null);
            setModal("settings");
          }}
        >
          <p>
            This backup contains {restore.books.length} books and their saved
            reading positions. Restoring also applies its reading settings.
          </p>
          <label className="radio-row">
            <input
              type="radio"
              name="restore"
              checked={restoreMode === "merge"}
              onChange={() => setRestoreMode("merge")}
            />
            <span>
              <strong>Merge with this library</strong>
              <small>
                Keep other books. Books with matching IDs are replaced by the
                backup copy.
              </small>
            </span>
          </label>
          <label className="radio-row">
            <input
              type="radio"
              name="restore"
              checked={restoreMode === "replace"}
              onChange={() => setRestoreMode("replace")}
            />
            <span>
              <strong>Replace this library</strong>
              <small>
                Remove the current library and original files, then restore the
                backup.
              </small>
            </span>
          </label>
          <div className="dialog-actions">
            <button className="secondary" onClick={() => setModal("settings")}>
              Cancel
            </button>
            <button className="primary" disabled={busy} onClick={applyRestore}>
              {busy ? "Restoring…" : "Restore library"}
            </button>
          </div>
        </Dialog>
      )}
      {modal === "details" && selected && (
        <BookDetails
          book={selected}
          books={books}
          original={original}
          collections={collections}
          settings={settings}
          onClose={() => setModal(null)}
          onOpen={openBook}
          onRepair={() => setModal("repair")}
          onDelete={() => setModal("delete")}
          onChanged={refresh}
          notify={notify}
        />
      )}
      {modal === "delete" && selected && (
        <Dialog title="Remove this book?" onClose={() => setModal("details")}>
          <p>
            “{selected.title}” and its saved progress, bookmarks, and original
            file will be removed from this browser. Export a backup first if you
            want to keep them.
          </p>
          <div className="dialog-actions">
            <button className="secondary" onClick={() => setModal("details")}>
              Keep book
            </button>
            <button
              className="primary danger-button"
              onClick={async () => {
                try {
                  await storage.deleteBook(selected.id);
                  await refresh();
                  setModal(null);
                  notify("Book removed from your library.");
                } catch (e) {
                  notify(e.message);
                }
              }}
            >
              Remove book
            </button>
          </div>
        </Dialog>
      )}
      {modal === "help" && (
        <Dialog title="Welcome to Page Grove HQ" onClose={() => setModal(null)}>
          <Logo />
          <p>
            A private bookshelf and a quieter way to read. Import a book, choose
            your pace, and let one word at a time arrive at a steady focal
            point.
          </p>
          <div className="help-step">
            <span>01</span>
            <div>
              <h3>Bring your own books</h3>
              <p>
                EPUB is the best fit. PDFs are supported with original-page
                previews and OCR for scanned pages. TXT, Markdown, HTML, and FB2
                work too. Kindle and DRM-protected formats need an unprotected
                EPUB edition.
              </p>
            </div>
          </div>
          <div className="help-step">
            <span>02</span>
            <div>
              <h3>Find your rhythm</h3>
              <p>
                Use speed presets, the 10-WPM slider, or exact numeric entry.
                Punctuation pauses and long-word timing give passages room to
                breathe.
              </p>
            </div>
          </div>
          <div className="help-step">
            <span>03</span>
            <div>
              <h3>Keep the context</h3>
              <p>
                Pause whenever you need. Open Passage to read normally, see
                illustrations and tables, or select a word to resume from.
                Bookmark passages and add a note.
              </p>
            </div>
          </div>
          <div className="notice">
            <strong>Read for understanding</strong>
            <p>
              RSVP is a reading option, not a promise of better comprehension.
              Your comfortable pace may change with the book. Look back and slow
              down as needed.
            </p>
            <a
              href="https://journals.sagepub.com/doi/10.1177/1529100615623267"
              target="_blank"
              rel="noreferrer"
            >
              Read the research review ↗
            </a>
          </div>
          <p className="muted">
            No account required. No book uploads or tracking analytics. Books
            stay in this browser; backups move your library between devices.
            Offline reading works after the app loads. OCR’s first use downloads
            resources from this app’s hosting; these are cached for later use.
          </p>
          <p className="muted">
            Included covers are original illustrations. Sample excerpts: Alice’s
            Adventures in Wonderland (1865), The Secret Garden (1911), and
            Walden (1854); public domain in the United States.
          </p>
        </Dialog>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}
function ImportPreview({ book }) {
  const [index, setIndex] = useState(0);
  const chapter = book.chapters[index];
  return (
    <section className="import-preview">
      <label className="field">
        Preview section
        <select value={index} onChange={(e) => setIndex(+e.target.value)}>
          {book.chapters.map((c, i) => (
            <option key={i} value={i}>
              {c.title}
            </option>
          ))}
        </select>
      </label>
      <div className="preview-columns">
        <div className="preview-text">
          {chapter.blocks
            .filter((b) => b.text)
            .slice(0, 5)
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
function BookmarkCard({ book, mark, onOpen, onDelete }) {
  const text = book.chapters
    .flatMap((c) => c.blocks)
    .filter((b) => b.type !== "table" && b.type !== "image")
    .map((b) => b.text)
    .join(" ")
    .split(/\s+/)
    .slice(Math.max(0, mark.position - 5), mark.position + 25)
    .join(" ");
  return (
    <article className="saved-card">
      <Bookmark size={23} />
      <div>
        <h3>{book.title}</h3>
        <p>“…{text}…”</p>
        {mark.note && <blockquote>{mark.note}</blockquote>}
        <button className="text-button" onClick={onOpen}>
          Return to passage
          <ArrowRight size={15} />
        </button>
      </div>
      <IconButton icon={Trash2} label="Delete bookmark" onClick={onDelete} />
    </article>
  );
}
