import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    // Konva multiplies by devicePixelRatio; force 1 so a canvas screenshot is exactly canvas.w * scale px.
    ...devices["Desktop Chrome"],
    deviceScaleFactor: 1,
    viewport: { width: 1000, height: 1000 },
  },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
