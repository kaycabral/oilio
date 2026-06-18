import type { Org } from '@/domain'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FiscalSection } from './FiscalSection'

function companyOrg(overrides: Partial<Org> = {}): Org {
  return {
    id: 't1',
    name: 'Cabral Tecnologia',
    slug: 'cabral-tecnologia',
    vertical: 'barbershop',
    taxIdentity: {
      kind: 'company',
      taxId: '40148980000199',
      legalName: 'CABRAL TECNOLOGIA LTDA',
      tradeName: 'CABRAL TECH',
    },
    fiscalProfile: {
      stage: 'company',
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
    },
    ownerUserId: 'u1',
    selfBookingPublished: false,
    selfBookingPublishedAt: null,
    timezone: 'America/Sao_Paulo',
    slotMinutes: 15,
    branding: { logoUrl: null, bannerUrl: null, description: null },
    cancellationPolicy: { enabled: false, minNoticeMinutes: 120 },
    whatsappTemplates: { confirmation: '', reminder: '', cancellation: '' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('FiscalSection (brief 0048 AC-08 — read-only fiscal)', () => {
  it('renders the masked CNPJ, razão social, fantasia, regime, CNAE, porte', () => {
    render(<FiscalSection org={companyOrg()} />)
    expect(screen.getByText('Empresa formalizada')).toBeInTheDocument()
    expect(screen.getByText('40.148.980/0001-99')).toBeInTheDocument()
    expect(screen.getByText('CABRAL TECNOLOGIA LTDA')).toBeInTheDocument()
    expect(screen.getByText('CABRAL TECH')).toBeInTheDocument()
    expect(screen.getByText('Simples Nacional')).toBeInTheDocument()
    expect(screen.getByText(/6201501/)).toBeInTheDocument()
    expect(screen.getByText('Microempresa')).toBeInTheDocument()
  })

  it('shows a dash for a missing nome fantasia', () => {
    const org = companyOrg()
    if (org.taxIdentity?.kind === 'company') org.taxIdentity.tradeName = null
    render(<FiscalSection org={org} />)
    expect(screen.getByText('CABRAL TECNOLOGIA LTDA')).toBeInTheDocument()
    // The trade-name cell renders the em-dash placeholder.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1)
  })

  it('renders nothing for an informal org (no fiscal section)', () => {
    const { container } = render(
      <FiscalSection
        org={companyOrg({ fiscalProfile: { stage: 'informal' }, taxIdentity: null })}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
