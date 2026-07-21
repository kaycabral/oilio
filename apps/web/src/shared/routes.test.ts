import { describe, expect, it } from 'vitest'
import { isSafeInternalPath, safeNext } from './routes'

describe('isSafeInternalPath', () => {
  it('accepts internal absolute paths', () => {
    expect(isSafeInternalPath('/dashboard')).toBe(true)
    expect(isSafeInternalPath('/agenda?tab=today')).toBe(true)
    expect(isSafeInternalPath('/me/appointments')).toBe(true)
  })

  it('rejects protocol-relative URLs', () => {
    expect(isSafeInternalPath('//evil.com')).toBe(false)
    expect(isSafeInternalPath('//evil.com/path')).toBe(false)
  })

  it('rejects backslash-prefixed paths some browsers normalize to //', () => {
    expect(isSafeInternalPath('/\\evil.com')).toBe(false)
  })

  it('rejects absolute URLs to other origins', () => {
    expect(isSafeInternalPath('https://evil.com')).toBe(false)
    expect(isSafeInternalPath('http://evil.com')).toBe(false)
  })

  it('rejects non-string and empty input', () => {
    expect(isSafeInternalPath(undefined)).toBe(false)
    expect(isSafeInternalPath(null)).toBe(false)
    expect(isSafeInternalPath('')).toBe(false)
    expect(isSafeInternalPath('dashboard')).toBe(false)
  })
})

describe('safeNext', () => {
  it('returns the path when internal', () => {
    expect(safeNext('/agenda')).toBe('/agenda')
  })

  it('falls back to /dashboard for hostile or absent input', () => {
    expect(safeNext('https://evil.com')).toBe('/dashboard')
    expect(safeNext('//evil.com')).toBe('/dashboard')
    expect(safeNext('/\\evil.com')).toBe('/dashboard')
    expect(safeNext(undefined)).toBe('/dashboard')
    expect(safeNext(null)).toBe('/dashboard')
  })

  it('honors a custom fallback', () => {
    expect(safeNext('https://evil.com', '/me/appointments')).toBe('/me/appointments')
  })
})
