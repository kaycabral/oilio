import { describe, expect, it } from 'vitest'

import { buildMembership } from '@/shared/fixtures/domain-builders'
import { getNavSections, type NavOrgSignals } from './nav-items'

import type { Role } from '@/domain'

const NOW = '2026-01-01T00:00:00.000Z'
const withAgenda: NavOrgSignals = { usesAgenda: true }

function sectionsFor(role: Role, signals: NavOrgSignals = withAgenda) {
  return getNavSections(buildMembership('t1', 'u1', NOW, { role }), signals)
}

function labels(role: Role, signals?: NavOrgSignals): string[] {
  return sectionsFor(role, signals)
    .flatMap((s) => s.items)
    .map((i) => i.label)
}

describe('getNavSections', () => {
  it('shows every section + manageOrg item to an owner', () => {
    const sections = sectionsFor('owner')
    expect(sections.map((s) => s.label)).toEqual([
      'Operação',
      'Cadastros',
      'Administração',
      'Conta',
    ])
    expect(labels('owner')).toEqual(expect.arrayContaining(['Relatórios', 'Copiloto', 'Equipe']))
  })

  it('surfaces the v2 "Negócios" entry and drops the old "Empresa" label', () => {
    const flat = labels('owner')
    expect(flat).toContain('Negócios')
    expect(flat).not.toContain('Empresa')
    expect(flat).not.toContain('Unidades')
  })

  it('drops the Administração section + manageOrg items for a receptionist', () => {
    const sections = sectionsFor('receptionist')
    expect(sections.map((s) => s.label)).not.toContain('Administração')
    const flat = labels('receptionist')
    expect(flat).not.toContain('Relatórios')
    expect(flat).not.toContain('Equipe')
    // Personal "Conta" surfaces survive — receptionists still self-serve.
    expect(flat).toEqual(expect.arrayContaining(['Perfil', 'Privacidade', 'Clientes']))
  })

  it('hides Agenda when the org does not use appointment hours', () => {
    expect(labels('owner', { usesAgenda: false })).not.toContain('Agenda')
    expect(labels('owner', { usesAgenda: true })).toContain('Agenda')
  })

  it('strips the internal `requires` flag from the emitted items', () => {
    for (const item of sectionsFor('owner').flatMap((s) => s.items)) {
      expect(item).not.toHaveProperty('requires')
    }
  })
})
