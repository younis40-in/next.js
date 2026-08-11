import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  cacheComponents: true,
  experimental: {
    prefetchInlining: true,
    optimisticRouting: true,
    cachedNavigations: true,
    varyParams: true,
  },
  productionBrowserSourceMaps: true,
}

export default nextConfig
