import type { TaxIdentity, Unit, UnitFiscal } from '@/domain'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FiscalSection } from './FiscalSection'

const COMPANY_FISCAL: UnitFiscal = {
  kind: 'company',
  taxId: '40148980000199',
  companyProfile: {
    taxId: '40148980000199',
    isMei: false,
    taxRegime: 'simples_nacional',
    primaryActivity: { code: '6201501', description: 'Desenvolvimento de software' },
    secondaryActivities: [],
    companySize: 'micro',
    legalNature: 'Sociedade Empresária Limitada',
    registrationStatus: 'ATIVA',
    shareCapital: 1000,
    activityStartedAt: '2020-12-17',
  },
  formalizedAt: '2026-06-18T00:00:00.000Z',
}

const COMPANY_TAX_IDENTITY: TaxIdentity = {
  kind: 'company',
  taxId: '40148980000199',
  legalName: 'CABRAL TECNOLOGIA LTDA',
  tradeName: 'CABRAL TECH',
}

function companyUnit(fiscal: UnitFiscal = COMPANY_FISCAL): Unit {
  return {
    id: 'u1',
    orgId: 't1',
    name: 'Centro',
    slug: 'centro',
    whatsapp: '5511999990000',
    email: null,
    address: {
      postalCode: '01310-100',
      state: 'SP',
      city: 'São Paulo',
      neighborhood: 'Bela Vista',
      street: 'Av. Paulista',
      number: '1000',
      complement: null,
    },
    businessHours: {
      monday: { open: '09:00', close: '18:00' },
      tuesday: { open: '09:00', close: '18:00' },
      wednesday: { open: '09:00', close: '18:00' },
      thursday: { open: '09:00', close: '18:00' },
      friday: { open: '09:00', close: '18:00' },
      saturday: null,
      sunday: null,
    },
    hoursMode: 'fixed',
    archivedAt: null,
    fiscal,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('FiscalSection (brief 0048 AC-08 — read-only fiscal)', () => {
  it('renders the masked CNPJ, razão social, fantasia, regime, CNAE, porte', () => {
    render(<FiscalSection unit={companyUnit()} taxIdentity={COMPANY_TAX_IDENTITY} />)
    expect(screen.getByText('Unidade formalizada')).toBeInTheDocument()
    expect(screen.getByText('40.148.980/0001-99')).toBeInTheDocument()
    expect(screen.getByText('CABRAL TECNOLOGIA LTDA')).toBeInTheDocument()
    expect(screen.getByText('CABRAL TECH')).toBeInTheDocument()
    expect(screen.getByText('Simples Nacional')).toBeInTheDocument()
    expect(screen.getByText(/6201501/)).toBeInTheDocument()
    expect(screen.getByText('Microempresa')).toBeInTheDocument()
  })

  it('shows a dash for a missing nome fantasia', () => {
    render(
      <FiscalSection
        unit={companyUnit()}
        taxIdentity={{ ...COMPANY_TAX_IDENTITY, tradeName: null }}
      />,
    )
    expect(screen.getByText('CABRAL TECNOLOGIA LTDA')).toBeInTheDocument()
    // The trade-name cell renders the em-dash placeholder.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1)
  })

  it('renders nothing for an informal unit (no fiscal section)', () => {
    const { container } = render(
      <FiscalSection unit={companyUnit({ kind: 'informal' })} taxIdentity={null} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
