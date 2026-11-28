import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

// Postgres-backed integration layer (brief 0050, A2): the sovereign-base gate +
// reconciliation talk to REAL Postgres (`@/product`, from A1). These specs
// read `DATABASE_URL` directly — supplied by the ephemeral Postgres in docker
// (`scripts/product-it.mjs`), locally and in CI.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(here, 'src'),
      'server-only': require.resolve('@cbrl/testing/vitest/server-only-shim'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    // Same as vitest.config.ts: let Vite resolve the `next/*` imports of @cbrl/*.
    server: { deps: { inline: [/@cbrl\//] } },
    include: ['src/**/*.pg.integration.test.ts'],
    // The event-store layer (`*.events.pg.integration.test.ts`) targets a SEPARATE
    // logical database (`oilio` via OILIO_DATABASE_URL) with its own migrations —
    // it has its own config (`vitest.events-pg-integration.config.ts`). Exclude it
    // here so the suffix-overlapping glob doesn't run it against `produtos`.
    exclude: ['src/**/*.events.pg.integration.test.ts'],
    // Applies both the product base (`produtos`) and event-store (`oilio`)
    // schemas once before any file runs, and fails fast with an actionable
    // message when the runner didn't inject DATABASE_URL/OILIO_DATABASE_URL
    // (issue #1358). Mirrors `vitest.events-pg-integration.config.ts`.
    globalSetup: './src/shared/product/pg-integration-global-setup.ts',
    setupFiles: ['./src/shared/db/pg/test/owner-pool-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // One shared Postgres database; specs truncate the table between tests.
    // Sequential files so one suite's DELETE never clobbers another's fixtures.
    fileParallelism: false,
  },
})
