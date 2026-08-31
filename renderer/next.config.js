/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  distDir: 'out',
  images: { unoptimized: true },
  // Relative asset paths so file:// loading works in Electron
  // (absolute /_next/... paths don't resolve against file:// origins)
  assetPrefix: process.env.NODE_ENV === 'production' ? '.' : undefined,
  trailingSlash: false,
  // ogl and motion ship pure ESM; webpack needs to transpile them for Next.js 14
  transpilePackages: ['ogl', 'motion'],
}

module.exports = nextConfig
