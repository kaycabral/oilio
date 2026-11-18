import 'server-only'

import { isAuthSessionMissingError } from '@supabase/supabase-js'
import { cache } from 'react'
import { createSupabaseServerClient } from './server'
import { toSessionUser, type SessionUser } from './session-user'

export type { SessionUser } from './session-user'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return null
  const { data, error } = await supabase.auth.getClaims()
  if (error) {
    if (isAuthSessionMissingError(error)) return null
    throw error
  }
  const claims = data?.claims
  if (!claims) return null
  return toSessionUser({
    id: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : null,
    appMetadata: isRecord(claims.app_metadata) ? claims.app_metadata : undefined,
    userMetadata: isRecord(claims.user_metadata) ? claims.user_metadata : undefined,
  })
})
