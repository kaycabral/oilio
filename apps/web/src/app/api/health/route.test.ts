import { afterEach, describe, expect, it, vi } from 'vitest'

import { GET } from './route'

type HealthBody = { status: string; commit: string | null; time: string }

function isHealthBody(value: unknown): value is HealthBody {
  if (typeof value !== 'object' || value === null) return false
  const record: Record<string, unknown> = { ...value }
  return (
    typeof record.status === 'string' &&
    (record.commit === null || typeof record.commit === 'string') &&
    typeof record.time === 'string'
  )
}

async function readHealthBody(res: Response): Promise<HealthBody> {
  const parsed: unknown = await res.json()
  if (!isHealthBody(parsed)) throw new Error('unexpected health body shape')
  return parsed
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('GET /api/health', () => {
  it('reports ok with an ISO timestamp', async () => {
    const res = GET()
    expect(res.status).toBe(200)
    const body = await readHealthBody(res)
    expect(body.status).toBe('ok')
    expect(() => new Date(body.time).toISOString()).not.toThrow()
  })

  it('echoes the running revision from GIT_COMMIT_SHA', async () => {
    vi.stubEnv('GIT_COMMIT_SHA', 'abc123')
    const body = await readHealthBody(GET())
    expect(body.commit).toBe('abc123')
  })

  it('reports commit null when the SHA is not injected', async () => {
    vi.stubEnv('GIT_COMMIT_SHA', undefined)
    const body = await readHealthBody(GET())
    expect(body.commit).toBeNull()
  })
})
