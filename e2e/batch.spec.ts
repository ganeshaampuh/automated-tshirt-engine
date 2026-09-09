import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { config } from "dotenv";
import sharp from "sharp";

// The dev server reads `.env.local`; the test runner does not, so load it here to decide whether a
// database is available at all.
config({ path: ".env.local", quiet: true });

/**
 * The whole batch road: upload a CSV, check it, create the batch, watch the chain draw every set,
 * approve one, export, and take the ZIP link.
 *
 * **No AI image is generated here.** Every fixture row carries a `clipart_url`, so `processSet`
 * skips `generateClipart` — the one call that costs real credits and returns something different
 * every time. The remaining AI calls (the vision caption and the style choice) are best-effort by
 * construction: `describeClipart` swallows a failed caption and `chooseStyle` answers with
 * `fallbackStyle`, so a set reaches `ready` with or without a key. The AI path proper — a generated
 * clipart, a model that answers with rubbish, a model that is down — is covered by the unit tests in
 * `tests/ai/` and `tests/lib/processSet.test.ts` against a mocked provider, which is where a
 * deterministic assertion about the model belongs.
 *
 * The clipart is an inline `data:image/png` built from the bundled `public/samples/unicorn.png`
 * rather than a URL the dev server hosts. That is not a convenience: `src/lib/csv.ts` accepts only
 * `https://` or `data:image/` in `clipart_url`, and `fetchRemoteImage` refuses http, non-standard
 * ports and any host resolving into loopback — so `http://localhost:3000/samples/unicorn.png` is
 * rejected twice over, by design. An inline image is the only clipart a test can hand the batch
 * without reaching the public internet.
 *
 * It does write for real: one batch, three sets, ten previews and a ZIP, into whatever
 * `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN` point at. Until the environments are split that is the
 * shop's own database — see "Known limitations" in the README. That is why a reachable database is
 * not on its own enough to run this: `ALLOW_DB_TESTS=1` has to be set too, so writing into the live
 * shop is always something a human asked for rather than a side effect of having `.env.local`.
 */
const allowed = ["1", "true"].includes((process.env.ALLOW_DB_TESTS ?? "").toLowerCase());

test.describe(() => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL is not set");
  test.skip(!allowed, "ALLOW_DB_TESTS is not set; this spec writes real batches, previews and ZIPs");

  test("uploads a csv, draws every set, approves one and exports a zip", async ({ page }) => {
    // Three sets of ten shirts, each one a 600 px mockup per member, then an export that renders
    // full 300 DPI print PNGs for the approved set. Generous on purpose — this is a whole batch on
    // one dev server — but still bounded, so a chain that never starts fails instead of hanging.
    test.setTimeout(600_000);

    const csv = await buildCsv();

    await page.goto("/batch/new");
    await page.getByTestId("csv-input").setInputFiles({ name: "batch-e2e.csv", mimeType: "text/csv", buffer: csv });

    // The counts come from the committed sample: 3 rows, 4 + 3 + 3 = 10 members.
    await page.getByTestId("check").click();
    await expect(page.getByTestId("report-counts")).toHaveText("3 set, 10 kaos", { timeout: 30_000 });
    await expect(page.getByTestId("report-errors")).toHaveCount(0);

    await page.getByTestId("create").click();
    await expect(page).toHaveURL(/\/batch\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await expect(page.getByTestId("set-card")).toHaveCount(3);

    // The gallery refreshes itself every few seconds while anything is queued or being drawn; poll
    // the cards until nothing is moving. A set that dies leaves `failed`, which is also settled —
    // the assertions after this are what decide whether that is acceptable.
    await expect
      .poll(async () => (await readCards(page)).filter(c => c.status === "queued" || c.status === "processing").length, {
        timeout: 480_000,
        intervals: [3_000],
      })
      .toBe(0);

    const cards = await readCards(page);
    const summary = cards.map(c => `${c.kid}=${c.status}${c.error ? ` (${c.error})` : ""}`).join(" | ");

    // Silence is the failure mode worth guarding: a set may fail, but it must say why, on the card,
    // in a sentence the shop can act on. A `failed` card with no reason is a bug even though the
    // batch "finished".
    for (const card of cards.filter(c => c.status === "failed")) {
      expect(card.error, `set ${card.kid} failed with no reason shown`).not.toBe("");
    }
    // And at least one set has to have come out drawable, or there is nothing to approve. The
    // message carries every card's verdict so a red run says what actually went wrong.
    expect(cards.filter(c => c.status === "ready").length, `no set reached ready — ${summary}`).toBeGreaterThan(0);

    const ready = page.locator('[data-testid="set-card"][data-status="ready"]').first();
    await ready.getByTestId("approve").click();
    await expect(page.locator('[data-testid="set-card"][data-status="approved"]')).toHaveCount(1, { timeout: 60_000 });

    await page.getByTestId("export-zip").click();
    const zip = page.getByTestId("download-zip");
    await expect(zip).toBeVisible({ timeout: 300_000 });
    expect(await zip.getAttribute("href")).toMatch(/\.zip$/);
  });
});

type Card = { kid: string; status: string | null; error: string };

/** Every card's verdict and, if it has one, the sentence it is showing the shop. */
async function readCards(page: Page): Promise<Card[]> {
  return page.locator('[data-testid="set-card"]').evaluateAll(nodes =>
    nodes.map(node => ({
      kid: node.querySelector("h2")?.textContent?.trim() ?? "?",
      status: node.getAttribute("data-status"),
      error: node.querySelector('[data-testid="set-error"]')?.textContent?.trim() ?? "",
    })),
  );
}

/**
 * The committed sample with a `clipart_url` column bolted on. Deriving it here rather than
 * committing a second CSV keeps the 3-sets/10-shirts assertion tied to the fixture the unit tests
 * read, and keeps ~30 KB of base64 out of the repository.
 */
async function buildCsv(): Promise<Buffer> {
  // Downscaled so the upload stays small; nothing here asserts on print resolution.
  const png = await sharp("public/samples/unicorn.png").resize({ width: 240 }).png({ compressionLevel: 9, palette: true }).toBuffer();
  const clipart = `data:image/png;base64,${png.toString("base64")}`;
  const [header, ...rows] = readFileSync("tests/fixtures/batch-sample.csv", "utf8").trim().split("\n");
  return Buffer.from([`${header},clipart_url`, ...rows.map(r => `${r},"${clipart}"`)].join("\n"), "utf8");
}
