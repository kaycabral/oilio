import { getEventStorePool } from '@/shared/db/pg/pool'
import { withRequestContext } from '@/shared/lib/request-context'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function databaseReachable(): Promise<boolean> {
  try {
    await getEventStorePool().query('SELECT 1')
    return true
  } catch {
    return false
  }
}

async function getHandler() {
  const database = await databaseReachable()
  return NextResponse.json(
    {
      status: database ? 'ok' : 'degraded',
      database: database ? 'up' : 'down',
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      time: new Date().toISOString(),
    },
    { status: database ? 200 : 503 },
  )
}

export const GET = withRequestContext(getHandler)
