import { cn } from '@cbrl/design'
import type { ReactNode } from 'react'

// Shared vertically-centered full-screen wrapper. Single source of the
// "sit in the middle of the viewport" behavior for the pre-auth / onboarding
// forms (Google login, complete-profile, create-Negócio, create-first-unit) AND
// the invite messaging pages — centering lives here once so every screen
// inherits it instead of copy-pasting the flex wrapper per page.
//
// `min-h-screen` + flex centering puts the content in the middle (so a tablet in
// landscape isn't top-aligned with dead space); `overflow-y-auto` keeps it
// scrollable when the content is taller than the viewport on small screens.
// `align="center"` (default) center-aligns text for short messaging pages;
// forms pass `align="start"` so labels/inputs read left-aligned.
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
        'mx-auto flex min-h-screen max-w-md flex-col items-center justify-center overflow-y-auto p-8',
        align === 'center' && 'text-center',
        className,
      )}
    >
      {children}
    </main>
  )
}
