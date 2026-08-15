/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @walletconnect/ethereum-provider (lazy-loaded client-side only, see
  // app/lib/wallet.js) pulls in pino, @walletconnect/keyvaluestorage, and
  // node-fetch as transitive deps. Those reach for optional Node-only
  // packages (pino-pretty, lokijs, encoding) that aren't installed and
  // aren't needed in the browser bundle. Without this, the build fails on
  // each one in turn even though nothing actually calls them at runtime.
  webpack: (config) => {
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, net: false, tls: false };
    config.externals.push('pino-pretty', 'lokijs', 'encoding');
    return config;
  },
};

module.exports = nextConfig;
