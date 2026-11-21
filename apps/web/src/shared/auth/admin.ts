import 'server-only'

import { requireEnv } from '@cbrl/env'
import { supabasePublicConfig } from '@cbrl/supabase'
import { createClient } from '@supabase/supabase-js'

function adminClient() {
  const config = supabasePublicConfig()
  if (!config) throw new Error('Supabase is not configured')
  return createClient(config.url, requireEnv('SUPABASE_SECRET_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function deleteAuthUser(authUserId: string): Promise<void> {
  const { error } = await adminClient().auth.admin.deleteUser(authUserId)
  if (error && error.status !== 404) throw error
}
