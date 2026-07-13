import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildMembership } from '@/shared/fixtures/domain-builders'
import { getNavSections, type NavOrgSignals } from './nav-items'

import type { Role } from '@/domain'
import type { Tier } from '@/domain/billing/tiers'

const NOW = '2026-01-01T00:00:00.000Z'
const withAgenda: NavOrgSignals = { usesAgenda: true }

const FLAG_VARS = ['NEXT_PUBLIC_FF_FINANCE', 'NEXT_PUBLIC_FF_COPILOT'] as const

beforeEach(() => {
  for (const v of FLAG_VARS) process.env[v] = 'true'
})

afterEach(() => {
  for (const v of FLAG_VARS) delete process.env[v]
})

function sectionsFor(role: Role, signals: NavOrgSignals = withAgenda, tier: Tier = 'pro') {
  return getNavSections(buildMembership('t1', 'u1', NOW, { role }), signals, tier)
}

function labels(role: Role, signals?: NavOrgSignals, tier?: Tier): string[] {
  return sectionsFor(role, signals, tier)
    .flatMap((s) => s.items)
    .map((i) => i.label)
}

describe('getNavSections', () => {
  it('shows every operational section + manageOrg item to an owner', () => {
    const sections = sectionsFor('owner')
    expect(sections.map((s) => s.label)).toEqual(['Operação', 'Cadastros', 'Administração'])
    expect(labels('owner')).toEqual(
      expect.arrayContaining(['Relatórios', 'Copiloto', 'Dashboard', 'Equipe']),
    )
    expect(labels('owner')).not.toEqual(
      expect.arrayContaining(['Perfil', 'Privacidade', 'Plano e cobrança']),
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
    expect(flat).not.toContain('Dashboard')
    expect(flat).not.toContain('Equipe')
    expect(flat).toContain('Clientes')
    expect(flat).not.toContain('Perfil')
    expect(flat).not.toContain('Privacidade')
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
      const sections = sectionsFor('owner', withAgenda, 'free')
      const cadastros = sections.find((s) => s.label === 'Cadastros')
      expect(cadastros?.items.map((i) => i.label)).toEqual(['Clientes', 'Catálogo'])
    })
  })

  describe('dark-launch flag axis', () => {
    it('hides Financeiro and Copiloto when their flags are off, even for a Pro owner', () => {
      delete process.env.NEXT_PUBLIC_FF_FINANCE
      delete process.env.NEXT_PUBLIC_FF_COPILOT
      const pro = labels('owner', withAgenda, 'pro')
      expect(pro).not.toContain('Financeiro')
      expect(pro).not.toContain('Copiloto')
      expect(pro).toEqual(expect.arrayContaining(['Vendas', 'Relatórios', 'Planos']))
    })

    it('hides Financeiro even when flag on but role lacks manageOrg', () => {
      const receptionist = labels('receptionist', withAgenda, 'pro')
      expect(receptionist).not.toContain('Financeiro')
    })

    it('shows Copiloto only when flag AND tier both allow (independent gates)', () => {
      expect(labels('owner', withAgenda, 'free')).not.toContain('Copiloto')
      delete process.env.NEXT_PUBLIC_FF_COPILOT
      expect(labels('owner', withAgenda, 'pro')).not.toContain('Copiloto')
      process.env.NEXT_PUBLIC_FF_COPILOT = 'true'
      expect(labels('owner', withAgenda, 'pro')).toContain('Copiloto')
    })

    it('strips the internal requiresFlag flag from the emitted items', () => {
      for (const item of sectionsFor('owner').flatMap((s) => s.items)) {
        expect(item).not.toHaveProperty('requiresFlag')
      }
    })
  })
})
