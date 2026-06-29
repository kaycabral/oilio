'use client'

import { PhoneInput } from '@/components/PhoneInput'
import { completeProfile } from '@/features/onboarding/adapters/complete-profile.actions'
import type { ProfilePrefill } from '@/features/onboarding/core/profile-form'
import { useFormValidity } from '@/hooks/use-form-validity'
import { Button, DateField, Input, Label } from '@cbrl/design'
import { useId, useState, useTransition } from 'react'

export function CompleteProfileForm({
  prefill,
  next,
  contextQuery = '',
}: {
  prefill: ProfilePrefill
  next: string
  contextQuery?: string
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const { formRef, isValid, refresh } = useFormValidity()
  const ids = useId()
  const nameId = `${ids}-name`
  const whatsappId = `${ids}-whatsapp`
  const birthDateId = `${ids}-birthDate`

  const today = new Date().toISOString().slice(0, 10)
  const isMissing = (f: 'name' | 'whatsapp' | 'birthDate') => prefill.missing.includes(f)

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
      {contextQuery ? <input type="hidden" name="context" value={contextQuery} /> : null}
      {isMissing('name') ? (
        <div className="flex flex-col gap-1">
          <Label htmlFor={nameId} className="text-sm font-medium">
            Nome <MissingHint />
          </Label>
          <Input id={nameId} name="name" defaultValue={prefill.name} required minLength={2} />
        </div>
      ) : (
        <>
          <input type="hidden" name="name" value={prefill.name} />
          <p className="text-muted-foreground text-sm">
            Você é <strong className="text-foreground">{prefill.name}</strong>.
          </p>
        </>
      )}
      <div className="flex flex-col gap-1">
        <Label htmlFor={whatsappId} className="text-sm font-medium">
          WhatsApp {isMissing('whatsapp') ? <MissingHint /> : null}
        </Label>
        <PhoneInput id={whatsappId} name="whatsapp" defaultValue={prefill.whatsapp} required />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={birthDateId} className="text-sm font-medium">
          Data de nascimento {isMissing('birthDate') ? <MissingHint /> : null}
        </Label>
        <DateField
          id={birthDateId}
          name="birthDate"
          defaultValue={prefill.birthDate}
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

function MissingHint() {
  return <span className="text-muted-foreground text-xs font-normal">· falta preencher</span>
}
