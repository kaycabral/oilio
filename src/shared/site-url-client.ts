export function resolveBaseUrlClient(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL
  if (fromEnv) return fromEnv.endsWith('/') ? fromEnv.slice(0, -1) : fromEnv
  if (typeof window !== 'undefined') return window.location.origin
  return 'http://localhost:3005'
}
