import type { Customer } from '@/domain'
import { describe, expect, it } from 'vitest'
import { searchCustomers } from './search-customers'

function customer(args: { id: string; name: string; mobile: string }): Customer {
  return {
    id: args.id,
    orgId: 'org-1',
    userId: `u-${args.id}`,
    name: args.name,
    mobile: args.mobile,
    birthDate: null,
    avatarUrl: null,
    archivedAt: null,
    deactivatedAt: null,
    acquisition: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

const ana = customer({ id: '1', name: 'Ana Souza', mobile: '5592900000000' })
const bruno = customer({ id: '2', name: 'Bruno Lima', mobile: '5511988887777' })
const carla = customer({ id: '3', name: 'Carla Árvore', mobile: '5511999990000' })

const all = [carla, ana, bruno]

describe('searchCustomers', () => {
  it('returns all (name-sorted, pt-BR accent-insensitive) for an empty query', () => {
    expect(searchCustomers(all, '').map((c) => c.id)).toEqual(['1', '2', '3'])
  })

  it('matches by name substring, case-insensitive', () => {
    expect(searchCustomers(all, 'bru').map((c) => c.id)).toEqual(['2'])
  })

  it('matches by name substring including accented chars', () => {
    expect(searchCustomers(all, 'árvore').map((c) => c.id)).toEqual(['3'])
  })

  it('matches by WhatsApp digits regardless of mask', () => {
    expect(searchCustomers(all, '(92) 90000-0000').map((c) => c.id)).toEqual(['1'])
    expect(searchCustomers(all, '92900000000').map((c) => c.id)).toEqual(['1'])
  })

  it('matches a partial digit run', () => {
    expect(searchCustomers(all, '9999').map((c) => c.id)).toEqual(['3'])
  })

  it('unions name and WhatsApp hits without duplicates, keeping name sort', () => {
    expect(searchCustomers(all, '11').map((c) => c.id)).toEqual(['2', '3'])
  })

  it('returns empty when nothing matches', () => {
    expect(searchCustomers(all, 'zzz')).toEqual([])
  })
})
