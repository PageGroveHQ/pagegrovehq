import { test, expect } from "@playwright/test";
test.use({ serviceWorkers: "block" });
// These tests replace the Firebase adapter, never sign into a real account or read real Drive files.
const backend = `export function createFirebaseBackend(){
 let callback, connected=false; const user={id:'drive-test-reader',email:'reader@example.test',google:true};
 const rows=()=>JSON.parse(localStorage.getItem('test-cloud-rows')||'[]');
 return {start:async cb=>{callback=cb;return localStorage.getItem('test-google-session')?{user}:null},needsEmail:()=>false,
 signInGoogle:async()=>{localStorage.setItem('test-google-session','1');callback({user});return {user}},signOut:async()=>{localStorage.removeItem('test-google-session');callback(null)},
 connectDrive:async()=>{connected=true},disconnectDrive:()=>{connected=false},driveAccess:()=>connected,driveAccessToken:()=>{if(!connected)throw Error('Reconnect Google Drive');return 'test-token'},
 documents:async()=>rows(),write:async(item,payload,revision)=>{const list=rows(),old=list.find(r=>r.kind===item.kind&&r.record_id===item.id);if((old?.revision||0)!==revision)return {accepted:false,document:old};const document={kind:item.kind,record_id:item.id,payload:JSON.parse(JSON.stringify(payload||{})),revision:revision+1,deleted:!!item.deleted};localStorage.setItem('test-cloud-rows',JSON.stringify([...list.filter(r=>r!==old),document]));return {accepted:true,document}}};}`;
async function account(page) {
  await page.getByRole("button", { name: "Open app settings" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Account & sync", exact: true })
    .click();
}
test("blocked Google popup shows a persistent explanation and enables retry", async ({
  page,
}) => {
  const blocked = backend.replace(
    "signInGoogle:async()=>{",
    "signInGoogle:async()=>{const failure=new Error('blocked');failure.code='auth/popup-blocked';throw failure;",
  );
  await page.route("**/assets/firebase-client-*.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: blocked }),
  );
  await page.goto("/");
  await account(page);
  const button = page.getByRole("button", {
    name: "Continue with Google",
    exact: true,
  });
  await button.click();
  await expect(page.getByRole("alert")).toContainText(
    "Allow popups for this Page Grove site",
  );
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.getByRole("alert")).toContainText("regular browser tab");
});
async function rawBook(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open("pagegrovehq-rsvp-library-v1", 2);
      r.onsuccess = () => resolve(r.result);
    });
    const books = await new Promise((resolve) => {
      const r = db.transaction("books").objectStore("books").getAll();
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return books.find((b) => b.driveSource);
  });
}
test("Google account connects a Drive folder, opens transient content, reconnects after reload, and reviews file changes", async ({
  page,
}, testInfo) => {
  let version = 1;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/assets/firebase-client-*.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: backend }),
  );
  await page.route("https://www.googleapis.com/drive/v3/**", (route) => {
    const url = new URL(route.request().url());
    expect(route.request().headers().authorization).toBe("Bearer test-token");
    const file = {
      id: "test-file",
      name: "Cloud reading.txt",
      mimeType: "text/plain",
      size: 50,
      modifiedTime: "version-" + version,
      md5Checksum: "checksum-" + version,
    };
    if (url.searchParams.get("alt") === "media")
      return route.fulfill({
        contentType: "text/plain",
        body:
          version === 1
            ? "One two three four five six seven eight."
            : "One two three four five six seven eight nine ten.",
      });
    const data = url.pathname.endsWith("/books")
      ? {
          id: "books",
          name: "My books",
          mimeType: "application/vnd.google-apps.folder",
        }
      : url.pathname.endsWith("/test-file")
        ? file
        : { files: [file] };
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  });
  await page.goto("/");
  await expect(page.locator(".book-card")).toHaveCount(3);
  await account(page);
  await page
    .getByRole("button", { name: "Continue with Google", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Sync progress & notes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Connect Google Drive", exact: true })
    .click();
  await page
    .getByLabel("Drive books folder link or ID")
    .fill("https://drive.google.com/drive/folders/books");
  await page.getByLabel("Include subfolders").check();
  await page.getByRole("button", { name: "Save folder & sync books" }).click();
  await expect(
    page.getByText("1 supported files · 1 connected · 0 updates to review"),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("drive-account.png"),
    fullPage: true,
  });
  let book = await rawBook(page);
  expect(book.chapters[0].blocks).toHaveLength(0);
  expect(book.driveSource.fileId).toBe("test-file");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(page.locator(".book-card")).toHaveCount(4);
  await page
    .getByRole("button", { name: "Read Cloud reading", exact: true })
    .click();
  await expect(
    page.getByRole("slider", { name: "Book reading position" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".book-card")).toHaveCount(4);
  await account(page);
  await page
    .getByRole("button", { name: "Reconnect Google Drive", exact: true })
    .click();
  await page.getByRole("button", { name: "Sync Drive folder now" }).click();
  await expect(
    page.getByText("1 supported files · 0 connected · 0 updates to review"),
  ).toBeVisible();
  expect((await rawBook(page)).chapters[0].blocks).toHaveLength(0);
  version = 2;
  await page.getByRole("button", { name: "Sync Drive folder now" }).click();
  await expect(
    page.getByText("1 supported files · 0 connected · 1 updates to review"),
  ).toBeVisible();
  book = await rawBook(page);
  expect(book.driveUpdate.checksum).toBe("checksum-2");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  const card = page.locator(".book-card").filter({
    has: page.getByRole("button", {
      name: "Read Cloud reading",
      exact: true,
    }),
  });
  await card.getByRole("button", { name: /Details/ }).click();
  await expect(
    page.getByText("The Drive file changed", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Use updated Drive file", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await rawBook(page)).driveUpdate).toBeNull();
  expect((await rawBook(page)).wordCount).toBe(10);
  expect(errors).toEqual([]);
});
