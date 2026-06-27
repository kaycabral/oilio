#!/usr/bin/env node
// Dev prerequisite for `pnpm db:seed` / `pnpm local`: bring the oilio event-store
// Postgres up, ensure the logical `oilio` database exists, and apply migrations —
// then LEAVE it running (unlike the integration runner, which tears down).
//
// Shares all the connection/docker plumbing with the integration runner via
// `oilio-pg-lib.mjs`, so dev and CI agree on where the DB is. In the bare-local
// case this owns the ephemeral container (`docker/postgres.compose.yaml`); when
// an external Postgres is attached (OILIO_DATABASE_URL / DATABASE_URL) it just
// ensures the DB + schema and does NOT touch docker.
//
// Usage:  node scripts/oilio-db-up.mjs   (or `pnpm --filter @oilio/web oilio:db:up`)

import { composeUp, ensureOilioDatabase, migrateOilio, resolveConnection } from './oilio-pg-lib.mjs'

const { oilioUrl, adminUrl, dbAttached } = resolveConnection()

if (!dbAttached) {
  console.log('▸ subindo Postgres do oilio (docker/postgres.compose.yaml)…')
  const upStatus = composeUp()
  if (upStatus !== 0) {
    console.error('✕ Postgres não subiu.')
    process.exit(upStatus)
  }
}

await ensureOilioDatabase(adminUrl)

console.log('▸ aplicando migrations na base `oilio`…')
const migrateStatus = migrateOilio(oilioUrl)
if (migrateStatus !== 0) {
  console.error('✕ migrations falharam.')
  process.exit(migrateStatus)
}

console.log(`✓ Postgres do oilio pronto (${oilioUrl}). Rode \`pnpm --filter @oilio/web db:seed\`.`)
process.exit(0)
