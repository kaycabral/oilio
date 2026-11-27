import { cspDirectives, devOrigins, withSecurityHeaders } from '@cbrl/next/config'
import { withSentryConfig } from '@sentry/nextjs/config'
import type { NextConfig } from 'next'

// Defense in depth. The browser only talks to Supabase Auth
// (Google sign-in is a full-page redirect: no Google script or frame) and to
// same-origin routes (Sentry goes through /monitoring-tunnel). Stripe Checkout
// and the Billing Portal are top-level redirects after a form post. The CSP
// ships report-only (violations reach /api/csp-report) until it has run clean
// in production.
const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
  : 'https://*.supabase.co'

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  typedRoutes: true,
  // Pin the dev overlay to the bottom-right (default is bottom-left, which
  // overlaps the app's own bottom-left UI in dev).
  devIndicators: { position: 'bottom-right' },
  // Next dev blocks cross-origin requests to /_next/* by default — when the
  // requesting origin isn't allowlisted, HMR/RSC streams land on the wrong origin
  // and React hydration silently stalls (click handlers never attach: the page
  // renders but every button is inert). So allow every host we reach the dev
  // server by: 127.0.0.1 (Playwright), <host>.local (mDNS), and the machine's
  // current LAN IPs (phone/tablet testing by IP — resolved live so DHCP changes
  // don't break it). See incident: LAN smoke login "did nothing" (#1273).
  allowedDevOrigins: process.env.NODE_ENV === 'production' ? [] : devOrigins(),
}

export default withSentryConfig(
  withSecurityHeaders(nextConfig, {
    csp: cspDirectives({
      'connect-src': [supabaseOrigin],
      'form-action': ['https://checkout.stripe.com', 'https://billing.stripe.com'],
    }),
    cspMode: 'report-only',
    reportPath: '/api/csp-report',
  }),
  {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    silent: !process.env.CI,
    tunnelRoute: '/monitoring-tunnel',
    sourcemaps: { deleteSourcemapsAfterUpload: true },
    telemetry: false,
  },
)
