import { test, expect } from "@playwright/test";
import { config } from "dotenv";

// The dev server reads `.env.local`; the test runner does not, so load it here to decide whether a
// database is available at all.
config({ path: ".env.local", quiet: true });

// The editor reads and writes real rows, so it needs a database. A bare checkout has none.
test.describe(() => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL is not set");

  test("creates a set, uploads a clipart, edits it and exports a zip", async ({ page }) => {
    // Export renders a print PNG plus a mockup per member; that is minutes, not seconds.
    test.setTimeout(300_000);

    await page.goto("/set/new");
    await expect(page).toHaveURL(/\/set\/[0-9a-f-]{36}$/);

    await page.getByTestId("kid-name").fill("Keisya");

    await page.getByTestId("clipart-upload").setInputFiles("public/samples/unicorn.png");
    await expect(page.getByTestId("canvas").locator("canvas")).toBeVisible({ timeout: 60_000 });

    // The birthday kid's tab follows the name, and its readout reports the kids print limit.
    await page.getByRole("tab", { name: "Keisya" }).click();
    await expect(page.getByTestId("size-readout")).toContainText("max 20 cm");

    await expect(page.getByTestId("save-status")).toHaveText("Tersimpan", { timeout: 30_000 });

    await page.getByTestId("export").click();
    const zip = page.getByTestId("export-link");
    await expect(zip).toBeVisible({ timeout: 240_000 });
    expect(await zip.getAttribute("href")).toMatch(/\.zip$/);
  });
});
