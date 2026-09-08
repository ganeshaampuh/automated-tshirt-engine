import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The engine reads fonts and mockup assets from disk at runtime via process.cwd().
  // Vercel's tracer cannot see those dynamic reads, so include them explicitly.
  outputFileTracingIncludes: {
    "/**/*": ["./public/fonts/**/*", "./public/mockups/**/*"],
  },
  // Native binaries must not be bundled.
  serverExternalPackages: ["@napi-rs/canvas", "sharp"],
  experimental: {
    // Clipart uploads are Server Action posts; the 1 MB default rejects any phone photo with a 413
    // before the action can run. Keep this above `MAX_UPLOAD_BYTES` in `src/lib/upload.ts`.
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
