import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

// Postgres-backed integration layer for the relational EVENT STORE (brief 0057,
// feature A). Distinct from `vitest.pg-integration.config.ts` (the sovereign-base
// product gate, which targets the `produtos` DB via DATABASE_URL): this layer
// targets the `oilio` DB via OILIO_DATABASE_URL and proves the event-store cycle
// (append → projection → replay) + atomicity + optimistic concurrency against
// REAL Postgres. `globalSetup` applies the event-store migrations. No emulator.
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
    include: ['src/**/*.events.pg.integration.test.ts'],
    globalSetup: './src/shared/db/pg/test/global-setup.ts',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // One shared Postgres database; specs clean up between tests. Sequential
    // files so one suite's cleanup never clobbers another's fixtures.
    fileParallelism: false,
  },
})
