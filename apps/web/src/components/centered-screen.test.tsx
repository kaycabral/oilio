import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CenteredScreen } from './centered-screen'

describe('CenteredScreen — robust both-axes centering (Fix 3)', () => {
  it('fills the dynamic viewport and centers on both axes', () => {
    render(
      <CenteredScreen>
        <span>child</span>
      </CenteredScreen>,
    )
    const main = screen.getByRole('main')
    expect(main.className).toContain('min-h-dvh')
    expect(main.className).not.toContain('min-h-screen')
    expect(main.className).toContain('items-center')
    expect(main.className).toContain('justify-center')
    expect(main.className).toContain('overflow-y-auto')
    expect(main.className).toContain('py-8')
  })
})
