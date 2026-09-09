import { test, expect } from "@playwright/test";
import { config } from "dotenv";

// The dev server reads `.env.local`; the test runner does not, so load it here to decide whether a
// database is available at all.
config({ path: ".env.local", quiet: true });

// The editor reads and writes real rows, so it needs a database. A bare checkout has none. It also
// writes them into whatever database `DATABASE_URL` points at, which today is the same one
// production uses, so a database is necessary but not sufficient: `ALLOW_DB_TESTS=1` has to be set
// too. See the same guard in `batch.spec.ts`.
const allowed = ["1", "true"].includes((process.env.ALLOW_DB_TESTS ?? "").toLowerCase());

test.describe(() => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL is not set");
  test.skip(!allowed, "ALLOW_DB_TESTS is not set; this spec writes real sets, previews and ZIPs");

  test("creates a set, uploads a clipart, edits it and exports a zip", async ({ page }) => {
    // Export renders a print PNG plus a mockup per member. A four-member set measures ~1.3 s, so
    // the budget below is slack for a cold server, not an expectation — it has to stay tight
    // enough that a real regression trips it.
    test.setTimeout(120_000);

    // The draft is created by a POST from the home page, never by opening a URL.
    await page.goto("/");
    await page.getByRole("button", { name: "Buat set baru" }).click();
    await expect(page).toHaveURL(/\/set\/[0-9a-f-]{36}$/);

    await page.getByTestId("kid-name").fill("Keisya");

    // One history for the whole editor: the shortcuts work with the caret still in a text field.
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.getByTestId("kid-name")).toHaveValue("Anak");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(page.getByTestId("kid-name")).toHaveValue("Keisya");

    await page.getByTestId("clipart-upload").setInputFiles("public/samples/unicorn.png");
    await expect(page.getByTestId("canvas").locator("canvas")).toBeVisible({ timeout: 60_000 });

    // The birthday kid's tab follows the name, and its readout reports the kids print limit.
    await page.getByRole("tab", { name: "Keisya" }).click();
    await expect(page.getByTestId("size-readout")).toContainText("max 20 cm");

    await expect(page.getByTestId("save-status")).toHaveText("Tersimpan", { timeout: 30_000 });

    await page.getByTestId("export").click();
    const zip = page.getByTestId("export-link");
    await expect(zip).toBeVisible({ timeout: 60_000 });
    expect(await zip.getAttribute("href")).toMatch(/\.zip$/);
  });
});
