import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Play,
  Pause,
  RotateCcw,
  SkipForward,
  Bookmark,
  Settings,
  BookOpen,
  List,
  Search,
  X,
  Maximize,
  Minimize,
  ChevronLeft,
  ChevronRight,
  Leaf,
  Check,
  Trash2,
  ArrowRight,
  Download,
  Sprout,
  Highlighter,
  Wrench,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import {
  Logo,
  IconButton,
  Dialog,
  ReaderSettings,
  SpeedControl,
  DownloadLink,
} from "./components";
import {
  anchorParts,
  tokenize,
  wordDuration,
  sentenceStart,
  nextSentence,
  clamp,
} from "./engine";
import { patchBook, getOriginal, saveBook, listBooks } from "./storage";
import {
  currentSentence,
  presentationUnit,
  referenceAt,
  repairBook,
} from "./enhancements";
import { ProfilesPanel } from "./FeaturePanels";
import ReaderTools from "./ReaderTools";
import { setReadingBook } from "./cloud";

export default function Reader({
  book,
  settings: globalSettings,
  updateSettings: updateGlobalSettings,
  onClose,
  notify,
}) {
  const [overrides, setOverrides] = useState(book.readingSettings || null);
  const settings = overrides
    ? { ...globalSettings, ...overrides }
    : globalSettings;
  function updateSettings(patch) {
    pause();
    if (overrides) {
      const next = { ...overrides, ...patch };
      setOverrides(next);
      if (!book.practice)
        patchBook(book.id, { readingSettings: next }).catch((e) =>
          notify(e.message),
        );
    } else updateGlobalSettings(patch);
  }
  function setBookSettings(value) {
    setOverrides(value);
    if (!book.practice)
      patchBook(book.id, { readingSettings: value }).catch((e) =>
        notify(e.message),
      );
  }
  const words = useMemo(() => tokenize(book), [book.id]);
  const [position, setPosition] = useState(
    clamp(book.position, 0, words.length - 1),
  );
  const [playing, setPlaying] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [panel, setPanel] = useState(null);
  const [mode, setMode] = useState("focus");
  const [search, setSearch] = useState("");
  const [marks, setMarks] = useState(book.bookmarks || []);
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState("");
  const [media, setMedia] = useState(null);
  const [completed, setCompleted] = useState(!!book.completed);
  const [fullscreen, setFullscreen] = useState(false);
  const [original, setOriginal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [quiz, setQuiz] = useState({});
  const [showAnswers, setShowAnswers] = useState(false);
  const [stageWidth, setStageWidth] = useState(700);
  const [highlights, setHighlights] = useState(book.highlights || []);
  const [highlightColor, setHighlightColor] = useState("sage");
  const [selection, setSelection] = useState(null);
  const [collapsed, setCollapsed] = useState(!!settings.controlsCollapsed);
  const root = useRef();
  const stage = useRef();
  const activeParagraph = useRef();
  const positionRef = useRef(position);
  const stats = useRef({
    secondsRead: book.secondsRead || 0,
    wordsRead: book.wordsRead || 0,
  });
  const marksRef = useRef(marks);
  const completeRef = useRef(completed);
  const everPlayed = useRef(false);
  const hasSeeked = useRef(true);
  const mediaSeen = useRef(new Set());
  const saveQueue = useRef(Promise.resolve());
  const closing = useRef(false);
  const replacedContent = useRef(false);
  const gestureHandled = useRef(false);
  const tombstonesRef = useRef(book.annotationTombstones || []);
  const highlightRef = useRef(highlights),
    sessionsRef = useRef(book.sessions || []),
    sessionRef = useRef(null),
    clockRef = useRef(null),
    touchRef = useRef(null);
  highlightRef.current = highlights;
  positionRef.current = position;
  marksRef.current = marks;
  completeRef.current = completed;
  const word = words[position];
  const unit = presentationUnit(words, position, settings);
  function accountTime() {
    if (clockRef.current !== null) {
      const elapsed = (performance.now() - clockRef.current) / 1000;
      stats.current.secondsRead += elapsed;
      if (sessionRef.current) sessionRef.current.seconds += elapsed;
      clockRef.current = performance.now();
    }
  }
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    return () => {
      document.documentElement.dataset.theme = globalSettings.theme;
    };
  }, [settings.theme, globalSettings.theme]);
  useEffect(() => {
    setReadingBook(book.id);
    return () => setReadingBook(null);
  }, [book.id]);
  const chapter = book.chapters[word.chapter];
  const parts = anchorParts(word.text);
  const progress = completed ? 100 : ((position + 1) / words.length) * 100;
  const fontSize = useMemo(() => {
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = `${settings.fontSize}px Georgia`;
    const half = ctx.measureText(parts[1]).width / 2;
    const left = ctx.measureText(parts[0]).width + half;
    const right = ctx.measureText(parts[2]).width + half;
    return Math.min(
      settings.fontSize,
      (settings.fontSize * (stageWidth * 0.4 - 12)) / Math.max(1, left),
      (settings.fontSize * (stageWidth * 0.57 - 12)) / Math.max(1, right),
    );
  }, [word.text, settings.fontSize, stageWidth]);
  useEffect(() => {
    if (!stage.current) return;
    const observer = new ResizeObserver((entries) =>
      setStageWidth(entries[0].contentRect.width),
    );
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, [mode]);
  const chapterStarts = useMemo(
    () =>
      book.chapters.map((_, ci) => words.findIndex((w) => w.chapter === ci)),
    [words],
  );
  const blockStarts = useMemo(() => {
    const map = new Map();
    words.forEach((w, i) => {
      const key = `${w.chapter}:${w.block}`;
      if (!map.has(key)) map.set(key, i);
    });
    return map;
  }, [words]);
  function save() {
    if (replacedContent.current) return Promise.resolve();
    if (book.practice) return Promise.resolve();
    accountTime();
    if (sessionRef.current) {
      sessionRef.current.endPosition = positionRef.current;
      const entry = { ...sessionRef.current };
      sessionsRef.current = [
        ...sessionsRef.current.filter((s) => s.id !== entry.id),
        entry,
      ].slice(-10000);
    }
    const patch = {
      position: positionRef.current,
      completed: completeRef.current,
      bookmarks: marksRef.current,
      highlights: highlightRef.current,
      annotationTombstones: tombstonesRef.current,
      sessions: sessionsRef.current,
      readingStatus: completeRef.current ? "finished" : "reading",
      lastRead: Date.now(),
      ...stats.current,
    };
    saveQueue.current = saveQueue.current
      .catch(() => {})
      .then(() => patchBook(book.id, patch));
    return saveQueue.current.catch((e) => {
      notify(`Reading position could not be saved: ${e.message}`);
      throw e;
    });
  }
  function pause(message = "") {
    accountTime();
    clockRef.current = null;
    setPlaying(false);
    setCountdown(null);
    if (message) setNotice(message);
    save().catch(() => {});
  }
  function seek(index) {
    pause();
    const next = clamp(index, 0, words.length - 1);
    setPosition(next);
    positionRef.current = next;
    setCompleted(false);
    completeRef.current = false;
    hasSeeked.current = true;
    setNotice("");
    save().catch(() => {});
  }
  async function leave() {
    if (closing.current) return;
    closing.current = true;
    pause();
    setSaving(true);
    try {
      await save();
      if (document.fullscreenElement) await document.exitFullscreen();
      await onClose();
    } catch {
      setSaving(false);
      closing.current = false;
    }
  }
  function initialMedia(index) {
    if (!settings.mediaPause || book.format === "PDF") return null;
    const current = words[index];
    const blocks = book.chapters[current.chapter].blocks;
    const previous =
      index > 0 && words[index - 1].chapter === current.chapter
        ? words[index - 1].block
        : -1;
    const found = blocks
      .slice(previous + 1, current.block)
      .filter(
        (b, offset) =>
          ["image", "table"].includes(b.type) &&
          !mediaSeen.current.has(`${current.chapter}:${previous + 1 + offset}`),
      );
    blocks
      .slice(previous + 1, current.block)
      .forEach((b, offset) =>
        mediaSeen.current.add(`${current.chapter}:${previous + 1 + offset}`),
      );
    return found.length ? found : null;
  }
  function start() {
    if (playing || countdown != null) {
      pause();
      return;
    }
    if (completed) {
      seek(0);
      mediaSeen.current.clear();
    }
    const startAt = completed
      ? 0
      : settings.replay && everPlayed.current && !hasSeeked.current
        ? sentenceStart(words, positionRef.current)
        : positionRef.current;
    const before = initialMedia(startAt);
    if (before) {
      setMedia(before);
      return;
    }
    setPosition(startAt);
    positionRef.current = startAt;
    setNotice("");
    setPanel(null);
    setMode(settings.presentation === "guided" ? "passage" : "focus");
    if (!sessionRef.current)
      sessionRef.current = {
        id: crypto.randomUUID(),
        startedAt: Date.now(),
        seconds: 0,
        words: 0,
        wpm: settings.wpm,
        mode: settings.presentation,
        startPosition: startAt,
        endPosition: startAt,
      };
    sessionRef.current.wpm = settings.wpm;
    sessionRef.current.mode = settings.presentation;
    everPlayed.current = true;
    hasSeeked.current = false;
    if (settings.countdown) setCountdown(3);
    else setPlaying(true);
  }
  useEffect(() => {
    if (countdown == null) return;
    const id = setTimeout(() => {
      if (countdown === 1) {
        setCountdown(null);
        setPlaying(true);
      } else setCountdown(countdown - 1);
    }, 650);
    return () => clearTimeout(id);
  }, [countdown]);
  useEffect(() => {
    if (!playing) return;
    const id = setTimeout(
      () => {
        stats.current.wordsRead += unit.words.length;
        if (sessionRef.current) sessionRef.current.words += unit.words.length;
        if (unit.end >= words.length - 1) {
          accountTime();
          clockRef.current = null;
          const tail = chapter.blocks
            .slice(word.block + 1)
            .filter((b) => ["image", "table"].includes(b.type));
          setPlaying(false);
          setCompleted(true);
          completeRef.current = true;
          save().catch(() => {});
          if (settings.mediaPause && book.format !== "PDF" && tail.length)
            setMedia(tail);
          else setPanel(book.practice ? "practice" : "complete");
          return;
        }
        const next = words[unit.end + 1];
        const crossed =
          next.chapter !== word.chapter || next.block !== word.block;
        setPosition(unit.end + 1);
        positionRef.current = unit.end + 1;
        if (crossed && settings.mediaPause && book.format !== "PDF") {
          const intermediates =
            next.chapter === word.chapter
              ? chapter.blocks.slice(word.block + 1, next.block)
              : [
                  ...chapter.blocks.slice(word.block + 1),
                  ...book.chapters[next.chapter].blocks.slice(0, next.block),
                ];
          const found = intermediates.filter((b) =>
            ["image", "table"].includes(b.type),
          );
          if (found.length) {
            accountTime();
            clockRef.current = null;
            setPlaying(false);
            hasSeeked.current = true;
            setMedia(found);
            save().catch(() => {});
            return;
          }
        }
        if (next.chapter !== word.chapter && settings.chapterPause) {
          accountTime();
          clockRef.current = null;
          setPlaying(false);
          hasSeeked.current = true;
          setNotice(
            `${book.format === "PDF" ? "Page" : "Chapter"} complete. Take a breath, then continue.`,
          );
          save().catch(() => {});
        }
      },
      unit.words.reduce((sum, w) => sum + wordDuration(w, settings), 0),
    );
    return () => clearTimeout(id);
  }, [playing, position, settings]);
  useEffect(() => {
    if (!playing) return;
    clockRef.current = performance.now();
    const id = setInterval(() => save().catch(() => {}), 3000);
    return () => {
      accountTime();
      clockRef.current = null;
      clearInterval(id);
    };
  }, [playing]);
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) pause("Paused while you were away.");
    };
    const blur = () => pause("Paused while you were away.");
    const pagehide = () => {
      save().catch(() => {});
    };
    const full = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("blur", blur);
    window.addEventListener("pagehide", pagehide);
    document.addEventListener("fullscreenchange", full);
    getOriginal(book.id)
      .then(setOriginal)
      .catch(() => {});
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("blur", blur);
      window.removeEventListener("pagehide", pagehide);
      document.removeEventListener("fullscreenchange", full);
      save().catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (playing && "wakeLock" in navigator) {
      let lock;
      let released = false;
      navigator.wakeLock
        .request("screen")
        .then((l) => {
          if (released) l.release();
          else lock = l;
        })
        .catch(() => {});
      return () => {
        released = true;
        lock?.release();
      };
    }
  }, [playing]);
  useEffect(() => {
    const key = (e) => {
      if (
        ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(e.target.tagName) ||
        e.target.isContentEditable ||
        panel ||
        media
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        start();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        seek(sentenceStart(words, positionRef.current, true));
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        seek(nextSentence(words, positionRef.current));
      } else if (e.key.toLowerCase() === "b") {
        pause();
        setPanel("bookmark");
      } else if (e.key === "Escape") {
        pause();
        if (mode === "passage") setMode("focus");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  useEffect(() => {
    if (mode === "passage")
      requestAnimationFrame(() =>
        activeParagraph.current?.scrollIntoView({
          block: "center",
          behavior: "instant",
        }),
      );
  }, [mode, word.chapter, word.block]);
  function openPanel(name) {
    pause();
    setPanel(name);
  }
  function setPassage() {
    pause();
    setPanel(null);
    setMode(mode === "passage" ? "focus" : "passage");
  }
  async function bookmark(e) {
    e.preventDefault();
    const newMark = {
      id: crypto.randomUUID(),
      position: positionRef.current,
      reference: referenceAt(words, positionRef.current),
      quote: currentSentence(words, positionRef.current),
      note: note.trim(),
      createdAt: Date.now(),
    };
    const updated = [...marksRef.current, newMark];
    marksRef.current = updated;
    setMarks(updated);
    setSaving(true);
    try {
      await save();
      setPanel(null);
      setNote("");
      notify("Passage bookmarked.");
    } catch {
    } finally {
      setSaving(false);
    }
  }
  async function saveHighlight(e) {
    e.preventDefault();
    let end = sentenceStart(words, position);
    while (
      end < words.length - 1 &&
      !words[end].sentenceEnd &&
      !words[end].paragraphEnd &&
      words[end + 1].chapter === word.chapter
    )
      end++;
    const range = selection || { start: sentenceStart(words, position), end };
    const h = {
      id: crypto.randomUUID(),
      position: range.start,
      endPosition: range.end,
      reference: referenceAt(words, range.start),
      endReference: referenceAt(words, range.end),
      quote: words
        .slice(range.start, range.end + 1)
        .map((w) => w.text)
        .join(" "),
      note: note.trim(),
      color: highlightColor,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const next = [...highlightRef.current, h];
    highlightRef.current = next;
    setHighlights(next);
    setSaving(true);
    try {
      await save();
      setPanel(null);
      setNote("");
      setSelection(null);
      notify("Passage highlighted and saved to your notebook.");
    } catch {
    } finally {
      setSaving(false);
    }
  }
  function captureSelection() {
    const selected = window.getSelection();
    if (!selected || selected.isCollapsed || !selected.toString().trim())
      return;
    const a = selected.anchorNode?.parentElement?.closest("[data-word-index]"),
      b = selected.focusNode?.parentElement?.closest("[data-word-index]");
    if (a && b) {
      pause();
      setSelection({
        start: Math.min(+a.dataset.wordIndex, +b.dataset.wordIndex),
        end: Math.max(+a.dataset.wordIndex, +b.dataset.wordIndex),
      });
    }
  }
  const results = search.trim()
    ? words.reduce((out, w, i) => {
        if (
          out.length < 100 &&
          w.text.toLowerCase().includes(search.trim().toLowerCase())
        )
          out.push(i);
        return out;
      }, [])
    : [];
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (root.current.requestFullscreen)
        await root.current.requestFullscreen();
      else notify("Fullscreen is unavailable in this browser.");
    } catch {
      notify("Fullscreen is unavailable in this browser.");
    }
  }
  const passage = (
    <div
      className="passage-content"
      onMouseUp={captureSelection}
      onTouchEnd={captureSelection}
    >
      {selection && (
        <div className="selection-toolbar">
          <span>Passage selected</span>
          <button className="secondary" onClick={() => openPanel("highlight")}>
            <Highlighter size={15} />
            Highlight selection
          </button>
          <button className="text-button" onClick={() => setSelection(null)}>
            Clear
          </button>
        </div>
      )}
      <div className="passage-heading">
        <span className="eyebrow">
          {book.format === "PDF"
            ? "ORIGINAL PAGE & EXTRACTED TEXT"
            : "TAKE IN THE WHOLE PASSAGE"}
        </span>
        <h2>{chapter.title}</h2>
        <p>
          Click a word to move your reading position. Use “Read from here” to
          start at a paragraph.
        </p>
      </div>
      {chapter.blocks.map((block, bi) => {
        const startIndex = blockStarts.get(`${word.chapter}:${bi}`);
        const active = bi === word.block;
        if (block.excluded || chapter.excluded) return null;
        if (block.type === "image" || block.type === "table")
          return <MediaBlock key={bi} block={block} />;
        const tokens = (block.text || "").match(/\S+/gu) || [];
        return (
          <div
            ref={active ? activeParagraph : null}
            className={`passage-block ${active ? "active-passage" : ""} ${block.type === "heading" ? "passage-subheading" : ""}`}
            key={bi}
          >
            <p>
              {tokens.map((text, wi) => (
                <React.Fragment key={wi}>
                  <span
                    data-word-index={startIndex + wi}
                    style={{
                      background: highlights.find(
                        (h) =>
                          !h.orphaned &&
                          startIndex + wi >= h.position &&
                          startIndex + wi <= h.endPosition,
                      )
                        ? {
                            sage: "#adc19b88",
                            gold: "#e5d09b99",
                            rose: "#d8afa988",
                          }[
                            highlights.find(
                              (h) =>
                                !h.orphaned &&
                                startIndex + wi >= h.position &&
                                startIndex + wi <= h.endPosition,
                            ).color
                          ]
                        : undefined,
                    }}
                    className={
                      startIndex + wi === position ? "current-word" : ""
                    }
                    onClick={() => {
                      if (window.getSelection()?.isCollapsed)
                        seek(startIndex + wi);
                    }}
                    title="Move reading position to this word"
                  >
                    {text}
                  </span>{" "}
                </React.Fragment>
              ))}
            </p>
            {startIndex != null && (
              <button
                className="text-button paragraph-start"
                onClick={() => {
                  seek(startIndex);
                  setMode("focus");
                }}
              >
                Read from here
                <ArrowRight size={13} />
              </button>
            )}
          </div>
        );
      })}
      <div className="passage-navigation">
        <button
          className="secondary"
          disabled={
            word.chapter === 0 ||
            chapterStarts.slice(0, word.chapter).every((i) => i === -1)
          }
          onClick={() => {
            const prev = chapterStarts
              .slice(0, word.chapter)
              .findLast((i) => i !== -1);
            seek(prev);
          }}
        >
          <ChevronLeft size={17} />
          Previous section
        </button>
        <button
          className="secondary"
          disabled={chapterStarts
            .slice(word.chapter + 1)
            .every((i) => i === -1)}
          onClick={() => {
            seek(chapterStarts.slice(word.chapter + 1).find((i) => i !== -1));
          }}
        >
          Next section
          <ChevronRight size={17} />
        </button>
      </div>
    </div>
  );
  return (
    <div
      ref={root}
      className={`reader-shell ${mode === "passage" ? "reading-passage" : ""}`}
    >
      <header className="reader-header">
        <button className="back-button" disabled={saving} onClick={leave}>
          <ArrowLeft size={19} />
          <span>Library</span>
        </button>
        <Logo />
        <div className="reader-header-actions">
          <IconButton
            icon={Search}
            label="Search book"
            onClick={() => openPanel("search")}
          />
          <IconButton
            icon={fullscreen ? Minimize : Maximize}
            label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            onClick={toggleFullscreen}
          />
          <IconButton
            icon={Settings}
            label="Reader settings"
            onClick={() => openPanel("settings")}
          />
        </div>
      </header>
      <div className="reader-book-heading">
        <span className="eyebrow">
          {book.practice
            ? "FIND YOUR RHYTHM"
            : book.demo
              ? "PUBLIC-DOMAIN SAMPLE EXCERPT"
              : "YOUR FOCUS READER"}
        </span>
        <h1>{book.title}</h1>
        <p>{book.author}</p>
      </div>
      <div className="reader-toolbar">
        <button className="text-button" onClick={() => openPanel("chapters")}>
          <List size={17} />
          <span>{chapter.title}</span>
          <ChevronRight size={14} />
        </button>
        <div className="reader-mode-switch">
          <button
            className={mode === "focus" ? "selected" : ""}
            onClick={() => {
              pause();
              setMode("focus");
            }}
          >
            <Leaf size={16} />
            Focus
          </button>
          <button
            className={mode === "passage" ? "selected" : ""}
            onClick={setPassage}
          >
            <BookOpen size={16} />
            Passage
          </button>
        </div>
      </div>
      {mode === "focus" ? (
        <section className="focus-space">
          <div
            ref={stage}
            className={`rsvp-stage ${settings.guides ? "with-guides" : ""} ${settings.presentation === "sentence" ? "segment-stage" : ""}`}
            onTouchStart={(e) => {
              touchRef.current = {
                x: e.changedTouches[0].clientX,
                y: e.changedTouches[0].clientY,
              };
            }}
            onTouchEnd={(e) => {
              const t = touchRef.current;
              if (!t || !settings.gestures) return;
              const dx = e.changedTouches[0].clientX - t.x,
                dy = e.changedTouches[0].clientY - t.y;
              if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
                seek(
                  dx < 0
                    ? nextSentence(words, position)
                    : sentenceStart(words, position, true),
                );
                touchRef.current = null;
                gestureHandled.current = true;
              }
            }}
            onClick={() => {
              if (gestureHandled.current) {
                gestureHandled.current = false;
                return;
              }
              start();
            }}
            aria-label="Focus display. Use the play button to start or pause."
          >
            <div className="focus-guide top-guide" />
            {countdown != null ? (
              <div className="countdown" aria-live="polite">
                {countdown}
              </div>
            ) : settings.presentation !== "word" ? (
              <div
                className="rsvp-segment"
                style={{
                  fontSize: Math.min(
                    settings.fontSize,
                    settings.presentation === "sentence" ? 26 : 36,
                  ),
                }}
                aria-hidden="true"
              >
                {unit.text}
              </div>
            ) : (
              <div
                className={`rsvp-word ${settings.highlight ? "highlight-anchor" : ""}`}
                style={{ fontSize: `${fontSize}px` }}
                aria-hidden="true"
              >
                <span className="word-prefix">{parts[0]}</span>
                <span className="word-anchor">{parts[1]}</span>
                <span className="word-suffix">{parts[2]}</span>
              </div>
            )}
            <div className="focus-guide bottom-guide" />
          </div>
          <div className="focus-status" role="status">
            {notice ||
              (completed
                ? "Reading complete. Revisit a passage or begin again."
                : playing
                  ? "Settle in. Let the words come to you."
                  : countdown
                    ? "Find your focal point."
                    : "A moment to settle in. Press play when you’re ready.")}
          </div>
          {!playing && !countdown && settings.contextOnPause && (
            <div className="paused-context">
              <p>{currentSentence(words, position)}</p>
              <button
                className="text-button"
                onClick={() => seek(sentenceStart(words, position, true))}
              >
                <RotateCcw size={14} />
                What did I just read?
              </button>
              <button
                className="text-button"
                onClick={() => {
                  const startIndex = blockStarts.get(
                    `${word.chapter}:${word.block}`,
                  );
                  seek(startIndex);
                }}
              >
                Replay paragraph
              </button>
            </div>
          )}
          <p className="paused-word sr-only">
            {!playing && countdown == null ? `Current word: ${word.text}` : ""}
          </p>
        </section>
      ) : (
        passage
      )}
      <button
        className="controls-toggle text-button"
        onClick={() => {
          setCollapsed(!collapsed);
          updateSettings({ controlsCollapsed: !collapsed });
        }}
      >
        {collapsed ? <ChevronUp size={17} /> : <ChevronDown size={17} />}{" "}
        {collapsed ? "Show reading controls" : "Hide reading controls"}
      </button>
      <div
        className={`reader-controls ${collapsed ? "collapsed-controls" : ""}`}
      >
        <div className="playback-buttons">
          <IconButton
            icon={Highlighter}
            label="Highlight this passage"
            onClick={() => {
              setSelection(null);
              openPanel("highlight");
            }}
          />
          <IconButton
            icon={Wrench}
            label="Reading tools"
            onClick={() => openPanel("tools")}
          />
          <IconButton
            icon={RotateCcw}
            label="Previous sentence"
            onClick={() => seek(sentenceStart(words, position, true))}
          />
          <button
            className="play-button"
            onClick={start}
            aria-label={
              playing || countdown != null
                ? "Pause reading"
                : completed
                  ? "Read again"
                  : "Play reading"
            }
          >
            {playing || countdown != null ? (
              <Pause size={25} fill="currentColor" />
            ) : (
              <Play size={25} fill="currentColor" />
            )}
          </button>
          <IconButton
            icon={SkipForward}
            label="Next sentence"
            onClick={() => seek(nextSentence(words, position))}
          />
          <span className="control-separator" />
          <IconButton
            icon={Bookmark}
            label="Bookmark this passage"
            onClick={() => openPanel("bookmark")}
          />
          <IconButton
            icon={BookOpen}
            label={
              mode === "focus" ? "Open passage view" : "Return to focus view"
            }
            onClick={setPassage}
          />
        </div>
        <SpeedControl
          settings={settings}
          onChange={(patch) => {
            pause();
            updateSettings(patch);
          }}
          compact
        />
        <div className="reader-progress">
          <input
            aria-label="Book reading position"
            type="range"
            min="0"
            max={words.length - 1}
            value={position}
            onChange={(e) => seek(+e.target.value)}
          />
          <div>
            <span>
              {Math.round(progress)}% · {position + 1} of{" "}
              {words.length.toLocaleString()} words
            </span>
            <span>
              ~{Math.ceil((words.length - position - 1) / settings.wpm)} min
              left at base pace
            </span>
          </div>
        </div>
        <p className="keyboard-hint">
          Space to play / pause<span>·</span>← / → for sentences<span>·</span>B
          to bookmark
        </p>
      </div>
      {panel === "highlight" && (
        <Dialog
          title="Save a little of this passage"
          onClose={() => setPanel(null)}
        >
          <blockquote className="bookmark-excerpt">
            {selection
              ? words
                  .slice(selection.start, selection.end + 1)
                  .map((w) => w.text)
                  .join(" ")
              : currentSentence(words, position)}
          </blockquote>
          <form onSubmit={saveHighlight}>
            <div className="highlight-colors">
              {["sage", "gold", "rose"].map((color) => (
                <button
                  type="button"
                  key={color}
                  className={`color-${color}`}
                  aria-label={`${color} highlight`}
                  aria-pressed={highlightColor === color}
                  onClick={() => setHighlightColor(color)}
                >
                  {highlightColor === color && <Check size={16} />}
                </button>
              ))}
            </div>
            <label className="field">
              Your note
              <textarea
                rows="3"
                maxLength="2000"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <button className="primary" disabled={saving} type="submit">
              Save highlight
            </button>
          </form>
        </Dialog>
      )}
      {panel === "tools" && (
        <ReaderTools
          book={book}
          words={words}
          position={position}
          onClose={() => setPanel(null)}
          onSeek={seek}
          notify={notify}
          onRepair={async (chapters) => {
            pause();
            await save();
            const current =
              (await listBooks()).find((b) => b.id === book.id) || book;
            const repaired = repairBook(current, chapters);
            await saveBook(repaired);
            replacedContent.current = true;
            setPanel(null);
            await onClose();
          }}
        />
      )}
      {panel === "settings" && (
        <Dialog title="Your reading rhythm" onClose={() => setPanel(null)}>
          <ProfilesPanel
            settings={settings}
            onChange={updateSettings}
            book={{ ...book, readingSettings: overrides }}
            onBookSettings={setBookSettings}
          />
          <ReaderSettings settings={settings} onChange={updateSettings} />
        </Dialog>
      )}
      {panel === "chapters" && (
        <Dialog
          title={
            book.format === "PDF" ? "Pages & bookmarks" : "Chapters & bookmarks"
          }
          onClose={() => setPanel(null)}
        >
          <div className="chapter-list">
            {book.chapters.map((c, ci) => (
              <button
                className={ci === word.chapter ? "active" : ""}
                key={ci}
                onClick={() => {
                  if (chapterStarts[ci] >= 0) seek(chapterStarts[ci]);
                  else {
                    setMedia(
                      c.blocks.filter((b) =>
                        ["image", "table"].includes(b.type),
                      ),
                    );
                  }
                  setPanel(null);
                }}
              >
                <span>{String(ci + 1).padStart(2, "0")}</span>
                <strong>{c.title}</strong>
                {ci === word.chapter && <Leaf size={15} />}
              </button>
            ))}
          </div>
          <div className="settings-heading">Your bookmarks</div>
          {marks.length ? (
            marks.map((m) => (
              <div className="reader-bookmark" key={m.id}>
                <button
                  className="text-button"
                  onClick={() => {
                    seek(m.position);
                    setPanel(null);
                  }}
                >
                  <Bookmark size={16} />
                  <span>
                    {words
                      .slice(m.position, m.position + 8)
                      .map((w) => w.text)
                      .join(" ")}
                    …{m.note && <small>{m.note}</small>}
                  </span>
                </button>
                <IconButton
                  icon={Trash2}
                  label="Remove bookmark"
                  onClick={() => {
                    const next = marks.filter((b) => b.id !== m.id);
                    tombstonesRef.current = [
                      ...tombstonesRef.current,
                      { id: m.id, deletedAt: Date.now() },
                    ];
                    marksRef.current = next;
                    setMarks(next);
                    save().catch(() => {});
                  }}
                />
              </div>
            ))
          ) : (
            <p className="muted">
              No bookmarks yet. Save a passage using the bookmark button.
            </p>
          )}
          {original && (
            <DownloadLink
              blob={original}
              filename={book.sourceName || "original-book"}
              className="secondary"
            >
              <Download size={17} />
              Download original file
            </DownloadLink>
          )}
        </Dialog>
      )}
      {panel === "search" && (
        <Dialog title="Find a word in this book" onClose={() => setPanel(null)}>
          <label className="field">
            Search words
            <input
              autoFocus
              placeholder="Search for a word…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <p className="muted">
            {search.trim()
              ? `${results.length}${results.length === 100 ? "+" : ""} matching words`
              : "Search the extracted reading text."}
          </p>
          <div className="search-results">
            {results.map((index) => (
              <button
                key={index}
                onClick={() => {
                  seek(index);
                  setPanel(null);
                  setMode("passage");
                }}
              >
                <small>{book.chapters[words[index].chapter].title}</small>
                <span>
                  {words
                    .slice(Math.max(0, index - 5), index + 8)
                    .map((w, i) => (
                      <React.Fragment key={i}>
                        {w.text === words[index].text ? (
                          <mark>{w.text}</mark>
                        ) : (
                          w.text
                        )}{" "}
                      </React.Fragment>
                    ))}
                </span>
              </button>
            ))}
          </div>
        </Dialog>
      )}
      {panel === "bookmark" && (
        <Dialog title="Keep this passage" onClose={() => setPanel(null)}>
          <blockquote className="bookmark-excerpt">
            {words
              .slice(
                sentenceStart(words, position),
                Math.min(words.length, nextSentence(words, position)),
              )
              .map((w) => w.text)
              .join(" ")}
          </blockquote>
          <form onSubmit={bookmark}>
            <label className="field">
              A note to your future self{" "}
              <span className="muted">(optional)</span>
              <textarea
                rows="4"
                maxLength="1000"
                placeholder="What would you like to remember?"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <button className="primary" disabled={saving} type="submit">
              <Bookmark size={17} />
              {saving ? "Saving…" : "Save bookmark"}
            </button>
          </form>
          {book.practice && (
            <p className="muted">
              Practice bookmarks last for this session. Import a book to keep
              bookmarks in your library.
            </p>
          )}
        </Dialog>
      )}
      {media && (
        <Dialog
          title="A moment for the page"
          onClose={() => {
            setMedia(null);
            if (completed) setPanel(book.practice ? "practice" : "complete");
          }}
          wide
        >
          <p className="muted">
            Reading paused for an illustration or table. Take your time, then
            continue with the play button.
          </p>
          {media.map((block, i) => (
            <MediaBlock key={i} block={block} />
          ))}
          <button
            className="primary"
            onClick={() => {
              setMedia(null);
              hasSeeked.current = true;
              if (completed) setPanel(book.practice ? "practice" : "complete");
            }}
          >
            Back to reading
            <ArrowRight size={17} />
          </button>
        </Dialog>
      )}
      {panel === "complete" && (
        <Dialog title="A good place to pause" onClose={() => setPanel(null)}>
          <div className="completion">
            <Leaf size={40} />
            <h2>
              You’ve finished this {book.demo ? "sample excerpt" : "reading"}.
            </h2>
            <p>{book.title}</p>
            <p className="muted">
              {Math.floor(stats.current.secondsRead / 60)} minutes of reading ·{" "}
              {marks.length} saved passages
            </p>
            <p className="muted">How clear did this reading feel?</p>
            <div className="backup-actions">
              {[
                ["clear", "Clear & comfortable"],
                ["mixed", "A little rushed"],
                ["unclear", "I’d slow down"],
              ].map(([clarity, label]) => (
                <button
                  className="secondary"
                  key={clarity}
                  onClick={() => {
                    if (sessionRef.current) {
                      sessionRef.current.clarity = clarity;
                      save().catch(() => {});
                    }
                    notify("Reflection saved. Keep a pace that feels clear.");
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <button className="primary" onClick={leave}>
              Return to your library
              <ArrowRight size={17} />
            </button>
            <button
              className="text-button"
              onClick={() => {
                setPanel(null);
                seek(0);
              }}
            >
              Read again
            </button>
          </div>
        </Dialog>
      )}
      {panel === "practice" && (
        <Dialog title="How did that pace feel?" onClose={() => setPanel(null)}>
          <p>
            A comfortable pace leaves room to understand. Try these three quick
            recall questions; this is a practice exercise, not a validated
            assessment.
          </p>
          {[
            [
              "Where did Maya sit?",
              ["A wooden bench", "A stone wall", "A café"],
              0,
            ],
            [
              "What grew beside the bench?",
              ["Lavender", "Rosemary", "Sunflowers"],
              1,
            ],
            [
              "What did she keep in her notebook?",
              ["A feather", "A photograph", "A fallen leaf"],
              2,
            ],
          ].map(([question, options, answer], i) => (
            <fieldset className="quiz-question" key={question}>
              <legend>{question}</legend>
              {options.map((option, j) => (
                <label key={option}>
                  <input
                    type="radio"
                    name={`q${i}`}
                    checked={quiz[i] === j}
                    onChange={() => setQuiz({ ...quiz, [i]: j })}
                  />
                  {option}
                  {showAnswers && j === answer && <Check size={15} />}
                </label>
              ))}
            </fieldset>
          ))}
          {showAnswers && (
            <div className="notice">
              <strong>
                {[0, 1, 2].filter((v, i) => quiz[i] === v).length} of 3 correct
              </strong>
              <p>
                If the details slipped past, try 20–30 WPM slower. Keep a pace
                that feels comfortable and clear.
              </p>
            </div>
          )}
          <div className="dialog-actions">
            <button className="secondary" onClick={() => setShowAnswers(true)}>
              Check answers
            </button>
            <button
              className="primary"
              onClick={() => {
                setQuiz({});
                setShowAnswers(false);
                setPanel(null);
                seek(0);
              }}
            >
              Try again
            </button>
          </div>
          <button className="text-button" onClick={leave}>
            Return to library
          </button>
        </Dialog>
      )}
    </div>
  );
}
function MediaBlock({ block }) {
  if (block.type === "image")
    return (
      <figure className="passage-image">
        <img
          src={block.src}
          alt={block.alt || "Book illustration"}
          loading="lazy"
        />
        <figcaption>{block.alt}</figcaption>
      </figure>
    );
  return (
    <div className="passage-table">
      <table>
        <tbody>
          {block.rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
