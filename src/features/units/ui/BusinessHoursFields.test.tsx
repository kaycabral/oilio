import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BusinessHoursFields } from './BusinessHoursFields'

function renderTwo() {
  return render(
    <>
      <form aria-label="A">
        <BusinessHoursFields defaults={null} mode="fixed" onModeChange={() => {}} />
      </form>
      <form aria-label="B">
        <BusinessHoursFields defaults={null} mode="fixed" onModeChange={() => {}} />
      </form>
    </>,
  )
}

describe('BusinessHoursFields — ids per instance (#85)', () => {
  it('labels each instance to its own fields, without repeated ids', () => {
    renderTwo()
    const formA = screen.getByRole('form', { name: 'A' })
    const formB = screen.getByRole('form', { name: 'B' })

    const [mondayA, mondayB] = screen.getAllByLabelText('Segunda')
    expect(mondayA).toBeDefined()
    expect(mondayB).toBeDefined()
    expect(mondayA).not.toBe(mondayB)
    expect(mondayA?.id).not.toBe(mondayB?.id)
    expect(formA).toContainElement(mondayA ?? null)
    expect(formB).toContainElement(mondayB ?? null)

    const [fixedA, fixedB] = screen.getAllByLabelText(/Ordem de chegada/)
    expect(fixedA).not.toBe(fixedB)
    expect(fixedA?.id).not.toBe(fixedB?.id)
    expect(formA).toContainElement(fixedA ?? null)
    expect(formB).toContainElement(fixedB ?? null)

    expect(within(formB).getByRole('switch', { name: 'Segunda' })).toBe(mondayB)
  })
})
