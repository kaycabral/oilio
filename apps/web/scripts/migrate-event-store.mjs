#!/usr/bin/env node
// Entrypoint for the oilio event-store migration Cloud Run Job (brief 0057,
// ADR 0011 D2). Migrations run in a DEDICATED Job, never at app boot: with N
// service instances the migrator advisory-lock races; the Job serializes.
//
// Applies the versioned SQL in `drizzle/` via drizzle-orm's migrator — NOT
// `drizzle-kit push` (D3: a rename becomes drop+add → data loss). Exits non-zero
// on failure so the deploy gates.
//
// Connection policy mirrors the app's `@cbrl/db` factory, but is inlined here:
// this is a standalone `node` entrypoint in the Cloud Run Job (outside the Next
// bundle / workspace TS resolution), so it must not depend on importing the
// workspace package. In prod it uses the Cloud SQL IAM connector (passwordless,
// dials the private IP over the Job's VPC egress); locally/CI it uses
// OILIO_DATABASE_URL directly.

import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

const here = path.dirname(fileURLToPath(import.meta.url))
// scripts/ → web/ → web/drizzle
const migrationsFolder = path.resolve(here, '..', 'drizzle')

function requireEnv(name) {
  const v = process.env[name]
  if (typeof v !== 'string' || v === '') {
    console.error(`Missing required env: ${name}`)
    process.exit(1)
  }
  return v
}

async function buildPool() {
  if (process.env.OILIO_USE_IAM_AUTH === 'true') {
    const { Connector, AuthTypes, IpAddressTypes } =
      await import('@google-cloud/cloud-sql-connector')
    const connector = new Connector()
    const clientOpts = await connector.getOptions({
      instanceConnectionName: requireEnv('OILIO_CLOUDSQL_INSTANCE'),
      authType: AuthTypes.IAM,
      ipType: IpAddressTypes.PRIVATE,
    })
    const pool = new Pool({
      ...clientOpts,
      user: requireEnv('OILIO_IAM_DB_USER'),
      database: 'oilio',
      max: 1,
    })
    return {
      pool,
      close: async () => {
        await pool.end()
        connector.close()
      },
    }
  }
  const pool = new Pool({ connectionString: requireEnv('OILIO_DATABASE_URL'), max: 1 })
  return { pool, close: () => pool.end() }
}

const { pool, close } = await buildPool()
try {
  await migrate(drizzle(pool), { migrationsFolder })
  console.log('✓ event-store migrations applied')
} catch (err) {
  console.error('✕ event-store migration failed:', err)
  process.exitCode = 1
} finally {
  await close()
}
