/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // pg is a Node-only driver; keep it out of the client/edge bundles.
  serverExternalPackages: ['pg'],
  async headers() {
    return [
      {
        // The service worker must never be served from a stale HTTP cache,
        // otherwise clients can get stuck on an old app shell forever.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/manifest.webmanifest',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }],
      },
    ];
  },
};

export default nextConfig;
