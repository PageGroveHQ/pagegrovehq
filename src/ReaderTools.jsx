import React, { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Search,
  Volume2,
  Plus,
  Check,
  Sparkles,
  ArrowRight,
  RefreshCw,
  FileText,
} from "lucide-react";
import { Dialog, DownloadLink } from "./components";
import * as storage from "./storage";
import * as cloud from "./cloud";
import { ImportPreview } from "./ImportDialog";
export default function ReaderTools({
  book,
  words,
  position,
  onClose,
  onSeek,
  notify,
  onRepair,
}) {
  const [tab, setTab] = useState("dictionary"),
    [word, setWord] = useState(
      words[position].text.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ""),
    ),
    [definition, setDefinition] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [vocab, setVocab] = useState([]),
    [review, setReview] = useState(null),
    [reveal, setReveal] = useState(false),
    [aiMode, setAIMode] = useState("explain"),
    [answer, setAnswer] = useState(null),
    [consent, setConsent] = useState(false),
    [jobs, setJobs] = useState([]);
  const [processingResult, setProcessingResult] = useState(null);
  useEffect(() => {
    storage.getVocabulary().then(setVocab);
    cloud
      .listProcessingJobs()
      .then(setJobs)
      .catch(() => {});
  }, []);
  async function lookup(e) {
    e?.preventDefault();
    setBusy(true);
    setError("");
    try {
      const query = word.toLowerCase().trim();
      if (!/^[\p{L}\p{M}'’-]{1,80}$/u.test(query))
        throw new Error("Choose a single word.");
      const cached = await storage.getMeta(`dictionary:${query}`);
      if (cached) {
        setDefinition({ ...cached, cached: true });
        return;
      }
      if (!navigator.onLine)
        throw new Error(
          "This word is not cached yet. Connect to look it up once.",
        );
      const response = await fetch(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(query)}`,
        { signal: AbortSignal.timeout(12000) },
      );
      if (response.status === 404)
        throw new Error(
          "No English definition was found. Try the base form of the word.",
        );
      if (!response.ok)
        throw new Error("The dictionary is unavailable right now.");
      const entries = await response.json();
      const meanings = entries
        .flatMap((entry) =>
          (entry.meanings || []).flatMap((m) =>
            (m.definitions || []).slice(0, 3).map((d) => ({
              part: m.partOfSpeech,
              definition: d.definition,
              example: d.example || "",
            })),
          ),
        )
        .slice(0, 9);
      if (!meanings.length) throw new Error("No definition was returned.");
      const result = {
        word: query,
        phonetic: entries[0].phonetic || "",
        meanings,
        source: entries[0].sourceUrls?.[0] || "https://dictionaryapi.dev/",
      };
      await storage.setMeta(`dictionary:${query}`, result);
      setDefinition(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function saveWord() {
    const next = [
      ...vocab.filter((v) => v.word !== definition.word),
      {
        id: crypto.randomUUID(),
        word: definition.word,
        definition: definition.meanings[0].definition,
        bookTitle: book.title,
        createdAt: Date.now(),
        nextReview: Date.now(),
        level: 0,
      },
    ];
    await storage.setMeta("vocabulary", next);
    setVocab(next);
    notify("Word saved for review.");
  }
  async function rateWord(remembered) {
    const level = remembered ? Math.min(6, (review.level || 0) + 1) : 0;
    const days = [0, 1, 3, 7, 14, 30, 60];
    const next = vocab.map((v) =>
      v.id === review.id
        ? { ...v, level, nextReview: Date.now() + days[level] * 86400000 }
        : v,
    );
    await storage.setMeta("vocabulary", next);
    setVocab(next);
    setReview(null);
    setReveal(false);
  }
  const passages = useMemo(() => {
    const current = words[position];
    if (aiMode === "explain") {
      const block = book.chapters[current.chapter].blocks[current.block];
      return [{ id: block.id, text: block.text.slice(0, 6000) }];
    }
    const groups = new Map();
    for (const w of words
      .slice(0, position + 1)
      .filter((w) => w.chapter === current.chapter)) {
      if (!groups.has(w.passageId)) groups.set(w.passageId, []);
      groups.get(w.passageId).push(w.text);
    }
    let size = 0;
    return [...groups]
      .slice(-20)
      .map(([id, tokens]) => ({ id, text: tokens.join(" ").slice(0, 2000) }))
      .reverse()
      .filter((p) => {
        size += p.text.length;
        return size <= 16000;
      })
      .reverse();
  }, [aiMode, position, book, words]);
  async function ask() {
    setBusy(true);
    setError("");
    try {
      setAnswer(await cloud.askReadingAssistant(aiMode, passages));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const download = useMemo(
    () =>
      answer
        ? new Blob(
            [
              `# Page Grove reading notes\n\n${book.title}\n\n${answer.answer}\n\n${answer.citations.map((c) => `> ${c.quote}\n\nPassage ${c.passageId}`).join("\n\n")}\n\n${answer.questions.map((q) => `## ${q.question}\n\n${q.answer}`).join("\n\n")}`,
            ],
            { type: "text/markdown" },
          )
        : null,
    [answer],
  );
  return (
    <Dialog title="A few tools for the journey" onClose={onClose} wide>
      <div className="tools-tabs">
        {[
          ["dictionary", "Dictionary"],
          ["vocabulary", "Vocabulary"],
          ["assistant", "Reading assistant"],
          ["processing", "Document tools"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "selected" : ""}
            onClick={() => {
              setTab(id);
              setError("");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "dictionary" && (
        <>
          <p className="muted">
            English lookup sends only the chosen word to the public Dictionary
            API. Definitions are cached for later offline use.
          </p>
          <form className="inline-form" onSubmit={lookup}>
            <input
              aria-label="Dictionary word"
              value={word}
              onChange={(e) => setWord(e.target.value)}
              maxLength="80"
            />
            <button className="primary" type="submit" disabled={busy}>
              <Search size={16} />
              {busy ? "Looking up…" : "Look up"}
            </button>
          </form>
          {definition && (
            <section className="dictionary-result">
              <header>
                <h2>{definition.word}</h2>
                <span>{definition.phonetic}</span>
                <button
                  className="icon-button"
                  aria-label="Pronounce this word"
                  disabled={!("speechSynthesis" in window)}
                  onClick={() => {
                    const utterance = new SpeechSynthesisUtterance(
                      definition.word,
                    );
                    utterance.lang = "en-US";
                    speechSynthesis.cancel();
                    speechSynthesis.speak(utterance);
                  }}
                >
                  <Volume2 size={20} />
                </button>
              </header>
              {definition.cached && (
                <span className="pill">CACHED ON THIS DEVICE</span>
              )}
              {definition.meanings.map((m, i) => (
                <div key={i}>
                  <span className="eyebrow">{m.part}</span>
                  <p>{m.definition}</p>
                  {m.example && <blockquote>{m.example}</blockquote>}
                </div>
              ))}
              <button className="secondary" onClick={saveWord}>
                <Plus size={15} />
                Save to vocabulary
              </button>
              <a
                className="text-button"
                href={
                  /^https:\/\/(en\.wiktionary\.org|dictionaryapi\.dev)\//.test(
                    definition.source,
                  )
                    ? definition.source
                    : "https://dictionaryapi.dev/"
                }
                target="_blank"
                rel="noreferrer"
              >
                Dictionary source ↗
              </a>
            </section>
          )}
        </>
      )}
      {tab === "vocabulary" && (
        <>
          <div className="section-title">
            <h2>Words worth keeping</h2>
            <span className="muted">
              {vocab.filter((v) => v.nextReview <= Date.now()).length} ready for
              review
            </span>
          </div>
          {review ? (
            <div className="vocab-review">
              <h2>{review.word}</h2>
              {reveal ? (
                <>
                  <p>{review.definition}</p>
                  <div className="backup-actions">
                    <button
                      className="secondary"
                      onClick={() => rateWord(false)}
                    >
                      Show me again
                    </button>
                    <button className="primary" onClick={() => rateWord(true)}>
                      I remembered it
                      <Check size={15} />
                    </button>
                  </div>
                </>
              ) : (
                <button className="secondary" onClick={() => setReveal(true)}>
                  Show definition
                </button>
              )}
            </div>
          ) : (
            <>
              <button
                className="primary"
                disabled={!vocab.some((v) => v.nextReview <= Date.now())}
                onClick={() => {
                  setReview(vocab.find((v) => v.nextReview <= Date.now()));
                  setReveal(false);
                }}
              >
                Review a word
                <ArrowRight size={15} />
              </button>
              {vocab.map((v) => (
                <article className="vocab-card" key={v.id}>
                  <div>
                    <strong>{v.word}</strong>
                    <p>{v.definition}</p>
                    <small>
                      From {v.bookTitle} · next review{" "}
                      {new Date(v.nextReview).toLocaleDateString()}
                    </small>
                  </div>
                  <button
                    className="text-button danger"
                    onClick={async () => {
                      const next = vocab.filter((x) => x.id !== v.id);
                      await storage.setMeta("vocabulary", next);
                      setVocab(next);
                    }}
                  >
                    Remove
                  </button>
                </article>
              ))}
              {!vocab.length && (
                <p className="muted">
                  Look up a word and save it here. Review intervals grow as you
                  remember it.
                </p>
              )}
            </>
          )}
        </>
      )}
      {tab === "assistant" && (
        <>
          <div className="notice">
            <strong>Assistance with the passage, at your request</strong>
            <p>
              Only the excerpts shown below are sent to the app’s private server
              and OpenAI. Recaps and questions use text up to your current
              position; later chapters are excluded. Answers can be
              mistaken—check the cited passages.
            </p>
          </div>
          <label className="field">
            What would help?
            <select
              value={aiMode}
              onChange={(e) => {
                setAIMode(e.target.value);
                setAnswer(null);
                setConsent(false);
              }}
            >
              <option value="explain">Explain this paragraph</option>
              <option value="recap">
                Recap what I’ve read in this chapter
              </option>
              <option value="questions">Ask me three recall questions</option>
            </select>
          </label>
          <details className="assistant-excerpts">
            <summary>Review the excerpts to be sent</summary>
            {passages.map((p) => (
              <p key={p.id}>{p.text}</p>
            ))}
          </details>
          {!cloud.aiAvailable() ? (
            <p className="notice">
              Reading assistance requires an AI-enabled backend and a signed-in
              account. It is not enabled on this deployment yet.
            </p>
          ) : (
            <>
              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                Send these excerpts for this request
              </label>
              <button
                className="primary"
                disabled={!consent || busy}
                onClick={ask}
              >
                <Sparkles size={16} />
                {busy ? "Considering your passage…" : "Get reading assistance"}
              </button>
            </>
          )}
          {answer && (
            <div className="assistant-answer">
              <p>{answer.answer}</p>
              {answer.citations.map((c, i) => (
                <button
                  className="citation-card"
                  key={i}
                  onClick={() => {
                    const index = words.findIndex(
                      (w) => w.passageId === c.passageId,
                    );
                    if (index >= 0) {
                      onSeek(index);
                      onClose();
                    }
                  }}
                >
                  “{c.quote}”
                  <span>
                    Return to cited passage
                    <ArrowRight size={13} />
                  </span>
                </button>
              ))}
              {answer.questions.map((q, i) => (
                <details className="quiz-answer" key={i}>
                  <summary>{q.question}</summary>
                  <p>{q.answer}</p>
                </details>
              ))}
              <DownloadLink
                blob={download}
                filename="page-grove-reading-notes.md"
                className="secondary"
              >
                Export these notes
              </DownloadLink>
            </div>
          )}
        </>
      )}
      {tab === "processing" && (
        <>
          <h2>Room for heavier documents</h2>
          <p className="muted">
            On-device OCR is already available during import. Optional server
            OCR handles documents on a dedicated worker, so processing can
            continue while you leave the reader. It requires a connected backend
            and a synced original PDF.
          </p>
          <button
            className="secondary"
            disabled={
              busy || book.format !== "PDF" || !cloud.processingAvailable()
            }
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await cloud.queueServerOCR(book.id);
                setJobs(await cloud.listProcessingJobs());
                notify("PDF queued for private background OCR.");
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <FileText size={16} />
            Request background OCR
          </button>
          {!cloud.processingAvailable() && (
            <p className="notice">
              Background processing is not enabled on this deployment. On-device
              OCR remains available when you import a PDF.
            </p>
          )}
          {cloud.processingAvailable() && (
            <button
              className="text-button"
              onClick={async () => setJobs(await cloud.listProcessingJobs())}
            >
              <RefreshCw size={15} />
              Refresh processing status
            </button>
          )}
          {jobs.map((j) => (
            <div className="processing-job" key={j.id}>
              <span>
                {j.status} · {j.progress}%{j.error && <small>{j.error}</small>}
              </span>
              {j.status === "complete" && j.book_id === book.id && (
                <button
                  className="text-button"
                  onClick={async () => {
                    try {
                      setProcessingResult(
                        await cloud.downloadProcessingResult(j),
                      );
                    } catch (e) {
                      setError(e.message);
                    }
                  }}
                >
                  Review extracted result
                </button>
              )}
              {["queued", "processing"].includes(j.status) && (
                <button
                  className="text-button danger"
                  onClick={async () => {
                    await cloud.cancelProcessingJob(j.id);
                    setJobs(await cloud.listProcessingJobs());
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          ))}
          {processingResult && (
            <>
              <div className="notice">
                <strong>Review before replacing your reading text</strong>
                <p>
                  The original file and saved quotations are retained. Notes use
                  stable passage references and are flagged if their passage is
                  no longer present.
                </p>
              </div>
              <ImportPreview
                book={{ ...book, chapters: processingResult.chapters }}
              />
              <button
                className="primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onRepair(processingResult.chapters);
                  } catch (e) {
                    setError(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Use this reviewed extraction
              </button>
            </>
          )}
        </>
      )}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
