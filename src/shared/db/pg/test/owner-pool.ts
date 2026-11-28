import { requireEnv } from '@cbrl/env'
import { Client, Pool } from 'pg'

export const OWNER_DATABASE_URL_ENV = 'OILIO_OWNER_DATABASE_URL'
export const PRODUCT_OWNER_DATABASE_URL_ENV = 'PRODUCT_OWNER_DATABASE_URL'
export const RUNTIME_ROLE = 'oilio_app'

let pool: Pool | undefined

/**
 * Pool connected as the schema owner, for integration-test fixtures only
 * (seeding across orgs, TRUNCATE, ad-hoc roles). The code under test connects
 * through `OILIO_DATABASE_URL` as the `oilio_app` runtime role, exactly as in
 * production, so RLS and the grants bind every query the app runs.
 */
export function ownerPool(): Pool {
  pool ??= new Pool({ connectionString: requireEnv(OWNER_DATABASE_URL_ENV) })
  return pool
}

export async function closeOwnerPool(): Promise<void> {
  const current = pool
  pool = undefined
  await current?.end()
}

/**
 * Gives the runtime role (created NOLOGIN by the migrations) a login whose
 * password is the one carried by `runtimeUrl`, so the suites can connect as it.
 * Test-only: production sets its password out-of-band (docs/production.md).
 */
export async function enableRuntimeRoleLogin(ownerUrl: string, runtimeUrl: string): Promise<void> {
  const runtime = new URL(runtimeUrl)
  if (decodeURIComponent(runtime.username) !== RUNTIME_ROLE) {
    throw new Error(`The suite must connect as ${RUNTIME_ROLE}, not ${runtime.username}`)
  }
  const client = new Client({ connectionString: ownerUrl })
  await client.connect()
  try {
    const password = decodeURIComponent(runtime.password).replaceAll("'", "''")
    await client.query(`ALTER ROLE ${RUNTIME_ROLE} LOGIN PASSWORD '${password}'`)
  } finally {
    await client.end()
  }
}
