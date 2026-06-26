import type { ReactNode } from 'react'

// Normalized status pill — ONE visual vocabulary for every list/detail status
// across the app (vendas, assinaturas, catálogo, planos, equipe…). Each surface
// maps its domain status to a semantic `tone`; the colors live here, so a
// restyle is one edit. Kept app-level on purpose: the design `<List>` stays
// status-agnostic (it just renders whatever `badge` node it's given).
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

// A professional not yet `operational` (#1047) reads IDENTICALLY on every
// list/operational surface — one label, one tone — so the team list and the
// agenda never disagree. The granular stage (Convite não aceito / Cadastro
// incompleto) stays on the member DETAIL page, where the "why" is actionable.
export function IncompleteProfileBadge() {
  return <StatusBadge tone="warning">Cadastro incompleto</StatusBadge>
}
