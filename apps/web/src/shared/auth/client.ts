import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabasePublicConfig } from './config'

export function getSupabaseBrowserClient(): SupabaseClient | null {
  const config = supabasePublicConfig()
  return config ? createBrowserClient(config.url, config.key) : null
}
