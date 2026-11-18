export type SupabasePublicConfig = {
  url: string
  key: string
}

export function supabasePublicConfig(): SupabasePublicConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  return url && key ? { url, key } : null
}

export function isAuthConfigured(): boolean {
  return supabasePublicConfig() !== null
}
