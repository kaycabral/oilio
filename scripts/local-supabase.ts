import { readLocalSupabase as readLocalStack, withRole } from '@cbrl/supabase/local'

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

/**
 * URL, keys and database URLs of the LOCAL Supabase stack. `ownerDbUrl` is the
 * `postgres` owner (migrations, seed resets); `appDbUrl` is the `oilio_app`
 * runtime role the app connects as, so RLS binds locally exactly as in production.
 */
export function readLocalSupabase(): LocalSupabase {
  const local = readLocalStack()
  return {
    apiUrl: local.apiUrl,
    publishableKey: local.publishableKey,
    secretKey: local.secretKey,
    ownerDbUrl: local.dbUrl,
    appDbUrl: withRole(local.dbUrl, 'oilio_app', LOCAL_APP_ROLE_PASSWORD),
  }
}
