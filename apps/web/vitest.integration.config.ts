import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

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
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // All integration files share ONE Firestore emulator (default) db; some wipe
    // it globally between tests (`user-merge`, `block-subject-in-org`). Running
    // files in parallel lets one suite's full-db DELETE clobber another's fixtures
    // mid-run. Force sequential file execution so each owns the db for its turn.
    // (Rules-bound files use @firebase/rules-unit-testing with their own project,
    // so they're isolated regardless — this only matters for admin-SDK files.)
    fileParallelism: false,
    // The emulator lifecycle + host env (FIRESTORE_EMULATOR_HOST,
    // FIREBASE_AUTH_EMULATOR_HOST, GCLOUD_PROJECT, …) is owned by the Firebase
    // CLI: `test:integration` runs this under `firebase emulators:exec`, the
    // canonical pattern. Tests read the injected env directly — no manual host
    // bootstrap, no fallback (missing env → fail-fast).
    //
    // The admin project id is NOT injected by the CLI, and @oilio/db
    // requires it at module load. It's a test fixture, so it lives here (the
    // declarative home, mirroring the unit layer's vitest.config.ts test.env)
    // — not assigned imperatively at the top of a spec. A dedicated project
    // keeps this suite's emulator data (and its wipe) isolated.
    env: {
      FIREBASE_ADMIN_PROJECT_ID: 'scheduling-integration-test',
    },
  },
})
