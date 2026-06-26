import { NextResponse } from 'next/server'

// Liveness + deploy-verification endpoint. Post-deploy smoke polls this until
// `commit` matches the SHA that was just rolled out, proving the new revision
// is actually serving traffic before the pipeline declares success.
//
// `GIT_COMMIT_SHA` is injected at deploy time (`gcloud run deploy
// --set-env-vars=GIT_COMMIT_SHA=$CI_COMMIT_SHA`), so it reflects the running
// revision — not a build-time bake. Must be dynamic: a cached/prerendered
// response would pin a stale commit forever.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export function GET() {
  return NextResponse.json({
    status: 'ok',
    commit: process.env.GIT_COMMIT_SHA ?? null,
    time: new Date().toISOString(),
  })
}
