'use client'

import { PhoneInput } from '@/components/PhoneInput'
import { completeProfile } from '@/features/onboarding/adapters/complete-profile.actions'
import type { ProfilePrefill } from '@/features/onboarding/core/profile-form'
import { useFormValidity } from '@/hooks/use-form-validity'
import { Button, DateField, Field, FieldGroup, FieldLabel, Input } from '@cbrl/design'
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
  const isMissing = (f: 'name') => prefill.missing.includes(f)

  function onSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const res = await completeProfile(formData)
      if (res && !res.ok) setError(res.error)
    })
  }

  return (
    <form ref={formRef} action={onSubmit} onInput={refresh} onChange={refresh}>
      <FieldGroup>
        <input type="hidden" name="next" value={next} />
        {contextQuery ? <input type="hidden" name="context" value={contextQuery} /> : null}
        {isMissing('name') ? (
          <Field>
            <FieldLabel htmlFor={nameId} required>
              Nome
            </FieldLabel>
            <Input id={nameId} name="name" defaultValue={prefill.name} required minLength={2} />
          </Field>
        ) : (
          <>
            <input type="hidden" name="name" value={prefill.name} />
            <p className="text-muted-foreground text-sm">
              Você é <strong className="text-foreground">{prefill.name}</strong>.
            </p>
          </>
        )}
        <Field>
          <FieldLabel htmlFor={whatsappId} required>
            WhatsApp
          </FieldLabel>
          <PhoneInput id={whatsappId} name="whatsapp" defaultValue={prefill.whatsapp} required />
        </Field>
        <Field>
          <FieldLabel htmlFor={birthDateId} required>
            Data de nascimento
          </FieldLabel>
          <DateField
            id={birthDateId}
            name="birthDate"
            defaultValue={prefill.birthDate}
            required
            max={today}
            captionLayout="dropdown"
          />
        </Field>
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
        <Button type="submit" disabled={pending || !isValid}>
          {pending ? 'Salvando…' : 'Continuar'}
        </Button>
      </FieldGroup>
    </form>
  )
}
