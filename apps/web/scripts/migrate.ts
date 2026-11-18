import { applyMigrations } from './run-migrations'

/**
 * Production schema rollout, run ONLY by the CI job `deploy`
 * (docs/production.md). `POSTGRES_URL_NON_POOLING` is the Supabase session
 * pooler (port 5432) as `postgres`: IPv4-reachable from the runners and it keeps
 * the session the migrator's advisory lock needs (the 6543 transaction pooler
 * does not).
 */
async function main(): Promise<void> {
  const url = process.env.POSTGRES_URL_NON_POOLING
  if (!url) throw new Error('POSTGRES_URL_NON_POOLING is required')
  await applyMigrations(url)
  console.log('oilio migrations applied')
}

main().catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})
