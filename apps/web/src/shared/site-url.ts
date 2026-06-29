import { headers } from 'next/headers'
import 'server-only'

// Resolve the absolute base URL (`https://host`, no trailing slash) for building
// public links/QRs server-side. Prefers the explicit `NEXT_PUBLIC_SITE_URL`
// (canonical in prod), then the forwarded host headers (behind the Cloud Run
// proxy), then a localhost dev fallback. Extracted from `UnitBookingQr` (#1279)
// so the contextual-invite action and the QR share ONE resolution rule.
export async function resolveBaseUrl(): Promise<string> {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL
  if (fromEnv) return stripTrailingSlash(fromEnv)
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'http'
  if (host) return `${proto}://${host}`
  return 'http://localhost:3005'
}

function stripTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s
}
