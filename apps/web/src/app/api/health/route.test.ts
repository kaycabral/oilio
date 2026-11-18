import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ query: vi.fn() }))

vi.mock('@/shared/db/pg/pool', () => ({
  getEventStorePool: () => ({ query: mocks.query }),
}))

import { GET } from './route'

type HealthBody = { status: string; database: string; commit: string | null; time: string }

function isHealthBody(value: unknown): value is HealthBody {
  if (typeof value !== 'object' || value === null) return false
  const record: Record<string, unknown> = { ...value }
  return (
    typeof record.status === 'string' &&
    typeof record.database === 'string' &&
    (record.commit === null || typeof record.commit === 'string') &&
    typeof record.time === 'string'
  )
}

async function readHealthBody(res: Response): Promise<HealthBody> {
  const parsed: unknown = await res.json()
  if (!isHealthBody(parsed)) throw new Error('unexpected health body shape')
  return parsed
}

beforeEach(() => {
  mocks.query.mockReset()
  mocks.query.mockResolvedValue({ rows: [{ '?column?': 1 }] })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('GET /api/health', () => {
  it('reports ok with the database up and an ISO timestamp', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await readHealthBody(res)
    expect(body.status).toBe('ok')
    expect(body.database).toBe('up')
    expect(mocks.query).toHaveBeenCalledWith('SELECT 1')
    expect(() => new Date(body.time).toISOString()).not.toThrow()
  })

  it('answers 503 degraded when Postgres is unreachable', async () => {
    mocks.query.mockRejectedValue(new Error('ECONNREFUSED'))
    const res = await GET()
    expect(res.status).toBe(503)
    const body = await readHealthBody(res)
    expect(body.status).toBe('degraded')
    expect(body.database).toBe('down')
  })

  it('echoes the deployed revision from VERCEL_GIT_COMMIT_SHA', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc123')
    const body = await readHealthBody(await GET())
    expect(body.commit).toBe('abc123')
  })

  it('reports commit null outside Vercel', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', undefined)
    const body = await readHealthBody(await GET())
    expect(body.commit).toBeNull()
  })
})
