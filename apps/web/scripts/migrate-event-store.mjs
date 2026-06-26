#!/usr/bin/env node
// Entrypoint for the oilio event-store migration Cloud Run Job (brief 0057,
// ADR 0011 D2). Migrations run in a DEDICATED Job, never at app boot: with N
// service instances the migrator advisory-lock races; the Job serializes.
//
// The Job runs this against the `oilio` logical database (OILIO_DATABASE_URL,
// resolved by the Cloud SQL connector). It applies the versioned SQL in
// `drizzle/` via drizzle-orm's migrator — NOT `drizzle-kit push` (D3: a rename
// becomes drop+add → data loss). Exits non-zero on failure so the deploy gates.

import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

const here = path.dirname(fileURLToPath(import.meta.url))
// scripts/ → web/ → web/drizzle
const migrationsFolder = path.resolve(here, '..', 'drizzle')

const connectionString = process.env.OILIO_DATABASE_URL
if (!connectionString) {
  console.error('Missing required env: OILIO_DATABASE_URL')
  process.exit(1)
}

const pool = new Pool({ connectionString, max: 1 })
try {
  await migrate(drizzle(pool), { migrationsFolder })
  console.log('✓ event-store migrations applied')
} catch (err) {
  console.error('✕ event-store migration failed:', err)
  process.exitCode = 1
} finally {
  await pool.end()
}
