import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const og = vi.hoisted(() => ({
  calls: [] as { element: React.ReactElement; init: unknown }[],
}))

vi.mock('next/og', () => ({
  ImageResponse: class {
    constructor(element: React.ReactElement, init: unknown) {
      og.calls.push({ element, init })
    }
  },
}))

describe('opengraph image', () => {
  it('renders the icon and name at 1200x630', async () => {
    const mod = await import('./opengraph-image')
    await mod.default()
    const [call] = og.calls
    expect(call?.init).toEqual({ width: 1200, height: 630 })
    expect(mod.alt).toMatch(/^Oilio — /)
    render(call?.element)
    expect(screen.getByRole('presentation')).toHaveAttribute(
      'src',
      expect.stringMatching(/^data:image\/svg\+xml;base64,/),
    )
    expect(screen.getByText('Oilio')).toBeInTheDocument()
  })
})
