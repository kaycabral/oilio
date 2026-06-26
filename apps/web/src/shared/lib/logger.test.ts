import { afterEach, describe, expect, it, vi } from 'vitest'
import { logger } from './logger'

afterEach(() => {
  vi.restoreAllMocks()
})

// Decode a captured console argument (the JSON log line) without leaking `any`:
// the spy hands back `unknown[]`, so narrow the first arg to string before parse.
function parseLine(arg: unknown): { ts?: unknown } & object {
  if (typeof arg !== 'string') throw new Error('log line is not a string')
  const parsed: unknown = JSON.parse(arg)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('log line is not an object')
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
})
