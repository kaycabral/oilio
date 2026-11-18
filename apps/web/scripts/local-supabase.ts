import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

export type LocalSupabase = {
  apiUrl: string
  publishableKey: string
  secretKey: string
  ownerDbUrl: string
  appDbUrl: string
}

/**
 * Local-only password for the `oilio_app` runtime role (migration 0023 creates
 * it NOLOGIN; `db:migrate` grants it a login on the LOCAL stack only). Production
 * sets its own password out-of-band (docs/production.md).
 */
export const LOCAL_APP_ROLE_PASSWORD = 'oilio_app_local_only'

/** apps/web, found by walking up from the cwd to the dir that holds `supabase/config.toml`. */
export function oilioAppDir(): string {
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, 'supabase', 'config.toml'))) return dir
    const appDir = path.join(dir, 'apps', 'web')
    if (existsSync(path.join(appDir, 'supabase', 'config.toml'))) return appDir
    if (path.dirname(dir) === dir) throw new Error('supabase/config.toml not found above cwd')
  }
}

function field(status: Record<string, unknown>, key: string): string {
  const value = status[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `supabase status: missing ${key}. Is the local stack up? Run \`pnpm --filter @oilio/web db:start\`.`,
    )
  }
  return value
}

function asAppRole(ownerDbUrl: string): string {
  const url = new URL(ownerDbUrl)
  url.username = 'oilio_app'
  url.password = LOCAL_APP_ROLE_PASSWORD
  return url.toString()
}

/**
 * URL, keys and database URLs of the LOCAL Supabase stack, read from
 * `supabase status` so nothing is hard-coded. `ownerDbUrl` is the `postgres`
 * owner (migrations, seed resets); `appDbUrl` is the `oilio_app` runtime role the
 * app connects as, so RLS binds locally exactly as in production.
 */
export function readLocalSupabase(): LocalSupabase {
  const raw = execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json', '--workdir', '.'], {
    cwd: oilioAppDir(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const status: unknown = JSON.parse(raw)
  if (typeof status !== 'object' || status === null) {
    throw new Error('supabase status: unexpected output')
  }
  const record = Object.fromEntries(Object.entries(status))
  const ownerDbUrl = field(record, 'DB_URL')
  return {
    apiUrl: field(record, 'API_URL'),
    publishableKey: field(record, 'PUBLISHABLE_KEY'),
    secretKey: field(record, 'SECRET_KEY'),
    ownerDbUrl,
    appDbUrl: asAppRole(ownerDbUrl),
  }
}
