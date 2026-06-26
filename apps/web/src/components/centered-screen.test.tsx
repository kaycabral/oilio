import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CenteredScreen } from './centered-screen'

// Fix 3: the wrapper must fill the dynamic viewport and center its child on both
// axes (so a tablet in landscape isn't top-aligned), scrolling only on overflow.
describe('CenteredScreen — robust both-axes centering (Fix 3)', () => {
  it('fills the dynamic viewport and centers on both axes', () => {
    render(
      <CenteredScreen>
        <span>child</span>
      </CenteredScreen>,
    )
    const main = screen.getByRole('main')
    // `min-h-dvh` (dynamic viewport height), NOT `min-h-screen`/vh.
    expect(main.className).toContain('min-h-dvh')
    expect(main.className).not.toContain('min-h-screen')
    expect(main.className).toContain('items-center')
    expect(main.className).toContain('justify-center')
    // Scrolls instead of clipping a tall form, with vertical breathing room.
    expect(main.className).toContain('overflow-y-auto')
    expect(main.className).toContain('py-8')
  })
})
