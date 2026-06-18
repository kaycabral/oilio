import type { EventMeta } from '@/domain/effect/event-store'
import { describe, expect, it } from 'vitest'
import { applyOrgEvent } from './reducer'
import { INITIAL_ORG_STATE, type OrgState } from './types'

const META: EventMeta = {
  version: 1,
  timestamp: '2026-06-18T10:00:00.000Z',
  actorId: 'owner-1',
  schemaVersion: 1,
}

const CREATED_DATA = {
  id: 't1',
  name: 'Barbearia',
  slug: 'barbearia',
  vertical: 'barbershop' as const,
  ownerUserId: 'owner-1',
  branding: { logoUrl: null, bannerUrl: null, description: null },
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
}

// The Org is a pure folder (PRD Identidade v2, context 3): the reducer projects
// only the folder fields — no agenda/self-booking/timezone (those moved to the
// Unit). The `org.self_booking_*` cases were removed entirely.
describe('applyOrgEvent', () => {
  it('org.created overwrites the seed with the folder fields', () => {
    const next = applyOrgEvent(INITIAL_ORG_STATE, { _tag: 'org.created', data: CREATED_DATA }, META)
    expect(next.name).toBe('Barbearia')
    expect(next.vertical).toBe('barbershop')
    expect(next.createdAt).toBe(META.timestamp)
    expect(next._version).toBe(META.version)
    // No agenda/self-booking fields leak onto the Org.
    expect('selfBookingPublished' in next).toBe(false)
    expect('timezone' in next).toBe(false)
  })

  it('org.updated merges partial folder changes', () => {
    const base: OrgState = { ...INITIAL_ORG_STATE, ...CREATED_DATA, _version: 1 }
    const next = applyOrgEvent(
      base,
      { _tag: 'org.updated', changes: { name: 'Barbearia do Zé' } },
      META,
    )
    expect(next.name).toBe('Barbearia do Zé')
    expect(next.slug).toBe('barbearia')
    expect(next.updatedAt).toBe(META.timestamp)
  })

  it('org.deleted leaves the base state (stream preserved, not reprojected)', () => {
    const base: OrgState = { ...INITIAL_ORG_STATE, ...CREATED_DATA, _version: 1 }
    const next = applyOrgEvent(base, { _tag: 'org.deleted' }, META)
    expect(next.name).toBe('Barbearia')
    expect(next._version).toBe(META.version)
  })
})
