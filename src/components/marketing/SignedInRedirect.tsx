import { getSessionUser } from '@/shared/auth/session'
import { resolvePostAuthDestination } from '@/shared/identity/post-auth-destination'
import { isSupabaseConfigured } from '@cbrl/supabase'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'

export async function SignedInRedirect() {
  await connection()
  if (!isSupabaseConfigured()) return null
  const session = await getSessionUser()
  if (session) redirect(await resolvePostAuthDestination(session.uid))
  return null
}
