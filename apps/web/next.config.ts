import { withSentryConfig } from '@sentry/nextjs'
import type { NextConfig } from 'next'
import { hostname, networkInterfaces } from 'node:os'

// Every non-internal IPv4 of this machine — so `next dev` accepts /_next/* over
// the LAN by the host's current IP, not just a hardcoded one (DHCP changes it).
// Dev-only; empty in prod builds where it's unused.
function lanIPv4(): string[] {
  if (process.env.NODE_ENV === 'production') return []
  return Object.values(networkInterfaces())
    .flat()
    .filter((i): i is NonNullable<typeof i> => !!i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address)
}

// This machine's mDNS name (`<host>.local`) — the canonical dev base for
// links/QRs (see `local-up.mjs` → NEXT_PUBLIC_SITE_URL). Derived per-machine so
// a clone elsewhere allowlists its own host, not a hardcoded one. Lowercased to
// match the origin string (origin checks are case-sensitive).
function mdnsHost(): string {
  return `${hostname().toLowerCase()}.local`
}

// Defense in depth (see SECURITY.md). The browser only talks to Supabase Auth
// (Google sign-in is a full-page redirect: no Google script or frame) and to
// same-origin routes (Sentry goes through /monitoring-tunnel). Stripe Checkout
// and the Billing Portal are top-level redirects after a form post. The CSP
// ships report-only until it has run clean in production.
const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
  : 'https://*.supabase.co'
const cspReportOnly = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseOrigin}`,
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://checkout.stripe.com https://billing.stripe.com",
].join('; ')

const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  { key: 'Content-Security-Policy-Report-Only', value: cspReportOnly },
]

const nextConfig: NextConfig = {
  typedRoutes: true,
  poweredByHeader: false,
  // Pin the dev overlay to the bottom-right (default is bottom-left, which
  // overlaps the app's own bottom-left UI in dev).
  devIndicators: { position: 'bottom-right' },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
  // Next dev blocks cross-origin requests to /_next/* by default — when the
  // requesting origin isn't allowlisted, HMR/RSC streams land on the wrong origin
  // and React hydration silently stalls (click handlers never attach: the page
  // renders but every button is inert). So allow every host we reach the dev
  // server by: 127.0.0.1 (Playwright), ideapad.local (mDNS), and the machine's
  // current LAN IPs (phone/tablet testing by IP — resolved live so DHCP changes
  // don't break it). See incident: LAN smoke login "did nothing" (#1273).
  allowedDevOrigins: ['127.0.0.1', mdnsHost(), ...lanIPv4()],
}

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  tunnelRoute: '/monitoring-tunnel',
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  telemetry: false,
})
