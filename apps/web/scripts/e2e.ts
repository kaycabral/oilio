import { spawnSync } from 'node:child_process'
import net from 'node:net'

import { readLocalSupabase } from './local-supabase'
import { applyMigrations } from './run-migrations'

/**
 * Playwright E2E against the LOCAL Supabase stack (`pnpm db:start` first; CI
 * runs it in the job). Applies pending migrations, picks a free port for Next,
 * and runs Playwright with two database roles:
 *  - the Next server under test connects as `oilio_app` (no BYPASSRLS), so RLS
 *    binds exactly as in production (`E2E_APP_DATABASE_URL`);
 *  - the spec helpers seed fixtures as the `postgres` owner
 *    (`OILIO_DATABASE_URL` / `DATABASE_URL` in the Playwright process).
 * Extra args go straight to `playwright test`.
 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address()
      const port = typeof address === 'object' && address ? address.port : 0
      srv.close(() => resolve(port))
    })
  })
}

async function main(): Promise<number> {
  const local = readLocalSupabase()
  await applyMigrations(local.ownerDbUrl)
  const port = process.env.E2E_PORT ?? String(await freePort())
  console.log(`▸ E2E on the local Supabase stack, Next on :${port}`)
  const res = spawnSync('pnpm', ['exec', 'playwright', 'test', ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: {
      ...process.env,
      E2E_PORT: port,
      NEXT_PUBLIC_SUPABASE_URL: local.apiUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.publishableKey,
      SUPABASE_SECRET_KEY: local.secretKey,
      OILIO_DATABASE_URL: local.ownerDbUrl,
      DATABASE_URL: local.ownerDbUrl,
      E2E_APP_DATABASE_URL: local.appDbUrl,
    },
  })
  if (res.error) throw res.error
  return res.status ?? 1
}

main().then(
  (status) => process.exit(status),
  (err: unknown) => {
    console.error(err)
    process.exit(1)
  },
)
