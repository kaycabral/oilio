import { logger } from '@cbrl/log'
import { updateSession } from '@cbrl/supabase/proxy'
import type { NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  return updateSession(request, {
    onError: (err) => {
      logger.warn('session refresh failed', {
        scope: 'auth',
        error: err instanceof Error ? err.name : 'unknown',
      })
    },
  })
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|monitoring-tunnel|api/webhooks|api/csp-report|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)',
  ],
}
