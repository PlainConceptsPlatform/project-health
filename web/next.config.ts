import type { NextConfig } from 'next'

/**
 * Static export. The site is a set of files with no server and no database, which is what lets
 * GitHub Pages serve it privately, visible only to people with read access to this repository,
 * without any authentication code of its own.
 *
 * basePath is empty when a custom domain serves the site from the root. It only needs a value if
 * the site moves to the github.io project subpath, where every asset sits under /project-health.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
}

export default nextConfig
