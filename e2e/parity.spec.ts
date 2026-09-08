import { test, expect } from "@playwright/test";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

// Antialiasing and glyph hinting differ between skia (server) and Chrome, so exact equality is not
// achievable; 3% of pixels is the budget for that, and anything above means a real layout bug.
const MAX_RATIO = 0.03;

for (const m of ["ayah", "kid"]) {
  test(`browser render matches server golden (${m})`, async ({ page }) => {
    await page.goto(`/dev/parity?member=${m}&lang=en`);
    await page.waitForSelector('[data-testid="stage"][data-ready="1"] canvas');
    await page.waitForFunction(() => document.fonts.status === "loaded");

    const shot = PNG.sync.read(
      await page.locator('[data-testid="stage"] canvas').first().screenshot({ omitBackground: true }),
    );
    const gold = PNG.sync.read(readFileSync(`tests/engine/__golden__/collage-en-${m}.png`));
    expect(shot.width).toBe(gold.width);
    expect(shot.height).toBe(gold.height);

    const diff = new PNG({ width: gold.width, height: gold.height });
    const bad = pixelmatch(shot.data, gold.data, diff.data, gold.width, gold.height, { threshold: 0.2 });
    const ratio = bad / (gold.width * gold.height);
    test.info().annotations.push({ type: "mismatch", description: `${(ratio * 100).toFixed(2)}%` });
    if (ratio > MAX_RATIO) {
      mkdirSync("test-results", { recursive: true });
      writeFileSync(`test-results/parity-${m}.actual.png`, PNG.sync.write(shot));
      writeFileSync(`test-results/parity-${m}.diff.png`, PNG.sync.write(diff));
    }
    expect(ratio, `${(ratio * 100).toFixed(2)}% of pixels differ`).toBeLessThan(MAX_RATIO);
  });
}
