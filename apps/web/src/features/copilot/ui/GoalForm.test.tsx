import type { Goal } from '@/domain'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GoalForm } from './GoalForm'

vi.mock('@/features/copilot/adapters/copilot.actions', () => ({
  defineGoal: vi.fn(),
  updateGoal: vi.fn(),
}))

const goal: Goal = {
  id: 'profit__unit-a__2026-06',
  orgId: 't1',
  unitId: 'unit-a',
  period: '2026-06',
  type: 'profit',
  targetCents: 500_000,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
}

describe('GoalForm', () => {
  it('carries unit and period as hidden inputs', () => {
    render(<GoalForm unitId="unit-a" period="2026-06" />)
    // Hidden inputs have no accessible role; reach the owning form via a
    // labeled field's `.form` property and read the wired values via FormData.
    const target = screen.getByLabelText(/meta de lucro do mês/i)
    const form = target instanceof HTMLInputElement ? target.form : null
    expect(form).not.toBeNull()
    const fd = new FormData(form ?? undefined)
    expect(fd.get('unitId')).toBe('unit-a')
    expect(fd.get('period')).toBe('2026-06')
  })

  it('defines a new goal: empty target, "Definir meta" CTA', () => {
    render(<GoalForm unitId="unit-a" period="2026-06" />)
    const target = screen.getByLabelText(/meta de lucro do mês/i)
    expect(target).toHaveDisplayValue('')
    expect(target).toBeRequired()
    expect(screen.getByRole('button', { name: 'Definir meta' })).toBeInTheDocument()
  })

  it('edits an existing goal: target prefilled in reais, "Salvar meta" CTA', () => {
    render(<GoalForm unitId="unit-a" period="2026-06" goal={goal} />)
    const target = screen.getByLabelText(/meta de lucro do mês/i)
    expect(target).toHaveDisplayValue('5000.00')
    expect(screen.getByRole('button', { name: 'Salvar meta' })).toBeInTheDocument()
  })
})
