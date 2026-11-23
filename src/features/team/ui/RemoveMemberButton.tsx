'use client'

import { removeMemberFromTeam } from '@/features/team/adapters/team.actions'
import { Button } from '@cbrl/design'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

export function RemoveMemberButton({ targetUserId }: { targetUserId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)

  function onSubmit() {
    setError(null)
    setWarning(null)
    startTransition(async () => {
      const res = await removeMemberFromTeam(targetUserId)
      if (!res.ok) {
        setError(res.error)
        return
      }
      const unitWarning = res.warnings.find((w) => w.kind === 'unit-without-memberOperation')
      if (unitWarning) {
        setWarning(
          `Membro removido. Atenção: ${unitWarning.unitIds.length === 1 ? 'a unidade' : 'as unidades'} ${unitWarning.unitIds.join(', ')} ${unitWarning.unitIds.length === 1 ? 'ficou' : 'ficaram'} sem profissional ativo — os agendamentos ficarão sem horários até atribuir outro profissional.`,
        )
        return
      }
      router.push('/team')
      router.refresh()
    })
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-2" aria-label="Remover do time">
      <p className="text-muted-foreground text-xs">
        Remover do time encerra o acesso do membro em definitivo (desligamento). Os registros,
        vendas e comissões dele permanecem identificáveis no histórico (retenção legal).
      </p>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {warning ? <p className="text-sm text-amber-600">{warning}</p> : null}
      <div>
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? 'Removendo…' : 'Remover do time'}
        </Button>
      </div>
    </form>
  )
}
