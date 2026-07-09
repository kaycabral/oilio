import { afterEach, describe, expect, it, vi } from 'vitest'
import { logger } from './logger'
import { runWithRequestContext } from './request-context'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

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

  it('serializes an Error in meta to name/message/stack instead of {}', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const boom = new Error('duplicate key on org_links_pkey')
    logger.error('transaction defect', { scope: 'commitSaga', defect: boom })
    const entry = parseLine(err.mock.calls[0]?.[0])
    const defect = entry.defect
    if (!isRecord(defect)) throw new Error('defect should serialize to an object')
    expect(defect.message).toBe('duplicate key on org_links_pkey')
    expect(defect.name).toBe('Error')
    expect(typeof defect.stack).toBe('string')
  })

  it('surfaces a pg SQLSTATE (code) but never the PII-bearing detail', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const pgErr = Object.assign(new Error('unique violation'), {
      code: '23505',
      detail: 'Key (whatsapp)=(+5511999999999) already exists',
    })
    logger.error('write failed', { scope: 'x', err: pgErr })
    const entry = parseLine(err.mock.calls[0]?.[0])
    const serialized = entry.err
    if (!isRecord(serialized)) throw new Error('err should serialize to an object')
    expect(serialized.code).toBe('23505')
    expect(serialized).not.toHaveProperty('detail')
    expect(JSON.stringify(entry)).not.toContain('5511999999999')
  })

  it('redacts known PII keys in meta (defence in depth), recursively', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    logger.error('leak?', {
      whatsapp: '+5511999999999',
      mobile: '5511988887777',
      email: 'a@b.com',
      orgId: 'org-1',
      nested: { email: 'deep@b.com', ok: 'keep' },
    })
    const entry = parseLine(err.mock.calls[0]?.[0])
    expect(entry.whatsapp).toBe('[redacted]')
    expect(entry.mobile).toBe('[redacted]')
    expect(entry.email).toBe('[redacted]')
    const nested = entry.nested
    if (!isRecord(nested)) throw new Error('nested should be an object')
    expect(nested.email).toBe('[redacted]')
    expect(nested.ok).toBe('keep')
    expect(entry.orgId).toBe('org-1')
  })

  it('emits a single pretty line (not JSON) in interactive dev', () => {
    vi.stubEnv('NODE_ENV', 'development')
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    logger.error('pretty me', { code: '42' })
    const line: unknown = err.mock.calls[0]?.[0]
    if (typeof line !== 'string') throw new Error('expected a string log line')
    expect(line.trimStart().startsWith('{')).toBe(false)
    expect(line).toContain('ERROR')
    expect(line).toContain('pretty me')
  })
})
