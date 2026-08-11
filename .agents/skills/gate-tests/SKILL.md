---
name: gate-tests
description: >
  How to use the `@gate` / `@force-gate` test directives instead of `it.skip`
  or fake-green skip patterns. Use when a test is known-failing under some
  test-matrix dimension (dev mode, a bundler, an experimental flag like
  cacheComponents), when converting `if (isNextDev) return` guards or
  env-var `describe.skip` branches, when adding a condition to
  test/lib/gate/conditions.ts, or when keying a fixture's experimental flag
  on an __NEXT_EXPERIMENTAL_CI_SHARD number. Covers directive choice,
  condition tiers, the experimental-shard fixture pattern, pitfalls, and
  verification commands.
user-invocable: false
metadata:
  internal: true
---

# Gating tests with `@gate` / `@force-gate`

Full reference: [`test/lib/gate/README.md`](../../../test/lib/gate/README.md).
This skill is the decision guide: which directive to reach for, the standard
conversion patterns, and how to verify.

## Never write these — gate instead

| Anti-pattern                                                           | Replacement                                                                 |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `it.skip('...')` for a known failure                                   | `// @gate <cond>` (or `@gate FIXME` if no condition explains it)            |
| `if (isNextDev) { test('skipped in dev mode', () => {}); return }`     | `// @force-gate prefetching` (or `!dev`) on the `describe`                  |
| `(flagEnabled ? describe.skip : describe)(...)` keyed on `process.env` | `// @force-gate <cond>` (lazy) on the `describe`                            |
| Duplicating a fixture directory per flag state                         | one fixture keyed on `__NEXT_EXPERIMENTAL_CI_SHARD` + `// @gate <cond>`     |
| Branching expectations on `process.env.__NEXT_CACHE_COMPONENTS`        | `if (await gate((c) => c.cacheComponents))` (`gate` from `next-test-utils`) |

The skip patterns are fake-greens: nothing tells you when the bug they hide is
fixed. `@gate` still runs the body and fails the suite the day the "known
failure" starts passing, so stale workarounds get deleted instead of rotting.

## Choosing the directive

Ask what kind of difference you're encoding:

1. **A behavior change — both states assert something meaningful.** Don't
   gate the test at all: fork inside the body with the runtime `gate()` —
   same condition registry, no inversion — which pinpoints exactly what
   differs, and also covers `it.each`, where a pragma cannot attach:
   `if (await gate((c) => c.cacheComponents)) { ... } else { ... }`. It
   mirrors React's `gate(flags => ...)`; a pragma expression string works
   too (`await gate('cacheComponents && !dev')`). A suite-level pragma is
   too coarse here — it hides _what_ is different between the states.
2. **A new API or feature — the off state can only fail.** `// @gate <cond>`
   on the test or `describe`. The body runs; a false condition inverts the
   expectation (failure absorbed, a pass fails as "stale gate"). This is the
   default whenever the body _can_ run.
3. **`@force-gate <cond>` when running the body is impossible**, not merely
   failing: prefetching is off in dev, deploy has no local build output, the
   fixture cannot even build under the condition.
   - Static condition (`!dev`, `bundler`…) → real Jest `○ skipped` at
     collection.
   - Lazy condition on a `describe` → the fixture **build is skipped** when
     false; tests report passed-with-`⚠ skipped by @force-gate` (Jest cannot
     skip at runtime). Build-skipping covers `start`/`dev` suites where
     `nextTestSetup` owns the build — not `skipStart` suites, not deploy.
4. Pragmas stack: a common pair is a static `// @force-gate prefetching` plus
   a lazy `// @gate <flag>` on the same `describe`.

### Is the off-state run worth its cost?

Browser e2e time is not free, so weigh what the gated-off run buys. It
usually replaces a run that was already being paid for — a fixture that pins
its flags runs identically in both CI shards, so keying the flag on the shard
converts a redundant duplicate into coverage — and it is what proves a pass
isn't vacuous: a test that passes with the feature off wasn't testing the
feature. Absorbed failures also fail fast, so the off-state run is cheaper
than it sounds. But when a suite's off state genuinely proves nothing (a new
API that can only throw) and the suite is expensive, use a lazy
`// @force-gate <flag>` on the `describe` instead — the fixture build is
skipped too, so the off state costs almost nothing.

## Conditions

Every name in a pragma must be declared in `test/lib/gate/conditions.ts`
(typos fail the suite at collection). Two tiers:

- **static** — the run's shape: `dev`, `start`, `deploy`, `mode`, `turbopack`,
  `rspack`, `webpack`, `bundler`, `react18`, `wasm`, `ci`, plus the
  always-false `FIXME`/`TODO`. `prod` and `prefetching` are semantic aliases
  for `!dev` — prefer the name that states _why_ the suite cannot run.
- **lazy** — a predicate over the fixture's _resolved_ `next.config`
  (`cacheComponents`, `ppr`, `useOffline`, `output`, …).

Adding one is a two-line change; follow the guidance at the top of
`conditions.ts`. The rule that matters: **lazy conditions read the resolved
config, never `process.env`** — env vars don't survive config resolution
(`__NEXT_CACHE_COMPONENTS` only applies when the fixture doesn't set
`cacheComponents` itself, and resolution implies flags the fixture never
mentions).

## Pattern: cover both states of an experimental flag

Instead of pinning a flag on (which makes both CI runs identical), key it on
an experimental CI shard number and gate the suite. Key it so the flag is
**enabled by default** — then the suite exercises the feature in plain local
runs with no special env, and the shard run covers the off state:

```js
// next.config.js — pin every dimension except the one under test
const nextConfig = {
  cacheComponents: true,
  experimental: {
    useOffline: process.env.__NEXT_EXPERIMENTAL_CI_SHARD !== '1',
  },
}
```

```ts
// @force-gate prefetching
// @gate useOffline
describe('useOffline', () => { ... })
```

The plain run exercises the feature; the shard run asserts it is inert when
disabled. Shard `1` aliases `__NEXT_CACHE_COMPONENTS` for now (see
`scripts/run-jest.sh`) — fine, because the fixture pins
`cacheComponents: true` explicitly, so that run's cache-components default is
a no-op for it. Working example: `test/e2e/app-dir/use-offline/`.

**Keep exactly one flag varying per fixture.** A red shard must attribute to a
single dimension.

## Pitfalls

- A pragma the transform can't attach is a **hard error**: a blank line
  between pragma and `it(`, `it.each`/`it.failing`, or a pragma inside a
  JSDoc block. Prose comments must not begin with `@gate`. A pragma on a
  skipped test (`it.skip`, `xit`, …) errors as ambiguous — remove the skip or
  the pragma. A skip without a pragma is respected.
- A `describe`-level gate does not reach `it.each` tests.
- Gated-false bodies that fail by _stalling_ waste the full Jest timeout —
  and under a lazy gate they fail the suite anyway (the runtime inversion
  only absorbs thrown errors; a static gate rides Jest's native
  `test.failing`, which does absorb timeouts). Bodies that fail via `retry()`
  timeouts also make the off-state run slow; a fast first assertion is worth
  having.
- Failures cascade in the off state: an absorbed failure mid-body skips the
  body's cleanup (e.g. a browser context left offline), so later tests may
  fail for cascade reasons. Acceptable for a tripwire, but don't puzzle over
  the individual failure messages in a gated-off run.
- `afterEach` failures (e.g. redbox matchers) are not gated — only the body is.
- `jest.retryTimes(1)` on non-dev CI means a _flaky_ gated-false test passes
  whenever it happens to fail; the tripwire is only deterministic for
  deterministic tests.
- Gated titles are unchanged in the Jest output; the
  `⚠ gated test failed as expected` log line is the only signal.
- `pragma-transform.js` bails out early on files containing neither `@gate`
  nor `@force-gate` as substrings — keep both checks if you touch it.

## Verify a gated suite in every state it can run in

```sh
# plain run (flag on): expect normal passes, no warnings
NEXT_SKIP_ISOLATE=1 pnpm test-start-webpack test/e2e/app-dir/<suite>/<suite>.test.ts

# shard run (flag off): expect `⚠ gated test failed as expected (@gate …)`
__NEXT_EXPERIMENTAL_CI_SHARD=1 NEXT_SKIP_ISOLATE=1 pnpm test-start-webpack test/e2e/app-dir/<suite>/<suite>.test.ts

# dev (static @force-gate !dev): expect `○ skipped` at collection, no fixture boot
NEXT_SKIP_ISOLATE=1 pnpm test-dev-webpack test/e2e/app-dir/<suite>/<suite>.test.ts
```

A suite with a lazy `@force-gate` on the `describe` should additionally show
`skipping build` behavior (no `next build`) in the state where the condition
is false.

Unit tests for the infrastructure itself: `pnpm test-unit test/unit/gate/`.

## Related skills

- `$flags` — adding the experimental flag itself (config-shared, schema,
  define-env)
- `$router-act` — the prefetch-timing patterns most gated suites also use
