import type { SubscriptionPlan } from '@/domain'
import type { WithCanDelete } from '@/shared/org/delete-guard'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const useCapability = vi.fn<(cap: string) => boolean>(() => true)
vi.mock('@/shared/org/org-context', () => ({
  useCapability: (cap: string) => useCapability(cap),
}))
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
    useCapability.mockReturnValue(true)
    render(<PlansList plans={[buildPlan({ name: 'Plano Ouro' })]} {...baseProps} />)

    expect(screen.getByText('Plano Ouro')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Novo plano' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Fazer upgrade' })).not.toBeInTheDocument()
  })

  it('renders the rows but hides the create button when plans.recurring is off', () => {
    useCapability.mockReturnValue(false)
    render(<PlansList plans={[buildPlan({ name: 'Plano Ouro' })]} {...baseProps} />)

    expect(screen.getByText('Plano Ouro')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Novo plano' })).not.toBeInTheDocument()
    useCapability.mockReturnValue(true)
  })
})
