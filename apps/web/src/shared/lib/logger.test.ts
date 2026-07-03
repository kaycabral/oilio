import { afterEach, describe, expect, it, vi } from 'vitest'
import { logger } from './logger'
import { runWithRequestContext } from './request-context'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

// Decode a captured console argument (the JSON log line) without leaking `any`:
// the spy hands back `unknown[]`, so narrow the first arg to string before parse.
// Returns a readonly record narrowed via a guard (no assertion) so property reads
// stay type-safe (`entry.severity` etc.) and `toMatchObject` works.
// Type guard: a parsed JSON value is a string-keyed record. Narrowing through a
// guard (not an assertion) keeps the repo's no-unsafe-assertion rule happy.
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function parseLine(arg: unknown): Readonly<Record<string, unknown>> {
  if (typeof arg !== 'string') throw new Error('log line is not a string')
  const parsed: unknown = JSON.parse(arg)
  if (!isRecord(parsed)) throw new Error('log line is not an object')
  return parsed
}

describe('logger', () => {
  it('writes info/debug to stdout as a JSON line with level + message', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    logger.info('hello', { orgId: 'org-1' })
    expect(log).toHaveBeenCalledTimes(1)
    const entry = parseLine(log.mock.calls[0]?.[0])
    expect(entry).toMatchObject({ level: 'info', message: 'hello', orgId: 'org-1' })
    expect(typeof entry.ts).toBe('string')

    logger.debug('dbg')
    expect(parseLine(log.mock.calls[1]?.[0])).toMatchObject({ level: 'debug', message: 'dbg' })
  })

  it('routes warn + error to stderr', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    logger.warn('careful')
    logger.error('boom', { code: '500' })
    expect(err).toHaveBeenCalledTimes(2)
    expect(parseLine(err.mock.calls[0]?.[0])).toMatchObject({ level: 'warn', message: 'careful' })
    expect(parseLine(err.mock.calls[1]?.[0])).toMatchObject({
      level: 'error',
      message: 'boom',
      code: '500',
    })
  })

  it('emits the Cloud Logging `severity` field mapped from the level', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    logger.debug('d')
    logger.info('i')
    logger.warn('w')
    logger.error('e')
    expect(parseLine(log.mock.calls[0]?.[0]).severity).toBe('DEBUG')
    expect(parseLine(log.mock.calls[1]?.[0]).severity).toBe('INFO')
    expect(parseLine(err.mock.calls[0]?.[0]).severity).toBe('WARNING')
    expect(parseLine(err.mock.calls[1]?.[0]).severity).toBe('ERROR')
  })

  it('injects correlationId + orgId from the active request context', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    runWithRequestContext({ correlationId: 'corr-123', orgId: 'org-9' }, () => {
      logger.error('inside scope')
    })
    expect(parseLine(err.mock.calls[0]?.[0])).toMatchObject({
      message: 'inside scope',
      correlationId: 'corr-123',
      orgId: 'org-9',
    })
  })

  it('degrades cleanly with no correlationId when outside any request scope', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    logger.error('no scope')
    const entry = parseLine(err.mock.calls[0]?.[0])
    expect(entry.message).toBe('no scope')
    expect(entry).not.toHaveProperty('correlationId')
    expect(entry).not.toHaveProperty('orgId')
  })

  it('redacts known PII keys in meta (defence in depth)', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    logger.error('leak?', { whatsapp: '+5511999999999', email: 'a@b.com', orgId: 'org-1' })
    const entry = parseLine(err.mock.calls[0]?.[0])
    expect(entry.whatsapp).toBe('[redacted]')
    expect(entry.email).toBe('[redacted]')
    // Non-PII context is preserved.
    expect(entry.orgId).toBe('org-1')
  })

  it('emits a single pretty line (not JSON) in interactive dev', () => {
    vi.stubEnv('NODE_ENV', 'development')
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    logger.error('pretty me', { code: '42' })
    const line: unknown = err.mock.calls[0]?.[0]
    if (typeof line !== 'string') throw new Error('expected a string log line')
    // A pretty line is a bare coloured string, not a JSON object — it neither
    // starts with `{` nor parses as one.
    expect(line.trimStart().startsWith('{')).toBe(false)
    expect(line).toContain('ERROR')
    expect(line).toContain('pretty me')
  })
})
