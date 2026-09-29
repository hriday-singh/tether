import path from 'node:path';
import type { NextConfig } from 'next';

// @tether/shared ships NodeNext source (`./x.js` specifiers), which Turbopack can't map to .ts under a bundler
// tsconfig. So the web app pins it to the compiled dist/, which the dev/build scripts build first.
// Turbopack aliases are project-relative; absolute Windows paths are ignored.
const sharedDist = '../../packages/shared/dist/index.js';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  reactStrictMode: true,
  turbopack: {
    root: path.join(import.meta.dirname, '../..'),
    resolveAlias: { '@tether/shared': sharedDist },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default nextConfig;
