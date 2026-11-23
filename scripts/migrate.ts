import { requireEnv } from '@cbrl/env'

import { applyMigrations } from './run-migrations'

/**
 * Production schema rollout, run ONLY by the CI job `deploy`
 * (docs/production.md). `POSTGRES_URL_NON_POOLING` is the Supabase session
 * pooler (port 5432) as `postgres`: IPv4-reachable from the runners and it keeps
 * the session the migrator's advisory lock needs (the 6543 transaction pooler
 * does not).
 */
async function main(): Promise<void> {
  await applyMigrations(requireEnv('POSTGRES_URL_NON_POOLING'))
  console.log('oilio migrations applied')
}

main().catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})
