import type { Org, PublicCatalogItem, Unit } from '@/domain'
import { DEFAULT_ORG_BRANDING, EMPTY_ADDRESS, EMPTY_BUSINESS_HOURS } from '@/domain'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UnitCatalog } from './UnitCatalog'

// Brief 0079 (#1307). The wizard catalog gives plan-covered services a "no seu
// plano" badge and sorts them to the top — without ever rendering a balance
// number. The page resolves which ids are covered (server-side); the component
// renders the signal it's handed.

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
  whatsapp: '5511900000000',
  email: null,
  address: EMPTY_ADDRESS,
  timezone: 'America/Sao_Paulo',
  agenda: { mode: 'fixed', businessHours: EMPTY_BUSINESS_HOURS },
  archivedAt: null,
  fiscal: { kind: 'informal' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function service(id: string, name: string, priceCents: number): PublicCatalogItem {
  return {
    id,
    kind: 'service',
    name,
    categoryId: null,
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
  // The services live in the only <ul> on the page.
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
    // Barba (covered) bubbles up; the rest keep their relative order.
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
    // The badge carries no count; prices (avulso) are the only numbers shown.
    expect(badge.textContent).toBe('no seu plano')
  })

  it('a covered service still shows its full price (badge is not a price override)', () => {
    renderCatalog(new Set(['s-corte']))
    // R$ 45,00 — the wizard does not zero the price; balance/consumption is a
    // comanda concern (brief 0079: cota baixa só no fechamento).
    expect(screen.getByText(/R\$\s*45,00/)).toBeInTheDocument()
  })
})
