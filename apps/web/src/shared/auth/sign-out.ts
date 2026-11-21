import { getSupabaseBrowserClient } from '@cbrl/supabase/client'

export async function signOutClient(): Promise<void> {
  await getSupabaseBrowserClient()
    ?.auth.signOut({ scope: 'local' })
    .catch(() => undefined)
}
