import { sessionUserFromSupabaseUser } from '@/shared/auth/session-user'
import { upsertUser } from '@/shared/auth/upsert-user'
import { logger, withRequestContext } from '@cbrl/log'
import { authCallbackRoute } from '@cbrl/supabase/routes'

function errorTag(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown'
  const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined
  return code ? `${error.name}:${code}` : error.name
}

const handler = authCallbackRoute({
  defaultNext: '/dashboard',
  failurePath: '/login?error=auth',
  onSession: (user) => upsertUser(sessionUserFromSupabaseUser(user)),
  onError: (error) => {
    logger.warn('code exchange failed', { scope: 'auth', error: error.code ?? error.name })
  },
  onSessionError: (error) => {
    logger.error('user upsert failed', { scope: 'auth', error: errorTag(error) })
  },
})

export const GET = withRequestContext(handler)
