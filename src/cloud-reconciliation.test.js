import { describe, it, expect, vi, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { webcrypto, createHash } from "node:crypto";
import { Blob } from "node:buffer";
import { makeBook } from "./engine";
import { sampleBooks } from "./samples";
import { bookRecord } from "./spark-sync";
const server = vi.hoisted(() => ({ rows: new Map() }));
vi.mock("./firebase-client", () => ({
  createFirebaseBackend: () => ({
    start: async () => ({
      user: { id: "reader", email: "reader@example.test" },
    }),
    documents: async () => structuredClone([...server.rows.values()]),
    write: async (item, payload, revision) => {
      const key = `${item.kind}:${item.id}`,
        old = server.rows.get(key);
      if ((old?.revision || 0) !== revision)
        return { accepted: false, document: structuredClone(old) };
      const document = {
        kind: item.kind,
        record_id: item.id,
        payload: JSON.parse(JSON.stringify(payload || {})),
        revision: revision + 1,
        deleted: !!item.deleted,
      };
      server.rows.set(key, document);
      return { accepted: true, document: structuredClone(document) };
    },
  }),
}));
async function device() {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("fetch", async () => ({
    json: async () => ({
      enabled: true,
      bookStorage: "device",
      firebase: {
        projectId: "test",
        apiKey: "public",
        storageBucket: "unused",
      },
    }),
  }));
  vi.spyOn(window, "addEventListener").mockImplementation(() => {});
  const storage = await import("./storage"),
    cloud = await import("./cloud");
  await cloud.initializeCloud();
  return { storage, cloud };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("two-device Spark sync, including migration and late file attachment", () => {
  it("backfills legacy hashes, joins local imports to cloud IDs, and retires duplicates without losing files or notes", async () => {
    server.rows.clear();
    const text = "One two three four five six seven eight.";
    const original = makeBook({
      id: "harlem-original",
      title: "Harlem Shuffle",
      author: "Test author",
      chapters: [{ title: "Reading", blocks: [{ type: "paragraph", text }] }],
    });
    original.position = 2;
    original.bookmarks = [
      {
        id: "original-note",
        position: 2,
        note: "Keep my synced note",
        createdAt: 1,
      },
    ];
    const old = {
      kind: "book",
      record_id: original.id,
      payload: bookRecord(original),
      revision: 1,
      deleted: false,
    };
    server.rows.set("book:" + original.id, old);
    server.rows.set("book:preexisting-duplicate", {
      ...structuredClone(old),
      record_id: "preexisting-duplicate",
      payload: {
        ...old.payload,
        id: "preexisting-duplicate",
        sourceHash: createHash("sha256").update(text).digest("hex"),
        addedAt: original.addedAt + 1000,
        position: 4,
      },
    });
    const a = await device();
    await a.storage.addBook(original, new Blob([text]));
    await a.storage.setMeta("cloud-bases:reader", {
      "book:harlem-original": old,
    });
    for (const [i, b] of sampleBooks().entries()) {
      b.id = "legacy-device-a-" + i;
      await a.storage.addBook(b);
    }
    await a.cloud.enableSync(false);
    expect(a.cloud.cloudState().error).toBe("");
    expect(server.rows.get("book:preexisting-duplicate").deleted).toBe(true);
    const hash = server.rows.get("book:harlem-original").payload.sourceHash;
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    const b = await device();
    for (const [i, sample] of sampleBooks().entries()) {
      sample.id = "legacy-device-b-" + i;
      await b.storage.addBook(sample);
    }
    const imported = makeBook({
      id: "local-import",
      title: original.title,
      author: original.author,
      chapters: [{ title: "Reading", blocks: [{ type: "paragraph", text }] }],
    });
    await b.storage.addBook(imported, new Blob([text]));
    await b.cloud.enableSync(false);
    expect(b.cloud.cloudState().error).toBe("");
    expect(b.cloud.cloudState().conflicts).toEqual([]);
    let books = await b.storage.listBooks();
    expect(books).toHaveLength(4);
    const connected = books.find((x) => x.id === "harlem-original");
    expect(connected.position).toBe(2);
    expect(connected.needsLocalFile).toBe(false);
    expect(connected.bookmarks.some((n) => n.id === "original-note")).toBe(
      true,
    );
    expect(connected.chapters[0].blocks[0].text).toBe(text);
    expect(await b.storage.getOriginal("harlem-original")).toBeTruthy();
    expect(await b.storage.getOriginal("local-import")).toBeTruthy();
    expect(
      (await b.storage.getMeta("recovered-sync-copies")).some(
        (x) => x.id === "local-import",
      ),
    ).toBe(true);
    expect(
      [...server.rows.values()].filter((r) => r.kind === "book" && !r.deleted),
    ).toHaveLength(4);
    const duplicate = {
      ...structuredClone(server.rows.get("book:harlem-original")),
      record_id: "duplicate-harlem",
      revision: 1,
      payload: {
        ...bookRecord(connected),
        id: "duplicate-harlem",
        addedAt: Date.now() + 1000,
        position: 4,
        bookmarks: [
          {
            id: "other-note",
            position: 4,
            note: "Preserve this too",
            createdAt: 2,
          },
        ],
      },
    };
    server.rows.set("book:duplicate-harlem", duplicate);
    await b.cloud.syncLibrary();
    expect(b.cloud.cloudState().error).toBe("");
    books = await b.storage.listBooks();
    expect(books).toHaveLength(4);
    expect(
      books.find((x) => x.id === "harlem-original").bookmarks.map((x) => x.id),
    ).toEqual(
      expect.arrayContaining([
        "original-note",
        "other-note",
        "recovered-position-duplicate-harlem-4",
      ]),
    );
    expect(server.rows.get("book:duplicate-harlem").deleted).toBe(true);
    expect(
      server.rows.get("book:duplicate-harlem").payload.syncRedirectTo,
    ).toBe("harlem-original");
    expect(
      books.find((x) => x.id === "harlem-original").chapters[0].blocks[0].text,
    ).toBe(text);
  });
});
