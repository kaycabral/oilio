import { cn } from '@cbrl/design'
import type { ReactNode } from 'react'

// Shared vertically-centered full-screen wrapper. Single source of the
// "sit in the middle of the viewport" behavior for the pre-auth / onboarding
// forms (Google login, complete-profile, create-Negócio, create-first-unit) AND
// the invite messaging pages — centering lives here once so every screen
// inherits it instead of copy-pasting the flex wrapper per page.
//
// `min-h-dvh` (the DYNAMIC viewport height) + `flex items-center justify-center`
// centers the child on BOTH axes in whatever space is actually available — `dvh`
// tracks the mobile/tablet address-bar collapse/expand correctly, where `vh`
// (`min-h-screen`) over-measures and leaves the content top-aligned with dead
// space. `overflow-y-auto` + vertical padding (`py-8`) lets a tall form scroll
// instead of clipping when it overflows a short landscape viewport, while a
// short form stays centered. `align="center"` (default) center-aligns text for
// short messaging pages; forms pass `align="start"` so labels/inputs read
// left-aligned — `align` is text-only and never touches the vertical centering.
export function CenteredScreen({
  children,
  align = 'center',
  className,
}: {
  children: ReactNode
  align?: 'center' | 'start'
  className?: string
}) {
  return (
    <main
      className={cn(
        'flex min-h-dvh flex-col items-center justify-center overflow-y-auto px-4 py-8',
        align === 'center' && 'text-center',
        className,
      )}
    >
      <div className={cn('w-full max-w-md', align === 'start' && 'text-left')}>{children}</div>
    </main>
  )
}
