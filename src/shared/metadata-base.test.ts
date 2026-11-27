import { describe, expect, it } from 'vitest'
import { metadataBase } from './metadata-base'

describe('metadataBase', () => {
  it('prefers the configured site url', () => {
    expect(metadataBase('https://www.oilio.com.br', 'oilio.vercel.app').href).toBe(
      'https://www.oilio.com.br/',
    )
  })

  it('falls back to the Vercel production host', () => {
    expect(metadataBase('', 'oilio.vercel.app').href).toBe('https://oilio.vercel.app/')
  })

  it('falls back to the local dev server', () => {
    expect(metadataBase('', '').href).toBe('http://localhost:3005/')
  })
})
