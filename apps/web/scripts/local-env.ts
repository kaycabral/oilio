import { findSupabaseAppDir, writeEnvLocal } from '@cbrl/supabase/local'
import path from 'node:path'

import { readLocalSupabase } from './local-supabase'

/**
 * Write the LOCAL Supabase stack values into `.env.local` (created from
 * `.env.example` when missing), keeping every other line untouched. Run after
 * `pnpm db:start`. The app connects as `oilio_app`, so RLS binds in dev as in
 * production.
 */
const appDir = findSupabaseAppDir()
const local = readLocalSupabase()
const target = writeEnvLocal(
  {
    NEXT_PUBLIC_SUPABASE_URL: local.apiUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.publishableKey,
    SUPABASE_SECRET_KEY: local.secretKey,
    OILIO_DATABASE_URL: local.appDbUrl,
    DATABASE_URL: local.appDbUrl,
  },
  { appDir },
)
console.log(`Local Supabase values written to ${path.relative(appDir, target)}`)
