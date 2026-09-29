import path from 'node:path';
import type { NextConfig } from 'next';

// ponytail: @tether/shared exports point at dist/; alias to source so the web app never needs a prebuild.
const sharedSrc = path.join(import.meta.dirname, '../../packages/shared/src/index.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: path.join(import.meta.dirname, '../..'),
    resolveAlias: { '@tether/shared': sharedSrc },
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
