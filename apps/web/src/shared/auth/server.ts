import 'server-only'

import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { supabasePublicConfig } from './config'

export async function createSupabaseServerClient(): Promise<SupabaseClient | null> {
  const config = supabasePublicConfig()
  if (!config) return null
  const cookieStore = await cookies()
  return createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          return
        }
      },
    },
  })
}
