import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { webcrypto } from "node:crypto";
import { Blob } from "node:buffer";
import { createDriveClient, folderId, FOLDER_MIME } from "./drive-client";
import { makeBook } from "./engine";
import { bookRecord } from "./spark-sync";
const importer = vi.hoisted(() => ({ calls: 0 }));
vi.mock("./importers", () => ({
  importFile: async (file) => {
    importer.calls++;
    return makeBook({
      title: file.name,
      format: "EPUB",
      sourceName: file.name,
      chapters: [
        {
          title: "Reading",
          blocks: [
            {
              type: "paragraph",
              text: "One two three four five six seven eight.",
            },
          ],
        },
      ],
    });
  },
}));
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("crypto", webcrypto);
  importer.calls = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("Drive HTTP client", () => {
  it("paginates folder contents, walks subfolders, skips unsupported files, and sends tokens only to Google", async () => {
    const requests = [];
    const client = createDriveClient(
      () => "session-token",
      async (url, options) => {
        requests.push({ url: new URL(url), options });
        const u = new URL(url);
        const data = u.pathname.endsWith("/books")
          ? { id: "books", mimeType: FOLDER_MIME, name: "Books" }
          : u.searchParams.get("q").includes("'child'")
            ? { files: [{ id: "pdf", name: "Book.pdf" }] }
            : u.searchParams.get("pageToken")
              ? {
                  files: [
                    { id: "child", name: "Child", mimeType: FOLDER_MIME },
                  ],
                }
              : {
                  files: [
                    { id: "epub", name: "Book.epub" },
                    { id: "image", name: "Cover.png" },
                  ],
                  nextPageToken: "next",
                };
        return new Response(JSON.stringify(data), { status: 200 });
      },
    );
    const scan = await client.scan("books", true);
    expect(scan.files.map((f) => f.id)).toEqual(["epub", "pdf"]);
    expect(requests).toHaveLength(4);
    for (const r of requests) {
      expect(r.url.origin).toBe("https://www.googleapis.com");
      expect(r.options.cache).toBe("no-store");
      expect(r.options.headers.Authorization).toBe("Bearer session-token");
      expect(r.url.href).not.toContain("session-token");
    }
  });
  it("accepts folder URLs, rejects query injection, and never treats an incomplete scan as missing files", async () => {
    expect(
      folderId(
        "https://drive.google.com/drive/u/0/folders/my-books?usp=sharing",
      ),
    ).toBe("my-books");
    expect(() => folderId("x' or trashed=true")).toThrow();
    const client = createDriveClient(
      () => "token",
      async () =>
        new Response(JSON.stringify({ incompleteSearch: true, files: [] })),
    );
    await expect(client.children("books")).rejects.toThrow("incomplete");
  });
  it("reports expired access and refuses oversized files before downloading", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 401 }));
    const client = createDriveClient(() => "expired", fetcher);
    await expect(client.file("book")).rejects.toThrow("expired");
    await expect(
      client.download({ id: "book", size: 101 * 1024 * 1024 }),
    ).rejects.toThrow("100 MB");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
describe("Drive library persistence and identity", () => {
  async function setup() {
    const storage = await import("./storage"),
      lib = await import("./drive-library");
    const file = {
      id: "file1",
      name: "My Book.epub",
      modifiedTime: "2026-10-13",
      md5Checksum: "version1",
      size: 20,
    };
    const drive = {
      scan: vi.fn(async () => ({
        folder: { id: "books", name: "Books" },
        files: [file],
      })),
      file: vi.fn(async () => file),
      download: vi.fn(async () => new Blob(["original bytes"])),
    };
    const folder = { id: "books", recursive: true };
    return { storage, lib, file, drive, folder };
  }
  it("keeps a shared Drive file separate across Firebase owners in the same browser", async () => {
    const { storage, lib, drive, folder } = await setup();
    await lib.scanDriveLibrary({ drive, ownerId: "reader-one", folder });
    await lib.scanDriveLibrary({ drive, ownerId: "reader-two", folder });
    const books = await storage.listBooks();
    expect(books).toHaveLength(2);
    expect(new Set(books.map((b) => b.id)).size).toBe(2);
    expect(books.map((b) => b.driveSource.ownerId).sort()).toEqual([
      "reader-one",
      "reader-two",
    ]);
  });
  it("reconnects a synced record by fingerprint, retains notes/position, and persists no full text or original by default", async () => {
    const { storage, lib, drive, folder } = await setup();
    const { fingerprint } = await import("./enhancements");
    const old = makeBook({
      id: "canonical",
      title: "Existing book",
      chapters: [
        {
          title: "Reading",
          blocks: [{ text: "One two three four five six seven eight." }],
        },
      ],
      position: 3,
      sourceHash: await fingerprint(new Blob(["original bytes"])),
    });
    old.bookmarks = [{ id: "note", position: 3, note: "Keep me" }];
    await storage.saveBook({
      ...bookRecord(old),
      chapters: old.chapters.map((c) => ({ ...c, blocks: [] })),
      needsLocalFile: true,
    });
    await lib.scanDriveLibrary({ drive, ownerId: "reader", folder });
    let books = await storage.listBooks();
    expect(books).toHaveLength(1);
    expect(books[0].id).toBe("canonical");
    expect(books[0].position).toBe(3);
    expect(books[0].bookmarks[0].note).toBe("Keep me");
    expect(books[0].chapters[0].blocks).toHaveLength(0);
    expect(await storage.getOriginal("canonical")).toBeUndefined();
    const opened = await lib.openDriveBook(books[0], {
      drive,
      ownerId: "reader",
    });
    expect(opened.chapters[0].blocks[0].id).toBe(old.chapters[0].blocks[0].id);
    expect(opened.position).toBe(3);
    const payload = bookRecord(opened);
    expect(JSON.stringify(payload)).not.toContain("One two three");
    expect(payload.driveSource.fileId).toBe("file1");
    storage.releaseReadingContent("canonical");
    expect((await storage.listBooks())[0].chapters[0].blocks).toHaveLength(0);
    await lib.scanDriveLibrary({ drive, ownerId: "reader", folder });
    expect(importer.calls).toBe(2); // First scan + opening; unchanged scan does not download again.
  });
  it("supports offline copies, protects them across sign-out ownership, and marks missing or changed files without erasing annotations", async () => {
    const { storage, lib, drive, folder, file } = await setup();
    await lib.scanDriveLibrary({ drive, ownerId: "reader", folder });
    let book = (await storage.listBooks())[0];
    await lib.openDriveBook(book, { drive, ownerId: "reader" });
    await storage.setOfflineBook(book.id, true);
    storage.releaseReadingContent();
    book = (await storage.listBooks())[0];
    expect(book.chapters[0].blocks).toHaveLength(1);
    await expect(
      lib.openDriveBook(book, { drive, ownerId: "another" }),
    ).rejects.toThrow("account");
    drive.scan.mockResolvedValue({
      folder: { name: "Books" },
      files: [{ ...file, md5Checksum: "version2" }],
    });
    await lib.scanDriveLibrary({ drive, ownerId: "reader", folder });
    book = (await storage.listBooks())[0];
    expect(book.driveUpdate.checksum).toBe("version2");
    expect(book.chapters[0].blocks).toHaveLength(1);
    await expect(
      lib.openDriveBook(book, { drive, ownerId: "reader" }),
    ).rejects.toThrow("changed");
    drive.scan.mockResolvedValue({ folder: { name: "Books" }, files: [] });
    await lib.scanDriveLibrary({ drive, ownerId: "reader", folder });
    expect((await storage.listBooks())[0].driveSource.missing).toBe(true);
    await storage.deleteBook(book.id);
    drive.scan.mockResolvedValue({ folder: { name: "Books" }, files: [file] });
    await lib.scanDriveLibrary({ drive, ownerId: "reader", folder });
    expect(await storage.listBooks()).toHaveLength(0);
  });
});
