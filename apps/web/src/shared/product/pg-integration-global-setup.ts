import { closeEventStoreDb, runEventStoreMigrations } from '@/shared/db/pg'
import { closeDb, runMigrations } from '@cbrl/product'

/**
 * Vitest globalSetup for the Postgres-backed product-gate suite
 * (`*.pg.integration.test.ts`, briefs 0050/0054).
 *
 * This layer spans TWO logical databases on the ephemeral Postgres (PRD:
 * "1 instância, 2 databases lógicos"):
 *   • `produtos` (DATABASE_URL)       — the sovereign `@cbrl/product` base.
 *   • `oilio`    (OILIO_DATABASE_URL) — the event store; `reconcile-products`
 *     reads its `public_org_directory` projection.
 *
 * Both are supplied by the runner (`scripts/product-it.mjs` / the events runner
 * `scripts/oilio-events-it.mjs` locally, `services: postgres` in CI) — NEVER by
 * running `pnpm test:integration:pg` bare. When the env is missing we fail here
 * with an actionable message instead of letting each spec die deep inside the
 * `@cbrl/db` pool with an opaque ECONNREFUSED/requireEnv stack (issue #1358).
 *
 * Applying both schemas here (mirroring the event-store suite's globalSetup)
 * means the specs no longer each run `beforeAll(runMigrations)` — the table is
 * guaranteed to exist before any file runs, independent of file ordering. The
 * pools are closed afterwards so the test workers open their own.
 */
export default async function globalSetup(): Promise<void> {
  const missing = (['DATABASE_URL', 'OILIO_DATABASE_URL'] as const).filter(
    (name) => !process.env[name]?.trim(),
  )
  if (missing.length > 0) {
    throw new Error(
      `test:integration:pg needs ${missing.join(' and ')}: this suite talks to the ` +
        'real `produtos` + `oilio` Postgres databases and is not meant to run bare. ' +
        'Run it through the runner — `node scripts/product-it.mjs` (or `pnpm --filter ' +
        '@oilio/web test:integration` for the whole PG layer) — which boots the ephemeral ' +
        'Postgres and injects both connection strings. In CI the `integration:product` ' +
        'job supplies them via `services: postgres`.',
    )
  }

  await runMigrations()
  await runEventStoreMigrations()
  await closeDb()
  await closeEventStoreDb()
}
