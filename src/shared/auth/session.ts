import 'server-only'

import { sessionUserFromClaims } from '@cbrl/supabase'
import { createSupabaseServerClient } from '@cbrl/supabase/server'
import { isAuthSessionMissingError } from '@supabase/supabase-js'
import { cache } from 'react'
import { toSessionUser, type SessionUser } from './session-user'

export type { SessionUser } from './session-user'

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
  return toSessionUser(sessionUserFromClaims(claims))
})
