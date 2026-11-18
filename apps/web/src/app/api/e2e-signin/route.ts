import { createSupabaseServerClient } from '@/shared/auth/server'
import { toSessionUser } from '@/shared/auth/session-user'
import { upsertUser } from '@/shared/auth/upsert-user'
import { NextResponse, type NextRequest } from 'next/server'

function credentials(body: unknown): { email: string; password: string } | null {
  if (typeof body !== 'object' || body === null) return null
  if (!('email' in body) || !('password' in body)) return null
  const { email, password } = body
  return typeof email === 'string' && typeof password === 'string' ? { email, password } : null
}

export async function POST(request: NextRequest) {
  if (process.env.ENABLE_TEST_AUTH !== 'true') {
    return new NextResponse(null, { status: 404 })
  }
  const body = credentials(await request.json().catch(() => null))
  if (!body) {
    return NextResponse.json({ error: 'email and password are required' }, { status: 400 })
  }
  const supabase = await createSupabaseServerClient()
  if (!supabase) return NextResponse.json({ error: 'supabase not configured' }, { status: 503 })

  const { data, error } = await supabase.auth.signInWithPassword(body)
  if (error) return NextResponse.json({ error: error.message }, { status: 401 })
  const session = toSessionUser({
    id: data.user.id,
    email: data.user.email,
    appMetadata: data.user.app_metadata,
    userMetadata: data.user.user_metadata,
  })
  await upsertUser(session)
  return NextResponse.json({ uid: session.uid })
}
