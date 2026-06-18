import { describe, expect, it } from 'vitest'

import type { User } from '@/domain'
import { buildMatrizUnit, matrizSlugCandidates, resolveMatrizPii } from './matriz'

function owner(opts: { whatsapp: string | null; email: string | null }): User {
  const common = {
    uid: 'u',
    email: opts.email,
    displayName: 'Owner',
    avatarUrl: null,
    emailVerified: true,
    currentOrgId: null,
    taxIdentity: null,
    bio: null,
    specialties: null,
    claimedAt: null,
    anonymizedAt: null,
    termsAcceptedAt: null,
    termsVersion: null,
    privacyAcceptedAt: null,
    privacyVersion: null,
    createdAt: 'now',
    updatedAt: 'now',
  } as const
  if (opts.whatsapp === null) {
    // Incomplete branch — no whatsapp yet (the state the gate normally prevents).
    return { ...common, completionCompleted: false, whatsapp: null, birthDate: null }
  }
  return { ...common, completionCompleted: true, whatsapp: opts.whatsapp, birthDate: '1990-01-01' }
}

describe('matrizSlugCandidates', () => {
  it('derives the slug from the org name as the first candidate', () => {
    const out = matrizSlugCandidates('Barbearia do João', 20)
    expect(out[0]).toBe('barbearia-do-joao')
  })

  it('appends -2, -3, … as fallbacks in order', () => {
    const out = matrizSlugCandidates('Centro', 3)
    expect(out).toEqual(['centro', 'centro-2', 'centro-3'])
  })

  it('falls back to "unidade" when the name slugifies to empty', () => {
    const out = matrizSlugCandidates('!!!', 5)
    expect(out[0]).toBe('unidade')
  })

  it('escapes a reserved base by suffixing -1', () => {
    // "book" is a reserved unit slug — the base must be escaped, never offered raw.
    const out = matrizSlugCandidates('Book', 5)
    expect(out).not.toContain('book')
    expect(out[0]).toBe('book-1')
  })

  it('returns at most maxAttempts candidates', () => {
    expect(matrizSlugCandidates('Loja', 4)).toHaveLength(4)
    expect(matrizSlugCandidates('Loja', 0)).toHaveLength(0)
  })
})

describe('buildMatrizUnit', () => {
  it('shapes a StoredUnit with the org name, informal address/hours and no PII', () => {
    const unit = buildMatrizUnit({
      unitId: 'u1',
      orgId: 'o1',
      name: 'Barbearia do João',
      slug: 'barbearia-do-joao',
      now: '2026-06-18T00:00:00.000Z',
    })
    expect(unit).toEqual({
      id: 'u1',
      orgId: 'o1',
      name: 'Barbearia do João',
      slug: 'barbearia-do-joao',
      address: null,
      businessHours: null,
      archivedAt: null,
      createdAt: '2026-06-18T00:00:00.000Z',
      updatedAt: '2026-06-18T00:00:00.000Z',
    })
    // PII channels are NOT part of the projection (they live in units_pii).
    expect(Object.keys(unit)).not.toContain('whatsapp')
    expect(Object.keys(unit)).not.toContain('email')
  })
})

describe('resolveMatrizPii', () => {
  it('derives whatsapp + email from a completed owner profile', () => {
    const result = resolveMatrizPii(owner({ whatsapp: '5511988887777', email: 'o@x.com' }))
    expect(result).toEqual({ ok: true, pii: { whatsapp: '5511988887777', email: 'o@x.com' } })
  })

  it('keeps email null when the owner has none', () => {
    const result = resolveMatrizPii(owner({ whatsapp: '5511988887777', email: null }))
    expect(result).toEqual({ ok: true, pii: { whatsapp: '5511988887777', email: null } })
  })

  it('refuses (never empty PII) when the owner has no whatsapp', () => {
    const result = resolveMatrizPii(owner({ whatsapp: null, email: 'o@x.com' }))
    expect(result).toEqual({
      ok: false,
      error: 'Complete seu perfil (WhatsApp) antes de criar a empresa.',
    })
  })

  it('refuses when the owner doc is missing', () => {
    const result = resolveMatrizPii(null)
    expect(result.ok).toBe(false)
  })
})
