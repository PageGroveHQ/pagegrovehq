import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.route("**/cloud-config.json", (route) =>
    route.fulfill({
      json: { enabled: false, provider: "firebase", bookStorage: "device" },
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your library." }),
  ).toBeVisible();
});
async function addText(page, title = "A thoughtful morning") {
  await page.getByRole("button", { name: "Add a book", exact: true }).click();
  await page.getByRole("button", { name: "Paste text", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page
    .getByLabel("Your text")
    .fill(
      "A quiet morning begins beside the grove. The trees are green and the sky is clear.\n\nAnother paragraph gives us something to highlight. We can return whenever we like.",
    );
  await page.getByRole("button", { name: "Preview reading" }).click();
  await page.getByRole("button", { name: "Add to my library" }).click();
  await expect(
    page.getByRole("button", { name: `Read ${title}`, exact: true }),
  ).toBeVisible();
}
async function nav(page, name) {
  await page
    .locator("nav:visible")
    .getByRole("button", { name: new RegExp("^" + name + "(?: \\d+)?$") })
    .click();
}
test("reading desk, profiles, phrase playback and session insights", async ({
  page,
}, info) => {
  await nav(page, info.project.name === "mobile" ? "Desk" : "Reading desk");
  await expect(
    page.getByRole("heading", { name: /Welcome back to/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/desk-${info.project.name}.png`,
    fullPage: true,
  });
  await nav(page, "Library");
  await addText(page);
  await page
    .getByRole("button", { name: "Read A thoughtful morning", exact: true })
    .click();
  await page.getByRole("button", { name: "Reader settings" }).click();
  await page.getByLabel("Choose a reading profile").selectOption("study");
  await expect(
    page
      .getByRole("dialog")
      .getByRole("spinbutton", { name: "Words per minute" }),
  ).toHaveValue("200");
  await page.getByLabel("Countdown before playing").uncheck();
  await page.getByLabel("Replay sentence on resume").uncheck();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.locator(".rsvp-segment")).toHaveText("A quiet morning");
  await page.getByRole("button", { name: "Play reading" }).click();
  await page.waitForTimeout(1150);
  await page.getByRole("button", { name: "Pause reading" }).click();
  expect(
    +(await page
      .getByRole("slider", { name: "Book reading position" })
      .inputValue()),
  ).toBeGreaterThanOrEqual(3);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "Open app settings" }).click();
  await page.getByLabel("New profile name").fill("My unhurried study");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(
    page.getByLabel("Choose a reading profile").locator("option"),
  ).toHaveCount(6);
  await page.getByRole("button", { name: "Close dialog" }).click();
  if (info.project.name === "desktop") {
    await nav(page, "Insights");
    await expect(page.locator(".session-history article")).toHaveCount(1);
    await page.screenshot({
      path: "test-results/insights-desktop.png",
      fullPage: true,
    });
  }
});
test("highlights, editable notebook, export and repaired-text references", async ({
  page,
}, info) => {
  await addText(page);
  await page
    .getByRole("button", { name: "Read A thoughtful morning", exact: true })
    .click();
  await page.getByRole("button", { name: "Highlight this passage" }).click();
  await page
    .getByLabel("Your note", { exact: true })
    .fill("Remember the quiet morning.");
  await page
    .getByRole("button", { name: "Save highlight", exact: true })
    .click();
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await nav(page, "Notebook");
  await expect(
    page.getByText("Remember the quiet morning.", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/notebook-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Edit saved note" }).click();
  await page
    .getByLabel("Your note", { exact: true })
    .fill("An edited thought.");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("An edited thought.", { exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export notebook" }).click();
  expect((await download).suggestedFilename()).toBe("page-grove-notebook.md");
  await nav(page, "Library");
  await page
    .getByRole("button", { name: "Details for A thoughtful morning" })
    .click();
  await page
    .getByRole("button", { name: "Repair extracted text", exact: true })
    .click();
  await page.getByRole("button", { name: "Move passage 1 down" }).click();
  await page.getByRole("button", { name: "Save repaired text" }).click();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await nav(page, "Notebook");
  await page.getByRole("button", { name: "Return to passage" }).click();
  await expect(page.locator(".word-prefix")).toHaveText("");
  await expect(page.locator(".word-anchor")).toHaveText("A");
});
test("multiple imports flag duplicates and preserve queue behavior", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add a book", exact: true }).click();
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles([
      {
        name: "one.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("A first file has a story."),
      },
      {
        name: "two.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("A second file has another story."),
      },
    ]);
  await page.getByRole("button", { name: "Add to my library" }).click();
  await expect(
    page.getByRole("heading", { name: "two", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add to my library" }).click();
  await expect(page.locator(".book-card")).toHaveCount(5);
  await page.getByRole("button", { name: "Add a book", exact: true }).click();
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "one.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("A first file has a story."),
    });
  await expect(
    page.getByText("This file is already on your shelf"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Choose another" }).click();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.locator(".book-card")).toHaveCount(5);
});
test("dictionary lookup, saved vocabulary and offline cached definitions", async ({
  page,
  context,
}) => {
  await page.route("https://api.dictionaryapi.dev/**", (route) =>
    route.fulfill({
      json: [
        {
          word: "grove",
          phonetic: "/ɡrəʊv/",
          meanings: [
            {
              partOfSpeech: "noun",
              definitions: [{ definition: "A small group of trees." }],
            },
          ],
          sourceUrls: ["https://en.wiktionary.org/wiki/grove"],
        },
      ],
    }),
  );
  await page
    .getByRole("button", { name: "Read The Secret Garden", exact: true })
    .click();
  await page.getByRole("button", { name: "Reading tools" }).click();
  await page.getByLabel("Dictionary word").fill("grove");
  await page.getByRole("button", { name: "Look up", exact: true }).click();
  await expect(
    page.getByText("A small group of trees.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save to vocabulary" }).click();
  await page.getByRole("button", { name: "Vocabulary", exact: true }).click();
  await page
    .getByRole("button", { name: "Review a word", exact: true })
    .click();
  await page.getByRole("button", { name: "Show definition" }).click();
  await page.getByRole("button", { name: "I remembered it" }).click();
  await page.getByRole("button", { name: "Dictionary", exact: true }).click();
  await context.setOffline(true);
  await page.getByRole("button", { name: "Look up", exact: true }).click();
  await expect(page.getByText("CACHED ON THIS DEVICE")).toBeVisible();
  await context.setOffline(false);
  await page
    .getByRole("button", { name: "Reading assistant", exact: true })
    .click();
  await expect(
    page.getByText(/not enabled on this deployment yet/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Document tools", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Request background OCR" }),
  ).toBeDisabled();
});
test("book status, tags, custom shelves and disabled cloud are clear", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Details for The Secret Garden" })
    .click();
  await page.getByLabel("Tags", { exact: true }).fill("evening, garden");
  await page.getByLabel("Reading status").selectOption("want");
  await page.getByLabel("Collection", { exact: true }).fill("Quiet evenings");
  await page.getByRole("button", { name: "Save details", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Search your library" })
    .fill("evening");
  await expect(page.locator(".book-card")).toHaveCount(1);
  await nav(page, "Collections");
  await expect(
    page.getByRole("heading", { name: "Quiet evenings", exact: true }),
  ).toBeVisible();
  await page.getByLabel("New shelf name").fill("Learning");
  await page.getByRole("button", { name: "Create shelf", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Learning", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open app settings" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Account & sync", exact: true })
    .click();
  await expect(
    page.getByText("Cloud accounts are not enabled on this deployment"),
  ).toBeVisible();
});
