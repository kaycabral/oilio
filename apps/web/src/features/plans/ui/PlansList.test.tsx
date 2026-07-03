// Render test for the PlansList tier gate (brief 0082). A manager off the Pro
// tier must see the consistent upgrade CTA for the WHOLE surface — even when
// the org still OWNS plans (a Pro→Free downgrade leaves the rows in place). The
// earlier bug keyed the CTA on the empty slot alone, so a Free org with plans
// silently reverted to the pre-feature "hide the action" behavior.

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

describe('PlansList — tier gate (brief 0082)', () => {
  it('shows the upgrade CTA (not the rows) for a Free manager that still owns plans', () => {
    // plans.recurring locked (Free)
    useCapability.mockReturnValue(false)
    render(<PlansList plans={[buildPlan({ name: 'Plano Ouro' })]} {...baseProps} />)

    const cta = screen.getByRole('link', { name: 'Fazer upgrade' })
    expect(cta).toHaveAttribute('href', '/billing')
    // The gated surface replaces the list: the owned plan row is NOT rendered.
    expect(screen.queryByText('Plano Ouro')).not.toBeInTheDocument()
    useCapability.mockReturnValue(true)
  })

  it('renders the plan rows + create affordance for a Pro manager', () => {
    // plans.recurring unlocked (Pro)
    useCapability.mockReturnValue(true)
    render(<PlansList plans={[buildPlan({ name: 'Plano Ouro' })]} {...baseProps} />)

    expect(screen.getByText('Plano Ouro')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Novo plano' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Fazer upgrade' })).not.toBeInTheDocument()
  })
})
