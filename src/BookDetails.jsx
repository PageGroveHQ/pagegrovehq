import React, { useState, useRef } from "react";
import {
  BookOpen,
  Download,
  Trash2,
  Pencil,
  ImagePlus,
  ArrowRight,
} from "lucide-react";
import { Cover, Dialog, DownloadLink } from "./components";
import { ProfilesPanel } from "./FeaturePanels";
import { cleanSettings } from "./engine";
import { patchBook } from "./storage";
import * as cloud from "./cloud";
export default function BookDetails({
  book,
  books,
  original,
  collections,
  settings,
  onClose,
  onOpen,
  onRepair,
  onDelete,
  onChanged,
  notify,
}) {
  const [title, setTitle] = useState(book.title),
    [author, setAuthor] = useState(book.author),
    [description, setDescription] = useState(book.description || ""),
    [tags, setTags] = useState((book.tags || []).join(", ")),
    [collection, setCollection] = useState(book.collection),
    [status, setStatus] = useState(book.readingStatus || "ready"),
    [cover, setCover] = useState(book.cover),
    [override, setOverride] = useState(book.readingSettings),
    [busy, setBusy] = useState(false),
    [offline, setOffline] = useState(!!book.offlineAvailable);
  const input = useRef();
  async function save(e) {
    e?.preventDefault();
    setBusy(true);
    try {
      await patchBook(book.id, {
        title: title.trim() || book.title,
        author: author.trim() || "Unknown author",
        description,
        tags: [
          ...new Set(
            tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
          ),
        ].slice(0, 20),
        collection: collection.trim(),
        readingStatus: status,
        completed: status === "finished",
        cover,
        readingSettings: override,
      });
      await onChanged();
      onClose();
      notify("Book details updated.");
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function coverFile(file) {
    if (!file) return;
    try {
      if (
        !/^image\/(png|jpeg|webp|gif)$/.test(file.type) ||
        file.size > 10 * 1024 * 1024
      )
        throw new Error(
          "Choose a PNG, JPEG, WebP, or GIF image smaller than 10 MB.",
        );
      const image = await createImageBitmap(file);
      const ratio = Math.min(1, 900 / Math.max(image.width, image.height)),
        canvas = document.createElement("canvas");
      canvas.width = Math.ceil(image.width * ratio);
      canvas.height = Math.ceil(image.height * ratio);
      canvas
        .getContext("2d")
        .drawImage(image, 0, 0, canvas.width, canvas.height);
      image.close();
      setCover(canvas.toDataURL("image/webp", 0.85));
    } catch (e) {
      notify(e.message);
    }
  }
  async function move(direction) {
    const sorted = [...books].sort(
      (a, b) => (a.shelfOrder || a.addedAt) - (b.shelfOrder || b.addedAt),
    );
    const index = sorted.findIndex((b) => b.id === book.id),
      other = sorted[index + direction];
    if (!other) return;
    try {
      [sorted[index], sorted[index + direction]] = [
        sorted[index + direction],
        sorted[index],
      ];
      for (let i = 0; i < sorted.length; i++)
        await patchBook(sorted[i].id, { shelfOrder: (i + 1) * 1024 });
      await onChanged();
      notify(
        "Shelf order updated. Choose “Shelf order” in the library sort menu to see it.",
      );
    } catch (e) {
      notify(e.message);
    }
  }
  return (
    <Dialog title="A closer look" onClose={onClose} wide>
      <div className="book-detail-hero">
        <Cover book={{ ...book, title, author, cover }} />
        <div>
          <span className="eyebrow">
            {book.format} · {book.wordCount.toLocaleString()} WORDS
          </span>
          <h2>{title}</h2>
          <p>{author}</p>
          <p className="muted">
            {book.chapters.length} sections · ~
            {Math.ceil(book.wordCount / settings.wpm)} minutes at your base pace
          </p>
          {book.demo && (
            <p className="muted">
              Public-domain sample excerpt, not the complete book.
            </p>
          )}
          {book.cloudContentPath && (
            <div className="notice">
              <strong>
                {offline ? "Available offline" : "Stored privately in Firebase"}
              </strong>
              <p>
                {offline
                  ? "This device keeps a full copy for offline reading."
                  : "Downloaded when opened. Full book content is not kept on this device."}
              </p>
              <button
                className="secondary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await cloud.keepBookOffline(book, !offline);
                    setOffline(!offline);
                    await onChanged();
                  } catch (e) {
                    notify(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {offline ? "Remove offline copy" : "Keep available offline"}
              </button>
            </div>
          )}
          <button className="primary" onClick={() => onOpen(book)}>
            <BookOpen size={17} />
            Open reader
          </button>
          <button className="text-button" onClick={() => input.current.click()}>
            <ImagePlus size={16} />
            Choose a cover
          </button>
          <input
            ref={input}
            type="file"
            hidden
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(e) => {
              coverFile(e.target.files[0]);
              e.target.value = "";
            }}
          />
        </div>
      </div>
      <form onSubmit={save}>
        <div className="two-fields">
          <label className="field">
            Title
            <input
              required
              maxLength="500"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="field">
            Author
            <input
              maxLength="500"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
            />
          </label>
        </div>
        <label className="field">
          Description
          <textarea
            rows="3"
            maxLength="5000"
            value={description}
            placeholder="What draws you into this book?"
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <div className="two-fields">
          <label className="field">
            Collection
            <input
              list="collection-names"
              maxLength="100"
              value={collection}
              onChange={(e) => setCollection(e.target.value)}
              placeholder="e.g. Evening reads"
            />
            <datalist id="collection-names">
              {collections.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </datalist>
          </label>
          <label className="field">
            Reading status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="ready">Ready to begin</option>
              <option value="want">Want to read</option>
              <option value="reading">In progress</option>
              <option value="finished">Finished</option>
            </select>
          </label>
        </div>
        <label className="field">
          Tags
          <input
            aria-label="Tags"
            value={tags}
            maxLength="1200"
            placeholder="fiction, learning, evening"
            onChange={(e) => setTags(e.target.value)}
          />
          <small className="muted">Separate tags with commas.</small>
        </label>
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save details"}
        </button>
      </form>
      <ProfilesPanel
        settings={override || settings}
        onChange={(patch) =>
          setOverride(cleanSettings({ ...(override || settings), ...patch }))
        }
        book={{ ...book, readingSettings: override }}
        onBookSettings={setOverride}
      />
      <div className="section-title">
        <h2>Inside the book</h2>
        <button className="text-button" onClick={onRepair}>
          <Pencil size={15} />
          Repair extracted text
        </button>
      </div>
      <div className="detail-chapters">
        {book.chapters.map((c, i) => (
          <button
            key={c.id}
            onClick={() => {
              const first = book.chapters
                .slice(0, i)
                .reduce(
                  (n, x) =>
                    n +
                    x.blocks
                      .filter(
                        (b) =>
                          b.type !== "image" &&
                          b.type !== "table" &&
                          !b.excluded &&
                          !x.excluded,
                      )
                      .reduce(
                        (m, b) => m + (b.text.match(/\S+/g) || []).length,
                        0,
                      ),
                  0,
                );
              onOpen(book, Math.min(first, book.wordCount - 1));
            }}
          >
            <span>{String(i + 1).padStart(2, "0")}</span>
            {c.title}
            {c.excluded && <small>excluded</small>}
            <ArrowRight size={14} />
          </button>
        ))}
      </div>
      <div className="details-actions">
        {original && (
          <DownloadLink
            blob={original}
            filename={book.sourceName || "original-book"}
            className="secondary"
          >
            <Download size={16} />
            Original file
          </DownloadLink>
        )}
        <button className="secondary" onClick={() => move(-1)}>
          Earlier on shelf
        </button>
        <button className="secondary" onClick={() => move(1)}>
          Later on shelf
        </button>
        <button className="text-button danger" onClick={onDelete}>
          <Trash2 size={16} />
          Remove book
        </button>
      </div>
    </Dialog>
  );
}
