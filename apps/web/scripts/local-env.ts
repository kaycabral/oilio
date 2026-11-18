import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { oilioAppDir, readLocalSupabase } from './local-supabase'

/**
 * Write the LOCAL Supabase stack values into `.env.local` (created from
 * `.env.example` when missing), keeping every other line untouched. Run after
 * `pnpm db:start`. The app connects as `oilio_app`, so RLS binds in dev as in
 * production.
 */
function main(): void {
  const appDir = oilioAppDir()
  const target = path.join(appDir, '.env.local')
  const source = existsSync(target) ? target : path.join(appDir, '.env.example')
  const local = readLocalSupabase()
  const values: Record<string, string> = {
    NEXT_PUBLIC_SUPABASE_URL: local.apiUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.publishableKey,
    SUPABASE_SECRET_KEY: local.secretKey,
    OILIO_DATABASE_URL: local.appDbUrl,
    DATABASE_URL: local.appDbUrl,
  }

  const seen = new Set<string>()
  const lines = readFileSync(source, 'utf8')
    .split('\n')
    .map((line) => {
      const key = line.split('=', 1)[0]?.trim() ?? ''
      const value = values[key]
      if (value === undefined) return line
      seen.add(key)
      return `${key}=${value}`
    })
  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) lines.push(`${key}=${value}`)
  }
  writeFileSync(target, lines.join('\n'), { mode: 0o600 })
  console.log(`Local Supabase values written to ${path.relative(appDir, target)}`)
}

main()
