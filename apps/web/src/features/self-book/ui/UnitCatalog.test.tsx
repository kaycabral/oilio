import type { Org, PublicCatalogItem, Unit } from '@/domain'
import { DEFAULT_ORG_BRANDING, EMPTY_ADDRESS, EMPTY_BUSINESS_HOURS } from '@/domain'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UnitCatalog } from './UnitCatalog'

const ORG: Org = {
  id: 't1',
  name: 'Barbearia',
  slug: 'barbearia',
  vertical: 'barbershop',
  ownerUserId: 'owner',
  branding: { ...DEFAULT_ORG_BRANDING },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const UNIT: Unit = {
  id: 'u1',
  orgId: 't1',
  name: 'Centro',
  slug: 'centro',
  mobile: '5511900000000',
  email: null,
  address: EMPTY_ADDRESS,
  timezone: 'America/Sao_Paulo',
  agenda: { mode: 'fixed', businessHours: EMPTY_BUSINESS_HOURS },
  archivedAt: null,
  fiscal: { kind: 'informal' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function service(
  id: string,
  name: string,
  priceCents: number,
  categoryName: string | null = null,
): PublicCatalogItem {
  return {
    id,
    kind: 'service',
    name,
    categoryId: categoryName ? `cat-${id}` : null,
    categoryName,
    requiredResources: [],
    priceCents,
    durationMinutes: 30,
  }
}

const SERVICES: PublicCatalogItem[] = [
  service('s-corte', 'Corte', 4500),
  service('s-barba', 'Barba', 3000),
  service('s-pezinho', 'Pézinho', 2000),
]

function renderCatalog(coveredItemIds?: ReadonlySet<string>) {
  return render(
    <UnitCatalog
      org={ORG}
      unit={UNIT}
      slug="barbearia"
      catalogServiceItems={SERVICES}
      memberOperation={null}
      showUnitHeader={false}
      isLoggedIn={true}
      coveredItemIds={coveredItemIds}
    />,
  )
}

function serviceNamesInOrder(): string[] {
  const list = screen.getByRole('list')
  return within(list)
    .getAllByRole('listitem')
    .map((li) => within(li).getByRole('link').querySelector('span')?.textContent ?? '')
}

describe('UnitCatalog — plan coverage (brief 0079)', () => {
  it('renders no badge and keeps loader order when nothing is covered (avulso)', () => {
    renderCatalog()
    expect(screen.queryByText('no seu plano')).not.toBeInTheDocument()
    expect(serviceNamesInOrder()).toEqual(['Corte', 'Barba', 'Pézinho'])
  })

  it('badges a covered service and sorts it to the top', () => {
    renderCatalog(new Set(['s-barba']))
    expect(screen.getByText('no seu plano')).toBeInTheDocument()
    expect(serviceNamesInOrder()).toEqual(['Barba', 'Corte', 'Pézinho'])
  })

  it('badges multiple covered services, both ahead of avulsos', () => {
    renderCatalog(new Set(['s-corte', 's-pezinho']))
    expect(screen.getAllByText('no seu plano')).toHaveLength(2)
    expect(serviceNamesInOrder()).toEqual(['Corte', 'Pézinho', 'Barba'])
  })

  it('keeps showing avulsos (covered does not hide the full catalog)', () => {
    renderCatalog(new Set(['s-corte']))
    expect(screen.getByText('Corte')).toBeInTheDocument()
    expect(screen.getByText('Barba')).toBeInTheDocument()
    expect(screen.getByText('Pézinho')).toBeInTheDocument()
  })

  it('never renders a numeric balance — only the badge text', () => {
    renderCatalog(new Set(['s-corte']))
    const badge = screen.getByText('no seu plano')
    expect(badge.textContent).toBe('no seu plano')
  })

  it('a covered service still shows its full price (badge is not a price override)', () => {
    renderCatalog(new Set(['s-corte']))
    expect(screen.getByText(/R\$\s*45,00/)).toBeInTheDocument()
  })
})

describe('UnitCatalog — category label (#1315)', () => {
  it('renders the category NAME, never the raw id', () => {
    render(
      <UnitCatalog
        org={ORG}
        unit={UNIT}
        slug="barbearia"
        catalogServiceItems={[service('s-corte', 'Corte', 4500, 'Cabelo')]}
        memberOperation={null}
        showUnitHeader={false}
        isLoggedIn={true}
      />,
    )
    expect(screen.getByText(/·\s*Cabelo/)).toBeInTheDocument()
    expect(screen.queryByText(/cat-s-corte/)).not.toBeInTheDocument()
  })

  it('omits the category label when there is no category', () => {
    render(
      <UnitCatalog
        org={ORG}
        unit={UNIT}
        slug="barbearia"
        catalogServiceItems={[service('s-corte', 'Corte', 4500, null)]}
        memberOperation={null}
        showUnitHeader={false}
        isLoggedIn={true}
      />,
    )
    expect(screen.queryByText(/·/)).not.toBeInTheDocument()
  })
})
