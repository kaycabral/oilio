import type { ReactNode } from 'react'

export type StatusTone = 'success' | 'warning' | 'danger' | 'neutral' | 'info'

const TONE_CLASS: Record<StatusTone, string> = {
  success: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  danger: 'bg-destructive/10 text-destructive',
  neutral: 'bg-muted text-muted-foreground',
  info: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
}

export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span
      data-slot="status-badge"
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  )
}

export function IncompleteProfileBadge() {
  return <StatusBadge tone="warning">Cadastro incompleto</StatusBadge>
}
