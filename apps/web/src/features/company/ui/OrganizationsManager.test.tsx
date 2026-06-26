import type { Org, Unit, UnitAgendaConfig } from '@/domain'
import type { WithCanDelete } from '@/shared/org/delete-guard'
import type { OrgContextValue, OrgOption } from '@/shared/org/org-context'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OrganizationsManager } from './OrganizationsManager'

// The folder-manager pulls the active-org switcher off useOrg and renders the
// CompanyForm (folder settings) + NewOrgDialog (create) + the inline unit CRUD
// (UnitFormDialog + per-row delete) — mock the server actions those reach for so
// the tree mounts in jsdom.
const setActiveOrg = vi.fn<(orgId: string) => Promise<void>>()
vi.mock('@/shared/org/org-context', () => ({
  useOrg: (): Pick<OrgContextValue, 'setActiveOrg'> => ({ setActiveOrg }),
}))
vi.mock('@/features/company/adapters/company.actions', () => ({ updateCompany: vi.fn() }))
vi.mock('@/features/onboarding/adapters/onboarding.actions', () => ({ createOrg: vi.fn() }))
vi.mock('@/features/units/adapters/units.actions', () => ({
  createUnit: vi.fn(),
  updateUnit: vi.fn(),
  deleteUnit: vi.fn(),
}))
vi.mock('@/hooks/use-cep-lookup', () => ({
  useCepLookup: () => ({ loading: false, data: null, error: null }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))

const FIXED_AGENDA: UnitAgendaConfig = {
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
}

function buildOrg(overrides: Partial<Org> = {}): Org {
  return {
    id: 't1',
    name: 'Barbearia do Bairro',
    slug: 'barbearia-do-bairro',
    vertical: 'barbershop',
    website: null,
    ownerUserId: 'u1',
    branding: { logoUrl: null, bannerUrl: null, description: null },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function buildUnit(overrides: Partial<Unit> = {}): WithCanDelete<Unit> {
  return {
    id: 'unit-1',
    orgId: 't1',
    name: 'Unidade Centro',
    slug: 'centro',
    whatsapp: '5511999999999',
    email: null,
    address: {
      postalCode: '01000-000',
      state: 'SP',
      city: 'São Paulo',
      neighborhood: 'Centro',
      street: 'Rua A',
      number: '10',
      complement: null,
    },
    timezone: 'America/Sao_Paulo',
    agenda: FIXED_AGENDA,
    archivedAt: null,
    fiscal: { kind: 'informal' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    canDelete: true,
    ...overrides,
  }
}

describe('OrganizationsManager — Negócios surface (PRD Identidade v2, F5)', () => {
  it('renders the single fixed "Negócios" heading and the org card (single Negócio)', () => {
    render(
      <OrganizationsManager
        org={buildOrg()}
        units={[buildUnit()]}
        orgs={[{ id: 't1', name: 'Barbearia do Bairro' }]}
        canManage
        canDelete
      />,
    )
    // The heading is always "Negócios" (no collapsed/expanded variants).
    expect(screen.getByRole('heading', { name: 'Negócios' })).toBeInTheDocument()
    // With a single Negócio there is no "Outros negócios" section.
    expect(screen.queryByText('Outros negócios')).not.toBeInTheDocument()
  })

  it('lists the other Negócios when the user belongs to multiple', () => {
    const orgs: OrgOption[] = [
      { id: 't1', name: 'Barbearia do Bairro' },
      { id: 't2', name: 'Lava Rápido' },
    ]
    render(
      <OrganizationsManager
        org={buildOrg()}
        units={[buildUnit()]}
        orgs={orgs}
        canManage
        canDelete
      />,
    )
    expect(screen.getByRole('heading', { name: 'Negócios' })).toBeInTheDocument()
    expect(screen.getByText('Outros negócios')).toBeInTheDocument()
    expect(screen.getByText('Lava Rápido')).toBeInTheDocument()
  })

  it('lists the unit with its agenda mode + fiscal badge', () => {
    render(
      <OrganizationsManager
        org={buildOrg()}
        units={[buildUnit({ name: 'Unidade Centro' })]}
        orgs={[{ id: 't1', name: 'Barbearia do Bairro' }]}
        canManage
        canDelete
      />,
    )
    expect(screen.getByText('Unidade Centro')).toBeInTheDocument()
    expect(screen.getByText('Horário fixo')).toBeInTheDocument()
    expect(screen.getByText('Informal')).toBeInTheDocument()
  })

  it('marks a formalized unit with the Formalizada badge', () => {
    const formalized = buildUnit({
      fiscal: {
        kind: 'company',
        taxId: '12345678000190',
        formalizedAt: '2026-02-01T00:00:00.000Z',
        companyProfile: {
          taxId: '12345678000190',
          isMei: true,
          taxRegime: 'mei',
          primaryActivity: { code: '9602501', description: 'Cabeleireiros' },
          secondaryActivities: [],
          companySize: 'micro',
          legalNature: '2135',
          registrationStatus: 'ATIVA',
          shareCapital: 0,
          activityStartedAt: '2020-01-01',
        },
      },
    })
    render(
      <OrganizationsManager
        org={buildOrg()}
        units={[formalized]}
        orgs={[{ id: 't1', name: 'Barbearia do Bairro' }]}
        canManage
        canDelete
      />,
    )
    expect(screen.getByText('Formalizada')).toBeInTheDocument()
  })

  it('exposes the create affordances to a manager (both inline dialogs)', () => {
    render(
      <OrganizationsManager
        org={buildOrg()}
        units={[buildUnit()]}
        orgs={[{ id: 't1', name: 'Barbearia do Bairro' }]}
        canManage
        canDelete
      />,
    )
    // Unit creation is now an inline dialog trigger (a button), not a page link.
    expect(screen.getByRole('button', { name: '+ Nova unidade' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Novo negócio' })).toBeInTheDocument()
  })

  it('hides the create affordances when the member cannot manage', () => {
    render(
      <OrganizationsManager
        org={buildOrg()}
        units={[buildUnit()]}
        orgs={[{ id: 't1', name: 'Barbearia do Bairro' }]}
        canManage={false}
        canDelete={false}
      />,
    )
    expect(screen.queryByRole('button', { name: '+ Nova unidade' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Novo negócio' })).not.toBeInTheDocument()
  })
})
