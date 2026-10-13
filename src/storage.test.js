import "fake-indexeddb/auto";
import { openDB } from "idb";
import { describe, it, expect } from "vitest";
import { makeBook, DEFAULT_SETTINGS } from "./engine";
describe("existing library migration and durable outbox", () => {
  it("upgrades the original database without removing books or positions", async () => {
    const old = await openDB("pagegrovehq-rsvp-library-v1", 1, {
      upgrade(db) {
        db.createObjectStore("books", { keyPath: "id" });
        db.createObjectStore("originals");
        db.createObjectStore("meta");
      },
    });
    await old.put("books", {
      id: "legacy",
      title: "My original book",
      author: "Me",
      chapters: [
        {
          title: "Reading",
          blocks: [
            { type: "paragraph", text: "This old library remains safe." },
          ],
        },
      ],
      position: 2,
      bookmarks: [],
      wordCount: 5,
      addedAt: 1,
    });
    old.close();
    const storage = await import("./storage");
    const b = (await storage.listBooks())[0];
    expect(b.id).toBe("legacy");
    expect(b.position).toBe(2);
    expect(b.chapters[0].blocks[0].id).toBeTruthy();
    expect(b.highlights).toEqual([]);
  });
  it("does not acknowledge a newer offline mutation with an older network response", async () => {
    const s = await import("./storage");
    await s.queueLibrary("user-one");
    const book = makeBook({
      id: "queue-book",
      title: "Queue test",
      chapters: [
        {
          title: "One",
          blocks: [{ type: "paragraph", text: "One two three." }],
        },
      ],
    });
    await s.addBook(book);
    const first = (await s.pendingChanges("user-one")).find(
      (x) => x.id === book.id,
    );
    await s.patchBook(book.id, { position: 2 });
    await s.acknowledgeChange(first);
    const remaining = (await s.pendingChanges("user-one")).find(
      (x) => x.id === book.id,
    );
    expect(remaining).toBeTruthy();
    expect(remaining.generation).not.toBe(first.generation);
    await s.acknowledgeChange(remaining);
    expect(
      (await s.pendingChanges("user-one")).some((x) => x.id === book.id),
    ).toBe(false);
  });
  it("keeps merged annotations when a stale reader saves, while honoring tombstones", async () => {
    const s = await import("./storage");
    await s.patchBook("queue-book", {
      bookmarks: [
        { id: "a", position: 0, note: "One" },
        { id: "b", position: 1, note: "Two" },
      ],
    });
    await s.patchBook("queue-book", {
      bookmarks: [{ id: "a", position: 0, note: "Edited" }],
    });
    expect(
      (await s.listBooks()).find((b) => b.id === "queue-book").bookmarks,
    ).toHaveLength(2);
    await s.patchBook("queue-book", {
      bookmarks: [{ id: "a", position: 0, note: "Edited" }],
      annotationTombstones: [{ id: "b", deletedAt: Date.now() }],
    });
    expect(
      (await s.listBooks())
        .find((b) => b.id === "queue-book")
        .bookmarks.map((m) => m.id),
    ).toEqual(["a"]);
  });
  it("keeps queues separated by signed-in owner", async () => {
    const s = await import("./storage");
    await s.queueLibrary("user-two");
    await s.saveSettings(DEFAULT_SETTINGS);
    expect((await s.pendingChanges("user-two")).length).toBeGreaterThan(0);
    expect(
      (await s.pendingChanges("user-one")).every(
        (x) => x.userId === "user-one",
      ),
    ).toBe(true);
  });
  it("clears uploaded book text and originals from disk, with offline copies opt-in", async () => {
    const s = await import("./storage");
    const book = makeBook({
      id: "cloud-book",
      title: "Cloud storage",
      chapters: [
        {
          title: "One",
          blocks: [
            {
              type: "paragraph",
              text: "Only keep this book when I choose offline.",
            },
          ],
        },
      ],
    });
    await s.addBook(book, new Blob(["original file"]));
    const pending = (await s.pendingChanges("user-two")).find(
      (x) => x.id === book.id,
    );
    if (pending) await s.acknowledgeChange(pending);
    await s.markCloudBook(
      book.id,
      "user-two",
      "user-two/cloud-book/hash.json",
      true,
    );
    const db = await openDB("pagegrovehq-rsvp-library-v1", 2);
    expect((await db.get("books", book.id)).chapters[0].blocks).toEqual([]);
    expect(await s.getOriginal(book.id)).toBeUndefined();
    expect(
      (await s.listBooks()).find((b) => b.id === book.id).chapters[0].blocks,
    ).toHaveLength(1);
    await s.setOfflineBook(book.id, true);
    expect((await db.get("books", book.id)).chapters[0].blocks).toHaveLength(1);
    await s.setOfflineBook(book.id, false);
    s.releaseReadingContent(book.id);
    expect(
      (await s.listBooks()).find((b) => b.id === book.id).chapters[0].blocks,
    ).toEqual([]);
    db.close();
  });
  it("retains unsynced contents when a newer edit is waiting for upload", async () => {
    const s = await import("./storage");
    await s.queueLibrary("race-owner");
    const book = makeBook({
      id: "upload-race",
      title: "Preserve my changes",
      chapters: [
        {
          title: "One",
          blocks: [
            { type: "paragraph", text: "My unsynced changes must survive." },
          ],
        },
      ],
    });
    await s.addBook(book, new Blob(["original"]));
    await s.markCloudBook(
      book.id,
      "race-owner",
      "race-owner/upload-race/hash.json",
      true,
    );
    s.releaseReadingContent(book.id);
    expect(
      (await s.listBooks()).find((b) => b.id === book.id).chapters[0].blocks,
    ).toHaveLength(1);
    expect(await s.getOriginal(book.id)).toBeTruthy();
  });
});
