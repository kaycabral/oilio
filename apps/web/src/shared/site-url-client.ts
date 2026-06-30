// Client-side twin of `resolveBaseUrl` (server). Public links built in the
// browser (the contextual invite) must resolve the SAME base the server uses, so
// the link matches whether it's built server- or client-side. `NEXT_PUBLIC_SITE_URL`
// is a public env (inlined at build), so we prefer it exactly like the server,
// then fall back to the current origin. No `server-only` — this runs in the browser.
export function resolveBaseUrlClient(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL
  if (fromEnv) return fromEnv.endsWith('/') ? fromEnv.slice(0, -1) : fromEnv
  if (typeof window !== 'undefined') return window.location.origin
  return 'http://localhost:3005'
}
