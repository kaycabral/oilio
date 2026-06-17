'use client'

import { PhoneInput } from '@/components/PhoneInput'
import { updateProfile } from '@/features/settings/adapters/profile.actions'
import { useFormValidity } from '@/hooks/use-form-validity'
import { Button, DateField, Input, Label } from '@cbrl/design'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

// Self-service rectification form (brief 0032 / AC-06). Edits the subject's own
// global `users/{uid}` profile; the write reflects live across every screen
// (identity by reference). Pre-filled with the current values.
export function EditProfileForm({
  defaultName,
  defaultWhatsapp,
  defaultBirthDate,
}: {
  defaultName: string
  defaultWhatsapp: string
  defaultBirthDate: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const { formRef, isValid, refresh } = useFormValidity()

  const today = new Date().toISOString().slice(0, 10)

  function onSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const res = await updateProfile(formData)
      if (!res.ok) {
        setError(res.error)
        return
      }
      toast.success('Perfil atualizado.')
      router.refresh()
    })
  }

  return (
    <form
      ref={formRef}
      action={onSubmit}
      onInput={refresh}
      onChange={refresh}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="profile-name" className="text-sm font-medium">
          Nome
        </Label>
        <Input id="profile-name" name="name" defaultValue={defaultName} required minLength={2} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="profile-whatsapp" className="text-sm font-medium">
          WhatsApp
        </Label>
        <PhoneInput id="profile-whatsapp" name="whatsapp" defaultValue={defaultWhatsapp} required />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="profile-birthDate" className="text-sm font-medium">
          Data de nascimento
        </Label>
        <DateField
          id="profile-birthDate"
          name="birthDate"
          defaultValue={defaultBirthDate}
          required
          max={today}
          captionLayout="dropdown"
        />
      </div>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <Button type="submit" disabled={pending || !isValid}>
        {pending ? 'Salvando…' : 'Salvar alterações'}
      </Button>
    </form>
  )
}
