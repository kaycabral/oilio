import { describe, expect, it } from 'vitest'
import {
  ROLE_SUBJECT_NOUN,
  anonymizedLabel,
  anonymizedSubjectCode,
  buildUserAnonymizationScrub,
  isAnonymized,
  resolveSubjectAvatar,
  resolveSubjectName,
} from './anonymization'

describe('isAnonymized', () => {
  it('is false for a live account', () => {
    expect(isAnonymized({ anonymizedAt: null })).toBe(false)
  })

  it('is true once anonymizedAt is set', () => {
    expect(isAnonymized({ anonymizedAt: '2026-06-03T00:00:00.000Z' })).toBe(true)
  })
})

describe('anonymizedSubjectCode', () => {
  it('is deterministic for a given userId', () => {
    expect(anonymizedSubjectCode('user-abc')).toBe(anonymizedSubjectCode('user-abc'))
  })

  it('derives the exact code (pins the FNV-1a fold + base32 mapping)', () => {
    // Hardcoded expected values — a one-off in the hash loop or alphabet index
    // would shift these.
    expect(anonymizedSubjectCode('user-1')).toBe('MBY6')
    expect(anonymizedSubjectCode('abc')).toBe('B8TF')
  })

  it('returns a 4-char code', () => {
    expect(anonymizedSubjectCode('user-abc')).toHaveLength(4)
  })

  it('uses only the unambiguous base32 alphabet', () => {
    for (const uid of ['user-1', 'user-2', 'abc', 'x'.repeat(40)]) {
      expect(anonymizedSubjectCode(uid)).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}$/)
    }
  })

  it('differs across distinct userIds (no trivial collisions)', () => {
    const codes = new Set(Array.from({ length: 50 }, (_, i) => anonymizedSubjectCode(`user-${i}`)))
    // Not a guarantee of zero collisions, but the spread should be wide.
    expect(codes.size).toBeGreaterThan(40)
  })
})

describe('anonymizedLabel', () => {
  it('composes `‹Noun› ‹CODE›`', () => {
    const code = anonymizedSubjectCode('user-abc')
    expect(anonymizedLabel('user-abc', 'Cliente')).toBe(`Cliente ${code}`)
  })

  it('has no "removido"/reason — transparent label only', () => {
    expect(anonymizedLabel('user-abc', 'Profissional')).not.toMatch(/removido/i)
  })
})

describe('resolveSubjectName', () => {
  it('returns the live name for a non-anonymized account', () => {
    expect(resolveSubjectName('u1', { displayName: 'Maria', anonymizedAt: null }, 'Cliente')).toBe(
      'Maria',
    )
  })

  it('returns the neutral label for an anonymized account', () => {
    const code = anonymizedSubjectCode('u1')
    expect(
      resolveSubjectName(
        'u1',
        { displayName: null, anonymizedAt: '2026-06-03T00:00:00.000Z' },
        'Cliente',
      ),
    ).toBe(`Cliente ${code}`)
  })

  it('keeps two anonymized subjects distinct', () => {
    const a = resolveSubjectName('user-a', { displayName: null, anonymizedAt: 'x' }, 'Cliente')
    const b = resolveSubjectName('user-b', { displayName: null, anonymizedAt: 'x' }, 'Cliente')
    expect(a).not.toBe(b)
  })

  it('returns null when the account doc is missing', () => {
    expect(resolveSubjectName('u1', undefined, 'Cliente')).toBeNull()
  })

  it('uses the per-surface role noun', () => {
    const code = anonymizedSubjectCode('u1')
    expect(
      resolveSubjectName(
        'u1',
        { displayName: null, anonymizedAt: 'x' },
        ROLE_SUBJECT_NOUN.receptionist,
      ),
    ).toBe(`Recepção ${code}`)
  })

  // Per-org blocking (LGPD art. 18 "bloqueio") — brief 0032 / #1096, AC-09.
  it('returns the neutral label when blockedInOrg on a non-anonymized account', () => {
    const code = anonymizedSubjectCode('u1')
    expect(
      resolveSubjectName('u1', { displayName: 'Maria', anonymizedAt: null }, 'Cliente', {
        blockedInOrg: true,
      }),
    ).toBe(`Cliente ${code}`)
  })

  it('keeps the live displayName when blockedInOrg is false', () => {
    expect(
      resolveSubjectName('u1', { displayName: 'Maria', anonymizedAt: null }, 'Cliente', {
        blockedInOrg: false,
      }),
    ).toBe('Maria')
  })

  it('keeps the live displayName when opts is absent (default not blocked)', () => {
    expect(resolveSubjectName('u1', { displayName: 'Maria', anonymizedAt: null }, 'Cliente')).toBe(
      'Maria',
    )
  })

  it('anonymized account still wins even with blockedInOrg false', () => {
    const code = anonymizedSubjectCode('u1')
    expect(
      resolveSubjectName('u1', { displayName: null, anonymizedAt: 'x' }, 'Cliente', {
        blockedInOrg: false,
      }),
    ).toBe(`Cliente ${code}`)
  })
})

describe('ROLE_SUBJECT_NOUN', () => {
  it('maps every role to its human-facing noun', () => {
    expect(ROLE_SUBJECT_NOUN).toEqual({
      owner: 'Dono',
      manager: 'Gerente',
      member_operator: 'Profissional',
      receptionist: 'Recepção',
    })
  })
})

describe('resolveSubjectAvatar', () => {
  it('returns null when the account doc is missing', () => {
    expect(resolveSubjectAvatar(undefined)).toBeNull()
  })

  it('blanks the photo for an anonymized account', () => {
    expect(resolveSubjectAvatar({ avatarUrl: 'https://x/a.png', anonymizedAt: 'x' })).toBeNull()
  })

  it('blanks the photo when blockedInOrg (re-identification vector)', () => {
    expect(
      resolveSubjectAvatar(
        { avatarUrl: 'https://x/a.png', anonymizedAt: null },
        { blockedInOrg: true },
      ),
    ).toBeNull()
  })

  it('keeps the live photo for a non-anonymized, non-blocked account', () => {
    expect(resolveSubjectAvatar({ avatarUrl: 'https://x/a.png', anonymizedAt: null })).toBe(
      'https://x/a.png',
    )
    expect(
      resolveSubjectAvatar(
        { avatarUrl: 'https://x/a.png', anonymizedAt: null },
        { blockedInOrg: false },
      ),
    ).toBe('https://x/a.png')
  })
})

describe('buildUserAnonymizationScrub', () => {
  it('nulls every PII field and stamps anonymizedAt', () => {
    const now = '2026-06-03T12:00:00.000Z'
    const scrub = buildUserAnonymizationScrub(now)
    expect(scrub).toEqual({
      displayName: null,
      mobile: null,
      email: null,
      birthDate: null,
      taxIdentity: null,
      bio: null,
      specialties: null,
      avatarUrl: null,
      anonymizedAt: now,
      updatedAt: now,
    })
  })

  it('holds no field that could reconstruct the old identity', () => {
    const scrub = buildUserAnonymizationScrub('2026-06-03T12:00:00.000Z')
    const piiFields = ['displayName', 'mobile', 'email', 'birthDate', 'taxIdentity'] as const
    for (const field of piiFields) {
      expect(scrub[field]).toBeNull()
    }
  })
})
