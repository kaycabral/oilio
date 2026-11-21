import { sessionUserFromSupabaseUser } from '@/shared/auth/session-user'
import { upsertUser } from '@/shared/auth/upsert-user'
import { logger, withRequestContext } from '@cbrl/log'
import { authCallbackRoute } from '@cbrl/supabase/routes'

const handler = authCallbackRoute({
  defaultNext: '/dashboard',
  failurePath: '/login?error=auth',
  onSession: (user) => upsertUser(sessionUserFromSupabaseUser(user)),
  onError: (error) => {
    logger.warn('code exchange failed', { scope: 'auth', error: error.code ?? error.name })
  },
})

export const GET = withRequestContext(handler)
