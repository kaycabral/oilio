// Render tests for the UpgradeGate / UpgradeCta (brief 0082) — the reusable
// upgrade affordance shared across the gated surfaces. Proves the two branches
// a tester would eyeball: unlocked renders children untouched; locked replaces
// them with the consistent CTA (per-capability copy + a single "Fazer upgrade"
// link to /billing). `useCapability` is mocked so each test drives the tier.

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useCapability: vi.fn<(cap: string) => boolean>(() => false),
}))

vi.mock('@/shared/org/org-context', () => ({
  useCapability: mocks.useCapability,
}))

import { UpgradeCta, UpgradeGate } from './UpgradeGate'

beforeEach(() => {
  mocks.useCapability.mockReset()
})

describe('UpgradeGate', () => {
  it('renders children untouched when the capability is unlocked', () => {
    mocks.useCapability.mockReturnValue(true)
    render(
      <UpgradeGate capability="plans.recurring">
        <button type="button">Novo plano</button>
      </UpgradeGate>,
    )
    expect(screen.getByRole('button', { name: 'Novo plano' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Fazer upgrade' })).not.toBeInTheDocument()
  })

  it('replaces children with the upgrade CTA when the capability is locked', () => {
    mocks.useCapability.mockReturnValue(false)
    render(
      <UpgradeGate capability="plans.recurring">
        <button type="button">Novo plano</button>
      </UpgradeGate>,
    )
    expect(screen.queryByRole('button', { name: 'Novo plano' })).not.toBeInTheDocument()
    const cta = screen.getByRole('link', { name: 'Fazer upgrade' })
    expect(cta).toHaveAttribute('href', '/billing')
    expect(screen.getByText(/recurso do Pro/i)).toBeInTheDocument()
  })
})

describe('UpgradeCta', () => {
  it('shows capability-specific copy + the /billing link', () => {
    render(<UpgradeCta capability="reports.sales" />)
    expect(screen.getByText(/Relatórios são um recurso do Pro/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Fazer upgrade' })).toHaveAttribute('href', '/billing')
  })

  it('reports.sales and units.unlimited render distinct copy', () => {
    const { rerender } = render(<UpgradeCta capability="reports.sales" />)
    expect(screen.getByText('Relatórios são um recurso do Pro')).toBeInTheDocument()
    rerender(<UpgradeCta capability="units.unlimited" />)
    expect(screen.getByText('Unidades adicionais são um recurso do Pro')).toBeInTheDocument()
  })
})
