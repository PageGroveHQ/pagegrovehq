import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
test("legacy records without fingerprints can be explicitly reconnected during import", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".book-card")).toHaveCount(3);
  await page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open("pagegrovehq-rsvp-library-v1", 2);
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction("books", "readwrite");
      tx.objectStore("books").put({
        id: "legacy-harlem",
        title: "Harlem Shuffle",
        author: "Test author",
        format: "TXT",
        sourceHash: "",
        wordCount: 8,
        position: 3,
        chapters: [{ id: "old-chapter", title: "Reading", blocks: [] }],
        chapterSummaries: [{ id: "old-chapter", title: "Reading" }],
        needsLocalFile: true,
        localOnly: true,
        bookmarks: [
          {
            id: "saved-note",
            position: 3,
            note: "Keep this note",
            createdAt: 1,
          },
        ],
        highlights: [],
        sessions: [],
        tags: [],
        collection: "",
        addedAt: 1,
        lastRead: 1,
        readingStatus: "reading",
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  await expect(page.locator(".book-card")).toHaveCount(4);
  await page.getByRole("button", { name: "Add a book", exact: true }).click();
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "Harlem Shuffle.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("One two three four five six seven eight."),
    });
  await page
    .getByLabel("Connect to an older synced record")
    .selectOption("legacy-harlem");
  await expect(page.getByText("Reconnecting your saved reading")).toBeVisible();
  await page.getByRole("button", { name: "Add to my library" }).click();
  await expect(page.locator(".book-card")).toHaveCount(4);
  await page
    .getByRole("button", { name: "Read Harlem Shuffle", exact: true })
    .click();
  await expect(
    page.getByRole("slider", { name: "Book reading position" }),
  ).toHaveValue("3");
});
test("Spark account screen explains local files and optional private sync", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open app settings" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Account & sync", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Email me a sign-in link" }),
  ).toBeVisible();
  await expect(page.getByText(/Book files stay on the device/)).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Also sync original uploaded files" }),
  ).toHaveCount(0);
});
test("re-importing a synced file reconnects its position without a duplicate book", async ({
  page,
}) => {
  const text = "One two three four five six seven eight.",
    hash = createHash("sha256").update(text).digest("hex");
  await page.goto("/");
  await expect(page.locator(".book-card")).toHaveCount(3);
  await page.evaluate(async (hash) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("pagegrovehq-rsvp-library-v1", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const record = {
      id: "shared-book",
      title: "Synced reading",
      author: "Me",
      format: "TXT",
      sourceHash: hash,
      wordCount: 8,
      position: 2,
      chapters: [{ id: "shared-chapter", title: "Reading", blocks: [] }],
      chapterSummaries: [
        {
          id: "shared-chapter",
          title: "Reading",
          wordCount: 8,
          blocks: [{ id: "shared-passage", type: "paragraph" }],
        },
      ],
      needsLocalFile: true,
      localOnly: true,
      bookmarks: [],
      highlights: [],
      sessions: [],
      tags: [],
      collection: "",
      addedAt: Date.now(),
      lastRead: Date.now(),
      readingStatus: "reading",
      completed: false,
    };
    await new Promise((resolve, reject) => {
      const tx = db.transaction("books", "readwrite");
      tx.objectStore("books").put(record);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, hash);
  await page.reload();
  await expect(page.locator(".book-card")).toHaveCount(4);
  await page.getByRole("button", { name: "Add a book", exact: true }).click();
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "shared.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(text),
    });
  await page.getByRole("button", { name: "Add to my library" }).click();
  await expect(page.locator(".book-card")).toHaveCount(4);
  await page
    .getByRole("button", { name: "Read Synced reading", exact: true })
    .click();
  await expect(
    page.getByRole("slider", { name: "Book reading position" }),
  ).toHaveValue("2");
});
