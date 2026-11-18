import { coverageBase } from '@cbrl/testing/vitest'
import { defineConfig } from 'vitest/config'

// Unit layer: pure logic only (GTIN validator), node environment, no I/O.
// Integration files (real Postgres) live in vitest.integration.config.ts and
// are excluded here so the unit run never needs a database.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts', 'node_modules/**'],
    coverage: {
      ...coverageBase(),
      // Integration-only modules (db pool, schema, migrations) are proven by the
      // integration suite against a real Postgres, not by the unit coverage run.
      exclude: [
        ...coverageBase().exclude,
        'src/db/**',
        'src/schema/**',
        'src/port/**',
        'src/index.ts',
        'src/lookup/index.ts',
        'src/lookup/types.ts',
        'src/contribute/index.ts',
        'src/contribute/types.ts',
        'src/engine/index.ts',
        'drizzle.config.ts',
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
        autoUpdate: true,
      },
    },
  },
})
