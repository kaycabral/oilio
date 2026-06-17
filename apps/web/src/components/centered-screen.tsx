import type { ReactNode } from 'react'

export function CenteredScreen({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center p-8 text-center">
      {children}
    </main>
  )
}
