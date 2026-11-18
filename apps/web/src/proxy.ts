import { supabasePublicConfig } from '@/shared/auth/config'
import { logger } from '@/shared/lib'
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })
  const config = supabasePublicConfig()
  if (!config) return response

  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value)
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options)
        }
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value)
      },
    },
  })

  try {
    await supabase.auth.getClaims()
  } catch (err) {
    logger.warn('session refresh failed', {
      scope: 'auth',
      error: err instanceof Error ? err.name : 'unknown',
    })
  }
  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|monitoring-tunnel|api/webhooks|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)',
  ],
}
