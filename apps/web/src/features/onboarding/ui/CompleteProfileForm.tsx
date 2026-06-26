'use client'

import { PhoneInput } from '@/components/PhoneInput'
import { completeProfile } from '@/features/onboarding/adapters/complete-profile.actions'
import { useFormValidity } from '@/hooks/use-form-validity'
import { Button, DateField, Input, Label } from '@cbrl/design'
import { useId, useState, useTransition } from 'react'

export function CompleteProfileForm({ defaultName, next }: { defaultName: string; next: string }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const { formRef, isValid, refresh } = useFormValidity()
  const ids = useId()
  const nameId = `${ids}-name`
  const whatsappId = `${ids}-whatsapp`
  const birthDateId = `${ids}-birthDate`

  const today = new Date().toISOString().slice(0, 10)

  function onSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const res = await completeProfile(formData)
      if (res && !res.ok) setError(res.error)
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
      <input type="hidden" name="next" value={next} />
      <div className="flex flex-col gap-1">
        <Label htmlFor={nameId} className="text-sm font-medium">
          Nome
        </Label>
        <Input id={nameId} name="name" defaultValue={defaultName} required minLength={2} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={whatsappId} className="text-sm font-medium">
          WhatsApp
        </Label>
        <PhoneInput id={whatsappId} name="whatsapp" required />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={birthDateId} className="text-sm font-medium">
          Data de nascimento
        </Label>
        <DateField
          id={birthDateId}
          name="birthDate"
          required
          max={today}
          captionLayout="dropdown"
        />
      </div>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <Button type="submit" disabled={pending || !isValid}>
        {pending ? 'Salvando…' : 'Continuar'}
      </Button>
    </form>
  )
}
