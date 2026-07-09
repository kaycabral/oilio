'use client'

import { setMemberStatus } from '@/features/team/adapters/team.actions'
import { Button } from '@cbrl/design'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

export function MemberStatusToggle({
  targetUserId,
  status,
}: {
  targetUserId: string
  status: 'active' | 'suspended'
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const isSuspended = status === 'suspended'
  const next = isSuspended ? 'active' : 'suspended'

  function onSubmit() {
    setError(null)
    startTransition(async () => {
      const res = await setMemberStatus(targetUserId, next)
      if (!res.ok) {
        setError(res.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <form
      action={onSubmit}
      className="flex flex-col gap-2"
      aria-label={isSuspended ? 'Reativar membro' : 'Desativar membro'}
    >
      <p className="text-muted-foreground text-xs">
        {isSuspended
          ? 'Membro desativado — não opera até ser reativado (sem acesso efetivo).'
          : 'Desativar suspende o acesso do membro (férias/saída). Reativar devolve o acesso.'}
      </p>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <div>
        <Button type="submit" variant={isSuspended ? 'default' : 'destructive'} disabled={pending}>
          {(() => {
            if (pending) return isSuspended ? 'Reativando…' : 'Desativando…'
            return isSuspended ? 'Reativar membro' : 'Desativar membro'
          })()}
        </Button>
      </div>
    </form>
  )
}
