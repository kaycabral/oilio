import { createSupabaseServerClient } from '@/shared/auth/server'
import { toSessionUser } from '@/shared/auth/session-user'
import { upsertUser } from '@/shared/auth/upsert-user'
import { logger } from '@/shared/lib'
import { withRequestContext } from '@/shared/lib/request-context'
import { safeNext } from '@/shared/routes'
import { NextResponse, type NextRequest } from 'next/server'

async function getHandler(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  const next = safeNext(searchParams.get('next'))

  const supabase = code ? await createSupabaseServerClient() : null
  if (supabase && code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      await upsertUser(
        toSessionUser({
          id: data.user.id,
          email: data.user.email,
          appMetadata: data.user.app_metadata,
          userMetadata: data.user.user_metadata,
        }),
      )
      return NextResponse.redirect(new URL(next, origin))
    }
    logger.warn('code exchange failed', { scope: 'auth', error: error.code ?? error.name })
  }
  return NextResponse.redirect(new URL('/login?error=auth', origin))
}

export const GET = withRequestContext(getHandler)
