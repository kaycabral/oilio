import { getSupabaseBrowserClient } from './client'

export async function signOutClient(): Promise<void> {
  await getSupabaseBrowserClient()
    ?.auth.signOut({ scope: 'local' })
    .catch(() => undefined)
}
