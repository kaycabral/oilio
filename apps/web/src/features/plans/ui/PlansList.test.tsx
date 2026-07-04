// Render test for the PlansList tier gate. Post-0088 the WHOLE /plans route 404s
// for a Free org (the loader returns `locked`, the page calls `notFound()`), so
// this list only ever renders for a Pro+ org — no in-surface upgrade CTA. The
// `plans.recurring` capability here just guards the "Novo plano" create button.

import type { SubscriptionPlan } from '@/domain'
import type { WithCanDelete } from '@/shared/org/delete-guard'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const useCapability = vi.fn<(cap: string) => boolean>(() => true)
vi.mock('@/shared/org/org-context', () => ({
  useCapability: (cap: string) => useCapability(cap),
}))
// PlansList calls the URL-controls + pagination hooks at the top (before the
// gate early-return), so stub the Next navigation they read.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/plans',
  useSearchParams: () => new URLSearchParams(),
}))

import { PlansList } from './PlansList'

function buildPlan(overrides: Partial<SubscriptionPlan> = {}): WithCanDelete<SubscriptionPlan> {
  return {
    id: 'plan-1',
    orgId: 'org-1',
    name: 'Plano Ouro',
    description: null,
    active: true,
    archivedAt: null,
    priceCents: 9900,
    billingCycle: 'monthly',
    includedItemIds: [],
    includedCategoryIds: [],
    usageLimit: { kind: 'unlimited' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    canDelete: true,
    ...overrides,
  }
}

const baseProps = {
  searchQuery: '',
  cycleFilter: 'all' as const,
  statusFilter: 'all' as const,
  canManage: true,
  canDelete: true,
  isFiltered: false,
}

describe('PlansList — tier gate (brief 0088)', () => {
  it('renders the plan rows + create affordance for a Pro manager', () => {
    // plans.recurring unlocked (Pro) — the only tier that reaches this list.
    useCapability.mockReturnValue(true)
    render(<PlansList plans={[buildPlan({ name: 'Plano Ouro' })]} {...baseProps} />)

    expect(screen.getByText('Plano Ouro')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Novo plano' })).toBeInTheDocument()
    // No in-surface upgrade CTA post-0088 — off-plan orgs never reach here (404).
    // (Upsell lives only in /settings/billing + /pricing.)
    expect(screen.queryByRole('link', { name: 'Fazer upgrade' })).not.toBeInTheDocument()
  })

  it('renders the rows but hides the create button when plans.recurring is off', () => {
    // Defense-in-depth: even if a stale client somehow renders this for a
    // capability-less session, the create affordance stays hidden. The route
    // wall (404) is the real gate.
    useCapability.mockReturnValue(false)
    render(<PlansList plans={[buildPlan({ name: 'Plano Ouro' })]} {...baseProps} />)

    expect(screen.getByText('Plano Ouro')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Novo plano' })).not.toBeInTheDocument()
    useCapability.mockReturnValue(true)
  })
})
