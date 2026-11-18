'use client'

import { type Capability } from '@/domain/billing/capabilities'
import { useCapability } from '@/shared/org/org-context'
import { toRoute } from '@/shared/routes'
import { EmptyState } from '@oilio/design'
import { Lock } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode } from 'react'

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
  capability: Capability
  children: ReactNode
}

export function UpgradeGate({ capability, children }: UpgradeGateProps): ReactNode {
  const unlocked = useCapability(capability)
  if (unlocked) return children
  return <UpgradeCta capability={capability} />
}

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
