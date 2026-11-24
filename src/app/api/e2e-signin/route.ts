import { sessionUserFromSupabaseUser } from '@/shared/auth/session-user'
import { upsertUser } from '@/shared/auth/upsert-user'
import { testSignInRoute } from '@cbrl/supabase/routes'

export const POST = testSignInRoute({
  onSignIn: async (user) => {
    const session = sessionUserFromSupabaseUser(user)
    await upsertUser(session)
    return { uid: session.uid }
  },
})
