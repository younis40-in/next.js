/**
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  cacheComponents: true,
  experimental: {
    // Keyed on experimental CI shard 1 (see scripts/run-jest.sh) so the
    // suite covers both states. Enabled by default — a plain run exercises
    // the feature with no special env — and disabled in that shard, where
    // the `@gate useOffline` tests assert the feature is inert.
    useOffline: process.env.__NEXT_EXPERIMENTAL_CI_SHARD !== '1',
    varyParams: true,
    optimisticRouting: true,
    cachedNavigations: true,
  },
}

module.exports = nextConfig
