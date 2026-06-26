'use client'

import { removeMemberFromTeam } from '@/features/team/adapters/team.actions'
import { Button } from '@cbrl/design'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

// Unified "remover do time" action — brief 0041 #1103 (AC-01/AC-10). The single
// entry point an establishment uses to offboard a member: ends their access
// (membership → terminal `revoked`) and deactivates the professional projection
// via the server saga. Distinct from the reversible deactivate toggle (brief
// 0029): this is a terminal severance. The vínculo data is RETAINED identifiable
// (art. 16) — nothing is anonymized/scrubbed.
//
// Owner/manager only, never the owner nor the viewer's own membership (gated by
// the page + the action). A lightweight confirm guards the destructive intent.
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
      // AC-08: removal succeeded, but a unit was left with no active
      // professional. Surface a NON-BLOCKING warning + stay on the page so the
      // owner reads it (bookings on that unit would have no slots until another
      // professional is assigned). The member is already removed.
      const unitWarning = res.warnings.find((w) => w.kind === 'unit-without-professional')
      if (unitWarning) {
        // Keep the warning on screen — do NOT refresh/navigate (a router.refresh
        // would remount this client component and drop the message). The member
        // is already removed; the owner reads the capacity warning here.
        setWarning(
          `Membro removido. Atenção: ${unitWarning.unitIds.length === 1 ? 'a unidade' : 'as unidades'} ${unitWarning.unitIds.join(', ')} ${unitWarning.unitIds.length === 1 ? 'ficou' : 'ficaram'} sem profissional ativo — os agendamentos ficarão sem horários até atribuir outro profissional.`,
        )
        return
      }
      // The member loses access + drops from the active team — go back to the
      // team listing where they no longer appear.
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
