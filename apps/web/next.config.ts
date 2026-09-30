import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import type { NextConfig } from "next";

// Next only reads .env files from apps/web, but the monorepo keeps one .env at the root. Load it here so
// NEXT_PUBLIC_* reach the browser bundle. Shell vars and apps/web/.env* (already loaded by Next) win.
const rootEnv = path.join(import.meta.dirname, "../../.env");
if (fs.existsSync(rootEnv)) {
  for (const [key, value] of Object.entries(parseEnv(fs.readFileSync(rootEnv, "utf8")))) {
    process.env[key] ??= value;
  }
}

// @tether/shared and @tether/sync-client ship NodeNext source (`./x.js` specifiers), which Turbopack can't map to .ts under a bundler
// tsconfig. So the web app pins them to the compiled dist/, which the dev/build scripts build first.
// Turbopack aliases are project-relative; absolute Windows paths are ignored.
const sharedDist = "../../packages/shared/dist/index.js";
const syncClientDist = "../../packages/sync-client/dist/index.js";

// Hostnames (not full URLs) that Next.js should accept dev HMR requests from.
// Set via ALLOWED_DEV_ORIGINS in .env as a comma-separated list.
const allowedDevOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  devIndicators: false,
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  reactStrictMode: true,
  ...(allowedDevOrigins.length > 0 && { allowedDevOrigins }),
  turbopack: {
    root: path.join(import.meta.dirname, "../.."),
    resolveAlias: {
      "@tether/shared": sharedDist,
      "@tether/sync-client": syncClientDist,
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@tether/shared": path.resolve(import.meta.dirname, sharedDist),
      "@tether/sync-client": path.resolve(import.meta.dirname, syncClientDist),
    };
    return config;
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
