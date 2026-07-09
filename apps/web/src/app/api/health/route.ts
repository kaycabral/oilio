import { withRequestContext } from '@/shared/lib/request-context'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function getHandler() {
  return NextResponse.json({
    status: 'ok',
    commit: process.env.GIT_COMMIT_SHA ?? null,
    time: new Date().toISOString(),
  })
}

export const GET = withRequestContext(getHandler)
