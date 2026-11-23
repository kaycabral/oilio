import type { OrderItem } from '@/domain'
import type { OrgMember } from '@/shared/org/membership'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OrderItemRow } from './OrderItemRow'

const member: OrgMember = {
  userId: 'u1',
  name: 'Zé Barbeiro',
  role: 'member_operator',
  rlsUnitScope: null,
}

function buildItem(coverage: OrderItem['coverage']): OrderItem {
  return {
    id: 'item-1',
    refId: 'seed-svc-corte',
    name: 'Corte',
    kind: 'service',
    quantity: 1,
    unitPriceCents: 4500,
    commission: { kind: 'percentage', value: 50 },
    attributedUserId: 'u1',
    coverage,
  }
}

function renderRow(item: OrderItem): void {
  render(
    <OrderItemRow
      item={item}
      members={[member]}
      memberByUserId={{ u1: member }}
      editable={false}
      pending={false}
      subscriptionCoverage={null}
      onRemove={vi.fn()}
      onChangeAttribution={vi.fn()}
      onChangeCoverage={vi.fn()}
    />,
  )
}

describe('OrderItemRow — commission visibility vs coverage (#1328)', () => {
  it('shows the commission for a sale item (paga, gera comissão)', () => {
    renderRow(buildItem('sale'))
    expect(screen.getByText(/comissão 50%/i)).toBeInTheDocument()
  })

  it('hides the commission for an item covered by the plan (não gera comissão)', () => {
    renderRow(buildItem('subscription'))
    expect(screen.queryByText(/comissão/i)).not.toBeInTheDocument()
    expect(screen.getByText(/consumo do plano/i)).toBeInTheDocument()
  })
})
