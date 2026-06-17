import type { NextConfig } from 'next'

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
  // Playwright runs against http://127.0.0.1:3005 (see playwright.config.ts).
  // Next dev blocks cross-origin requests to /_next/* by default — without
  // 127.0.0.1 here, HMR/RSC streams from Playwright land on the wrong origin
  // and React hydration silently stalls (click handlers never attach).
  allowedDevOrigins: ['127.0.0.1', 'ideapad.local'],
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

export default nextConfig
