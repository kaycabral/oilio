'use client'

import { deleteMyDataAction } from '@/features/settings/adapters/privacy.actions'
import { getClientAuth } from '@/shared/firebase/client'
import { Button, Input, Label } from '@cbrl/design'
import { signOut } from 'firebase/auth'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

const CONFIRM_WORD = 'EXCLUIR'

// Self-service erasure (brief 0032 / AC-07). Requires the subject to type a
// confirmation word — the operation is irreversible (no reverse map, art. 12).
// On success the session is destroyed and the user is bounced to /login: the
// account no longer holds any PII to operate with.
export function DeleteMyDataForm() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [confirmText, setConfirmText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const canSubmit = confirmText.trim().toUpperCase() === CONFIRM_WORD

  function onSubmit() {
    setError(null)
    startTransition(async () => {
      const res = await deleteMyDataAction()
      if (!res.ok) {
        setError(res.error)
        return
      }
      // No PII left — tear the session down and leave the app. Surface the
      // informed-consent fact (brief 0032 / #1101, AC-12) when an active
      // subscription was cancelled as part of the erasure cascade.
      await fetch('/api/session', { method: 'DELETE' }).catch(() => {})
      await signOut(getClientAuth()).catch(() => {})
      toast.success(
        res.cancelledActiveSubscription
          ? 'Seus dados foram anonimizados e sua assinatura ativa foi cancelada.'
          : 'Seus dados foram anonimizados.',
      )
      router.replace('/login')
      router.refresh()
    })
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor="delete-confirm" className="text-sm font-medium">
          Digite <strong>{CONFIRM_WORD}</strong> para confirmar
        </Label>
        <Input
          id="delete-confirm"
          name="confirm"
          autoComplete="off"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
        />
      </div>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <Button type="submit" variant="destructive" disabled={pending || !canSubmit}>
        {pending ? 'Anonimizando…' : 'Excluir meus dados'}
      </Button>
    </form>
  )
}
