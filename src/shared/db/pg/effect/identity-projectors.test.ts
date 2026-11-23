import { MembershipConfig } from '@/domain/aggregates/membership/config'
import { aggregateRef } from '@/domain/effect'
import { defaultPermissionsForRole, type Membership } from '@/domain/types/membership'
import { DEFAULT_ORG_BRANDING, type StoredOrg } from '@/domain/types/org'
import { EMPTY_ADDRESS, type StoredUnit } from '@/domain/types/unit'
import { describe, expect, it } from 'vitest'
import {
  MEMBERSHIP_COLUMNS,
  membershipColumnValues,
  rowToDoc as membershipRowToDoc,
  type MembershipRow,
} from './membership-projector'
import { ORG_COLUMNS, orgColumnValues, rowToDoc as orgRowToDoc, type OrgRow } from './org-projector'
import {
  UNIT_COLUMNS,
  unitColumnValues,
  rowToDoc as unitRowToDoc,
  type UnitRow,
} from './unit-projector'

function valueAt(columns: readonly string[], values: readonly unknown[], col: string): unknown {
  return values[columns.indexOf(col)]
}
function asPgBigint(v: unknown): string {
  return String(v)
}

function orgRow(o: StoredOrg, version: number): OrgRow {
  const v = orgColumnValues(o, version)
  const at = (c: string): unknown => valueAt(ORG_COLUMNS, v, c)
  return {
    org_id: o.id,
    id: o.id,
    last_event_version: asPgBigint(at('last_event_version')),
    name: o.name,
    slug: o.slug,
    vertical: o.vertical,
    website: typeof at('website') === 'string' ? String(at('website')) : null,
    owner_user_id: o.ownerUserId,
    branding: at('branding'),
    created_at: o.createdAt,
    updated_at: o.updatedAt,
  }
}

function membershipRow(m: Membership, version: number): MembershipRow {
  const v = membershipColumnValues(m, aggregateRef(MembershipConfig, m.orgId, m.id), version)
  const at = (c: string): unknown => valueAt(MEMBERSHIP_COLUMNS, v, c)
  return {
    org_id: m.orgId,
    id: m.id,
    user_id: m.userId,
    last_event_version: asPgBigint(at('last_event_version')),
    role: m.role,
    status: m.status,
    rls_unit_scope: m.rlsUnitScope,
    invited_by: m.invitedBy,
    joined_at: m.joinedAt,
    permissions: at('permissions'),
    updated_at: m.updatedAt,
  }
}

function unitRow(u: StoredUnit, version: number): UnitRow {
  const v = unitColumnValues(u, version)
  const at = (c: string): unknown => valueAt(UNIT_COLUMNS, v, c)
  return {
    org_id: u.orgId,
    id: u.id,
    last_event_version: asPgBigint(at('last_event_version')),
    name: u.name,
    slug: u.slug,
    timezone: u.timezone,
    archived_at: u.archivedAt,
    agenda_mode: u.agenda.mode,
    fiscal_kind: u.fiscal.kind,
    address: at('address'),
    agenda: at('agenda'),
    fiscal: at('fiscal'),
    created_at: u.createdAt,
    updated_at: u.updatedAt,
  }
}

describe('org projector — pure mapping', () => {
  const org: StoredOrg = {
    id: 'org-1',
    name: 'Barbearia',
    slug: 'barbearia',
    vertical: 'barbershop',
    website: null,
    ownerUserId: 'owner-1',
    branding: { ...DEFAULT_ORG_BRANDING },
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  }

  it('columnValues has one value per column, org_id = id', () => {
    const values = orgColumnValues(org, 1)
    expect(values).toHaveLength(ORG_COLUMNS.length)
    expect(values[ORG_COLUMNS.indexOf('org_id')]).toBe('org-1')
    expect(values[ORG_COLUMNS.indexOf('id')]).toBe('org-1')
    expect(values[ORG_COLUMNS.indexOf('vertical')]).toBe('barbershop')
  })

  it('rowToDoc round-trips the org fields (+ _version)', () => {
    const doc = orgRowToDoc(orgRow(org, 3))
    expect(doc).toMatchObject({
      _version: 3,
      id: 'org-1',
      name: 'Barbearia',
      slug: 'barbearia',
      vertical: 'barbershop',
      ownerUserId: 'owner-1',
    })
    expect('website' in doc).toBe(false)
  })

  it('rowToDoc re-attaches a present website', () => {
    expect(orgRowToDoc(orgRow({ ...org, website: 'https://x.com' }, 1)).website).toBe(
      'https://x.com',
    )
  })
})

describe('membership projector — pure mapping', () => {
  const membership: Membership = {
    id: 'org-1_user-1',
    orgId: 'org-1',
    userId: 'user-1',
    role: 'member_operator',
    status: 'active',
    invitedBy: null,
    joinedAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    rlsUnitScope: 'unit-1',
    permissions: defaultPermissionsForRole('member_operator'),
  }

  it('columnValues has one value per column', () => {
    const values = membershipColumnValues(
      membership,
      aggregateRef(MembershipConfig, 'org-1', 'org-1_user-1'),
      1,
    )
    expect(values).toHaveLength(MEMBERSHIP_COLUMNS.length)
    expect(values[MEMBERSHIP_COLUMNS.indexOf('user_id')]).toBe('user-1')
    expect(values[MEMBERSHIP_COLUMNS.indexOf('rls_unit_scope')]).toBe('unit-1')
  })

  it('rowToDoc round-trips role/unit', () => {
    const doc = membershipRowToDoc(membershipRow(membership, 2))
    expect(doc).toMatchObject({
      _version: 2,
      userId: 'user-1',
      role: 'member_operator',
      rlsUnitScope: 'unit-1',
    })
  })

  it('rowToDoc preserves null unit scope for an org-wide owner', () => {
    const owner: Membership = {
      ...membership,
      role: 'owner',
      rlsUnitScope: null,
      permissions: defaultPermissionsForRole('owner'),
    }
    const doc = membershipRowToDoc(membershipRow(owner, 1))
    expect(doc.rlsUnitScope).toBeNull()
  })
})

describe('unit projector — pure mapping', () => {
  const baseUnit: StoredUnit = {
    id: 'unit-1',
    orgId: 'org-1',
    name: 'Centro',
    slug: 'centro',
    address: {
      ...EMPTY_ADDRESS,
      postalCode: '01001000',
      state: 'SP',
      city: 'São Paulo',
      neighborhood: 'Centro',
      street: 'Praça da Sé',
    },
    timezone: 'America/Sao_Paulo',
    agenda: {
      mode: 'fixed',
      businessHours: {
        monday: null,
        tuesday: null,
        wednesday: null,
        thursday: null,
        friday: null,
        saturday: null,
        sunday: null,
      },
    },
    archivedAt: null,
    fiscal: { kind: 'informal' },
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  }

  it('columnValues lifts the agenda/fiscal discriminants to columns', () => {
    const values = unitColumnValues(baseUnit, 1)
    expect(values).toHaveLength(UNIT_COLUMNS.length)
    expect(values[UNIT_COLUMNS.indexOf('agenda_mode')]).toBe('fixed')
    expect(values[UNIT_COLUMNS.indexOf('fiscal_kind')]).toBe('informal')
  })

  it('rowToDoc round-trips a fixed-agenda informal unit', () => {
    const doc = unitRowToDoc(unitRow(baseUnit, 4))
    expect(doc._version).toBe(4)
    expect(doc.name).toBe('Centro')
    expect(doc.agenda).toMatchObject({ mode: 'fixed' })
    expect(doc.fiscal).toMatchObject({ kind: 'informal' })
    expect(doc.archivedAt).toBeNull()
  })

  it('public_visible is true for an appointment unit with a complete address + open hours', () => {
    const appt: StoredUnit = {
      ...baseUnit,
      agenda: {
        mode: 'appointment',
        businessHours: {
          monday: { open: '09:00', close: '18:00' },
          tuesday: null,
          wednesday: null,
          thursday: null,
          friday: null,
          saturday: null,
          sunday: null,
        },
        slotMinutes: 30,
        cancellationPolicy: { enabled: false, minNoticeMinutes: 120 },
        confirmationTemplates: { confirmation: '', reminder: '', cancellation: '' },
      },
    }
    const values = unitColumnValues(appt, 1)
    expect(values[UNIT_COLUMNS.indexOf('public_visible')]).toBe(true)
    expect(values[UNIT_COLUMNS.indexOf('agenda_mode')]).toBe('appointment')
  })

  it('public_visible is false for an appointment unit with no open weekday', () => {
    const appt: StoredUnit = {
      ...baseUnit,
      agenda: {
        mode: 'appointment',
        businessHours: {
          monday: null,
          tuesday: null,
          wednesday: null,
          thursday: null,
          friday: null,
          saturday: null,
          sunday: null,
        },
        slotMinutes: 30,
        cancellationPolicy: { enabled: false, minNoticeMinutes: 120 },
        confirmationTemplates: { confirmation: '', reminder: '', cancellation: '' },
      },
    }
    const values = unitColumnValues(appt, 1)
    expect(values[UNIT_COLUMNS.indexOf('public_visible')]).toBe(false)
  })
})
