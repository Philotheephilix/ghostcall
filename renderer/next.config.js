/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  distDir: 'out',
  images: { unoptimized: true },
  // Disable server features not available in static Electron context
  trailingSlash: false,
}

module.exports = nextConfig
