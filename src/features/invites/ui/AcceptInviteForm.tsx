'use client'

import { acceptInvite } from '@/features/invites/adapters/invites.actions'
import { Button } from '@cbrl/design'
import { useState, useTransition } from 'react'

export function AcceptInviteForm({
  orgId,
  inviteId,
  token,
}: {
  orgId: string
  inviteId: string
  token: string
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const res = await acceptInvite(formData)
      if (!res.ok) setError(res.error)
    })
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="inviteId" value={inviteId} />
      <input type="hidden" name="token" value={token} />
      <Button type="submit" disabled={pending}>
        {pending ? 'Aceitando…' : 'Aceitar convite'}
      </Button>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </form>
  )
}
