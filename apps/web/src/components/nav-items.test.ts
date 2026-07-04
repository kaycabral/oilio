import { describe, expect, it } from 'vitest'

import { buildMembership } from '@/shared/fixtures/domain-builders'
import { getNavSections, type NavOrgSignals } from './nav-items'

import type { Role } from '@/domain'
import type { Tier } from '@/domain/billing/tiers'

const NOW = '2026-01-01T00:00:00.000Z'
const withAgenda: NavOrgSignals = { usesAgenda: true }

// Default the tier to `pro` for the RBAC-focused cases: Pro unlocks every
// billing capability, so the billing axis is a no-op there and these assertions
// isolate the role gate. The billing-axis cases below pass `free` explicitly.
function sectionsFor(role: Role, signals: NavOrgSignals = withAgenda, tier: Tier = 'pro') {
  return getNavSections(buildMembership('t1', 'u1', NOW, { role }), signals, tier)
}

function labels(role: Role, signals?: NavOrgSignals, tier?: Tier): string[] {
  return sectionsFor(role, signals, tier)
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
    expect(labels('owner')).toEqual(
      expect.arrayContaining(['Relatórios', 'Copiloto', 'Dashboard', 'Equipe']),
    )
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
    // Dashboard surfaces financeiro KPIs — manager-only, hidden from receptionist.
    expect(flat).not.toContain('Dashboard')
    expect(flat).not.toContain('Equipe')
    // Personal "Conta" surfaces survive — receptionists still self-serve.
    expect(flat).toEqual(expect.arrayContaining(['Perfil', 'Privacidade', 'Clientes']))
  })

  it('hides Agenda when the org does not use appointment hours', () => {
    expect(labels('owner', { usesAgenda: false })).not.toContain('Agenda')
    expect(labels('owner', { usesAgenda: true })).toContain('Agenda')
  })

  it('strips the internal `requires`/`requiresTier` flags from the emitted items', () => {
    for (const item of sectionsFor('owner').flatMap((s) => s.items)) {
      expect(item).not.toHaveProperty('requires')
      expect(item).not.toHaveProperty('requiresTier')
    }
  })

  // Billing/tier axis (brief 0088 AC-06): surfaces the plan doesn't unlock are
  // hidden from the sidebar entirely, orthogonal to RBAC.
  describe('billing/tier axis', () => {
    it('hides plan-gated surfaces from a Free owner', () => {
      const free = labels('owner', withAgenda, 'free')
      expect(free).not.toContain('Planos')
      expect(free).not.toContain('Assinaturas')
      expect(free).not.toContain('Relatórios')
      expect(free).not.toContain('Copiloto')
    })

    it('keeps ungated surfaces for a Free owner', () => {
      const free = labels('owner', withAgenda, 'free')
      // Baseline Free operation stays: agenda, sales, customers, catalog, orgs.
      expect(free).toEqual(
        expect.arrayContaining(['Agenda', 'Vendas', 'Clientes', 'Catálogo', 'Negócios']),
      )
    })

    it('shows every plan-gated surface to a Pro owner', () => {
      const pro = labels('owner', withAgenda, 'pro')
      expect(pro).toEqual(
        expect.arrayContaining(['Planos', 'Assinaturas', 'Relatórios', 'Copiloto']),
      )
    })

    it('drops the Cadastros section entry for Planos on Free but keeps the section', () => {
      // Cadastros still has Clientes/Catálogo on Free — the section survives, only
      // the Planos entry (plan-gated) is dropped.
      const sections = sectionsFor('owner', withAgenda, 'free')
      const cadastros = sections.find((s) => s.label === 'Cadastros')
      expect(cadastros?.items.map((i) => i.label)).toEqual(['Clientes', 'Catálogo'])
    })
  })
})
