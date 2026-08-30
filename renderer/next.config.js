/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  distDir: 'out',
  images: { unoptimized: true },
  // Relative asset paths so file:// loading works in Electron
  // (absolute /_next/... paths don't resolve against file:// origins)
  assetPrefix: process.env.NODE_ENV === 'production' ? '.' : undefined,
  trailingSlash: false,
}

module.exports = nextConfig
