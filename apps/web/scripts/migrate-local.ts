import { Client } from 'pg'

import { LOCAL_APP_ROLE_PASSWORD, readLocalSupabase } from './local-supabase'
import { applyMigrations } from './run-migrations'

/**
 * Apply the event-store and product migrations to the LOCAL Supabase stack (run
 * by `db:start`) as the `postgres` owner, then give the `oilio_app` runtime role
 * a local-only login. Production migrations run only from CI
 * (`migrate-production`); this script refuses any non-local host.
 */
async function main(): Promise<void> {
  const local = readLocalSupabase()
  const host = new URL(local.ownerDbUrl).hostname
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`Refusing to migrate a non-local database (${host})`)
  }
  await applyMigrations(local.ownerDbUrl)

  const client = new Client({ connectionString: local.ownerDbUrl })
  await client.connect()
  try {
    await client.query(`ALTER ROLE oilio_app LOGIN PASSWORD '${LOCAL_APP_ROLE_PASSWORD}'`)
  } finally {
    await client.end()
  }
  console.log('oilio migrations applied to the local Supabase stack')
}

main().catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})
