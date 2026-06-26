import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Dedicated vitest config for Stryker (mutation testing). Stryker only mutates
// `src/domain/**` (pure TS — reducers, value objects, validators), so the runner
// must load ONLY the domain suite, in the cheapest possible environment.
//
// The app's main vitest.config.ts uses jsdom + the React plugin + a jest-dom
// setup file to support component tests. Loading any of that here is pure
// overhead: Stryker reruns the suite once per test-runner on the initial dry run
// and again per covered mutant. On the 1-vCPU CI runner the jsdom environment
// alone added ~270s of `environment` startup across the full suite (measured:
// full suite 64s / domain-only 21s locally — the gap is jsdom + the 98 non-domain
// test files). Stripping to `environment: 'node'`, no setup, no React plugin, and
// an include scoped to the domain suite is what keeps the dry run inside the job
// timeout. No domain test touches `document`/`window`/Radix, so jsdom is dead
// weight here.
const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

export default defineConfig({
  resolve: {
    alias: {
      // Domain code imports siblings via the `@/` alias; keep it resolvable.
      '@': path.resolve(here, 'src'),
      // Some domain modules transitively touch the `server-only` import marker.
      'server-only': require.resolve('@cbrl/testing/vitest/server-only-shim'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    // Only the pure-domain suite — the exact surface Stryker mutates. Component
    // and adapter tests live elsewhere and are irrelevant to domain mutants.
    include: ['src/domain/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts', 'node_modules/**'],
  },
})
