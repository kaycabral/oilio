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

const nextConfig: NextConfig = {
  typedRoutes: true,
  // Pin the dev overlay to the bottom-right (default is bottom-left, which
  // overlaps the app's own bottom-left UI in dev).
  devIndicators: { position: 'bottom-right' },
  // Firebase Auth on a custom domain: signInWithRedirect needs the sign-in
  // helper (handler + iframe + init.json) served same-origin as the app, or the
  // browser partitions the authDomain iframe's storage and getRedirectResult
  // hangs forever. We set authDomain=oilio.com.br (build arg) and reverse-proxy
  // the helper paths to the project's firebaseapp.com domain — the Firebase-
  // recommended self-hosting approach for redirect on a custom domain.
  // Harmless in dev (emulator wiring overrides authDomain, so these are unused).
  async rewrites() {
    const firebaseAppDomain = 'https://cbrl-oilio-production.firebaseapp.com'
    return [
      { source: '/__/auth/:path*', destination: `${firebaseAppDomain}/__/auth/:path*` },
      { source: '/__/firebase/:path*', destination: `${firebaseAppDomain}/__/firebase/:path*` },
    ]
  },
  // Next dev blocks cross-origin requests to /_next/* by default — when the
  // requesting origin isn't allowlisted, HMR/RSC streams land on the wrong origin
  // and React hydration silently stalls (click handlers never attach: the page
  // renders but every button is inert). So allow every host we reach the dev
  // server by: 127.0.0.1 (Playwright), ideapad.local (mDNS), and the machine's
  // current LAN IPs (phone/tablet testing by IP — resolved live so DHCP changes
  // don't break it). See incident: LAN smoke login "did nothing" (#1273).
  allowedDevOrigins: ['127.0.0.1', mdnsHost(), ...lanIPv4()],
  // App Hosting copies `.next/standalone` into the Cloud Run image. Set
  // explicitly so the standalone artifacts always land, regardless of which
  // builder produced them.
  output: 'standalone',
  // No `outputFileTracingRoot` pin: with Turborepo (turbo.json at the repo root),
  // the App Hosting buildpack switches into its Turborepo runner, which expects
  // the standalone bundle laid out as `apps/web/.next/standalone/apps/web/.next/...`
  // (workspace prefix preserved). Letting Next auto-detect the monorepo root from
  // the lockfile produces exactly that layout, so the adapter can locate the
  // routes manifest.
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
