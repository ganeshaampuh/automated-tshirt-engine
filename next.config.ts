import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The engine reads fonts and mockup assets from disk at runtime via process.cwd().
  // Vercel's tracer cannot see those dynamic reads, so include them explicitly.
  outputFileTracingIncludes: {
    "/**/*": ["./public/fonts/**/*", "./public/mockups/**/*"],
  },
  // Native binaries must not be bundled.
  serverExternalPackages: ["@napi-rs/canvas", "sharp"],
};

export default nextConfig;
