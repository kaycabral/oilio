'use client'

import { type Capability } from '@/domain/billing/capabilities'
import { useCapability } from '@/shared/org/org-context'
import { toRoute } from '@/shared/routes'
import { EmptyState } from '@cbrl/design'
import { Lock } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode } from 'react'

/**
 * Per-capability upgrade copy. Each gated surface shows the SAME affordance —
 * an `EmptyState` (so it reads like every other empty surface in the app) with
 * a "recurso Pro" headline, the value it unlocks, and a single CTA to
 * `/settings/billing`. Centralizing the copy here keeps the wording consistent across
 * the ~13 gated surfaces (brief 0082): no bespoke paywall per screen.
 */
const UPGRADE_COPY: Record<Capability, { title: string; description: string }> = {
  'plans.recurring': {
    title: 'Planos e assinaturas são um recurso do Pro',
    description: 'Faça upgrade para criar planos e cobrar seus clientes de forma recorrente.',
  },
  commissions: {
    title: 'Comissões são um recurso do Pro',
    description: 'Faça upgrade para calcular comissões por profissional e registrar a liquidação.',
  },
  'copilot.profit_goal': {
    title: 'O Copiloto de meta é um recurso do Pro',
    description: 'Faça upgrade para definir a meta mensal de lucro e acompanhar o diagnóstico.',
  },
  'reports.sales': {
    title: 'Relatórios são um recurso do Pro',
    description: 'Faça upgrade para ver os relatórios de vendas e comissões e exportar os dados.',
  },
  'units.unlimited': {
    title: 'Unidades adicionais são um recurso do Pro',
    description: 'O plano Grátis inclui 1 unidade. Faça upgrade para abrir mais unidades.',
  },
  'team.unlimited': {
    title: 'Equipe ilimitada é um recurso do Pro',
    description: 'O plano Grátis permite você + 1 membro. Faça upgrade para adicionar mais.',
  },
  'support.priority': {
    title: 'Suporte prioritário é um recurso do Avançado',
    description: 'Faça upgrade para o plano Avançado e tenha atendimento prioritário.',
  },
}

type UpgradeGateProps = {
  /** The capability the wrapped surface requires. */
  capability: Capability
  /**
   * The gated surface. Rendered as-is when the active Negócio unlocks the
   * capability; replaced by the upgrade CTA when it does not.
   */
  children: ReactNode
}

/**
 * Gate a surface behind a Plano Oilio capability (brief 0082). When the active
 * Negócio's tier unlocks `capability`, renders `children` untouched. Otherwise
 * renders a consistent upgrade CTA in its place — so a Free org sees WHY the
 * surface is locked and HOW to unlock it (upgrade → `/settings/billing`), instead of a
 * mute empty state or a form that only fails on submit.
 *
 * NOT a security boundary: the matching `requireCapability` server guard is the
 * real wall (defense-in-depth, brief 0072). This only shapes the UI.
 */
export function UpgradeGate({ capability, children }: UpgradeGateProps): ReactNode {
  const unlocked = useCapability(capability)
  if (unlocked) return children
  return <UpgradeCta capability={capability} />
}

/**
 * The upgrade CTA on its own — for surfaces that need to place it directly
 * (e.g. an already-conditional empty state) rather than wrap their content.
 * Same copy + destination as `UpgradeGate`'s locked branch.
 */
export function UpgradeCta({ capability }: { capability: Capability }): ReactNode {
  const { title, description } = UPGRADE_COPY[capability]
  return (
    <EmptyState
      icon={<Lock />}
      title={title}
      description={description}
      actionSlot={<Link href={toRoute('/settings/billing')}>Fazer upgrade</Link>}
    />
  )
}
