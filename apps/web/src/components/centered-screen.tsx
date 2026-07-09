import { cn } from '@cbrl/design'
import type { ReactNode } from 'react'

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
