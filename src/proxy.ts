import { getPublicOrgVisibility } from '@/features/self-book/adapters/public-page-visibility'
import {
  isPublicPageNotFound,
  publicPageFromPath,
} from '@/features/self-book/core/public-page-gate'
import { logger } from '@cbrl/log'
import { updateSession } from '@cbrl/supabase/proxy'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  const response = await updateSession(request, {
    onError: (err) => {
      logger.warn('session refresh failed', {
        scope: 'auth',
        error: err instanceof Error ? err.name : 'unknown',
      })
    },
  })

  const target = request.method === 'GET' ? publicPageFromPath(request.nextUrl.pathname) : null
  if (target === null) return response
  if (!(await isPublicPageNotFound(target, { lookup: getPublicOrgVisibility }))) return response

  const notFound = NextResponse.rewrite(new URL('/_not-found', request.url), { status: 404 })
  for (const cookie of response.cookies.getAll()) notFound.cookies.set(cookie)
  return notFound
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|monitoring-tunnel|api/webhooks|api/csp-report|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)',
  ],
}
