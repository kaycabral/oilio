import { coverageBase } from '@oilio/testing/vitest'
import { defineConfig } from 'vitest/config'

// Integration layer: runs against a REAL Postgres (the point of brief 0049 is to
// prove native constraints in the database, not in application code). The
// connection target comes from `DATABASE_URL` — supplied by the ephemeral
// Postgres in docker (`docker/postgres.compose.yaml`) locally and by the GitLab CI
// `services: [postgres]` job. There is no emulator wrapper (unlike the Firestore
// apps): the suite reads `DATABASE_URL` directly and fails fast if it is unset.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Integration files share ONE Postgres database; some truncate tables
    // between tests. Running files in parallel lets one suite's TRUNCATE clobber
    // another's fixtures mid-run. Force sequential file execution so each owns
    // the database for its turn.
    fileParallelism: false,
    coverage: {
      ...coverageBase(),
      include: [
        'src/db/**',
        'src/schema/**',
        'src/port/**',
        'src/lookup/**',
        'src/contribute/**',
        'src/engine/**',
      ],
      reportsDirectory: './coverage-integration',
    },
  },
})
